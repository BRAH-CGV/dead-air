// ─────────────────────────────────────────────
// Growl  –  a low growl, made rather than recorded
// ─────────────────────────────────────────────
// The dust eyes' growl, synthesised once at load into an AudioBuffer — no
// file to find or credit. Three ingredients, then shaped:
//
//   voice    a pulse at `pitch` Hz, its pitch wavering, as a throat would
//   fry      the voice chopped ~27 times a second — the rattle in a growl
//   rumble   brown noise underneath, for breath
//
// Two one-pole low-passes take the edge off, an envelope swells it in and
// lets it go, and it is normalised to 0.9. Seeded, so it is the same growl
// every time.
// ─────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {number} opts.sampleRate
 * @param {number} [opts.seconds=1.4]
 * @param {number} [opts.pitch=52]    Hz
 * @param {number} [opts.seed=7]
 * @returns {Float32Array} mono samples, −0.9 … 0.9
 */
export function synthGrowl({ sampleRate, seconds = 1.4, pitch = 52, seed = 7 }) {
  const n = Math.round(sampleRate * seconds);
  const out = new Float32Array(n);
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 * 2 - 1;
  };

  const attack = 0.12, release = 0.35;
  const cut = 1 - Math.exp(-2 * Math.PI * 380 / sampleRate);   // one-pole at ~380 Hz
  let phase = 0, brown = 0, lp1 = 0, lp2 = 0, jitter = 0;

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    jitter += (rand() * 0.5 - jitter) * 0.002;
    const f = pitch * (1 + 0.07 * Math.sin(2 * Math.PI * 2.3 * t) + 0.05 * jitter);
    phase = (phase + f / sampleRate) % 1;
    const voice = phase < 0.35 ? 1 : -0.54;                     // a buzzy pulse
    const fry = 0.55 + 0.45 * Math.max(0, Math.sin(2 * Math.PI * 27 * t + 0.6 * Math.sin(2 * Math.PI * 4 * t)));
    brown = (brown + rand() * 0.06) * 0.985;
    const raw = voice * fry + brown * 2.5;

    lp1 += (raw - lp1) * cut;
    lp2 += (lp1 - lp2) * cut;

    const env = Math.min(1, t / attack) * Math.min(1, (seconds - t) / release);
    out[i] = lp2 * env * env;
  }

  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < n; i++) out[i] *= 0.9 / peak;
  return out;
}
