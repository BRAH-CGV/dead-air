import { SignalTarget } from './SignalTarget.js';

// ─────────────────────────────────────────────
// SignalManager  –  Night signal spawning and tracking
// ─────────────────────────────────────────────
// Generates random sky positions for each night, assigns payload images
// from a pool, and tracks save/delete state. The required signal count
// scales with night number.
//
// Usage:
//   const mgr = new SignalManager({ signalsPerNight: 5, payloadPool: urls });
//   mgr.startNight(1);
//   mgr.selectSignal(2);
//   mgr.markScanned(2);
//   mgr.saveSignal(2);        // counts toward quota
//   mgr.deleteSignal(3);      // discarded
//   mgr.isComplete();          // saved >= required
// ─────────────────────────────────────────────

/** Pitch range for generated signals (radians, negative = up). */
const PITCH_MIN = -70 * (Math.PI / 180);  // steepest up
const PITCH_MAX = -10 * (Math.PI / 180);  // shallowest up

/** Required signals per night: base + (night-1). Clamped to signalsPerNight. */
const BASE_REQUIRED = 3;

export class SignalManager {
  /** @type {SignalTarget[]} */
  signals = [];

  /** Number of signals the player has saved. */
  saved = 0;

  /** Minimum saved signals needed to pass the night. */
  required = 0;

  /** Currently selected signal (set by selectSignal). @type {SignalTarget|null} */
  active = null;

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
    this.saved = 0;
    this.active = null;
    this.required = Math.min(
      this.signalsPerNight,
      BASE_REQUIRED + (nightNumber - 1),
    );

    // Shuffle the pool for non-repeating assignment.
    const shuffled = [...this.payloadPool];
    shuffleArray(shuffled);
    let poolIdx = 0;

    for (let i = 0; i < this.signalsPerNight; i++) {
      const yaw   = randomRange(-Math.PI, Math.PI);
      const pitch = randomRange(PITCH_MIN, PITCH_MAX);

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
      }));
    }
  }

  /** Set the active signal by ID, or null to clear. */
  selectSignal(id) {
    if (id == null) { this.active = null; return; }
    this.active = this.signals.find(s => s.id === id) ?? null;
  }

  /** Mark a signal as scanned (scan complete, awaiting save/delete). */
  markScanned(id) {
    const sig = this._find(id);
    if (sig) sig.scanned = true;
  }

  /** Save a scanned signal — increments the saved counter. */
  saveSignal(id) {
    const sig = this._find(id);
    if (!sig || sig.saved || sig.deleted) return;
    sig.saved = true;
    this.saved++;
  }

  /** Delete a scanned signal — discarded, does NOT increment counter. */
  deleteSignal(id) {
    const sig = this._find(id);
    if (!sig || sig.saved || sig.deleted) return;
    sig.deleted = true;
  }

  /** True when enough signals have been saved to pass the night. */
  isComplete() {
    return this.saved >= this.required;
  }

  /** Snapshot of current progress. */
  getProgress() {
    return {
      saved: this.saved,
      required: this.required,
      remaining: Math.max(0, this.required - this.saved),
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
