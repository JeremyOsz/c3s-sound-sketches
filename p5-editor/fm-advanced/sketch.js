/*
 * p5.js Web Editor learning copy
 * Learning goal: Explore a carrier plus modulator pair with ratio, index envelope, and feedback controls.
 * Try changing: ADV_BASE_AMP, ratio presets, or default envelope/index slider values.
 *
 * Paste this file into sketch.js in the p5.js Web Editor, or upload it with
 * the matching index.html from this folder. The sound code uses p5.sound plus
 * browser Web Audio nodes, so press the sketch's Start/Play button before
 * expecting audio.
 */

/**
 * Advanced FM (2-operator) (no build step)
 *
 * How it works:
 * - A carrier oscillator is frequency-modulated by a modulator oscillator.
 * - “Algorithm (C:M ratio)” controls the modulator frequency relative to the carrier.
 * - “Modulation index” controls how strongly the modulator bends the carrier frequency.
 * - An envelope shapes the modulation index over time (attack/decay/sustain).
 * - Feedback feeds the modulator back into itself, increasing brightness and chaos.
 * - Audio starts only after a user gesture (`userStartAudio()`), per browser policy.
 */
let fmAdvCanvas;

// Two-operator FM: modulator → carrier frequency
let opCarrier;
let opMod;

let fmAdvPlayButton;
let algoSelect;
let envAttackSlider, envDecaySlider, envSustainSlider;
let feedbackSlider;
let modIndexSlider;

let advState = {
  env: { phase: "idle", level: 0, lastTime: 0 }, // idle | attack | decay | sustain
  feedback: 0,
  specHistory: [],
};

// Try changing these constants to hear or see how the sketch responds.
const ADV_BASE_AMP = 0.35;
const ADV_MAX_INDEX = 600;
const ADV_MAX_FEEDBACK = 0.85;
const ADV_FREQ_SMOOTHING_SEC = 0.015;

// Setup + UI
function setup() {
  const container = document.getElementById("fm-advanced-container");
  const canvasWidth = Math.max(320, Math.min(960, container ? container.clientWidth : 960));
  fmAdvCanvas = createCanvas(canvasWidth, 360);
  fmAdvCanvas.parent(container);

  textFont("monospace");

  createFMAdvancedUI(container);

  opCarrier = new p5.Oscillator("sine");
  opCarrier.amp(0);

  opMod = new p5.Oscillator("sine");
  opMod.amp(0); // we use its phase mathematically; audio output is not heard directly

  userStartAudio();
}

function windowResized() {
  const container = document.getElementById("fm-advanced-container");
  if (!container) return;
  const nextWidth = Math.max(320, Math.min(960, container.clientWidth || 960));
  resizeCanvas(nextWidth, height);
}

function createFMAdvancedUI(container) {
  const row = document.createElement("div");
  row.className = "controls controls-panel control-stack";

  const rowLabel = document.createElement("span");
  rowLabel.className = "row-label";
  rowLabel.textContent = "Two-operator FM controls";
  row.appendChild(rowLabel);

  // Algorithm (ratio presets)
  const algoLabel = document.createElement("label");
  algoLabel.textContent = "Algorithm (C:M ratio):";
  row.appendChild(algoLabel);

  algoSelect = document.createElement("select");
  [
    { value: "1:1", label: "1 : 1  (simple)" },
    { value: "2:1", label: "2 : 1  (octave)" },
    { value: "3:2", label: "3 : 2  (fifths)" },
    { value: "5:1", label: "5 : 1  (bright)" },
    { value: "7:5", label: "7 : 5  (inharmonic)" },
  ].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    algoSelect.appendChild(o);
  });
  algoSelect.value = "2:1";
  row.appendChild(algoSelect);

  // Modulation index (peak)
  const idxGroup = document.createElement("span");
  idxGroup.className = "slider-group";
  const idxLabel = document.createElement("span");
  idxLabel.className = "slider-label";
  idxLabel.textContent = "Modulation index";
  idxGroup.appendChild(idxLabel);

  modIndexSlider = document.createElement("input");
  modIndexSlider.type = "range";
  modIndexSlider.min = "0";
  modIndexSlider.max = String(ADV_MAX_INDEX);
  modIndexSlider.step = "10";
  modIndexSlider.value = "280";
  idxGroup.appendChild(modIndexSlider);

  const idxVal = document.createElement("span");
  idxVal.className = "slider-value";
  idxVal.textContent = "280";
  idxGroup.appendChild(idxVal);

  modIndexSlider.oninput = () => {
    idxVal.textContent = `${Math.round(parseFloat(modIndexSlider.value))}`;
  };

  row.appendChild(idxGroup);

  // Simple ADS envelope on modulation index
  const atkGroup = document.createElement("span");
  atkGroup.className = "slider-group";
  const atkLabel = document.createElement("span");
  atkLabel.className = "slider-label";
  atkLabel.textContent = "Envelope attack";
  atkGroup.appendChild(atkLabel);
  envAttackSlider = document.createElement("input");
  envAttackSlider.type = "range";
  envAttackSlider.min = "0.01";
  envAttackSlider.max = "2";
  envAttackSlider.step = "0.01";
  envAttackSlider.value = "0.1";
  atkGroup.appendChild(envAttackSlider);
  const atkVal = document.createElement("span");
  atkVal.className = "slider-value";
  atkVal.textContent = "0.10";
  atkGroup.appendChild(atkVal);
  envAttackSlider.oninput = () => {
    atkVal.textContent = parseFloat(envAttackSlider.value).toFixed(2);
  };
  row.appendChild(atkGroup);

  const decGroup = document.createElement("span");
  decGroup.className = "slider-group";
  const decLabel = document.createElement("span");
  decLabel.className = "slider-label";
  decLabel.textContent = "Envelope decay";
  decGroup.appendChild(decLabel);
  envDecaySlider = document.createElement("input");
  envDecaySlider.type = "range";
  envDecaySlider.min = "0.05";
  envDecaySlider.max = "4";
  envDecaySlider.step = "0.05";
  envDecaySlider.value = "1";
  decGroup.appendChild(envDecaySlider);
  const decVal = document.createElement("span");
  decVal.className = "slider-value";
  decVal.textContent = "1.00";
  decGroup.appendChild(decVal);
  envDecaySlider.oninput = () => {
    decVal.textContent = parseFloat(envDecaySlider.value).toFixed(2);
  };
  row.appendChild(decGroup);

  const susGroup = document.createElement("span");
  susGroup.className = "slider-group";
  const susLabel = document.createElement("span");
  susLabel.className = "slider-label";
  susLabel.textContent = "Envelope sustain";
  susGroup.appendChild(susLabel);
  envSustainSlider = document.createElement("input");
  envSustainSlider.type = "range";
  envSustainSlider.min = "0";
  envSustainSlider.max = "1";
  envSustainSlider.step = "0.01";
  envSustainSlider.value = "0.5";
  susGroup.appendChild(envSustainSlider);
  const susVal = document.createElement("span");
  susVal.className = "slider-value";
  susVal.textContent = "0.50";
  susGroup.appendChild(susVal);
  envSustainSlider.oninput = () => {
    susVal.textContent = parseFloat(envSustainSlider.value).toFixed(2);
  };
  row.appendChild(susGroup);

  // Feedback
  const fbGroup = document.createElement("span");
  fbGroup.className = "slider-group";
  const fbLabel = document.createElement("span");
  fbLabel.className = "slider-label";
  fbLabel.textContent = "Feedback";
  fbGroup.appendChild(fbLabel);
  feedbackSlider = document.createElement("input");
  feedbackSlider.type = "range";
  feedbackSlider.min = "0";
  feedbackSlider.max = String(ADV_MAX_FEEDBACK);
  feedbackSlider.step = "0.01";
  feedbackSlider.value = "0.2";
  fbGroup.appendChild(feedbackSlider);
  const fbVal = document.createElement("span");
  fbVal.className = "slider-value";
  fbVal.textContent = "0.20";
  fbGroup.appendChild(fbVal);
  feedbackSlider.oninput = () => {
    fbVal.textContent = parseFloat(feedbackSlider.value).toFixed(2);
  };
  row.appendChild(fbGroup);

  // Play button
  fmAdvPlayButton = document.createElement("button");
  fmAdvPlayButton.textContent = "Trigger note";
  fmAdvPlayButton.onclick = triggerFMNote;
  row.appendChild(fmAdvPlayButton);

  container.prepend(row);
}

// Sound + state update
function triggerFMNote() {
  userStartAudio();

  const audioCtx = getAudioContext();
  const baseFreq = 220;
  const [cRatio, mRatio] = parseRatio(algoSelect.value);

  opCarrier.freq(baseFreq * cRatio);
  opMod.freq(baseFreq * mRatio);

  if (!opCarrier.started) {
    opCarrier.start();
  }
  if (!opMod.started) {
    opMod.start();
  }

  opCarrier.amp(ADV_BASE_AMP, 0.01);
  // we still keep mod's Web Audio oscillator running for phase, but don't send it to output
  opMod.amp(0, 0.01);

  advState = {
    ...advState,
    env: { phase: "attack", level: 0, lastTime: audioCtx.currentTime },
    feedback: 0,
    specHistory: [],
  };
}

function parseRatio(text) {
  const [c, m] = text.split(":").map((x) => parseFloat(x));
  if (!isFinite(c) || !isFinite(m) || c <= 0 || m <= 0) return [1, 1];
  return [c, m];
}

function clampNumber(x, minV, maxV) {
  if (!isFinite(x)) return minV;
  return Math.max(minV, Math.min(maxV, x));
}

function stepEnv(env, dt, params) {
  const atk = clampNumber(params.attack, 0.001, 20);
  const dec = clampNumber(params.decay, 0.001, 20);
  const sus = clampNumber(params.sustain, 0, 1);
  const safeDt = clampNumber(dt, 0, 1);

  if (env.phase === "idle") return env;

  if (env.phase === "attack") {
    const nextLevel = env.level + safeDt / atk;
    if (nextLevel >= 1) return { ...env, phase: "decay", level: 1 };
    return { ...env, level: nextLevel };
  }

  if (env.phase === "decay") {
    const nextLevel = env.level - (1 - sus) * (safeDt / dec);
    if (nextLevel <= sus) return { ...env, phase: "sustain", level: sus };
    return { ...env, level: nextLevel };
  }

  return env;
}

// ═══════════════════════════════════════════════════════════════════════════
//  LIVE DEMO — fm-advanced (search: DEMO_ANCHOR)
// ═══════════════════════════════════════════════════════════════════════════
//   updateFMAdvancedState() — two-op FM envelope, ratios, feedback.
// ═══════════════════════════════════════════════════════════════════════════
function updateFMAdvancedState() {
  const audioCtx = getAudioContext();
  const now = audioCtx.currentTime;
  const dt = advState.env.lastTime ? now - advState.env.lastTime : 0;
  const nextEnv = stepEnv(advState.env, dt, {
    attack: parseFloat(envAttackSlider.value),
    decay: parseFloat(envDecaySlider.value),
    sustain: parseFloat(envSustainSlider.value),
  });

  const baseFreq = 220;
  const [cRatio, mRatio] = parseRatio(algoSelect.value);
  const mFreq = baseFreq * mRatio;
  const peakIndex = clampNumber(parseFloat(modIndexSlider.value), 0, ADV_MAX_INDEX);
  const fb = clampNumber(parseFloat(feedbackSlider.value), 0, ADV_MAX_FEEDBACK);

  const modPhase = TWO_PI * mFreq * now + fb * advState.feedback;
  const modSample = Math.sin(modPhase);
  const nextFeedback = modSample;
  const currentIndex = peakIndex * nextEnv.level;
  const cFreq = baseFreq * cRatio + modSample * currentIndex;
  const safeFreq = constrain(cFreq, 20, 3000);
  if (opCarrier.started) opCarrier.freq(safeFreq, ADV_FREQ_SMOOTHING_SEC);

  const nextHistory = [
    ...advState.specHistory,
    { env: nextEnv.level, index: currentIndex, fb, mod: Math.abs(modSample) },
  ];
  const trimmedHistory =
    nextHistory.length > width - 40
      ? nextHistory.slice(nextHistory.length - (width - 40))
      : nextHistory;

  advState = {
    ...advState,
    env: { ...nextEnv, lastTime: now },
    feedback: nextFeedback,
    specHistory: trimmedHistory,
  };

  return { nextEnv };
}

// Rendering
function draw() {
  background(250);

  fill(0);
  noStroke();
  textSize(14);
  text(
    "Two-operator FM: modulator (M) drives carrier (C) frequency with envelope + feedback",
    20,
    22
  );

  const state = updateFMAdvancedState();

  // Envelope shape
  push();
  translate(20, 70);
  stroke(0);
  noFill();
  const w = width - 40;
  const h = 50;
  beginShape();
  for (let x = 0; x < w; x++) {
    const frac = x / (w - 1);
    let val;
    if (frac < 0.3) {
      const localT = frac / 0.3;
      val = localT;
    } else if (frac < 0.8) {
      const localT = (frac - 0.3) / 0.5;
      val = 1 - (1 - parseFloat(envSustainSlider.value)) * localT;
    } else {
      val = parseFloat(envSustainSlider.value);
    }
    vertex(x, map(val, 0, 1, h, -h));
  }
  endShape();
  pop();

  noStroke();
  textSize(12);
  text("Conceptual modulation index envelope (A–D–S)", 20, 60);

  // "Spectrum" bars – we fake 4 bands out of history stats
  const recent = advState.specHistory.slice(-80);
  let low = 0,
    mid = 0,
    high = 0,
    noiseBand = 0;
  if (recent.length > 0) {
    recent.forEach((s, i) => {
      const frac = i / recent.length;
      if (frac < 0.33) low += s.mod;
      else if (frac < 0.66) mid += s.mod;
      else high += s.mod;
      noiseBand += s.fb * s.mod;
    });
    low /= recent.length / 3;
    mid /= recent.length / 3;
    high /= recent.length / 3;
    noiseBand /= recent.length;
  }

  push();
  translate(60, 190);
  const bands = [
    { label: "Low sidebands", value: low },
    { label: "Mid sidebands", value: mid },
    { label: "High sidebands", value: high },
    { label: "Noise-ish", value: noiseBand },
  ];
  const maxH = 90;
  bands.forEach((b, idx) => {
    const x = idx * 120;
    const hVal = map(b.value, 0, 1, 0, maxH);
    fill(200 - idx * 20, 140, 80 + idx * 30);
    noStroke();
    rect(x, -hVal, 40, hVal);
    fill(0);
    text(b.label, x - 10, 16);
  });
  pop();

  noStroke();
  text(
    `C:M = ${algoSelect.value}   peak index ≈ ${Math.round(
      parseFloat(modIndexSlider.value)
    )}   envLevel ≈ ${state.nextEnv.level.toFixed(2)}   feedback ≈ ${parseFloat(
      feedbackSlider.value
    ).toFixed(2)}`,
    20,
    height - 12
  );
}
