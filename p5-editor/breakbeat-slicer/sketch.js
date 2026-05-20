/*
 * p5.js Web Editor learning copy
 * Learning goal: Apply sample-and-hold logic to drum break slicing.
 * Try changing: BREAKS, DEFAULT_SLICE_COUNT, HOLD_DRIFT_DEFAULT, and STEP_RATE_DEFAULT.
 *
 * This sketch loads WAV files from github:switchangel/breaks by default. If the
 * remote sample cannot be decoded, it creates a tiny synthetic break buffer so
 * the slicing logic still runs.
 */

let slicerCanvas;
let audioCtx = null;
let masterGain = null;

let playButton;
let breakSelect;
let bpmSlider;
let bpmValue;
let stepRateSlider;
let stepRateValue;
let slicesSlider;
let slicesValue;
let holdDriftSlider;
let holdDriftValue;
let quantizeCheckbox;

let breakBuffer = null;
let waveformPeaks = [];
let isPlaying = false;
let nextStepTime = 0;
let currentStep = 0;
let heldValue = 0;
let heldSlice = 0;
let lastHeldSlice = 0;
let loadingStatus = "loading break...";

let heldScope = [];
let sliceScope = [];
let outputScope = [];

// Try changing these constants to hear or see how the slicer responds.
const BREAKS = [
  { id: "10", label: "10_break.wav", url: "https://raw.githubusercontent.com/switchangel/breaks/main/10_break.wav" },
  { id: "11", label: "11_break.wav", url: "https://raw.githubusercontent.com/switchangel/breaks/main/11_break.wav" },
  { id: "12", label: "12_break.wav", url: "https://raw.githubusercontent.com/switchangel/breaks/main/12_break.wav" },
  { id: "13", label: "13_break.wav", url: "https://raw.githubusercontent.com/switchangel/breaks/main/13_break.wav" },
  { id: "14", label: "14_break.wav", url: "https://raw.githubusercontent.com/switchangel/breaks/main/14_break.wav" },
];

const DEFAULT_SLICE_COUNT = 16;
const STEP_RATE_DEFAULT = 4;
const HOLD_DRIFT_DEFAULT = 0.72;
const SCHEDULER_LOOKAHEAD_SEC = 0.12;
const SCHEDULER_TICK_MS = 25;
const SLICE_ATTACK_SEC = 0.006;
const SLICE_RELEASE_SEC = 0.035;
const MASTER_LEVEL = 0.72;

function setup() {
  const container = document.getElementById("breakbeat-slicer-container");
  const canvasWidth = Math.max(320, Math.min(940, container ? container.clientWidth : 940));
  slicerCanvas = createCanvas(canvasWidth, 430);
  slicerCanvas.parent(container);
  textFont("monospace");

  audioCtx = getAudioContext();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = MASTER_LEVEL;
  masterGain.connect(getOutputNode(audioCtx));

  createUI(container);
  loadSelectedBreak();
  setInterval(schedulerTick, SCHEDULER_TICK_MS);
  userStartAudio();
}

function windowResized() {
  const container = document.getElementById("breakbeat-slicer-container");
  if (!container) return;
  const nextWidth = Math.max(320, Math.min(940, container.clientWidth || 940));
  resizeCanvas(nextWidth, height);
}

function getOutputNode(ctx) {
  return (window.p5 && window.p5.soundOut && window.p5.soundOut.input)
    ? window.p5.soundOut.input
    : ctx.destination;
}

function createUI(container) {
  const panel = document.createElement("div");
  panel.className = "controls controls-panel";

  const transportRow = document.createElement("div");
  transportRow.className = "row";

  const transportLabel = document.createElement("span");
  transportLabel.className = "row-label";
  transportLabel.textContent = "Transport and source";
  transportRow.appendChild(transportLabel);

  playButton = document.createElement("button");
  playButton.textContent = "Start";
  playButton.onclick = togglePlay;
  transportRow.appendChild(playButton);

  const breakPair = document.createElement("div");
  breakPair.className = "control-pair";

  const breakLabel = document.createElement("label");
  breakLabel.textContent = "Break";
  breakPair.appendChild(breakLabel);

  breakSelect = document.createElement("select");
  BREAKS.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    breakSelect.appendChild(option);
  });
  breakSelect.value = BREAKS[0].id;
  breakSelect.onchange = loadSelectedBreak;
  breakPair.appendChild(breakSelect);
  transportRow.appendChild(breakPair);

  const timingRow = document.createElement("div");
  timingRow.className = "row";

  const timingLabel = document.createElement("span");
  timingLabel.className = "row-label";
  timingLabel.textContent = "Timing";
  timingRow.appendChild(timingLabel);

  ({ slider: bpmSlider, valueSpan: bpmValue } = sliderGroup("BPM", 70, 180, 1, 142, (v) => `${Math.round(v)}`));
  timingRow.appendChild(bpmSlider.parentElement);

  ({ slider: stepRateSlider, valueSpan: stepRateValue } = sliderGroup("Rate", 1, 8, 1, STEP_RATE_DEFAULT, (v) => `${Math.round(v)}/beat`));
  timingRow.appendChild(stepRateSlider.parentElement);

  const slicingRow = document.createElement("div");
  slicingRow.className = "row";

  const slicingLabel = document.createElement("span");
  slicingLabel.className = "row-label";
  slicingLabel.textContent = "Slice selection";
  slicingRow.appendChild(slicingLabel);

  ({ slider: slicesSlider, valueSpan: slicesValue } = sliderGroup("Slices", 4, 32, 1, DEFAULT_SLICE_COUNT, (v) => `${Math.round(v)}`));
  slicesSlider.oninput = () => {
    slicesValue.textContent = `${Math.round(parseFloat(slicesSlider.value))}`;
    computeWaveformPeaks();
  };
  slicingRow.appendChild(slicesSlider.parentElement);

  ({ slider: holdDriftSlider, valueSpan: holdDriftValue } = sliderGroup("Hold drift", 0, 1, 0.01, HOLD_DRIFT_DEFAULT, (v) => v.toFixed(2)));
  slicingRow.appendChild(holdDriftSlider.parentElement);

  quantizeCheckbox = document.createElement("input");
  quantizeCheckbox.type = "checkbox";
  quantizeCheckbox.id = "slice-quantize";
  quantizeCheckbox.checked = true;
  const quantizeToggle = document.createElement("label");
  quantizeToggle.className = "toggle";
  quantizeToggle.htmlFor = "slice-quantize";
  quantizeToggle.appendChild(quantizeCheckbox);

  const quantLabel = document.createElement("span");
  quantLabel.textContent = "Quantise";
  quantizeToggle.appendChild(quantLabel);
  slicingRow.appendChild(quantizeToggle);

  panel.appendChild(transportRow);
  panel.appendChild(timingRow);
  panel.appendChild(slicingRow);
  container.appendChild(panel);
}

function sliderGroup(labelText, minV, maxV, stepV, defaultV, fmt) {
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
  group.appendChild(slider);

  const valueSpan = document.createElement("span");
  valueSpan.className = "slider-value";
  valueSpan.textContent = fmt(defaultV);
  group.appendChild(valueSpan);

  slider.oninput = () => {
    valueSpan.textContent = fmt(parseFloat(slider.value));
  };

  return { group, slider, valueSpan };
}

async function loadSelectedBreak() {
  if (!audioCtx) audioCtx = getAudioContext();
  const item = BREAKS.find((b) => b.id === breakSelect.value) || BREAKS[0];
  loadingStatus = `loading ${item.label}...`;
  breakBuffer = null;

  try {
    const response = await fetch(item.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    breakBuffer = await audioCtx.decodeAudioData(bytes);
    loadingStatus = `${item.label} loaded`;
  } catch (error) {
    console.warn("breakbeat-slicer: remote break unavailable, using fallback", error);
    breakBuffer = createFallbackBreakBuffer(audioCtx);
    loadingStatus = "fallback break loaded";
  }

  computeWaveformPeaks();
}

function createFallbackBreakBuffer(ctx) {
  const seconds = 2.0;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const hits = [
    { t: 0.00, amp: 1.0, hz: 70 },
    { t: 0.25, amp: 0.35, hz: 2300 },
    { t: 0.50, amp: 0.8, hz: 160 },
    { t: 0.75, amp: 0.45, hz: 3200 },
    { t: 1.00, amp: 0.9, hz: 80 },
    { t: 1.35, amp: 0.5, hz: 2200 },
    { t: 1.50, amp: 0.75, hz: 150 },
    { t: 1.75, amp: 0.45, hz: 2600 },
  ];

  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate;
    let sample = 0;
    hits.forEach((hit) => {
      const dt = t - hit.t;
      if (dt < 0 || dt > 0.18) return;
      const env = Math.exp(-dt * 35);
      const tone = Math.sin(TWO_PI * hit.hz * dt);
      const noisePart = (Math.random() * 2 - 1) * 0.35;
      sample += hit.amp * env * (tone * 0.6 + noisePart);
    });
    data[i] = Math.max(-0.9, Math.min(0.9, sample));
  }

  return buffer;
}

function computeWaveformPeaks() {
  waveformPeaks = [];
  if (!breakBuffer) return;
  const data = breakBuffer.getChannelData(0);
  const columns = Math.max(1, Math.floor(width - 40));
  const stride = Math.max(1, Math.floor(data.length / columns));

  for (let x = 0; x < columns; x++) {
    const start = x * stride;
    const end = Math.min(data.length, start + stride);
    let peak = 0;
    for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(data[i]));
    waveformPeaks.push(peak);
  }
}

function togglePlay() {
  userStartAudio();
  if (!breakBuffer) return;

  if (!isPlaying) {
    isPlaying = true;
    currentStep = 0;
    nextStepTime = audioCtx.currentTime + 0.05;
    playButton.textContent = "Stop";
    return;
  }

  isPlaying = false;
  playButton.textContent = "Start";
}

function schedulerTick() {
  if (!isPlaying || !breakBuffer || !audioCtx) return;
  while (nextStepTime < audioCtx.currentTime + SCHEDULER_LOOKAHEAD_SEC) {
    scheduleStep(nextStepTime);
    nextStepTime += getStepDurationSec();
    currentStep += 1;
  }
}

function getStepDurationSec() {
  const bpm = Math.max(40, parseFloat(bpmSlider ? bpmSlider.value : 142));
  const rate = Math.max(1, parseFloat(stepRateSlider ? stepRateSlider.value : STEP_RATE_DEFAULT));
  return (60 / bpm) / rate;
}

function scheduleStep(time) {
  const drift = Math.max(0, Math.min(1, parseFloat(holdDriftSlider.value)));
  if (currentStep === 0 || random() < drift) heldValue = random(-1, 1);

  const slices = Math.max(1, Math.round(parseFloat(slicesSlider.value)));
  const rawSlice = map(heldValue, -1, 1, 0, slices - 0.0001);
  const sliceIndex = quantizeCheckbox.checked
    ? Math.max(0, Math.min(slices - 1, Math.floor(rawSlice)))
    : Math.max(0, Math.min(slices - 1, rawSlice));

  heldSlice = sliceIndex;
  lastHeldSlice = Math.round(sliceIndex);
  triggerSlice(time, sliceIndex, slices);
}

// ═══════════════════════════════════════════════════════════════════════════
//  LIVE DEMO — breakbeat-slicer (search: DEMO_ANCHOR)
// ═══════════════════════════════════════════════════════════════════════════
//   triggerSlice() — schedule buffer slice playback and gain ramps.
// ═══════════════════════════════════════════════════════════════════════════
function triggerSlice(time, sliceIndex, slices) {
  const sliceDur = breakBuffer.duration / slices;
  const offset = sliceIndex * sliceDur;
  const playDur = Math.min(sliceDur * 0.95, getStepDurationSec() * 0.92);

  const src = audioCtx.createBufferSource();
  src.buffer = breakBuffer;
  src.playbackRate.value = 1;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.92, time + SLICE_ATTACK_SEC);
  gain.gain.setValueAtTime(0.92, Math.max(time + SLICE_ATTACK_SEC, time + playDur - SLICE_RELEASE_SEC));
  gain.gain.exponentialRampToValueAtTime(0.0001, time + playDur);

  src.connect(gain);
  gain.connect(masterGain);

  src.start(time, offset, playDur);
  src.stop(time + playDur + 0.02);
}

function updateScopes() {
  const panelWidth = Math.max(1, width - 40);
  const normalizedSlice = map(heldSlice, 0, Math.max(1, parseFloat(slicesSlider.value) - 1), -1, 1, true);
  const preview = waveformPeaks.length
    ? waveformPeaks[Math.floor((frameCount * 2) % waveformPeaks.length)] * 2 - 1
    : 0;

  heldScope = [...heldScope, heldValue].slice(-panelWidth);
  sliceScope = [...sliceScope, normalizedSlice].slice(-panelWidth);
  outputScope = [...outputScope, preview].slice(-panelWidth);
}

function draw() {
  background(250);
  updateScopes();

  drawHeader();
  drawWaveformPanel(72);
  drawScopePanel(heldScope, 190, "held random value");
  drawScopePanel(sliceScope, 300, "mapped slice index");
  drawSliceGrid();
}

function drawHeader() {
  const status = `${loadingStatus} | slice ${lastHeldSlice + 1}/${Math.round(parseFloat(slicesSlider.value || DEFAULT_SLICE_COUNT))}`;
  textSize(14);
  const title = "Breakbeat slicer: sample & hold";
  fill(0);
  noStroke();
  rect(14, 10, textWidth(title) + 12, 20, 6);
  fill(255);
  text(title, 20, 24);

  textSize(11);
  fill(70);
  text(status, 20, 48);
}

function drawWaveformPanel(centerY) {
  const panelWidth = width - 40;
  const panelHalfHeight = 44;
  noFill();
  stroke(0);
  rect(20, centerY - panelHalfHeight, panelWidth, panelHalfHeight * 2);

  if (!waveformPeaks.length) return;

  const slices = Math.round(parseFloat(slicesSlider.value || DEFAULT_SLICE_COUNT));
  stroke(210, 165, 85);
  for (let i = 1; i < slices; i++) {
    const x = 20 + (i / slices) * panelWidth;
    line(x, centerY - panelHalfHeight, x, centerY + panelHalfHeight);
  }

  stroke(0);
  for (let x = 0; x < waveformPeaks.length; x++) {
    const peak = waveformPeaks[x];
    line(20 + x, centerY - peak * panelHalfHeight, 20 + x, centerY + peak * panelHalfHeight);
  }

  const currentX = 20 + (heldSlice / Math.max(1, slices)) * panelWidth;
  stroke(197, 140, 58);
  strokeWeight(2);
  line(currentX, centerY - panelHalfHeight, currentX, centerY + panelHalfHeight);
  strokeWeight(1);

  labelPanel(centerY, panelHalfHeight, "break waveform + slice grid");
}

function drawScopePanel(scopeData, centerY, label) {
  const panelWidth = width - 40;
  const panelHalfHeight = 38;
  noFill();
  stroke(0);
  rect(20, centerY - panelHalfHeight, panelWidth, panelHalfHeight * 2);

  beginShape();
  for (let i = 0; i < scopeData.length; i++) {
    const y = map(scopeData[i], -1, 1, centerY + panelHalfHeight, centerY - panelHalfHeight);
    vertex(20 + i, y);
  }
  endShape();

  labelPanel(centerY, panelHalfHeight, label);
}

function drawSliceGrid() {
  const slices = Math.round(parseFloat(slicesSlider.value || DEFAULT_SLICE_COUNT));
  const y = height - 48;
  const x0 = 20;
  const w = width - 40;
  const gap = 3;
  const cellW = (w - gap * (slices - 1)) / slices;

  noStroke();
  for (let i = 0; i < slices; i++) {
    fill(i === lastHeldSlice ? 34 : 232, i === lastHeldSlice ? 34 : 224, i === lastHeldSlice ? 34 : 211);
    rect(x0 + i * (cellW + gap), y, cellW, 24, 5);
  }

  fill(70);
  textSize(11);
  text("sample-and-hold slice choices", x0, y + 42);
}

function labelPanel(centerY, panelHalfHeight, label) {
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
