#!/usr/bin/env node

// CLI entry point for strudel-node.
//
// Usage:
//   node cli.mjs 'note("c3 e3 g3 c4").s("sine")'
//   node cli.mjs  # defaults to a triangle arpeggio

import { createRepl } from './index.mjs';

const code = process.argv[2] || 'note("c3 e3 g3 c4").s("triangle")';
const r = await createRepl();

console.log(`strudel-node | ${code}`);
await r.evaluate(code, true);

process.on('SIGINT', () => {
  r.stop();
  process.exit(0);
});
