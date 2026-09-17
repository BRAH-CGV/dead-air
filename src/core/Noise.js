// ─────────────────────────────────────────────
// Noise  –  seeded value noise and fBm, for anything generated
// ─────────────────────────────────────────────
// Terrain, scatter placement and the like need a random-looking field that is
// nevertheless the SAME field on every reload and on every machine — otherwise
// the level you tuned is not the level that ships. So there is no Math.random
// here: every value falls out of an integer hash of the lattice coordinates
// and the seed.
//
//   const n = makeNoise2D(1337);
//   const h = fbm(n, x * 0.01, z * 0.01) * 20;   // 20 m of rolling relief
//
// Frequency is the caller's job — scale the inputs. The noise itself has a
// feature size of one unit, so `x * 0.01` gives features about 100 m across.
// ─────────────────────────────────────────────

/** Default octave stack. Five is where extra octaves stop being visible at
 *  terrain scale and start being wasted fBm evaluations per vertex. */
const DEFAULT_OCTAVES = 5;

/** Each octave doubles the frequency and halves the amplitude — the classic
 *  1/f spectrum that reads as "natural" rather than as layered sine waves. */
const DEFAULT_LACUNARITY = 2;
const DEFAULT_GAIN       = 0.5;

/**
 * Integer hash of a lattice point. Two rounds of multiply-xor-shift on the
 * mixed coordinates: cheap, and well enough distributed that neighbouring
 * cells show no visible correlation.
 *
 * `Math.imul` is not decoration — plain `*` on these constants overflows into
 * floats and the avalanche collapses, leaving diagonal streaks in the field.
 *
 * @returns {number} in [-1, 1]
 */
function hashLattice(ix, iz, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** Quintic fade, 6t⁵−15t⁴+10t³. Its first and second derivatives are both zero
 *  at 0 and 1, so cell boundaries leave no crease — a plain smoothstep does,
 *  and on a lit surface the creases show up as a visible grid. */
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Build a 2D value-noise field.
 *
 * @param {number} seed  Any integer. The same seed always yields the same field.
 * @returns {(x: number, z: number) => number} value in [-1, 1]
 */
export function makeNoise2D(seed = 0) {
  const s = seed | 0;

  return function noise2D(x, z) {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const tx = fade(x - x0);
    const tz = fade(z - z0);

    const c00 = hashLattice(x0,     z0,     s);
    const c10 = hashLattice(x0 + 1, z0,     s);
    const c01 = hashLattice(x0,     z0 + 1, s);
    const c11 = hashLattice(x0 + 1, z0 + 1, s);

    const top    = c00 + (c10 - c00) * tx;
    const bottom = c01 + (c11 - c01) * tx;
    return top + (bottom - top) * tz;
  };
}

/**
 * Fractal Brownian motion: octaves of `noise` stacked at rising frequency and
 * falling amplitude, normalised by the total amplitude so the result stays in
 * the same range as a single octave however many are used.
 *
 * @param {(x: number, z: number) => number} noise  from {@link makeNoise2D}
 * @param {number} x
 * @param {number} z
 * @param {Object} [opts]
 * @param {number} [opts.octaves=5]
 * @param {number} [opts.lacunarity=2]  Frequency multiplier per octave.
 * @param {number} [opts.gain=0.5]      Amplitude multiplier per octave.
 * @returns {number} in [-1, 1]
 */
export function fbm(noise, x, z, opts = {}) {
  const {
    octaves    = DEFAULT_OCTAVES,
    lacunarity = DEFAULT_LACUNARITY,
    gain       = DEFAULT_GAIN,
  } = opts;

  let sum       = 0;
  let amplitude = 1;
  let frequency = 1;
  let total     = 0;

  for (let i = 0; i < octaves; i++) {
    sum   += noise(x * frequency, z * frequency) * amplitude;
    total += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return total === 0 ? 0 : sum / total;
}

/**
 * Ridged fBm: the same stack, but each octave is folded through `1 - |n|`.
 *
 * The fold is the whole point. A zero crossing in the underlying noise — a
 * smooth, unremarkable place — becomes a maximum, so the rounded blobs of
 * plain fBm turn into sharp crests with long flanks running off them. That is
 * what makes generated hills read as eroded ridgelines instead of dunes.
 *
 * @param {(x: number, z: number) => number} noise
 * @param {number} x
 * @param {number} z
 * @param {Object} [opts]  Same shape as {@link fbm}.
 * @returns {number} in [0, 1] — safe to use directly as a height multiplier.
 */
export function ridgedFbm(noise, x, z, opts = {}) {
  const {
    octaves    = DEFAULT_OCTAVES,
    lacunarity = DEFAULT_LACUNARITY,
    gain       = DEFAULT_GAIN,
  } = opts;

  let sum       = 0;
  let amplitude = 1;
  let frequency = 1;
  let total     = 0;

  for (let i = 0; i < octaves; i++) {
    sum   += (1 - Math.abs(noise(x * frequency, z * frequency))) * amplitude;
    total += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return total === 0 ? 0 : sum / total;
}
