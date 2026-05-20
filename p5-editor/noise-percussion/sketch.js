/*
 * p5.js Web Editor learning copy
 * Learning goal: Shape noise with triggered envelopes to turn raw noise into rhythmic percussion.
 * Try changing: BASE_AMP, sequence choices, or default envelope timing controls.
 *
 * Paste this file into sketch.js in the p5.js Web Editor, or upload it with
 * the matching index.html from this folder. The sound code uses p5.sound plus
 * browser Web Audio nodes, so press the sketch's Start/Play button before
 * expecting audio.
 */

/**
 * Noise Percussion (no build step)
 *
 * How it works:
 * - A noise-like source is shaped by a triggered envelope to create percussive hits.
 * - A simple step sequence gates which steps trigger.
 * - UI controls adjust hit rate, envelope type/shape, and transient/decay times.
 * - Scheduling uses `audioCtx.currentTime` so timing stays stable even if draw() jitters.
 */
let percCanvas;
let noiseCarrier;
let isPlaying = false;

let playButton;
let sourceSelect;
let envRateSlider;
let envSequenceSelect;
let envTypeSelect;
let envAttackSlider;
let envAttackCurveSelect;
let envTailSlider;

let lastTriggerTime = 0;
let nextStepTime = 0;
let sequenceStepIndex = 0;

let triggerScope = [];
let sourceScope = [];
let envelopeScope = [];
let outputScope = [];

// Try changing these constants to hear or see how the sketch responds.
const BASE_AMP = 0.52;
const PERLIN_BUFFER_SIZE = 512;
const PERLIN_PREVIEW_SIZE = 256;

let audioCtx = null;
let perlinBuffer = null;
let perlinSource = null;
let perlinGainNode = null;
let perlinPreviewChunk = [];

// Setup + UI
function setup() {
  const container = document.getElementById("noise-perc-container");
  const canvasWidth = Math.max(320, Math.min(900, container ? container.clientWidth : 900));
  percCanvas = createCanvas(canvasWidth, 545);
  percCanvas.parent(container);

  textFont("monospace");
  createUI(container);

  audioCtx = getAudioContext();
  noiseCarrier = new p5.Noise("white");
  noiseCarrier.amp(0);
  perlinBuffer = createPerlinBuffer();
  perlinPreviewChunk = createPerlinPreviewChunk();
  perlinGainNode = audioCtx.createGain();
  perlinGainNode.gain.value = 0;
  perlinGainNode.connect(audioCtx.destination);

  userStartAudio();
}

function windowResized() {
  const container = document.getElementById("noise-perc-container");
  if (!container) return;
  const nextWidth = Math.max(320, Math.min(900, container.clientWidth || 900));
  resizeCanvas(nextWidth, height);
}

function createUI(container) {
  const topRow = document.createElement("div");
  topRow.className = "controls controls-panel";

  playButton = document.createElement("button");
  playButton.textContent = "Start";
  playButton.onclick = togglePlay;
  topRow.appendChild(playButton);
  container.appendChild(topRow);

  const row = document.createElement("div");
  row.className = "controls controls-row";

  const sourceLabel = document.createElement("label");
  sourceLabel.textContent = "Source:";
  row.appendChild(sourceLabel);

  sourceSelect = document.createElement("select");
  [
    { value: "white", label: "White noise" },
    { value: "perlin", label: "Perlin sampled loop" },
  ].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    sourceSelect.appendChild(o);
  });
  sourceSelect.value = "perlin";
  sourceSelect.onchange = () => {
    resetScopes();
    if (!isPlaying) return;
    if (getSourceMode() === "perlin") {
      startPerlinLoop();
      noiseCarrier.amp(0, 0.01);
    } else {
      stopPerlinLoop();
      if (!noiseCarrier.started) noiseCarrier.start();
    }
  };
  row.appendChild(sourceSelect);

  const rateGroup = document.createElement("span");
  rateGroup.className = "slider-group";
  const rateLabel = document.createElement("span");
  rateLabel.textContent = "Hit rate";
  rateGroup.appendChild(rateLabel);

  envRateSlider = document.createElement("input");
  envRateSlider.type = "range";
  envRateSlider.min = "0.5";
  envRateSlider.max = "12";
  envRateSlider.step = "0.1";
  envRateSlider.value = "3.2";
  envRateSlider.style.marginLeft = "0.35rem";
  rateGroup.appendChild(envRateSlider);

  const rateValue = document.createElement("span");
  rateValue.textContent = "3.2 Hz";
  rateValue.style.marginLeft = "0.35rem";
  rateGroup.appendChild(rateValue);
  envRateSlider.oninput = () => {
    rateValue.textContent = `${parseFloat(envRateSlider.value).toFixed(1)} Hz`;
  };
  row.appendChild(rateGroup);

  const sequenceLabel = document.createElement("label");
  sequenceLabel.textContent = "Sequence:";
  sequenceLabel.style.marginLeft = "0.75rem";
  row.appendChild(sequenceLabel);

  envSequenceSelect = document.createElement("select");
  [
    { value: "straight", label: "Straight" },
    { value: "offbeat", label: "Offbeat" },
    { value: "syncopated", label: "Syncopated" },
    { value: "tripletish", label: "Triplet-ish" },
    { value: "sparse", label: "Sparse" },
  ].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    envSequenceSelect.appendChild(o);
  });
  envSequenceSelect.value = "syncopated";
  envSequenceSelect.onchange = () => {
    const now = millis() / 1000;
    sequenceStepIndex = 0;
    nextStepTime = now;
    lastTriggerTime = now - 1;
    resetScopes();
  };
  row.appendChild(envSequenceSelect);

  const typeLabel = document.createElement("label");
  typeLabel.textContent = "Envelope:";
  typeLabel.style.marginLeft = "0.75rem";
  row.appendChild(typeLabel);

  envTypeSelect = document.createElement("select");
  [
    { value: "ad", label: "AD" },
    { value: "ar", label: "AR" },
  ].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    envTypeSelect.appendChild(o);
  });
  envTypeSelect.value = "ad";
  row.appendChild(envTypeSelect);

  const attackGroup = document.createElement("span");
  attackGroup.className = "slider-group";
  const attackLabel = document.createElement("span");
  attackLabel.textContent = "Attack";
  attackGroup.appendChild(attackLabel);

  envAttackSlider = document.createElement("input");
  envAttackSlider.type = "range";
  envAttackSlider.min = "0.001";
  envAttackSlider.max = "0.12";
  envAttackSlider.step = "0.001";
  envAttackSlider.value = "0.006";
  envAttackSlider.style.marginLeft = "0.35rem";
  attackGroup.appendChild(envAttackSlider);

  const attackValue = document.createElement("span");
  attackValue.textContent = "6 ms";
  attackValue.style.marginLeft = "0.35rem";
  attackGroup.appendChild(attackValue);
  envAttackSlider.oninput = () => {
    attackValue.textContent = `${Math.round(
      parseFloat(envAttackSlider.value) * 1000
    )} ms`;
  };
  row.appendChild(attackGroup);

  const curveLabel = document.createElement("label");
  curveLabel.textContent = "Attack curve:";
  curveLabel.style.marginLeft = "0.75rem";
  row.appendChild(curveLabel);

  envAttackCurveSelect = document.createElement("select");
  [
    { value: "linear", label: "Linear" },
    { value: "exponential", label: "Exponential" },
    { value: "logarithmic", label: "Logarithmic" },
  ].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    envAttackCurveSelect.appendChild(o);
  });
  envAttackCurveSelect.value = "linear";
  row.appendChild(envAttackCurveSelect);

  const tailGroup = document.createElement("span");
  tailGroup.className = "slider-group";
  const tailLabel = document.createElement("span");
  tailLabel.textContent = "Decay/Release";
  tailGroup.appendChild(tailLabel);

  envTailSlider = document.createElement("input");
  envTailSlider.type = "range";
  envTailSlider.min = "0.02";
  envTailSlider.max = "1.0";
  envTailSlider.step = "0.01";
  envTailSlider.value = "0.22";
  envTailSlider.style.marginLeft = "0.35rem";
  tailGroup.appendChild(envTailSlider);

  const tailValue = document.createElement("span");
  tailValue.textContent = "220 ms";
  tailValue.style.marginLeft = "0.35rem";
  tailGroup.appendChild(tailValue);
  envTailSlider.oninput = () => {
    tailValue.textContent = `${Math.round(
      parseFloat(envTailSlider.value) * 1000
    )} ms`;
  };
  row.appendChild(tailGroup);

  container.appendChild(row);
}

// Sound + state update
function togglePlay() {
  userStartAudio();
  if (!isPlaying) {
    const now = millis() / 1000;
    noiseCarrier.start();
    if (getSourceMode() === "perlin") startPerlinLoop();
    isPlaying = true;
    playButton.textContent = "Stop";
    lastTriggerTime = now;
    nextStepTime = now;
    sequenceStepIndex = 0;
    return;
  }

  noiseCarrier.stop();
  stopPerlinLoop();
  isPlaying = false;
  playButton.textContent = "Start";
}

function resetScopes() {
  triggerScope = [];
  sourceScope = [];
  envelopeScope = [];
  outputScope = [];
}

function shapeAttack(progress, curve) {
  const x = constrain(progress, 0, 1);
  if (curve === "exponential") return pow(x, 3);
  if (curve === "logarithmic") return 1 - pow(1 - x, 3);
  return x;
}

function shapeDecayOrRelease(progress, curve) {
  const x = constrain(progress, 0, 1);
  // Reuse the same curve family for falling segments by shaping (1 - progress).
  return shapeAttack(1 - x, curve);
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

function perlinPreviewSample(t) {
  if (!perlinPreviewChunk.length) return 0;
  const previewFrequencyHz = 8;
  const phase01 = (t * previewFrequencyHz) % 1;
  const idx = floor(phase01 * perlinPreviewChunk.length);
  return perlinPreviewChunk[constrain(idx, 0, perlinPreviewChunk.length - 1)];
}

function getSourceMode() {
  return sourceSelect ? sourceSelect.value : "perlin";
}

function getSequencePattern() {
  const sequence = envSequenceSelect ? envSequenceSelect.value : "syncopated";
  if (sequence === "straight") return [1, 1, 1, 1];
  if (sequence === "offbeat") return [0, 1, 0, 1, 0, 1, 0, 1];
  if (sequence === "tripletish") return [1, 0, 1, 1, 0, 1];
  if (sequence === "sparse") return [1, 0, 0, 0, 1, 0, 1, 0];
  return [1, 0, 1, 0, 0, 1, 0, 1]; // syncopated
}

function getEnvelopeAt(t) {
  let triggerNow = false;

  const hitRate = max(0.5, parseFloat(envRateSlider ? envRateSlider.value : 3.2));
  const interval = 1 / hitRate;
  const pattern = getSequencePattern();

  if (nextStepTime <= 0) nextStepTime = t;

  while (t >= nextStepTime) {
    const isActiveStep = pattern[sequenceStepIndex % pattern.length] === 1;
    if (isActiveStep) {
      lastTriggerTime = nextStepTime;
      triggerNow = true;
    }
    sequenceStepIndex += 1;
    nextStepTime += interval;
  }

  const attack = max(0.001, parseFloat(envAttackSlider ? envAttackSlider.value : 0.006));
  const tail = max(0.01, parseFloat(envTailSlider ? envTailSlider.value : 0.22));
  const elapsed = max(0, t - lastTriggerTime);
  const envType = envTypeSelect ? envTypeSelect.value : "ad";
  const attackCurve = envAttackCurveSelect
    ? envAttackCurveSelect.value
    : "linear";

  if (envType === "ar") {
    const hold = max(0.01, interval * 0.35);
    if (elapsed < attack) {
      return {
        envelope: shapeAttack(elapsed / attack, attackCurve),
        triggerNow,
      };
    }
    if (elapsed < attack + hold) return { envelope: 1, triggerNow };
    if (elapsed < attack + hold + tail) {
      const releaseProgress = (elapsed - attack - hold) / tail;
      return {
        envelope: shapeDecayOrRelease(releaseProgress, attackCurve),
        triggerNow,
      };
    }
    return { envelope: 0, triggerNow };
  }

  if (elapsed < attack) {
    return {
      envelope: shapeAttack(elapsed / attack, attackCurve),
      triggerNow,
    };
  }
  if (elapsed < attack + tail) {
    const decayProgress = (elapsed - attack) / tail;
    return {
      envelope: shapeDecayOrRelease(decayProgress, attackCurve),
      triggerNow,
    };
  }
  return { envelope: 0, triggerNow };
}

// ═══════════════════════════════════════════════════════════════════════════
//  LIVE DEMO — noise-percussion (search: DEMO_ANCHOR)
// ═══════════════════════════════════════════════════════════════════════════
//   updatePercussionState() — envelope + noise source mix per step.
// ═══════════════════════════════════════════════════════════════════════════
function updatePercussionState(now) {
  const result = getEnvelopeAt(now);
  const envelope = constrain(result.envelope, 0, 1);
  const triggerNow = result.triggerNow;
  const sourceMode = getSourceMode();

  if (isPlaying && audioCtx) {
    if (sourceMode === "perlin") {
      startPerlinLoop();
      noiseCarrier.amp(0, 0.01);
      if (perlinGainNode) {
        perlinGainNode.gain.setTargetAtTime(
          BASE_AMP * envelope,
          audioCtx.currentTime,
          0.01
        );
      }
    } else {
      stopPerlinLoop();
      noiseCarrier.amp(BASE_AMP * envelope, 0.01);
    }
  }

  const sourceNoise =
    sourceMode === "perlin" ? perlinPreviewSample(now) : random(-1, 1);
  const output = sourceNoise * envelope;
  const triggerValue = triggerNow ? 1 : 0;
  const panelWidth = width - 40;

  triggerScope = [...triggerScope, triggerValue].slice(-panelWidth);
  sourceScope = [...sourceScope, sourceNoise].slice(-panelWidth);
  envelopeScope = [...envelopeScope, envelope].slice(-panelWidth);
  outputScope = [...outputScope, output].slice(-panelWidth);

  return { sourceMode };
}

// Rendering
function drawScopePanel(scopeData, centerY, label, bipolarFromUnit) {
  const panelWidth = width - 40;
  const panelHalfHeight = 48;

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
  const state = updatePercussionState(now);

  const title = "Noise percussion: triggered AD/AR envelope hits";
  textSize(14);
  const titleW = textWidth(title) + 12;
  fill(0);
  noStroke();
  rect(14, 10, titleW, 20, 6);
  fill(255);
  text(title, 20, 24);

  drawScopePanel(triggerScope, 100, "trigger events", true);
  drawScopePanel(sourceScope, 220, "noise source", false);
  drawScopePanel(envelopeScope, 340, "envelope / control", true);
  drawScopePanel(outputScope, 460, "output waveform", false);

  const curve = envAttackCurveSelect
    ? envAttackCurveSelect.value
    : "linear";
  const sequence = envSequenceSelect ? envSequenceSelect.value : "syncopated";
  const modeLabel = `AD/AR hits · ${state.sourceMode} source · ${sequence} sequence · ${curve} A/D/R curve`;
  textSize(11);
  const mW = textWidth(modeLabel) + 10;
  fill(0);
  rect(16, height - 18, mW, 16, 4);
  fill(255);
  text(modeLabel, 20, height - 6);
}
