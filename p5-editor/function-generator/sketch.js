/*
 * p5.js Web Editor learning copy
 * Learning goal: Sample one cycle of a function into a buffer, then loop it fast enough to hear pitch.
 * Try changing: FG_BUFFER_SIZE, MIN_FREQUENCY, MAX_FREQUENCY, or the default currentMode.
 *
 * Paste this file into sketch.js in the p5.js Web Editor, or upload it with
 * the matching index.html from this folder. The sound code uses p5.sound plus
 * browser Web Audio nodes, so press the sketch's Start/Play button before
 * expecting audio.
 */

/**
 * Function generator → looping oscillator (no build step)
 *
 * How it works:
 * - We sample one period of a chosen function into an AudioBuffer.
 * - Looping that buffer turns it into a pitched oscillator.
 * - The UI selects the input function and starts/stops playback.
 * - Audio starts only after a user gesture (`userStartAudio()`), per browser policy.
 */
let fgCanvas;
let bufferSource = null;
let audioCtx = null;

// Try changing these constants to hear or see how the sketch responds.
const FG_BUFFER_SIZE = 2048;
const MIDDLE_C_FREQUENCY = 261.63;
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 2000;
const EDGE_FADE_SAMPLES = 64;
const BUFFER_PEAK = 0.82;

let currentMode = "white"; // "white" | "perlin" | "sine"
let currentBuffer = null;
let targetFrequency = MIDDLE_C_FREQUENCY;

let modeSelect;
let playButton;
let frequencySlider;
let frequencyValue;

// Setup + UI
function setup() {
  const container = document.getElementById("sketch-container");
  if (!container) {
    console.error("function-generator: sketch-container not found");
    return;
  }

  const canvasWidth = Math.max(320, Math.min(900, container.clientWidth || 900));
  fgCanvas = createCanvas(canvasWidth, 260);
  fgCanvas.parent(container);

  textFont("monospace");

  createUI(container);

  // Prepare audio context lazily via p5.sound helper
  audioCtx = getAudioContext();
  generateAndPreview();
}

function windowResized() {
  const container = document.getElementById("sketch-container");
  if (!container) return;
  const nextWidth = Math.max(320, Math.min(900, container.clientWidth || 900));
  resizeCanvas(nextWidth, height);
}

function createUI(container) {
  const wrapper = document.createElement("div");
  wrapper.className = "controls controls-panel";

  const label = document.createElement("label");
  label.textContent = "Input function:";
  wrapper.appendChild(label);

  modeSelect = document.createElement("select");
  [
    { value: "white", label: "White noise" },
    { value: "perlin", label: "Perlin-like noise" },
    { value: "sine", label: "Simple repeating wave" },
  ].forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    modeSelect.appendChild(o);
  });
  modeSelect.value = currentMode;
  modeSelect.onchange = () => {
    currentMode = modeSelect.value;
    generateAndPreview();
  };
  wrapper.appendChild(modeSelect);

  const frequencyLabel = document.createElement("label");
  frequencyLabel.textContent = "Frequency (Hz):";
  wrapper.appendChild(frequencyLabel);

  frequencySlider = document.createElement("input");
  frequencySlider.type = "range";
  frequencySlider.min = String(MIN_FREQUENCY);
  frequencySlider.max = String(MAX_FREQUENCY);
  frequencySlider.step = "1";
  frequencySlider.value = String(Math.round(targetFrequency));
  frequencySlider.oninput = () => {
    setTargetFrequency(Number(frequencySlider.value));
  };
  wrapper.appendChild(frequencySlider);

  frequencyValue = document.createElement("span");
  frequencyValue.textContent = `${targetFrequency.toFixed(2)} Hz`;
  wrapper.appendChild(frequencyValue);

  playButton = document.createElement("button");
  playButton.textContent = "Play loop";
  playButton.onclick = togglePlay;
  wrapper.appendChild(playButton);

  container.prepend(wrapper);
}

// Sound + state update
function generateAndPreview() {
  // Ensure audio context is running (required by some browsers)
  userStartAudio();
  if (!audioCtx) return;

  currentBuffer = createFunctionBuffer(currentMode);
  // If we are currently playing, restart with the new buffer
  if (bufferSource) {
    stopPlayback();
    startPlayback();
  }
}

function createFunctionBuffer(mode) {
  const buf = audioCtx.createBuffer(1, FG_BUFFER_SIZE, audioCtx.sampleRate);
  const data = buf.getChannelData(0);

  if (mode === "white") {
    for (let i = 0; i < FG_BUFFER_SIZE; i++) {
      data[i] = random(-1, 1);
    }
  } else if (mode === "perlin") {
    // Use p5's noise() as a stand‑in for Perlin noise
    const scale = 3.0 / FG_BUFFER_SIZE;
    for (let i = 0; i < FG_BUFFER_SIZE; i++) {
      const n = noise(i * scale); // 0..1
      data[i] = n * 2 - 1; // map to -1..1
    }
  } else if (mode === "sine") {
    for (let i = 0; i < FG_BUFFER_SIZE; i++) {
      const t = (i / FG_BUFFER_SIZE) * TWO_PI;
      data[i] = sin(t);
    }
  } else {
    for (let i = 0; i < FG_BUFFER_SIZE; i++) {
      data[i] = random(-1, 1);
    }
  }

  conditionLoopBuffer(data);
  return buf;
}

function conditionLoopBuffer(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const dc = sum / data.length;
  for (let i = 0; i < data.length; i++) data[i] -= dc;

  const fadeLen = Math.min(EDGE_FADE_SAMPLES, Math.floor(data.length / 2));
  for (let i = 0; i < fadeLen; i++) {
    const fade = 0.5 - 0.5 * Math.cos(Math.PI * i / fadeLen);
    data[i] *= fade;
    data[data.length - 1 - i] *= fade;
  }

  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak > 0) {
    const scale = BUFFER_PEAK / peak;
    for (let i = 0; i < data.length; i++) data[i] *= scale;
  }
}

function startPlayback() {
  if (!currentBuffer) return;
  bufferSource = audioCtx.createBufferSource();
  bufferSource.buffer = currentBuffer;
  bufferSource.loop = true;
  bufferSource.playbackRate.value = getPlaybackRateForTargetFrequency();
  bufferSource.connect(audioCtx.destination);
  bufferSource.start();
  playButton.textContent = "Stop";
}

function getPlaybackRateForTargetFrequency() {
  if (!audioCtx || !currentBuffer) {
    return 1;
  }
  const baseFrequency = audioCtx.sampleRate / currentBuffer.length;
  if (!isFinite(baseFrequency) || baseFrequency <= 0) {
    return 1;
  }
  return targetFrequency / baseFrequency;
}

function setTargetFrequency(nextFrequency) {
  const normalizedFrequency = constrain(nextFrequency, MIN_FREQUENCY, MAX_FREQUENCY);
  if (!isFinite(normalizedFrequency)) return;

  targetFrequency = normalizedFrequency;
  if (frequencyValue) {
    frequencyValue.textContent = `${targetFrequency.toFixed(2)} Hz`;
  }

  if (bufferSource) {
    bufferSource.playbackRate.value = getPlaybackRateForTargetFrequency();
  }
}

function stopPlayback() {
  if (bufferSource) {
    try {
      bufferSource.stop();
    } catch (e) {
      // ignore if already stopped
    }
    bufferSource.disconnect();
    bufferSource = null;
  }
  playButton.textContent = "Play loop";
}

function togglePlay() {
  userStartAudio();
  if (bufferSource) {
    stopPlayback();
  } else {
    startPlayback();
  }
}

// Rendering
function drawPanelBackground(x, centerY, panelWidth, panelHeight) {
  push();
  rectMode(CORNER);
  noFill();
  stroke(0);
  strokeWeight(1);
  rect(x, centerY - panelHeight / 2, panelWidth, panelHeight);
  pop();
}

function drawPanelLabel(x, centerY, panelHalfHeight, label) {
  textSize(11);
  const lw = textWidth(label) + 10;
  const lx = width - lw - 24;
  const ly = centerY - panelHalfHeight + 16;
  noStroke();
  fill(0);
  rect(lx, ly - 12, lw, 16, 4);
  fill(255);
  text(label, lx + 5, ly);
}

function draw() {
  background(250);

  if (!currentBuffer) return;

  const titleText = "Function generator -> looping oscillator";
  textSize(14);
  const titleW = textWidth(titleText) + 12;
  fill(0);
  noStroke();
  rect(14, 10, titleW, 20, 6);
  fill(255);
  text(titleText, 20, 24);

  const data = currentBuffer.getChannelData(0);
  const panelWidth = width - 40;
  const panelHalfHeight = 43;

  drawPanelBackground(20, 70, panelWidth, panelHalfHeight * 2);
  drawPanelBackground(20, 195, panelWidth, panelHalfHeight * 2);
  drawPanelLabel(20, 70, panelHalfHeight, "single period (input function)");
  drawPanelLabel(20, 195, panelHalfHeight, "period looped as oscillator");

  push();
  translate(20, 70);
  strokeWeight(1.1);
  noFill();
  const w = panelWidth;
  const h = panelHalfHeight - 2;
  stroke(230);
  line(0, 0, w, 0);
  stroke(25, 25, 25, 220);
  if (w > 1) {
    beginShape();
    for (let x = 0; x < w; x++) {
      const idx = floor(map(x, 0, w - 1, 0, FG_BUFFER_SIZE - 1));
      const y = map(data[idx], -1, 1, h, -h);
      vertex(x, y);
    }
    endShape();
  }
  pop();

  const repeats = 4;
  push();
  translate(20, 195);
  strokeWeight(1.1);
  noFill();
  const repeatW = panelWidth / repeats;
  stroke(230);
  line(0, 0, panelWidth, 0);
  stroke(35, 35, 35, 190);
  if (repeatW > 1) {
    for (let r = 0; r < repeats; r++) {
      beginShape();
      for (let x = 0; x < repeatW; x++) {
        const mapped = map(x, 0, repeatW - 1, 0, FG_BUFFER_SIZE - 1);
        const idx = constrain(floor(mapped), 0, FG_BUFFER_SIZE - 1);
        const y = map(data[idx], -1, 1, panelHalfHeight - 2, -(panelHalfHeight - 2));
        vertex(r * repeatW + x, y);
      }
      endShape();
    }
  }
  pop();

  const modeLabelMap = {
    white: "Input: white noise sample",
    perlin: "Input: Perlin-like smooth noise sample",
    sine: "Input: simple sine function",
  };
  textSize(12);
  const modeLabel = modeLabelMap[currentMode] || "";
  const frequencyLabel = `Target: ${targetFrequency.toFixed(2)} Hz`;
  const footerLabel = `${modeLabel} | ${frequencyLabel}`;
  const modeW = textWidth(footerLabel) + 10;
  const modeX = 20;
  const modeY = height - 12;
  noStroke();
  fill(0);
  rect(modeX - 4, modeY - 12, modeW, 16, 4);
  fill(255);
  text(footerLabel, modeX, modeY);
}
