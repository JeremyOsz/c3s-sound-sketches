/*
 * p5.js Web Editor learning copy
 * Learning goal: Multiply a carrier by a modulator, from slow tremolo to ring-mod-like tones.
 * Try changing: BASE_AMP, PERLIN_BUFFER_SIZE, or the default carrier/modulator settings.
 *
 * Paste this file into sketch.js in the p5.js Web Editor, or upload it with
 * the matching index.html from this folder. The sound code uses p5.sound plus
 * browser Web Audio nodes, so press the sketch's Start/Play button before
 * expecting audio.
 */

/**
 * AM / Ring Modulation (no build step)
 *
 * How it works:
 * - A carrier (what you hear) is multiplied by a modulator.
 * - Slow modulation sounds like tremolo (AM).
 * - Fast modulation produces ring-mod-like sidebands and new timbres.
 * - UI controls select waveforms, modulation rate/depth, and whether modulation is fast.
 * - Audio starts only after a user gesture (`userStartAudio()`), per browser policy.
 */
let amCanvas;

let carrierOsc;
let noiseCarrier;
let isPlaying = false;

let amPlayButton;
let carrierSelect;
let modWaveSelect;
let rateSlider;
let depthSlider;
let fastModCheckbox;

let carrierScope = [];
let envelopeScope = [];
let outputScope = [];

// Try changing these constants to hear or see how the sketch responds.
const BASE_AMP = 0.45;
const PERLIN_BUFFER_SIZE = 512;
const PERLIN_PREVIEW_SIZE = 256;
const FAST_RATE_MULTIPLIER = 3;
const FAST_RATE_MAX_HZ = 120;

let audioCtx = null;
let perlinBuffer = null;
let perlinSource = null;
let perlinGainNode = null;
let perlinPreviewChunk = [];

// Setup + UI
function setup() {
  const container = document.getElementById("am-ring-container");
  const canvasWidth = Math.max(320, Math.min(900, container ? container.clientWidth : 900));
  amCanvas = createCanvas(canvasWidth, 430);
  amCanvas.parent(container);

  textFont("monospace");
  createUI(container);

  carrierOsc = new p5.Oscillator("sine");
  carrierOsc.amp(0);

  noiseCarrier = new p5.Noise("white");
  noiseCarrier.amp(0);

  audioCtx = getAudioContext();
  perlinBuffer = createPerlinBuffer();
  perlinPreviewChunk = createPerlinPreviewChunk();
  perlinGainNode = audioCtx.createGain();
  perlinGainNode.gain.value = 0;
  perlinGainNode.connect(audioCtx.destination);

  userStartAudio();
}

function windowResized() {
  const container = document.getElementById("am-ring-container");
  if (!container) return;
  const nextWidth = Math.max(320, Math.min(900, container.clientWidth || 900));
  resizeCanvas(nextWidth, height);
}

function createUI(container) {
  const row = document.createElement("div");
  row.className = "controls controls-panel";

  const cLabel = document.createElement("label");
  cLabel.textContent = "Carrier:";
  row.appendChild(cLabel);

  carrierSelect = document.createElement("select");
  [
    { value: "sine", label: "Sine" },
    { value: "square", label: "Square" },
    { value: "sawtooth", label: "Saw" },
    { value: "triangle", label: "Triangle" },
    { value: "white-noise", label: "White noise" },
    { value: "perlin-noise", label: "Perlin-like noise" },
  ].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    carrierSelect.appendChild(o);
  });
  carrierSelect.value = "white-noise";
  row.appendChild(carrierSelect);

  const mLabel = document.createElement("label");
  mLabel.textContent = "Modulator wave:";
  mLabel.style.marginLeft = "0.75rem";
  row.appendChild(mLabel);

  modWaveSelect = document.createElement("select");
  [
    { value: "sine", label: "Sine" },
    { value: "triangle", label: "Triangle" },
    { value: "square", label: "Square" },
    { value: "noise", label: "Noise" },
  ].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    modWaveSelect.appendChild(o);
  });
  row.appendChild(modWaveSelect);

  const rateGroup = document.createElement("span");
  rateGroup.className = "slider-group";
  const rateLabel = document.createElement("span");
  rateLabel.textContent = "Rate";
  rateGroup.appendChild(rateLabel);

  rateSlider = document.createElement("input");
  rateSlider.type = "range";
  rateSlider.min = "0.1";
  rateSlider.max = "40";
  rateSlider.step = "0.1";
  rateSlider.value = "4";
  rateSlider.style.marginLeft = "0.35rem";
  rateGroup.appendChild(rateSlider);

  const rateVal = document.createElement("span");
  rateVal.textContent = "4.0 Hz";
  rateVal.style.marginLeft = "0.35rem";
  rateGroup.appendChild(rateVal);
  rateSlider.oninput = () => {
    rateVal.textContent = `${parseFloat(rateSlider.value).toFixed(1)} Hz`;
  };
  row.appendChild(rateGroup);

  const depthGroup = document.createElement("span");
  depthGroup.className = "slider-group";
  const depthLabel = document.createElement("span");
  depthLabel.textContent = "Depth";
  depthGroup.appendChild(depthLabel);

  depthSlider = document.createElement("input");
  depthSlider.type = "range";
  depthSlider.min = "0";
  depthSlider.max = "1";
  depthSlider.step = "0.01";
  depthSlider.value = "0.7";
  depthSlider.style.marginLeft = "0.35rem";
  depthGroup.appendChild(depthSlider);

  const depthVal = document.createElement("span");
  depthVal.textContent = "0.70";
  depthVal.style.marginLeft = "0.35rem";
  depthGroup.appendChild(depthVal);
  depthSlider.oninput = () => {
    depthVal.textContent = parseFloat(depthSlider.value).toFixed(2);
  };
  row.appendChild(depthGroup);

  fastModCheckbox = document.createElement("input");
  fastModCheckbox.type = "checkbox";
  fastModCheckbox.id = "fast-mod-toggle";
  fastModCheckbox.style.marginLeft = "0.75rem";
  row.appendChild(fastModCheckbox);

  const audioLabel = document.createElement("label");
  audioLabel.htmlFor = "fast-mod-toggle";
  audioLabel.textContent = "fast mod (ring-mod-ish)";
  audioLabel.style.marginLeft = "0.25rem";
  row.appendChild(audioLabel);

  amPlayButton = document.createElement("button");
  amPlayButton.textContent = "Start";
  amPlayButton.style.marginLeft = "0.75rem";
  amPlayButton.onclick = togglePlay;
  row.appendChild(amPlayButton);

  container.appendChild(row);
}

// Sound + state update
function togglePlay() {
  userStartAudio();

  if (!isPlaying) {
    carrierOsc.start();
    noiseCarrier.start();
    startPerlinLoop();
    isPlaying = true;
    amPlayButton.textContent = "Stop";
    return;
  }

  carrierOsc.stop();
  noiseCarrier.stop();
  stopPerlinLoop();
  isPlaying = false;
  amPlayButton.textContent = "Start";
}

function lfoValue(t, wave) {
  if (wave === "noise") return noise(t * 0.9) * 2 - 1;
  if (wave === "triangle") {
    const p = (t % 1) * 2;
    return p < 1 ? p * 2 - 1 : (2 - p) * 2 - 1;
  }
  if (wave === "square") return t % 1 < 0.5 ? 1 : -1;
  return sin(TWO_PI * t);
}

function carrierPreviewSample(t, carrierType) {
  const previewFrequencyHz = 6;
  const phase = TWO_PI * previewFrequencyHz * t;

  if (carrierType === "white-noise") return random(-1, 1);
  if (carrierType === "perlin-noise") {
    if (!perlinPreviewChunk.length) return 0;
    const phase01 = (t * previewFrequencyHz) % 1;
    const idx = floor(phase01 * perlinPreviewChunk.length);
    return perlinPreviewChunk[constrain(idx, 0, perlinPreviewChunk.length - 1)];
  }
  if (carrierType === "square") return sin(phase) >= 0 ? 1 : -1;
  if (carrierType === "sawtooth") {
    const p = (phase / TWO_PI) % 1;
    return p * 2 - 1;
  }
  if (carrierType === "triangle") {
    const p = (phase / TWO_PI) % 1;
    return p < 0.5 ? p * 4 - 1 : (1 - p) * 4 - 1;
  }
  return sin(phase);
}

// ═══════════════════════════════════════════════════════════════════════════
//  LIVE DEMO — am-ring-mod (search: DEMO_ANCHOR)
// ═══════════════════════════════════════════════════════════════════════════
//   applyAudio() — carrier routing, AM envelope to output.
// ═══════════════════════════════════════════════════════════════════════════
function applyAudio(envelope) {
  if (!isPlaying) return;
  const currentCarrier = carrierSelect ? carrierSelect.value : "white-noise";

  if (currentCarrier === "perlin-noise") {
    startPerlinLoop();
    carrierOsc.amp(0, 0.02);
    noiseCarrier.amp(0, 0.02);
    if (perlinGainNode && audioCtx) {
      perlinGainNode.gain.setTargetAtTime(
        BASE_AMP * envelope,
        audioCtx.currentTime,
        0.02
      );
    }
    return;
  }

  if (currentCarrier === "white-noise") {
    if (perlinGainNode && audioCtx) {
      perlinGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02);
    }
    carrierOsc.amp(0, 0.02);
    noiseCarrier.amp(BASE_AMP * envelope, 0.02);
    return;
  }

  if (perlinGainNode && audioCtx) {
    perlinGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02);
  }
  carrierOsc.setType(currentCarrier);
  carrierOsc.freq(220);
  carrierOsc.amp(BASE_AMP * envelope, 0.02);
  noiseCarrier.amp(0, 0.02);
}

function createPerlinBuffer() {
  if (!audioCtx) return null;
  const buf = audioCtx.createBuffer(1, PERLIN_BUFFER_SIZE, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  const scale = 3.0 / PERLIN_BUFFER_SIZE;
  for (let i = 0; i < PERLIN_BUFFER_SIZE; i++) {
    data[i] = noise(i * scale) * 2 - 1;
  }
  return buf;
}

function createPerlinPreviewChunk() {
  const chunk = new Array(PERLIN_PREVIEW_SIZE);
  const scale = 3.0 / PERLIN_PREVIEW_SIZE;
  for (let i = 0; i < PERLIN_PREVIEW_SIZE; i++) {
    chunk[i] = noise(i * scale) * 2 - 1;
  }
  return chunk;
}

function startPerlinLoop() {
  if (!audioCtx || !perlinBuffer || perlinSource) return;
  perlinSource = audioCtx.createBufferSource();
  perlinSource.buffer = perlinBuffer;
  perlinSource.loop = true;
  perlinSource.connect(perlinGainNode);
  perlinSource.start();
}

function stopPerlinLoop() {
  if (!perlinSource) return;
  try {
    perlinSource.stop();
  } catch (_e) {
    // already stopped
  }
  perlinSource.disconnect();
  perlinSource = null;
}

function updateAMState(now) {
  const depth = parseFloat(depthSlider ? depthSlider.value : 0.7);
  let rate = parseFloat(rateSlider ? rateSlider.value : 4);
  const isFastMod = fastModCheckbox && fastModCheckbox.checked;
  if (isFastMod) rate = constrain(rate * FAST_RATE_MULTIPLIER, 2, FAST_RATE_MAX_HZ);

  const wave = modWaveSelect ? modWaveSelect.value : "sine";
  const lfo = lfoValue(rate * now, wave);
  const lfo01 = (lfo + 1) / 2;
  const envelope = 1 - depth + depth * lfo01;
  applyAudio(envelope);

  const currentCarrier = carrierSelect ? carrierSelect.value : "white-noise";
  const previewCarrier = carrierPreviewSample(now, currentCarrier);
  const previewOutput = previewCarrier * envelope;

  const panelWidth = width - 40;
  carrierScope = [...carrierScope, previewCarrier].slice(-panelWidth);
  envelopeScope = [...envelopeScope, envelope].slice(-panelWidth);
  outputScope = [...outputScope, previewOutput].slice(-panelWidth);

  return { isFastMod };
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
    const source = bipolarFromUnit ? map(scopeData[i], 0, 1, -1, 1) : scopeData[i];
    const y = map(
      source,
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
  const state = updateAMState(now);

  const titleText = "Amplitude modulation / ring-mod-ish";
  textSize(14);
  const titleW = textWidth(titleText) + 12;
  fill(0);
  noStroke();
  rect(14, 10, titleW, 20, 6);
  fill(255);
  text(titleText, 20, 24);

  drawScopePanel(carrierScope, 95, "carrier waveform", false);
  drawScopePanel(envelopeScope, 220, "envelope over time", true);
  drawScopePanel(outputScope, 345, "output waveform", false);

  const modeLabel = state.isFastMod
    ? "fast modulation -> ring-mod-ish, new timbres"
    : "low-rate modulation -> tremolo / rhythmic pulsing";
  textSize(11);
  const mW = textWidth(modeLabel) + 10;
  const mX = 20;
  const mY = height - 12;
  fill(0);
  rect(mX - 4, mY - 12, mW, 16, 4);
  fill(255);
  text(modeLabel, mX, mY);
}
