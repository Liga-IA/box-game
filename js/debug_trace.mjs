import { PoseDetector, STANCE, LM } from './poseDetector.js';

const det = new PoseDetector(STANCE.ORTHODOX);

function mkLm(lx, ly, rx, ry) {
  const lm = Array.from({length:33}, () => ({x:0.5,y:0.5,z:0,visibility:0.95}));
  lm[LM.LEFT_SHOULDER]  = {x:0.62,y:0.32,z:-0.01,visibility:0.95};
  lm[LM.RIGHT_SHOULDER] = {x:0.38,y:0.32,z:0.01,visibility:0.95};
  lm[LM.LEFT_ELBOW]  = {x:0.66,y:0.45,z:-0.01,visibility:0.95};
  lm[LM.RIGHT_ELBOW] = {x:0.34,y:0.45,z:0.01,visibility:0.95};
  lm[LM.LEFT_WRIST]  = {x:lx,y:ly,z:-0.01,visibility:0.95};
  lm[LM.RIGHT_WRIST] = {x:rx,y:ry,z:0.01,visibility:0.95};
  lm[LM.LEFT_HIP]  = {x:0.57,y:0.62,z:0,visibility:0.95};
  lm[LM.RIGHT_HIP] = {x:0.43,y:0.62,z:0,visibility:0.95};
  lm[LM.LEFT_KNEE]  = {x:0.56,y:0.80,z:0,visibility:0.95};
  lm[LM.RIGHT_KNEE] = {x:0.44,y:0.80,z:0,visibility:0.95};
  return lm;
}

let t = 0;
performance.now = () => t;

// 4 frames de guarda
for (let i=0;i<4;i++) {
  det.analyze({poseLandmarks: mkLm(0.63,0.38,0.37,0.38)});
  t += 33;
}
t += 600; // pausa longa

// Jab: move punho esq dx=-0.02 total em 10 frames
const dx = -0.02, dy = 0.02;
for (let i=0;i<10;i++) {
  const ease = 1 - Math.pow(1 - i/9, 2);
  const lm = mkLm(0.63 + dx*ease, 0.38 + dy*ease, 0.37, 0.38);
  const res = det.analyze({poseLandmarks: lm});
  const speed = det.calcInstantSpeed(det.wristHistory.left).toFixed(5);
  console.log(`frame ${i} | phase:${det.punchPhase.left.padEnd(10)} | speed:${speed} | peak:${det.peakSpeed.left.toFixed(5)} | punch:${res.punch.id}`);
  t += 33;
}
