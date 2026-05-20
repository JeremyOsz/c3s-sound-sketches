/*
 * p5.js Web Editor learning copy
 * Learning goal: Build a waveform from sine partials, write it into a wavetable, and loop it as an oscillator.
 * Try changing: WT_SIZE or the default partial slider values in createWTUI().
 *
 * Paste this file into sketch.js in the p5.js Web Editor, or upload it with
 * the matching index.html from this folder. The sound code uses p5.sound plus
 * browser Web Audio nodes, so press the sketch's Start/Play button before
 * expecting audio.
 */

/**
 * Wavetable / additive synthesis (no build step)
 *
 * How it works:
 * - A handful of sine partials are summed to define one waveform cycle.
 * - That cycle is written into an AudioBuffer (“wavetable”) and looped as an oscillator.
 * - UI controls adjust base pitch and each partial’s amplitude.
 * - Audio starts only after a user gesture (`userStartAudio()`), per browser policy.
 */
// Try changing these constants to hear or see how the sketch responds.
const WT_SIZE = 2048;

let wtCanvas;
let wtPlayButton;
let baseFreqSlider;
let partialSliders = [];
let wavetableBuffer = null;
let wtSource = null;
let audioCtxWT = null;

let wtCycleScope = [];
let wtLoopScope = [];
let wtPartialsScope = [];

// Setup + UI
function setup() {
  const container = document.getElementById("wavetable-container");
  const canvasWidth = Math.max(320, Math.min(960, container ? container.clientWidth : 960));
  wtCanvas = createCanvas(canvasWidth, 430);
  wtCanvas.parent(container);

  textFont("monospace");

  createWTUI(container);
  audioCtxWT = getAudioContext();
  rebuildWavetable();
}

function windowResized() {
  const container = document.getElementById("wavetable-container");
  if (!container) return;
  const nextWidth = Math.max(320, Math.min(960, container.clientWidth || 960));
  resizeCanvas(nextWidth, height);
}

function createWTUI(container) {
  const panel = document.createElement("div");
  panel.className = "controls controls-panel";

  const playbackRow = document.createElement("div");
  playbackRow.className = "row";

  const playbackLabel = document.createElement("span");
  playbackLabel.className = "row-label";
  playbackLabel.textContent = "Playback";
  playbackRow.appendChild(playbackLabel);

  const baseGroup = document.createElement("span");
  baseGroup.className = "slider-group";

  const baseName = document.createElement("span");
  baseName.className = "slider-label";
  baseName.textContent = "Base";
  baseGroup.appendChild(baseName);

  baseFreqSlider = document.createElement("input");
  baseFreqSlider.type = "range";
  baseFreqSlider.min = "60";
  baseFreqSlider.max = "880";
  baseFreqSlider.step = "1";
  baseFreqSlider.value = "110";
  baseGroup.appendChild(baseFreqSlider);

  const baseVal = document.createElement("span");
  baseVal.className = "slider-value";
  baseVal.textContent = "110 Hz";
  baseGroup.appendChild(baseVal);

  baseFreqSlider.oninput = () => {
    const f = parseFloat(baseFreqSlider.value);
    baseVal.textContent = `${Math.round(f)} Hz`;
    if (wtSource) wtSource.playbackRate.value = f / 110;
  };
  playbackRow.appendChild(baseGroup);

  wtPlayButton = document.createElement("button");
  wtPlayButton.textContent = "Start";
  wtPlayButton.onclick = toggleWTPlay;
  playbackRow.appendChild(wtPlayButton);

  const partialRow = document.createElement("div");
  partialRow.className = "row";

  const partialLabel = document.createElement("span");
  partialLabel.className = "row-label";
  partialLabel.textContent = "Partial amplitudes";
  partialRow.appendChild(partialLabel);

  for (let i = 1; i <= 4; i++) {
    const group = document.createElement("span");
    group.className = "slider-group";

    const label = document.createElement("span");
    label.className = "slider-label";
    label.textContent = `${i}x`;
    group.appendChild(label);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.01";
    slider.value = i === 1 ? "1" : "0";
    group.appendChild(slider);

    const valueSpan = document.createElement("span");
    valueSpan.className = "slider-value";
    valueSpan.textContent = parseFloat(slider.value).toFixed(2);
    group.appendChild(valueSpan);

    slider.oninput = () => {
      valueSpan.textContent = parseFloat(slider.value).toFixed(2);
      rebuildWavetable();
    };

    partialSliders.push(slider);
    partialRow.appendChild(group);
  }

  panel.appendChild(playbackRow);
  panel.appendChild(partialRow);
  container.appendChild(panel);
}

// ═══════════════════════════════════════════════════════════════════════════
//  LIVE DEMO — wavetable (search: DEMO_ANCHOR)
// ═══════════════════════════════════════════════════════════════════════════
//   rebuildWavetable() — additive partials fill the wavetable buffer.
// ═══════════════════════════════════════════════════════════════════════════

function rebuildWavetable() {
  userStartAudio();
  const buf = audioCtxWT.createBuffer(1, WT_SIZE, audioCtxWT.sampleRate);
  const data = buf.getChannelData(0);

  for (let i = 0; i < WT_SIZE; i++) {
    const phase = (i / WT_SIZE) * TWO_PI;
    let sample = 0;
    partialSliders.forEach((slider, idx) => {
      const n = idx + 1;
      const amp = parseFloat(slider.value);
      if (amp > 0) sample += amp * sin(phase * n);
    });
    data[i] = sample;
  }

  let maxMag = 0;
  for (let i = 0; i < WT_SIZE; i++) maxMag = max(maxMag, abs(data[i]));
  if (maxMag > 0) {
    const scale = 1 / maxMag;
    for (let i = 0; i < WT_SIZE; i++) data[i] *= scale;
  }

  wavetableBuffer = buf;

  if (wtSource) {
    stopWTPlayback();
    startWTPlayback();
  }
}

function startWTPlayback() {
  if (!wavetableBuffer) return;
  const f = parseFloat(baseFreqSlider.value);
  wtSource = audioCtxWT.createBufferSource();
  wtSource.buffer = wavetableBuffer;
  wtSource.loop = true;
  wtSource.playbackRate.value = f / 110;
  wtSource.connect(audioCtxWT.destination);
  wtSource.start();
  wtPlayButton.textContent = "Stop";
}

function stopWTPlayback() {
  if (!wtSource) return;
  try {
    wtSource.stop();
  } catch (_e) {
    // ignore
  }
  wtSource.disconnect();
  wtSource = null;
  wtPlayButton.textContent = "Start";
}

function toggleWTPlay() {
  userStartAudio();
  if (wtSource) stopWTPlayback();
  else startWTPlayback();
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

function buildWTScopeData(panelWidth, data) {
  const cycleScope = [];
  const loopScope = [];
  const partialsScope = [];

  for (let i = 0; i < panelWidth; i++) {
    const idx = floor(map(i, 0, panelWidth - 1, 0, WT_SIZE - 1));
    cycleScope.push(data[idx]);
  }

  const repeats = 4;
  for (let i = 0; i < panelWidth; i++) {
    const localX = i % floor(panelWidth / repeats);
    const mapped = map(localX, 0, floor(panelWidth / repeats) - 1, 0, WT_SIZE - 1);
    loopScope.push(data[constrain(floor(mapped), 0, WT_SIZE - 1)]);
  }

  for (let i = 0; i < panelWidth; i++) {
    const phase = (i / panelWidth) * TWO_PI;
    let s = 0;
    partialSliders.forEach((slider, idx) => {
      s += parseFloat(slider.value) * sin(phase * (idx + 1));
    });
    partialsScope.push(constrain(s, -1, 1));
  }

  return { cycleScope, loopScope, partialsScope };
}

function draw() {
  background(250);
  if (!wavetableBuffer) return;

  const data = wavetableBuffer.getChannelData(0);
  const panelWidth = width - 40;
  const scopes = buildWTScopeData(panelWidth, data);
  wtCycleScope = scopes.cycleScope;
  wtLoopScope = scopes.loopScope;
  wtPartialsScope = scopes.partialsScope;

  const titleText = "Wavetable / additive synthesis";
  textSize(14);
  const titleW = textWidth(titleText) + 12;
  fill(0);
  noStroke();
  rect(14, 10, titleW, 20, 6);
  fill(255);
  text(titleText, 20, 24);

  drawScopePanel(wtCycleScope, 95, "single wavetable cycle");
  drawScopePanel(wtLoopScope, 220, "cycle repeated as oscillator");
  drawScopePanel(wtPartialsScope, 345, "partial-sum shape preview");

  const partialSummary = partialSliders
    .map((s, i) => `${i + 1}x:${parseFloat(s.value).toFixed(2)}`)
    .join(" ");
  const modeLabel = `base ${Math.round(
    parseFloat(baseFreqSlider.value)
  )} Hz · ${partialSummary}`;
  textSize(11);
  const mW = textWidth(modeLabel) + 10;
  fill(0);
  rect(16, height - 18, mW, 16, 4);
  fill(255);
  text(modeLabel, 20, height - 6);
}
