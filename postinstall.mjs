#!/usr/bin/env node

// Patches @kabelsalat/web's package.json to add an "exports" map.
//
// The published package only has "main" and "module" fields, but no "exports".
// Node.js ESM resolution ignores the "module" field and falls back to the CJS
// "main" entry, which doesn't export SalatRepl. Adding an explicit exports map
// fixes the resolution so @strudel/core can import it correctly.
//
// This can be removed once @kabelsalat/web publishes a fix upstream.

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, 'node_modules', '@kabelsalat', 'web', 'package.json');

try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  if (!pkg.exports) {
    pkg.exports = {
      '.': {
        import: './dist/index.mjs',
        require: './dist/index.js',
      },
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log('postinstall: patched @kabelsalat/web exports');
  }
} catch (e) {
  console.warn('postinstall: could not patch @kabelsalat/web:', e.message);
}
