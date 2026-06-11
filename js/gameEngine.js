/**
 * gameEngine.js
 * Lógica principal do jogo:
 * - Spawning de luvas com posições e socos variados
 * - Detecção de acerto
 * - Progressão de dificuldade
 * - Pontuação e combos
 */

import { PUNCH_TYPES } from './poseDetector.js';

// ── Configuração de dificuldade ────────────────────────────
const LEVELS = [
  { level: 1, speed: 3500, maxMitts: 1, pointsNeeded: 0    },
  { level: 2, speed: 3000, maxMitts: 1, pointsNeeded: 200  },
  { level: 3, speed: 2500, maxMitts: 1, pointsNeeded: 500  },
  { level: 4, speed: 2000, maxMitts: 2, pointsNeeded: 900  },
  { level: 5, speed: 1700, maxMitts: 2, pointsNeeded: 1400 },
  { level: 6, speed: 1400, maxMitts: 2, pointsNeeded: 2000 },
  { level: 7, speed: 1200, maxMitts: 2, pointsNeeded: 2800 },
  { level: 8, speed: 1000, maxMitts: 3, pointsNeeded: 3800 },
];

const PUNCH_LIST = [
  PUNCH_TYPES.JAB,
  PUNCH_TYPES.DIRETO,
  PUNCH_TYPES.CRUZADO,
  PUNCH_TYPES.GANCHO,
  PUNCH_TYPES.UPPERCUT,
];

// Posições das luvas por TIPO DE SOCO
// Cada soco tem posições anatomicamente corretas para receber o golpe
const PUNCH_POSITIONS = {
  // JAB: mão da frente, luva no lado esquerdo (espelhado) na altura do rosto
  jab: [
    { x: 0.68, y: 0.28, label: 'jab-rosto-dir'   },
    { x: 0.62, y: 0.32, label: 'jab-rosto-dir2'  },
    { x: 0.72, y: 0.24, label: 'jab-cabeca-dir'  },
  ],
  // DIRETO: mão traseira, cruza para o lado direito (espelhado)
  direto: [
    { x: 0.32, y: 0.28, label: 'direto-rosto-esq'  },
    { x: 0.28, y: 0.32, label: 'direto-rosto-esq2' },
    { x: 0.36, y: 0.24, label: 'direto-cabeca-esq' },
  ],
  // CRUZADO: cruza o corpo, posição intermediária
  cruzado: [
    { x: 0.30, y: 0.30, label: 'cruzado-centro' },
    { x: 0.70, y: 0.30, label: 'cruzado-dir'    },
    { x: 0.50, y: 0.28, label: 'cruzado-alto'   },
  ],
  // GANCHO: lateral, cotovelo dobrado — posição na lateral da cabeça
  gancho: [
    { x: 0.18, y: 0.30, label: 'gancho-lat-esq' },
    { x: 0.82, y: 0.30, label: 'gancho-lat-dir' },
    { x: 0.16, y: 0.38, label: 'gancho-mand-esq'},
    { x: 0.84, y: 0.38, label: 'gancho-mand-dir'},
  ],
  // UPPERCUT: de baixo para cima — luva mais baixa no centro do corpo
  uppercut: [
    { x: 0.50, y: 0.55, label: 'upper-centro'   },
    { x: 0.42, y: 0.52, label: 'upper-esq'      },
    { x: 0.58, y: 0.52, label: 'upper-dir'      },
  ],
};

// Fallback genérico
const MITT_POSITIONS = [
  { x: 0.35, y: 0.32, label: 'esq-alto'    },
  { x: 0.65, y: 0.32, label: 'dir-alto'    },
  { x: 0.50, y: 0.35, label: 'centro-alto' },
];

export class GameEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.score = 0;
    this.hits  = 0;
    this.misses = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.currentLevel = 0;
    this.levelProgress = 0;

    this.mitts = [];
    this.effects = []; // efeitos visuais temporários
    this.lastMittSpawn = 0;
    this.spawnInterval = LEVELS[0].speed;

    this.punchCounts = {
      jab:      0,
      direto:   0,
      cruzado:  0,
      gancho:   0,
      uppercut: 0,
    };

    this.lastUsedPositions = [];
    this.isRunning = false;
    this.isPaused  = false;
    this.startTime = 0;
    this.elapsedTime = 0;
  }

  start(canvasW, canvasH) {
    this.canvasW = canvasW;
    this.canvasH = canvasH;
    this.isRunning = true;
    this.startTime = performance.now();
    this.spawnMitt(); // spawn imediato da primeira luva
  }

  pause()  { this.isPaused = true; }
  resume() { this.isPaused = false; }

  /**
   * Atualiza o estado do jogo — chamado a cada frame
   * @param {number} timestamp - performance.now()
   * @param {Object} punchResult - resultado do PoseDetector
   */
  update(timestamp, punchResult) {
    if (!this.isRunning || this.isPaused) return;

    this.elapsedTime = timestamp - this.startTime;

    // ── Verificar nível ────────────────────────────────────────
    this.updateLevel();

    // ── Spawn de novas luvas ───────────────────────────────────
    const levelConfig = LEVELS[this.currentLevel];
    if (
      timestamp - this.lastMittSpawn > this.spawnInterval &&
      this.mitts.filter(m => m.state === 'active' || m.state === 'flying').length < levelConfig.maxMitts
    ) {
      this.spawnMitt();
      this.lastMittSpawn = timestamp;
    }

    // ── Processar soco detectado ───────────────────────────────
    let hitInfo = null;
    if (punchResult && punchResult.punch && punchResult.punch.id !== 'none') {
      hitInfo = this.processPunch(punchResult.punch, timestamp);
    }

    // ── Atualizar luvas ────────────────────────────────────────
    this.updateMitts(timestamp);

    // ── Atualizar efeitos ──────────────────────────────────────
    this.updateEffects(timestamp);

    return hitInfo;
  }

  updateLevel() {
    const nextLevelIdx = this.currentLevel + 1;
    if (nextLevelIdx < LEVELS.length && this.score >= LEVELS[nextLevelIdx].pointsNeeded) {
      this.currentLevel = nextLevelIdx;
      this.spawnInterval = LEVELS[this.currentLevel].speed;
    }
  }

  getLevelProgress() {
    const current = LEVELS[this.currentLevel];
    const next    = LEVELS[Math.min(this.currentLevel + 1, LEVELS.length - 1)];
    if (current === next) return 1;
    const range = next.pointsNeeded - current.pointsNeeded;
    const progress = this.score - current.pointsNeeded;
    return Math.min(1, Math.max(0, progress / range));
  }

  spawnMitt() {
    const punchType = PUNCH_LIST[Math.floor(Math.random() * PUNCH_LIST.length)];
    const radius = 100;
    const totalTime  = LEVELS[this.currentLevel].speed * 1.1;
    const flyDuration = LEVELS[this.currentLevel].speed * 0.55;

    const cx = this.canvasW * 0.5;
    const faceY = this.canvasH * 0.34; // altura do rosto

    // Posição FINAL e ROTAÇÃO da luva por tipo de soco
    // Rotação: como um treinador seguraria a luva aparadora
    //  0       = luva reta (frente) → jab/direto lineares
    //  PI/2    = luva de lado (90°) → gancho horizontal
    // -PI*0.4  = luva inclinada para baixo → uppercut (recebe soco de baixo pra cima)
    //  PI*0.12 = leve inclinação → cruzado
    let targetX, targetY, mittRotation;

    switch (punchType.id) {
      case 'jab':
        // Mão da frente, levemente à direita — imagem frontal, leve inclinação
        targetX = cx + this.canvasW * 0.17;
        targetY = faceY;
        mittRotation = -0.08; // levíssima inclinação para direita
        break;
      case 'direto':
        // Mão traseira, levemente à esquerda
        targetX = cx - this.canvasW * 0.17;
        targetY = faceY;
        mittRotation = 0.08; // leve inclinação para esquerda
        break;
      case 'cruzado':
        // Cruza o centro, diagonal
        targetX = cx + (Math.random() > 0.5 ? 1 : -1) * this.canvasW * 0.08;
        targetY = faceY - this.canvasH * 0.06;
        mittRotation = Math.PI * 0.1; // inclinação de cruzado
        break;
      case 'gancho':
        // Lateral — a imagem hook já está de perfil (sem rotação extra)
        targetX = cx + (Math.random() > 0.5 ? 1 : -1) * this.canvasW * 0.36;
        targetY = faceY + this.canvasH * 0.02;
        mittRotation = 0; // imagem mitt_hook.png já está correta
        break;
      case 'uppercut':
        // Centro mais baixo — imagem uppercut já está com ângulo correto
        targetX = cx + (Math.random() - 0.5) * this.canvasW * 0.12;
        targetY = faceY + this.canvasH * 0.24;
        mittRotation = 0; // imagem mitt_uppercut.png já correta
        break;
      default:
        targetX = cx;
        targetY = faceY;
        mittRotation = 0;
    }

    const mitt = {
      id:           Math.random().toString(36).slice(2),
      punchType,
      startX:       cx,        // sempre do centro
      startY:       faceY,
      targetX,
      targetY,
      x:            cx,
      y:            faceY,
      radius,
      mittRotation, // rotação específica deste mitt
      state:        'flying',
      flyStart:     performance.now(),
      flyDuration,
      spawnTime:    performance.now(),
      totalTime,
      timeLeft:     totalTime,
      alpha:        1,
    };

    this.mitts.push(mitt);
  }

  updateMitts(timestamp) {
    for (let i = this.mitts.length - 1; i >= 0; i--) {
      const mitt = this.mitts[i];

      if (mitt.state === 'flying') {
        const elapsed = timestamp - mitt.flyStart;
        mitt.progress = Math.min(1, elapsed / mitt.flyDuration);
        
        // Easing out cubic
        const ease = 1 - Math.pow(1 - mitt.progress, 3);
        
        mitt.x = mitt.startX + (mitt.targetX - mitt.startX) * ease;
        mitt.y = mitt.startY + (mitt.targetY - mitt.startY) * ease;
        
        if (mitt.progress >= 1) {
          mitt.state = 'active';
          mitt.spawnTime = timestamp;
          mitt.x = mitt.targetX;
          mitt.y = mitt.targetY;
        }
      } else if (mitt.state === 'active') {
        mitt.timeLeft = mitt.totalTime - (timestamp - mitt.spawnTime);
        if (mitt.timeLeft <= 0) {
          // Tempo esgotado — miss
          mitt.state = 'miss';
          mitt.missStart = timestamp;
          this.registerMiss();
        }
      } else if (mitt.state === 'hit') {
        const elapsed = timestamp - mitt.hitStart;
        mitt.progress = Math.min(1, elapsed / 500);
        mitt.alpha = 1 - mitt.progress;
        if (mitt.progress >= 1) {
          this.mitts.splice(i, 1);
        }
      } else if (mitt.state === 'miss') {
        const elapsed = timestamp - mitt.missStart;
        mitt.alpha = Math.max(0, 1 - elapsed / 400);
        if (mitt.alpha <= 0) {
          this.mitts.splice(i, 1);
        }
      }
    }
  }

  updateEffects(timestamp) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const eff = this.effects[i];
      const elapsed = timestamp - eff.startTime;
      eff.progress = Math.min(1, elapsed / eff.duration);
      eff.alpha = 1 - eff.progress;
      if (eff.progress >= 1) {
        this.effects.splice(i, 1);
      }
    }
  }

  /**
   * Processa um soco detectado e verifica se acertou alguma luva
   */
  processPunch(punchType, timestamp) {
    // Contar o soco
    if (this.punchCounts[punchType.id] !== undefined) {
      this.punchCounts[punchType.id]++;
    }

    // Verificar se acertou alguma luva ativa
    let hit = false;
    let hitMitt = null;

    for (const mitt of this.mitts) {
      if (mitt.state !== 'active' && mitt.state !== 'flying') continue;
      
      // Permitimos acertar a luva nos últimos 20% do voo também
      if (mitt.state === 'flying' && mitt.progress < 0.8) continue;

      if (mitt.punchType.id === punchType.id) {
        // ACERTO!
        hit = true;
        hitMitt = mitt;
        mitt.state = 'hit';
        mitt.hitStart = timestamp;
        mitt.progress = 0;
        break;
      }
    }

    if (hit && hitMitt) {
      return this.registerHit(punchType, hitMitt, timestamp);
    } else {
      // Soco não acertou nenhuma luva do tipo correto
      // Não penalizamos por socos errados durante a tentativa
      return { type: 'miss_type', punchType };
    }
  }

  registerHit(punchType, mitt, timestamp) {
    this.hits++;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;

    // Calcular pontuação
    const timeBonus = Math.max(0, mitt.timeLeft / mitt.totalTime);
    const comboMult = 1 + Math.min(this.combo - 1, 9) * 0.1;
    const basePoints = 100;
    const points = Math.round(basePoints * (0.5 + timeBonus * 0.5) * comboMult);
    this.score += points;

    // Efeito visual
    this.effects.push({
      type: 'hit',
      x: mitt.x,
      y: mitt.y,
      color: punchType.color,
      startTime: timestamp,
      duration: 600,
      progress: 0,
      alpha: 1,
    });

    return {
      type: 'hit',
      punchType,
      points,
      combo: this.combo,
      mitt,
    };
  }

  registerMiss() {
    this.misses++;
    this.combo = 0;
  }

  getState() {
    return {
      score:        this.score,
      hits:         this.hits,
      misses:       this.misses,
      combo:        this.combo,
      maxCombo:     this.maxCombo,
      level:        LEVELS[this.currentLevel].level,
      levelProgress: this.getLevelProgress(),
      punchCounts:  this.punchCounts,
      mitts:        this.mitts,
      effects:      this.effects,
    };
  }

  getResults() {
    return {
      score:       this.score,
      hits:        this.hits,
      misses:      this.misses,
      maxCombo:    this.maxCombo,
      level:       LEVELS[this.currentLevel].level,
      punchCounts: this.punchCounts,
      elapsedTime: this.elapsedTime,
    };
  }
}
