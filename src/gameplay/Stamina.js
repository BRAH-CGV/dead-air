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
  /** Empty after 240 s: 4:48 AM of a 300 s shift, with no food. The Sleep
   *  Demon is about from 12:45 AM (SLEEP_DEMON.appearBelow), faint until
   *  half stamina, and creeps nearer the tireder the player gets. */
  drainPerSecond: 1 / 240,
  /** What one ration gives back. */
  ration: 0.35,
  tiredBelow: 0.5,
  criticalBelow: 0.2,
});

export class Stamina {
  /** 1 wide awake … 0 asleep on your feet. */
  value = 1;

  /** @param {object} [opts] @param {number} [opts.drainPerSecond] */
  constructor({ drainPerSecond = STAMINA.drainPerSecond } = {}) {
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
