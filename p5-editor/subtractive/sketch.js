/*
 * p5.js Web Editor learning copy
 * Learning goal: Start with a bright oscillator, then shape loudness and brightness with envelopes and a low-pass filter.
 * Try changing: SUB_PATTERNS, SUB_BASE_AMP, or default slider values in createSubUI().
 *
 * Paste this file into sketch.js in the p5.js Web Editor, or upload it with
 * the matching index.html from this folder. The sound code uses p5.sound plus
 * browser Web Audio nodes, so press the sketch's Start/Play button before
 * expecting audio.
 */

let subCanvas;

let audioCtx = null;
let oscNode = null;
let filterNode = null;
let ampNode = null;

let isRunning = false;
let lastDrawTime = 0;
let previewPhase = 0;

let startButton;
let triggerButton;

let waveSelect;
let noteSlider;
let glideSlider;
let loopCheckbox;
let loopPatternSelect;
let loopBpmSlider;

let ampAttackSlider, ampDecaySlider, ampSustainSlider, ampReleaseSlider;
let filtCutoffSlider, filtResSlider, filtEnvAmtSlider;
let filtAttackSlider, filtDecaySlider, filtSustainSlider, filtReleaseSlider;

let lastTargetFreq = 110;

let envScope = [];
let cutoffScope = [];
let outScope = [];

// Try changing these constants to hear or see how the sketch responds.
const SUB_BASE_AMP = 0.5;
const SUB_STEPS = 16;

const SUB_PATTERNS = [
  {
    id: "acid",
    name: "Acid-ish",
    gates: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1],
    offsets: [0, 0, 7, 0, 0, 0, 10, 0, 0, 0, 7, 0, 0, 12, 0, 10],
  },
  {
    id: "offbeat",
    name: "Offbeat stabs",
    gates: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
    offsets: [0, 0, 0, 0, 3, 0, 5, 0, 7, 0, 10, 0, 12, 0, 10, 0],
  },
  {
    id: "arp",
    name: "Arp up/down",
    gates: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    offsets: [0, 3, 7, 10, 12, 10, 7, 3, 0, 3, 7, 10, 12, 10, 7, 3],
  },
  {
    id: "drone",
    name: "Drone (quarters)",
    gates: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    offsets: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
];

let loopState = {
  isOn: false,
  patternId: "acid",
  currentStep: 0,
  nextStepTime: 0,
};

/**
 * Subtractive synthesis (no build step)
 *
 * How it works:
 * - A harmonically rich oscillator is shaped by an amplitude ADSR envelope.
 * - A low-pass filter shapes timbre; its cutoff can also be modulated by a filter ADSR.
 * - The looper is a simple 16-step scheduler using `audioCtx.currentTime`.
 * - UI controls update oscillator waveform, pitch/glide, amp ADSR, and filter parameters.
 */
// Setup + UI
function setup() {
  const container = document.getElementById("subtractive-container");
  if (!container) {
    console.error("subtractive: subtractive-container not found");
    return;
  }

  const canvasWidth = Math.max(320, Math.min(1060, container.clientWidth || 1060));
  subCanvas = createCanvas(canvasWidth, 430);
  subCanvas.parent(container);
  textFont("monospace");

  createSubUI(container);
  audioCtx = getAudioContext();
  userStartAudio();
}

function windowResized() {
  const container = document.getElementById("subtractive-container");
  if (!container) return;
  const nextWidth = Math.max(320, Math.min(1060, container.clientWidth || 1060));
  resizeCanvas(nextWidth, height);
}

function createSubUI(container) {
  const panel = document.createElement("div");
  panel.className = "controls controls-panel";

  const makeRow = (title) => {
    const row = document.createElement("div");
    row.className = "row";

    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = title;
    row.appendChild(label);

    panel.appendChild(row);
    return row;
  };

  const transportRow = makeRow("Transport");
  startButton = document.createElement("button");
  startButton.textContent = "Start audio";
  startButton.onclick = toggleAudio;
  transportRow.appendChild(startButton);

  triggerButton = document.createElement("button");
  triggerButton.textContent = "Trigger";
  triggerButton.onclick = () => triggerNote();
  transportRow.appendChild(triggerButton);

  const waveformWrap = document.createElement("span");
  const waveLabel = document.createElement("label");
  waveLabel.textContent = "Waveform";
  waveformWrap.appendChild(waveLabel);
  waveSelect = document.createElement("select");
  [
    { value: "sawtooth", label: "Sawtooth" },
    { value: "square", label: "Square" },
  ].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    waveSelect.appendChild(o);
  });
  waveSelect.value = "sawtooth";
  waveSelect.onchange = () => {
    if (oscNode) oscNode.type = waveSelect.value;
  };
  waveformWrap.appendChild(waveSelect);
  transportRow.appendChild(waveformWrap);

  const performanceRow = makeRow("Performance");
  ({ slider: noteSlider } = sliderGroup(performanceRow, "Root note (MIDI)", 36, 72, 1, 45, (v) => `${Math.round(v)}`));
  ({ slider: glideSlider } = sliderGroup(performanceRow, "Glide", 0, 0.25, 0.005, 0.02, (v) => `${Math.round(v * 1000)} ms`));

  const loopWrap = document.createElement("span");
  loopCheckbox = document.createElement("input");
  loopCheckbox.type = "checkbox";
  loopCheckbox.id = "sub-loop";
  loopCheckbox.onchange = () => {
    loopState = { ...loopState, isOn: !!loopCheckbox.checked, nextStepTime: 0, currentStep: 0 };
  };
  loopWrap.appendChild(loopCheckbox);
  const loopLabel = document.createElement("label");
  loopLabel.htmlFor = "sub-loop";
  loopLabel.textContent = "Loop";
  loopWrap.appendChild(loopLabel);
  loopPatternSelect = document.createElement("select");
  for (const p of SUB_PATTERNS) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    loopPatternSelect.appendChild(o);
  }
  loopPatternSelect.value = loopState.patternId;
  loopPatternSelect.onchange = () => {
    loopState = { ...loopState, patternId: loopPatternSelect.value, currentStep: 0, nextStepTime: 0 };
  };
  loopWrap.appendChild(loopPatternSelect);
  performanceRow.appendChild(loopWrap);

  ({ slider: loopBpmSlider } = sliderGroup(performanceRow, "BPM", 60, 170, 1, 128, (v) => `${Math.round(v)}`));

  const ampRow = makeRow("Amplitude envelope");
  ({ slider: ampAttackSlider } = sliderGroup(ampRow, "Attack", 0.001, 1.5, 0.001, 0.01, (v) => `${Math.round(v * 1000)} ms`));
  ({ slider: ampDecaySlider } = sliderGroup(ampRow, "Decay", 0.01, 2.5, 0.01, 0.18, (v) => `${Math.round(v * 1000)} ms`));
  ({ slider: ampSustainSlider } = sliderGroup(ampRow, "Sustain", 0, 1, 0.01, 0.25, (v) => v.toFixed(2)));
  ({ slider: ampReleaseSlider } = sliderGroup(ampRow, "Release", 0.01, 3.0, 0.01, 0.35, (v) => `${Math.round(v * 1000)} ms`));

  const filterRow = makeRow("Filter");
  ({ slider: filtCutoffSlider } = sliderGroup(filterRow, "Cutoff", 80, 8000, 1, 800, (v) => `${Math.round(v)} Hz`));
  ({ slider: filtResSlider } = sliderGroup(filterRow, "Resonance (Q)", 0.1, 18, 0.1, 8, (v) => v.toFixed(1)));
  ({ slider: filtEnvAmtSlider } = sliderGroup(filterRow, "Envelope amount", 0, 1, 0.01, 0.65, (v) => v.toFixed(2)));

  const filterEnvRow = makeRow("Filter envelope");
  ({ slider: filtAttackSlider } = sliderGroup(filterEnvRow, "Attack", 0.001, 1.2, 0.001, 0.004, (v) => `${Math.round(v * 1000)} ms`));
  ({ slider: filtDecaySlider } = sliderGroup(filterEnvRow, "Decay", 0.01, 2.5, 0.01, 0.12, (v) => `${Math.round(v * 1000)} ms`));
  ({ slider: filtSustainSlider } = sliderGroup(filterEnvRow, "Sustain", 0, 1, 0.01, 0.0, (v) => v.toFixed(2)));
  ({ slider: filtReleaseSlider } = sliderGroup(filterEnvRow, "Release", 0.01, 3.0, 0.01, 0.18, (v) => `${Math.round(v * 1000)} ms`));

  container.appendChild(panel);
}

function sliderGroup(container, labelText, minV, maxV, stepV, defaultV, fmt) {
  const group = document.createElement("span");
  group.className = "slider-group";

  const label = document.createElement("span");
  label.className = "slider-label";
  label.textContent = labelText;
  group.appendChild(label);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = `${minV}`;
  slider.max = `${maxV}`;
  slider.step = `${stepV}`;
  slider.value = `${defaultV}`;
  slider.style.marginLeft = "0.35rem";
  group.appendChild(slider);

  const valueSpan = document.createElement("span");
  valueSpan.className = "slider-value";
  valueSpan.textContent = fmt(defaultV);
  valueSpan.style.marginLeft = "0.35rem";
  group.appendChild(valueSpan);

  slider.oninput = () => {
    valueSpan.textContent = fmt(parseFloat(slider.value));
  };

  container.appendChild(group);
  return { slider, valueSpan };
}

// Sound + state update
function toggleAudio() {
  userStartAudio();
  if (!isRunning) {
    ensureGraph();
    isRunning = true;
    startButton.textContent = "Stop audio";
    return;
  }
  stopGraph();
  isRunning = false;
  startButton.textContent = "Start audio";
}

function ensureGraph() {
  if (!audioCtx) audioCtx = getAudioContext();
  if (oscNode && filterNode && ampNode) return;

  const ctx = audioCtx;

  oscNode = ctx.createOscillator();
  oscNode.type = waveSelect ? waveSelect.value : "sawtooth";
  oscNode.frequency.value = lastTargetFreq;

  filterNode = ctx.createBiquadFilter();
  filterNode.type = "lowpass";
  filterNode.frequency.value = 800;
  filterNode.Q.value = 8;

  ampNode = ctx.createGain();
  ampNode.gain.value = 0;

  oscNode.connect(filterNode);
  filterNode.connect(ampNode);
  ampNode.connect(ctx.destination);

  oscNode.start();
}

function stopGraph() {
  if (oscNode) {
    try {
      oscNode.stop();
    } catch (_) {}
    try {
      oscNode.disconnect();
    } catch (_) {}
  }
  if (filterNode) {
    try {
      filterNode.disconnect();
    } catch (_) {}
  }
  if (ampNode) {
    try {
      ampNode.disconnect();
    } catch (_) {}
  }
  oscNode = null;
  filterNode = null;
  ampNode = null;
}

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function scheduleADSR(param, now, adsr, peak, sustain) {
  const a = Math.max(0.001, adsr.a);
  const d = Math.max(0.001, adsr.d);
  const r = Math.max(0.001, adsr.r);
  const s = clamp01(adsr.s);

  const attackEnd = now + a;
  const decayEnd = attackEnd + d;
  const susLevel = sustain * s;

  param.cancelScheduledValues(now);
  param.setValueAtTime(0, now);
  param.linearRampToValueAtTime(peak, attackEnd);
  param.linearRampToValueAtTime(susLevel, decayEnd);

  // release is scheduled relative to "note off" by caller; here we return a helper.
  return {
    attackEnd,
    decayEnd,
    susLevel,
    release(releaseStart) {
      const relStart = Math.max(releaseStart, now);
      const relEnd = relStart + r;
      param.cancelScheduledValues(relStart);
      // When scheduling into the future, param.value won't necessarily reflect the scheduled curve.
      // So we jump from the sustain level we scheduled.
      param.setValueAtTime(susLevel, relStart);
      param.linearRampToValueAtTime(0, relEnd);
      return relEnd;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  LIVE DEMO — subtractive (search: DEMO_ANCHOR)
// ═══════════════════════════════════════════════════════════════════════════
//   triggerNote() — subtractive voice: osc, filter ADSR, amp ADSR.
// ═══════════════════════════════════════════════════════════════════════════
function triggerNote(opts) {
  userStartAudio();
  ensureGraph();

  const ctx = audioCtx;
  const now = opts && typeof opts.time === "number" ? opts.time : ctx.currentTime;

  const midi =
    opts && typeof opts.midi === "number"
      ? Math.round(opts.midi)
      : Math.round(parseFloat(noteSlider.value));
  const targetHz = midiToHz(midi);
  const glide = Math.max(0, parseFloat(glideSlider.value));
  lastTargetFreq = targetHz;

  if (oscNode) {
    oscNode.frequency.cancelScheduledValues(now);
    oscNode.frequency.setValueAtTime(oscNode.frequency.value, now);
    oscNode.frequency.setTargetAtTime(targetHz, now, Math.max(0.001, glide));
    oscNode.type = waveSelect.value;
  }

  const ampAdsr = {
    a: parseFloat(ampAttackSlider.value),
    d: parseFloat(ampDecaySlider.value),
    s: parseFloat(ampSustainSlider.value),
    r: parseFloat(ampReleaseSlider.value),
  };

  const filtAdsr = {
    a: parseFloat(filtAttackSlider.value),
    d: parseFloat(filtDecaySlider.value),
    s: parseFloat(filtSustainSlider.value),
    r: parseFloat(filtReleaseSlider.value),
  };

  const cutoffBase = Math.max(60, parseFloat(filtCutoffSlider.value));
  const res = Math.max(0.1, parseFloat(filtResSlider.value));
  const envAmt = clamp01(parseFloat(filtEnvAmtSlider.value));
  const cutoffPeak = cutoffBase + envAmt * (8000 - cutoffBase);
  const cutoffSustainBase = cutoffBase + envAmt * (cutoffBase * 0.6);

  if (filterNode) {
    filterNode.Q.setValueAtTime(res, now);
    filterNode.frequency.cancelScheduledValues(now);
    filterNode.frequency.setValueAtTime(cutoffBase, now);
    filterNode.frequency.linearRampToValueAtTime(cutoffPeak, now + Math.max(0.001, filtAdsr.a));
    filterNode.frequency.linearRampToValueAtTime(
      cutoffBase + (cutoffSustainBase - cutoffBase) * clamp01(filtAdsr.s),
      now + Math.max(0.001, filtAdsr.a) + Math.max(0.001, filtAdsr.d)
    );
  }

  if (ampNode) {
    const ampPeak = SUB_BASE_AMP;
    const sched = scheduleADSR(ampNode.gain, now, ampAdsr, ampPeak, ampPeak);
    const noteLength =
      opts && typeof opts.gateSec === "number" ? Math.max(0.02, opts.gateSec) : 0.18;
    const releaseStart = now + noteLength;
    sched.release(releaseStart);
  }

  // crude visual reset to show the new trigger clearly
  envScope = [];
  cutoffScope = [];
  outScope = [];
  lastDrawTime = millis() / 1000;
  previewPhase = 0;
}

function clamp01(x) {
  if (!isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function getLoopPatternById(id) {
  const found = SUB_PATTERNS.find((p) => p.id === id);
  return found || SUB_PATTERNS[0];
}

function secondsPerStep() {
  const bpm = Math.max(30, parseFloat(loopBpmSlider ? loopBpmSlider.value : "128"));
  return (60 / bpm) / 4; // 16th notes
}

function loopScheduler() {
  if (!loopState.isOn || !isRunning) return;
  if (!audioCtx) return;

  const now = audioCtx.currentTime;
  const lookahead = 0.12;
  const stepDur = secondsPerStep();

  const pattern = getLoopPatternById(loopState.patternId);

  let nextTime = loopState.nextStepTime;
  let step = loopState.currentStep;

  if (!nextTime || nextTime <= 0) {
    nextTime = now + 0.05;
    step = 0;
  }

  while (nextTime < now + lookahead) {
    const gate = pattern.gates[step % SUB_STEPS] ? 1 : 0;
    if (gate) {
      const root = Math.round(parseFloat(noteSlider.value));
      const offset = pattern.offsets[step % SUB_STEPS] || 0;
      triggerNote({ midi: root + offset, time: nextTime, gateSec: stepDur * 0.92 });
    }
    nextTime += stepDur;
    step = (step + 1) % SUB_STEPS;
  }

  loopState = { ...loopState, nextStepTime: nextTime, currentStep: step };
}

function updateSubtractiveVisualState(dt, currentFreq) {
  const envGuess = ampNode ? clamp01(ampNode.gain.value / SUB_BASE_AMP) : 0;
  const cutoffGuess = filterNode
    ? map(Math.log(Math.max(60, filterNode.frequency.value)), Math.log(60), Math.log(8000), 0, 1, true)
    : 0;

  previewPhase += TWO_PI * currentFreq * Math.max(dt, 0);
  const outGuess = Math.sin(previewPhase) * envGuess;

  const panelWidth = width - 40;
  envScope = [...envScope, envGuess].slice(-panelWidth);
  cutoffScope = [...cutoffScope, cutoffGuess].slice(-panelWidth);
  outScope = [...outScope, outGuess].slice(-panelWidth);
}

// Rendering
function drawScopePanel(scopeData, centerY, label, bipolarFromUnit) {
  const panelWidth = width - 40;
  const panelHalfHeight = 43;
  noFill();
  stroke(0);
  rect(20, centerY - panelHalfHeight, panelWidth, panelHalfHeight * 2);

  beginShape();
  for (let i = 0; i < scopeData.length; i++) {
    const src = bipolarFromUnit ? map(scopeData[i], 0, 1, -1, 1) : scopeData[i];
    const y = map(src, -1, 1, centerY + panelHalfHeight, centerY - panelHalfHeight);
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

  const nowMs = millis() / 1000;
  const dt = lastDrawTime > 0 ? nowMs - lastDrawTime : 0;
  lastDrawTime = nowMs;

  const currentFreq = oscNode ? oscNode.frequency.value : lastTargetFreq;
  loopScheduler();
  updateSubtractiveVisualState(dt, currentFreq);

  const title = "Subtractive synthesis (mono): amp ADSR + filter ADSR";
  textSize(14);
  const titleW = textWidth(title) + 12;
  fill(0);
  noStroke();
  rect(14, 10, titleW, 20, 6);
  fill(255);
  text(title, 20, 24);

  drawScopePanel(envScope, 95, "amp envelope (approx)", true);
  drawScopePanel(cutoffScope, 220, "filter cutoff (log mapped, approx)", true);
  drawScopePanel(outScope, 345, "output preview", false);

  const modeLabel = `${waveSelect ? waveSelect.value : "osc"} · note ${Math.round(
    parseFloat(noteSlider.value)
  )} · ${Math.round(currentFreq)} Hz · loop ${loopState.isOn ? "ON" : "OFF"} · cutoff ${Math.round(
    parseFloat(filtCutoffSlider.value)
  )} Hz · res ${parseFloat(filtResSlider.value).toFixed(1)} · env ${parseFloat(
    filtEnvAmtSlider.value
  ).toFixed(2)}`;
  textSize(11);
  const mW = textWidth(modeLabel) + 10;
  fill(0);
  rect(16, height - 18, mW, 16, 4);
  fill(255);
  text(modeLabel, 20, height - 6);
}

