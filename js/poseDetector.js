/**
 * poseDetector.js
 * Analisa os landmarks do MediaPipe Pose para:
 * 1. Verificar distância/posicionamento do usuário
 * 2. Reconhecer os 5 tipos de socos
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

export class PoseDetector {
  constructor() {
    // Histórico de posições dos pulsos (buffer circular)
    this.wristHistory = {
      left:  [],
      right: []
    };
    this.historyMaxLen = 8;

    // Cooldown entre detecções (independente por braço)
    this.lastPunchTimeLeft = 0;
    this.lastPunchTimeRight = 0;
    this.punchCooldown = 350; // ms

    // Último soco detectado
    this.lastPunch = PUNCH_TYPES.NONE;

    // Estado de calibração
    this.calibration = {
      poseDetected: false,
      distanceOk: false,
      lightOk: true, // assumimos OK por padrão
    };

    // Dimensões do canvas para normalização
    this.canvasW = 640;
    this.canvasH = 480;
  }

  setCanvasDimensions(w, h) {
    this.canvasW = w;
    this.canvasH = h;
  }

  /**
   * Analisa os resultados do MediaPipe Pose
   * Retorna { calibration, punch, landmarks }
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

    // ── Verificar visibilidade de pontos-chave ─────────────────
    const keyPoints = [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_ELBOW, LM.RIGHT_ELBOW, LM.LEFT_WRIST, LM.RIGHT_WRIST];
    const allVisible = keyPoints.every(idx => lm[idx] && lm[idx].visibility > 0.4);
    this.calibration.poseDetected = allVisible;
    output.calibration.poseDetected = allVisible;

    if (!allVisible) return output;

    // ── Verificar distância ────────────────────────────────────
    const shoulderWidth = Math.abs(lm[LM.LEFT_SHOULDER].x - lm[LM.RIGHT_SHOULDER].x);
    // Largura ideal dos ombros: entre 25% e 45% da largura do frame
    const distanceOk = shoulderWidth >= 0.22 && shoulderWidth <= 0.5;
    this.calibration.distanceOk = distanceOk;
    output.calibration.distanceOk = distanceOk;

    // ── Calcular métricas de referência ────────────────────────
    const midShoulderX = (lm[LM.LEFT_SHOULDER].x + lm[LM.RIGHT_SHOULDER].x) / 2;
    const midShoulderY = (lm[LM.LEFT_SHOULDER].y + lm[LM.RIGHT_SHOULDER].y) / 2;

    // ── Atualizar histórico de pulsos ──────────────────────────
    const now = performance.now();

    this.updateWristHistory('left',  lm[LM.LEFT_WRIST],  now);
    this.updateWristHistory('right', lm[LM.RIGHT_WRIST], now);

    // ── Detecção de soco ───────────────────────────────────────
    // Detectamos separadamente para esquerda e direita para permitir combos rápidos
    let bestPunch = PUNCH_TYPES.NONE;
    let bestSpeed = 0;
    let usedSide = null;

    if (now - this.lastPunchTimeLeft > this.punchCooldown) {
      const leftPunch = this.detectPunchSide('left', lm, midShoulderX, midShoulderY, shoulderWidth);
      if (leftPunch.punch.id !== 'none' && leftPunch.speed > bestSpeed) {
        bestPunch = leftPunch.punch;
        bestSpeed = leftPunch.speed;
        usedSide = 'left';
      }
    }

    if (now - this.lastPunchTimeRight > this.punchCooldown) {
      const rightPunch = this.detectPunchSide('right', lm, midShoulderX, midShoulderY, shoulderWidth);
      if (rightPunch.punch.id !== 'none' && rightPunch.speed > bestSpeed) {
        bestPunch = rightPunch.punch;
        bestSpeed = rightPunch.speed;
        usedSide = 'right';
      }
    }

    if (bestPunch.id !== 'none') {
      this.lastPunch = bestPunch;
      if (usedSide === 'left') this.lastPunchTimeLeft = now;
      if (usedSide === 'right') this.lastPunchTimeRight = now;
      
      output.punch = bestPunch;
      output.wristVelocity = this.getWristVelocities();
    }

    return output;
  }

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

  /**
   * Detecta o soco para um lado específico (esquerda ou direita)
   */
  detectPunchSide(side, lm, midShoulderX, midShoulderY, shoulderWidth) {
    const history = this.wristHistory[side];
    if (history.length < 4) return { punch: PUNCH_TYPES.NONE, speed: 0 };

    const useLeft = (side === 'left');
    const vec = this.getMovementVector(history);
    const speed = Math.sqrt(vec.dx * vec.dx + vec.dy * vec.dy);

    const MIN_SPEED = 0.04;
    if (speed < MIN_SPEED) return { punch: PUNCH_TYPES.NONE, speed: 0 };

    const elbowIdx = useLeft ? LM.LEFT_ELBOW : LM.RIGHT_ELBOW;
    const wristIdx = useLeft ? LM.LEFT_WRIST : LM.RIGHT_WRIST;
    const shoulderIdx = useLeft ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER;

    const elbow = lm[elbowIdx];
    const wrist = lm[wristIdx];
    const shoulder = lm[shoulderIdx];

    const elbowAngle = this.calcElbowAngle(lm, useLeft);

    // Identificar braço da frente (jab) e braço de trás (direto)
    // Usamos a profundidade (z) do ombro se disponível, senão assumimos 
    // posição ortodoxa: esquerdo na frente, direito atrás.
    let isFrontArm = useLeft; // default ortodoxo
    if (lm[LM.LEFT_SHOULDER].z !== undefined && lm[LM.RIGHT_SHOULDER].z !== undefined) {
       // z menor = mais próximo da câmera
       if (useLeft && lm[LM.LEFT_SHOULDER].z < lm[LM.RIGHT_SHOULDER].z) isFrontArm = true;
       else if (!useLeft && lm[LM.RIGHT_SHOULDER].z < lm[LM.LEFT_SHOULDER].z) isFrontArm = true;
       else isFrontArm = false;
    }

    // UPPERCUT: movimento ascendente, pulso próximo ou acima do nível do ombro no final
    if (vec.dy < -0.05 && Math.abs(vec.dy) > Math.abs(vec.dx) * 0.8 && wrist.y < shoulder.y + 0.1) {
      return { punch: PUNCH_TYPES.UPPERCUT, speed };
    }

    // GANCHO: movimento lateral pronunciado, cotovelo dobrado
    if (elbowAngle < 130 && Math.abs(vec.dx) > 0.03 && Math.abs(vec.dx) >= Math.abs(vec.dy)) {
      return { punch: PUNCH_TYPES.GANCHO, speed };
    }

    // CRUZADO: cruza a linha central
    const centerX = midShoulderX;
    const wristCurrent = history[history.length - 1];
    const wristOld     = history[Math.max(0, history.length - 5)];
    const crossedCenter = useLeft
      ? (wristOld.x > centerX && wristCurrent.x < centerX)
      : (wristOld.x < centerX && wristCurrent.x > centerX);

    if (crossedCenter && elbowAngle > 100) {
      return { punch: PUNCH_TYPES.CRUZADO, speed };
    }

    // JAB / DIRETO: linear para frente
    if (elbowAngle > 120 && Math.abs(vec.dx) < 0.08) {
      if (isFrontArm) {
         return { punch: PUNCH_TYPES.JAB, speed };
      } else {
         return { punch: PUNCH_TYPES.DIRETO, speed };
      }
    }

    // Fallback genérico para socos retos
    if (speed > 0.06) {
       return { punch: (isFrontArm ? PUNCH_TYPES.JAB : PUNCH_TYPES.DIRETO), speed };
    }

    return { punch: PUNCH_TYPES.NONE, speed: 0 };
  }

  getMovementVector(history) {
    if (history.length < 3) return { dx: 0, dy: 0 };
    const len = history.length;
    // Usar diferença entre os últimos e os anteriores
    const recent = history[len - 1];
    const old    = history[Math.max(0, len - 4)];
    return {
      dx: recent.x - old.x,
      dy: recent.y - old.y,
    };
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

    const dot = v1.x * v2.x + v1.y * v2.y;
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
        msg: 'Nenhuma pessoa detectada',
        sub: 'Posicione-se em frente à câmera em local bem iluminado',
        ready: false
      };
    }
    if (!cal.distanceOk) {
      // Precisamos ver a largura dos ombros para determinar próximo/longe
      return {
        icon: '↔️',
        msg: 'Ajuste a distância',
        sub: 'Afaste-se um pouco para que seu corpo inteiro apareça',
        ready: false
      };
    }
    return {
      icon: '✅',
      msg: 'Posição perfeita!',
      sub: 'Você está pronto para treinar',
      ready: true
    };
  }
}
