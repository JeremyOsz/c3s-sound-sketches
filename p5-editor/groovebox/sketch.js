/*
 * p5.js Web Editor learning copy
 * Learning goal: Combine several small synth engines inside a 16-step sequencer.
 * Try changing: PARAM_DEFAULTS.tracks, PARAM_DEFAULTS.performance, or voice defaults.
 *
 * Paste this file into sketch.js in the p5.js Web Editor, or upload it with
 * the matching index.html from this folder. The sound code uses p5.sound plus
 * browser Web Audio nodes, so press the sketch's Start/Play button before
 * expecting audio.
 */

/**
 * Mini Groovebox (4 tracks)
 *
 * This file is intentionally “no build step” JavaScript, using p5.js for the
 * canvas and DOM bootstrapping, and WebAudio nodes for actual sound.
 *
 * High-level architecture
 * - UI: plain DOM elements (buttons, sliders, checkboxes) created in `createUI`.
 * - Clock: a 16-step sequencer; each step is a 16th note at the selected BPM.
 * - Scheduling: events are scheduled ahead using `audioCtx.currentTime`
 *   (lookahead window) so timing stays stable even if draw() jitters.
 * - Sound: four simple engines (kick/noise/bass/lead) using oscillators + gains.
 *
 * Signal flow (Master BP OFF by default)
 *   [tracks] -> mixBus -> masterGain -> masterLimiter -> p5.soundOut.input (or ctx.destination)
 *
 * Signal flow (Master BP ON)
 *   [tracks] -> mixBus -> masterFilter(BandPass) -> masterGain -> masterLimiter -> output
 *
 * “Melodic LP” controls apply only to bass + lead (their per-voice filters).
 */
let gbCanvas;

// Try changing these constants to hear or see how the sketch responds.
const STEPS = 16;

// ----------------------------
// Tweakable parameters (defaults + live values)
// ----------------------------

const PARAM_RANGES = {
  bpm: { min: 60, max: 170, step: 1 },
  swing: { min: 0, max: 0.75, step: 0.01 },
  masterVolume: { min: 0, max: 0.85, step: 0.01 },

  masterFilter: {
    amount: { min: -1, max: 1, step: 0.01 },
    cutoffHz: { min: 40, max: 8000, step: 1 },
    q: { min: 0.1, max: 18, step: 0.1 },
  },

  melodicFilter: {
    cutoffHz: { min: 80, max: 8000, step: 1 },
    q: { min: 0.1, max: 18, step: 0.1 },
  },

  leadMod: {
    sampleHoldSemitones: { min: 0, max: 7, step: 1 },
    amDepth: { min: 0, max: 0.85, step: 0.01 },
  },

  trackLevel: { min: 0, max: 1, step: 0.01 },
};

const PARAM_DEFAULTS = {
  canvas: { widthMin: 320, widthMax: 1020, height: 380 },

  scheduler: { lookaheadSec: 0.12 },

  performance: {
    bpm: 126,
    swing: 0.12,
    masterVolume: 0.62,
  },

  masterFilter: {
    // Bipolar master filter: negative=low-pass, 0=bypass, positive=high-pass
    amount: 0,
    bypass: {
      lowpassCutoffHz: 18000,
      highpassCutoffHz: 20,
    },
    lowpassCutoffMinHz: 40,
    highpassCutoffMaxHz: 8000,
    q: 1.2,
    responseCurveExp: 1.35,
  },

  melodicFilter: {
    enabled: true,
    cutoffHz: 900,
    q: 6.5,
    bypass: { cutoffHz: 18000, q: 0.1 },
  },

  tracks: [
    { id: "kick", name: "Kick", pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], level: 1.0 },
    { id: "perc", name: "Noise", pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], level: 0.85 },
    { id: "bass", name: "Bass", pattern: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0], level: 0.8 },
    { id: "lead", name: "Lead", pattern: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], level: 0.55 },
  ],

  // Voice tuning knobs (kept here so people can tweak in code)
  kick: {
    baseHz: 50,
    startHz: 170,
    pitchDropSec: 0.085,
    amp: { attackSec: 0.001, decaySec: 0.55 },
  },

  bass: {
    env: { a: 0.004, d: 0.09, s: 0.25, r: 0.08 },
    pluck: { baseCutHz: 170, peakCutHz: 1200, endCutHz: 260 },
    ampPeak: 0.55,
  },

  lead: {
    env: { a: 0.003, d: 0.08, r: 0.12 },
    mod: { ratio: 2, depth: 140 },
    ampPeak: 0.35,
  },

  leadMod: {
    sampleHoldSemitones: 0,
    amDepth: 0,
    amRateHz: 8,
  },
};

let params = {
  bpm: PARAM_DEFAULTS.performance.bpm,
  swing: PARAM_DEFAULTS.performance.swing,
  masterVolume: PARAM_DEFAULTS.performance.masterVolume,

  masterFilter: {
    amount: PARAM_DEFAULTS.masterFilter.amount,
    q: PARAM_DEFAULTS.masterFilter.q,
  },

  melodicFilter: {
    enabled: PARAM_DEFAULTS.melodicFilter.enabled,
    cutoffHz: PARAM_DEFAULTS.melodicFilter.cutoffHz,
    q: PARAM_DEFAULTS.melodicFilter.q,
  },

  leadMod: {
    sampleHoldSemitones: PARAM_DEFAULTS.leadMod.sampleHoldSemitones,
    amDepth: PARAM_DEFAULTS.leadMod.amDepth,
  },

  trackLevels: Object.fromEntries(PARAM_DEFAULTS.tracks.map((t) => [t.id, t.level])),
};

let audioCtx = null;
let isPlaying = false;
let startButton;
let bpmSlider;
let bpmValueSpan;
let tapButton;
let masterVolSlider;
let masterVolValueSpan;
let swingSlider;
let swingValueSpan;
let lastTapAtMs = 0;
let controlsPanelEl;

let masterFilterAmountSlider;
let masterFilterAmountVal;
let masterFilterQSlider;
let masterFilterQVal;

let melodicLpFreqSlider;
let melodicLpFreqVal;
let melodicLpQSlider;
let melodicLpQVal;
let melodicLpEnabledCheckbox;

let currentStep = 0;
let nextStepTime = 0;

let stepButtonsByTrack = {};

// Track data is the single source of truth for the sequencer grid.
// UI toggles mutate these objects (simple and adequate for this sketch).
const tracks = PARAM_DEFAULTS.tracks.map((t) => ({
  id: t.id,
  name: t.name,
  pattern: [...t.pattern],
  muted: false,
  solo: false,
  level: t.level,
}));

// --- Engines ---
let mixBus = null;
let masterFilter = null; // bandpass on whole groovebox
let masterGain = null;
let masterLimiter = null;

let kick = null;
let perc = null;
let bass = null;
let lead = null;

let outScope = [];
let lastDrawTime = 0;
let previewPhase = 0;

/**
 * p5.sound sits between WebAudio and the speakers. Routing through
 * `p5.soundOut.input` keeps behavior consistent with the other sketches and
 * avoids “silent” output paths in some setups.
 */
function getOutputNode(ctx) {
  return (window.p5 && window.p5.soundOut && window.p5.soundOut.input)
    ? window.p5.soundOut.input
    : ctx.destination;
}

// Setup + UI
function setup() {
  const container = document.getElementById("groovebox-container");
  if (!container) {
    console.error("groovebox: groovebox-container not found");
    return;
  }

  const canvasWidth = Math.max(
    PARAM_DEFAULTS.canvas.widthMin,
    Math.min(PARAM_DEFAULTS.canvas.widthMax, container.clientWidth || PARAM_DEFAULTS.canvas.widthMax)
  );
  gbCanvas = createCanvas(canvasWidth, PARAM_DEFAULTS.canvas.height);
  gbCanvas.parent(container);
  textFont("monospace");

  // Browser audio requires a user gesture; engines are created on first Play.
  audioCtx = getAudioContext();
  userStartAudio();

  createUI(container);
}

function windowResized() {
  const container = document.getElementById("groovebox-container");
  if (!container) return;

  const nextWidth = Math.max(
    PARAM_DEFAULTS.canvas.widthMin,
    Math.min(PARAM_DEFAULTS.canvas.widthMax, container.clientWidth || PARAM_DEFAULTS.canvas.widthMax)
  );
  resizeCanvas(nextWidth, height);
}

function createUI(container) {
  const row = document.createElement("div");
  row.className = "controls";

  startButton = document.createElement("button");
  startButton.textContent = "Play";
  startButton.onclick = togglePlay;
  row.appendChild(startButton);

  container.appendChild(row);

  const grid = document.createElement("div");
  grid.className = "grid";

  tracks.forEach((track) => {
    const labelWrap = document.createElement("div");
    labelWrap.className = "track-label";
    labelWrap.textContent = track.name;

    const mute = document.createElement("input");
    mute.type = "checkbox";
    mute.className = "track-mute";
    mute.title = `Mute ${track.name}`;
    mute.onchange = () => {
      track.muted = !!mute.checked;
    };
    labelWrap.appendChild(mute);

    const soloBtn = document.createElement("button");
    soloBtn.textContent = "Solo";
    soloBtn.title = `Solo ${track.name}`;
    soloBtn.style.marginLeft = "0.35rem";
    soloBtn.className = "tiny";
    soloBtn.onclick = () => {
      track.solo = !track.solo;
      soloBtn.style.background = track.solo ? "#222" : "#fff";
      soloBtn.style.color = track.solo ? "#fff" : "#222";
      soloBtn.style.borderColor = track.solo ? "#222" : "#ccc";
    };
    labelWrap.appendChild(soloBtn);

    grid.appendChild(labelWrap);

    const btns = [];
    for (let i = 0; i < STEPS; i++) {
      const b = document.createElement("button");
      b.className = `step ${track.pattern[i] ? "on" : ""}`;
      b.title = `${track.name} step ${i + 1}`;
      b.onclick = () => {
        track.pattern[i] = track.pattern[i] ? 0 : 1;
        b.classList.toggle("on", !!track.pattern[i]);
      };
      btns.push(b);
      grid.appendChild(b);
    }
    stepButtonsByTrack[track.id] = btns;
  });

  container.appendChild(grid);

  // Controls below sequencer
  controlsPanelEl = document.createElement("div");
  controlsPanelEl.className = "controls controls-panel";

  const perfRow = document.createElement("div");
  perfRow.className = "row";

  const perfLabel = document.createElement("span");
  perfLabel.className = "row-label";
  perfLabel.textContent = "Performance";
  perfRow.appendChild(perfLabel);

  tapButton = document.createElement("button");
  tapButton.textContent = "Tap tempo";
  tapButton.title = "Tap tempo (quarter notes)";
  tapButton.onclick = onTapTempo;
  perfRow.appendChild(tapButton);

  const bpmGroup = sliderGroup(
    perfRow,
    "BPM",
    PARAM_RANGES.bpm.min,
    PARAM_RANGES.bpm.max,
    PARAM_RANGES.bpm.step,
    params.bpm,
    (v) => `${Math.round(v)}`
  );
  bpmSlider = bpmGroup.slider;
  bpmValueSpan = bpmGroup.valueSpan;
  {
    const prev = bpmSlider.oninput;
    bpmSlider.oninput = () => {
      prev && prev();
      params = { ...params, bpm: Math.max(30, parseFloat(bpmSlider.value)) };
    };
  }

  const swingGroup = sliderGroup(
    perfRow,
    "Swing",
    PARAM_RANGES.swing.min,
    PARAM_RANGES.swing.max,
    PARAM_RANGES.swing.step,
    params.swing,
    (v) => `${Math.round(v * 100)}%`
  );
  swingSlider = swingGroup.slider;
  swingValueSpan = swingGroup.valueSpan;
  {
    const prev = swingSlider.oninput;
    swingSlider.oninput = () => {
      prev && prev();
      params = { ...params, swing: Math.max(0, Math.min(PARAM_RANGES.swing.max, parseFloat(swingSlider.value))) };
    };
  }

  const volGroup = sliderGroup(
    perfRow,
    "Volume",
    PARAM_RANGES.masterVolume.min,
    PARAM_RANGES.masterVolume.max,
    PARAM_RANGES.masterVolume.step,
    params.masterVolume,
    (v) => v.toFixed(2)
  );
  masterVolSlider = volGroup.slider;
  masterVolValueSpan = volGroup.valueSpan;
  masterVolSlider.oninput = () => {
    masterVolValueSpan.textContent = parseFloat(masterVolSlider.value).toFixed(2);
    params = { ...params, masterVolume: parseFloat(masterVolSlider.value) };
    if (masterGain && audioCtx) {
      const now = audioCtx.currentTime;
      masterGain.gain.setTargetAtTime(parseFloat(masterVolSlider.value), now, 0.01);
    }
  };

  controlsPanelEl.appendChild(perfRow);

  const mixRow = document.createElement("div");
  mixRow.className = "row";
  const mixLabel = document.createElement("span");
  mixLabel.className = "row-label";
  mixLabel.textContent = "Track levels";
  mixRow.appendChild(mixLabel);

  tracks.forEach((track) => {
    const g = sliderGroup(
      mixRow,
      track.name,
      PARAM_RANGES.trackLevel.min,
      PARAM_RANGES.trackLevel.max,
      PARAM_RANGES.trackLevel.step,
      params.trackLevels[track.id] ?? track.level,
      (v) => v.toFixed(2)
    );
    g.slider.title = `${track.name} level`;
    g.slider.oninput = () => {
      track.level = parseFloat(g.slider.value);
      g.valueSpan.textContent = track.level.toFixed(2);
      params = {
        ...params,
        trackLevels: {
          ...params.trackLevels,
          [track.id]: track.level,
        },
      };
    };
  });
  controlsPanelEl.appendChild(mixRow);

  const filterRow = document.createElement("div");
  filterRow.className = "row";
  const filterLabel = document.createElement("span");
  filterLabel.className = "row-label";
  filterLabel.textContent = "Filters";
  filterRow.appendChild(filterLabel);

  const masterAmt = sliderGroup(
    filterRow,
    "Master filter (Low-pass ← 0 → High-pass)",
    PARAM_RANGES.masterFilter.amount.min,
    PARAM_RANGES.masterFilter.amount.max,
    PARAM_RANGES.masterFilter.amount.step,
    params.masterFilter.amount,
    (v) => {
      const amt = Math.max(PARAM_RANGES.masterFilter.amount.min, Math.min(PARAM_RANGES.masterFilter.amount.max, v));
      if (Math.abs(amt) < 0.0001) return "Off";
      const pct = Math.round(Math.abs(amt) * 100);
      return amt < 0 ? `Low-pass ${pct}%` : `High-pass ${pct}%`;
    }
  );
  masterFilterAmountSlider = masterAmt.slider;
  masterFilterAmountVal = masterAmt.valueSpan;
  masterFilterAmountSlider.oninput = () => {
    const amt = parseFloat(masterFilterAmountSlider.value);
    masterFilterAmountVal.textContent =
      Math.abs(amt) < 0.0001 ? "Off" : amt < 0 ? `Low-pass ${Math.round(Math.abs(amt) * 100)}%` : `High-pass ${Math.round(Math.abs(amt) * 100)}%`;
    params = { ...params, masterFilter: { ...params.masterFilter, amount: amt } };
    applyMasterFilterParams();
    updateMasterRouting(false);
  };

  const masterQ = sliderGroup(
    filterRow,
    "Master filter resonance (Q)",
    PARAM_RANGES.masterFilter.q.min,
    PARAM_RANGES.masterFilter.q.max,
    PARAM_RANGES.masterFilter.q.step,
    params.masterFilter.q,
    (v) => v.toFixed(1)
  );
  masterFilterQSlider = masterQ.slider;
  masterFilterQVal = masterQ.valueSpan;
  masterFilterQSlider.oninput = () => {
    masterFilterQVal.textContent = parseFloat(masterFilterQSlider.value).toFixed(1);
    params = { ...params, masterFilter: { ...params.masterFilter, q: parseFloat(masterFilterQSlider.value) } };
    applyMasterFilterParams();
  };

  melodicLpEnabledCheckbox = document.createElement("input");
  melodicLpEnabledCheckbox.type = "checkbox";
  melodicLpEnabledCheckbox.id = "gb-mel-lp";
  melodicLpEnabledCheckbox.checked = params.melodicFilter.enabled;
  melodicLpEnabledCheckbox.onchange = () => {
    params = { ...params, melodicFilter: { ...params.melodicFilter, enabled: !!melodicLpEnabledCheckbox.checked } };
    applyMelodicFilterParams();
  };
  const melToggle = document.createElement("label");
  melToggle.className = "toggle";
  melToggle.htmlFor = "gb-mel-lp";
  melToggle.appendChild(melodicLpEnabledCheckbox);
  melToggle.appendChild(document.createTextNode("Melodic low-pass filter"));
  filterRow.appendChild(melToggle);

  const melF = sliderGroup(
    filterRow,
    "Low-pass frequency (melodic)",
    PARAM_RANGES.melodicFilter.cutoffHz.min,
    PARAM_RANGES.melodicFilter.cutoffHz.max,
    PARAM_RANGES.melodicFilter.cutoffHz.step,
    params.melodicFilter.cutoffHz,
    (v) => `${Math.round(v)} Hz`
  );
  melodicLpFreqSlider = melF.slider;
  melodicLpFreqVal = melF.valueSpan;
  melodicLpFreqSlider.oninput = () => {
    melodicLpFreqVal.textContent = `${Math.round(parseFloat(melodicLpFreqSlider.value))} Hz`;
    params = { ...params, melodicFilter: { ...params.melodicFilter, cutoffHz: parseFloat(melodicLpFreqSlider.value) } };
    applyMelodicFilterParams();
  };

  const melQ = sliderGroup(
    filterRow,
    "Low-pass resonance (Q, melodic)",
    PARAM_RANGES.melodicFilter.q.min,
    PARAM_RANGES.melodicFilter.q.max,
    PARAM_RANGES.melodicFilter.q.step,
    params.melodicFilter.q,
    (v) => v.toFixed(1)
  );
  melodicLpQSlider = melQ.slider;
  melodicLpQVal = melQ.valueSpan;
  melodicLpQSlider.oninput = () => {
    melodicLpQVal.textContent = parseFloat(melodicLpQSlider.value).toFixed(1);
    params = { ...params, melodicFilter: { ...params.melodicFilter, q: parseFloat(melodicLpQSlider.value) } };
    applyMelodicFilterParams();
  };

  controlsPanelEl.appendChild(filterRow);

  const modRow = document.createElement("div");
  modRow.className = "row";
  const modLabel = document.createElement("span");
  modLabel.className = "row-label";
  modLabel.textContent = "Lead recap modulation";
  modRow.appendChild(modLabel);

  const leadSh = sliderGroup(
    modRow,
    "Lead S&H pitch",
    PARAM_RANGES.leadMod.sampleHoldSemitones.min,
    PARAM_RANGES.leadMod.sampleHoldSemitones.max,
    PARAM_RANGES.leadMod.sampleHoldSemitones.step,
    params.leadMod.sampleHoldSemitones,
    (v) => `${Math.round(v)} st`
  );
  leadSh.slider.title = "Sample-and-hold pitch variation on the lead every few steps";
  leadSh.slider.oninput = () => {
    const semis = Math.round(parseFloat(leadSh.slider.value));
    leadSh.valueSpan.textContent = `${semis} st`;
    params = { ...params, leadMod: { ...params.leadMod, sampleHoldSemitones: semis } };
  };

  const leadAm = sliderGroup(
    modRow,
    "Lead AM",
    PARAM_RANGES.leadMod.amDepth.min,
    PARAM_RANGES.leadMod.amDepth.max,
    PARAM_RANGES.leadMod.amDepth.step,
    params.leadMod.amDepth,
    (v) => v.toFixed(2)
  );
  leadAm.slider.title = "Tremolo-style amplitude modulation on the lead";
  leadAm.slider.oninput = () => {
    const depth = parseFloat(leadAm.slider.value);
    leadAm.valueSpan.textContent = depth.toFixed(2);
    params = { ...params, leadMod: { ...params.leadMod, amDepth: depth } };
  };

  controlsPanelEl.appendChild(modRow);
  container.appendChild(controlsPanelEl);
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

function ensureEngines() {
  if (!audioCtx) audioCtx = getAudioContext();
  if (masterGain) return;

  mixBus = audioCtx.createGain();
  mixBus.gain.value = 1;

  masterFilter = audioCtx.createBiquadFilter();
  applyMasterFilterParams(true);

  masterGain = audioCtx.createGain();
  masterGain.gain.value = params.masterVolume;

  masterLimiter = audioCtx.createDynamicsCompressor();
  masterLimiter.threshold.value = -9;
  masterLimiter.knee.value = 12;
  masterLimiter.ratio.value = 8;
  masterLimiter.attack.value = 0.003;
  masterLimiter.release.value = 0.12;

  updateMasterRouting(true);

  kick = createKickEngine(audioCtx, mixBus);
  perc = createNoisePercEngine(audioCtx, mixBus);
  bass = createBassEngine(audioCtx, mixBus);
  lead = createLeadEngine(audioCtx, mixBus);

  applyMelodicFilterParams();
}

function isMasterFilterActive() {
  return Math.abs(params.masterFilter.amount) >= 0.0001;
}

function updateMasterRouting(isInitial) {
  if (!audioCtx || !mixBus || !masterGain || !masterFilter || !masterLimiter) return;

  try {
    mixBus.disconnect();
  } catch (_) {}
  try {
    masterFilter.disconnect();
  } catch (_) {}
  try {
    masterGain.disconnect();
  } catch (_) {}
  try {
    masterLimiter.disconnect();
  } catch (_) {}

  const out = getOutputNode(audioCtx);

  if (isMasterFilterActive()) {
    mixBus.connect(masterFilter);
    masterFilter.connect(masterGain);
  } else {
    mixBus.connect(masterGain);
  }
  masterGain.connect(masterLimiter);
  masterLimiter.connect(out);

  if (!isInitial) {
    const now = audioCtx.currentTime;
    masterGain.gain.setTargetAtTime(
      params.masterVolume,
      now,
      0.01
    );
  }
}

function applyMasterFilterParams(isInitial = false) {
  if (!audioCtx || !masterFilter) return;

  const amt = Math.max(PARAM_RANGES.masterFilter.amount.min, Math.min(PARAM_RANGES.masterFilter.amount.max, params.masterFilter.amount));
  const q = Math.max(PARAM_RANGES.masterFilter.q.min, Math.min(PARAM_RANGES.masterFilter.q.max, params.masterFilter.q));

  const tRaw = Math.min(1, Math.max(0, Math.abs(amt)));
  const t = Math.pow(tRaw, PARAM_DEFAULTS.masterFilter.responseCurveExp);

  let cutoff;
  if (amt < 0) {
    // Low-pass: 0 -> ~18kHz (bypass), 1 -> ~40Hz
    cutoff =
      PARAM_DEFAULTS.masterFilter.bypass.lowpassCutoffHz +
      (PARAM_DEFAULTS.masterFilter.lowpassCutoffMinHz - PARAM_DEFAULTS.masterFilter.bypass.lowpassCutoffHz) * t;
    masterFilter.type = "lowpass";
  } else {
    // High-pass: 0 -> ~20Hz (bypass), 1 -> ~8kHz
    cutoff =
      PARAM_DEFAULTS.masterFilter.bypass.highpassCutoffHz +
      (PARAM_DEFAULTS.masterFilter.highpassCutoffMaxHz - PARAM_DEFAULTS.masterFilter.bypass.highpassCutoffHz) * t;
    masterFilter.type = "highpass";
  }

  if (isInitial) {
    masterFilter.frequency.value = cutoff;
    masterFilter.Q.value = q;
    return;
  }

  const now = audioCtx.currentTime;
  masterFilter.frequency.setTargetAtTime(cutoff, now, 0.01);
  masterFilter.Q.setTargetAtTime(q, now, 0.01);
}

// Sound + state update
function togglePlay() {
  userStartAudio();
  audioCtx = getAudioContext();
  ensureEngines();

  if (!isPlaying) {
    isPlaying = true;
    startButton.textContent = "Stop";
    const now = audioCtx.currentTime;
    currentStep = 0;
    nextStepTime = now + 0.05;
    return;
  }

  isPlaying = false;
  startButton.textContent = "Play";
  clearStepHighlights();
}

window.addEventListener("beforeunload", () => {
  try {
    kick && kick.stop && kick.stop();
  } catch (_) {}
  try {
    perc && perc.stop && perc.stop();
  } catch (_) {}
  try {
    bass && bass.stop && bass.stop();
  } catch (_) {}
  try {
    lead && lead.stop && lead.stop();
  } catch (_) {}
  try {
    masterGain && masterGain.disconnect && masterGain.disconnect();
  } catch (_) {}
  try {
    masterLimiter && masterLimiter.disconnect && masterLimiter.disconnect();
  } catch (_) {}
  try {
    masterFilter && masterFilter.disconnect && masterFilter.disconnect();
  } catch (_) {}
  try {
    mixBus && mixBus.disconnect && mixBus.disconnect();
  } catch (_) {}
});

function clearStepHighlights() {
  for (const track of tracks) {
    const btns = stepButtonsByTrack[track.id] || [];
    btns.forEach((b) => b.classList.remove("playing"));
  }
}

function highlightStep(step) {
  for (const track of tracks) {
    const btns = stepButtonsByTrack[track.id] || [];
    btns.forEach((b, idx) => b.classList.toggle("playing", idx === step));
  }
}

function secondsPerStep() {
  // 16th notes = quarter note / 4.
  const bpm = Math.max(30, params.bpm);
  return (60 / bpm) / 4; // 16th notes
}

function getSwingAmount() {
  return Math.max(0, Math.min(PARAM_RANGES.swing.max, params.swing));
}

function swingOffsetSec(step, stepDur) {
  const swing = getSwingAmount();
  if (swing <= 0) return 0;
  // Delay offbeats (odd 16ths).
  return step % 2 === 1 ? swing * stepDur * 0.5 : 0;
}

function scheduler() {
  if (!isPlaying) return;
  // Lookahead scheduling keeps timing steady even if draw() fluctuates.
  const lookahead = PARAM_DEFAULTS.scheduler.lookaheadSec;
  const now = audioCtx.currentTime;
  const stepDur = secondsPerStep();

  while (nextStepTime < now + lookahead) {
    scheduleStep(currentStep, nextStepTime);
    nextStepTime += stepDur;
    currentStep = (currentStep + 1) % STEPS;
  }
}

function scheduleStep(step, time) {
  highlightStep(step);
  // Solo logic: if any solo button is active, only soloed tracks play.
  const anySolo = tracks.some((t) => t.solo);
  const stepDur = secondsPerStep();
  const t0 = time + swingOffsetSec(step, stepDur);

  for (const track of tracks) {
    if (anySolo && !track.solo) continue;
    if (track.muted) continue;
    if (!track.pattern[step]) continue;
    // Track level acts as a simple velocity scaler for this scheduled hit.
    const vel = Math.max(0, Math.min(1, track.level));
    if (track.id === "kick") kick.trigger(t0, vel);
    else if (track.id === "perc") perc.trigger(t0, vel);
    else if (track.id === "bass") bass.trigger(t0, step, vel);
    else if (track.id === "lead") lead.trigger(t0, step, vel, params.leadMod);
  }
}

// --- Track engines ---

function createKickEngine(ctx, destination) {
  // Kick: single oscillator with a short pitch drop + exponential amp decay.
  const osc = ctx.createOscillator();
  osc.type = "sine";
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain);
  gain.connect(destination);
  osc.start();

  const baseHz = PARAM_DEFAULTS.kick.baseHz;
  return {
    stop() {
      try {
        osc.stop();
      } catch (_) {}
      try {
        osc.disconnect();
      } catch (_) {}
      try {
        gain.disconnect();
      } catch (_) {}
    },
    trigger(time, vel) {
      const t0 = time;
      const v = Math.max(0, Math.min(1, vel ?? 1));
      const ampA = PARAM_DEFAULTS.kick.amp.attackSec;
      const ampD = PARAM_DEFAULTS.kick.amp.decaySec;

      const startHz = PARAM_DEFAULTS.kick.startHz;
      const endHz = baseHz;

      osc.frequency.cancelScheduledValues(t0);
      osc.frequency.setValueAtTime(startHz, t0);
      osc.frequency.exponentialRampToValueAtTime(endHz, t0 + PARAM_DEFAULTS.kick.pitchDropSec);

      gain.gain.cancelScheduledValues(t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.9 * v, t0 + ampA);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ampD);
    },
  };
}

function createNoisePercEngine(ctx, destination) {
  // Noise perc: a precomputed noise burst through a bandpass filter.
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 2200;
  filter.Q.value = 2.5;

  const gain = ctx.createGain();
  gain.gain.value = 0;
  filter.connect(gain);
  gain.connect(destination);

  const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  return {
    stop() {
      try {
        filter.disconnect();
      } catch (_) {}
      try {
        gain.disconnect();
      } catch (_) {}
    },
    trigger(time, vel) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;

      const t0 = time;
      const v = Math.max(0, Math.min(1, vel ?? 1));
      const a = 0.002;
      const d = PARAM_DEFAULTS.scheduler.lookaheadSec;

      gain.gain.cancelScheduledValues(t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.55 * v, t0 + a);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);

      filter.frequency.setValueAtTime(1800, t0);
      filter.frequency.exponentialRampToValueAtTime(3200, t0 + 0.015);
      filter.frequency.exponentialRampToValueAtTime(1400, t0 + a + d);

      src.connect(filter);
      src.start(t0);
      src.stop(t0 + 0.25);
    },
  };
}

function createBassEngine(ctx, destination) {
  // Bass: sawtooth -> lowpass -> gain envelope.
  // Melodic LP controls (below the sequencer) drive this filter.
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = PARAM_DEFAULTS.melodicFilter.cutoffHz;
  filter.Q.value = PARAM_DEFAULTS.melodicFilter.q;
  const gain = ctx.createGain();
  gain.gain.value = 0;

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  osc.start();

  const scale = [0, 3, 5, 7, 10, 12]; // minor-ish
  const rootMidi = 36;

  return {
    filter,
    stop() {
      try {
        osc.stop();
      } catch (_) {}
      try {
        osc.disconnect();
      } catch (_) {}
      try {
        filter.disconnect();
      } catch (_) {}
      try {
        gain.disconnect();
      } catch (_) {}
    },
    trigger(time, step, vel) {
      const deg = scale[step % scale.length];
      const midi = rootMidi + deg;
      const hz = 440 * Math.pow(2, (midi - 69) / 12);

      const t0 = time;
      const v = Math.max(0, Math.min(1, vel ?? 1));
      const a = PARAM_DEFAULTS.bass.env.a;
      const d = PARAM_DEFAULTS.bass.env.d;
      const s = PARAM_DEFAULTS.bass.env.s;
      const r = PARAM_DEFAULTS.bass.env.r;

      osc.frequency.cancelScheduledValues(t0);
      osc.frequency.setValueAtTime(osc.frequency.value, t0);
      osc.frequency.setTargetAtTime(hz, t0, 0.015);

      // filter pluck
      const baseCut = PARAM_DEFAULTS.bass.pluck.baseCutHz;
      const peakCut = PARAM_DEFAULTS.bass.pluck.peakCutHz;
      filter.frequency.cancelScheduledValues(t0);
      filter.frequency.setValueAtTime(baseCut, t0);
      filter.frequency.exponentialRampToValueAtTime(peakCut, t0 + a);
      filter.frequency.exponentialRampToValueAtTime(PARAM_DEFAULTS.bass.pluck.endCutHz, t0 + a + d);

      gain.gain.cancelScheduledValues(t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(PARAM_DEFAULTS.bass.ampPeak * v, t0 + a);
      gain.gain.exponentialRampToValueAtTime(PARAM_DEFAULTS.bass.ampPeak * v * s, t0 + a + d);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d + r);
    },
  };
}

function createLeadEngine(ctx, destination) {
  // Lead: simple 2-op-ish FM (mod oscillator -> carrier.frequency AudioParam),
  // then lowpass -> gain envelope. Extra recap controls add S&H pitch variation
  // and AM/tremolo on top of the basic lead voice.
  // Melodic LP controls (below the sequencer) drive this filter.
  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  const mod = ctx.createOscillator();
  mod.type = "sine";
  const modGain = ctx.createGain();
  modGain.gain.value = 0;

  // mod -> carrier frequency
  mod.connect(modGain);
  modGain.connect(carrier.frequency);

  const gain = ctx.createGain();
  gain.gain.value = 0;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = PARAM_DEFAULTS.melodicFilter.cutoffHz;
  filter.Q.value = PARAM_DEFAULTS.melodicFilter.q;

  carrier.connect(filter);
  filter.connect(gain);
  gain.connect(destination);

  carrier.start();
  mod.start();

  const scale = [0, 2, 3, 7, 10, 12];
  const rootMidi = 60;
  let heldSampleHoldOffset = 0;

  return {
    filter,
    stop() {
      try {
        carrier.stop();
      } catch (_) {}
      try {
        mod.stop();
      } catch (_) {}
      try {
        carrier.disconnect();
      } catch (_) {}
      try {
        mod.disconnect();
      } catch (_) {}
      try {
        modGain.disconnect();
      } catch (_) {}
      try {
        filter.disconnect();
      } catch (_) {}
      try {
        gain.disconnect();
      } catch (_) {}
    },
    trigger(time, step, vel, leadModOptions = {}) {
      const shRange = Math.max(0, Math.min(
        PARAM_RANGES.leadMod.sampleHoldSemitones.max,
        Math.round(leadModOptions.sampleHoldSemitones || 0)
      ));
      if (shRange > 0 && step % 4 === 0) {
        heldSampleHoldOffset = Math.floor(Math.random() * (shRange * 2 + 1)) - shRange;
      } else if (shRange === 0) {
        heldSampleHoldOffset = 0;
      }

      const midi = rootMidi + scale[step % scale.length] + heldSampleHoldOffset;
      const hz = 440 * Math.pow(2, (midi - 69) / 12);
      const t0 = time;
      const v = Math.max(0, Math.min(1, vel ?? 1));
      const a = PARAM_DEFAULTS.lead.env.a;
      const d = PARAM_DEFAULTS.lead.env.d;
      const r = PARAM_DEFAULTS.lead.env.r;
      const amDepth = Math.max(0, Math.min(PARAM_RANGES.leadMod.amDepth.max, leadModOptions.amDepth || 0));
      const amRate = PARAM_DEFAULTS.leadMod.amRateHz;
      const am1 = 1 - amDepth * 0.65;
      const am2 = 1;
      const am3 = 1 - amDepth;

      carrier.frequency.cancelScheduledValues(t0);
      carrier.frequency.setValueAtTime(hz, t0);

      mod.frequency.setValueAtTime(hz * PARAM_DEFAULTS.lead.mod.ratio, t0);

      modGain.gain.cancelScheduledValues(t0);
      modGain.gain.setValueAtTime(0, t0);
      modGain.gain.linearRampToValueAtTime(PARAM_DEFAULTS.lead.mod.depth, t0 + a);
      modGain.gain.linearRampToValueAtTime(0, t0 + a + d);

      gain.gain.cancelScheduledValues(t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(PARAM_DEFAULTS.lead.ampPeak * v * am2, t0 + a);
      if (amDepth > 0.001) {
        const pulse = 1 / amRate;
        gain.gain.linearRampToValueAtTime(PARAM_DEFAULTS.lead.ampPeak * v * am1, t0 + a + pulse * 0.5);
        gain.gain.linearRampToValueAtTime(PARAM_DEFAULTS.lead.ampPeak * v * am2, t0 + a + pulse);
        gain.gain.linearRampToValueAtTime(PARAM_DEFAULTS.lead.ampPeak * v * am3, t0 + a + d);
      }
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d + r);
    },
  };
}

function onTapTempo() {
  const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (lastTapAtMs > 0) {
    const deltaSec = Math.max(0.001, (nowMs - lastTapAtMs) / 1000);
    const bpm = Math.round(Math.max(60, Math.min(170, 60 / deltaSec)));
    if (bpmSlider) bpmSlider.value = `${bpm}`;
    if (bpmValueSpan) bpmValueSpan.textContent = `${bpm}`;
    params = { ...params, bpm };
  }
  lastTapAtMs = nowMs;
}

function applyMelodicFilterParams() {
  if (!audioCtx) return;
  // Bypass is implemented by pushing cutoff very high and Q very low (no reroute).
  const freq = Math.max(PARAM_RANGES.melodicFilter.cutoffHz.min, params.melodicFilter.cutoffHz);
  const q = Math.max(PARAM_RANGES.melodicFilter.q.min, params.melodicFilter.q);
  const now = audioCtx.currentTime;
  const enabled = !!params.melodicFilter.enabled;
  const targetFreq = enabled ? freq : PARAM_DEFAULTS.melodicFilter.bypass.cutoffHz;
  const targetQ = enabled ? q : PARAM_DEFAULTS.melodicFilter.bypass.q;
  if (bass && bass.filter) {
    bass.filter.frequency.setTargetAtTime(targetFreq, now, 0.01);
    bass.filter.Q.setTargetAtTime(targetQ, now, 0.01);
  }
  if (lead && lead.filter) {
    lead.filter.frequency.setTargetAtTime(targetFreq, now, 0.01);
    lead.filter.Q.setTargetAtTime(targetQ, now, 0.01);
  }
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
    const y = map(scopeData[i], -1, 1, centerY + panelHalfHeight, centerY - panelHalfHeight);
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
  scheduler();

  const now = millis() / 1000;
  const dt = lastDrawTime > 0 ? now - lastDrawTime : 0;
  lastDrawTime = now;

  // Visual-only output preview (not true audio tap)
  const hz = 110;
  previewPhase += TWO_PI * hz * Math.max(dt, 0);
  const v = Math.sin(previewPhase) * (isPlaying ? 0.7 : 0.15);

  const panelWidth = width - 40;
  outScope.push(v);
  if (outScope.length > panelWidth) outScope.shift();

  const title = "Mini groovebox: 4-track 16-step sequencer";
  textSize(14);
  const titleW = textWidth(title) + 12;
  fill(0);
  noStroke();
  rect(14, 10, titleW, 20, 6);
  fill(255);
  text(title, 20, 24);

  drawScopePanel(outScope, 200, "output preview (visual only)");

  const bpm = Math.round(params.bpm);
  const mode = `${isPlaying ? "PLAY" : "STOP"} · bpm ${bpm} · step ${currentStep + 1}/${STEPS}`;
  textSize(11);
  const mW = textWidth(mode) + 10;
  fill(0);
  rect(16, height - 18, mW, 16, 4);
  fill(255);
  text(mode, 20, height - 6);
}
