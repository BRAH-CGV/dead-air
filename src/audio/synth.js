// ─────────────────────────────────────────────
// synth  –  a little offline DSP kit for Dead Air's own sounds
// ─────────────────────────────────────────────
// Every sound in public/assets/audio/ is synthesised by
// scripts/make-sounds.mjs from the recipes in sounds.js, built on these
// helpers. Nothing here runs in the game: the game loads the WAV files
// through the manifest like any other asset.
//
// All signals are mono Float32Arrays at SAMPLE_RATE. Randomness is seeded,
// so rebuilding the sounds gives byte-identical files.
//
// Loops are made seamless two ways:
//   • tones: loopFreq() rounds a pitch to a whole number of cycles per loop;
//   • noise: render `fade` extra samples and seamless() folds them into the
//     head, crossfaded, so the last sample runs on into the first.
// ─────────────────────────────────────────────

export const SAMPLE_RATE = 22050;

const TAU = 2 * Math.PI;

/** Seeded PRNG (mulberry32): () => [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seconds → samples. */
export const samples = (seconds, sr = SAMPLE_RATE) => Math.round(seconds * sr);

/** The nearest pitch that fits a whole number of cycles into `seconds`. */
export function loopFreq(freq, seconds) {
  return Math.max(1, Math.round(freq * seconds)) / seconds;
}

// ── Sources ──────────────────────────────────

export function white(n, rand) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = rand() * 2 - 1;
  return x;
}

/** Pink noise (Paul Kellet's economy filter): softer, more natural than white. */
export function pink(n, rand) {
  const x = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.0990460;
    b1 = 0.96300 * b1 + w * 0.2965164;
    b2 = 0.57000 * b2 + w * 1.0526913;
    x[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
  }
  return x;
}

/** Brown noise: a leaky random walk, all rumble. */
export function brown(n, rand) {
  const x = new Float32Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) {
    v = (v + 0.02 * (rand() * 2 - 1)) * 0.998;
    x[i] = v * 3.5;
  }
  return x;
}

/**
 * An oscillator. `freq` is Hz, or a function of the sample index for a
 * sweep. Shapes: sine, saw, square, triangle.
 */
export function osc(n, freq, shape = 'sine', { phase = 0, sr = SAMPLE_RATE } = {}) {
  const x = new Float32Array(n);
  const f = typeof freq === 'function' ? freq : () => freq;
  let p = phase;                          // cycles
  for (let i = 0; i < n; i++) {
    const t = p - Math.floor(p);
    switch (shape) {
      case 'saw':      x[i] = 2 * t - 1; break;
      case 'square':   x[i] = t < 0.5 ? 1 : -1; break;
      case 'triangle': x[i] = 1 - 4 * Math.abs(t - 0.5); break;
      default:         x[i] = Math.sin(TAU * t);
    }
    p += f(i) / sr;
  }
  return x;
}

export const sine = (n, freq, opts) => osc(n, freq, 'sine', opts);

// ── Filters ──────────────────────────────────

/**
 * RBJ biquad: 'lowpass' | 'highpass' | 'bandpass' (0 dB peak). `freq` is Hz,
 * or a function of the sample index for a sweep. Returns a new array.
 */
export function biquad(x, type, freq, q = 0.707, sr = SAMPLE_RATE) {
  const y = new Float32Array(x.length);
  const swept = typeof freq === 'function';
  let b0, b1, b2, a1, a2;
  const coeffs = (f) => {
    const w0 = TAU * Math.min(f, sr * 0.49) / sr;
    const cos = Math.cos(w0), alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2 / a0; b1 = (1 - cos) / a0; b2 = b0;
    } else if (type === 'highpass') {
      b0 = (1 + cos) / 2 / a0; b1 = -(1 + cos) / a0; b2 = b0;
    } else {
      b0 = alpha / a0; b1 = 0; b2 = -alpha / a0;
    }
    a1 = -2 * cos / a0; a2 = (1 - alpha) / a0;
  };
  if (!swept) coeffs(freq);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    if (swept) coeffs(freq(i));
    const out = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = out;
    y[i] = out;
  }
  return y;
}

export const lowpass  = (x, f, q) => biquad(x, 'lowpass', f, q);
export const highpass = (x, f, q) => biquad(x, 'highpass', f, q);
export const bandpass = (x, f, q) => biquad(x, 'bandpass', f, q);

// ── Shaping ──────────────────────────────────

/** Straight lines through (seconds, level) points; flat past the last. */
export function envelope(n, points, sr = SAMPLE_RATE) {
  const e = new Float32Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    while (k < points.length - 2 && t >= points[k + 1][0]) k++;
    const [t0, v0] = points[k];
    const [t1, v1] = points[Math.min(k + 1, points.length - 1)];
    e[i] = t <= t0 ? v0 : t >= t1 ? v1 : v0 + (v1 - v0) * (t - t0) / (t1 - t0);
  }
  return e;
}

/** exp(-t / tau) from `start` seconds on, 0 before. */
export function decay(n, tau, start = 0, sr = SAMPLE_RATE) {
  const e = new Float32Array(n);
  const s = Math.round(start * sr);
  for (let i = s; i < n; i++) e[i] = Math.exp(-(i - s) / sr / tau);
  return e;
}

/** a × b, sample by sample, into a new array. `b` may be a number. */
export function mul(a, b) {
  const y = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) y[i] = a[i] * (typeof b === 'number' ? b : b[i]);
  return y;
}

/** Add `src × gain` into `dst` from sample `at` (seconds), in place. */
export function mix(dst, src, gain = 1, at = 0, sr = SAMPLE_RATE) {
  const o = Math.round(at * sr);
  for (let i = 0; i < src.length && o + i < dst.length; i++) dst[o + i] += src[i] * gain;
  return dst;
}

/** Sum of layers, each [signal, gain]. Length of the first. */
export function layers(...parts) {
  const out = new Float32Array(parts[0][0].length);
  for (const [x, g = 1] of parts) mix(out, x, g);
  return out;
}

export function softClip(x, drive = 1) {
  const k = Math.tanh(drive);
  return x.map(v => Math.tanh(v * drive) / k);
}

export function normalize(x, peak = 0.9) {
  let max = 0;
  for (const v of x) max = Math.max(max, Math.abs(v));
  return max === 0 ? x : mul(x, peak / max);
}

export function rms(x) {
  let s = 0;
  for (const v of x) s += v * v;
  return Math.sqrt(s / x.length);
}

/**
 * Fold the last `fade` samples of `x` into its head with an equal-power
 * crossfade, returning `x.length - fade` samples that loop without a seam:
 * the first sample carries on from the last. For noise; loop tones with
 * loopFreq instead (they would double up in the crossfade).
 */
export function seamless(x, fade) {
  const n = x.length - fade;
  const y = x.slice(0, n);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    y[i] = x[i] * Math.sin(t * Math.PI / 2) + x[n + i] * Math.cos(t * Math.PI / 2);
  }
  return y;
}

/**
 * A filtered periodic signal that loops cleanly: render two loops, filter,
 * keep the second, by which time the filter has settled into the period.
 * `make(n)` must return a signal periodic in n/2 (tones on loopFreq).
 */
export function settled(n, make, filter) {
  return filter(make(2 * n)).slice(n);
}

// ── Output ───────────────────────────────────

/** Mono 16-bit PCM WAV bytes. Samples are clamped to [-1, 1]. */
export function encodeWav(x, sr = SAMPLE_RATE) {
  const bytes = new Uint8Array(44 + x.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + x.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);          // fmt chunk size
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 2, true);      // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  text(36, 'data');
  view.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i]));
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return bytes;
}
