# p5 Editor Learning Copies

This folder contains copy-ready versions of the C3 Sound Sketches for the p5.js Web Editor. The original files one level up remain the no-build browser demos.

Each sketch folder contains:

- `index.html` - loads p5.js, p5.sound, and `sketch.js`.
- `sketch.js` - the learning-copy source with concise teaching comments.
- `README.md` - the concept, import steps, and one code-reading prompt.

## Sketches

- [Function Generator to Looping Oscillator](./1_function-generator/) - Sample one cycle of a function into a buffer, then loop it fast enough to hear pitch.
- [Wavetable / Additive Synthesis](./5_wavetable/) - Build a waveform from sine partials, write it into a wavetable, and loop it as an oscillator.
- [Subtractive Synthesis](./4_subtractive/) - Start with a bright oscillator, then shape loudness and brightness with envelopes and a low-pass filter.
- [Sample and Hold Frequency Steps](./9_sample-hold/) - Sample a random signal at a fixed rate and hold each value to create stepped pitch movement.
- [Frequency Modulation](./6_fm-mod/) - Use one signal to push another oscillator's frequency, moving from vibrato to complex timbre.
- [Advanced Two-Operator FM](./7_fm-advanced/) - Explore a carrier plus modulator pair with ratio, index envelope, and feedback controls.
- [Amplitude / Ring Modulation](./3_am-ring-mod/) - Multiply a carrier by a modulator, from slow tremolo to fast ring-mod-like tones.
- [Noise Percussion](./2_noise-percussion/) - Shape noise with triggered envelopes to turn raw noise into rhythmic percussion.
- [FM + AM Kick](./8_fm-am-kick/) - Combine pitch drop, FM punch, and amplitude decay to design an electronic kick drum.
- [Mini Groovebox](./11_groovebox/) - Combine several small synth engines inside a 16-step sequencer.
- [Breakbeat Slicer](./10_breakbeat-slicer/) - Use sample-and-hold to choose slices from a remote drum break.
