import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, join, basename, extname, dirname } from 'path';
import { getAudioContext } from './audio.mjs';

const sampleRegistry = new Map();
const bufferCache = new Map();

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.aif', '.aiff']);

function isAudioFile(filename) {
  return AUDIO_EXTENSIONS.has(extname(filename).toLowerCase());
}

function isUrl(s) {
  return s.startsWith('http://') || s.startsWith('https://');
}

function logLoaded(loaded, source) {
  const total = Object.values(loaded).reduce((a, b) => a + b, 0);
  const groups = Object.keys(loaded).length;
  const from = source ? ` from ${source}` : '';
  console.log(`loaded ${total} samples${from} (${groups} groups)`);
}

async function decodeFile(filePath) {
  if (bufferCache.has(filePath)) return bufferCache.get(filePath);

  const ac = getAudioContext();
  const data = readFileSync(filePath);
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const audioBuffer = await ac.decodeAudioData(arrayBuffer);
  bufferCache.set(filePath, audioBuffer);
  return audioBuffer;
}

async function decodeUrl(url) {
  if (bufferCache.has(url)) return bufferCache.get(url);

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

function decodeAny(path) {
  return isUrl(path) ? decodeUrl(path) : decodeFile(resolve(path));
}

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
      const files = readdirSync(entryPath)
        .filter(isAudioFile)
        .sort()
        .map(f => join(entryPath, f));

      if (files.length > 0) {
        const name = entry.toLowerCase();
        const buffers = await Promise.all(files.map(decodeFile));
        sampleRegistry.set(name, buffers);
        loaded[name] = buffers.length;
      }
    } else if (isAudioFile(entry)) {
      const name = basename(entry, extname(entry)).toLowerCase();
      if (!sampleRegistry.has(name)) sampleRegistry.set(name, []);
      const buffer = await decodeFile(entryPath);
      sampleRegistry.get(name).push(buffer);
      loaded[name] = (loaded[name] || 0) + 1;
    }
  }

  return loaded;
}

async function loadJsonMap(jsonPath) {
  const absPath = resolve(jsonPath);
  const baseDir = dirname(absPath);
  const map = JSON.parse(readFileSync(absPath, 'utf-8'));
  const loaded = {};

  for (const [name, paths] of Object.entries(map)) {
    const key = name.toLowerCase();
    const filePaths = (Array.isArray(paths) ? paths : [paths]).map(p =>
      isUrl(p) ? p : resolve(baseDir, p)
    );

    const buffers = await Promise.all(filePaths.map(decodeAny));
    sampleRegistry.set(key, buffers);
    loaded[key] = buffers.length;
  }

  return loaded;
}

export async function samples(source, baseUrl) {
  // The strudel transpiler converts double-quoted strings to mini notation
  // Patterns. Unwrap them back to plain strings so samples("path") works.
  if (source && typeof source === 'object' && typeof source.queryArc === 'function') {
    const haps = source.queryArc(0, 1);
    if (haps.length > 0 && typeof haps[0].value === 'string') {
      source = haps[0].value;
    } else {
      throw new Error("samples() received a Pattern — use single quotes for paths: samples('/path/to/samples')");
    }
  }

  if (typeof source === 'string') {
    const resolved = resolve(source);

    if (source.endsWith('.json') && existsSync(resolved)) {
      const loaded = await loadJsonMap(resolved);
      logLoaded(loaded, resolved);
      return loaded;
    }

    if (existsSync(resolved) && statSync(resolved).isDirectory()) {
      const loaded = await loadDirectory(resolved);
      logLoaded(loaded, resolved);
      return loaded;
    }

    if (isUrl(source)) {
      const response = await fetch(source);
      const map = await response.json();
      const loaded = {};
      for (const [name, urls] of Object.entries(map)) {
        const key = name.toLowerCase();
        const urlList = Array.isArray(urls) ? urls : [urls];
        const resolvedUrls = urlList.map(u => {
          if (isUrl(u)) return u;
          const base = baseUrl || new URL('.', source).href;
          return new URL(u, base).href;
        });
        const buffers = await Promise.all(resolvedUrls.map(decodeUrl));
        sampleRegistry.set(key, buffers);
        loaded[key] = buffers.length;
      }
      logLoaded(loaded, source);
      return loaded;
    }

    throw new Error(`Cannot load samples from: ${source}`);
  }

  if (typeof source === 'object' && source !== null && !source.queryArc) {
    const loaded = {};
    for (const [name, paths] of Object.entries(source)) {
      const key = name.toLowerCase();
      const pathList = Array.isArray(paths) ? paths : [paths];
      const buffers = await Promise.all(pathList.map(decodeAny));
      sampleRegistry.set(key, buffers);
      loaded[key] = buffers.length;
    }
    logLoaded(loaded);
    return loaded;
  }

  throw new Error('samples() expects a directory path, JSON file path, URL, or object map');
}

export function getSampleBuffer(name, n = 0) {
  const buffers = sampleRegistry.get(name.toLowerCase());
  if (!buffers || buffers.length === 0) return null;
  return buffers[n % buffers.length];
}

export function hasSample(name) {
  return sampleRegistry.has(name.toLowerCase());
}

export function listSamples() {
  const result = {};
  for (const [name, buffers] of sampleRegistry) {
    result[name] = buffers.length;
  }
  return result;
}
