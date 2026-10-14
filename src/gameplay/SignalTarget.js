// ─────────────────────────────────────────────
// SignalTarget  –  Data for one sky signal
// ─────────────────────────────────────────────
// Created by SignalManager at night start. Carries the sky direction
// (yaw/pitch), scan parameters, a payload image URL, and resolution
// state (scanned → saved | deleted).
// ─────────────────────────────────────────────

export class SignalTarget {
  /** Unique within a night. @type {number} */
  id;

  /** Direction in radians — yaw around Y, pitch around X. */
  yaw;
  pitch;

  /** Angular acceptance (radians). The aim check combines yaw AND pitch
   *  error into one magnitude, so 12° combined ≈ 8.5° per axis — tight
   *  enough to demand aiming, loose enough to hold with taps. */
  tolerance;

  /** Seconds the dish must stay aimed to complete the scan. */
  scanTime;

  /** URL path to the signal's payload image (shown during REVIEW). */
  payloadUrl;

  /** True after scan completes, before the player chooses save/delete. */
  scanned = false;

  /** True if the player chose to save — counts toward the night quota. */
  saved = false;

  /** True if the player chose to delete — discarded, does not count. */
  deleted = false;

  /** True for the anomalous (red) signal — drawn red, scans itself, and
   *  corrupts whatever drive it is saved to. Set by EvilSignal. */
  evil = false;

  /** Fraction of the night shift (0..1) at which this signal starts
   *  fading in. Set by SignalManager when the night is generated. */
  appearAt = 0;

  /** True once the night has reached appearAt — the dot begins fading in. */
  appeared = false;

  /** Real seconds the radar dot takes to fade fully in (and back out). */
  fadeSeconds;

  /** Real seconds the dot holds at full opacity before fading out. */
  visibleSeconds;

  /** Real seconds the fade has run since appearing. */
  fadeElapsed = 0;

  /**
   * @param {Object} opts
   * @param {number} opts.id
   * @param {number} opts.yaw
   * @param {number} opts.pitch
   * @param {number} [opts.tolerance]
   * @param {number} [opts.scanTime]
   * @param {string} [opts.payloadUrl]
   * @param {number} [opts.appearAt]
   * @param {number} [opts.fadeSeconds=3]
   * @param {number} [opts.visibleSeconds=15]
   * @param {boolean} [opts.evil=false]
   */
  constructor({ id, yaw, pitch, tolerance = 12 * (Math.PI / 180), scanTime = 3, payloadUrl = '', appearAt = 0, fadeSeconds = 3, visibleSeconds = 15, evil = false }) {
    this.id = id;
    this.yaw = yaw;
    this.pitch = pitch;
    this.tolerance = tolerance;
    this.scanTime = scanTime;
    this.payloadUrl = payloadUrl;
    this.appearAt = appearAt;
    this.fadeSeconds = fadeSeconds;
    this.visibleSeconds = visibleSeconds;
    this.evil = evil;
  }

  /** True if the signal has been resolved (either saved or deleted). */
  get resolved() {
    return this.saved || this.deleted;
  }

  /** Total seconds a signal lives once appeared: fade in, hold, fade out. */
  get lifeSeconds() {
    return this.fadeSeconds + this.visibleSeconds + this.fadeSeconds;
  }

  /** Radar dot visibility, 0..1: 0 before appearing and after expiring,
   *  ramping in over fadeSeconds, holding through the visible window, then
   *  ramping back down over fadeSeconds. */
  get opacity() {
    if (!this.appeared) return 0;
    const t = this.fadeElapsed;
    if (t < this.fadeSeconds) return t / this.fadeSeconds;
    const outStart = this.fadeSeconds + this.visibleSeconds;
    if (t <= outStart) return 1;
    return Math.max(0, 1 - (t - outStart) / this.fadeSeconds);
  }

  /** True while the dot shows at full brightness (the hold window). */
  get revealed() {
    return this.opacity >= 1;
  }

  /** True once the signal has fully faded out — its window has passed and
   *  it can never be scanned. Only an appeared signal can expire. */
  get expired() {
    return this.appeared && this.fadeElapsed >= this.lifeSeconds;
  }
}
