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

  /**
   * @param {Object} opts
   * @param {number} opts.id
   * @param {number} opts.yaw
   * @param {number} opts.pitch
   * @param {number} [opts.tolerance]
   * @param {number} [opts.scanTime]
   * @param {string} [opts.payloadUrl]
   */
  constructor({ id, yaw, pitch, tolerance = 12 * (Math.PI / 180), scanTime = 3, payloadUrl = '' }) {
    this.id = id;
    this.yaw = yaw;
    this.pitch = pitch;
    this.tolerance = tolerance;
    this.scanTime = scanTime;
    this.payloadUrl = payloadUrl;
  }

  /** True if the signal has been resolved (either saved or deleted). */
  get resolved() {
    return this.saved || this.deleted;
  }
}
