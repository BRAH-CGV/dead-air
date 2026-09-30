// ─────────────────────────────────────────────
// Stamina  –  how awake the player is, 1 → 0 over the night
// ─────────────────────────────────────────────
// Hayden's stamina system (GENERAL-VISION.md, "Team Roles"): a value that
// drains while the shift runs. Food restores it; coffee (Thermos) gives a
// little back and slows the drain for a while; a nap on the bunk fills it.
// Night 1's Sleep Demon reads it; the HUD shows it as a bar, and
// FatigueEffects turns it into yawns, a narrowing view and dread.
//
// Pure — no scene, no DOM. StaminaDrain (on GameplaySystems) ticks it only
// while a night is being played and fills it when a night starts; the
// ration dispenser in the MainOffice restores it.
// ─────────────────────────────────────────────

export const STAMINA = Object.freeze({
  /** Empty after 240 s: 4:48 AM of a 300 s shift, with no food. The Sleep
   *  Demon is behind the player from about 4 AM. */
  drainPerSecond: 1 / 240,
  /** What one ration gives back. */
  ration: 0.35,
  tiredBelow: 0.5,
  criticalBelow: 0.2,
  /** The drain while caffeinated, as a share of the normal one. */
  caffeineDrainScale: 0.5,
});

export class Stamina {
  /** 1 wide awake … 0 asleep on your feet. */
  value = 1;

  /** Seconds of caffeine left: the drain is scaled by caffeineDrainScale. */
  caffeine = 0;

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
    // A frame that runs out the caffeine drains at both rates, so the drain
    // doesn't depend on the frame rate.
    const buzzed = Math.min(dt, this.caffeine);
    this.caffeine -= buzzed;
    const drain = (buzzed * STAMINA.caffeineDrainScale + (dt - buzzed)) * this.drainPerSecond;
    this.value = Math.max(0, this.value - drain);
  }

  /** Slow the drain for `seconds` more, on top of any caffeine left. */
  caffeinate(seconds) {
    this.caffeine += seconds;
  }

  restore(amount) {
    this.value = Math.min(1, this.value + amount);
  }

  /** A new or retried night. */
  reset() {
    this.value = 1;
    this.caffeine = 0;
  }
}
