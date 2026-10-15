// ─────────────────────────────────────────────
// generate-signals  –  placeholder signal audio
// ─────────────────────────────────────────────
// Writes the stand-in .wav files the game's signals play on the ServerRoom
// processing console. Each is a short synthesised mono 16-bit PCM clip, so
// the spectrogram has something to draw before real recordings exist.
//
// Adding a signal to the game is just dropping another {name}.wav into
// src/assets/signals/ (see SignalRegistry). A level variant is {name}_L{N}.wav.
// This script only seeds the folder — it is not part of the build.
//
//   node scripts/generate-signals.mjs
// ─────────────────────────────────────────────

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SAMPLE_RATE = 22050;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'signals');

// ── WAV encoder (16-bit PCM, mono) ──────────────────────────

function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);          // fmt chunk size
  buffer.writeUInt16LE(1, 20);           // PCM
  buffer.writeUInt16LE(1, 22);           // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);  // byte rate
  buffer.writeUInt16LE(2, 32);           // block align
  buffer.writeUInt16LE(16, 34);          // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), off);
    off += 2;
  }
  return buffer;
}

// ── Synthesis helpers ───────────────────────────────────────

const TAU = Math.PI * 2;
let seed = 0x2f6e2b1;
function rand() {                       // deterministic noise, so re-runs match
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;  seed >>>= 0;
  return (seed / 0xffffffff) * 2 - 1;
}

/** Build `seconds` of audio from a per-sample generator fn(t, i). */
function synth(seconds, fn) {
  const n = Math.floor(seconds * SAMPLE_RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / SAMPLE_RATE, i) || 0;
  return out;
}

/** Fade the first/last `ms` to avoid a click at the loop seam. */
function envelope(samples, ms = 20) {
  const f = Math.floor((ms / 1000) * SAMPLE_RATE);
  for (let i = 0; i < f; i++) {
    const g = i / f;
    samples[i] *= g;
    samples[samples.length - 1 - i] *= g;
  }
  return samples;
}

// ── Signal definitions ──────────────────────────────────────
// Each entry: [filename, seconds, generator]. The generators vary in
// spectral content so every spectrogram looks distinct.

const SIGNALS = [
  ['deep_hum', 3, (t) =>
    0.5 * Math.sin(TAU * 55 * t) + 0.3 * Math.sin(TAU * 110 * t) + 0.15 * Math.sin(TAU * 165 * t)],

  ['pulse_beacon', 3, (t) => {
    const gate = (t % 0.5) < 0.18 ? 1 : 0;             // beep every 0.5 s
    return gate * 0.6 * Math.sin(TAU * 880 * t);
  }],

  ['static_burst', 3, (t) => {
    const gate = (t % 0.75) < 0.25 ? 1 : 0.1;
    return gate * 0.5 * rand();
  }],

  ['tonal_sweep', 3, (t) => {
    const f = 200 + 1600 * (t / 3);                      // rising sweep
    return 0.5 * Math.sin(TAU * f * t);
  }],

  ['rhythmic_click', 3, (t) => {
    const phase = t % 0.25;
    const hit = phase < 0.02 ? (1 - phase / 0.02) : 0;   // short decay click
    return hit * 0.8 * rand();
  }],

  ['ghost_voice', 3, (t) => {
    const vib = 1 + 0.4 * Math.sin(TAU * 5 * t);         // vibrato
    const formant = 0.5 * Math.sin(TAU * 320 * t) + 0.3 * Math.sin(TAU * 700 * vib * t);
    return 0.5 * formant * (0.6 + 0.4 * Math.sin(TAU * 1.5 * t));
  }],

  ['carrier_wave', 3, (t) =>
    0.5 * (1 + 0.7 * Math.sin(TAU * 3 * t)) * Math.sin(TAU * 1200 * t)],   // AM carrier

  ['harmonic_drone', 3, (t) => {
    let s = 0;
    for (let h = 1; h <= 6; h++) s += Math.sin(TAU * 130 * h * t) / h;      // saw-ish stack
    return 0.4 * s;
  }],

  // Level-2 variants: "enhanced" — cleaner and a little brighter, so the
  // upgrade is audible and the spectrogram visibly differs.
  ['deep_hum_L2', 3, (t) =>
    0.55 * Math.sin(TAU * 55 * t) + 0.35 * Math.sin(TAU * 220 * t) + 0.2 * Math.sin(TAU * 440 * t)],

  ['tonal_sweep_L2', 3, (t) => {
    const f = 300 + 2400 * (t / 3);
    return 0.55 * Math.sin(TAU * f * t) + 0.2 * Math.sin(TAU * f * 2 * t);
  }],
];

// ── Write the files ─────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, seconds, fn] of SIGNALS) {
  const samples = envelope(synth(seconds, fn));
  writeFileSync(join(OUT_DIR, `${name}.wav`), encodeWav(samples));
  console.log(`  wrote ${name}.wav  (${seconds}s, ${samples.length} samples)`);
}
console.log(`\n${SIGNALS.length} signal files written to src/assets/signals/`);
