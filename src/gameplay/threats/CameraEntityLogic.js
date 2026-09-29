// ─────────────────────────────────────────────
// CameraEntityLogic  –  night 3's rules, with no scene in them
// ─────────────────────────────────────────────
// The camera in the server room sweeps its yaw between two limits, pausing
// at each end. Each frame the threat asks whether the player's eye is in
// its sightline zone, inside its view cone and not behind cover; while it
// is, exposure rises, and it decays when it isn't. At 1 the night fails.
// Past `lockOn` the camera stops sweeping and follows the player until the
// exposure has decayed away — that is the "entity" part.
//
//   CameraSweep     the yaw over time, pauses included
//   inCone          is a point inside a view cone
//   turnToward      a yaw eased toward another, the short way round
//   CameraExposure  exposure, lock-on and the kill
//
// CameraEntity (the threat) wires these to the rig in the ServerRoom.
// ─────────────────────────────────────────────

export const CAMERA_ENTITY = {
  sweepTime: 8,                  // s, one limit to the other
  pauseTime: 1.5,                // s, held at each limit
  halfAngle: 25 * Math.PI / 180, // view cone
  range: 7,                      // m
  rise: 1.2,                     // exposure per second in view
  decay: 0.5,                    // exposure per second out of view
  lockOn: 0.6,                   // stops sweeping and follows the player
  turnRate: Math.PI / 2,         // rad/s the camera turns to follow or return
};

/** Smoothstep on 0..1: a motor easing into and out of each sweep. */
function ease(t) { return t * t * (3 - 2 * t); }

export class CameraSweep {
  /** Seconds into the cycle. */
  time = 0;

  /**
   * @param {object} opts
   * @param {number} opts.minYaw  radians — where it starts, paused
   * @param {number} opts.maxYaw
   * @param {number} [opts.sweepTime]
   * @param {number} [opts.pauseTime]
   */
  constructor({ minYaw, maxYaw, sweepTime = CAMERA_ENTITY.sweepTime, pauseTime = CAMERA_ENTITY.pauseTime }) {
    this.minYaw = minYaw;
    this.maxYaw = maxYaw;
    this.sweepTime = sweepTime;
    this.pauseTime = pauseTime;
  }

  get period() { return 2 * (this.sweepTime + this.pauseTime); }

  /** pause at min → sweep to max → pause at max → sweep back. */
  get yaw() {
    const { minYaw, maxYaw, sweepTime, pauseTime } = this;
    let t = this.time % this.period;
    let f;
    if (t < pauseTime) f = 0;
    else if ((t -= pauseTime) < sweepTime) f = ease(t / sweepTime);
    else if ((t -= sweepTime) < pauseTime) f = 1;
    else f = 1 - ease((t - pauseTime) / sweepTime);
    return minYaw + (maxYaw - minYaw) * f;
  }

  update(dt) { this.time = (this.time + dt) % this.period; }

  reset() { this.time = 0; }
}

/**
 * Whether `point` is inside the cone at `apex` looking along `forward`
 * (unit length). No allocation: vectors are read, never built.
 * @param {{x:number,y:number,z:number}} apex
 * @param {{x:number,y:number,z:number}} forward
 * @param {{x:number,y:number,z:number}} point
 * @param {number} halfAngle  radians
 * @param {number} range      metres
 */
export function inCone(apex, forward, point, halfAngle, range) {
  const dx = point.x - apex.x, dy = point.y - apex.y, dz = point.z - apex.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > range) return false;
  if (dist === 0) return true;
  const cos = (dx * forward.x + dy * forward.y + dz * forward.z) / dist;
  return cos >= Math.cos(halfAngle);
}

/** `current` turned toward `target` by at most `maxStep`, the short way
 *  round. Angles in radians; the result is not wrapped. */
export function turnToward(current, target, maxStep) {
  let d = (target - current) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  if (Math.abs(d) <= maxStep) return current + d;
  return current + Math.sign(d) * maxStep;
}

export class CameraExposure {
  /** 0 … 1. At 1 the night fails. */
  exposure = 0;
  /** Following the player instead of sweeping. */
  locked = false;

  /**
   * @param {object} [opts]
   * @param {() => void} [opts.onKill]
   * @param {typeof CAMERA_ENTITY} [opts.tuning]
   */
  constructor({ onKill = () => {}, tuning = CAMERA_ENTITY } = {}) {
    this.onKill = onKill;
    this.tuning = tuning;
    this._killed = false;
  }

  /** A new or retried night: nothing seen yet. */
  start() {
    this.exposure = 0;
    this.locked = false;
    this._killed = false;
  }

  /** @param {number} dt @param {boolean} seen  the player is in view this frame */
  update(dt, seen) {
    const { rise, decay, lockOn } = this.tuning;
    this.exposure = seen
      ? Math.min(1, this.exposure + dt * rise)
      : Math.max(0, this.exposure - dt * decay);

    // Locks on past lockOn; lets go only once it has lost the player
    // completely, so hiding for a moment doesn't shake it off.
    if (this.exposure >= lockOn) this.locked = true;
    else if (this.exposure === 0) this.locked = false;

    if (this.exposure >= 1 && !this._killed) {
      this._killed = true;
      this.onKill();
    }
  }
}
