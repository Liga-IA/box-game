/**
 * camera.js
 * Gerencia acesso à câmera e pipeline do MediaPipe Pose para Solo e Dupla
 */

export class CameraManager {
  constructor() {
    this.pose = null;
    this.poseP1 = null;
    this.poseP2 = null;
    this.camera = null;
    this.onResults = null;
    this.isRunning = false;
    this.mode = 'solo';

    // Canvases offscreen para recorte espelhado
    this.canvasMirrored = document.createElement('canvas');
    this.canvasP1 = document.createElement('canvas');
    this.canvasP2 = document.createElement('canvas');

    this.canvasMirrored.width = 640;
    this.canvasMirrored.height = 480;
    this.canvasP1.width = 320;
    this.canvasP1.height = 480;
    this.canvasP2.width = 320;
    this.canvasP2.height = 480;

    this.ctxMirrored = this.canvasMirrored.getContext('2d');
    this.ctxP1 = this.canvasP1.getContext('2d');
    this.ctxP2 = this.canvasP2.getContext('2d');

    this.lastResP1 = null;
    this.lastResP2 = null;
  }

  async initialize(videoElement, onResultsCallback, mode = 'solo') {
    this.onResults = onResultsCallback;
    this.mode = mode;

    const poseOptions = {
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      smoothSegmentation: false,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6
    };

    if (mode === 'solo') {
      this.pose = new Pose({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
      });
      this.pose.setOptions(poseOptions);
      this.pose.onResults((results) => {
        if (this.onResults) this.onResults({ mode: 'solo', results });
      });
    } else {
      // Modo Dupla — 2 instâncias do MediaPipe Pose
      this.poseP1 = new Pose({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
      });
      this.poseP1.setOptions(poseOptions);
      this.poseP1.onResults((res) => { this.lastResP1 = res; });

      this.poseP2 = new Pose({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
      });
      this.poseP2.setOptions(poseOptions);
      this.poseP2.onResults((res) => { this.lastResP2 = res; });
    }

    // Inicializar câmera
    this.camera = new Camera(videoElement, {
      onFrame: async () => {
        if (!this.isRunning) return;

        if (this.mode === 'solo' && this.pose) {
          await this.pose.send({ image: videoElement });
        } else if (this.mode === 'dupla' && this.poseP1 && this.poseP2) {
          // Espelhar vídeo no canvas completo
          const w = videoElement.videoWidth || 640;
          const h = videoElement.videoHeight || 480;
          if (this.canvasMirrored.width !== w) {
            this.canvasMirrored.width = w;
            this.canvasMirrored.height = h;
            this.canvasP1.width = w / 2;
            this.canvasP1.height = h;
            this.canvasP2.width = w / 2;
            this.canvasP2.height = h;
          }

          // Desenhar espelhado
          this.ctxMirrored.save();
          this.ctxMirrored.scale(-1, 1);
          this.ctxMirrored.drawImage(videoElement, -w, 0, w, h);
          this.ctxMirrored.restore();

          // Recortar metade esquerda (P1) e direita (P2)
          const halfW = w / 2;
          this.ctxP1.drawImage(this.canvasMirrored, 0, 0, halfW, h, 0, 0, halfW, h);
          this.ctxP2.drawImage(this.canvasMirrored, halfW, 0, halfW, h, 0, 0, halfW, h);

          await this.poseP1.send({ image: this.canvasP1 });
          await this.poseP2.send({ image: this.canvasP2 });

          if (this.onResults) {
            this.onResults({
              mode: 'dupla',
              p1: this.lastResP1,
              p2: this.lastResP2
            });
          }
        }
      },
      width: 640,
      height: 480,
      facingMode: 'user'
    });

    await this.camera.start();
    this.isRunning = true;
    console.log(`[CameraManager] Câmera iniciada no modo ${mode}`);
    return true;
  }

  stop() {
    this.isRunning = false;
    if (this.camera) {
      this.camera.stop();
    }
  }

  resume() {
    this.isRunning = true;
  }

  pause() {
    this.isRunning = false;
  }
}

