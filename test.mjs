#!/usr/bin/env node

// Smoke tests — plays each pattern briefly to verify the pipeline works.

import { createRepl } from './index.mjs';

const tests = [
  { name: 'triangle arpeggio', code: 'note("c3 e3 g3 c4").s("triangle")' },
  { name: 'sine chord',        code: 'note("c3,e3,g3").s("sine")' },
  { name: 'fast square',       code: 'note("c4 e4 g4 c5").s("square").fast(2).gain(0.4)' },
  { name: 'saw bass',          code: 'note("c2 c2 eb2 f2").s("sawtooth").gain(0.5)' },
  { name: 'mini notation',     code: 's("triangle square sine sawtooth")' },
];

const DURATION_MS = 2500;
const r = await createRepl();
let passed = 0;

for (const test of tests) {
  process.stdout.write(`  ${test.name} ... `);
  try {
    await r.evaluate(test.code, true);
    await new Promise((resolve) => setTimeout(resolve, DURATION_MS));
    r.stop();
    console.log('ok');
    passed++;
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
  }
}

console.log(`\n${passed}/${tests.length} passed`);
process.exit(passed === tests.length ? 0 : 1);
