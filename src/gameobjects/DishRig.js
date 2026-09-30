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
// A rig also carries its coverage: a disc in (yaw, pitch) sky space
// centred on its origin. The local dish's radius is Infinity — it covers
// the whole scannable sky — while each neighbour covers only the small
// section of sky around itself, overlapping its neighbours'.
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
 *  one metric behind every aim check and coverage check, so "a dish can
 *  see it" and "a dish is aimed at it" can never disagree. Yaw error takes
 *  the short way around the circle; pitch is an elevation, measured plain.
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
  /** Centre of this dish's sky section. Only meaningful for neighbours. */
  originYaw = 0;
  originPitch = 0;
  /** Radius of the sky section the dish can see, radians. Infinity for the
   *  local dish, which covers the whole scannable hemisphere. */
  coverageRadius = Infinity;

  /**
   * @param {Object} [opts]
   * @param {number} [opts.originYaw=0]       Section centre, defaulting to the start pose
   * @param {number} [opts.originPitch=0]
   * @param {number} [opts.coverageRadius=Infinity]
   * @param {number} [opts.currentYaw=originYaw]  Start pose — a neighbour
   *   starts aimed at its own origin
   * @param {number} [opts.currentPitch=originPitch]
   * @param {number} [opts.targetYaw=currentYaw]  Targets start on the start
   *   pose, so spawning alone doesn't jerk the dish back to zero
   * @param {number} [opts.targetPitch=currentPitch]
   */
  constructor({
    originYaw = 0,
    originPitch = 0,
    coverageRadius = Infinity,
    currentYaw = originYaw,
    currentPitch = originPitch,
    targetYaw = currentYaw,
    targetPitch = currentPitch,
  } = {}) {
    this.originYaw = originYaw;
    this.originPitch = originPitch;
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
   *  of sky it can see. Uses the same combined metric as the aim checks, so
   *  a dish that covers a signal is a dish that can be aimed at it. */
  covers(yaw, pitch) {
    if (!Number.isFinite(this.coverageRadius)) return true;
    return aimError(this.originYaw, this.originPitch, yaw, pitch) <= this.coverageRadius;
  }
}

// ── The neighbour array ──────────────────────────────────────

/** How many dishes the neighbouring array nodes lend the player. */
const NEIGHBOUR_COUNT = 6;

/** Sky radius each neighbour dish can see, radians (~37°). The origins sit
 *  60° apart in yaw, so with a 37° radius adjacent sections overlap by
 *  ~14° — a signal near a boundary can be picked up by two dishes at once. */
const NEIGHBOUR_COVERAGE_RADIUS = 0.65;

/** Base elevation of the neighbour origins, radians (~-40°: comfortably up
 *  in the scan band, which runs from -10° to -70°). */
const NEIGHBOUR_PITCH = -40 * (Math.PI / 180);

/** How far odd dishes stagger off the base elevation, radians (~±5°), so
 *  the ring of sections isn't a perfect circle on the radar. */
const NEIGHBOUR_STAGGER = 5 * (Math.PI / 180);

/** The dishes of the neighbouring array nodes, evenly spaced around the
 *  horizon. Each starts aimed at its own origin. Create once per night
 *  network and hand the array to `satellite.neighbours`.
 *  @returns {DishRig[]} */
export function createDefaultNeighbourDishes() {
  const dishes = [];
  const spacing = (2 * Math.PI) / NEIGHBOUR_COUNT;
  for (let i = 0; i < NEIGHBOUR_COUNT; i++) {
    const yaw = -Math.PI + i * spacing;
    const pitch = NEIGHBOUR_PITCH + (i % 2 === 0 ? NEIGHBOUR_STAGGER : -NEIGHBOUR_STAGGER);
    dishes.push(new DishRig({
      originYaw: yaw,
      originPitch: pitch,
      coverageRadius: NEIGHBOUR_COVERAGE_RADIUS,
    }));
  }
  return dishes;
}
