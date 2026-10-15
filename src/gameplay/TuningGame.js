// ─────────────────────────────────────────────
// TuningGame  –  signal-processing minigame
// ─────────────────────────────────────────────
// A target zone slides randomly along a horizontal line. The player controls
// a crosshair via an acceleration-based slider (slider value → crosshair
// acceleration, with drag and a velocity cap). Progress accumulates only
// while the crosshair overlaps the target zone.
//
// Pure state — no DOM. The ProcessingScreen renders the visualisation and
// reads the slider; this module just runs the physics and the overlap test.
// ─────────────────────────────────────────────

/** Seconds of active overlap required to complete processing. */
export const REQUIRED_TIME = 12;

/** Max drift speed of the target zone (fraction of line per second). */
export const TARGET_SPEED = 0.25;

/** Width of the target zone as a fraction of the line. */
export const TARGET_ZONE_WIDTH = 0.18;

/** How often the target changes its velocity direction (seconds). */
const TARGET_JITTER_INTERVAL = 1.5;

/** Acceleration per unit slider deflection (-1..1 → ±this). */
export const CROSSHAIR_ACCEL = 4.0;

/** Drag coefficient on the crosshair (exponential decay). */
export const CROSSHAIR_DRAG = 3.0;

/** Maximum crosshair speed (fraction of line per second). */
export const CROSSHAIR_MAX_VEL = 1.2;

export class TuningGame {
  /**
   * @param {object} [opts]
   * @param {() => number} [opts.random=Math.random]
   */
  constructor({ random = Math.random } = {}) {
    this._random = random;
    /** @type {number} Target zone centre, 0..1. */
    this.targetPos = 0.5;
    /** @type {number} Target zone velocity (fraction/s). */
    this.targetVel = 0;
    /** @type {number} Crosshair position, 0..1. */
    this.crosshairPos = 0.5;
    /** @type {number} Crosshair velocity (fraction/s). */
    this.crosshairVel = 0;
    /** @type {number} Seconds of overlap accumulated so far. */
    this.accumulated = 0;
    /** @type {number} Countdown to next target velocity jitter. */
    this._jitterTimer = TARGET_JITTER_INTERVAL;
    /** @type {boolean} Whether the crosshair overlapped the zone last frame. */
    this.overlapping = false;
  }

  /** Randomise positions, zero velocities. Call at the start of each run. */
  reset() {
    const half = TARGET_ZONE_WIDTH / 2;
    this.targetPos = half + this._random() * (1 - TARGET_ZONE_WIDTH);
    this.targetVel = 0;
    this.crosshairPos = 0.5;
    this.crosshairVel = 0;
    this.accumulated = 0;
    this._jitterTimer = TARGET_JITTER_INTERVAL;
    this.overlapping = false;
  }

  /**
   * Advance the simulation by `dt` seconds.
   * @param {number} dt  Frame delta in seconds.
   * @param {number} sliderValue  Acceleration input, -1..1 (0 = centre).
   */
  update(dt, sliderValue) {
    // ── Target random walk ───────────────────────────────
    this._jitterTimer -= dt;
    if (this._jitterTimer <= 0) {
      // Pick a new random velocity within [-TARGET_SPEED, +TARGET_SPEED].
      this.targetVel = (this._random() * 2 - 1) * TARGET_SPEED;
      this._jitterTimer = TARGET_JITTER_INTERVAL * (0.5 + this._random());
    }
    const half = TARGET_ZONE_WIDTH / 2;
    this.targetPos += this.targetVel * dt;
    // Bounce off the walls.
    if (this.targetPos < half) {
      this.targetPos = half;
      this.targetVel = Math.abs(this.targetVel);
    } else if (this.targetPos > 1 - half) {
      this.targetPos = 1 - half;
      this.targetVel = -Math.abs(this.targetVel);
    }

    // ── Crosshair physics ────────────────────────────────
    // Acceleration from the slider, drag opposing velocity.
    const accel = sliderValue * CROSSHAIR_ACCEL;
    const drag = -this.crosshairVel * CROSSHAIR_DRAG;
    this.crosshairVel += (accel + drag) * dt;
    // Cap velocity.
    if (this.crosshairVel > CROSSHAIR_MAX_VEL) this.crosshairVel = CROSSHAIR_MAX_VEL;
    if (this.crosshairVel < -CROSSHAIR_MAX_VEL) this.crosshairVel = -CROSSHAIR_MAX_VEL;
    // Integrate position.
    this.crosshairPos += this.crosshairVel * dt;
    // Clamp to the line.
    if (this.crosshairPos < 0) { this.crosshairPos = 0; this.crosshairVel = 0; }
    if (this.crosshairPos > 1) { this.crosshairPos = 1; this.crosshairVel = 0; }

    // ── Overlap test ─────────────────────────────────────
    this.overlapping = Math.abs(this.crosshairPos - this.targetPos) < half;
    if (this.overlapping) {
      this.accumulated += dt;
    }
  }

  /** Fraction of processing completed (0..1). */
  get progress() {
    return Math.min(1, this.accumulated / REQUIRED_TIME);
  }

  /** True once enough overlap has been accumulated. */
  get isComplete() {
    return this.accumulated >= REQUIRED_TIME;
  }
}
