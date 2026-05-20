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

// Pattern helpers keep the 16-step clock code separate from the audio engine.
function getPatternById(id) {
  const found = KICK_PATTERNS.find((p) => p.id === id);
  return found ? found.steps.slice() : KICK_PATTERNS[0].steps.slice();
}

// The "perlin" carrier is a looped table, so it exposes the same start/stop/freq/amp API as p5 oscillators.
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
  const panel = document.createElement("div");
  panel.className = "controls controls-panel";

  // Small DOM helpers keep the repeated control shape readable without creating a shared dependency.
  const createRow = (labelText) => {
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = labelText;
    row.appendChild(label);
    panel.appendChild(row);
    return row;
  };

  const controlPair = (labelText, control) => {
    const pair = document.createElement("div");
    pair.className = "control-pair";
    const label = document.createElement("label");
    label.textContent = labelText;
    pair.appendChild(label);
    pair.appendChild(control);
    return pair;
  };

  const togglePair = (labelText, input) => {
    const label = document.createElement("label");
    label.className = "toggle";
    label.htmlFor = input.id;
    label.appendChild(input);
    const text = document.createElement("span");
    text.textContent = labelText;
    label.appendChild(text);
    return label;
  };

  const sliderGroup = (labelText, minV, maxV, stepV, defaultV, valueText, onInput) => {
    const group = document.createElement("span");
    group.className = "slider-group";

    const label = document.createElement("span");
    label.className = "slider-label";
    label.textContent = labelText;
    group.appendChild(label);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(minV);
    slider.max = String(maxV);
    slider.step = String(stepV);
    slider.value = String(defaultV);
    group.appendChild(slider);

    const value = document.createElement("span");
    value.className = "slider-value";
    value.textContent = valueText(defaultV);
    group.appendChild(value);

    slider.oninput = () => {
      value.textContent = valueText(parseFloat(slider.value));
      if (onInput) onInput(slider, value);
    };

    return { group, slider, value };
  };

  const transportRow = createRow("Transport and clock");

  runButton = document.createElement("button");
  runButton.textContent = "Start audio";
  runButton.onclick = toggleEngine;
  transportRow.appendChild(runButton);

  triggerButton = document.createElement("button");
  triggerButton.textContent = "Trigger kick";
  triggerButton.onclick = triggerKick;
  transportRow.appendChild(triggerButton);

  carrierSelect = document.createElement("select");
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
  transportRow.appendChild(controlPair("Carrier", carrierSelect));

  patternCheckbox = document.createElement("input");
  patternCheckbox.type = "checkbox";
  patternCheckbox.id = "kick-pattern";
  transportRow.appendChild(togglePair("Pattern", patternCheckbox));

  patternSelect = document.createElement("select");
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
  transportRow.appendChild(controlPair("Pattern", patternSelect));

  ({ slider: bpmSlider } = sliderGroup("BPM", 60, 180, 1, 130, (v) => `${Math.round(v)}`));
  transportRow.appendChild(bpmSlider.parentElement);

  autoTriggerCheckbox = document.createElement("input");
  autoTriggerCheckbox.type = "checkbox";
  autoTriggerCheckbox.id = "kick-auto";
  transportRow.appendChild(togglePair("Auto trigger", autoTriggerCheckbox));

  ({ slider: autoRateSlider } = sliderGroup("Auto rate", 0.5, 8, 0.1, 2.0, (v) => `${v.toFixed(1)} Hz`));
  transportRow.appendChild(autoRateSlider.parentElement);

  const pitchRow = createRow("Pitch envelope");
  ({ slider: baseFreqSlider } = sliderGroup("Base", 30, 90, 1, 48, (v) => `${Math.round(v)} Hz`));
  pitchRow.appendChild(baseFreqSlider.parentElement);
  ({ slider: pitchDropSlider } = sliderGroup("Drop", 0, 36, 1, 24, (v) => `${Math.round(v)} st`));
  pitchRow.appendChild(pitchDropSlider.parentElement);
  ({ slider: pitchDecaySlider } = sliderGroup("Pitch decay", 20, 600, 5, 130, (v) => `${Math.round(v)} ms`));
  pitchRow.appendChild(pitchDecaySlider.parentElement);

  const ampRow = createRow("Amplitude envelope");
  ({ slider: ampDecaySlider } = sliderGroup("Decay", 120, 1800, 10, 900, (v) => `${Math.round(v)} ms`));
  ampRow.appendChild(ampDecaySlider.parentElement);

  const fmRow = createRow("FM / AM shaping");
  ({ slider: fmRatioSlider } = sliderGroup("FM ratio", 0.5, 5, 0.1, 1.2, (v) => v.toFixed(1)));
  fmRow.appendChild(fmRatioSlider.parentElement);
  ({ slider: fmAmountSlider } = sliderGroup("FM amount", 0, 240, 5, 100, (v) => `${Math.round(v)} Hz`));
  fmRow.appendChild(fmAmountSlider.parentElement);
  ({ slider: fmDecaySlider } = sliderGroup("FM decay", 10, 450, 5, 90, (v) => `${Math.round(v)} ms`));
  fmRow.appendChild(fmDecaySlider.parentElement);

  container.appendChild(panel);

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

  // First decide whether this animation frame should trigger a new hit.
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

  // Then turn the last hit time into envelope values for pitch, amplitude, and FM depth.
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

  // The scopes are visual approximations only; the actual sound is controlled above.
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
