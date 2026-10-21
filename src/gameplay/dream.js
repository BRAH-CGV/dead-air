// ─────────────────────────────────────────────
// dream  –  the walk that pulls you back (#101): the rules, pure
// ─────────────────────────────────────────────
// Between nights the operator dreams they are outside, on the valley floor.
// The further they walk from the base, the slower they go and the stranger
// the night gets, until the base drags them back and they wake. Each level
// (night) is a little more unhinged: the slowdown starts sooner, the pull
// comes sooner and harder, the fog and the rust in the sky are thicker.
//
//   0 ─────── slowStart ─────────── pullRadius ──────▶ distance from the base
//   full speed │  slower, foggier, redder   │  dragged back to the base, then wake
// ─────────────────────────────────────────────

/**
 * @typedef {object} DreamLevel
 * @property {number} slowStart   Metres from the base where the slowdown begins.
 * @property {number} pullRadius  Metres where the walk stops and the pull begins.
 * @property {number} minWalk     The walking speed scale at the pull radius.
 * @property {number} drag        How hard the base pulls back (m/s per second of pull).
 * @property {number} fogBase     Fog density at the base.
 * @property {number} fogMax      Fog density at the pull radius.
 * @property {number} skyBase     Sky storm tint at the base (MarsSky.setStorm).
 * @property {number} skyMax      Sky storm tint at the pull radius.
 * @property {number} fovWobble   Degrees the view breathes by at the pull radius.
 * @property {number} ringSeconds Seconds deep in the slow ring (RING_UNEASE)
 *           before the pull starts anyway. The slowdown flattens out at the
 *           edge and the valley climbs past the flat pad, so without this the
 *           last few metres were a half-minute crawl that read as stuck.
 */

/** Which dream follows which night, by registered scene name. Sleeping
 *  after a night with no entry (or one whose scene isn't registered) falls
 *  back to the walk. Swap the order here. */
export const DREAM_AFTER_NIGHT = Object.freeze({
  1: 'DreamScene',        // the walk that pulls you back (Sibonelo)
  2: 'DreamCraterScene',  // the crater and the dust eyes (Hayden)
});

/** How far into the slow ring counts as deep: past this, ringSeconds runs. */
export const RING_UNEASE = 0.75;

/** @type {DreamLevel[]} */
export const DREAM_LEVELS = [
  { slowStart: 35, pullRadius: 80, minWalk: 0.18, drag: 2.5, fogBase: 0.004, fogMax: 0.02,  skyBase: 0.05, skyMax: 0.5,  fovWobble: 0, ringSeconds: 4 },
  { slowStart: 25, pullRadius: 60, minWalk: 0.14, drag: 4,   fogBase: 0.006, fogMax: 0.03,  skyBase: 0.2,  skyMax: 0.7,  fovWobble: 2, ringSeconds: 3.5 },
  { slowStart: 15, pullRadius: 45, minWalk: 0.1,  drag: 6,   fogBase: 0.009, fogMax: 0.045, skyBase: 0.4,  skyMax: 0.95, fovWobble: 6, ringSeconds: 3 },
];

/** The level for a night: 1 for anything below, the last for anything past.
 *  @param {number} level @returns {DreamLevel} */
export function dreamLevel(level) {
  const i = Number.isInteger(level) ? Math.min(Math.max(level, 1), DREAM_LEVELS.length) - 1 : 0;
  return DREAM_LEVELS[i];
}

/** How far into the slowdown ring `distance` is: 0 inside slowStart, 1 at
 *  the pull radius and beyond, smoothstepped between. */
export function unease(distance, L) {
  const t = Math.min(Math.max((distance - L.slowStart) / (L.pullRadius - L.slowStart), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Walking speed scale at `distance`: 1 near the base down to minWalk. */
export function walkScale(distance, L) {
  return 1 - (1 - L.minWalk) * unease(distance, L);
}
