# Breakbeat Slicer

This is a p5.js Web Editor learning copy inspired by `sample-hold.html`.

## Concept

Use sample-and-hold to choose drum-break slices. A random value is sampled on
the clock, held for one or more steps, and mapped to a slice index inside a
breakbeat from `github:switchangel/breaks`.

## Use In The p5.js Web Editor

1. Create a new sketch at https://editor.p5js.org/.
2. Replace the default `sketch.js` with this folder's `sketch.js`.
3. Replace the default `index.html` with this folder's `index.html` so p5.sound is loaded.
4. Press `Start` after the break has loaded.

## Code Reading Prompt

Try changing `BREAKS`, `DEFAULT_SLICE_COUNT`, `HOLD_DRIFT_DEFAULT`, and
`STEP_RATE_DEFAULT`.

## Source

- https://github.com/switchangel/breaks - Public breakbeat WAV files used by this example.
