/*
 * p5.js Web Editor learning copy
 * Learning goal: Combine pitch drop, FM punch, and amplitude decay to design an electronic kick drum.
 * Try changing: KICK_PATTERNS, BASE_AMP, or default pitch/FM/envelope controls.
 *
 * Paste this file into sketch.js in the p5.js Web Editor, or upload it with
 * the matching index.html from this folder. The sound code uses p5.sound plus
 * browser Web Audio nodes, so press the sketch's Start/Play button before
 * expecting audio.
 */

let kickCanvas;

let carrier;
let carrierSelect;
let isEngineRunning = false;

let triggerButton;
let runButton;
let autoTriggerCheckbox;
let autoRateSlider;
let patternCheckbox;
let bpmSlider;
let patternSelect;

let baseFreqSlider;
let pitchDropSlider;
let pitchDecaySlider;
let ampDecaySlider;
let fmRatioSlider;
let fmAmountSlider;
let fmDecaySlider;

let activeHitStart = -1;
let lastTriggerTime = -1;
let previewPhase = 0;
let lastFrameTime = 0;

let patternStartTime = -1;
let lastPatternStep = -1;
let activePattern = [];

let pitchScope = [];
let fmScope = [];
let outputScope = [];

// Try changing these constants to hear or see how the sketch responds.
const BASE_AMP = 0.72;
const KICK_MAX_FREQ_HZ = 2400;
const PERLIN_TABLE_LEN = 2048;
const STEPS_PER_BAR = 16;
const PERLIN_EDGE_FADE_SAMPLES = 64;

const KICK_PATTERNS = [
  { id: "four_on_floor", name: "4-on-the-floor", steps: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
  { id: "half_time", name: "Half-time (1 + 3)", steps: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0] },
  { id: "offbeat", name: "Offbeat (syncopated)", steps: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0] },
  { id: "breakbeat_like", name: "Breakbeat-ish", steps: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0] },
  { id: "trap_sparse", name: "Trap-ish (sparse)", steps: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0] },
  { id: "two_step", name: "2-step (UK-ish)", steps: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1] },
];

function getPatternById(id) {
  const found = KICK_PATTERNS.find((p) => p.id === id);
  return found ? found.steps.slice() : KICK_PATTERNS[0].steps.slice();
}

function createPerlinTableBuffer(ctx, tableLen) {
  const buffer = ctx.createBuffer(1, tableLen, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < tableLen; i++) {
    // Use p5's Perlin noise as a smooth-ish random waveform.
    const t = i / tableLen;
    const v = noise(t * 8.0) * 2 - 1;
    data[i] = v;
    minV = min(minV, v);
    maxV = max(maxV, v);
  }

  const range = max(1e-6, maxV - minV);
  for (let i = 0; i < tableLen; i++) {
    data[i] = ((data[i] - minV) / range) * 2 - 1;
  }

  const fadeLen = Math.min(PERLIN_EDGE_FADE_SAMPLES, Math.floor(tableLen / 2));
  for (let i = 0; i < fadeLen; i++) {
    const fade = 0.5 - 0.5 * Math.cos(Math.PI * i / fadeLen);
    data[i] *= fade;
    data[tableLen - 1 - i] *= fade;
  }

  return buffer;
}

function createCarrier(kind) {
  const ctx = getAudioContext();
  const outputNode = (window.p5 && window.p5.soundOut && window.p5.soundOut.input)
    ? window.p5.soundOut.input
    : ctx.destination;

  if (kind === "noise") {
    const noiseSrc = new p5.Noise("white");
    const filter = new p5.BandPass();
    filter.res(10);
    noiseSrc.disconnect();
    noiseSrc.connect(filter);
    filter.connect();

    return {
      kind,
      started: false,
      start() {
        if (!this.started) noiseSrc.start();
        this.started = true;
      },
      stop() {
        noiseSrc.amp(0, 0.02);
        noiseSrc.stop();
        this.started = false;
      },
      setFreq(hz) {
        filter.freq(hz);
      },
      setAmp(amp, rampSec) {
        noiseSrc.amp(amp, rampSec);
      },
    };
  }

  if (kind === "perlin") {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(outputNode);

    const buffer = createPerlinTableBuffer(ctx, PERLIN_TABLE_LEN);
    const base = {
      kind,
      started: false,
      src: null,
      start() {
        if (this.started) return;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.connect(gain);
        src.start();
        this.src = src;
        this.started = true;
      },
      stop() {
        if (this.src) {
          try {
            this.src.stop();
          } catch (_) {}
        }
        this.src = null;
        this.started = false;
      },
      setFreq(hz) {
        if (!this.src) return;
        const playbackRate = (hz * buffer.length) / ctx.sampleRate;
        this.src.playbackRate.setValueAtTime(playbackRate, ctx.currentTime);
      },
      setAmp(amp, rampSec) {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(amp, now, max(0.001, rampSec));
      },
    };
    return base;
  }

  const osc = new p5.Oscillator(kind);
  osc.amp(0);
  return {
    kind,
    started: false,
    start() {
      if (!this.started) osc.start();
      this.started = true;
    },
    stop() {
      osc.amp(0, 0.02);
      osc.stop();
      this.started = false;
    },
    setFreq(hz) {
      osc.freq(hz);
    },
    setAmp(amp, rampSec) {
      osc.amp(amp, rampSec);
    },
  };
}

/**
 * FM + AM Kick (no build step)
 *
 * How it works:
 * - A carrier oscillator is shaped by an amplitude envelope and a pitch-drop envelope.
 * - A modulator adds an FM “punch” at the start (modulation index envelope).
 * - Optional auto-trigger / step patterns retrigger the same hit on a clock.
 * - UI controls tune pitch, envelopes, FM ratio/amount, and sequencer parameters.
 */
// Setup + UI
function setup() {
  const container = document.getElementById("fm-am-kick-container");
  const canvasWidth = Math.max(320, Math.min(960, container ? container.clientWidth : 960));
  kickCanvas = createCanvas(canvasWidth, 430);
  kickCanvas.parent(container);

  textFont("monospace");
  createKickUI(container);

  carrier = createCarrier("sine");

  userStartAudio();
}

function windowResized() {
  const container = document.getElementById("fm-am-kick-container");
  if (!container) return;
  const nextWidth = Math.max(320, Math.min(960, container.clientWidth || 960));
  resizeCanvas(nextWidth, height);
}

function createKickUI(container) {
  const row = document.createElement("div");
  row.className = "controls controls-panel";

  runButton = document.createElement("button");
  runButton.textContent = "Start audio";
  runButton.onclick = toggleEngine;
  row.appendChild(runButton);

  triggerButton = document.createElement("button");
  triggerButton.textContent = "Trigger kick";
  triggerButton.style.marginLeft = "0.5rem";
  triggerButton.onclick = triggerKick;
  row.appendChild(triggerButton);

  const carrierLabel = document.createElement("label");
  carrierLabel.textContent = "Carrier";
  carrierLabel.style.marginLeft = "0.75rem";
  row.appendChild(carrierLabel);

  carrierSelect = document.createElement("select");
  carrierSelect.style.marginLeft = "0.35rem";
  carrierSelect.title = "Carrier source / waveform";
  const carrierOptions = [
    { id: "sine", label: "sine (pure)" },
    { id: "square", label: "square (hollow)" },
    { id: "triangle", label: "triangle (soft)" },
    { id: "sawtooth", label: "saw (bright)" },
    { id: "noise", label: "noise (bandpass-pitched)" },
    { id: "perlin", label: "perlin sample (looped)" },
  ];
  for (const opt of carrierOptions) {
    const o = document.createElement("option");
    o.value = opt.id;
    o.textContent = opt.label;
    carrierSelect.appendChild(o);
  }
  carrierSelect.value = "sine";
  carrierSelect.onchange = () => {
    const next = carrierSelect.value;
    const wasRunning = isEngineRunning;
    if (carrier && carrier.started) carrier.stop();
    carrier = createCarrier(next);
    if (wasRunning) carrier.start();
  };
  row.appendChild(carrierSelect);

  patternCheckbox = document.createElement("input");
  patternCheckbox.type = "checkbox";
  patternCheckbox.id = "kick-pattern";
  patternCheckbox.style.marginLeft = "0.75rem";
  row.appendChild(patternCheckbox);

  const patternLabel = document.createElement("label");
  patternLabel.htmlFor = "kick-pattern";
  patternLabel.textContent = "pattern";
  patternLabel.style.marginLeft = "0.25rem";
  row.appendChild(patternLabel);

  patternSelect = document.createElement("select");
  patternSelect.style.marginLeft = "0.4rem";
  patternSelect.title = "Choose a common kick pattern (16-step grid)";
  for (const p of KICK_PATTERNS) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    patternSelect.appendChild(o);
  }
  patternSelect.value = "four_on_floor";
  patternSelect.onchange = () => {
    activePattern = getPatternById(patternSelect.value);
    patternStartTime = millis() / 1000;
    lastPatternStep = -1;
  };
  row.appendChild(patternSelect);

  const bpmGroup = document.createElement("span");
  bpmGroup.className = "slider-group";
  const bpmName = document.createElement("span");
  bpmName.textContent = "BPM";
  bpmGroup.appendChild(bpmName);

  bpmSlider = document.createElement("input");
  bpmSlider.type = "range";
  bpmSlider.min = "60";
  bpmSlider.max = "180";
  bpmSlider.step = "1";
  bpmSlider.value = "130";
  bpmSlider.style.marginLeft = "0.35rem";
  bpmGroup.appendChild(bpmSlider);

  const bpmVal = document.createElement("span");
  bpmVal.textContent = "130";
  bpmVal.style.marginLeft = "0.35rem";
  bpmGroup.appendChild(bpmVal);
  bpmSlider.oninput = () => {
    bpmVal.textContent = `${Math.round(parseFloat(bpmSlider.value))}`;
  };
  row.appendChild(bpmGroup);

  autoTriggerCheckbox = document.createElement("input");
  autoTriggerCheckbox.type = "checkbox";
  autoTriggerCheckbox.id = "kick-auto";
  autoTriggerCheckbox.style.marginLeft = "0.75rem";
  row.appendChild(autoTriggerCheckbox);

  const autoLabel = document.createElement("label");
  autoLabel.htmlFor = "kick-auto";
  autoLabel.textContent = "auto trigger";
  autoLabel.style.marginLeft = "0.25rem";
  row.appendChild(autoLabel);

  const autoGroup = document.createElement("span");
  autoGroup.className = "slider-group";
  const autoName = document.createElement("span");
  autoName.textContent = "Auto";
  autoGroup.appendChild(autoName);

  autoRateSlider = document.createElement("input");
  autoRateSlider.type = "range";
  autoRateSlider.min = "0.5";
  autoRateSlider.max = "8";
  autoRateSlider.step = "0.1";
  autoRateSlider.value = "2.0";
  autoRateSlider.style.marginLeft = "0.35rem";
  autoGroup.appendChild(autoRateSlider);

  const autoVal = document.createElement("span");
  autoVal.textContent = "2.0 Hz";
  autoVal.style.marginLeft = "0.35rem";
  autoGroup.appendChild(autoVal);
  autoRateSlider.oninput = () => {
    autoVal.textContent = `${parseFloat(autoRateSlider.value).toFixed(1)} Hz`;
  };
  row.appendChild(autoGroup);

  const baseGroup = document.createElement("span");
  baseGroup.className = "slider-group";
  const baseName = document.createElement("span");
  baseName.textContent = "Base";
  baseGroup.appendChild(baseName);
  baseFreqSlider = document.createElement("input");
  baseFreqSlider.type = "range";
  baseFreqSlider.min = "30";
  baseFreqSlider.max = "90";
  baseFreqSlider.step = "1";
  baseFreqSlider.value = "48";
  baseFreqSlider.style.marginLeft = "0.35rem";
  baseGroup.appendChild(baseFreqSlider);
  const baseVal = document.createElement("span");
  baseVal.textContent = "48 Hz";
  baseVal.style.marginLeft = "0.35rem";
  baseGroup.appendChild(baseVal);
  baseFreqSlider.oninput = () => {
    baseVal.textContent = `${Math.round(parseFloat(baseFreqSlider.value))} Hz`;
  };
  row.appendChild(baseGroup);

  const dropGroup = document.createElement("span");
  dropGroup.className = "slider-group";
  const dropName = document.createElement("span");
  dropName.textContent = "Drop";
  dropGroup.appendChild(dropName);
  pitchDropSlider = document.createElement("input");
  pitchDropSlider.type = "range";
  pitchDropSlider.min = "0";
  pitchDropSlider.max = "36";
  pitchDropSlider.step = "1";
  pitchDropSlider.value = "24";
  pitchDropSlider.style.marginLeft = "0.35rem";
  dropGroup.appendChild(pitchDropSlider);
  const dropVal = document.createElement("span");
  dropVal.textContent = "24 st";
  dropVal.style.marginLeft = "0.35rem";
  dropGroup.appendChild(dropVal);
  pitchDropSlider.oninput = () => {
    dropVal.textContent = `${Math.round(parseFloat(pitchDropSlider.value))} st`;
  };
  row.appendChild(dropGroup);

  const pDecayGroup = document.createElement("span");
  pDecayGroup.className = "slider-group";
  const pDecayName = document.createElement("span");
  pDecayName.textContent = "Pitch decay";
  pDecayGroup.appendChild(pDecayName);
  pitchDecaySlider = document.createElement("input");
  pitchDecaySlider.type = "range";
  pitchDecaySlider.min = "20";
  pitchDecaySlider.max = "600";
  pitchDecaySlider.step = "5";
  pitchDecaySlider.value = "130";
  pitchDecaySlider.style.marginLeft = "0.35rem";
  pDecayGroup.appendChild(pitchDecaySlider);
  const pDecayVal = document.createElement("span");
  pDecayVal.textContent = "130 ms";
  pDecayVal.style.marginLeft = "0.35rem";
  pDecayGroup.appendChild(pDecayVal);
  pitchDecaySlider.oninput = () => {
    pDecayVal.textContent = `${Math.round(parseFloat(pitchDecaySlider.value))} ms`;
  };
  row.appendChild(pDecayGroup);

  const aDecayGroup = document.createElement("span");
  aDecayGroup.className = "slider-group";
  const aDecayName = document.createElement("span");
  aDecayName.textContent = "Amplitude decay";
  aDecayGroup.appendChild(aDecayName);
  ampDecaySlider = document.createElement("input");
  ampDecaySlider.type = "range";
  ampDecaySlider.min = "120";
  ampDecaySlider.max = "1800";
  ampDecaySlider.step = "10";
  ampDecaySlider.value = "900";
  ampDecaySlider.style.marginLeft = "0.35rem";
  aDecayGroup.appendChild(ampDecaySlider);
  const aDecayVal = document.createElement("span");
  aDecayVal.textContent = "900 ms";
  aDecayVal.style.marginLeft = "0.35rem";
  aDecayGroup.appendChild(aDecayVal);
  ampDecaySlider.oninput = () => {
    aDecayVal.textContent = `${Math.round(parseFloat(ampDecaySlider.value))} ms`;
  };
  row.appendChild(aDecayGroup);

  const fmRatioGroup = document.createElement("span");
  fmRatioGroup.className = "slider-group";
  const fmRatioName = document.createElement("span");
  fmRatioName.textContent = "FM ratio";
  fmRatioGroup.appendChild(fmRatioName);
  fmRatioSlider = document.createElement("input");
  fmRatioSlider.type = "range";
  fmRatioSlider.min = "0.5";
  fmRatioSlider.max = "5";
  fmRatioSlider.step = "0.1";
  fmRatioSlider.value = "1.2";
  fmRatioSlider.style.marginLeft = "0.35rem";
  fmRatioGroup.appendChild(fmRatioSlider);
  const fmRatioVal = document.createElement("span");
  fmRatioVal.textContent = "1.2";
  fmRatioVal.style.marginLeft = "0.35rem";
  fmRatioGroup.appendChild(fmRatioVal);
  fmRatioSlider.oninput = () => {
    fmRatioVal.textContent = parseFloat(fmRatioSlider.value).toFixed(1);
  };
  row.appendChild(fmRatioGroup);

  const fmAmtGroup = document.createElement("span");
  fmAmtGroup.className = "slider-group";
  const fmAmtName = document.createElement("span");
  fmAmtName.textContent = "FM amount";
  fmAmtGroup.appendChild(fmAmtName);
  fmAmountSlider = document.createElement("input");
  fmAmountSlider.type = "range";
  fmAmountSlider.min = "0";
  fmAmountSlider.max = "240";
  fmAmountSlider.step = "5";
  fmAmountSlider.value = "100";
  fmAmountSlider.style.marginLeft = "0.35rem";
  fmAmtGroup.appendChild(fmAmountSlider);
  const fmAmtVal = document.createElement("span");
  fmAmtVal.textContent = "100 Hz";
  fmAmtVal.style.marginLeft = "0.35rem";
  fmAmtGroup.appendChild(fmAmtVal);
  fmAmountSlider.oninput = () => {
    fmAmtVal.textContent = `${Math.round(parseFloat(fmAmountSlider.value))} Hz`;
  };
  row.appendChild(fmAmtGroup);

  const fmDecayGroup = document.createElement("span");
  fmDecayGroup.className = "slider-group";
  const fmDecayName = document.createElement("span");
  fmDecayName.textContent = "FM decay";
  fmDecayGroup.appendChild(fmDecayName);
  fmDecaySlider = document.createElement("input");
  fmDecaySlider.type = "range";
  fmDecaySlider.min = "10";
  fmDecaySlider.max = "450";
  fmDecaySlider.step = "5";
  fmDecaySlider.value = "90";
  fmDecaySlider.style.marginLeft = "0.35rem";
  fmDecayGroup.appendChild(fmDecaySlider);
  const fmDecayVal = document.createElement("span");
  fmDecayVal.textContent = "90 ms";
  fmDecayVal.style.marginLeft = "0.35rem";
  fmDecayGroup.appendChild(fmDecayVal);
  fmDecaySlider.oninput = () => {
    fmDecayVal.textContent = `${Math.round(parseFloat(fmDecaySlider.value))} ms`;
  };
  row.appendChild(fmDecayGroup);

  container.appendChild(row);

  activePattern = getPatternById(patternSelect.value);
}

// Sound + state update
function toggleEngine() {
  userStartAudio();
  if (!isEngineRunning) {
    if (!carrier.started) carrier.start();
    isEngineRunning = true;
    runButton.textContent = "Stop audio";
    return;
  }
  carrier.stop();
  isEngineRunning = false;
  runButton.textContent = "Start audio";
}

function triggerKick() {
  userStartAudio();
  if (!isEngineRunning) {
    if (!carrier.started) carrier.start();
    isEngineRunning = true;
    runButton.textContent = "Stop audio";
  }
  activeHitStart = millis() / 1000;
  lastTriggerTime = activeHitStart;
}

function expEnv(elapsedSec, decayMs) {
  const tau = max(0.001, decayMs / 1000);
  return exp(-elapsedSec / tau);
}

// ═══════════════════════════════════════════════════════════════════════════
//  LIVE DEMO — fm-am-kick (search: DEMO_ANCHOR)
// ═══════════════════════════════════════════════════════════════════════════
//   updateKickEngineState() — pitch drop, FM amount, amps per hit.
// ═══════════════════════════════════════════════════════════════════════════
function updateKickEngineState(now, dt) {
  const patternEnabled = patternCheckbox && patternCheckbox.checked;
  const autoEnabled = autoTriggerCheckbox && autoTriggerCheckbox.checked;

  if (patternEnabled) {
    if (patternStartTime < 0) patternStartTime = now;
    const bpm = max(30, parseFloat(bpmSlider.value || "120"));
    const stepDur = (60 / bpm) / 4; // 16th notes
    const step = floor((now - patternStartTime) / stepDur) % STEPS_PER_BAR;
    if (step !== lastPatternStep) {
      lastPatternStep = step;
      if (activePattern && activePattern[step]) triggerKick();
    }
  } else if (autoEnabled) {
    const autoRate = max(0.5, parseFloat(autoRateSlider.value));
    const interval = 1 / autoRate;
    if (lastTriggerTime < 0 || now - lastTriggerTime >= interval) triggerKick();
  }

  const baseHz = parseFloat(baseFreqSlider.value);
  const pitchDropSt = parseFloat(pitchDropSlider.value);
  const pitchDecayMs = parseFloat(pitchDecaySlider.value);
  const ampDecayMs = parseFloat(ampDecaySlider.value);
  const fmRatio = parseFloat(fmRatioSlider.value);
  const fmAmountHz = parseFloat(fmAmountSlider.value);
  const fmDecayMs = parseFloat(fmDecaySlider.value);

  let ampEnv = 0;
  let pitchEnv = 0;
  let fmEnv = 0;
  let currentFreq = baseHz;
  let fmComponent = 0;

  if (activeHitStart >= 0) {
    const elapsed = now - activeHitStart;
    ampEnv = expEnv(elapsed, ampDecayMs);
    pitchEnv = expEnv(elapsed, pitchDecayMs);
    fmEnv = expEnv(elapsed, fmDecayMs);

    const dropRatio = pow(2, (pitchDropSt * pitchEnv) / 12);
    const pitchDropHz = baseHz * (dropRatio - 1);
    const fmOsc = sin(TWO_PI * (baseHz * fmRatio) * elapsed);
    fmComponent = fmOsc * fmAmountHz * fmEnv;
    currentFreq = constrain(baseHz + pitchDropHz + fmComponent, 20, KICK_MAX_FREQ_HZ);

    if (ampEnv < 0.0008) {
      activeHitStart = -1;
      ampEnv = 0;
      fmComponent = 0;
      currentFreq = baseHz;
    }
  }

  if (carrier && carrier.started) {
    carrier.setFreq(currentFreq);
    carrier.setAmp(BASE_AMP * ampEnv, 0.004);
  }

  previewPhase += TWO_PI * currentFreq * max(dt, 0);
  const outputPreview = sin(previewPhase) * ampEnv;

  const panelWidth = width - 40;
  const pitchBipolar = map(log(currentFreq), log(30), log(500), -1, 1, true);
  const fmBipolar = constrain(fmComponent / max(1, fmAmountHz), -1, 1);
  pitchScope = [...pitchScope, pitchBipolar].slice(-panelWidth);
  fmScope = [...fmScope, fmBipolar].slice(-panelWidth);
  outputScope = [...outputScope, outputPreview].slice(-panelWidth);

  return { baseHz, pitchDropSt, ampDecayMs, fmAmountHz, fmDecayMs };
}

// Rendering
function drawScopePanel(scopeData, centerY, label) {
  const panelWidth = width - 40;
  const panelHalfHeight = 43;
  noFill();
  stroke(0);
  rect(20, centerY - panelHalfHeight, panelWidth, panelHalfHeight * 2);

  beginShape();
  for (let i = 0; i < scopeData.length; i++) {
    const y = map(
      scopeData[i],
      -1,
      1,
      centerY + panelHalfHeight,
      centerY - panelHalfHeight
    );
    vertex(20 + i, y);
  }
  endShape();

  textSize(11);
  const lw = textWidth(label) + 10;
  const lx = width - lw - 24;
  const ly = centerY - panelHalfHeight + 16;
  fill(0);
  noStroke();
  rect(lx, ly - 12, lw, 16, 4);
  fill(255);
  text(label, lx + 5, ly);
}

function draw() {
  background(250);

  const now = millis() / 1000;
  const dt = lastFrameTime > 0 ? now - lastFrameTime : 0;
  lastFrameTime = now;
  const state = updateKickEngineState(now, dt);

  const titleText = "FM + AM kick engine";
  textSize(14);
  const titleW = textWidth(titleText) + 12;
  fill(0);
  noStroke();
  rect(14, 10, titleW, 20, 6);
  fill(255);
  text(titleText, 20, 24);

  drawScopePanel(pitchScope, 95, "pitch trajectory (log mapped)");
  drawScopePanel(fmScope, 220, "fm contribution over time");
  drawScopePanel(outputScope, 345, "output waveform");

  const modeLabel = `base ${Math.round(state.baseHz)} Hz · drop ${Math.round(
    state.pitchDropSt
  )} st · ampD ${Math.round(state.ampDecayMs)} ms · fmAmt ${Math.round(
    state.fmAmountHz
  )} Hz · fmD ${Math.round(state.fmDecayMs)} ms`;
  textSize(11);
  const mW = textWidth(modeLabel) + 10;
  fill(0);
  rect(16, height - 18, mW, 16, 4);
  fill(255);
  text(modeLabel, 20, height - 6);
}
