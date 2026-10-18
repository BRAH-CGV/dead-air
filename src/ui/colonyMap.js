// ─────────────────────────────────────────────
// colonyMap  –  where the bedroom PC's Colony screen draws things
// ─────────────────────────────────────────────
// A top-down map in a COLONY_MAP.size square: our base in the middle, the
// six neighbouring arrays on a ring round it, and the way to the central
// hub, the buggy's route out of the yard and on along its bearing past the
// edge.
//
// The neighbours are where the radar has them: each rig's origin on the
// cursor disc (DishRig's skyToCursor), read with y down the screen. That is
// the radar flipped top to bottom, so the window side is at the top and +x
// on the right, as on the security monitor's map. To match the radar
// instead, negate y here.
//
// The route is world metres (x, z), drawn with world x to the right and z
// down, scaled so its end lands COLONY_MAP.routeReach from the middle. The
// hub's distance isn't known, so its line always runs off the map.
//
// Pure — no DOM.
// ─────────────────────────────────────────────

export const COLONY_MAP = Object.freeze({
  /** The map's square, in SVG units. */
  size: 200,
  centre: 100,
  /** The neighbours' ring: the radar's rim. */
  ring: 70,
  /** Where the hub's arrow stops, past the ring, at the map's edge. */
  edge: 94,
  /** How far from the middle the buggy's route is drawn to. */
  routeReach: 22,
});

/** A bearing in radians (0 out of the window, growing toward +x) as whole
 *  degrees, 0–359. */
function degrees(yaw) {
  return ((Math.round((yaw * 180) / Math.PI) % 360) + 360) % 360;
}

/**
 * @param {object} o
 * @param {{originX: number, originY: number}[]} [o.neighbours]  The
 *   neighbouring rigs (satellite.neighbours)
 * @param {{x: number, z: number}[]} [o.route]  The buggy's route out, in
 *   world metres from the base (buggyRoute)
 * @returns {{
 *   base: {x: number, y: number},
 *   neighbours: {x: number, y: number, bearing: number}[],
 *   route: {x: number, y: number}[],
 *   hub: null | {from: {x: number, y: number}, to: {x: number, y: number}, bearing: number},
 * }}
 */
export function colonyMap({ neighbours = [], route = [] } = {}) {
  const { centre: c, ring, edge, routeReach } = COLONY_MAP;

  const ns = neighbours.map(({ originX, originY }) => ({
    x: c + originX * ring,
    y: c + originY * ring,
    bearing: degrees(Math.atan2(originX, -originY)),
  }));

  const end = route[route.length - 1];
  const reach = end ? Math.hypot(end.x, end.z) : 0;
  if (!reach) return { base: { x: c, y: c }, neighbours: ns, route: [], hub: null };

  const k = routeReach / reach;
  const path = route.map((p) => ({ x: c + p.x * k, y: c + p.z * k }));
  const ux = end.x / reach;
  const uz = end.z / reach;
  return {
    base: { x: c, y: c },
    neighbours: ns,
    route: path,
    hub: {
      from: path[path.length - 1],
      to: { x: c + ux * edge, y: c + uz * edge },
      bearing: degrees(Math.atan2(end.x, -end.z)),
    },
  };
}
