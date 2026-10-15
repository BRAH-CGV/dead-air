// ─────────────────────────────────────────────
// RagnoSounds  –  cutting and making Ragno's sounds (pure)
// ─────────────────────────────────────────────
// The recordings he uses are longer than the moments he needs:
//
//   • the spider call is 58 s of chirps — soft clusters, then a few loud
//     bursts. findBursts() cuts it into its separate sounds at load, so
//     outside he can make one soft chirp at a time (blended in under the
//     wind) and, rarely, a loud one pitched down: the lowered screech.
//   • the death screen's attack has a quiet lead-in and a long tail;
//     loudSpan() finds the loud part, which is all that plays.
//
// There is no recording of him in the vent, so synthDuctCrawl() makes one:
// a seeded run of knocks and scrapes ringing in a sheet-metal duct, like
// Growl.js for the dust eyes. A placeholder for the sound owner to replace.
// ─────────────────────────────────────────────

const dB = v => 20 * Math.log10(Math.max(v, 1e-9));

/** RMS of each `window`-second block, in dB. */
function envelope(samples, sampleRate, window) {
  const n = Math.max(1, Math.round(window * sampleRate));
  const out = new Float32Array(Math.ceil(samples.length / n));
  for (let b = 0; b < out.length; b++) {
    let sum = 0;
    const end = Math.min(samples.length, (b + 1) * n);
    for (let i = b * n; i < end; i++) sum += samples[i] * samples[i];
    out[b] = dB(Math.sqrt(sum / Math.max(end - b * n, 1)));
  }
  return { env: out, n };
}

/**
 * The separate sounds in a clip: { start, end (seconds), peak (dB) } for
 * every run louder than `threshold` dB, short gaps inside one bridged.
 * @param {Float32Array} samples  One channel.
 */
export function findBursts(samples, sampleRate, { threshold = -38, window = 0.02, gap = 0.12, min = 0.08 } = {}) {
  const { env, n } = envelope(samples, sampleRate, window);
  const step = n / sampleRate;
  const out = [];
  let cur = null, quietFor = 0;
  for (let b = 0; b < env.length; b++) {
    const t = b * step;
    if (env[b] >= threshold) {
      if (!cur) cur = { start: t, end: t + step, peak: env[b] };
      cur.end = t + step;
      cur.peak = Math.max(cur.peak, env[b]);
      quietFor = 0;
    } else if (cur) {
      quietFor += step;
      if (quietFor > gap) {
        if (cur.end - cur.start >= min) out.push(cur);
        cur = null;
      }
    }
  }
  if (cur && cur.end - cur.start >= min) out.push(cur);
  return out;
}

/**
 * [start, end] seconds of the loud part of a clip: from the first block
 * louder than `threshold` dB to the last. The whole clip if none is.
 */
export function loudSpan(samples, sampleRate, threshold = -30, window = 0.02) {
  const { env, n } = envelope(samples, sampleRate, window);
  const step = n / sampleRate;
  let first = -1, last = -1;
  for (let b = 0; b < env.length; b++) {
    if (env[b] < threshold) continue;
    if (first < 0) first = b;
    last = b;
  }
  if (first < 0) return [0, samples.length / sampleRate];
  return [first * step, Math.min((last + 1) * step, samples.length / sampleRate)];
}

/** The walking loop's playback rate for a body moving at `speed` m/s: the
 *  recording sounds like a brisk walk (`clipSpeed`); a creep slows it, a
 *  run quickens it, within limits that still sound like legs. */
export function walkRate(speed, { clipSpeed = 2.2, min = 0.6, max = 1.8 } = {}) {
  if (speed < 0.05) return 0;
  return Math.min(Math.max(speed / clipSpeed, min), max);
}

/** A small seeded random, so the duct sounds the same every game. */
function mulberry(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Something heavy crawling through a sheet-metal duct: irregular knocks
 * (a thud and the panel ringing after it) with short scrapes between,
 * looped by the caller.
 * @returns {Float32Array}
 */
export function synthDuctCrawl({ sampleRate, seconds = 4, seed = 11 }) {
  const rand = mulberry(seed);
  const out = new Float32Array(Math.round(sampleRate * seconds));
  // The duct's ring: a few panel modes, a low boom and a tinny rattle.
  const modes = [[92, 0.9, 7], [163, 0.5, 11], [311, 0.35, 16], [587, 0.2, 22]];
  let t = 0.05;
  while (t < seconds - 0.3) {
    const start = Math.round(t * sampleRate);
    const hit = 0.45 + 0.55 * rand();
    // Each knock: a burst of noise, then the panel rings and dies away.
    for (let i = 0; i < sampleRate * 0.5 && start + i < out.length; i++) {
      const s = i / sampleRate;
      let v = (rand() * 2 - 1) * Math.exp(-s * 90) * 0.6;
      for (const [f, a, decay] of modes) v += a * Math.sin(2 * Math.PI * f * s) * Math.exp(-s * decay);
      out[start + i] += v * hit * 0.42;
    }
    // Now and then a scrape: claws dragged along the panel.
    if (rand() < 0.35) {
      const from = start + Math.round(sampleRate * 0.12);
      const len = Math.round(sampleRate * (0.15 + 0.2 * rand()));
      for (let i = 0; i < len && from + i < out.length; i++) {
        const env = Math.sin(Math.PI * i / len);
        out[from + i] += (rand() * 2 - 1) * env * 0.08 * (1 + Math.sin(i / sampleRate * 2 * Math.PI * 40));
      }
    }
    // Uneven steps: a skitter of quick ones, or a pause.
    t += rand() < 0.3 ? 0.5 + rand() * 0.6 : 0.12 + rand() * 0.2;
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.95) for (let i = 0; i < out.length; i++) out[i] *= 0.95 / peak;
  return out;
}
