// ─────────────────────────────────────────────
// Oxygen  –  the EVA suit's air tank
// ─────────────────────────────────────────────
// Pure state, no scene: a value from 1 (full) to 0 (empty). It drains over
// `tankSeconds` of time spent outside and refills in `refillSeconds` inside
// the pressurised airlock. OxygenSupply (src/components/OxygenSupply.js)
// decides when each happens; this class only counts.
// ─────────────────────────────────────────────

export const OXYGEN = Object.freeze({
  /** A full tank lasts this long outside. */
  tankSeconds: 90,
  /** Empty to full, standing in the pressurised airlock. */
  refillSeconds: 3,
  /** Below this the gauge turns and the helmet starts beeping. */
  lowBelow: 0.25,
  /** Seconds between the helmet's low-air beeps. */
  beepEvery: 2,
});

export class Oxygen {
  constructor({ tankSeconds = OXYGEN.tankSeconds, refillSeconds = OXYGEN.refillSeconds } = {}) {
    this.tankSeconds = tankSeconds;
    this.refillSeconds = refillSeconds;
    this.value = 1;
  }

  /** Breathe for `dt` seconds. */
  drain(dt) {
    this.value = Math.max(0, this.value - dt / this.tankSeconds);
  }

  /** Top up for `dt` seconds. */
  refill(dt) {
    this.value = Math.min(1, this.value + dt / this.refillSeconds);
  }

  get empty() { return this.value <= 0; }
  get low() { return this.value < OXYGEN.lowBelow; }

  /** A full tank: the start of every night. */
  reset() { this.value = 1; }
}
