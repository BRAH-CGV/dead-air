import { SignalTarget } from './SignalTarget.js';

// ─────────────────────────────────────────────
// SignalManager  –  Night signal spawning and tracking
// ─────────────────────────────────────────────
// Generates random sky positions for each night, assigns payload images
// from a pool, and tracks save/delete state. The required signal count
// scales with night number.
//
// Signals are not all visible at 12:00: each one carries an appearAt shift
// fraction spread across [APPEAR_START, APPEAR_BY], and pops in for a
// short window once the night reaches it — fade in over
// SIGNAL_FADE_SECONDS, hold VISIBLE_SECONDS, fade back out. The sky is
// often empty, and a missed window is gone for the night.
//
// Usage:
//   const mgr = new SignalManager({ signalsPerNight: 5, payloadPool: urls });
//   mgr.startNight(1);
//   mgr.update(dt, nightClock);  // call each frame — appearance + fade
//   mgr.markScanned(2);
//   mgr.saveSignal(2);        // counts toward quota
//   mgr.deleteSignal(3);      // discarded
//   mgr.getProgress();         // { required }
// ─────────────────────────────────────────────

/** Pitch range for generated signals (radians, negative = up). Sized to
 *  the dish array's combined reach: the local dish covers the majority of
 *  the band as the big central disc, the neighbours' rim sections cover
 *  the outer band out to the horizon — every signal lands where at least
 *  one dish can see it. */
export const PITCH_MIN = -80 * (Math.PI / 180);  // steepest up
export const PITCH_MAX = -8 * (Math.PI / 180);   // shallowest up

/** Required signals per night: base + (night-1). Clamped to signalsPerNight. */
const BASE_REQUIRED = 3;

/** Shift fraction at which the first signal may appear — the sky stays
 *  empty for the first minutes of the night. */
export const APPEAR_START = 0.05;

/** Shift fraction by which every signal has appeared, leaving enough
 *  night left to scan the quota. */
export const APPEAR_BY = 0.75;

/** Real seconds a signal's radar dot takes to fade fully in (and out). */
export const SIGNAL_FADE_SECONDS = 3;

/** Real seconds a signal holds at full brightness before fading back out.
 *  Windows are short on purpose — the alert lamp exists to drag the
 *  player to the terminal the moment one opens. */
export const VISIBLE_SECONDS = 15;

export class SignalManager {
  /** @type {SignalTarget[]} */
  signals = [];

  /** Minimum signals needed to pass the night (informational — the actual
   *  quota is now tracked by the drive box dock via physical drives). */
  required = 0;

  /** @type {number} */
  signalsPerNight;

  /** @type {string[]} */
  payloadPool;

  /**
   * @param {Object} opts
   * @param {number} [opts.signalsPerNight=5]
   * @param {string[]} [opts.payloadPool=[]]
   */
  constructor({ signalsPerNight = 5, payloadPool = [] } = {}) {
    this.signalsPerNight = signalsPerNight;
    this.payloadPool = payloadPool;
  }

  /** Generate a fresh set of signals for a new night. */
  startNight(nightNumber) {
    this.signals = [];
    this.required = Math.min(
      this.signalsPerNight,
      BASE_REQUIRED + (nightNumber - 1),
    );

    // Shuffle the pool for non-repeating assignment.
    const shuffled = [...this.payloadPool];
    shuffleArray(shuffled);
    let poolIdx = 0;

    // Appearance schedule: the window [APPEAR_START, APPEAR_BY] split into
    // one slot per signal; each signal lands 20–80% into its own slot, so
    // consecutive appearances are at least 0.4 slot-widths apart — the sky
    // is often empty, but never dumps every signal at once.
    const slotWidth = (APPEAR_BY - APPEAR_START) / this.signalsPerNight;

    for (let i = 0; i < this.signalsPerNight; i++) {
      const yaw   = randomRange(-Math.PI, Math.PI);
      const pitch = randomRange(PITCH_MIN, PITCH_MAX);
      const appearAt = APPEAR_START + slotWidth * (i + 0.2 + 0.6 * Math.random());

      let payloadUrl = '';
      if (shuffled.length > 0) {
        payloadUrl = shuffled[poolIdx % shuffled.length];
        poolIdx++;
      }

      this.signals.push(new SignalTarget({
        id: i + 1,
        yaw,
        pitch,
        payloadUrl,
        appearAt,
        fadeSeconds: SIGNAL_FADE_SECONDS,
        visibleSeconds: VISIBLE_SECONDS,
      }));
    }
  }

  /** Advance appearance/fade state. Call once per frame with the elapsed
   *  real seconds and the night clock; signals flip to `appeared` when the
   *  shift reaches their `appearAt`, then fade in over their fadeSeconds.
   *  No-op without a clock. */
  update(dt, clock) {
    if (!clock) return;
    const span = clock.endHour - clock.startHour;
    const progress = span > 0 ? (clock.currentTime - clock.startHour) / span : 0;

    for (const sig of this.signals) {
      if (sig.appeared) {
        if (sig.fadeElapsed < sig.lifeSeconds) {
          sig.fadeElapsed = Math.min(sig.lifeSeconds, sig.fadeElapsed + dt);
        }
        continue;
      }
      if (progress >= sig.appearAt) sig.appeared = true;
    }
  }

  /** Mark a signal as scanned (scan complete, awaiting save/delete). */
  markScanned(id) {
    const sig = this._find(id);
    if (sig) sig.scanned = true;
  }

  /** Save a scanned signal — marks it as saved (no counter; quota is
   *  tracked by the drive box dock via physical drives). */
  saveSignal(id) {
    const sig = this._find(id);
    if (!sig || sig.saved || sig.deleted) return;
    sig.saved = true;
  }

  /** Delete a scanned signal — discarded, does NOT increment counter. */
  deleteSignal(id) {
    const sig = this._find(id);
    if (!sig || sig.saved || sig.deleted) return;
    sig.deleted = true;
  }

  /** Snapshot of current progress (informational — quota is driven by
   *  the drive box dock, not by signal counts). */
  getProgress() {
    return {
      required: this.required,
    };
  }

  /** @private */
  _find(id) {
    return this.signals.find(s => s.id === id) ?? null;
  }
}

// ── Helpers ──

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

/** Fisher-Yates shuffle, in place. */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
