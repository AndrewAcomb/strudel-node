#!/usr/bin/env node

// CLI entry point for strudel-node.
//
// Usage:
//   strudel-node song.strudel          # run a file
//   strudel-node song.strudel --watch  # run + reload on changes
//   strudel-node 'note("c3 e3").s("sine")'  # inline code
//   strudel-node                       # default demo pattern

import { readFileSync, watchFile, unwatchFile, existsSync } from 'fs';
import { resolve } from 'path';
import { createRepl } from './index.mjs';

const args = process.argv.slice(2);
const watchFlag = args.includes('--watch') || args.includes('-w');
const input = args.find((a) => a !== '--watch' && a !== '-w');

function loadCode(input) {
  if (!input) return 'note("c3 e3 g3 c4").s("triangle")';

  // If it looks like a file path (has an extension or exists on disk), read it
  const filePath = resolve(input);
  if (existsSync(filePath)) {
    return { code: readFileSync(filePath, 'utf-8').trim(), file: filePath };
  }

  // Otherwise treat as inline code
  return input;
}

const loaded = loadCode(input);
const isFile = typeof loaded === 'object';
const code = isFile ? loaded.code : loaded;
const filePath = isFile ? loaded.file : null;

const r = await createRepl();

async function run(code) {
  r.stop();
  try {
    await r.evaluate(code, true);
  } catch (e) {
    console.error(`error: ${e.message}`);
  }
}

if (filePath) {
  console.log(`strudel-node | ${filePath}`);
} else {
  console.log(`strudel-node | ${code}`);
}

await run(code);

if (watchFlag && filePath) {
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
