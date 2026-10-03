// ─────────────────────────────────────────────
// DishRig  –  headless dish rotation and coverage
// ─────────────────────────────────────────────
// One steerable dish's aiming state as pure numbers: no model, no scene
// node, no physics body. Satellite delegates its own tower's motion to a
// rig (the model's Object3D stays authoritative for rendering), and the
// neighbour arrays of the planet-wide network are rigs outright — they are
// far away on the horizon, too far to be seen or heard, so only their
// rotation is simulated.
//
// The physics are the same spring-damper momentum the local dish has: the
// rig accelerates toward its target, decelerates as it approaches, and
// never turns faster than `maxRotationSpeed`.
//
// A rig also carries its coverage: a disc on the radar's own sky map (see
// skyToCursor below), centred on its origin. The array is laid out there:
// our dish at the centre — the zenith — its reach covering the majority of
// the scannable band, and each neighbour out on the rim with its section
// half cut off by the radar's edge, dipping back inside to overlap our
// reach, so every part of the signal band belongs to at least one dish and
// the middle of the disc to several.
// ─────────────────────────────────────────────

/** The dish's default slew limit, radians per second: π/8 = 22.5°/s. A half
 *  turn takes ~8 s, a 12° correction under a second. Slow enough that the
 *  tower reads as heavy machinery; fast enough that the minigame is still
 *  about aiming, not waiting. ComputerTerminal paces its cursor to it. */
export const DISH_SLEW_RATE = Math.PI / 8;

/** Remaining error below which an axis counts as settled, in radians. With
 *  momentum physics, the dish oscillates slightly around the target, so we
 *  use a more generous threshold than a constant-rate slew would need. */
export const SETTLED_EPSILON = 0.05;  // ~3 degrees

/** Shortest signed difference from `angle` to `target`, wrapped into ±π —
 *  the distance and direction around the circle. */
export function angleDelta(angle, target) {
  return Math.atan2(Math.sin(target - angle), Math.cos(target - angle));
}

/** Combined angular distance from a dish pose to a target direction — the
 *  metric behind the aim checks ("is the dish pointed at the signal?").
 *  Yaw error takes the short way around the circle; pitch is an elevation,
 *  measured plain.
 *  @param {number} currentYaw
 *  @param {number} currentPitch
 *  @param {number} targetYaw
 *  @param {number} targetPitch
 *  @returns {number} */
export function aimError(currentYaw, currentPitch, targetYaw, targetPitch) {
  const yawErr = Math.abs(angleDelta(currentYaw, targetYaw));
  const pitchErr = Math.abs(currentPitch - targetPitch);
  return Math.sqrt(yawErr * yawErr + pitchErr * pitchErr);
}

// ── Sky ↔ cursor: the radar's own coordinates ────────────────
// The radar disc is the sky seen from above: bearing is the angle around
// the disc, elevation the distance from the centre (the zenith) to the rim
// (the horizon). Bearing 0 — out the office window — sits at the BOTTOM of
// the disc, so the map reads like the view out of the window: the horizon
// ahead on the bottom rim, the sky rising toward the centre, and what
// climbs in the window climbs on the radar too. Coverage is measured in
// this space, so the section a player sees as a circle on the radar is a
// circle in the metric, and the yaw seam (±π) needs no special casing —
// opposite bearings are simply on opposite sides of the disc.
// ComputerTerminal's cursor lives here too.

/** Sky direction → point on the unit cursor disc.
 *  @param {number} yaw    Bearing, radians — 0 is the window direction,
 *                        drawn at the disc's bottom so the radar reads
 *                        like the view out of the window
 *  @param {number} pitch  Negative up: 0 = horizon, -π/2 = zenith
 *  @returns {{x: number, y: number}} */
export function skyToCursor(yaw, pitch) {
  const p = Math.min(Math.max(pitch, -Math.PI / 2), 0);
  const r = (p + Math.PI / 2) / (Math.PI / 2);   // 0 at the zenith, 1 at the horizon
  return { x: r * Math.sin(yaw), y: -r * Math.cos(yaw) };
}

/** Point on the unit cursor disc → sky direction. r = 0 (the zenith) has no
 *  bearing of its own; yaw defaults to 0 there. Points beyond the rim are
 *  pulled back onto it.
 *  @param {number} x
 *  @param {number} y
 *  @returns {{yaw: number, pitch: number}} */
export function cursorToSky(x, y) {
  const r = Math.min(Math.hypot(x, y), 1);
  return {
    yaw: Math.atan2(x, -y),
    pitch: -(Math.PI / 2) + r * (Math.PI / 2),
  };
}

export class DishRig {
  // ── Pose ──
  /** Where the dish points now, radians. */
  currentYaw = 0;
  currentPitch = 0;
  /** Where the dish is slewing toward. */
  targetYaw = 0;
  targetPitch = 0;

  // ── Momentum physics (spring-damper) ──
  /** Angular velocity around Y (rad/s). */
  velYaw = 0;
  /** Angular velocity around X (rad/s). */
  velPitch = 0;
  // The pair is a spring (stiffness k = angularAccel) and damper
  // (c = angularDamping). c = 2·√k is critical damping: the fastest settle
  // that never swings past the target. Change one, re-derive the other.
  /** How fast the dish accelerates toward target (rad/s^2 per rad of error). */
  angularAccel = 25.0;
  /** Velocity damping factor (higher = less overshoot). */
  angularDamping = 10.0;
  /** Slew limit shared by both axes, radians per second. */
  maxRotationSpeed = DISH_SLEW_RATE;

  // ── Coverage ──
  /** Centre of this dish's sky section, on the cursor disc: (0, 0) is the
   *  zenith — the radar's centre — and our own dish's origin. */
  originX = 0;
  originY = 0;
  /** Radius of the section the dish can see, in cursor-disc units (1 = the
   *  radar rim). Infinity covers the whole hemisphere; the local dish and
   *  the neighbours both get finite reach from the array layout below. */
  coverageRadius = Infinity;

  /**
   * @param {Object} [opts]
   * @param {number} [opts.originX=0]         Section centre on the cursor disc
   * @param {number} [opts.originY=0]
   * @param {number} [opts.coverageRadius=Infinity]
   * @param {number} [opts.currentYaw=0]      Start pose. A neighbour starts
   *   aimed at its own origin — see createDefaultNeighbourDishes
   * @param {number} [opts.currentPitch=0]
   * @param {number} [opts.targetYaw=currentYaw]  Targets start on the start
   *   pose, so spawning alone doesn't jerk the dish back to zero
   * @param {number} [opts.targetPitch=currentPitch]
   */
  constructor({
    originX = 0,
    originY = 0,
    coverageRadius = Infinity,
    currentYaw = 0,
    currentPitch = 0,
    targetYaw = currentYaw,
    targetPitch = currentPitch,
  } = {}) {
    this.originX = originX;
    this.originY = originY;
    this.coverageRadius = coverageRadius;
    this.currentYaw = currentYaw;
    this.currentPitch = currentPitch;
    this.targetYaw = targetYaw;
    this.targetPitch = targetPitch;
  }

  /** Slew both axes toward the target with spring-damper momentum. The dish
   *  accelerates toward its target, decelerates as it approaches, and never
   *  exceeds maxRotationSpeed. */
  update(dt) {
    // Yaw axis
    const yawErr = angleDelta(this.currentYaw, this.targetYaw);
    this.velYaw -= this.velYaw * this.angularDamping * dt;
    this.velYaw += yawErr * this.angularAccel * dt;
    this.velYaw = Math.max(-this.maxRotationSpeed, Math.min(this.maxRotationSpeed, this.velYaw));
    this.currentYaw += this.velYaw * dt;

    // Pitch axis
    const pitchErr = angleDelta(this.currentPitch, this.targetPitch);
    this.velPitch -= this.velPitch * this.angularDamping * dt;
    this.velPitch += pitchErr * this.angularAccel * dt;
    this.velPitch = Math.max(-this.maxRotationSpeed, Math.min(this.maxRotationSpeed, this.velPitch));
    this.currentPitch += this.velPitch * dt;
  }

  /** True while either axis is still slewing toward its target — false once
   *  the dish has finished aiming (or was never asked to move). */
  isRotating() {
    return Math.abs(angleDelta(this.currentYaw, this.targetYaw)) > SETTLED_EPSILON
        || Math.abs(angleDelta(this.currentPitch, this.targetPitch)) > SETTLED_EPSILON;
  }

  /** Aim the dish at a sky direction. The slew happens over subsequent
   *  update ticks at maxRotationSpeed. */
  aimAt(yaw, pitch) {
    this.targetYaw = yaw;
    this.targetPitch = pitch;
  }

  /** Angular distance (radians) from the dish's current aim to a target
   *  direction. Combines yaw and pitch error into a single magnitude. */
  getAimError(targetYaw, targetPitch) {
    return aimError(this.currentYaw, this.currentPitch, targetYaw, targetPitch);
  }

  /** True when the dish is aimed within `tolerance` radians of the target. */
  isAimedAt(targetYaw, targetPitch, tolerance) {
    return this.getAimError(targetYaw, targetPitch) <= tolerance;
  }

  /** True when a sky direction falls inside this dish's section — the patch
   *  of sky it can see. Measured on the cursor disc, so what looks like a
   *  circle on the radar is one in the metric. Coverage is about reach —
   *  which signals the dish will even try for — while aim checks stay in
   *  (yaw, pitch) sky space; a dish that covers a target always slews all
   *  the way onto it, so the two can never strand a signal. */
  covers(yaw, pitch) {
    if (!Number.isFinite(this.coverageRadius)) return true;
    const p = skyToCursor(yaw, pitch);
    const dx = p.x - this.originX;
    const dy = p.y - this.originY;
    return Math.hypot(dx, dy) <= this.coverageRadius;
  }
}

// ── The array layout ─────────────────────────────────────────
// Everything below is cursor-disc geometry: our dish owns the big central
// disc, the neighbours sit on the rim with their sections half cut off.
// The reach of each is tuned against the signal spawn band (cursor radius
// 0.11…0.91): the local dish covers most of it, the outer band belongs to
// the neighbours, and the union has no gap.

/** How many dishes the neighbouring array nodes lend the player. */
const NEIGHBOUR_COUNT = 6;

/** Cursor radius of the ring the neighbour origins sit on: the rim itself
 *  (pitch 0 — the horizon), so at least half of each neighbour's
 *  same-sized section is cut off by the radar's edge. */
export const ARRAY_RING = 1.0;

/** How far our own dish reaches: far enough to cover the majority of the
 *  scannable band (some 69% of its area at radius 0.75), stopping well
 *  short of the rim — the outer band of the sky belongs to the neighbours. */
export const LOCAL_COVERAGE = 0.75;

/** Each neighbour's reach, in cursor-disc units: same size it has always
 *  been, but centred on the rim now — so its inner edge dips back well
 *  inside the local reach (overlap in the middle of the disc) while its
 *  outer half spills past the rim and is cut off. */
export const NEIGHBOUR_COVERAGE = 0.55;

/** Neighbour slew limit, radians per second: π/12 = 15°/s against the local
 *  dish's 22.5°/s. Borrowed machines at distant nodes — the cursor will
 *  outpace them, and the player has to wait for them to settle. */
export const NEIGHBOUR_SLEW_RATE = Math.PI / 12;

/** Softer, slightly overdamped spring for the neighbours (critical damping
 *  for k=15 is c≈7.75): distant machinery settles without snapping. */
const NEIGHBOUR_ACCEL = 15;
const NEIGHBOUR_DAMPING = 8;

/** The local station's own dish: centred on the zenith — the radar's
 *  centre — reaching out over the majority of the scannable band.
 *  @returns {DishRig} */
export function createLocalRig() {
  return new DishRig({ coverageRadius: LOCAL_COVERAGE });
}

/** The dishes of the neighbouring array nodes: evenly spaced around the
 *  rim, each starting aimed at its own origin, each a touch slower than
 *  the local tower. Create once and hand the array to
 *  `satellite.neighbours`.
 *  @returns {DishRig[]} */
export function createDefaultNeighbourDishes() {
  const dishes = [];
  const spacing = (2 * Math.PI) / NEIGHBOUR_COUNT;
  for (let i = 0; i < NEIGHBOUR_COUNT; i++) {
    const yaw = -Math.PI + i * spacing;
    const originX = ARRAY_RING * Math.sin(yaw);
    const originY = -ARRAY_RING * Math.cos(yaw);   // skyToCursor: bearing 0 is the disc's bottom
    const pose = cursorToSky(originX, originY);
    const rig = new DishRig({
      originX,
      originY,
      coverageRadius: NEIGHBOUR_COVERAGE,
      currentYaw: pose.yaw,
      currentPitch: pose.pitch,
    });
    rig.maxRotationSpeed = NEIGHBOUR_SLEW_RATE;
    rig.angularAccel = NEIGHBOUR_ACCEL;
    rig.angularDamping = NEIGHBOUR_DAMPING;
    dishes.push(rig);
  }
  return dishes;
}
