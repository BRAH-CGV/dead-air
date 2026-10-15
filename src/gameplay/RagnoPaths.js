// ─────────────────────────────────────────────
// RagnoPaths  –  where Ragno walks (pure)
// ─────────────────────────────────────────────
// The ground he crosses outside, the slope he climbs to a vent, and the rooms
// and corridors he hunts through inside. Plain numbers in, plain points out:
// BaseScene reads the layout off the rooms, the fence and the window
// (_ragnoLayout) and hands it here, so moving a room moves his routes.
//
// "Window side" is the building's back (−z), where the office window looks
// out; "yard side" its front (+z), where the airlock opens on the fenced yard.
// Sides are signs: −1 the living quarters' end, +1 the server room's.
//
//   approachRoute('window' | 'yard', side, layout)  out of sight → the slope's foot
//   climbRoute(side, layout)                         the foot → the vent's intake
//   new NavGraph(nodes, edges).route(from, to)       inside
//
// A route is a list of points { x, y, z, up?, edge?, hide? }: `up` is the
// surface's normal (the ground's if left out), `edge` marks the stretch that
// hugs the window's view, `hide` a spot beside the building out of every
// window's sight (where a glance or the player outside sends him).
// ─────────────────────────────────────────────

export const RAGNO_PATHS = {
  /** Degrees inside the edge of the window's view the window-side approach
   *  starts: one far glimpse in the corner of the glass from the desk, then
   *  he curves away out of it. */
  glimpse: 1.5,
  /** Metres from the desk's eye that glimpse is. */
  windowFrom: 32,
  /** Metres out from the end wall the straight run in to the vent starts:
   *  the last stretch, head-on to the end wall's camera. The trees stand
   *  about 5 m off the end walls, so it starts at their edge. */
  straightOut: 5,
  /** How far the curve to there bows, as a share of its length: negative in
   *  toward the building (the window side, across the clearing in front of
   *  the pole's camera), positive out (the yard side, along the trees). And
   *  how many points it is walked by. */
  bulge: { window: -0.2, yard: 0.08 },
  arcPoints: 8,
  /** The yard-side approach: metres out from the end wall it comes down
   *  (between the fence and the trees), and how far past the fence's far
   *  end it starts. */
  yardOut: 1.8,
  yardFrom: 6,
  /** Metres out from the toe the climb starts on the ground. */
  climbFoot: 0.9,
  /** The trees (layout.trees): on his way in he keeps to the treeline or
   *  beyond — every point of the curve pushed out from the building until a
   *  trunk is within `treeline` m — and a creep keeps inside them, within
   *  `inTrees` m of one, half hidden. No further than `pushMax` m out. */
  treeline: 3.5,
  inTrees: 1.6,
  pushMax: 25,
};

const toRad = d => (d * Math.PI) / 180;

/** Metres out from the wall the slope stands at height `y`. */
export function slopeOut({ batter, shoulder, height }, y) {
  const k = Math.min(Math.max(y / height, 0), 1);
  return batter + (shoulder - batter) * k;
}

/**
 * The vent's intake on the end wall's slope: the point, and the slope's
 * outward normal there.
 * @param {{ sign: number, endX: number, vent: { z: number, y: number } }} side
 */
export function ventIntake(side, slope) {
  const { sign, endX, vent } = side;
  const point = { x: endX + sign * slopeOut(slope, vent.y), y: vent.y, z: vent.z };
  // The slope rises (height) over (batter − shoulder) back toward the wall.
  const nx = sign * slope.height, ny = slope.batter - slope.shoulder;
  const len = Math.hypot(nx, ny);
  return { point, normal: { x: nx / len, y: ny / len, z: 0 } };
}

/**
 * The window's edge on one side, as seen from the desk's eye: the point
 * `dist` metres from the eye along it, turned `margin` degrees into the view
 * (negative: out of it).
 */
export function windowEdgePoint({ eye, window: win }, sign, dist, margin) {
  const ex = sign < 0 ? win.x0 : win.x1;
  let a = Math.atan2(ex - eye.x, win.z - eye.z);          // bearing of the glass's edge
  a += sign * toRad(margin);                              // into the view: round toward straight out (±180°)
  return { x: eye.x + Math.sin(a) * dist, z: eye.z + Math.cos(a) * dist };
}

/** Is ground point `p` in the view out of the window from `eye` (plan view)? */
export function inWindowView(p, eye, win) {
  if (!(p.z < win.z && eye.z > win.z)) return false;
  const t = (eye.z - win.z) / (eye.z - p.z);
  const x = eye.x + (p.x - eye.x) * t;
  return x > win.x0 && x < win.x1;
}

const onGround = (layout, x, z, extra = {}) => ({ x, y: layout.ground(x, z), z, ...extra });

/**
 * The climb: from the ground a little out from the slope's toe, up the slope
 * to the vent's intake.
 */
export function climbRoute(side, layout) {
  const { slope } = layout;
  const { sign, endX, vent } = side;
  const intake = ventIntake(side, slope);
  const up = [intake.normal.x, intake.normal.y, intake.normal.z];
  const toeX = endX + sign * slope.batter;
  const footX = toeX + sign * RAGNO_PATHS.climbFoot;
  const mid = vent.y * 0.5;
  return [
    onGround(layout, footX, vent.z, { up: [0, 1, 0] }),
    { x: toeX, y: 0, z: vent.z, up },
    { x: endX + sign * slopeOut(slope, mid), y: mid, z: vent.z, up },
    { x: intake.point.x, y: intake.point.y, z: vent.z, up },
  ];
}

/**
 * A curve from `a` to `b` that bows to the `sign` side (x), walked by `n`
 * points, `a` left out and `b` the last.
 */
function bowedOut(a, b, sign, n, bulge) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  let px = -dz / len, pz = dx / len;                   // across the line
  if (Math.sign(px) !== sign) { px = -px; pz = -pz; }   // …to the outside
  const cx = (a.x + b.x) / 2 + px * len * bulge;
  const cz = (a.z + b.z) / 2 + pz * len * bulge;
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({ x: u * u * a.x + 2 * u * t * cx + t * t * b.x, z: u * u * a.z + 2 * u * t * cz + t * t * b.z });
  }
  return out;
}

/**
 * The way in from out of sight to the foot of the climb: a rounded walk in
 * out of the trees, in front of the cameras, then a straight run in to the
 * vent (`straightOut` metres of it, square to the end wall).
 * @param {'window'|'yard'} approach
 * @param {{ sign: number, endX: number, back: number, front: number, vent: {z:number, y:number} }} side
 * @param {{ eye, window, slope, fence, ground: (x: number, z: number) => number }} layout
 */
export function approachRoute(approach, side, layout, { inside = false } = {}) {
  const P = RAGNO_PATHS;
  const { sign, endX, vent } = side;
  const foot = climbRoute(side, layout)[0];
  const straight = { x: endX + sign * P.straightOut, z: vent.z };
  let start;
  if (approach === 'window') {
    // One far glimpse in the corner of the window, then away out of it.
    start = { ...windowEdgePoint(layout, sign, P.windowFrom, P.glimpse), edge: true };
  } else {
    // Yard side: from the trees past the fence's far end, down the open
    // strip between its side run and the trees.
    const { fence } = layout;
    const lineX = sign < 0 ? Math.min(fence.minX, endX) : Math.max(fence.maxX, endX);
    start = { x: lineX + sign * P.yardOut, z: fence.maxZ + P.yardFrom };
  }
  const bulge = P.bulge[approach];
  const curve = bowedOut(start, straight, sign * Math.sign(bulge), P.arcPoints, Math.abs(bulge));
  // Out to the trees, all but the straight run's start.
  if (layout.trees?.length) {
    const within = inside ? P.inTrees : P.treeline;
    for (let i = 0; i < curve.length - 1; i++) curve[i] = toTrees(curve[i], layout.trees, within, P.pushMax);
  }
  // Somewhere to scurry to, beside the building and out of the window's
  // sight: the curve's last stretch, the straight run's start, the foot.
  const points = [
    onGround(layout, start.x, start.z, start.edge ? { edge: true } : {}),
    ...curve.map((p, i) => onGround(layout, p.x, p.z, i >= curve.length / 3 ? { hide: true } : {})),
    onGround(layout, foot.x, foot.z, { hide: true }),
  ];
  return onlyForward(points);
}

/**
 * Never a step back: pushed out to the trees, a curve's first points can lie
 * further from the vent than where it starts. He spawns at the furthest of
 * them instead, and a point that would take him further away than the last
 * is left out. The straight run (its start and the foot) is always kept.
 */
function onlyForward(points) {
  const foot = points[points.length - 1];
  const run = points[points.length - 2];
  const far = p => Math.hypot(p.x - foot.x, p.z - foot.z);
  const curve = points.slice(0, -2).filter(p => far(p) >= far(run));
  let first = 0;
  for (let i = 1; i < curve.length; i++) if (far(curve[i]) > far(curve[first])) first = i;
  const out = [];
  for (const p of curve.slice(first)) if (!out.length || far(p) <= far(out[out.length - 1])) out.push(p);
  return [...out, run, foot];
}

/** `p` pushed straight out from the middle of the base until a trunk is
 *  within `within` m: at the trees. As it was if none is that near by
 *  `max` m out. */
function toTrees(p, trees, within, max) {
  const len = Math.hypot(p.x, p.z) || 1;
  const ox = p.x / len, oz = p.z / len;
  for (let d = 0; d <= max; d += 0.5) {
    const x = p.x + ox * d, z = p.z + oz * d;
    for (const t of trees) if (Math.hypot(t.x - x, t.z - z) <= within) return { x, z };
  }
  return p;
}

/** Rooms and corridors as a graph of standing spots. Nodes are
 *  { id, x, z, door? }; edges pairs of ids, walkable both ways. */
export class NavGraph {
  constructor(nodes, edges) {
    this.nodes = nodes;
    this.byId = new Map(nodes.map(n => [n.id, n]));
    this.links = new Map(nodes.map(n => [n.id, []]));
    for (const [a, b] of edges) {
      if (!this.byId.has(a) || !this.byId.has(b)) throw new Error(`[NavGraph] no node for edge ${a}–${b}`);
      this.links.get(a).push(b);
      this.links.get(b).push(a);
    }
  }

  get(id) { return this.byId.get(id); }

  /** The node nearest to (x, z). */
  nearest(p) {
    let best = null, bestD = Infinity;
    for (const n of this.nodes) {
      const d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2;
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  /** The nodes at least `dist` metres from `p`. */
  farFrom(p, dist) {
    return this.nodes.filter(n => Math.hypot(n.x - p.x, n.z - p.z) >= dist);
  }

  /** Metres from `p` to the nearest doorway node. */
  doorDistance(p) {
    let best = Infinity;
    for (const n of this.nodes) if (n.door) best = Math.min(best, Math.hypot(n.x - p.x, n.z - p.z));
    return best;
  }

  /** The shortest list of nodes from one id to another, both included;
   *  empty if there is no way. */
  route(fromId, toId) {
    const dist = new Map([[fromId, 0]]);
    const prev = new Map();
    const open = new Set([fromId]);
    while (open.size) {
      let cur = null, curD = Infinity;
      for (const id of open) if (dist.get(id) < curD) { curD = dist.get(id); cur = id; }
      open.delete(cur);
      if (cur === toId) break;
      const a = this.byId.get(cur);
      for (const next of this.links.get(cur)) {
        const b = this.byId.get(next);
        const d = curD + Math.hypot(a.x - b.x, a.z - b.z);
        if (d < (dist.get(next) ?? Infinity)) {
          dist.set(next, d);
          prev.set(next, cur);
          open.add(next);
        }
      }
    }
    if (!dist.has(toId)) return [];
    const out = [];
    for (let id = toId; id !== undefined; id = prev.get(id)) out.unshift(this.byId.get(id));
    return out;
  }
}
