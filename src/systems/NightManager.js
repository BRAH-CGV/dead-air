// ─────────────────────────────────────────────
// NightManager  –  which night it is
// ─────────────────────────────────────────────
// The base is one continuous scene and every interior door is open from
// night 1 — nights don't unlock rooms. Each night instead brings a new
// threat (GameController / the enemy systems read `currentNight`). The one
// door that stays shut is the airlock's outer hatch, and that is gated on
// the EVA suit, not the calendar (see Airlock).
//
// Plain state, no engine dependency — gameplay (sleeping through the day,
// debug keys) calls advance(); listeners react through onChange.
// ─────────────────────────────────────────────

export class NightManager {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxNight=3]   Nights in a run
   * @param {number} [opts.startNight=1]
   */
  constructor({ maxNight = 3, startNight = 1 } = {}) {
    this.maxNight = maxNight;
    this._listeners = new Set();

    this._check(startNight);
    this.currentNight = startNight;
  }

  /** True on the final night of the run. */
  isLastNight() {
    return this.currentNight >= this.maxNight;
  }

  /** Move to the next night. Stays put (no change event) on the last one.
   *  @returns {number} the current night afterwards */
  advance() {
    if (this.isLastNight()) return this.currentNight;
    return this.setNight(this.currentNight + 1);
  }

  /** Jump to a night — restarts, debug. @returns {number} */
  setNight(night) {
    this._check(night);
    const previous = this.currentNight;
    if (night === previous) return night;
    this.currentNight = night;
    for (const listener of [...this._listeners]) listener(night, previous);
    return night;
  }

  /** Subscribe to night changes: `listener(night, previous)`.
   *  @returns {() => void} unsubscribe */
  onChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _check(night) {
    if (!Number.isInteger(night) || night < 1 || night > this.maxNight) {
      throw new Error(`NightManager: no night ${night} (1–${this.maxNight})`);
    }
  }
}
