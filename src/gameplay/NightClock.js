// ─────────────────────────────────────────────
// NightClock  –  In-game time progression
// ─────────────────────────────────────────────
// Tracks the passage of a single night. Real seconds are mapped to in-game
// hours: the shift (SHIFT) runs from sunset, 6:00 PM, to sunrise, 6:00 AM, over
// NIGHT_SECONDS (600) real seconds → 50 s per hour.
//
// Hours are on a 24-hour clock that runs through midnight as 0: 6 PM is -6,
// so the hour climbs steadily all shift. formatTime wraps it for display.
//
// Standalone class — not a Component. Driven by GameController.update(dt).
//
// Callback hooks (assign a function to subscribe):
//   onTick(currentTime)   – every update
//   onHourChange(hour)    – when an integer hour boundary is crossed
//   onNightEnd()          – once, when finished becomes true
// ─────────────────────────────────────────────

/** Real seconds in one shift, 6:00 PM → 6:00 AM: ten minutes. */
export const NIGHT_SECONDS = 600;

/** The shift on the clock, in hours from midnight (6 PM is -6): one
 *  twelve-hour shift, sunset to sunrise. `darkHour` is when dusk has gone:
 *  the Sun set at the start of the shift, and an hour later the sky is dark
 *  enough for the faint signals — and the things that come with the dark. */
export const SHIFT = Object.freeze({ startHour: -6, darkHour: -5, endHour: 6 });

export class NightClock {
  /** Real seconds elapsed this night. */
  elapsed = 0;

  /** Current in-game hour (float, startHour..endHour). */
  currentTime = 0;

  /** True once endHour has been reached. */
  finished = false;

  /** True while the clock is paused — update() is a no-op. */
  paused = false;

  /** @type {((t: number) => void)|null} */
  onTick = null;
  /** @type {((h: number) => void)|null} */
  onHourChange = null;
  /** @type {(() => void)|null} */
  onNightEnd = null;

  /** @param {{ startHour?: number, endHour?: number, nightDuration?: number }} opts */
  constructor({ startHour = SHIFT.startHour, endHour = SHIFT.endHour, nightDuration = NIGHT_SECONDS } = {}) {
    this.startHour = startHour;
    this.endHour = endHour;
    this.nightDuration = nightDuration;
    this.currentTime = startHour;
  }

  /** Formatted wall-clock string for the current in-game hour. */
  get timeString() {
    return NightClock.formatTime(this.currentTime);
  }

  /** Advance the clock by `dt` real seconds. */
  update(dt) {
    if (this.paused || this.finished) return;

    const prevHour = this.currentTime;
    this.elapsed += dt;

    // Map elapsed real seconds → in-game hours.
    const span = this.endHour - this.startHour;
    const hoursPerSecond = span / this.nightDuration;
    this.currentTime = Math.min(
      this.endHour,
      this.startHour + this.elapsed * hoursPerSecond,
    );

    // Fire onTick.
    this.onTick?.(this.currentTime);

    // Fire onHourChange for every integer hour crossed since last update.
    const prevInt = Math.floor(prevHour);
    const curInt  = Math.floor(this.currentTime);
    for (let h = prevInt + 1; h <= curInt && h <= this.endHour; h++) {
      this.onHourChange?.(h);
    }

    // Fire onNightEnd once.
    if (this.currentTime >= this.endHour && !this.finished) {
      this.finished = true;
      this.onNightEnd?.();
    }
  }

  pause()  { this.paused = true; }
  resume() { this.paused = false; }

  reset() {
    this.elapsed = 0;
    this.currentTime = this.startHour;
    this.finished = false;
    this.paused = false;
  }

  /** Format a 24-hour float (0–23.999…) as "H:MM AM/PM".
   *  @param {number} hour */
  static formatTime(hour) {
    const h24 = ((hour % 24) + 24) % 24;        // wrap into 0–24
    // Whole minutes since midnight, floored like a real clock: rounding the
    // minutes alone showed "1:60" for the last half-minute of every hour
    // (#61). The epsilon keeps float error (0.1 + 0.2) on its exact minute.
    const total = Math.floor(h24 * 60 + 1e-6) % (24 * 60);
    const h = Math.floor(total / 60);
    const minutes = total % 60;
    const h12 = h % 12 || 12;                     // 12-hour display
    const suffix = h < 12 ? 'AM' : 'PM';
    return `${h12}:${String(minutes).padStart(2, '0')} ${suffix}`;
  }
}
