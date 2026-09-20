// ─────────────────────────────────────────────
// BaseYard  –  the cleared ground the base stands in
// ─────────────────────────────────────────────
// Every scenery field has to leave room for the building, and until now each
// did it with a circle at the origin: ROCK_FIELD.clearRadius,
// VEGETATION.clearRadius, plus a chain of keep-clear circles walked down the
// dish sightline by hand. A circle was never the right shape. The base is a
// 32.6 x 10.2 m east-west line of rooms, so a circle wide enough to clear the
// wings sits twenty metres off the back wall — tight at the ends and far away
// through the window at the same time.
//
// So the yard is described as SHAPES instead, and the margin is measured off
// the walls rather than from the origin. One `margin` number then means the
// same thing in every direction, which is what lets the planting come in close
// without burying a doorway.
//
//   const zones = makeYard({ margin: 10 });
//   if (yardDistance(x, z, zones) < 0) continue;   // inside the yard
//
// ── Where the footprint comes from ──
// BASE_FOOTPRINT is transcribed from the room layout on the branch
// `dev/rooms-phase-1` — see BaseScene.js there, which positions the side rooms
// and corridors off the office's own width rather than from a table. Those
// numbers are resolved here so this branch can be built against the layout
// before the two are merged. When the branches meet, BaseScene should pass its
// live `bounds()` through `makeYard({ footprint })` and this constant becomes a
// fallback for scenes that have no rooms of their own.
// ─────────────────────────────────────────────

/**
 * The base's outer footprint on the ground, in metres. Half extents from the
 * origin, measured to the outside face of the walls.
 *
 * Union of MainOffice (12 x 10 at the origin), ServerRoom and LivingQuarters
 * (6 x 8, centred +/-13.2 x, 1 z) and the two corridors between them, each
 * grown by a 0.2 m wall. Floors are flush with y = 0 throughout.
 */
export const BASE_FOOTPRINT = { halfX: 16.3, halfZ: 5.1 };

/** The pieces of the yard that are not the building itself. Positions are
 *  world metres, matching the props they are cut for. */
export const YARD = {
  /** Rounds the shell apron's corners, so the cleared ground reads as worn
   *  rather than surveyed. */
  shellRound: 6,
  /** The working side. The only exterior door is on the front (+Z) wall at
   *  x = 2, and the generator stands out at (7, 9), so this is where anyone
   *  living here would walk, unload and park. Sized to the generator and the
   *  turning space around it and no further — it runs from the front wall out
   *  to z = 14, so the treeline closes on the door the way it does on every
   *  other wall. Widening it is the one thing that reopens this side. */
  parking: { x: 5, z: 9.5, halfX: 8, halfZ: 4.5, round: 3 },
  /** The ground between the back window and the dish, kept open so the tower
   *  is always the thing you see through the glass. */
  dishTrack: { x: 0, z: -16, halfX: 6, halfZ: 12, round: 3 },
  /** The tower's own pad. */
  dishPad: { x: 0, z: -25, radius: 10 },
};

/**
 * Build the yard.
 *
 * @param {Object} [opts]
 * @param {number} [opts.margin]  metres of clear ground off every wall
 * @param {{halfX: number, halfZ: number}} [opts.footprint]
 *        the building's outer half extents — pass BaseScene's live bounds once
 *        the room layout lands, otherwise BASE_FOOTPRINT is used
 * @param {Array<Object>} [opts.extra]  further zones to clear, circles or boxes
 * @returns {Array<Object>} zones, for yardDistance
 */
export function makeYard(opts = {}) {
  const { margin = 10, footprint = BASE_FOOTPRINT, extra = [] } = opts;
  const shape = footprint ?? BASE_FOOTPRINT;

  return [
    // The shell apron. Rounding is clamped so a small margin cannot round the
    // corners further than the apron is deep.
    {
      x: 0, z: 0,
      halfX: shape.halfX + margin,
      halfZ: shape.halfZ + margin,
      round: Math.min(YARD.shellRound, margin),
    },
    YARD.parking,
    YARD.dishTrack,
    YARD.dishPad,
    ...extra,
  ];
}

/**
 * How far a point lies OUTSIDE one zone, in metres. Zero on the boundary and
 * negative within, so the same number grades an edge and answers "is this
 * inside".
 *
 * A zone is a circle (`radius`) or a rounded box (`halfX`, `halfZ`, `round`).
 */
export function zoneDistance(x, z, zone) {
  if (zone.radius !== undefined) {
    return Math.hypot(x - zone.x, z - zone.z) - zone.radius;
  }

  // The standard 2D rounded-box distance: push the half extents in by the
  // corner radius, measure to that smaller box, then push back out. The
  // Math.min term is what makes the result negative inside rather than zero.
  const round = zone.round ?? 0;
  const dx = Math.abs(x - zone.x) - zone.halfX + round;
  const dz = Math.abs(z - zone.z) - zone.halfZ + round;
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0))
       + Math.min(Math.max(dx, dz), 0)
       - round;
}

/** How far a point lies outside the whole yard — the nearest zone wins, since
 *  the zones overlap and a point inside any of them is inside the yard. */
export function yardDistance(x, z, zones) {
  let nearest = Infinity;
  for (const zone of zones) nearest = Math.min(nearest, zoneDistance(x, z, zone));
  return nearest;
}

/**
 * How far the yard reaches along a bearing from the origin, in metres.
 *
 * @param {number} bearing  radians, measured as atan2(z, x) like the fields do
 * @param {Array<Object>} zones
 * @param {number} max  give up past this radius
 * @returns {number} radius at which the yard ends along that bearing
 */
export function yardRadiusAlong(bearing, zones, max) {
  const cos = Math.cos(bearing);
  const sin = Math.sin(bearing);
  const inside = r => yardDistance(cos * r, sin * r, zones) < 0;

  // A bearing can leave the yard and come back into it — the parking apron
  // sticks out past the shell apron's corner — so the yard's edge is the LAST
  // crossing, not the first. Plain bisection would converge on whichever
  // crossing it happened to bracket and cut the apron in half, so march out
  // coarsely for the outermost point still inside, then bisect only that gap.
  const step = 2;
  let lastInside = 0;
  for (let r = step; r <= max; r += step) if (inside(r)) lastInside = r;

  let lo = lastInside;
  let hi = Math.min(max, lastInside + step);
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) * 0.5;
    if (inside(mid)) lo = mid; else hi = mid;
  }
  return hi;
}

/**
 * Precompute yardRadiusAlong over a ring of bearings.
 *
 * The fields call it once per scattered item — 150,000 times for the grass
 * alone — and each call is a march plus a bisection over every zone. Sampling
 * it into a table once and looking the bearing up turns that into an array
 * index. At 1024 buckets the bearing is off by at most 0.35 degrees — a few
 * centimetres at the yard's edge, rising to about 40 cm on the bearings where
 * the edge jumps, which is the parking apron's corners. Both directions of
 * that error are harmless: short and the sample lands in the yard and is
 * rejected, long and a sliver of ground goes unplanted.
 *
 * @returns {(bearing: number) => number}
 */
export function makeYardRadiusLookup(zones, max, buckets = 1024) {
  const table = new Float64Array(buckets);
  for (let i = 0; i < buckets; i++) {
    table[i] = yardRadiusAlong((i / buckets) * Math.PI * 2, zones, max);
  }

  const scale = buckets / (Math.PI * 2);
  return (bearing) => {
    let i = Math.round(bearing * scale) % buckets;
    if (i < 0) i += buckets;
    return table[i];
  };
}
