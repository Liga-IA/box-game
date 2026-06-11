/**
 * main.js
 * Entry point — controla as fases do jogo e integra todos os módulos
 */

import { CameraManager }  from './camera.js';
import { PoseDetector, PUNCH_TYPES, PUNCH_INFO } from './poseDetector.js';
import { Renderer }       from './renderer.js';
import { GameEngine }     from './gameEngine.js';

// ══════════════════════════════════════════════════════════
class KickTrainer {
  constructor() {
    // ── Módulos ────────────────────────────────────────────
    this.camera       = new CameraManager();
    this.detector     = new PoseDetector();
    this.engine       = new GameEngine();

    // ── Estado ────────────────────────────────────────────
    this.phase        = 'intro';    // intro | calibration | tutorial | game | gameover
    this.tutorialIdx  = 0;
    this.tutorialPunchConfirmed = [false, false, false, false, false];

    // ── Refs DOM ───────────────────────────────────────────
    this.screens = {
      intro:       document.getElementById('screen-intro'),
      calibration: document.getElementById('screen-calibration'),
      tutorial:    document.getElementById('screen-tutorial'),
      game:        document.getElementById('screen-game'),
      gameover:    document.getElementById('screen-gameover'),
    };

    // ── Canvas e renderers ─────────────────────────────────
    this.calibCanvas = document.getElementById('canvas-pose');
    this.tutCanvas   = document.getElementById('canvas-tutorial');
    this.gameCanvas  = document.getElementById('canvas-game-main');

    this.calibRenderer = null;
    this.tutRenderer   = null;
    this.gameRenderer  = null;

    // ── Vídeos ────────────────────────────────────────────
    this.calibVideo  = document.getElementById('video-feed');
    this.gameVideo   = document.getElementById('video-feed-game');

    // ── Estado de jogo ─────────────────────────────────────
    this.lastPoseResults = null;
    this.flashColor  = '#ffffff';
    this.flashAlpha  = 0;
    this.punchDisplayAlpha = 0;
    this.punchDisplayType  = PUNCH_TYPES.NONE;
    this.punchDisplayTimer = 0;
    this.lastHitInfo = null;
    this.animFrame   = null;

    // ── Calibração ────────────────────────────────────────
    this.calibReady  = false;
    this.calibReadyTimer = 0;

    // ── Timer do jogo ─────────────────────────────────────
    this.gameTimerMax = 90; // segundos
    this.gameTimerStart = 0;

    // ── Bindings ──────────────────────────────────────────
    this.onPoseResults = this.onPoseResults.bind(this);
    this.gameLoop      = this.gameLoop.bind(this);
    this.calibLoop     = this.calibLoop.bind(this);
    this.tutorialLoop  = this.tutorialLoop.bind(this);

    window.addEventListener('resize', () => this.handleResize());
  }

  // ── SCREEN MANAGEMENT ─────────────────────────────────────
  showScreen(name) {
    Object.entries(this.screens).forEach(([key, el]) => {
      if (el) el.classList.toggle('active', key === name);
    });
    this.phase = name;
  }

  // ══════════════════════════════════════════════════════════
  // FASE 1 — CALIBRAÇÃO
  // ══════════════════════════════════════════════════════════
  async startSetup() {
    this.showScreen('calibration');

    // Inicializar canvas de calibração
    this.calibRenderer = new Renderer(this.calibCanvas);
    this.handleResize();

    try {
      await this.camera.initialize(this.calibVideo, this.onPoseResults);
      this.calibReadyTimer = 0;
      this.calibLoop();
    } catch (err) {
      console.error('[KickTrainer] Erro ao acessar câmera:', err);
      this.showToast('❌ Não foi possível acessar a câmera. Verifique as permissões.', 'error');
      this.showScreen('intro');
    }
  }

  calibLoop() {
    if (this.phase !== 'calibration') return;
    this.updateCalibHUD();
    this.animFrame = requestAnimationFrame(this.calibLoop);
  }

  updateCalibHUD() {
    if (!this.lastPoseResults) return;

    const results = this.detector.analyze(this.lastPoseResults);
    const feedback = this.detector.getCalibrationFeedback();
    const cal = results.calibration;

    // Atualizar ícone e mensagem
    const icon = document.getElementById('calib-icon');
    const msg  = document.getElementById('calib-msg');
    const sub  = document.getElementById('calib-submsg');
    if (icon) icon.textContent = feedback.icon;
    if (msg)  msg.textContent  = feedback.msg;
    if (sub)  sub.textContent  = feedback.sub;

    // Checklist
    this.setCheckItem('check-pose',     cal.poseDetected);
    this.setCheckItem('check-distance', cal.poseDetected && cal.distanceOk);
    this.setCheckItem('check-light',    true);

    // Renderizar esqueleto
    if (this.calibRenderer && this.lastPoseResults) {
      this.calibRenderer.resize();
      this.calibRenderer.clear();
      this.calibRenderer.drawSkeleton(results.landmarks);
    }

    // Mostrar botão de iniciando e começar após ~2s
    const btn = document.getElementById('btn-proceed-game');
    if (feedback.ready) {
      this.calibReadyTimer++;
      if (this.calibReadyTimer > 30 && btn) { 
        btn.classList.remove('hidden');
      }
      if (this.calibReadyTimer > 90) { // ~3 segundos (30fps)
        this.startGame();
      }
    } else {
      this.calibReadyTimer = 0;
      if (btn) btn.classList.add('hidden');
    }
  }

  setCheckItem(id, ok) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('ok', ok);
    const dot = el.querySelector('.check-dot');
    if (dot) dot.textContent = ok ? '✓' : '';
  }

  // ══════════════════════════════════════════════════════════
  // FASE 2 — TUTORIAL
  // ══════════════════════════════════════════════════════════
  startTutorial() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.showScreen('tutorial');

    // Usar o mesmo feed de câmera no canvas do tutorial
    this.tutRenderer = new Renderer(this.tutCanvas);
    this.tutCanvas.style.transform = 'scaleX(-1)';
    this.handleResize();

    this.tutorialIdx = 0;
    this.tutorialPunchConfirmed = [false, false, false, false, false];
    this.updateTutorialDisplay();
    this.tutorialLoop();
  }

  tutorialLoop() {
    if (this.phase !== 'tutorial') return;

    if (this.tutRenderer && this.calibVideo && this.calibVideo.readyState >= 2) {
      const ctx = this.tutCanvas.getContext('2d');
      const W = this.tutCanvas.width;
      const H = this.tutCanvas.height;
      // Desenhar frame do vídeo (não espelhado pois o canvas já tem transform)
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(this.calibVideo, -W, 0, W, H);
      ctx.restore();
      // Overlay escuro semitransparente
      ctx.fillStyle = 'rgba(8,8,15,0.35)';
      ctx.fillRect(0, 0, W, H);
    }

    if (this.lastPoseResults) {
      const results = this.detector.analyze(this.lastPoseResults);

      // Renderizar esqueleto
      if (this.tutRenderer) {
        this.tutRenderer.drawSkeleton(results.landmarks, results.punch);
      }

      // Verificar se o soco atual foi executado
      const currentPunch = PUNCH_INFO[this.tutorialIdx].type;
      if (results.punch && results.punch.id === currentPunch.id) {
        this.onTutorialPunchDetected(results.punch);
      }
    }

    this.animFrame = requestAnimationFrame(this.tutorialLoop);
  }

  onTutorialPunchDetected(punchType) {
    if (!this.tutorialPunchConfirmed[this.tutorialIdx]) {
      this.tutorialPunchConfirmed[this.tutorialIdx] = true;

      const ring = document.getElementById('detect-ring');
      const label = document.getElementById('detect-label');
      if (ring) {
        ring.classList.add('detected');
        ring.textContent = '✓';
      }
      if (label) {
        label.textContent = `${punchType.name} detectado! Excelente! 🎉`;
        label.style.color = '#2dc653';
      }

      this.showToast(`✅ ${punchType.name} reconhecido!`);

      // Auto-avançar após 1.5s
      setTimeout(() => {
        if (this.phase === 'tutorial' && this.tutorialPunchConfirmed[this.tutorialIdx]) {
          if (this.tutorialIdx < PUNCH_INFO.length - 1) {
            this.nextPunch();
          }
        }
      }, 1500);
    }
  }

  updateTutorialDisplay() {
    const info = PUNCH_INFO[this.tutorialIdx];
    const total = PUNCH_INFO.length;

    // Atualizar barra de progresso
    const bar = document.getElementById('tutorial-bar');
    if (bar) bar.style.width = `${((this.tutorialIdx + 1) / total) * 100}%`;

    // Atualizar exibição do soco
    const emoji = document.getElementById('punch-emoji');
    const name  = document.getElementById('punch-name');
    const desc  = document.getElementById('punch-desc');
    const tip   = document.getElementById('punch-tip');
    if (emoji) emoji.textContent = info.emoji;
    if (name)  name.textContent  = info.type.name;
    if (desc)  desc.textContent  = info.desc;
    if (tip)   tip.textContent   = info.tip;

    // Cor do nome
    if (name) name.style.color = info.type.color;

    // Reset detector
    const ring  = document.getElementById('detect-ring');
    const label = document.getElementById('detect-label');
    if (ring) {
      ring.classList.remove('detected');
      ring.textContent = '';
    }
    if (label) {
      label.textContent = `Execute um ${info.type.name} para confirmar`;
      label.style.color = '';
    }

    // Dots
    document.querySelectorAll('.punch-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i === this.tutorialIdx);
    });

    // Botões nav
    const btnPrev = document.getElementById('btn-prev-punch');
    const btnNext = document.getElementById('btn-next-punch');
    const btnPlay = document.getElementById('btn-play');

    if (btnPrev) btnPrev.disabled = (this.tutorialIdx === 0);

    const isLast = this.tutorialIdx === PUNCH_INFO.length - 1;
    if (btnNext) btnNext.style.display = isLast ? 'none' : '';
    if (btnPlay) btnPlay.classList.toggle('hidden', !isLast);
  }

  nextPunch() {
    if (this.tutorialIdx < PUNCH_INFO.length - 1) {
      this.tutorialIdx++;
      this.updateTutorialDisplay();
    }
  }

  prevPunch() {
    if (this.tutorialIdx > 0) {
      this.tutorialIdx--;
      this.updateTutorialDisplay();
    }
  }

  // ══════════════════════════════════════════════════════════
  // FASE 3 — JOGO
  // ══════════════════════════════════════════════════════════
  startGame() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.showScreen('game');

    // Inicializar renderer do jogo
    this.gameRenderer = new Renderer(this.gameCanvas);
    
    // Configurar canvas da mini câmera do jogador
    this.playerCamCanvas = document.getElementById('canvas-player-cam');
    
    this.handleResize();

    // Reset timer
    this.gameTimerStart = 0;

    // Iniciar engine
    this.engine.reset();
    this.engine.start(this.gameCanvas.offsetWidth, this.gameCanvas.offsetHeight);

    // Reset HUD
    this.updateGameHUD(this.engine.getState());

    // Iniciar game loop
    this.gameLoop();
  }

  gameLoop(timestamp = performance.now()) {
    if (this.phase !== 'game') return;
    if (this.engine.isPaused) {
      this.animFrame = requestAnimationFrame(this.gameLoop);
      return;
    }

    // ── Timer do jogo ─────────────────────────────────────────
    if (this.gameTimerStart === 0) this.gameTimerStart = timestamp;
    const elapsed = (timestamp - this.gameTimerStart) / 1000;
    const timeLeft = Math.max(0, this.gameTimerMax - elapsed);
    this.updateTimer(timeLeft);
    if (timeLeft <= 0) {
      this.endGame();
      return;
    }

    // ── Renderizar cenário de arena ────────────────────────────
    if (this.gameRenderer) {
      this.gameRenderer.drawArenaBackground(timestamp);
    }

    // ── Analisar pose e atualizar mini-câmera ──────────────────
    let punchResult = null;
    
    if (this.calibVideo && this.calibVideo.readyState >= 2 && this.playerCamCanvas) {
      const pCtx = this.playerCamCanvas.getContext('2d');
      const pW = this.playerCamCanvas.width;
      const pH = this.playerCamCanvas.height;
      
      // Desenhar frame do vídeo (espelhado via CSS, então desenhamos normal ou espelhado?)
      // O canvas já tem scaleX(-1) no CSS, então desenhamos normal aqui
      pCtx.drawImage(this.calibVideo, 0, 0, pW, pH);
      
      // Overlay escuro
      pCtx.fillStyle = 'rgba(0,0,0,0.3)';
      pCtx.fillRect(0, 0, pW, pH);
      
      if (this.lastPoseResults) {
        const results = this.detector.analyze(this.lastPoseResults);
        punchResult = results;

        // Renderizar esqueleto na mini câmera
        // O renderer atual usa o width/height do canvas para escalar.
        // Vamos temporariamente apontar o ctx do renderer para o playerCamCanvas
        const oldCtx = this.gameRenderer.ctx;
        const oldCanvas = this.gameRenderer.canvas;
        this.gameRenderer.ctx = pCtx;
        this.gameRenderer.canvas = this.playerCamCanvas;
        
        this.gameRenderer.drawSkeleton(results.landmarks, results.punch);
        
        // Restaurar
        this.gameRenderer.ctx = oldCtx;
        this.gameRenderer.canvas = oldCanvas;

        // Mostrar feedback de soco no HUD
        if (results.punch && results.punch.id !== 'none') {
          this.showPunchFeedback(results.punch);
        }
      }
    }

    // ── Atualizar engine ───────────────────────────────────────
    const hitInfo = this.engine.update(timestamp, punchResult);
    const state   = this.engine.getState();

    // ── Processar hit ──────────────────────────────────────────
    if (hitInfo && hitInfo.type === 'hit') {
      this.onHit(hitInfo, state);
    }

    // ── Renderizar luvas e efeitos ─────────────────────────────
    if (this.gameRenderer) {
      // Luvas
      for (const mitt of state.mitts) {
        this.gameRenderer.drawMitt(mitt);
      }
      // Nome do soco em LETRAS GIGANTES no centro-topo
      const activeMitt = state.mitts.find(m => m.state === 'active' || m.state === 'flying');
      if (activeMitt) {
        this.gameRenderer.drawBigPunchLabel(
          activeMitt.punchType,
          this.gameCanvas.width,
          this.gameCanvas.height
        );
      }
      // Efeitos
      for (const eff of state.effects) {
        this.gameRenderer.drawImpact(
          this.gameRenderer.ctx, eff.x, eff.y, eff.progress, eff.color
        );
      }
      // Flash de tela
      if (this.flashAlpha > 0) {
        this.gameRenderer.drawHitFlash(this.flashColor, this.flashAlpha);
        this.flashAlpha = Math.max(0, this.flashAlpha - 0.05);
      }
    }

    // ── Atualizar HUD ──────────────────────────────────────────
    this.updateGameHUD(state);

    this.animFrame = requestAnimationFrame(this.gameLoop);
  }

  onHit(hitInfo, state) {
    // Flash de tela
    this.flashColor = hitInfo.punchType.color;
    this.flashAlpha = 0.6;

    // Vibração (se suportado)
    if (navigator.vibrate) navigator.vibrate([50]);
  }

  showPunchFeedback(punchType) {
    const el = document.getElementById('hud-punch-type');
    if (!el) return;
    el.textContent = `${punchType.emoji} ${punchType.name}`;
    el.style.color = punchType.color;
    el.classList.remove('flash');
    void el.offsetWidth; // trigger reflow
    el.classList.add('flash');

    const detected = document.getElementById('hud-punch-detected');
    if (detected) {
      detected.textContent = punchType.name;
      detected.style.color = punchType.color;
    }
  }

  updateTimer(timeLeft) {
    const el = document.getElementById('hud-timer');
    if (el) {
      const m = Math.floor(timeLeft / 60);
      const s = Math.floor(timeLeft % 60);
      el.textContent = `${m}:${s.toString().padStart(2,'0')}`;
      el.style.color = timeLeft < 15 ? '#e63946' : '#ffd60a';
    }
  }

  updateGameHUD(state) {
    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setEl('hud-score', state.score.toLocaleString());
    setEl('hud-level', state.level);
    setEl('hud-hits',  state.hits);

    // Barra de nível
    const bar = document.getElementById('hud-level-bar');
    if (bar) bar.style.width = `${state.levelProgress * 100}%`;

    // Combo
    const comboEl = document.getElementById('hud-combo');
    const comboCount = document.getElementById('combo-count');
    if (comboEl && comboCount) {
      if (state.combo >= 2) {
        comboEl.classList.remove('hidden');
        comboCount.textContent = `x${state.combo}`;
      } else {
        comboEl.classList.add('hidden');
      }
    }
  }

  togglePause() {
    if (this.phase !== 'game') return;
    const overlay = document.getElementById('pause-overlay');
    if (this.engine.isPaused) {
      this.engine.resume();
      if (overlay) overlay.classList.add('hidden');
    } else {
      this.engine.pause();
      if (overlay) overlay.classList.remove('hidden');
    }
  }

  endGame() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.engine.isRunning = false;
    const results = this.engine.getResults();
    this.showResults(results);
    this.showScreen('gameover');
  }

  showResults(results) {
    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setEl('result-score', results.score.toLocaleString());
    setEl('result-hits',  results.hits);
    setEl('result-combo', results.maxCombo);
    setEl('result-level', results.level);

    // Breakdown de socos
    const breakdown = document.getElementById('punch-breakdown');
    if (breakdown) {
      const punchColors = {
        jab:      '#00d4ff',
        direto:   '#ff6b35',
        cruzado:  '#a855f7',
        gancho:   '#22c55e',
        uppercut: '#ffd60a',
      };
      const punchNames = {
        jab: 'Jab', direto: 'Direto', cruzado: 'Cruzado', gancho: 'Gancho', uppercut: 'Uppercut'
      };
      const maxCount = Math.max(1, ...Object.values(results.punchCounts));
      breakdown.innerHTML = Object.entries(results.punchCounts).map(([key, count]) => `
        <div class="punch-stat-row">
          <span class="punch-stat-name">${punchNames[key]}</span>
          <div class="punch-stat-bar-wrap">
            <div class="punch-stat-bar" style="width:${(count/maxCount)*100}%;background:${punchColors[key]}"></div>
          </div>
          <span class="punch-stat-count">${count}</span>
        </div>
      `).join('');
    }
  }

  restartGame() {
    this.engine.reset();
    this.startGame();
  }

  goHome() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.camera.stop();
    this.engine.reset();
    this.showScreen('intro');
    // Re-inicializar tudo
    this.camera = new CameraManager();
    this.detector = new PoseDetector();
    this.lastPoseResults = null;
  }

  // ── POSE RESULTS CALLBACK ─────────────────────────────────
  onPoseResults(results) {
    this.lastPoseResults = results;
  }

  // ── RESIZE ────────────────────────────────────────────────
  handleResize() {
    [this.calibCanvas, this.tutCanvas, this.gameCanvas].forEach(canvas => {
      if (canvas) {
        canvas.width  = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
      }
    });
    
    if (this.playerCamCanvas) {
      // Manter aspect ratio do vídeo (4:3) para a mini câmera
      const w = this.playerCamCanvas.offsetWidth;
      const h = this.playerCamCanvas.offsetHeight;
      this.playerCamCanvas.width = w;
      this.playerCamCanvas.height = h;
    }
    
    if (this.engine && this.gameCanvas) {
      this.engine.canvasW = this.gameCanvas.offsetWidth;
      this.engine.canvasH = this.gameCanvas.offsetHeight;
    }
  }

  // ── TOAST ─────────────────────────────────────────────────
  showToast(msg, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.classList.add('hidden'), 300);
    }, 2500);
  }
}

// ══════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ══════════════════════════════════════════════════════════
const game = new KickTrainer();
window.kickGame = game;

// Mostrar tela de intro
game.showScreen('intro');
