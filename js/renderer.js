/**
 * renderer.js
 * Renderiza esqueleto, arena e luvas aparadoras com imagens reais
 */

import { LM, PUNCH_TYPES } from './poseDetector.js';

const SKELETON_CONNECTIONS = [
  [LM.LEFT_SHOULDER,  LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER,  LM.LEFT_ELBOW],
  [LM.LEFT_ELBOW,     LM.LEFT_WRIST],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.RIGHT_ELBOW,    LM.RIGHT_WRIST],
  [LM.LEFT_SHOULDER,  LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP,       LM.RIGHT_HIP],
  [LM.LEFT_HIP,       LM.LEFT_KNEE],
  [LM.RIGHT_HIP,      LM.RIGHT_KNEE],
];
const JOINT_POINTS = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW,    LM.RIGHT_ELBOW,
  LM.LEFT_WRIST,    LM.RIGHT_WRIST,
  LM.LEFT_HIP,      LM.RIGHT_HIP,
  LM.LEFT_KNEE,     LM.RIGHT_KNEE,
];

// Configuração visual por tipo de soco
// image: qual imagem usar  | scaleX/Y: simular perspectiva 3D extra
// flipX: espelhar horizontalmente (gancho esquerda/direita)
// rotateExtra: rotação extra em radianos sobre a rotação base do mitt
const PUNCH_VISUAL = {
  jab:      { img: 'front',    scaleX: 1.0,  scaleY: 1.0,  skewX: 0.08  },
  direto:   { img: 'front',    scaleX: 1.0,  scaleY: 1.0,  skewX: -0.08 },
  cruzado:  { img: 'front',    scaleX: 0.88, scaleY: 1.0,  skewX: 0.18  },
  gancho:   { img: 'hook',     scaleX: 1.0,  scaleY: 1.0,  skewX: 0     },
  uppercut: { img: 'uppercut', scaleX: 1.0,  scaleY: 1.0,  skewX: 0     },
};

export class Renderer {
  constructor(canvas) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext('2d');
    this.images   = {};       // cache das imagens carregadas
    this._loadImages();
  }

  _loadImages() {
    const files = {
      front:    'assets/mitt_front.png',
      hook:     'assets/mitt_hook.png',
      uppercut: 'assets/mitt_uppercut.png',
    };
    for (const [key, src] of Object.entries(files)) {
      const img = new Image();
      img.src = src;
      img.onload = () => { this.images[key] = img; };
    }
  }

  resize() {
    this.canvas.width  = this.canvas.offsetWidth;
    this.canvas.height = this.canvas.offsetHeight;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // ── ESQUELETO ────────────────────────────────────────────
  drawSkeleton(landmarks, punchType = PUNCH_TYPES.NONE, customColor = null) {
    if (!landmarks) return;
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const color    = customColor || (punchType && punchType.color) || 'rgba(255,255,255,0.6)';
    const isActive = punchType && punchType.id !== 'none';
    const px = lm  => ({ x: lm.x * W, y: lm.y * H });

    ctx.lineWidth   = isActive ? 3 : 2;
    ctx.strokeStyle = isActive ? color : (customColor ? customColor : 'rgba(255,255,255,0.4)');
    ctx.lineCap     = 'round';
    ctx.shadowColor = isActive ? color : 'transparent';
    ctx.shadowBlur  = isActive ? 15 : 0;

    for (const [a, b] of SKELETON_CONNECTIONS) {
      const la = landmarks[a], lb = landmarks[b];
      if (!la || !lb || la.visibility < 0.3 || lb.visibility < 0.3) continue;
      const pa = px(la), pb = px(lb);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    for (const idx of JOINT_POINTS) {
      const lm = landmarks[idx];
      if (!lm || lm.visibility < 0.3) continue;
      const p = px(lm);
      const isWrist = idx === LM.LEFT_WRIST || idx === LM.RIGHT_WRIST;
      const r = isWrist ? (isActive ? 10 : 7) : 5;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isActive && isWrist ? color : (customColor ? customColor : 'rgba(255,255,255,0.7)');
      ctx.fill();
      if (isActive && isWrist) {
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.4; ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.shadowBlur = 0;
  }

  // ── ARENA ────────────────────────────────────────────────
  drawArenaBackground(timestamp, mode = 'solo') {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const cx = W / 2, cy = H * 0.5;

    ctx.fillStyle = '#06060e';
    ctx.fillRect(0, 0, W, H);

    if (mode === 'solo') {
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.85);
      grad.addColorStop(0,   'rgba(55,10,100,0.45)');
      grad.addColorStop(0.6, 'rgba(20,5,45,0.2)');
      grad.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    } else {
      // Modo Dupla — gradientes para P1 (esq, azul) e P2 (dir, dourado)
      const gradP1 = ctx.createRadialGradient(W * 0.25, cy, 0, W * 0.25, cy, W * 0.5);
      gradP1.addColorStop(0, 'rgba(0, 212, 255, 0.25)');
      gradP1.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradP1; ctx.fillRect(0, 0, W * 0.5, H);

      const gradP2 = ctx.createRadialGradient(W * 0.75, cy, 0, W * 0.75, cy, W * 0.5);
      gradP2.addColorStop(0, 'rgba(255, 214, 10, 0.25)');
      gradP2.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradP2; ctx.fillRect(W * 0.5, 0, W * 0.5, H);
    }

    const t  = (timestamp * 0.0004) % 1;
    const vp = { x: cx, y: H * 0.42 };
    ctx.save();
    ctx.strokeStyle = 'rgba(120,50,220,0.18)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 14; i++) {
      const angle = ((i / 14) - 0.5) * Math.PI * 1.3;
      ctx.beginPath();
      ctx.moveTo(vp.x, vp.y);
      ctx.lineTo(vp.x + Math.cos(angle) * W * 1.6, vp.y + Math.sin(angle) * H * 1.6);
      ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const p    = ((i / 8) + t) % 1;
      const yPos = vp.y + p * p * (H - vp.y);
      const xSp  = p * p * W * 0.9;
      ctx.globalAlpha = p * 0.5;
      ctx.beginPath();
      ctx.moveTo(vp.x - xSp, yPos); ctx.lineTo(vp.x + xSp, yPos); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.restore();
  }

  // ── LUVA com imagem real ─────────────────────────────────
  _drawMittImage(ctx, punchId, size, alpha, isHit, isMiss) {
    const vis    = PUNCH_VISUAL[punchId] || PUNCH_VISUAL.jab;
    const imgKey = vis.img;
    const img    = this.images[imgKey];
    if (!img || !img.complete) return;

    const w = size * 3.8;
    const h = size * 3.8;

    ctx.save();
    ctx.transform(1, 0, vis.skewX, 1, 0, 0);
    ctx.scale(vis.scaleX, vis.scaleY);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'screen';

    if (isMiss) {
      ctx.filter = 'brightness(0.45) sepia(1) saturate(4) hue-rotate(-20deg)';
    }

    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  // ── ENTRADA PRINCIPAL — chamada pelo game loop ──────────
  drawMitt(mitt) {
    const ctx = this.ctx;
    const { x, y, radius, punchType, state, progress, alpha = 1, mittRotation = 0 } = mitt;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.translate(x, y);

    ctx.rotate(mittRotation);

    if (state === 'flying') {
      const scale = 0.06 + 0.94 * progress;

      for (let i = 1; i <= 3; i++) {
        const tp = Math.max(0, progress - i * 0.07);
        if (tp <= 0) continue;
        const ease = 1 - Math.pow(1 - tp, 3);
        const tx2  = (mitt.startX + (mitt.targetX - mitt.startX) * ease) - x;
        const ty2  = (mitt.startY + (mitt.targetY - mitt.startY) * ease) - y;
        ctx.save();
        ctx.translate(tx2, ty2);
        ctx.globalAlpha = alpha * (0.22 - i * 0.06);
        this._drawMittImage(ctx, punchType.id, radius * (0.06 + 0.94 * tp) * 0.7, 1, false, false);
        ctx.restore();
      }

      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.scale(scale, scale);
      this._drawMittImage(ctx, punchType.id, radius, 1, false, false);
      ctx.restore();

    } else if (state === 'hit') {
      const sc = 1 + (1 - progress) * 0.6;
      ctx.save();
      ctx.scale(sc, sc);
      ctx.globalAlpha = alpha * (1 - progress * 0.8);
      this._drawMittImage(ctx, punchType.id, radius, 1, true, false);
      ctx.restore();
      ctx.restore();
      this.drawImpact(this.ctx, x, y, 1 - progress, mitt.playerId === 2 ? '#ffd60a' : (mitt.playerId === 1 ? '#00d4ff' : punchType.color));
      return;

    } else if (state === 'miss') {
      this._drawMittImage(ctx, punchType.id, radius, alpha, false, true);

    } else {
      const pulse = 1 + Math.sin(Date.now() * 0.004) * 0.03;
      ctx.save();
      ctx.scale(pulse, pulse);
      this._drawMittImage(ctx, punchType.id, radius, 1, false, false);
      ctx.restore();

      if (mitt.timeLeft !== undefined) {
        ctx.rotate(-mittRotation);
        const tp    = mitt.timeLeft / mitt.totalTime;
        const ringR = radius * 1.15;
        ctx.beginPath();
        ctx.arc(0, 0, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * tp);
        ctx.strokeStyle = tp > 0.4 ? '#2dc653' : '#e63946';
        ctx.lineWidth   = 6;
        ctx.lineCap     = 'round';
        ctx.shadowColor = tp > 0.4 ? '#2dc653' : '#e63946';
        ctx.shadowBlur  = 12;
        ctx.stroke();
        ctx.shadowBlur  = 0;
      }
    }

    ctx.restore();
  }

  // ── NOME DO SOCO GIGANTE ─────────────────────────────────
  drawBigPunchLabel(punchType, W, H, posX = null) {
    if (!punchType || punchType.id === 'none') return;
    const ctx   = this.ctx;
    const label = punchType.name;
    const color = punchType.color || '#ffffff';
    const fSize = posX ? Math.min(80, Math.max(50, W * 0.08)) : Math.min(140, Math.max(80, W * 0.13));
    const tx = posX !== null ? posX : W / 2;
    const ty = H * 0.12;

    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${fSize}px 'Bebas Neue', sans-serif`;

    ctx.lineWidth   = fSize * 0.14;
    ctx.strokeStyle = 'rgba(0,0,0,0.96)';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur  = 15;
    ctx.strokeText(label, tx, ty);

    ctx.shadowBlur = 0;
    ctx.fillStyle  = '#ffffff';
    ctx.fillText(label, tx, ty);

    ctx.shadowColor = color;
    ctx.shadowBlur  = 50;
    ctx.fillStyle   = color;
    ctx.globalAlpha = 0.55;
    ctx.fillText(label, tx, ty);

    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
    ctx.restore();
  }

  // ── IMPACTO ──────────────────────────────────────────────
  drawImpact(ctx, x, y, progress, color) {
    for (let i = 0; i < 3; i++) {
      const r = 25 + (90 + i * 35) * progress;
      const a = (1 - progress) * (0.8 - i * 0.25);
      if (a <= 0) continue;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = color || '#ffd60a';
      ctx.lineWidth   = 3 - i;
      ctx.globalAlpha = a;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      const dist  = 45 + 75 * progress;
      ctx.beginPath();
      ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, 4 * (1 - progress), 0, Math.PI * 2);
      ctx.fillStyle   = color || '#ffd60a';
      ctx.globalAlpha = (1 - progress) * 0.85;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawHitFlash(color, alpha) {
    if (alpha <= 0) return;
    this.ctx.globalAlpha = alpha * 0.3;
    this.ctx.fillStyle   = color;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.globalAlpha = 1;
  }
}
