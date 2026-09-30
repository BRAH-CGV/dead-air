// ─────────────────────────────────────────────
// Nap  –  a risky hour on the bunk, mid-shift
// ─────────────────────────────────────────────
// Hayden's list (GENERAL-VISION.md): a tired player can lie down on the
// bunk during the shift. It fills stamina, but it costs the shift's time
// and it's a gamble:
//
//   - tonight's threats are asked first (ThreatDirector.onNap). The Sleep
//     Demon takes you asleep, likelier the nearer it has come;
//   - you sleep an hour, or oversleep two, likelier the more tired you lay
//     down. Waking past 6 AM ends the shift there, on the quota.
//
// Pure — the Bed asks allowed/take() behind the screen fade.
// ─────────────────────────────────────────────

export const NAP = Object.freeze({
  hours: 1,
  oversleptHours: 2,
  /** The chance to oversleep: this much at full stamina … */
  oversleepChance: 0.15,
  /** … plus this much times the stamina missing. */
  oversleepPerFatigue: 0.5,
});

/**
 * How long a nap lasts.
 * @param {number} stamina  when you lay down, 0 … 1
 * @param {number} r        a roll, 0 ≤ r < 1
 */
export function napHours(stamina, r) {
  const oversleep = NAP.oversleepChance + NAP.oversleepPerFatigue * (1 - stamina);
  return r < oversleep ? NAP.oversleptHours : NAP.hours;
}

export class Nap {
  /** Hours the last nap took, 0 before the first. */
  lastHours = 0;

  /**
   * @param {object} opts
   * @param {{state: string, nap(hours: number): boolean}} opts.controller
   * @param {import('./Stamina.js').Stamina} opts.stamina
   * @param {{onNap(rand: () => number): boolean}|null} [opts.threats]  ThreatDirector
   * @param {() => number} [opts.rand]
   */
  constructor({ controller, stamina, threats = null, rand = Math.random }) {
    this.controller = controller;
    this.stamina = stamina;
    this.threats = threats;
    this.rand = rand;
  }

  /** Tired enough to sleep: stamina below 'ok'. */
  get tired() {
    return this.stamina.level !== 'ok';
  }

  get allowed() {
    return this.controller.state === 'playing' && this.tired;
  }

  /**
   * Lie down.
   * @returns {number} hours slept; 0 if not allowed, or if a threat took you
   */
  take() {
    if (!this.allowed) return 0;
    if (this.threats?.onNap(this.rand)) return 0;
    const hours = napHours(this.stamina.value, this.rand());
    this.stamina.reset();
    this.controller.nap(hours);
    this.lastHours = hours;
    return hours;
  }
}
