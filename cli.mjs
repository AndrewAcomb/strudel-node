#!/usr/bin/env node

// CLI entry point for strudel-node.
//
// Usage:
//   strudel-node song.strudel                       # run a file (loops forever)
//   strudel-node song.strudel --watch               # run + reload on changes
//   strudel-node song.strudel --cycles 16           # play 16 cycles then stop
//   strudel-node beat.strudel --samples ./samples   # load samples from dir
//   strudel-node 'note("c3 e3").s("sine")'          # inline code
//   strudel-node                                     # default demo pattern

import { readFileSync, watchFile, unwatchFile, existsSync } from 'fs';
import { resolve } from 'path';
import { createRepl, renderCycles, samples } from './index.mjs';

// Parse flags
const args = process.argv.slice(2);
const flags = new Set();
const params = {};
const positional = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--watch' || args[i] === '-w') {
    flags.add('watch');
  } else if (args[i] === '--cycles' || args[i] === '-c') {
    params.cycles = parseInt(args[++i], 10);
  } else if (args[i] === '--cps') {
    params.cps = parseFloat(args[++i]);
  } else if (args[i] === '--samples' || args[i] === '-s') {
    if (!params.samples) params.samples = [];
    params.samples.push(args[++i]);
  } else {
    positional.push(args[i]);
  }
}

const input = positional[0];

function loadCode(input) {
  if (!input) return 'note("c3 e3 g3 c4").s("triangle")';

  const filePath = resolve(input);
  if (existsSync(filePath)) {
    return { code: readFileSync(filePath, 'utf-8').trim(), file: filePath };
  }

  return input;
}

const loaded = loadCode(input);
const isFile = typeof loaded === 'object';
const code = isFile ? loaded.code : loaded;
const filePath = isFile ? loaded.file : null;

if (filePath) {
  console.log(`strudel-node | ${filePath}`);
} else {
  console.log(`strudel-node | ${code}`);
}

// Load samples if specified via CLI
if (params.samples) {
  for (const src of params.samples) {
    await samples(src);
  }
}

// Render mode: play N cycles then exit
if (params.cycles) {
  await renderCycles(code, params.cycles, { cps: params.cps });
  process.exit(0);
}

// Live mode: loop forever
const r = await createRepl();

async function run(code) {
  r.stop();
  try {
    await r.evaluate(code, true);
  } catch (e) {
    console.error(`error: ${e.message}`);
  }
}

await run(code);

if (flags.has('watch') && filePath) {
  console.log('watching for changes... (ctrl-c to stop)');
  watchFile(filePath, { interval: 300 }, () => {
    const updated = readFileSync(filePath, 'utf-8').trim();
    console.log(`\nreloading ${filePath}...`);
    run(updated);
  });
}

process.on('SIGINT', () => {
  if (filePath) unwatchFile(filePath);
  r.stop();
  process.exit(0);
});
