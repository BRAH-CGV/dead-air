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

  /** Fraction of the night shift (0..1) at which this signal starts
   *  fading in. Set by SignalManager when the night is generated. */
  appearAt = 0;

  /** True once the night has reached appearAt — the dot begins fading in. */
  appeared = false;

  /** Real seconds the radar dot takes to fade fully in. */
  fadeSeconds;

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
   */
  constructor({ id, yaw, pitch, tolerance = 12 * (Math.PI / 180), scanTime = 3, payloadUrl = '', appearAt = 0, fadeSeconds = 3 }) {
    this.id = id;
    this.yaw = yaw;
    this.pitch = pitch;
    this.tolerance = tolerance;
    this.scanTime = scanTime;
    this.payloadUrl = payloadUrl;
    this.appearAt = appearAt;
    this.fadeSeconds = fadeSeconds;
  }

  /** True if the signal has been resolved (either saved or deleted). */
  get resolved() {
    return this.saved || this.deleted;
  }

  /** Radar dot visibility, 0..1: 0 before appearing, ramping to 1 over
   *  fadeSeconds once it has. Never falls back — a seen signal stays seen. */
  get opacity() {
    if (!this.appeared) return 0;
    return Math.min(1, this.fadeElapsed / this.fadeSeconds);
  }

  /** True once the fade-in has completed — only then can the signal be
   *  hovered, scanned or reviewed. */
  get revealed() {
    return this.opacity >= 1;
  }
}
