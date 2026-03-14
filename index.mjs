// Strudel Node.js runtime.
//
// Provides a complete Strudel REPL that outputs real audio via node-web-audio-api.
//
// Usage:
//   import { createRepl } from 'strudel-node';
//   const repl = await createRepl();
//   await repl.evaluate('note("c3 e3 g3 c4").s("sine")');

import { repl, evalScope, Pattern } from '@strudel/core';
import * as strudel from '@strudel/core';
import { transpiler } from '@strudel/transpiler';
import { mini, m } from '@strudel/mini/mini.mjs';
import * as tonalHelpers from '@strudel/tonal';
import { getAudioContext, nodeAudioOutput, registerSound } from './audio.mjs';

export { getAudioContext, nodeAudioOutput, registerSound } from './audio.mjs';

// Populate the eval scope with all strudel functions
await evalScope(
  strudel,
  tonalHelpers,
  {
    mini,
    m,
    getAudioContext,
    registerSound,
    // Stubs for browser-only APIs that patterns may reference
    loadSoundfont: () => {},
    getDrawContext: () => ({
      clearRect: () => {},
      fillText: () => {},
      fillRect: () => {},
      canvas: { width: 100, height: 100 },
    }),
  },
);

// Stub browser-only pattern methods so they pass through without errors
const BROWSER_ONLY_METHODS = [
  'pianoroll', '_pianoroll', '_scope', '_spiral', '_spectrum', '_pitchwheel',
  'scope', 'wave', 'midi', 'csound', 'soundfont', 'osc',
  'webdirt', 'tone', 'speak', 'markcss', 'filter', 'adsr', 'webaudio',
];
for (const method of BROWSER_ONLY_METHODS) {
  if (!Pattern.prototype[method]) {
    Pattern.prototype[method] = function () {
      return this;
    };
  }
}

export async function createRepl(options = {}) {
  const ac = getAudioContext();

  return repl({
    defaultOutput: nodeAudioOutput,
    getTime: () => ac.currentTime,
    transpiler,
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    ...options,
  });
}
