// Node.js audio output for Strudel using node-web-audio-api.
//
// Provides a minimal synthesis layer that replaces superdough/webaudio
// for headless Node.js environments. Supports basic waveform synths
// (sine, triangle, square, sawtooth), ADSR envelopes, filters, and panning.

import {
  AudioContext,
  OscillatorNode,
  GainNode,
  BiquadFilterNode,
  StereoPannerNode,
  AudioBufferSourceNode,
} from 'node-web-audio-api';
import { getSampleBuffer, hasSample } from './samples.mjs';

let audioContext;

export function getAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext({ latencyHint: 'playback' });
    audioContext.resume(); // node-web-audio-api starts in suspended state
  }
  return audioContext;
}

export function setAudioContext(ctx) {
  audioContext = ctx;
}

// Sound registry: name -> (ac, t, value, durationSecs) => AudioNode
const soundRegistry = new Map();

export function registerSound(name, triggerFn) {
  soundRegistry.set(name.toLowerCase(), triggerFn);
}

// Pitch utilities

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function noteToMidi(note) {
  const semitones = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const match = note.match(/^([a-gA-G])([#b]?)(\d+)?$/);
  if (!match) return null;
  const [, letter, accidental, octaveStr] = match;
  let midi = semitones[letter.toLowerCase()];
  if (accidental === '#') midi++;
  if (accidental === 'b') midi--;
  const octave = octaveStr != null ? parseInt(octaveStr) : 3;
  return midi + (octave + 1) * 12;
}

function getFrequency(value) {
  if (value.freq != null) return value.freq;
  if (value.note != null) {
    if (typeof value.note === 'number') return midiToFreq(value.note);
    const midi = noteToMidi(value.note);
    if (midi != null) return midiToFreq(midi);
  }
  if (value.n != null && typeof value.n === 'number') {
    return midiToFreq(value.n + 36);
  }
  return 440;
}

// Waveform resolution

const WAVEFORMS = new Set(['triangle', 'square', 'sawtooth', 'sine']);
const WAVEFORM_ALIASES = { tri: 'triangle', sqr: 'square', saw: 'sawtooth', sin: 'sine' };

function resolveWaveform(s) {
  if (!s) return null;
  s = s.toLowerCase();
  return WAVEFORM_ALIASES[s] || (WAVEFORMS.has(s) ? s : null);
}

// Built-in synths

function createWaveformSynth(waveform) {
  return (ac, t, value, duration) => {
    const freq = getFrequency(value);
    const gain = (value.gain ?? 0.8) * (value.velocity ?? 1);
    const attack = value.attack ?? 0.001;
    const decay = value.decay ?? 0.05;
    const sustain = value.sustain ?? 0.6;
    const release = value.release ?? 0.01;

    const osc = new OscillatorNode(ac, { type: waveform, frequency: freq });
    const env = new GainNode(ac, { gain: 0 });
    const vol = new GainNode(ac, { gain: gain * 0.3 });

    osc.connect(env).connect(vol);

    const holdEnd = t + duration;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + attack);
    env.gain.linearRampToValueAtTime(sustain, t + attack + decay);
    env.gain.setValueAtTime(sustain, holdEnd);
    env.gain.linearRampToValueAtTime(0, holdEnd + release);

    osc.start(t);
    osc.stop(holdEnd + release + 0.01);

    return vol;
  };
}

function registerBuiltinSynths() {
  for (const waveform of WAVEFORMS) {
    registerSound(waveform, createWaveformSynth(waveform));
  }
  for (const [alias, waveform] of Object.entries(WAVEFORM_ALIASES)) {
    soundRegistry.set(alias, soundRegistry.get(waveform));
  }

  // Noise approximation using layered detuned oscillators.
  // A proper AudioBuffer-based white noise generator would be better,
  // but this works as a starting point.
  registerSound('noise', (ac, t, value, duration) => {
    const gain = (value.gain ?? 0.8) * (value.velocity ?? 1);
    const release = value.release ?? 0.01;
    const holdEnd = t + duration;

    const mix = new GainNode(ac, { gain: gain * 0.15 });
    for (let i = 0; i < 8; i++) {
      const freq = 100 + Math.random() * 8000;
      const osc = new OscillatorNode(ac, { type: 'sawtooth', frequency: freq });
      const g = new GainNode(ac, { gain: 0 });
      g.gain.setValueAtTime(1, t);
      g.gain.setValueAtTime(1, holdEnd);
      g.gain.linearRampToValueAtTime(0, holdEnd + release);
      osc.connect(g).connect(mix);
      osc.start(t);
      osc.stop(holdEnd + release + 0.01);
    }
    return mix;
  });
}

// Effects

function applyFilter(ac, source, value) {
  let node = source;
  if (value.cutoff != null) {
    const filter = new BiquadFilterNode(ac, {
      type: 'lowpass',
      frequency: value.cutoff,
      Q: value.resonance ?? 1,
    });
    node.connect(filter);
    node = filter;
  }
  if (value.hcutoff != null) {
    const filter = new BiquadFilterNode(ac, {
      type: 'highpass',
      frequency: value.hcutoff,
      Q: value.hresonance ?? 1,
    });
    node.connect(filter);
    node = filter;
  }
  return node;
}

function applyPan(ac, source, value) {
  if (value.pan != null) {
    const panner = new StereoPannerNode(ac, { pan: 2 * value.pan - 1 });
    source.connect(panner);
    return panner;
  }
  return source;
}

// Sample playback — triggered when s("name") matches a loaded sample

function playSample(ac, t, value, durationSecs) {
  const n = value.n ?? 0;
  const buffer = getSampleBuffer(value.s, n);
  if (!buffer) return null;

  const gain = (value.gain ?? 0.8) * (value.velocity ?? 1);
  const attack = value.attack ?? 0.001;
  const release = value.release ?? 0.01;
  const speed = value.speed ?? 1;
  const begin = value.begin ?? 0;
  const end = value.end ?? 1;

  const source = new AudioBufferSourceNode(ac, { buffer });
  source.playbackRate.value = speed;

  // Calculate offset and duration from begin/end (0-1 range)
  const bufferDuration = buffer.duration;
  const offsetSecs = begin * bufferDuration;
  const clipDuration = (end - begin) * bufferDuration / Math.abs(speed);
  const playDuration = Math.min(durationSecs, clipDuration);

  const env = new GainNode(ac, { gain: 0 });
  const vol = new GainNode(ac, { gain: gain * 0.3 });

  source.connect(env).connect(vol);

  const holdEnd = t + playDuration;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(1, t + attack);
  env.gain.setValueAtTime(1, holdEnd);
  env.gain.linearRampToValueAtTime(0, holdEnd + release);

  source.start(t, offsetSecs, playDuration + release + 0.01);

  return vol;
}

// Main output function — called by the Strudel scheduler for each hap

export function nodeAudioOutput(hap, _deadline, hapDuration, cps, t) {
  const ac = getAudioContext();

  let value;
  if (typeof hap.value === 'object') {
    value = { ...hap.value };
  } else {
    value = { s: String(hap.value) };
  }
  value.duration = hapDuration;

  if (t < ac.currentTime) {
    return;
  }

  const s = (value.s || 'triangle').toLowerCase();
  const durationSecs = hapDuration / cps;

  // Look up the sound: registered synth → waveform alias → loaded sample
  let triggerFn = soundRegistry.get(s);
  if (!triggerFn) {
    const wf = resolveWaveform(s);
    if (wf) triggerFn = soundRegistry.get(wf);
  }
  if (!triggerFn && hasSample(s)) {
    triggerFn = playSample;
  }
  if (!triggerFn) return;

  const source = triggerFn(ac, t, value, durationSecs);
  if (!source) return;

  const output = applyPan(ac, applyFilter(ac, source, value), value);
  output.connect(ac.destination);
}

registerBuiltinSynths();
