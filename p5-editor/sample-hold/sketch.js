/*
 * p5.js Web Editor learning copy
 * Learning goal: Sample a random signal at a fixed rate and hold each value to create stepped pitch movement.
 * Try changing: MAJOR_SCALE, SH_BASE_AMP, or the default base/range/rate slider values.
 *
 * Paste this file into sketch.js in the p5.js Web Editor, or upload it with
 * the matching index.html from this folder. The sound code uses p5.sound plus
 * browser Web Audio nodes, so press the sketch's Start/Play button before
 * expecting audio.
 */

/**
 * Sample & Hold (no build step)
 *
 * How it works:
 * - We sample a noise signal at a fixed rate and hold that value between samples.
 * - The held value is mapped to oscillator frequency, producing stepped pitch changes.
 * - Optional quantisation snaps those pitches to a scale.
 * - UI controls adjust base pitch, range, sampling rate, and quantisation.
 */
let shCanvas;

let shCarrier;

let shPlayButton;
let rateSlider;
let baseFreqSlider;
let rangeSlider;
let quantizeCheckbox;

let heldValue = 0;
let lastSampleTime = 0;
let previewPhase = 0;
let lastDrawTime = 0;

let sourceScope = [];
let holdScope = [];
let outputScope = [];

// Try changing these constants to hear or see how the sketch responds.
const SH_BASE_AMP = 0.35;
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11, 12];

// Setup + UI
function setup() {
  const container = document.getElementById("sh-container");
  const canvasWidth = Math.max(320, Math.min(900, container ? container.clientWidth : 900));
  shCanvas = createCanvas(canvasWidth, 430);
  shCanvas.parent(container);

  textFont("monospace");
  createSHUI(container);

  shCarrier = new p5.Oscillator("square");
  shCarrier.amp(0);


  userStartAudio();
}

function createSHUI(container) {
  const row = document.createElement("div");
  row.className = "controls controls-panel";

  const baseGroup = document.createElement("span");
  baseGroup.className = "slider-group";
  const baseLabel = document.createElement("span");
  baseLabel.textContent = "Base";
  baseGroup.appendChild(baseLabel);

  baseFreqSlider = document.createElement("input");
  baseFreqSlider.type = "range";
  baseFreqSlider.min = "80";
  baseFreqSlider.max = "880";
  baseFreqSlider.step = "1";
  baseFreqSlider.value = "220";
  baseFreqSlider.style.marginLeft = "0.35rem";
  baseGroup.appendChild(baseFreqSlider);

  const baseVal = document.createElement("span");
  baseVal.textContent = "220 Hz";
  baseVal.style.marginLeft = "0.35rem";
  baseGroup.appendChild(baseVal);

  baseFreqSlider.oninput = () => {
    baseVal.textContent = `${Math.round(parseFloat(baseFreqSlider.value))} Hz`;
  };
  row.appendChild(baseGroup);

  const rangeGroup = document.createElement("span");
  rangeGroup.className = "slider-group";
  const rangeLabel = document.createElement("span");
  rangeLabel.textContent = "Range";
  rangeGroup.appendChild(rangeLabel);

  rangeSlider = document.createElement("input");
  rangeSlider.type = "range";
  rangeSlider.min = "1";
  rangeSlider.max = "36";
  rangeSlider.step = "1";
  rangeSlider.value = "12";
  rangeSlider.style.marginLeft = "0.35rem";
  rangeGroup.appendChild(rangeSlider);

  const rangeVal = document.createElement("span");
  rangeVal.textContent = "±12";
  rangeVal.style.marginLeft = "0.35rem";
  rangeGroup.appendChild(rangeVal);

  rangeSlider.oninput = () => {
    rangeVal.textContent = `±${Math.round(parseFloat(rangeSlider.value))}`;
  };
  row.appendChild(rangeGroup);

  const rateGroup = document.createElement("span");
  rateGroup.className = "slider-group";
  const rateLabel = document.createElement("span");
  rateLabel.textContent = "Rate";
  rateGroup.appendChild(rateLabel);

  rateSlider = document.createElement("input");
  rateSlider.type = "range";
  rateSlider.min = "0.5";
  rateSlider.max = "20";
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

  quantizeCheckbox = document.createElement("input");
  quantizeCheckbox.type = "checkbox";
  quantizeCheckbox.id = "sh-quantize";
  quantizeCheckbox.style.marginLeft = "0.75rem";
  row.appendChild(quantizeCheckbox);

  const qLabel = document.createElement("label");
  qLabel.htmlFor = "sh-quantize";
  qLabel.textContent = "Quantise major";
  qLabel.style.marginLeft = "0.25rem";
  row.appendChild(qLabel);

  shPlayButton = document.createElement("button");
  shPlayButton.textContent = "Start";
  shPlayButton.style.marginLeft = "0.75rem";
  shPlayButton.onclick = toggleSHPlay;
  row.appendChild(shPlayButton);

  container.appendChild(row);
}

// Sound + state update
function toggleSHPlay() {
  userStartAudio();
  if (!shCarrier.started) {
    shCarrier.start();
    shCarrier.amp(SH_BASE_AMP, 0.05);
    lastSampleTime = millis() / 1000;
    lastDrawTime = lastSampleTime;
    previewPhase = 0;
    shPlayButton.textContent = "Stop";
    return;
  }

  shCarrier.stop();
  shPlayButton.textContent = "Start";
}

function mapHeldToFreq(value) {
  const base = parseFloat(baseFreqSlider.value);
  const rangeSt = Math.round(parseFloat(rangeSlider.value));
  const semis = map(value, -1, 1, -rangeSt, rangeSt);
  let targetSemis = semis;

  if (quantizeCheckbox && quantizeCheckbox.checked) {
    const sign = semis >= 0 ? 1 : -1;
    const absSemi = Math.abs(semis);
    const octave = floor(absSemi / 12);
    const within = absSemi % 12;
    let closest = MAJOR_SCALE[0];
    let bestDiff = abs(within - closest);
    MAJOR_SCALE.forEach((d) => {
      const diff = abs(within - d);
      if (diff < bestDiff) {
        bestDiff = diff;
        closest = d;
      }
    });
    targetSemis = sign * (octave * 12 + closest);
  }

  return base * pow(2, targetSemis / 12);
}

// ═══════════════════════════════════════════════════════════════════════════
//  LIVE DEMO — sample-hold (search: DEMO_ANCHOR)
// ═══════════════════════════════════════════════════════════════════════════
//   sampleHeldValueIfDue() — S&H steps the held random driving the carrier.
// ═══════════════════════════════════════════════════════════════════════════
function sampleHeldValueIfDue(now, rate) {
  const interval = 1 / rate;
  if (shCarrier.started && now - lastSampleTime >= interval) {
    heldValue = random(-1, 1);
    shCarrier.freq(mapHeldToFreq(heldValue));
    lastSampleTime = now;
  }
}

function updateScopeBuffers(targetFreq, dt) {
  const sourceNoise = random(-1, 1);
  const normalisedFreq = map(log(targetFreq), log(40), log(2000), -1, 1, true);

  previewPhase += TWO_PI * targetFreq * max(dt, 0);
  const outputPreview = sin(previewPhase);

  const panelWidth = width - 40;
  const nextSourceScope = [...sourceScope, sourceNoise];
  const nextHoldScope = [...holdScope, heldValue];
  const nextOutputScope = [...outputScope, outputPreview * map(heldValue, -1, 1, 0.2, 1)];

  sourceScope = nextSourceScope.slice(-panelWidth);
  holdScope = nextHoldScope.slice(-panelWidth);
  outputScope = nextOutputScope.slice(-panelWidth);

  return normalisedFreq;
}

function windowResized() {
  const container = document.getElementById("sh-container");
  if (!container) return;
  const nextWidth = Math.max(320, Math.min(900, container.clientWidth || 900));
  resizeCanvas(nextWidth, height);
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

function drawTitle() {
  const titleText = "Sample & hold frequency steps";
  textSize(14);
  const titleW = textWidth(titleText) + 12;
  fill(0);
  noStroke();
  rect(14, 10, titleW, 20, 6);
  fill(255);
  text(titleText, 20, 24);
}

function drawModeLabel(rate) {
  const qText = quantizeCheckbox && quantizeCheckbox.checked ? "ON" : "OFF";
  const modeLabel = `rate ${rate.toFixed(1)} Hz · base ${Math.round(
    parseFloat(baseFreqSlider.value)
  )} Hz · range ±${Math.round(parseFloat(rangeSlider.value))} st · quant ${qText}`;
  textSize(11);
  const mW = textWidth(modeLabel) + 10;
  fill(0);
  rect(16, height - 18, mW, 16, 4);
  fill(255);
  text(modeLabel, 20, height - 6);
}

function draw() {
  background(250);

  const now = millis() / 1000;
  const dt = lastDrawTime > 0 ? now - lastDrawTime : 0;
  lastDrawTime = now;

  const rate = parseFloat(rateSlider ? rateSlider.value : 4);
  sampleHeldValueIfDue(now, rate);
  const targetFreq = mapHeldToFreq(heldValue);
  const normalisedFreq = updateScopeBuffers(targetFreq, dt);

  drawTitle();
  drawScopePanel(sourceScope, 95, "noise source");
  drawScopePanel(holdScope, 220, "held control steps");

  // Blend output preview with frequency trace so stepping behavior is visible.
  const blended = outputScope.map((v) => constrain(v * 0.6 + normalisedFreq * 0.4, -1, 1));
  drawScopePanel(blended, 345, "carrier output / freq tendency");
  drawModeLabel(rate);
}
