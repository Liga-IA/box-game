/**
 * test_punch_classification.mjs
 *
 * Testes sintéticos para o classificador de socos.
 * Executa: node js/test_punch_classification.mjs
 *
 * Usa injeção de timestamps simulados (33ms/frame = ~30fps) para simular
 * a passagem de tempo entre frames. Os testes cobrem todos os 5 golpes,
 * ambas as bases, e casos negativos (ruído/movimento lento).
 *
 * LIMITAÇÃO: testes SINTÉTICOS com trajetórias idealizadas.
 * Validação final deve ser feita com movimentos reais no navegador.
 */

import { PoseDetector, PUNCH_TYPES, STANCE, LM } from './poseDetector.js';

// ─── Simular timestamps ──────────────────────────────────────────────────────
let _fakeNow = 1000;
const FRAME_MS = 33; // ~30fps

// Monkey-patch performance.now para os testes
const origNow = performance.now.bind(performance);
performance.now = () => _fakeNow;

function advanceFrame() {
  _fakeNow += FRAME_MS;
}

function resetTime(start = 1000) {
  _fakeNow = start;
}

// ─── Helpers de landmarks sintéticos ────────────────────────────────────────

/**
 * Cria landmarks base em posição de guarda neutra.
 * Convenção: câmera selfie espelhada → LEFT_SHOULDER.x > RIGHT_SHOULDER.x
 */
function makeGuardLandmarks() {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  lm[LM.NOSE]          = { x: 0.50, y: 0.10, z: 0,     visibility: 0.95 };
  lm[LM.LEFT_SHOULDER] = { x: 0.62, y: 0.32, z: -0.01, visibility: 0.95 };
  lm[LM.RIGHT_SHOULDER]= { x: 0.38, y: 0.32, z:  0.01, visibility: 0.95 };
  lm[LM.LEFT_ELBOW]    = { x: 0.66, y: 0.45, z: -0.01, visibility: 0.95 };
  lm[LM.RIGHT_ELBOW]   = { x: 0.34, y: 0.45, z:  0.01, visibility: 0.95 };
  lm[LM.LEFT_WRIST]    = { x: 0.63, y: 0.38, z: -0.01, visibility: 0.95 };
  lm[LM.RIGHT_WRIST]   = { x: 0.37, y: 0.38, z:  0.01, visibility: 0.95 };
  lm[LM.LEFT_HIP]      = { x: 0.57, y: 0.62, z: 0,     visibility: 0.95 };
  lm[LM.RIGHT_HIP]     = { x: 0.43, y: 0.62, z: 0,     visibility: 0.95 };
  lm[LM.LEFT_KNEE]     = { x: 0.56, y: 0.80, z: 0,     visibility: 0.95 };
  lm[LM.RIGHT_KNEE]    = { x: 0.44, y: 0.80, z: 0,     visibility: 0.95 };
  return lm;
}

/**
 * Gera sequência de frames simulando extensão de soco.
 * @param {Object} config
 *   dxTotal   - deslocamento total horizontal do punho
 *   dyTotal   - deslocamento total vertical (negativo = sobe)
 *   frames    - número de frames de extensão
 *   elbowBendY - quanto subir o cotovelo (positivo = cotovelo sobe = dobra)
 *   elbowAngleTarget - ângulo alvo do cotovelo no pico (apenas documenta intenção)
 * @param {Array} baseLm - landmarks de guarda
 * @param {string} side - 'left' | 'right'
 */
function generatePunchSequence(config, baseLm, side = 'left') {
  const {
    dxTotal    = 0,
    dyTotal    = 0,
    frames     = 10,
    elbowBendY = 0,  // quanto deslocar cotovelo em Y (positivo = sobe cotovelo)
    elbowBendX = 0,  // deslocamento X do cotovelo
  } = config;

  const wristKey  = side === 'left' ? LM.LEFT_WRIST  : LM.RIGHT_WRIST;
  const elbowKey  = side === 'left' ? LM.LEFT_ELBOW  : LM.RIGHT_ELBOW;

  const baseWX = baseLm[wristKey].x;
  const baseWY = baseLm[wristKey].y;
  const baseEX = baseLm[elbowKey].x;
  const baseEY = baseLm[elbowKey].y;

  const sequence = [];

  for (let f = 0; f < frames; f++) {
    const t = f / (frames - 1);
    const ease = 1 - Math.pow(1 - t, 2); // ease-out quad

    const lm = JSON.parse(JSON.stringify(baseLm));

    lm[wristKey].x = baseWX + dxTotal * ease;
    lm[wristKey].y = baseWY + dyTotal * ease;

    // Cotovelo acompanha punho mas com menos amplitude, e pode subir para simular gancho
    lm[elbowKey].x = baseEX + (dxTotal * 0.4 + elbowBendX) * ease;
    lm[elbowKey].y = baseEY + (dyTotal * 0.4) * ease - elbowBendY * Math.sin(t * Math.PI);

    sequence.push({ poseLandmarks: lm });
  }
  return sequence;
}

// ─── Executor de teste ───────────────────────────────────────────────────────

/**
 * Roda uma sequência de frames através do detector e verifica o golpe detectado.
 * Adiciona frames de "guarda" antes para estabelecer histórico.
 */
function runTest(testName, detector, frameSequence, expectedPunchId) {
  // Reset completo do detector
  detector.punchPhase     = { left: 'idle', right: 'idle' };
  detector.peakSpeed      = { left: 0, right: 0 };
  detector.wristHistory   = { left: [], right: [] };
  detector.lastPunchTimeLeft  = 0;
  detector.lastPunchTimeRight = 0;
  detector.punchStartPos  = { left: null, right: null };

  resetTime(0);

  // Alimentar 4 frames de guarda para estabelecer histórico limpo
  const guardLm = JSON.parse(JSON.stringify(frameSequence[0].poseLandmarks));
  for (let g = 0; g < 4; g++) {
    detector.analyze({ poseLandmarks: guardLm });
    advanceFrame();
  }
  // Pausa longa para garantir fase idle
  _fakeNow += 600;

  // Rodar frames do soco
  let detected = PUNCH_TYPES.NONE;
  let detectedFrame = -1;

  for (let i = 0; i < frameSequence.length; i++) {
    const result = detector.analyze(frameSequence[i]);
    if (result.punch.id !== 'none' && detected.id === 'none') {
      detected = result.punch;
      detectedFrame = i;
    }
    advanceFrame();
  }

  const ok = detected.id === expectedPunchId;
  const icon = ok ? '✅' : '❌';
  const det  = detected.id === 'none' ? '(nenhum)' : `(frame ${detectedFrame})`;
  console.log(`  ${icon} [${testName.padEnd(28)}] Esperado: ${expectedPunchId.padEnd(8)} | Detectado: ${detected.id.padEnd(8)} ${det}`);
  return ok;
}

// ─── SUÍTE DE TESTES ─────────────────────────────────────────────────────────

function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  TESTES SINTÉTICOS — CLASSIFICAÇÃO DE SOCOS');
  console.log('  (trajetórias idealizadas, ~30fps simulado)');
  console.log('═══════════════════════════════════════════════════════\n');

  let passed = 0;
  let total  = 0;

  const baseLm  = makeGuardLandmarks();

  // ── Detectores por base ─────────────────────────────────
  const detOrtho  = new PoseDetector(STANCE.ORTHODOX);
  const detSP     = new PoseDetector(STANCE.SOUTHPAW);

  // ─ JAB / DIRETO ─────────────────────────────────────────
  console.log('── JAB / DIRETO ──────────────────────────────────────');

  // Jab ortodoxo (mão esq, side='left'):
  //   punho esq (x=0.63) move-se quase reto para frente (pouco dx)
  //   No modelo simplificado, "frente" = leve dy positivo (para baixo)
  //   mas principalmente o braço se estende. Usamos dx≈0, dy≈0 com elbowBend negativo
  //   para simular extensão do cotovelo.
  total++; if (runTest('Jab ortodoxo (esq)', detOrtho,
    generatePunchSequence({ dxTotal: -0.02, dyTotal: 0.02, frames: 10, elbowBendY: -0.04 }, baseLm, 'left'),
    'jab')) passed++;

  // Direto ortodoxo (mão dir, side='right')
  total++; if (runTest('Direto ortodoxo (dir)', detOrtho,
    generatePunchSequence({ dxTotal: 0.02, dyTotal: 0.02, frames: 10, elbowBendY: -0.04 }, baseLm, 'right'),
    'direto')) passed++;

  // Jab southpaw (mão dir, side='right')
  total++; if (runTest('Jab southpaw (dir)', detSP,
    generatePunchSequence({ dxTotal: 0.02, dyTotal: 0.02, frames: 10, elbowBendY: -0.04 }, baseLm, 'right'),
    'jab')) passed++;

  // Direto southpaw (mão esq, side='left')
  total++; if (runTest('Direto southpaw (esq)', detSP,
    generatePunchSequence({ dxTotal: -0.02, dyTotal: 0.02, frames: 10, elbowBendY: -0.04 }, baseLm, 'left'),
    'direto')) passed++;

  // ─ CRUZADO ──────────────────────────────────────────────
  console.log('\n── CRUZADO ───────────────────────────────────────────');

  // Cruzado ortodoxo: mão dir (side='right'), x=0.37 → cruza centro (x=0.50)
  // dx deve ser > 0.13 para cruzar o midShoulder (0.50)
  total++; if (runTest('Cruzado ortodoxo (dir->esq)', detOrtho,
    generatePunchSequence({ dxTotal: 0.18, dyTotal: 0.01, frames: 10, elbowBendY: -0.03 }, baseLm, 'right'),
    'cruzado')) passed++;

  // Cruzado southpaw: mão esq (side='left'), x=0.63 → cruza centro (x=0.50)
  // dx deve ser < -0.13
  total++; if (runTest('Cruzado southpaw (esq->dir)', detSP,
    generatePunchSequence({ dxTotal: -0.18, dyTotal: 0.01, frames: 10, elbowBendY: -0.03 }, baseLm, 'left'),
    'cruzado')) passed++;

  // ─ GANCHO ───────────────────────────────────────────────
  console.log('\n── GANCHO ────────────────────────────────────────────');

  // Gancho esq: punho esq (x=0.63) move-se em arco, cotovelo dobrado
  // elbowBendY positivo = cotovelo sobe (dobra)
  // O punho NÃO cruza o centro (ficamos dentro do mesmo lado)
  total++; if (runTest('Gancho esq ortodoxo', detOrtho,
    generatePunchSequence({ dxTotal: -0.06, dyTotal: 0.00, frames: 10, elbowBendY: 0.06 }, baseLm, 'left'),
    'gancho')) passed++;

  // Gancho dir: punho dir (x=0.37) move-se lateralmente, cotovelo dobrado
  total++; if (runTest('Gancho dir ortodoxo', detOrtho,
    generatePunchSequence({ dxTotal: 0.06, dyTotal: 0.00, frames: 10, elbowBendY: 0.06 }, baseLm, 'right'),
    'gancho')) passed++;

  // ─ UPPERCUT ─────────────────────────────────────────────
  console.log('\n── UPPERCUT ──────────────────────────────────────────');

  // Uppercut: punho começa baixo (y alto) e sobe (dy negativo)
  const lmLowGuard = JSON.parse(JSON.stringify(baseLm));
  lmLowGuard[LM.LEFT_WRIST].y  = 0.62;
  lmLowGuard[LM.RIGHT_WRIST].y = 0.62;

  total++; if (runTest('Uppercut esq ortodoxo', detOrtho,
    generatePunchSequence({ dxTotal: 0.01, dyTotal: -0.32, frames: 10, elbowBendY: 0.03 }, lmLowGuard, 'left'),
    'uppercut')) passed++;

  total++; if (runTest('Uppercut dir ortodoxo', detOrtho,
    generatePunchSequence({ dxTotal: -0.01, dyTotal: -0.32, frames: 10, elbowBendY: 0.03 }, lmLowGuard, 'right'),
    'uppercut')) passed++;

  // ─ FALSOS POSITIVOS ─────────────────────────────────────
  console.log('\n── FALSOS POSITIVOS (esperado: none) ─────────────────');

  // Movimento muito lento (ruído)
  total++; if (runTest('Ruído lento', detOrtho,
    generatePunchSequence({ dxTotal: 0.008, dyTotal: 0.005, frames: 8 }, baseLm, 'left'),
    'none')) passed++;

  // Movimento descendente isolado (não é uppercut)
  total++; if (runTest('Movimento descendente (nao-soco)', detOrtho,
    generatePunchSequence({ dxTotal: 0.01, dyTotal: 0.12, frames: 8 }, baseLm, 'left'),
    'none')) passed++;

  // ─ RESUMO ───────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  const pct = Math.round((passed / total) * 100);
  console.log(`  RESULTADO: ${passed}/${total} (${pct}%) testes passaram\n`);

  if (passed < total) {
    console.log('  ⚠  NOTA: Testes com trajetórias idealizadas.');
    console.log('  Ajuste fino com movimentos reais pode ser necessário.');
    const failures = total - passed;
    console.log(`  ${failures} falha(s) podem indicar limiares muito rígidos.`);
    console.log('  Use o navegador para ajustar com dados reais.\n');
  } else {
    console.log('  Todos os testes sinteticos passaram!');
    console.log('  Valide com movimentos reais no navegador.\n');
  }
}

main();
