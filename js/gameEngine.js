/**
 * gameEngine.js
 * Lógica principal do jogo para modo Solo e modo Dupla:
 * - Spawning contínuo e independente de luvas para 1 ou 2 jogadores
 * - Detecção de acertos individuais por jogador
 * - Progressão de dificuldade e pontuações separadas
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

export class GameEngine {
  constructor(mode = 'solo') {
    this.mode = mode;
    this.reset();
  }

  setMode(mode) {
    this.mode = mode;
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

    // Estado do Jogador 1 (Modo Dupla)
    this.p1 = {
      score: 0,
      hits: 0,
      misses: 0,
      combo: 0,
      maxCombo: 0,
      punchCounts: { jab: 0, direto: 0, cruzado: 0, gancho: 0, uppercut: 0 }
    };

    // Estado do Jogador 2 (Modo Dupla)
    this.p2 = {
      score: 0,
      hits: 0,
      misses: 0,
      combo: 0,
      maxCombo: 0,
      punchCounts: { jab: 0, direto: 0, cruzado: 0, gancho: 0, uppercut: 0 }
    };

    this.mitts = [];
    this.effects = [];
    this.lastMittSpawn = 0;
    this.lastMittSpawnP1 = 0;
    this.lastMittSpawnP2 = 0;
    this.spawnInterval = LEVELS[0].speed;

    this.punchCounts = {
      jab:      0,
      direto:   0,
      cruzado:  0,
      gancho:   0,
      uppercut: 0,
    };

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

    if (this.mode === 'solo') {
      this.spawnMitt(1);
    } else {
      this.spawnMitt(1);
      this.spawnMitt(2);
    }
  }

  pause()  { this.isPaused = true; }
  resume() { this.isPaused = false; }

  /**
   * Atualiza o estado do jogo — chamado a cada frame
   */
  update(timestamp, punchResultP1, punchResultP2 = null) {
    if (!this.isRunning || this.isPaused) return;

    this.elapsedTime = timestamp - this.startTime;

    if (this.mode === 'solo') {
      this.updateLevel();

      const levelConfig = LEVELS[this.currentLevel];
      if (
        timestamp - this.lastMittSpawn > this.spawnInterval &&
        this.mitts.filter(m => m.state === 'active' || m.state === 'flying').length < levelConfig.maxMitts
      ) {
        this.spawnMitt(1);
        this.lastMittSpawn = timestamp;
      }

      let hitInfo = null;
      if (punchResultP1 && punchResultP1.punch && punchResultP1.punch.id !== 'none') {
        hitInfo = this.processPunch(punchResultP1.punch, timestamp, 1);
      }

      this.updateMitts(timestamp);
      this.updateEffects(timestamp);
      return { p1Hit: hitInfo };
    } else {
      // ── MODO DUPLA ──────────────────────────────────────────
      // Spawn independente e contínuo para cada jogador
      const interval = 2200; // velocidade estável para duelo

      const p1MittsCount = this.mitts.filter(m => m.playerId === 1 && (m.state === 'active' || m.state === 'flying')).length;
      if (timestamp - this.lastMittSpawnP1 > interval && p1MittsCount < 1) {
        this.spawnMitt(1);
        this.lastMittSpawnP1 = timestamp;
      }

      const p2MittsCount = this.mitts.filter(m => m.playerId === 2 && (m.state === 'active' || m.state === 'flying')).length;
      if (timestamp - this.lastMittSpawnP2 > interval && p2MittsCount < 1) {
        this.spawnMitt(2);
        this.lastMittSpawnP2 = timestamp;
      }

      let p1Hit = null;
      if (punchResultP1 && punchResultP1.punch && punchResultP1.punch.id !== 'none') {
        p1Hit = this.processPunch(punchResultP1.punch, timestamp, 1);
      }

      let p2Hit = null;
      if (punchResultP2 && punchResultP2.punch && punchResultP2.punch.id !== 'none') {
        p2Hit = this.processPunch(punchResultP2.punch, timestamp, 2);
      }

      this.updateMitts(timestamp);
      this.updateEffects(timestamp);

      return { p1Hit, p2Hit };
    }
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

  spawnMitt(playerId = 1) {
    const punchType = PUNCH_LIST[Math.floor(Math.random() * PUNCH_LIST.length)];
    const isDuo = (this.mode === 'dupla');
    const radius = isDuo ? 75 : 100;
    const speed  = isDuo ? 2400 : LEVELS[this.currentLevel].speed;
    const totalTime   = speed * 1.1;
    const flyDuration = speed * 0.55;

    let cx, faceY, widthFactor;

    if (!isDuo) {
      cx = this.canvasW * 0.5;
      faceY = this.canvasH * 0.34;
      widthFactor = this.canvasW;
    } else if (playerId === 1) {
      cx = this.canvasW * 0.25;
      faceY = this.canvasH * 0.34;
      widthFactor = this.canvasW * 0.5;
    } else {
      cx = this.canvasW * 0.75;
      faceY = this.canvasH * 0.34;
      widthFactor = this.canvasW * 0.5;
    }

    let targetX, targetY, mittRotation;

    switch (punchType.id) {
      case 'jab':
        targetX = cx + widthFactor * 0.17;
        targetY = faceY;
        mittRotation = -0.08;
        break;
      case 'direto':
        targetX = cx - widthFactor * 0.17;
        targetY = faceY;
        mittRotation = 0.08;
        break;
      case 'cruzado':
        targetX = cx + (Math.random() > 0.5 ? 1 : -1) * widthFactor * 0.08;
        targetY = faceY - this.canvasH * 0.06;
        mittRotation = Math.PI * 0.1;
        break;
      case 'gancho':
        targetX = cx + (Math.random() > 0.5 ? 1 : -1) * widthFactor * 0.30;
        targetY = faceY + this.canvasH * 0.02;
        mittRotation = 0;
        break;
      case 'uppercut':
        targetX = cx + (Math.random() - 0.5) * widthFactor * 0.12;
        targetY = faceY + this.canvasH * 0.24;
        mittRotation = 0;
        break;
      default:
        targetX = cx;
        targetY = faceY;
        mittRotation = 0;
    }

    const mitt = {
      id: Math.random().toString(36).slice(2),
      playerId,
      punchType,
      startX: cx,
      startY: faceY,
      targetX,
      targetY,
      x: cx,
      y: faceY,
      radius,
      mittRotation,
      state: 'flying',
      flyStart: performance.now(),
      flyDuration,
      spawnTime: performance.now(),
      totalTime,
      timeLeft: totalTime,
      alpha: 1,
    };

    this.mitts.push(mitt);
  }

  updateMitts(timestamp) {
    for (let i = this.mitts.length - 1; i >= 0; i--) {
      const mitt = this.mitts[i];

      if (mitt.state === 'flying') {
        const elapsed = timestamp - mitt.flyStart;
        mitt.progress = Math.min(1, elapsed / mitt.flyDuration);
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
          mitt.state = 'miss';
          mitt.missStart = timestamp;
          this.registerMiss(mitt.playerId || 1);
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

  processPunch(punchType, timestamp, playerId = 1) {
    // Incrementa estatística do jogador
    if (this.mode === 'solo') {
      if (this.punchCounts[punchType.id] !== undefined) this.punchCounts[punchType.id]++;
    } else {
      const playerObj = playerId === 1 ? this.p1 : this.p2;
      if (playerObj.punchCounts[punchType.id] !== undefined) playerObj.punchCounts[punchType.id]++;
    }

    let hit = false;
    let hitMitt = null;

    for (const mitt of this.mitts) {
      if (mitt.state !== 'active' && mitt.state !== 'flying') continue;
      if (mitt.state === 'flying' && mitt.progress < 0.8) continue;
      
      // No modo dupla, testar apenas contra os aparadores do próprio jogador
      if (this.mode === 'dupla' && mitt.playerId !== playerId) continue;

      if (mitt.punchType.id === punchType.id) {
        hit = true;
        hitMitt = mitt;
        mitt.state = 'hit';
        mitt.hitStart = timestamp;
        mitt.progress = 0;
        break;
      }
    }

    if (hit && hitMitt) {
      return this.registerHit(punchType, hitMitt, timestamp, playerId);
    } else {
      return { type: 'miss_type', punchType, playerId };
    }
  }

  registerHit(punchType, mitt, timestamp, playerId = 1) {
    if (this.mode === 'solo') {
      this.hits++;
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;

      const timeBonus = Math.max(0, mitt.timeLeft / mitt.totalTime);
      const comboMult = 1 + Math.min(this.combo - 1, 9) * 0.1;
      const points = Math.round(100 * (0.5 + timeBonus * 0.5) * comboMult);
      this.score += points;

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

      return { type: 'hit', punchType, points, combo: this.combo, mitt, playerId };
    } else {
      // DUPLA
      const p = playerId === 1 ? this.p1 : this.p2;
      p.hits++;
      p.combo++;
      if (p.combo > p.maxCombo) p.maxCombo = p.combo;

      const timeBonus = Math.max(0, mitt.timeLeft / mitt.totalTime);
      const comboMult = 1 + Math.min(p.combo - 1, 9) * 0.1;
      const points = Math.round(100 * (0.5 + timeBonus * 0.5) * comboMult);
      p.score += points;

      this.effects.push({
        type: 'hit',
        x: mitt.x,
        y: mitt.y,
        color: playerId === 1 ? '#00d4ff' : '#ffd60a',
        startTime: timestamp,
        duration: 600,
        progress: 0,
        alpha: 1,
      });

      return { type: 'hit', punchType, points, combo: p.combo, mitt, playerId };
    }
  }

  registerMiss(playerId = 1) {
    if (this.mode === 'solo') {
      this.misses++;
      this.combo = 0;
    } else {
      const p = playerId === 1 ? this.p1 : this.p2;
      p.misses++;
      p.combo = 0;
    }
  }

  getState() {
    if (this.mode === 'solo') {
      return {
        mode: 'solo',
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
    } else {
      return {
        mode: 'dupla',
        p1: { ...this.p1 },
        p2: { ...this.p2 },
        mitts: this.mitts,
        effects: this.effects,
      };
    }
  }

  getResults() {
    if (this.mode === 'solo') {
      return {
        mode: 'solo',
        score:       this.score,
        hits:        this.hits,
        misses:      this.misses,
        maxCombo:    this.maxCombo,
        level:       LEVELS[this.currentLevel].level,
        punchCounts: this.punchCounts,
        elapsedTime: this.elapsedTime,
      };
    } else {
      const p1IsWinner = this.p1.score > this.p2.score;
      const isTie = this.p1.score === this.p2.score;

      const winner = isTie ? { name: 'JOGADOR 1 & JOGADOR 2 (EMPATE)', ...this.p1 }
                           : (p1IsWinner ? { name: 'JOGADOR 1 (Esq)', ...this.p1 } : { name: 'JOGADOR 2 (Dir)', ...this.p2 });

      const loser  = isTie ? { name: 'JOGADOR 2 (Empate)', ...this.p2 }
                           : (p1IsWinner ? { name: 'JOGADOR 2 (Dir)', ...this.p2 } : { name: 'JOGADOR 1 (Esq)', ...this.p1 });

      return {
        mode: 'dupla',
        isTie,
        winner,
        loser,
        p1: { name: 'JOGADOR 1', ...this.p1 },
        p2: { name: 'JOGADOR 2', ...this.p2 },
        elapsedTime: this.elapsedTime
      };
    }
  }
}

