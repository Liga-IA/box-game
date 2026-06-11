/**
 * camera.js
 * Gerencia acesso à câmera e pipeline do MediaPipe Pose
 */

export class CameraManager {
  constructor() {
    this.pose = null;
    this.camera = null;
    this.onResults = null;
    this.isRunning = false;
  }

  async initialize(videoElement, onResultsCallback) {
    this.onResults = onResultsCallback;

    // Inicializar MediaPipe Pose
    this.pose = new Pose({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
      }
    });

    this.pose.setOptions({
      modelComplexity: 1,           // 0=leve, 1=médio, 2=pesado
      smoothLandmarks: true,
      enableSegmentation: false,
      smoothSegmentation: false,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6
    });

    this.pose.onResults((results) => {
      if (this.onResults) this.onResults(results);
    });

    // Inicializar câmera
    this.camera = new Camera(videoElement, {
      onFrame: async () => {
        if (this.isRunning && this.pose) {
          await this.pose.send({ image: videoElement });
        }
      },
      width: 640,
      height: 480,
      facingMode: 'user'
    });

    await this.camera.start();
    this.isRunning = true;
    console.log('[CameraManager] Câmera iniciada com sucesso');
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
