# strudel-node

Node.js runtime for [Strudel](https://strudel.cc), a live coding environment for music. Plays audio directly through your system speakers — no browser required.

Built on [node-web-audio-api](https://github.com/ircam-ismm/node-web-audio-api) for native audio output and the full Strudel pattern engine (transpiler, mini notation, tonal helpers).

## Install

```
npm install
```

## Usage

### CLI

```bash
# Run a .strudel file (loops forever)
node cli.mjs examples/arpeggiated.strudel

# Play a fixed number of cycles then stop
node cli.mjs examples/song.strudel --cycles 16

# Set tempo (default 0.5 = 120bpm)
node cli.mjs examples/song.strudel --cycles 16 --cps 1

# Live-reload on file save
node cli.mjs examples/chord-pad.strudel --watch

# Inline code
node cli.mjs 'note("c3 e3 g3 c4").s("sine")'

# Load samples from a directory and play a beat
node cli.mjs examples/beat.strudel --samples samples

# Default pattern (triangle arpeggio)
node cli.mjs
```

### Song files

Write Strudel patterns in `.strudel` files — they contain the same code you'd use inline or in the Strudel REPL:

```
// chord-pad.strudel
note("<[c3,e3,g3] [f3,a3,c4] [g3,b3,d4] [a3,c4,e4]>")
  .s("sine")
  .gain(0.5)
  .attack(0.1)
  .release(0.3)
```

Use `arrange()` to sequence sections into a full song:

```
// song.strudel — run with: node cli.mjs examples/song.strudel --cycles 16
arrange(
  [4, note("c3 e3 g3 c4").s("sine").gain(0.3)],
  [4, note("c3 e3 g3 c4").s("triangle").gain(0.5).fast(2)],
  [4, note("<[c3,e3,g3] [f3,a3,c4] [g3,b3,d4]>").s("sine").gain(0.6)],
  [4, note("c3 e3 g3 c4").s("sine").gain(0.3).slow(2)]
)
```

See `examples/` for more.

### As a library

```js
import { createRepl } from './index.mjs';

const repl = await createRepl();

// Evaluate and play a pattern
await repl.evaluate('note("c3 e3 g3 c4").s("triangle")', true);

// Swap to a new pattern (replaces the previous one)
await repl.evaluate('note("c2 eb2 g2 bb2").s("sawtooth").gain(0.4)', true);

// Stop
repl.stop();
```

### Render mode (play once)

```js
import { renderCycles } from './index.mjs';

// Play 16 cycles of a song and exit
await renderCycles(`
  arrange(
    [4, note("c3 e3 g3 c4").s("sine").gain(0.3)],
    [4, note("c3 e3 g3 c4").s("triangle").fast(2)],
    [8, note("<[c3,e3,g3] [f3,a3,c4]>").s("sine")]
  )
`, 16, { cps: 0.5 });
```

### Samples

Load audio samples (wav, mp3, ogg, flac) from a directory or JSON map:

```bash
# Via CLI flag
node cli.mjs 's("bd hh sn hh")' --samples /path/to/dirt-samples

# Or in .strudel code (use single quotes — double quotes become mini notation)
await samples('/path/to/dirt-samples')
s("bd hh sn hh")
```

Sample directories should be organized as `dir/sampleName/file0.wav`:

```
samples/
  bd/
    bd0.wav
    bd1.wav
  hh/
    hh0.wav
    hh1.wav
  sn/
    sn0.wav
```

Use `n()` to select sample variants: `s("bd").n(1)` plays `bd1.wav`.

You can also load from a JSON map:

```js
await samples('samples.json')  // { "bd": ["bd/bd0.wav", "bd/bd1.wav"], ... }
```

Or as a library:

```js
import { createRepl, samples } from './index.mjs';

await samples('/path/to/samples');
const repl = await createRepl();
await repl.evaluate('s("bd hh sn hh")', true);
```

### Custom sounds

```js
import { createRepl, registerSound } from './index.mjs';
import { OscillatorNode, GainNode } from 'node-web-audio-api';

registerSound('mybass', (ac, t, value, duration) => {
  const osc = new OscillatorNode(ac, { type: 'sawtooth', frequency: 80 });
  const gain = new GainNode(ac, { gain: 0.5 });
  osc.connect(gain);
  osc.start(t);
  osc.stop(t + duration);
  return gain;
});

const repl = await createRepl();
await repl.evaluate('s("mybass").fast(4)', true);
```

## What works

- **Samples**: Load wav/mp3/ogg/flac from directories or JSON maps; `s("bd")`, `n()` for variants, `speed`, `begin`/`end` for slicing
- **Synths**: `sine`, `triangle`, `square`, `sawtooth` (+ aliases `sin`, `tri`, `sqr`, `saw`), `noise`
- **Envelopes**: `attack`, `decay`, `sustain`, `release`
- **Pitch**: `note()`, `freq()`, `n()`
- **Effects**: `cutoff`/`resonance` (lowpass), `hcutoff`/`hresonance` (highpass), `pan`
- **Pattern functions**: Everything from `@strudel/core`, `@strudel/mini`, `@strudel/tonal` — `fast`, `slow`, `rev`, `jux`, `scale`, chords, arpeggios, etc.

## What doesn't work (yet)

- **AudioWorklet effects** — `crush`, `shape`, `coarse`, `supersaw`, `pulse` (these need worklet loading adapted for Node.js)
- **MIDI output**
- **OSC output**
- **Visualization** — `pianoroll`, `scope`, etc. are stubbed to no-ops

## How it works

Strudel's architecture cleanly separates pattern evaluation from audio output:

1. **Pattern engine** (`@strudel/core`) generates timed events ("haps")
2. **Cyclist** (scheduler) queries patterns and fires triggers at the right time
3. **Audio output** receives each hap and synthesizes sound

This project replaces step 3 with a Node.js-compatible implementation using `node-web-audio-api`, which provides the Web Audio API backed by native audio (via Rust). The pattern engine and scheduler run unmodified.

## License

AGPL-3.0-or-later (matching Strudel)
