/**
 * main.js
 * Entry point — controla as fases do jogo (Solo e Dupla) e integra todos os módulos
 */

import { CameraManager }  from './camera.js';
import { PoseDetector, PUNCH_TYPES, PUNCH_INFO, STANCE } from './poseDetector.js';
import { Renderer }       from './renderer.js';
import { GameEngine }     from './gameEngine.js';

// ══════════════════════════════════════════════════════════
class KickTrainer {
  constructor() {
    // ── Módulos ────────────────────────────────────────────
    this.camera       = new CameraManager();
    this.detector     = new PoseDetector();
    this.detectorP1   = new PoseDetector();
    this.detectorP2   = new PoseDetector();
    this.engine       = new GameEngine('solo');

    // ── Estado ────────────────────────────────────────────
    this.mode         = 'solo';     // solo | dupla
    this.phase        = 'intro';    // intro | calibration | tutorial | game | gameover
    this.currentStance = STANCE.ORTHODOX; // base de luta padrão
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
    this.animFrame   = null;

    // ── Calibração ────────────────────────────────────────
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
  async startSetup(mode = 'solo') {
    this.mode = mode;
    this.engine.setMode(mode);
    this.showScreen('calibration');

    // Alternar visibilidade das silhuetas e checklists
    const soloGuide  = document.getElementById('pose-guide-solo');
    const duplaGuide = document.getElementById('pose-guide-dupla');
    const soloCheck  = document.getElementById('calib-checklist-solo');
    const duplaCheck = document.getElementById('calib-checklist-dupla');
    const stanceSel  = document.getElementById('stance-selector');

    if (soloGuide)  soloGuide.classList.toggle('hidden', mode !== 'solo');
    if (duplaGuide) duplaGuide.classList.toggle('hidden', mode !== 'dupla');
    if (soloCheck)  soloCheck.classList.toggle('hidden', mode !== 'solo');
    if (duplaCheck) duplaCheck.classList.toggle('hidden', mode !== 'dupla');
    // Mostrar seletor de guarda apenas no modo solo
    if (stanceSel)  stanceSel.classList.toggle('hidden', mode !== 'solo');

    // Aplicar guarda atual a todos os detectores
    this.detector.setStance(this.currentStance);
    this.detectorP1.setStance(STANCE.ORTHODOX); // P1 sempre ortodoxo no modo dupla
    this.detectorP2.setStance(STANCE.ORTHODOX);

    // Inicializar canvas de calibração
    this.calibRenderer = new Renderer(this.calibCanvas);
    this.handleResize();

    try {
      await this.camera.initialize(this.calibVideo, this.onPoseResults, mode);
      this.calibReadyTimer = 0;
      this.calibLoop();
    } catch (err) {
      console.error('[KickTrainer] Erro ao acessar câmera:', err);
      this.showToast('❌ Não foi possível acessar a câmera. Verifique as permissões.', 'error');
      this.showScreen('intro');
    }
  }

  // Seleciona a base de luta do jogador e atualiza a UI
  setStance(stanceName) {
    this.currentStance = (stanceName === 'southpaw') ? STANCE.SOUTHPAW : STANCE.ORTHODOX;
    this.detector.setStance(this.currentStance);

    const btnOrthodox = document.getElementById('btn-orthodox');
    const btnSouthpaw = document.getElementById('btn-southpaw');
    if (btnOrthodox) btnOrthodox.classList.toggle('stance-active', this.currentStance === STANCE.ORTHODOX);
    if (btnSouthpaw) btnSouthpaw.classList.toggle('stance-active', this.currentStance === STANCE.SOUTHPAW);

    this.showToast(
      this.currentStance === STANCE.ORTHODOX
        ? '🥊 Ortodoxo: jab com a mão esquerda'
        : '🥊 Canhoto: jab com a mão direita'
    );
  }

  calibLoop() {
    if (this.phase !== 'calibration') return;
    this.updateCalibHUD();
    this.animFrame = requestAnimationFrame(this.calibLoop);
  }

  updateCalibHUD() {
    if (!this.lastPoseResults) return;

    const icon = document.getElementById('calib-icon');
    const msg  = document.getElementById('calib-msg');
    const sub  = document.getElementById('calib-submsg');
    const btn  = document.getElementById('btn-proceed-game');

    if (this.mode === 'solo') {
      const resData = this.lastPoseResults.results || this.lastPoseResults;
      const results = this.detector.analyze(resData);
      const feedback = this.detector.getCalibrationFeedback();
      const cal = results.calibration;

      if (icon) icon.textContent = feedback.icon;
      if (msg)  msg.textContent  = feedback.msg;
      if (sub)  sub.textContent  = feedback.sub;

      this.setCheckItem('check-pose',     cal.poseDetected);
      this.setCheckItem('check-distance', cal.poseDetected && cal.distanceOk);
      this.setCheckItem('check-light',    true);

      if (this.calibRenderer && results.landmarks) {
        this.calibRenderer.resize();
        this.calibRenderer.clear();
        this.calibRenderer.drawSkeleton(results.landmarks);
      }

      if (feedback.ready) {
        this.calibReadyTimer++;
        if (this.calibReadyTimer > 30 && btn) btn.classList.remove('hidden');
        if (this.calibReadyTimer > 90) this.startGame();
      } else {
        this.calibReadyTimer = 0;
        if (btn) btn.classList.add('hidden');
      }
    } else {
      // MODO DUPLA
      const p1Res = this.detectorP1.analyze(this.lastPoseResults.p1);
      const p2Res = this.detectorP2.analyze(this.lastPoseResults.p2);

      const fbP1 = this.detectorP1.getCalibrationFeedback();
      const fbP2 = this.detectorP2.getCalibrationFeedback();

      const calP1 = p1Res.calibration;
      const calP2 = p2Res.calibration;

      this.setCheckItem('check-pose-p1', calP1.poseDetected);
      this.setCheckItem('check-dist-p1', calP1.poseDetected && calP1.distanceOk);
      this.setCheckItem('check-pose-p2', calP2.poseDetected);
      this.setCheckItem('check-dist-p2', calP2.poseDetected && calP2.distanceOk);

      const isP1Ready = fbP1.ready;
      const isP2Ready = fbP2.ready;
      const bothReady = isP1Ready && isP2Ready;

      if (msg) {
        if (bothReady) msg.textContent = 'Ambos os jogadores em posição perfeita! 🥊';
        else if (isP1Ready && !isP2Ready) msg.textContent = 'Jogador 1 OK! Jogador 2, ajuste sua posição';
        else if (!isP1Ready && isP2Ready) msg.textContent = 'Jogador 2 OK! Jogador 1, ajuste sua posição';
        else msg.textContent = 'Posicionem-se nos lados correspondentes';
      }

      if (icon) icon.textContent = bothReady ? '✅' : '👥';
      if (sub)  sub.textContent  = 'Jogador 1 à esquerda | Jogador 2 à direita';

      if (this.calibRenderer) {
        this.calibRenderer.resize();
        this.calibRenderer.clear();

        if (p1Res.landmarks) {
          const mappedP1 = p1Res.landmarks.map(pt => ({ ...pt, x: pt.x * 0.5 }));
          this.calibRenderer.drawSkeleton(mappedP1, p1Res.punch, '#00d4ff');
        }
        if (p2Res.landmarks) {
          const mappedP2 = p2Res.landmarks.map(pt => ({ ...pt, x: 0.5 + pt.x * 0.5 }));
          this.calibRenderer.drawSkeleton(mappedP2, p2Res.punch, '#ffd60a');
        }
      }

      if (bothReady) {
        this.calibReadyTimer++;
        if (this.calibReadyTimer > 30 && btn) btn.classList.remove('hidden');
        if (this.calibReadyTimer > 90) this.startGame();
      } else {
        this.calibReadyTimer = 0;
        if (btn) btn.classList.add('hidden');
      }
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
  // FASE 2 — TUTORIAL (Solo apenas)
  // ══════════════════════════════════════════════════════════
  startTutorial() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    this.showScreen('tutorial');

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
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(this.calibVideo, -W, 0, W, H);
      ctx.restore();
      ctx.fillStyle = 'rgba(8,8,15,0.35)';
      ctx.fillRect(0, 0, W, H);
    }

    if (this.lastPoseResults) {
      const resData = this.lastPoseResults.results || this.lastPoseResults;
      const results = this.detector.analyze(resData);

      if (this.tutRenderer) {
        this.tutRenderer.drawSkeleton(results.landmarks, results.punch);
      }

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

    const bar = document.getElementById('tutorial-bar');
    if (bar) bar.style.width = `${((this.tutorialIdx + 1) / total) * 100}%`;

    const emoji = document.getElementById('punch-emoji');
    const name  = document.getElementById('punch-name');
    const desc  = document.getElementById('punch-desc');
    const tip   = document.getElementById('punch-tip');
    if (emoji) emoji.textContent = info.emoji;
    if (name)  name.textContent  = info.type.name;
    if (desc)  desc.textContent  = info.desc;
    if (tip)   tip.textContent   = info.tip;
    if (name)  name.style.color  = info.type.color;

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

    document.querySelectorAll('.punch-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i === this.tutorialIdx);
    });

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

    this.gameRenderer = new Renderer(this.gameCanvas);
    this.playerCamCanvas = document.getElementById('canvas-player-cam');

    // Alternar visual do HUD de jogo
    const hudSolo  = document.getElementById('hud-top-solo');
    const hudDupla = document.getElementById('hud-top-dupla');
    const divider  = document.getElementById('split-divider');

    if (hudSolo)  hudSolo.classList.toggle('hidden', this.mode !== 'solo');
    if (hudDupla) hudDupla.classList.toggle('hidden', this.mode !== 'dupla');
    if (divider)  divider.classList.toggle('hidden', this.mode !== 'dupla');

    this.handleResize();

    this.gameTimerStart = 0;
    this.engine.reset();
    this.engine.start(this.gameCanvas.offsetWidth, this.gameCanvas.offsetHeight);

    this.updateGameHUD(this.engine.getState());
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
      this.gameRenderer.drawArenaBackground(timestamp, this.mode);
    }

    // ── Analisar poses e atualizar mini-câmera ──────────────────
    let punchResultP1 = null;
    let punchResultP2 = null;

    if (this.calibVideo && this.calibVideo.readyState >= 2 && this.playerCamCanvas) {
      const pCtx = this.playerCamCanvas.getContext('2d');
      const pW = this.playerCamCanvas.width;
      const pH = this.playerCamCanvas.height;

      pCtx.drawImage(this.calibVideo, 0, 0, pW, pH);
      pCtx.fillStyle = 'rgba(0,0,0,0.3)';
      pCtx.fillRect(0, 0, pW, pH);

      if (this.lastPoseResults) {
        const oldCtx = this.gameRenderer.ctx;
        const oldCanvas = this.gameRenderer.canvas;
        this.gameRenderer.ctx = pCtx;
        this.gameRenderer.canvas = this.playerCamCanvas;

        if (this.mode === 'solo') {
          const resData = this.lastPoseResults.results || this.lastPoseResults;
          punchResultP1 = this.detector.analyze(resData);
          this.gameRenderer.drawSkeleton(punchResultP1.landmarks, punchResultP1.punch);
          if (punchResultP1.punch && punchResultP1.punch.id !== 'none') {
            this.showPunchFeedback(punchResultP1.punch);
          }
        } else {
          punchResultP1 = this.detectorP1.analyze(this.lastPoseResults.p1);
          punchResultP2 = this.detectorP2.analyze(this.lastPoseResults.p2);

          if (punchResultP1.landmarks) {
            const mappedP1 = punchResultP1.landmarks.map(pt => ({ ...pt, x: pt.x * 0.5 }));
            this.gameRenderer.drawSkeleton(mappedP1, punchResultP1.punch, '#00d4ff');
          }
          if (punchResultP2.landmarks) {
            const mappedP2 = punchResultP2.landmarks.map(pt => ({ ...pt, x: 0.5 + pt.x * 0.5 }));
            this.gameRenderer.drawSkeleton(mappedP2, punchResultP2.punch, '#ffd60a');
          }

          if (punchResultP1.punch && punchResultP1.punch.id !== 'none') {
            this.showPunchFeedbackDuo(punchResultP1.punch, 1);
          }
          if (punchResultP2.punch && punchResultP2.punch.id !== 'none') {
            this.showPunchFeedbackDuo(punchResultP2.punch, 2);
          }
        }

        this.gameRenderer.ctx = oldCtx;
        this.gameRenderer.canvas = oldCanvas;
      }
    }

    // ── Atualizar engine ───────────────────────────────────────
    const engineHits = this.engine.update(timestamp, punchResultP1, punchResultP2);
    const state = this.engine.getState();

    if (engineHits) {
      if (engineHits.p1Hit && engineHits.p1Hit.type === 'hit') this.onHit(engineHits.p1Hit);
      if (engineHits.p2Hit && engineHits.p2Hit.type === 'hit') this.onHit(engineHits.p2Hit);
    }

    // ── Renderizar luvas e efeitos ─────────────────────────────
    if (this.gameRenderer) {
      for (const mitt of state.mitts) {
        this.gameRenderer.drawMitt(mitt);
      }

      if (this.mode === 'solo') {
        const activeMitt = state.mitts.find(m => m.state === 'active' || m.state === 'flying');
        if (activeMitt) {
          this.gameRenderer.drawBigPunchLabel(
            activeMitt.punchType,
            this.gameCanvas.width,
            this.gameCanvas.height
          );
        }
      } else {
        const activeMittP1 = state.mitts.find(m => m.playerId === 1 && (m.state === 'active' || m.state === 'flying'));
        const activeMittP2 = state.mitts.find(m => m.playerId === 2 && (m.state === 'active' || m.state === 'flying'));

        if (activeMittP1) {
          this.gameRenderer.drawBigPunchLabel(
            activeMittP1.punchType,
            this.gameCanvas.width,
            this.gameCanvas.height,
            this.gameCanvas.width * 0.25
          );
        }
        if (activeMittP2) {
          this.gameRenderer.drawBigPunchLabel(
            activeMittP2.punchType,
            this.gameCanvas.width,
            this.gameCanvas.height,
            this.gameCanvas.width * 0.75
          );
        }
      }

      for (const eff of state.effects) {
        this.gameRenderer.drawImpact(
          this.gameRenderer.ctx, eff.x, eff.y, eff.progress, eff.color
        );
      }

      if (this.flashAlpha > 0) {
        this.gameRenderer.drawHitFlash(this.flashColor, this.flashAlpha);
        this.flashAlpha = Math.max(0, this.flashAlpha - 0.05);
      }
    }

    // ── Atualizar HUD ──────────────────────────────────────────
    this.updateGameHUD(state);
    this.animFrame = requestAnimationFrame(this.gameLoop);
  }

  onHit(hitInfo) {
    this.flashColor = hitInfo.playerId === 2 ? '#ffd60a' : (hitInfo.playerId === 1 ? '#00d4ff' : hitInfo.punchType.color);
    this.flashAlpha = 0.5;
    if (navigator.vibrate) navigator.vibrate([50]);
  }

  showPunchFeedback(punchType) {
    const el = document.getElementById('hud-punch-type');
    if (el) {
      el.textContent = `${punchType.emoji} ${punchType.name}`;
      el.style.color = punchType.color;
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }

    const detected = document.getElementById('hud-punch-detected');
    if (detected) {
      detected.textContent = punchType.name;
      detected.style.color = punchType.color;
    }
  }

  showPunchFeedbackDuo(punchType, playerId) {
    const detectedId = playerId === 1 ? 'hud-p1-punch-detected' : 'hud-p2-punch-detected';
    const detected = document.getElementById(detectedId);
    if (detected) {
      detected.textContent = punchType.name;
      detected.style.color = punchType.color;
    }
  }

  updateTimer(timeLeft) {
    const m = Math.floor(timeLeft / 60);
    const s = Math.floor(timeLeft % 60);
    const formatted = `${m}:${s.toString().padStart(2,'0')}`;
    const timerColor = timeLeft < 15 ? '#e63946' : '#ffd60a';

    const elSolo = document.getElementById('hud-timer');
    const elDuo  = document.getElementById('hud-timer-dupla');
    if (elSolo) { elSolo.textContent = formatted; elSolo.style.color = timerColor; }
    if (elDuo)  { elDuo.textContent  = formatted; elDuo.style.color  = timerColor; }
  }

  updateGameHUD(state) {
    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    if (state.mode === 'solo') {
      setEl('hud-score', state.score.toLocaleString());
      setEl('hud-level', state.level);
      setEl('hud-hits',  state.hits);

      const bar = document.getElementById('hud-level-bar');
      if (bar) bar.style.width = `${state.levelProgress * 100}%`;

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
    } else {
      // DUPLA HUD
      setEl('hud-p1-score', state.p1.score.toLocaleString());
      setEl('hud-p1-hits',  state.p1.hits);

      const p1ComboWrap = document.getElementById('hud-p1-combo-wrap');
      const p1ComboVal  = document.getElementById('hud-p1-combo');
      if (p1ComboWrap && p1ComboVal) {
        if (state.p1.combo >= 2) {
          p1ComboWrap.classList.remove('hidden');
          p1ComboVal.textContent = `x${state.p1.combo}`;
        } else {
          p1ComboWrap.classList.add('hidden');
        }
      }

      setEl('hud-p2-score', state.p2.score.toLocaleString());
      setEl('hud-p2-hits',  state.p2.hits);

      const p2ComboWrap = document.getElementById('hud-p2-combo-wrap');
      const p2ComboVal  = document.getElementById('hud-p2-combo');
      if (p2ComboWrap && p2ComboVal) {
        if (state.p2.combo >= 2) {
          p2ComboWrap.classList.remove('hidden');
          p2ComboVal.textContent = `x${state.p2.combo}`;
        } else {
          p2ComboWrap.classList.add('hidden');
        }
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

    const soloContent = document.getElementById('gameover-content-solo');
    const duoContent  = document.getElementById('gameover-content-dupla');

    if (results.mode === 'solo') {
      if (soloContent) soloContent.classList.remove('hidden');
      if (duoContent)  duoContent.classList.add('hidden');

      setEl('result-score', results.score.toLocaleString());
      setEl('result-hits',  results.hits);
      setEl('result-combo', results.maxCombo);
      setEl('result-level', results.level);

      this.renderPunchBreakdown(document.getElementById('punch-breakdown'), results.punchCounts);
    } else {
      // MODO DUPLA
      if (soloContent) soloContent.classList.add('hidden');
      if (duoContent)  duoContent.classList.remove('hidden');

      const winnerCard = document.getElementById('card-winner');
      const winnerBadge = winnerCard ? winnerCard.querySelector('.winner-badge') : null;

      if (results.isTie) {
        if (winnerBadge) winnerBadge.textContent = '🤝 EMPATE!';
      } else {
        if (winnerBadge) winnerBadge.textContent = '🏆 VENCEDOR';
      }

      setEl('winner-name',  results.winner.name);
      setEl('winner-score', results.winner.score.toLocaleString());
      setEl('winner-hits',  results.winner.hits);
      setEl('winner-combo', results.winner.maxCombo);
      this.renderPunchBreakdown(document.getElementById('winner-punch-breakdown'), results.winner.punchCounts);

      setEl('loser-name',  results.loser.name);
      setEl('loser-score', results.loser.score.toLocaleString());
      setEl('loser-hits',  results.loser.hits);
      setEl('loser-combo', results.loser.maxCombo);
      this.renderPunchBreakdown(document.getElementById('loser-punch-breakdown'), results.loser.punchCounts);
    }
  }

  renderPunchBreakdown(containerEl, punchCounts) {
    if (!containerEl || !punchCounts) return;
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
    const maxCount = Math.max(1, ...Object.values(punchCounts));
    containerEl.innerHTML = Object.entries(punchCounts).map(([key, count]) => `
      <div class="punch-stat-row">
        <span class="punch-stat-name">${punchNames[key]}</span>
        <div class="punch-stat-bar-wrap">
          <div class="punch-stat-bar" style="width:${(count/maxCount)*100}%;background:${punchColors[key]}"></div>
        </div>
        <span class="punch-stat-count">${count}</span>
      </div>
    `).join('');
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
    this.camera = new CameraManager();
    this.detector = new PoseDetector(this.currentStance);
    this.detectorP1 = new PoseDetector(STANCE.ORTHODOX);
    this.detectorP2 = new PoseDetector(STANCE.ORTHODOX);
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
game.showScreen('intro');

