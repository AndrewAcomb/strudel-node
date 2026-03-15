// Sample loading and playback for strudel-node.
//
// Supports loading samples from local directories, JSON sample maps, URLs,
// or inline objects. See README.md for usage.

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, join, basename, extname, dirname } from 'path';
import { getAudioContext } from './audio.mjs';

// Registry: name → AudioBuffer[]
const sampleRegistry = new Map();

// Cache: absolute file path → AudioBuffer (avoid re-decoding)
const bufferCache = new Map();

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.aif', '.aiff']);

function isAudioFile(filename) {
  return AUDIO_EXTENSIONS.has(extname(filename).toLowerCase());
}

// Decode an audio file from disk into an AudioBuffer.
async function decodeFile(filePath) {
  if (bufferCache.has(filePath)) {
    return bufferCache.get(filePath);
  }

  const ac = getAudioContext();
  const data = readFileSync(filePath);
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

  const audioBuffer = await ac.decodeAudioData(arrayBuffer);
  bufferCache.set(filePath, audioBuffer);
  return audioBuffer;
}

// Fetch and decode an audio file from a URL.
async function decodeUrl(url) {
  if (bufferCache.has(url)) {
    return bufferCache.get(url);
  }

  const ac = getAudioContext();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch sample: ${url} (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await ac.decodeAudioData(arrayBuffer);
  bufferCache.set(url, audioBuffer);
  return audioBuffer;
}

// Load all samples from a directory.
// Expects structure: dir/sampleName/file0.wav, file1.wav, ...
// Or flat: dir/file0.wav, file1.wav (grouped by name stem)
async function loadDirectory(dirPath) {
  const absDir = resolve(dirPath);
  if (!existsSync(absDir)) {
    throw new Error(`Sample directory not found: ${absDir}`);
  }

  const entries = readdirSync(absDir);
  const loaded = {};

  for (const entry of entries) {
    const entryPath = join(absDir, entry);
    const stat = statSync(entryPath);

    if (stat.isDirectory()) {
      // Subdirectory = sample group (e.g., bd/, hh/, sn/)
      const files = readdirSync(entryPath)
        .filter(isAudioFile)
        .sort()
        .map(f => join(entryPath, f));

      if (files.length > 0) {
        const name = entry.toLowerCase();
        const buffers = await Promise.all(files.map(f => decodeFile(f)));
        sampleRegistry.set(name, buffers);
        loaded[name] = buffers.length;
      }
    } else if (isAudioFile(entry)) {
      // Flat file — group by name without extension
      const name = basename(entry, extname(entry)).toLowerCase();
      if (!sampleRegistry.has(name)) {
        sampleRegistry.set(name, []);
      }
      const buffer = await decodeFile(entryPath);
      sampleRegistry.get(name).push(buffer);
      loaded[name] = (loaded[name] || 0) + 1;
    }
  }

  return loaded;
}

// Load samples from a JSON map.
// Format: { "bd": ["path/bd0.wav", "path/bd1.wav"], "hh": ["path/hh.wav"] }
// Paths are relative to the JSON file's directory (or absolute).
async function loadJsonMap(jsonPath) {
  const absPath = resolve(jsonPath);
  const baseDir = dirname(absPath);
  const map = JSON.parse(readFileSync(absPath, 'utf-8'));
  const loaded = {};

  for (const [name, paths] of Object.entries(map)) {
    const key = name.toLowerCase();
    const filePaths = (Array.isArray(paths) ? paths : [paths]).map(p => {
      if (p.startsWith('http://') || p.startsWith('https://')) return p;
      return resolve(baseDir, p);
    });

    const buffers = await Promise.all(
      filePaths.map(p =>
        p.startsWith('http') ? decodeUrl(p) : decodeFile(p)
      )
    );

    sampleRegistry.set(key, buffers);
    loaded[key] = buffers.length;
  }

  return loaded;
}

// Main entry point — load samples from a directory, JSON file, or inline map.
export async function samples(source, baseUrl) {
  // The strudel transpiler converts double-quoted strings to mini notation Patterns.
  // Unwrap them back to plain strings so samples("path") works in .strudel files.
  if (source && typeof source === 'object' && typeof source.queryArc === 'function') {
    const haps = source.queryArc(0, 1);
    if (haps.length > 0 && typeof haps[0].value === 'string') {
      source = haps[0].value;
    } else {
      throw new Error('samples() received a Pattern — use single quotes for paths: samples(\'path/to/samples\')');
    }
  }

  if (typeof source === 'string') {
    const resolved = resolve(source);

    // JSON file
    if (source.endsWith('.json') && existsSync(resolved)) {
      const loaded = await loadJsonMap(resolved);
      const total = Object.values(loaded).reduce((a, b) => a + b, 0);
      console.log(`loaded ${total} samples from ${resolved} (${Object.keys(loaded).length} groups)`);
      return loaded;
    }

    // Directory
    if (existsSync(resolved) && statSync(resolved).isDirectory()) {
      const loaded = await loadDirectory(resolved);
      const total = Object.values(loaded).reduce((a, b) => a + b, 0);
      console.log(`loaded ${total} samples from ${resolved} (${Object.keys(loaded).length} groups)`);
      return loaded;
    }

    // URL to JSON map
    if (source.startsWith('http://') || source.startsWith('https://')) {
      const response = await fetch(source);
      const map = await response.json();
      const loaded = {};
      for (const [name, urls] of Object.entries(map)) {
        const key = name.toLowerCase();
        const urlList = Array.isArray(urls) ? urls : [urls];
        const resolvedUrls = urlList.map(u => {
          if (u.startsWith('http')) return u;
          const base = baseUrl || source.replace(/\/[^/]*$/, '/');
          return new URL(u, base).href;
        });
        const buffers = await Promise.all(resolvedUrls.map(u => decodeUrl(u)));
        sampleRegistry.set(key, buffers);
        loaded[key] = buffers.length;
      }
      const total = Object.values(loaded).reduce((a, b) => a + b, 0);
      console.log(`loaded ${total} samples from URL (${Object.keys(loaded).length} groups)`);
      return loaded;
    }

    throw new Error(`Cannot load samples from: ${source}`);
  }

  // Inline map: samples({ bd: ['path/bd0.wav'], hh: ['path/hh.wav'] })
  if (typeof source === 'object' && source !== null && !source.queryArc) {
    const loaded = {};
    for (const [name, paths] of Object.entries(source)) {
      const key = name.toLowerCase();
      const pathList = Array.isArray(paths) ? paths : [paths];
      const buffers = await Promise.all(
        pathList.map(p => {
          if (p.startsWith('http')) return decodeUrl(p);
          return decodeFile(resolve(p));
        })
      );
      sampleRegistry.set(key, buffers);
      loaded[key] = buffers.length;
    }
    const total = Object.values(loaded).reduce((a, b) => a + b, 0);
    console.log(`loaded ${total} samples (${Object.keys(loaded).length} groups)`);
    return loaded;
  }

  throw new Error('samples() expects a directory path, JSON file path, URL, or object map');
}

// Look up a sample buffer by name and index.
export function getSampleBuffer(name, n = 0) {
  const buffers = sampleRegistry.get(name.toLowerCase());
  if (!buffers || buffers.length === 0) return null;
  return buffers[n % buffers.length];
}

// Check if a name is registered as a sample.
export function hasSample(name) {
  return sampleRegistry.has(name.toLowerCase());
}

// List all registered sample names.
export function listSamples() {
  const result = {};
  for (const [name, buffers] of sampleRegistry) {
    result[name] = buffers.length;
  }
  return result;
}
