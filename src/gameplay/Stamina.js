// ─────────────────────────────────────────────
// Stamina  –  how awake the player is, 1 → 0 over the night
// ─────────────────────────────────────────────
// A value that drains while the shift runs. Food from the office's ration
// dispenser restores it. The Sleep Demon reads it; the HUD shows it as a
// bar, and FatigueEffects turns it into yawns, a narrowing view and dread.
//
// Pure — no scene, no DOM. StaminaDrain (on GameplaySystems) ticks it only
// while a night is being played and fills it when a night starts.
// ─────────────────────────────────────────────

export const STAMINA = Object.freeze({
  /** Empty this share of the way through the shift, with no food: 4:48 AM
   *  of a midnight-to-6 shift, whatever its length in real seconds. The
   *  Sleep Demon is about from half stamina (SLEEP_DEMON.appearBelow),
   *  2:24 AM with no food, faint at first, and creeps nearer the tireder
   *  the player gets. */
  emptyAt: 0.8,
  /** What one ration gives back. */
  ration: 0.35,
  tiredBelow: 0.5,
  criticalBelow: 0.2,
});

/** The drain that empties a full bar STAMINA.emptyAt of the way through a
 *  shift `nightSeconds` long. */
export function drainForShift(nightSeconds) {
  return 1 / (STAMINA.emptyAt * nightSeconds);
}

export class Stamina {
  /** 1 wide awake … 0 asleep on your feet. */
  value = 1;

  /**
   * @param {object} [opts]
   * @param {number} [opts.nightSeconds]  The shift's real length (NightClock.nightDuration).
   * @param {number} [opts.drainPerSecond]  Overrides the drain the shift gives.
   */
  constructor({ nightSeconds = 300, drainPerSecond = drainForShift(nightSeconds) } = {}) {
    this.drainPerSecond = drainPerSecond;
  }

  /** 'ok' | 'tired' | 'critical' */
  get level() {
    if (this.value >= STAMINA.tiredBelow) return 'ok';
    if (this.value >= STAMINA.criticalBelow) return 'tired';
    return 'critical';
  }

  update(dt) {
    this.value = Math.max(0, this.value - dt * this.drainPerSecond);
  }

  restore(amount) {
    this.value = Math.min(1, this.value + amount);
  }

  /** A new or retried night. */
  reset() {
    this.value = 1;
  }
}
