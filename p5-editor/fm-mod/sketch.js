/*
 * p5.js Web Editor learning copy
 * Learning goal: Use one signal to push another oscillator's frequency, moving from vibrato to complex timbre.
 * Try changing: FM_BASE_AMP or the default carrier/modulator controls in createFMUI().
 *
 * Paste this file into sketch.js in the p5.js Web Editor, or upload it with
 * the matching index.html from this folder. The sound code uses p5.sound plus
 * browser Web Audio nodes, so press the sketch's Start/Play button before
 * expecting audio.
 */

/**
 * FM modulation (no build step)
 *
 * How it works:
 * - A carrier oscillator (what you hear) has its frequency pushed around by a modulator signal.
 * - Slow modulation sounds like vibrato; faster modulation adds rougher timbre.
 * - UI controls set carrier waveform, modulator source, base frequency, modulator frequency, and modulation index.
 * - Audio starts only after a user gesture (`userStartAudio()`), per browser policy.
 */
let fmCanvas;

let fmCarrier;
let fmIsPlaying = false;

let fmPlayButton;
let fmWaveSelect;
let fmModSourceSelect;
let fmBaseFreqSlider;
let fmModFreqSlider;
let fmIndexSlider;

let fmModScope = [];
let fmFreqScope = [];
let fmOutputScope = [];

let fmPreviewPhase = 0;
let fmLastTime = 0;

// Try changing these constants to hear or see how the sketch responds.
const FM_BASE_AMP = 0.35;
const FM_MAX_MOD_FREQ = 24;
const FM_MAX_INDEX = 500;
const FM_FREQ_SMOOTHING_SEC = 0.015;

// Setup + UI
function setup() {
  const container = document.getElementById("fm-container");
  const canvasWidth = Math.max(320, Math.min(900, container ? container.clientWidth : 900));
  fmCanvas = createCanvas(canvasWidth, 430);
  fmCanvas.parent(container);

  textFont("monospace");
  createFMUI(container);

  fmCarrier = new p5.Oscillator("sine");
  fmCarrier.freq(220);
  fmCarrier.amp(0);

  userStartAudio();
}

function windowResized() {
  const container = document.getElementById("fm-container");
  if (!container) return;
  const nextWidth = Math.max(320, Math.min(900, container.clientWidth || 900));
  resizeCanvas(nextWidth, height);
}

function createFMUI(container) {
  const panel = document.createElement("div");
  panel.className = "controls controls-panel";

  const row = document.createElement("div");
  row.className = "row";

  const rowLabel = document.createElement("span");
  rowLabel.className = "row-label";
  rowLabel.textContent = "FM controls";
  row.appendChild(rowLabel);

  {
    const group = document.createElement("span");

    const cLabel = document.createElement("label");
    cLabel.textContent = "Carrier";
    group.appendChild(cLabel);

    fmWaveSelect = document.createElement("select");
    [
      { value: "sine", label: "Sine" },
      { value: "triangle", label: "Triangle" },
      { value: "square", label: "Square" },
      { value: "sawtooth", label: "Sawtooth" },
    ].forEach((w) => {
      const o = document.createElement("option");
      o.value = w.value;
      o.textContent = w.label;
      fmWaveSelect.appendChild(o);
    });
    fmWaveSelect.value = "sine";
    group.appendChild(fmWaveSelect);

    const mLabel = document.createElement("label");
    mLabel.textContent = "Modulator source";
    group.appendChild(mLabel);

    fmModSourceSelect = document.createElement("select");
    [
      { value: "sine", label: "Sine" },
      { value: "triangle", label: "Triangle" },
      { value: "square", label: "Square" },
      { value: "white-noise", label: "White noise" },
      { value: "perlin-noise", label: "Perlin-like noise" },
    ].forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      fmModSourceSelect.appendChild(o);
    });
    fmModSourceSelect.value = "sine";
    group.appendChild(fmModSourceSelect);

    fmPlayButton = document.createElement("button");
    fmPlayButton.textContent = "Start";
    fmPlayButton.onclick = toggleFMPlay;
    group.appendChild(fmPlayButton);

    row.appendChild(group);
  }

  const sliderGroup = (labelText, minV, maxV, stepV, defaultV, fmt) => {
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
  };

  {
    const g = sliderGroup("Base frequency", 80, 880, 1, 220, (v) => `${Math.round(v)} Hz`);
    fmBaseFreqSlider = g.slider;
    row.appendChild(g.group);
  }

  {
    const g = sliderGroup("Modulator frequency", 0.1, FM_MAX_MOD_FREQ, 0.1, 3, (v) => `${v.toFixed(1)} Hz`);
    fmModFreqSlider = g.slider;
    row.appendChild(g.group);
  }

  {
    const g = sliderGroup("Modulation index", 0, FM_MAX_INDEX, 10, 160, (v) => `${Math.round(v)}`);
    fmIndexSlider = g.slider;
    row.appendChild(g.group);
  }

  panel.appendChild(row);
  container.appendChild(panel);
}

// Sound + state update
function toggleFMPlay() {
  userStartAudio();

  if (!fmIsPlaying) {
    if (!fmCarrier.started) fmCarrier.start();
    fmCarrier.amp(FM_BASE_AMP, 0.05);
    fmIsPlaying = true;
    fmPreviewPhase = 0;
    fmLastTime = millis() / 1000;
    fmPlayButton.textContent = "Stop";
    return;
  }

  fmCarrier.amp(0, 0.04);
  fmIsPlaying = false;
  fmPlayButton.textContent = "Start";
}

// ═══════════════════════════════════════════════════════════════════════════
//  LIVE DEMO — fm-mod (search: DEMO_ANCHOR)
// ═══════════════════════════════════════════════════════════════════════════
//   fmModSignal() — modulation source shapes the operator output.
// ═══════════════════════════════════════════════════════════════════════════
function fmModSignal(t, source, freq) {
  if (source === "white-noise") return random(-1, 1);
  if (source === "perlin-noise") return noise(t * freq * 0.2) * 2 - 1;

  const phase = TWO_PI * freq * t;
  if (source === "triangle") {
    const p = (phase / TWO_PI) % 1;
    return p < 0.5 ? p * 4 - 1 : (1 - p) * 4 - 1;
  }
  if (source === "square") return sin(phase) >= 0 ? 1 : -1;
  return sin(phase);
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

  const baseFreq = parseFloat(fmBaseFreqSlider ? fmBaseFreqSlider.value : 220);
  const modFreq = parseFloat(fmModFreqSlider ? fmModFreqSlider.value : 3);
  const index = parseFloat(fmIndexSlider ? fmIndexSlider.value : 200);
  const modSource = fmModSourceSelect ? fmModSourceSelect.value : "sine";

  const now = millis() / 1000;
  const dt = fmLastTime > 0 ? now - fmLastTime : 0;
  fmLastTime = now;

  const modSignal = fmModSignal(now, modSource, modFreq);
  const currentFreq = constrain(baseFreq + modSignal * index, 20, 4000);

  if (fmIsPlaying) {
    fmCarrier.setType(fmWaveSelect ? fmWaveSelect.value : "sine");
    fmCarrier.freq(currentFreq, FM_FREQ_SMOOTHING_SEC);
  }

  fmPreviewPhase += TWO_PI * currentFreq * max(dt, 0);
  const previewOut = sin(fmPreviewPhase);
  const freqAsBipolar = map(log(currentFreq), log(40), log(2000), -1, 1, true);

  const panelWidth = width - 40;
  fmModScope.push(modSignal);
  fmFreqScope.push(freqAsBipolar);
  fmOutputScope.push(previewOut);
  if (fmModScope.length > panelWidth) fmModScope.shift();
  if (fmFreqScope.length > panelWidth) fmFreqScope.shift();
  if (fmOutputScope.length > panelWidth) fmOutputScope.shift();

  const titleText = "Frequency modulation";
  textSize(14);
  const titleW = textWidth(titleText) + 12;
  fill(0);
  noStroke();
  rect(14, 10, titleW, 20, 6);
  fill(255);
  text(titleText, 20, 24);

  drawScopePanel(fmModScope, 95, "modulator signal", false);
  drawScopePanel(fmFreqScope, 220, "carrier frequency (log mapped)", false);
  drawScopePanel(fmOutputScope, 345, "carrier output preview", false);

  const modeLabel = `base ${Math.round(baseFreq)} Hz · mod ${modFreq.toFixed(
    1
  )} Hz · index ${Math.round(index)} · current ${Math.round(currentFreq)} Hz`;
  textSize(11);
  const mW = textWidth(modeLabel) + 10;
  const mX = 20;
  const mY = height - 12;
  fill(0);
  rect(mX - 4, mY - 12, mW, 16, 4);
  fill(255);
  text(modeLabel, mX, mY);
}
