// ─────────────────────────────────────────────
// RoverHum  –  the buggy's electric drive, made rather than recorded
// ─────────────────────────────────────────────
// The buggy is a rover, not a car: no engine note, no gears, just electric
// motors in the hubs. Synthesised once at load into a loop, like Growl.js
// for the dust eyes — no file to find or credit. Three ingredients:
//
//   drone    a low hum at `pitch` Hz and its first few harmonics, breathing
//            slowly, the motors' mains-like buzz
//   whine    two faint tones high above it: what climbs as the playback rate
//            follows the speed (BuggySound), the sound of an electric drive
//   rumble   low-passed noise, the wheels on the dust
//
// The hum loops without a seam: every tone is a whole number of cycles over the
// loop, and the noise's filter runs round the loop twice, so its end runs
// straight into its start. Normalised to 0.9; seeded.
// ─────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {number} opts.sampleRate
 * @param {number} [opts.seconds=2]  The loop's length.
 * @param {number} [opts.pitch=46]   Hz, the drone's fundamental.
 * @param {number} [opts.seed=5]
 * @returns {Float32Array} mono samples, −0.9 … 0.9
 */
export function synthRoverHum({ sampleRate, seconds = 2, pitch = 46, seed = 5 }) {
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  // A whole number of cycles over the loop, so it closes on itself.
  const whole = f => Math.max(1, Math.round(f * seconds)) / seconds;
  const tones = [
    [whole(pitch), 0.5],
    [whole(pitch * 2), 0.32],
    [whole(pitch * 3), 0.14],
    [whole(pitch * 4), 0.07],
    [whole(pitch * 8), 0.035],    // the whine
    [whole(pitch * 12.5), 0.02],
  ];
  const breathe = whole(1.5);

  // The rumble: white noise, low-passed round the loop twice (the first
  // pass only settles the filter), so it is continuous across the seam.
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 * 2 - 1;
  };
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rand();
  const cut = 1 - Math.exp(-2 * Math.PI * 140 / sampleRate);
  let lp1 = 0, lp2 = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      lp1 += (noise[i] - lp1) * cut;
      lp2 += (lp1 - lp2) * cut;
      if (pass === 1) out[i] = lp2 * 6;
    }
  }

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let v = 0;
    for (const [f, a] of tones) v += a * Math.sin(2 * Math.PI * f * t);
    out[i] = out[i] * 0.6 + v * (0.85 + 0.15 * Math.sin(2 * Math.PI * breathe * t));
  }

  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const k = peak > 0 ? 0.9 / peak : 0;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

