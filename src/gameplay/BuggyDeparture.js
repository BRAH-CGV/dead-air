// ─────────────────────────────────────────────
// BuggyDeparture  –  the buggy leaving with the night's drives (pure)
// ─────────────────────────────────────────────
// Every morning, once the drive box is in its boot, the buggy is sent off
// (#98): the boot's lid shuts, the view climbs out of the player's eyes to
// an eagle's view over the buggy, and it drives itself out of the yard by
// the sliding gate in the back run and away down a lane through the belt,
// until the screen fades. It is back by the next evening.
//
// Three pure pieces, so the shape of it can be tested without a scene:
//
//   the way out   exitGate() picks where a lane through the belt meets the
//                 fence's back run, and the gate is cut there; buggyRoute()
//                 runs from the parking spot, straight at the gate, through
//                 it square, and out along the lane's centre line.
//   the timeline  BuggyDeparture: the lid shutting, the camera rising, the
//                 drive (pulling away, then cruising), the gate opening
//                 ahead of it and shutting behind, and when to fade.
//   the camera    eagleView(): behind and above the buggy, looking ahead.
//
// BuggySendOff (the component) plays it on the buggy, the gate, the boot's
// lid and a camera of its own.
// ─────────────────────────────────────────────

import * as THREE from 'three';

export const BUGGY_DEPARTURE = {
  /** Seconds for the boot's lid to shut before the buggy moves. */
  lidClose: 0.6,
  /** Seconds for the view to climb from the player's eyes to the eagle view,
   *  counted from the start. */
  rise: 2.5,
  /** Top speed, m/s, and how fast it gets there, m/s². */
  speed: 6,
  accel: 2.5,
  /** Metres short of the route's end that the fade begins: about the fade's
   *  0.7 s at top speed, so the buggy is still moving as the screen goes. */
  fadeLead: 6,
  /** Seconds after the start before [E] can skip, so the press that sent it
   *  off can't also skip it. */
  skipGrace: 0.5,
  /** The gate: half its opening, metres; it starts opening `gateOpenFrom`
   *  metres before the buggy reaches it and is wide open by `gateOpenBy`.
   *  It starts shutting `gateCloseAfter` metres behind it, shut by
   *  `gateCloseOver` more. The buggy is under 2 m wide, so 6 m is ample. */
  gateHalfWidth: 3,
  gateOpenFrom: 10,
  gateOpenBy: 4,
  gateCloseAfter: 6,
  gateCloseOver: 4,
  /** Clear of the yard's corners: the gate's edge stays this far in. */
  cornerMargin: 1,
  /** The route: `pullAway` metres straight along the buggy's nose first,
   *  then lined up `approach` metres inside the gate, through it, `beyond`
   *  metres straight on, then the lane's centre every `step` metres out to
   *  `out` metres from the base. */
  pullAway: 3,
  approach: 4,
  beyond: 2,
  step: 5,
  out: 45,
  /** The eagle view: metres behind and above the buggy, looking at a point
   *  `ahead` metres in front of it. */
  camera: { behind: 10, up: 14, ahead: 3 },
};

/** How far a lane wanders off its bearing, as MarsVegetation cuts it. */
const LANE_WANDER = 0.09;
/** Per metre out. */
const LANE_WANDER_RATE = 0.035;
/** The least a lane may climb in z per metre out and still be said to cross
 *  a line of constant z: below this it runs nearly along it. */
const MIN_CLIMB = 0.3;

const smooth = t => {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

/**
 * The centre of a lane through the belt, `radius` metres out from the base.
 * The same wander MarsVegetation's openness() cuts the lane with (its
 * bearing, plus up to 0.09 rad swaying along its length), so the route
 * follows the ground the belt left clear.
 * @param {{bearing: number, wander: number}} lane
 * @returns {{x: number, z: number}}
 */
export function laneCentre(lane, radius) {
  const bearing = lane.bearing + Math.sin(radius * LANE_WANDER_RATE + lane.wander) * LANE_WANDER;
  return { x: radius * Math.cos(bearing), z: radius * Math.sin(bearing) };
}

/** Where a lane's centre line crosses the line of constant `z` (z > 0), as
 *  x; null if the lane runs away from it or nearly along it. */
export function laneCrossing(lane, z) {
  if (Math.sin(lane.bearing) < MIN_CLIMB + LANE_WANDER) return null;
  // The centre's z climbs with the radius at these bearings, so halve the
  // bracket until it closes on z.
  let lo = z;
  let hi = z / MIN_CLIMB;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (laneCentre(lane, mid).z < z) lo = mid; else hi = mid;
  }
  return laneCentre(lane, (lo + hi) / 2).x;
}

/**
 * The sliding gate the buggy leaves by: in the yard's back (north) run,
 * centred where a lane crosses it, so the way out lines up with a road
 * through the belt. Lanes that cross beyond the run, or so near a corner the
 * gate would not fit, are passed over.
 * @param {Array<{bearing: number, wander: number}>} lanes
 * @param {{minX: number, maxX: number, maxZ: number}} rect  The fence's
 * @param {{near?: number, halfWidth?: number}} [opts]  Of two, the crossing
 *        nearest x = `near` (the buggy's spot) wins.
 * @returns {{side: 'N', at: number, halfWidth: number, lane: object}|null}
 *          `lane` is the one it was cut for, for buggyRoute().
 */
export function exitGate(lanes, rect, { near = 0, halfWidth = BUGGY_DEPARTURE.gateHalfWidth } = {}) {
  const inset = halfWidth + BUGGY_DEPARTURE.cornerMargin;
  let best = null;
  for (const lane of lanes) {
    const at = laneCrossing(lane, rect.maxZ);
    if (at === null || at < rect.minX + inset || at > rect.maxX - inset) continue;
    if (!best || Math.abs(at - near) < Math.abs(best.at - near)) best = { side: 'N', at, halfWidth, lane };
  }
  return best;
}

/**
 * The way out, as ground-plan points for a smooth curve: from where the
 * buggy stands, straight along its nose, round to line up square on the
 * gate, through it, and out along the lane's centre line.
 * @param {{start: {x: number, z: number}, forward: {x: number, z: number},
 *          gate: {at: number, lane?: object}, lane?: {bearing: number, wander: number},
 *          rect: {maxZ: number}}} opts  `forward` is the way its nose points;
 *          `lane` defaults to the gate's own.
 * @returns {Array<{x: number, z: number}>}
 */
export function buggyRoute({ start, forward, gate, lane = gate.lane, rect }) {
  const T = BUGGY_DEPARTURE;
  const ahead = T.pullAway / Math.hypot(forward.x, forward.z);
  const points = [
    { x: start.x, z: start.z },
    { x: start.x + forward.x * ahead, z: start.z + forward.z * ahead },
    { x: gate.at, z: rect.maxZ - T.approach },
    { x: gate.at, z: rect.maxZ },
    { x: gate.at, z: rect.maxZ + T.beyond },
  ];
  const past = points.at(-1);
  for (let r = Math.hypot(past.x, past.z) + T.step; r < T.out; r += T.step) points.push(laneCentre(lane, r));
  points.push(laneCentre(lane, T.out));
  return points;
}

/** The route as a curve, each point at `heightAt(x, z)`. Centripetal, so it
 *  never loops back on itself between close points. */
export function routeCurve(points, heightAt = () => 0) {
  return new THREE.CatmullRomCurve3(
    points.map(({ x, z }) => new THREE.Vector3(x, heightAt(x, z), z)),
    false,
    'centripetal',
  );
}

/** How far along `curve` (metres) its nearest point to `point` is, on the
 *  ground plan. Sampled, so good to a few centimetres. */
export function distanceAlong(curve, point, samples = 400) {
  const lengths = curve.getLengths(samples);
  const at = new THREE.Vector3();
  let best = Infinity;
  let bestAt = 0;
  for (let i = 0; i <= samples; i++) {
    curve.getPoint(i / samples, at);
    const d = Math.hypot(at.x - point.x, at.z - point.z);
    if (d < best) { best = d; bestAt = lengths[i]; }
  }
  return bestAt;
}

/**
 * The eagle view over the buggy: behind it and high, looking at a point just
 * ahead of it. `forward` is a unit vector on the ground.
 * @param {THREE.Vector3} position
 * @param {THREE.Vector3} forward
 * @param {{position: THREE.Vector3, target: THREE.Vector3}} [out]
 */
export function eagleView(position, forward, out = { position: new THREE.Vector3(), target: new THREE.Vector3() }) {
  const { behind, up, ahead } = BUGGY_DEPARTURE.camera;
  out.position.copy(position).addScaledVector(forward, -behind);
  out.position.y += up;
  out.target.copy(position).addScaledVector(forward, ahead);
  return out;
}

/**
 * The send-off's timeline, along a route `length` metres long with the gate
 * `gateAt` metres along it.
 *
 *   idle ─start()─▶ closing ─lid shut─▶ driving ─finish()─▶ gone ─reset()─▶ idle
 *
 * `wantsFade` turns true `fadeLead` short of the end, or on a skip; whoever
 * plays it fades the screen then and calls finish() once it is dark.
 */
export class BuggyDeparture {
  /** @type {'idle'|'closing'|'driving'|'gone'} */
  phase = 'idle';
  /** Seconds since start(). */
  elapsed = 0;
  /** Metres along the route. */
  distance = 0;
  /** m/s. */
  speed = 0;
  /** Skipped with [E]: fade now. */
  skipped = false;

  /** @param {{length: number, gateAt: number}} route */
  constructor({ length, gateAt }) {
    this.length = length;
    this.gateAt = gateAt;
  }

  /** Lid shutting or driving: the cutscene has the view. */
  get active() { return this.phase === 'closing' || this.phase === 'driving'; }

  /** Moving along the route, for a sound to follow. */
  get driving() { return this.phase === 'driving' && this.speed > 0; }

  /** The boot's lid: 1 open (waiting for the box) … 0 shut. */
  get lid() {
    if (this.phase === 'idle') return 1;
    if (this.phase === 'closing') return 1 - smooth(this.elapsed / BUGGY_DEPARTURE.lidClose);
    return 0;
  }

  /** 0 the player's eyes … 1 the eagle view. */
  get view() {
    return this.active ? smooth(this.elapsed / BUGGY_DEPARTURE.rise) : 0;
  }

  /** The gate: 0 shut … 1 wide open, by where the buggy is. */
  get gateOpen() {
    if (!this.active) return 0;
    const T = BUGGY_DEPARTURE;
    const to = this.gateAt - this.distance;
    if (to > 0) return smooth((T.gateOpenFrom - to) / (T.gateOpenFrom - T.gateOpenBy));
    return 1 - smooth((-to - T.gateCloseAfter) / T.gateCloseOver);
  }

  get wantsFade() {
    return this.active && (this.skipped || this.distance >= this.length - BUGGY_DEPARTURE.fadeLead);
  }

  start() {
    this.phase = 'closing';
    this.elapsed = 0;
    this.distance = 0;
    this.speed = 0;
    this.skipped = false;
  }

  update(dt) {
    if (!this.active) return;
    const T = BUGGY_DEPARTURE;
    this.elapsed += dt;
    if (this.phase === 'closing' && this.elapsed >= T.lidClose) this.phase = 'driving';
    if (this.phase !== 'driving') return;
    if (this.distance >= this.length) { this.speed = 0; return; }
    this.speed = Math.min(T.speed, this.speed + T.accel * dt);
    this.distance = Math.min(this.length, this.distance + this.speed * dt);
    if (this.distance >= this.length) this.speed = 0;
  }

  /** [E]: fade now. Refused in the first `skipGrace` seconds, or when not
   *  playing. */
  skip() {
    if (!this.active || this.elapsed < BUGGY_DEPARTURE.skipGrace) return false;
    this.skipped = true;
    return true;
  }

  /** The screen is dark: it has gone. */
  finish() {
    this.phase = 'gone';
    this.speed = 0;
  }

  /** Back for the next morning. */
  reset() {
    this.phase = 'idle';
    this.elapsed = 0;
    this.distance = 0;
    this.speed = 0;
    this.skipped = false;
  }
}
