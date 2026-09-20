// ─────────────────────────────────────────────
// Random  –  seeded, deterministic random numbers
// ─────────────────────────────────────────────
// Math.random() reseeds itself every reload, which is no use for scattering
// scenery: the valley has to be the same valley each time you load the level,
// or nothing can be authored against it and screenshots never match.
//
//   const rand = makeRandom(1234);
//   rand();                 // 0..1, same sequence every run
//   randRange(rand, 2, 5);  // 2..5
//
// Noise.js covers the other half of this: noise is a field you sample by
// position, this is a stream you pull values from in order.
// ─────────────────────────────────────────────

/**
 * A deterministic 0..1 generator (mulberry32) — small, fast and good enough
 * for placing props. Not for anything that needs cryptographic randomness.
 *
 * @param {number} seed
 * @returns {() => number} successive values in [0, 1)
 */
export function makeRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A value in [min, max). */
export function randRange(rand, min, max) {
  return min + rand() * (max - min);
}

/**
 * A value in [min, max) biased toward `min`. `power` above 1 pulls harder:
 * scenery wants many small rocks and a few big ones, not an even spread of
 * sizes, which reads as gravel of one grade.
 */
export function randPower(rand, min, max, power) {
  return min + (max - min) * Math.pow(rand(), power);
}

/** One item from `items`. */
export function randPick(rand, items) {
  return items[Math.min(items.length - 1, Math.floor(rand() * items.length))];
}
