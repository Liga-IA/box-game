/**
 * poseDetector.js
 * Analisa os landmarks do MediaPipe Pose para:
 * 1. Verificar distância/posicionamento do usuário
 * 2. Reconhecer os 5 tipos de socos com classificação baseada em trajetória temporal
 *
 * COORDENADAS: O MediaPipe retorna x em [0,1] onde x=0 é o lado ESQUERDO da imagem
 * capturada. Como a câmera de selfie espelha a imagem, o lado ESQUERDO anatômico do
 * jogador aparece no lado DIREITO da imagem (x alto). Isso é crítico para a lógica
 * de cruzado e jab/direto.
 *
 * ESPELHAMENTO: Os landmarks LEFT_X/RIGHT_X do MediaPipe se referem ao lado
 * ANATOMICO do sujeito (LEFT = lado esquerdo do corpo), independente do espelhamento
 * da camera. Na imagem espelhada de selfie: LEFT_SHOULDER.x > RIGHT_SHOULDER.x
 * (ombro esquerdo do jogador aparece mais a direita na imagem espelhada).
 */

// Índices dos landmarks do MediaPipe Pose
export const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,    RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,    RIGHT_WRIST: 16,
  LEFT_HIP: 23,      RIGHT_HIP: 24,
  LEFT_KNEE: 25,     RIGHT_KNEE: 26,
};

export const PUNCH_TYPES = {
  NONE:      { id: 'none',     name: '',         emoji: '',   color: '#ffffff' },
  JAB:       { id: 'jab',      name: 'JAB',      emoji: '⚡', color: '#00d4ff' },
  DIRETO:    { id: 'direto',   name: 'DIRETO',   emoji: '💥', color: '#ff6b35' },
  CRUZADO:   { id: 'cruzado',  name: 'CRUZADO',  emoji: '🌀', color: '#a855f7' },
  GANCHO:    { id: 'gancho',   name: 'GANCHO',   emoji: '🔄', color: '#22c55e' },
  UPPERCUT:  { id: 'uppercut', name: 'UPPERCUT', emoji: '☝️', color: '#ffd60a' },
};

// Informações para o tutorial
export const PUNCH_INFO = [
  {
    type: PUNCH_TYPES.JAB,
    desc: 'Soco direto e rápido com a mão da frente. Estenda o braço rapidamente para frente.',
    tip: '💡 Movimento rápido e linear',
    emoji: '⚡'
  },
  {
    type: PUNCH_TYPES.DIRETO,
    desc: 'Soco potente com a mão traseira. Mais lento, mas muito mais força. Gire o quadril.',
    tip: '💡 Use o peso do corpo inteiro',
    emoji: '💥'
  },
  {
    type: PUNCH_TYPES.CRUZADO,
    desc: 'Soco cruzando o corpo em trajetória diagonal ou lateral, cruzando a linha central.',
    tip: '💡 Mão passa pelo centro do corpo',
    emoji: '🌀'
  },
  {
    type: PUNCH_TYPES.GANCHO,
    desc: 'Soco curvo com cotovelo dobrado, atingindo de forma lateral ou de baixo para cima.',
    tip: '💡 Cotovelo fica a 90° durante o soco',
    emoji: '🔄'
  },
  {
    type: PUNCH_TYPES.UPPERCUT,
    desc: 'Soco ascendente de baixo para cima, atingindo o queixo. Começa com o punho baixo.',
    tip: '💡 Movimento de "puxar" de baixo para cima',
    emoji: '☝️'
  }
];

/**
 * STANCE — base de luta do jogador
 *   'orthodox'  → mão esquerda na frente (jab=esquerda, direto=direita)
 *   'southpaw'  → mão direita na frente  (jab=direita,  direto=esquerda)
 *
 * Importante: 'esquerda/direita' aqui é o LADO ANATÔMICO (índice de landmark),
 * não a posição visual na câmera.
 */
export const STANCE = {
  ORTHODOX: 'orthodox',
  SOUTHPAW: 'southpaw',
};

export class PoseDetector {
  constructor(stance = STANCE.ORTHODOX) {
    // ── Base de luta ────────────────────────────────────────
    this.stance = stance;

    // ── Histórico de posições dos pulsos (buffer circular) ──
    this.wristHistory = {
      left:  [],
      right: []
    };
    this.historyMaxLen = 10; // ~333ms a 30fps

    // ── Histórico de posição inicial (para detectar de onde o soco partiu) ──
    this.punchStartPos = {
      left:  null,
      right: null,
    };

    // ── Estado de fase do golpe (extensão vs retorno) ───────
    // Evita contabilizar o mesmo soco ao retornar
    this.punchPhase = {
      left:  'idle',   // idle | extending | returning
      right: 'idle',
    };
    this.peakSpeed = {
      left:  0,
      right: 0,
    };

    // ── Cooldown entre detecções (independente por braço) ───
    this.lastPunchTimeLeft  = 0;
    this.lastPunchTimeRight = 0;
    this.punchCooldown = 400; // ms

    // ── Último soco detectado ───────────────────────────────
    this.lastPunch = PUNCH_TYPES.NONE;

    // ── Estado de calibração ────────────────────────────────
    this.calibration = {
      poseDetected: false,
      distanceOk:   false,
      lightOk:      true,
    };

    // ── Dimensões do canvas para normalização ───────────────
    this.canvasW = 640;
    this.canvasH = 480;
  }

  setStance(stance) {
    this.stance = stance;
  }

  setCanvasDimensions(w, h) {
    this.canvasW = w;
    this.canvasH = h;
  }

  /**
   * Analisa os resultados do MediaPipe Pose
   * Retorna { calibration, punch, landmarks, wristVelocity }
   */
  analyze(results) {
    const output = {
      calibration: { ...this.calibration },
      punch: PUNCH_TYPES.NONE,
      landmarks: null,
      wristVelocity: { left: 0, right: 0 }
    };

    if (!results || !results.poseLandmarks) {
      this.calibration.poseDetected = false;
      output.calibration.poseDetected = false;
      return output;
    }

    const lm = results.poseLandmarks;
    output.landmarks = lm;

    // ── Verificar visibilidade de pontos-chave ──────────────
    const keyPoints = [
      LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
      LM.LEFT_ELBOW,    LM.RIGHT_ELBOW,
      LM.LEFT_WRIST,    LM.RIGHT_WRIST,
    ];
    const allVisible = keyPoints.every(idx => lm[idx] && lm[idx].visibility > 0.4);
    this.calibration.poseDetected = allVisible;
    output.calibration.poseDetected = allVisible;

    if (!allVisible) return output;

    // ── Verificar distância ─────────────────────────────────
    const shoulderWidth = Math.abs(lm[LM.LEFT_SHOULDER].x - lm[LM.RIGHT_SHOULDER].x);
    const distanceOk = shoulderWidth >= 0.22 && shoulderWidth <= 0.5;
    this.calibration.distanceOk = distanceOk;
    output.calibration.distanceOk = distanceOk;

    // ── Calcular métricas de referência ─────────────────────
    const midShoulderX = (lm[LM.LEFT_SHOULDER].x + lm[LM.RIGHT_SHOULDER].x) / 2;
    const midShoulderY = (lm[LM.LEFT_SHOULDER].y + lm[LM.RIGHT_SHOULDER].y) / 2;

    // ── Atualizar histórico de pulsos ───────────────────────
    const now = performance.now();
    this.updateWristHistory('left',  lm[LM.LEFT_WRIST],  now);
    this.updateWristHistory('right', lm[LM.RIGHT_WRIST], now);

    // ── Atualizar fases de golpe ─────────────────────────────
    this.updatePunchPhase('left',  lm, now);
    this.updatePunchPhase('right', lm, now);

    // ── Detecção de soco ────────────────────────────────────
    let bestPunch = PUNCH_TYPES.NONE;
    let bestScore = 0;
    let usedSide  = null;

    if (now - this.lastPunchTimeLeft > this.punchCooldown) {
      const leftResult = this.detectPunchSide('left', lm, midShoulderX, midShoulderY, shoulderWidth, now);
      if (leftResult.punch.id !== 'none' && leftResult.score > bestScore) {
        bestPunch = leftResult.punch;
        bestScore = leftResult.score;
        usedSide  = 'left';
      }
    }

    if (now - this.lastPunchTimeRight > this.punchCooldown) {
      const rightResult = this.detectPunchSide('right', lm, midShoulderX, midShoulderY, shoulderWidth, now);
      if (rightResult.punch.id !== 'none' && rightResult.score > bestScore) {
        bestPunch = rightResult.punch;
        bestScore = rightResult.score;
        usedSide  = 'right';
      }
    }

    if (bestPunch.id !== 'none') {
      this.lastPunch = bestPunch;
      if (usedSide === 'left')  this.lastPunchTimeLeft  = now;
      if (usedSide === 'right') this.lastPunchTimeRight = now;
      // Marcar fase como retorno para evitar dupla contagem
      if (usedSide) this.punchPhase[usedSide] = 'returning';

      output.punch = bestPunch;
      output.wristVelocity = this.getWristVelocities();
    }

    return output;
  }

  // ──────────────────────────────────────────────────────────
  // GESTÃO DE HISTÓRICO
  // ──────────────────────────────────────────────────────────

  updateWristHistory(side, wrist, timestamp) {
    const history = this.wristHistory[side];
    history.push({ x: wrist.x, y: wrist.y, z: wrist.z || 0, t: timestamp });
    if (history.length > this.historyMaxLen) history.shift();
  }

  getWristVelocities() {
    const calcVel = (history) => {
      if (history.length < 3) return 0;
      const recent = history[history.length - 1];
      const old    = history[history.length - 3];
      const dt = (recent.t - old.t) / 1000 || 0.001;
      const dx = recent.x - old.x;
      const dy = recent.y - old.y;
      return Math.sqrt(dx * dx + dy * dy) / dt;
    };
    return {
      left:  calcVel(this.wristHistory.left),
      right: calcVel(this.wristHistory.right),
    };
  }

  // ──────────────────────────────────────────────────────────
  // DETECÇÃO DE FASE DO GOLPE
  // Evita que o retorno do braço seja classificado como novo soco
  // ──────────────────────────────────────────────────────────

  updatePunchPhase(side, lm, now) {
    const history = this.wristHistory[side];
    if (history.length < 3) return;

    const speed = this.calcInstantSpeed(history);
    const SPEED_START  = 0.035; // mínimo para começar extensão
    const SPEED_IDLE   = 0.012; // abaixo disso → volta ao idle

    const phase = this.punchPhase[side];

    if (phase === 'idle') {
      if (speed > SPEED_START) {
        this.punchPhase[side] = 'extending';
        this.peakSpeed[side]  = speed;
        // Registrar posição inicial do punho (média dos 3 primeiros frames disponíveis)
        const startFrame = history[Math.max(0, history.length - 4)];
        this.punchStartPos[side] = { x: startFrame.x, y: startFrame.y };
      }
    } else if (phase === 'extending') {
      if (speed > this.peakSpeed[side]) {
        this.peakSpeed[side] = speed;
      }
      // Começa a desacelerar: transição para retorno
      if (speed < this.peakSpeed[side] * 0.45 && this.peakSpeed[side] > SPEED_START) {
        this.punchPhase[side] = 'returning';
      }
    } else if (phase === 'returning') {
      // Retornou à posição de guarda (velocidade baixa)
      if (speed < SPEED_IDLE) {
        this.punchPhase[side] = 'idle';
        this.peakSpeed[side]  = 0;
        this.punchStartPos[side] = null;
      }
    }
  }

  calcInstantSpeed(history) {
    if (history.length < 3) return 0;
    const len    = history.length;
    const recent = history[len - 1];
    const old    = history[len - 3];
    const dt     = (recent.t - old.t) / 1000 || 0.001;
    const dx     = recent.x - old.x;
    const dy     = recent.y - old.y;
    return Math.sqrt(dx * dx + dy * dy) / dt;
  }

  // ──────────────────────────────────────────────────────────
  // VETOR DE MOVIMENTO SUAVIZADO
  // Usa janela de frames maior e média ponderada
  // ──────────────────────────────────────────────────────────

  /**
   * Retorna o vetor de deslocamento normalizado desde o inicio do golpe.
   * Usa punchStartPos quando disponivel para maior estabilidade.
   * Retorna: { dx, dy, speed } onde speed = magnitude do deslocamento.
   */
  getMovementVector(history, startPos = null) {
    if (history.length < 4) return { dx: 0, dy: 0, speed: 0 };

    const len    = history.length;
    const recent = history[len - 1];

    // Usar posicao de inicio do golpe se disponivel, senao janela de 6 frames
    const origin = startPos || history[Math.max(0, len - 6)];

    const dx = recent.x - origin.x;
    const dy = recent.y - origin.y;
    const speed = Math.sqrt(dx * dx + dy * dy);

    return { dx, dy, speed };
  }

  // ──────────────────────────────────────────────────────────
  // CLASSIFICAÇÃO DO GOLPE
  // ──────────────────────────────────────────────────────────

  /**
   * Determina se o braço é o da frente (jab) ou o de trás (direto)
   * baseado na guarda configurada.
   *
   * Atenção: 'left'/'right' aqui são os índices anatômicos do MediaPipe
   * (LEFT_WRIST = lado esquerdo do corpo do jogador).
   * Na guarda ORTODOXA, o lado ESQUERDO é o da frente.
   * Na guarda SOUTHPAW, o lado DIREITO é o da frente.
   */
  isFrontHand(side) {
    if (this.stance === STANCE.ORTHODOX) {
      return side === 'left';   // esquerda na frente
    } else {
      return side === 'right';  // direita na frente (southpaw)
    }
  }

  /**
   * Detecta o soco para um lado específico.
   * Retorna { punch, score } onde score é a confiança da classificação.
   *
   * Hierarquia de classificação (do mais restritivo ao menos):
   *   1. UPPERCUT  — trajetória ascendente + punho parte de baixo
   *   2. GANCHO    — cotovelo muito dobrado + trajetória lateral em arco
   *   3. CRUZADO   — punho cruza linha central + cotovelo semi-estendido
   *   4. JAB/DIRETO — linear, mínimo deslocamento lateral
   */
  detectPunchSide(side, lm, midShoulderX, midShoulderY, shoulderWidth, now) {
    const history = this.wristHistory[side];
    if (history.length < 4) return { punch: PUNCH_TYPES.NONE, score: 0 };

    // Só classificar na fase de extensão (pico de velocidade)
    // Aceitar também no início do retorno (peakSpeed recém atingido)
    const phase = this.punchPhase[side];
    if (phase !== 'extending') return { punch: PUNCH_TYPES.NONE, score: 0 };

    const vec   = this.getSmoothedVector(history, this.punchStartPos[side]);
    const speed = vec.speed;

    const MIN_SPEED = 0.04; // deslocamento mínimo normalizado
    if (speed < MIN_SPEED) return { punch: PUNCH_TYPES.NONE, score: 0 };

    // Confiança mínima de visibilidade
    const useLeft = (side === 'left');
    const elbowIdx   = useLeft ? LM.LEFT_ELBOW    : LM.RIGHT_ELBOW;
    const wristIdx   = useLeft ? LM.LEFT_WRIST    : LM.RIGHT_WRIST;
    const shoulderIdx = useLeft ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER;

    const elbow   = lm[elbowIdx];
    const wrist   = lm[wristIdx];
    const shoulder = lm[shoulderIdx];
    const otherShoulderIdx = useLeft ? LM.RIGHT_SHOULDER : LM.LEFT_SHOULDER;
    const otherShoulder = lm[otherShoulderIdx];

    const elbowAngle = this.calcElbowAngle(lm, useLeft);
    const isFront    = this.isFrontHand(side);

    // ── 1. UPPERCUT ────────────────────────────────────────
    // Características:
    //   - Movimento predominantemente ascendente (dy negativo = sobe)
    //   - Punho começa ABAIXO do cotovelo (posição inicial baixa)
    //   - Cotovelo dobrado durante a execução (ângulo < 140°)
    //   - Punho sobe para altura do queixo/rosto no final
    const startPos = this.punchStartPos[side];
    const wristStartedLow = startPos && startPos.y > shoulder.y + 0.08; // punho começou abaixo do ombro
    const movingUp = vec.dy < -0.04; // subindo (y decresce)
    const verticalDominant = Math.abs(vec.dy) > Math.abs(vec.dx) * 0.7;
    const elbowBentForUppercut = elbowAngle < 145;
    const wristReachedFaceHeight = wrist.y < shoulder.y + 0.15;

    if (movingUp && verticalDominant && wristStartedLow && elbowBentForUppercut && wristReachedFaceHeight) {
      return { punch: PUNCH_TYPES.UPPERCUT, score: speed * 2.0 };
    }

    // ── 2. GANCHO ──────────────────────────────────────────
    // Características:
    //   - Cotovelo muito dobrado (ângulo 70°–115°) durante todo o golpe
    //   - Trajetória predominantemente lateral (dx dominante)
    //   - Punho NÃO cruza a linha central (golpe fica do mesmo lado)
    //   - Cotovelo fica na altura ou acima do punho (posição em L)
    //   - Pouco deslocamento vertical (dy pequeno relativo a dx)
    //   - Punho se move em ARCO: o vetor de velocidade muda de direção ao longo do tempo
    const elbowBentForHook = elbowAngle >= 65 && elbowAngle <= 115;
    const lateralDominant  = Math.abs(vec.dx) > Math.abs(vec.dy) * 0.7;
    const elbowAboveWrist  = elbow.y <= wrist.y + 0.05; // cotovelo na altura ou acima do pulso
    const arcMotion        = this.detectArcMotion(history);

    // Para gancho, o punho NÃO deve cruzar o centro (isso seria cruzado)
    // Na câmera espelhada (selfie): LEFT_* tem x maior (está à direita visualmente)
    // O punho do gancho fica do mesmo lado do ombro correspondente
    const wristCurrent = history[history.length - 1];
    const wristStaysSameSide = useLeft
      ? wristCurrent.x > midShoulderX - shoulderWidth * 0.3   // pulso esquerdo fica à direita do centro (imagem espelhada)
      : wristCurrent.x < midShoulderX + shoulderWidth * 0.3;  // pulso direito fica à esquerda do centro

    if (elbowBentForHook && lateralDominant && elbowAboveWrist && wristStaysSameSide) {
      const hookScore = speed * (arcMotion ? 1.8 : 1.2);
      return { punch: PUNCH_TYPES.GANCHO, score: hookScore };
    }

    // ── 3. CRUZADO ─────────────────────────────────────────
    // Características:
    //   - Punho CRUZA a linha central (passa pelo centro do corpo)
    //   - Cotovelo semi-estendido a estendido (ângulo > 110°)
    //   - Trajetória predominantemente horizontal
    //   - Executado pela mão de TRÁS (é o golpe característico da mão de trás que cruza)
    //   - Rotação do tronco contribui: ombro de trás avança
    //
    // NOTA SOBRE ESPELHAMENTO:
    //   Câmera selfie inverte X. No MediaPipe (imagem original sem espelhar):
    //     LEFT_SHOULDER.x  > RIGHT_SHOULDER.x  (ombro esq do jogador está à direita da imagem)
    //   O cruzado da mão direita (base ortodoxa) vai de RIGHT_SHOULDER.x (baixo)
    //   em direção a LEFT_SHOULDER.x (alto) → dx positivo para useLeft=false
    //   O cruzado da mão esquerda (base southpaw) vai de LEFT_SHOULDER.x (alto)
    //   em direção a RIGHT_SHOULDER.x (baixo) → dx negativo para useLeft=true

    const elbowExtended = elbowAngle > 110;
    const wristOld = history[Math.max(0, history.length - 6)];

    // Verificar se o punho cruzou a linha central
    // Na câmera espelhada: ombro esquerdo (LEFT) tem x MAIOR (lados invertidos na imagem)
    // midShoulderX é o ponto central entre os dois ombros
    //
    // Para braço ESQUERDO (useLeft=true): parte de x grande (lado esq do jogador = dir da imagem)
    //   → cruzou quando wristCurrent.x < midShoulderX (foi para o lado direito do jogador = esq da imagem)
    // Para braço DIREITO (useLeft=false): parte de x pequeno (lado dir do jogador = esq da imagem)
    //   → cruzou quando wristCurrent.x > midShoulderX (foi para o lado esquerdo do jogador = dir da imagem)
    const crossedCenter = useLeft
      ? (wristOld.x > midShoulderX && wristCurrent.x < midShoulderX)
      : (wristOld.x < midShoulderX && wristCurrent.x > midShoulderX);

    // Verificar que é a mão de TRÁS (cruzado é sempre mão de trás na maioria dos contextos)
    // mas aceitamos também da mão da frente como cruzado se cruzar muito claramente
    const crossedByBackHand = !isFront;
    const crossedByFrontHand = isFront && Math.abs(vec.dx) > 0.09; // front hand crossing is less common but valid

    if (elbowExtended && crossedCenter && (crossedByBackHand || crossedByFrontHand)) {
      return { punch: PUNCH_TYPES.CRUZADO, score: speed * 1.6 };
    }

    // ── 4. JAB / DIRETO ────────────────────────────────────
    // Características:
    //   - Trajetória predominantemente linear para frente
    //   - Pouco deslocamento lateral (o punho vai reto)
    //   - Cotovelo estendido ao final (ângulo > 130°)
    //   - O punho NÃO cruza o centro
    //   - Jab = mão da frente; Direto = mão de trás
    const isLinear      = Math.abs(vec.dx) < 0.09 && Math.abs(vec.dy) < 0.08;
    const isLinearSoft  = Math.abs(vec.dx) < 0.12 && Math.abs(vec.dy) < 0.10; // tolerância extra
    const elbowFairlyExtended = elbowAngle > 125;

    if (elbowFairlyExtended && (isLinear || (isLinearSoft && speed > 0.07))) {
      if (isFront) {
        return { punch: PUNCH_TYPES.JAB, score: speed * 1.5 };
      } else {
        return { punch: PUNCH_TYPES.DIRETO, score: speed * 1.4 };
      }
    }

    // ── 5. Fallback: soco reto genérico com velocidade alta ─
    // Usado quando os critérios acima não são satisfeitos mas há movimento claro
    if (speed > 0.08 && elbowAngle > 115) {
      return { punch: (isFront ? PUNCH_TYPES.JAB : PUNCH_TYPES.DIRETO), score: speed * 0.9 };
    }

    return { punch: PUNCH_TYPES.NONE, score: 0 };
  }

  // ──────────────────────────────────────────────────────────
  // UTILITÁRIOS
  // ──────────────────────────────────────────────────────────

  /**
   * Detecta se o movimento do punho tem formato de arco (trajetória curva).
   * Compara a direção do vetor nos primeiros frames com os últimos.
   * Se a direção mudou significativamente → movimento em arco.
   */
  detectArcMotion(history) {
    if (history.length < 6) return false;
    const len = history.length;

    // Vetor nos frames iniciais do movimento
    const earlyDx = history[len - 4].x - history[len - 6].x;
    const earlyDy = history[len - 4].y - history[len - 6].y;

    // Vetor nos frames recentes
    const lateDx = history[len - 1].x - history[len - 3].x;
    const lateDy = history[len - 1].y - history[len - 3].y;

    const earlyMag = Math.sqrt(earlyDx * earlyDx + earlyDy * earlyDy);
    const lateMag  = Math.sqrt(lateDx * lateDx + lateDy * lateDy);
    if (earlyMag < 0.003 || lateMag < 0.003) return false;

    // Produto escalar normalizado (cosseno do ângulo entre vetores)
    const dot = (earlyDx / earlyMag) * (lateDx / lateMag) +
                (earlyDy / earlyMag) * (lateDy / lateMag);

    // dot < 0.7 significa que a direção mudou mais de ~45° → arco detectado
    return dot < 0.7;
  }

  calcElbowAngle(lm, useLeft) {
    const shoulderIdx = useLeft ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER;
    const elbowIdx    = useLeft ? LM.LEFT_ELBOW    : LM.RIGHT_ELBOW;
    const wristIdx    = useLeft ? LM.LEFT_WRIST    : LM.RIGHT_WRIST;

    const s = lm[shoulderIdx];
    const e = lm[elbowIdx];
    const w = lm[wristIdx];

    // Vetor ombro→cotovelo
    const v1 = { x: s.x - e.x, y: s.y - e.y };
    // Vetor cotovelo→pulso
    const v2 = { x: w.x - e.x, y: w.y - e.y };

    const dot  = v1.x * v2.x + v1.y * v2.y;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

    if (mag1 === 0 || mag2 === 0) return 180;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));
    return angle * (180 / Math.PI);
  }

  /**
   * Retorna feedback de calibração para o usuário
   */
  getCalibrationFeedback() {
    const cal = this.calibration;
    if (!cal.poseDetected) {
      return {
        icon: '🔍',
        msg:  'Nenhuma pessoa detectada',
        sub:  'Posicione-se em frente à câmera em local bem iluminado',
        ready: false
      };
    }
    if (!cal.distanceOk) {
      return {
        icon: '↔️',
        msg:  'Ajuste a distância',
        sub:  'Afaste-se um pouco para que seu corpo inteiro apareça',
        ready: false
      };
    }
    return {
      icon: '✅',
      msg:  'Posição perfeita!',
      sub:  'Você está pronto para treinar',
      ready: true
    };
  }
}
