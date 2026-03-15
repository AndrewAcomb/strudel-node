import { repl, evalScope, Pattern } from '@strudel/core';
import * as strudel from '@strudel/core';
import { transpiler } from '@strudel/transpiler';
import { mini, m } from '@strudel/mini/mini.mjs';
import * as tonalHelpers from '@strudel/tonal';
import { getAudioContext, nodeAudioOutput, registerSound } from './audio.mjs';
import { samples, listSamples } from './samples.mjs';

export { getAudioContext, nodeAudioOutput, registerSound } from './audio.mjs';
export { samples, listSamples } from './samples.mjs';

await evalScope(
  strudel,
  tonalHelpers,
  {
    mini,
    m,
    getAudioContext,
    registerSound,
    samples,
    listSamples,
    loadSoundfont: () => {},
    getDrawContext: () => ({
      clearRect: () => {},
      fillText: () => {},
      fillRect: () => {},
      canvas: { width: 100, height: 100 },
    }),
  },
);

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

export async function renderCycles(code, numCycles, options = {}) {
  const ac = getAudioContext();
  const cps = options.cps ?? 0.5;
  const r = await createRepl();

  // evaluate() returns the Pattern directly, not wrapped
  const pattern = await r.evaluate(code, false);
  if (!pattern || !pattern._Pattern) {
    throw new Error('Code did not produce a pattern');
  }

  const haps = pattern.queryArc(0, numCycles);
  const startTime = ac.currentTime + 0.1;
  let lastEndTime = startTime;

  for (const hap of haps) {
    if (!hap.whole) continue;
    const begin = Number(hap.whole.begin);
    const end = Number(hap.whole.end);
    const hapDuration = end - begin;
    const t = startTime + begin / cps;
    const endTime = startTime + end / cps;

    nodeAudioOutput(hap, 0, hapDuration, cps, t);

    if (endTime > lastEndTime) lastEndTime = endTime;
  }

  const totalMs = (lastEndTime - ac.currentTime) * 1000 + 500;
  console.log(`rendering ${haps.length} events over ${numCycles} cycles (${(totalMs / 1000).toFixed(1)}s)`);
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, totalMs)));
}
