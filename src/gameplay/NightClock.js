// ─────────────────────────────────────────────
// NightClock  –  In-game time progression
// ─────────────────────────────────────────────
// Tracks the passage of a single night. Real seconds are mapped to in-game
// hours (e.g. 300 real seconds = 6 in-game hours → 50 s per hour).
//
// Standalone class — not a Component. Driven by GameController.update(dt).
//
// Callback hooks (assign a function to subscribe):
//   onTick(currentTime)   – every update
//   onHourChange(hour)    – when an integer hour boundary is crossed
//   onNightEnd()          – once, when finished becomes true
// ─────────────────────────────────────────────

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
  constructor({ startHour = 0, endHour = 6, nightDuration = 300 } = {}) {
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
    const h12 = Math.floor(h24) % 12 || 12;      // 12-hour display
    const minutes = Math.round((h24 % 1) * 60);  // fractional → minutes
    const suffix = h24 < 12 ? 'AM' : 'PM';
    return `${h12}:${String(minutes).padStart(2, '0')} ${suffix}`;
  }
}
