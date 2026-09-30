// ─────────────────────────────────────────────
// Thermos  –  two cups of coffee a night
// ─────────────────────────────────────────────
// The player carries it: the drink key (F) takes a cup anywhere. A cup
// gives a little stamina back and slows the drain for a while — less than
// a ration, but it doesn't send you back to the office. Two cups, filled
// again each night (and on a retry).
//
// Pure — no scene, no DOM. CoffeeThermos (on GameplaySystems) reads the
// key and ticks it.
// ─────────────────────────────────────────────

export const THERMOS = Object.freeze({
  /** Cups a night. */
  cups: 2,
  /** Stamina a cup gives back. */
  restore: 0.15,
  /** Seconds a cup slows the drain for (see STAMINA.caffeineDrainScale). */
  caffeine: 45,
  /** Seconds a sip takes; the key does nothing until it's done. */
  sipSeconds: 1.5,
});

export class Thermos {
  /** @param {object} [opts] @param {number} [opts.cups] */
  constructor({ cups = THERMOS.cups } = {}) {
    this.capacity = cups;
    this.cups = cups;
    this._sipping = 0;
  }

  /** Is there a cup to drink right now? */
  get ready() {
    return this.cups > 0 && this._sipping <= 0;
  }

  /**
   * Drink a cup into `stamina`.
   * @param {import('./Stamina.js').Stamina} stamina
   * @returns {boolean} whether a cup was drunk
   */
  drink(stamina) {
    if (!this.ready) return false;
    this.cups--;
    this._sipping = THERMOS.sipSeconds;
    stamina.restore(THERMOS.restore);
    stamina.caffeinate(THERMOS.caffeine);
    return true;
  }

  update(dt) {
    if (this._sipping > 0) this._sipping -= dt;
  }

  /** A new or retried night. */
  refill() {
    this.cups = this.capacity;
    this._sipping = 0;
  }
}
