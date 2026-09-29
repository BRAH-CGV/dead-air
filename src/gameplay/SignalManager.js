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
//   mgr.markScanned(2);
//   mgr.saveSignal(2);        // counts toward quota
//   mgr.deleteSignal(3);      // discarded
//   mgr.isComplete();          // saved >= required
//
// Storage (night 3 on, when `storageFromNight` is set): the terminal holds
// at most `storageCapacity` saved signals. They wait as `pending` until the
// player stores them at the server console (`storeSignals()`), and only
// `stored` ones count toward the quota — the reason to cross the camera's
// room. With storage off, a save counts at once, as it always has.
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

  /** Saved but not yet stored. Only ever non-zero while storage is on. */
  pending = 0;

  /** Stored at the server console; the count that matters with storage on. */
  stored = 0;

  /** How many saved signals the terminal holds tonight; null = no limit
   *  (storage off). Set by startNight from the options below. */
  storageLimit = null;

  /** @type {number} */
  signalsPerNight;

  /** @type {string[]} */
  payloadPool;

  /**
   * @param {Object} opts
   * @param {number} [opts.signalsPerNight=5]
   * @param {string[]} [opts.payloadPool=[]]
   * @param {number|null} [opts.storageFromNight=null]  first night with storage; null = never
   * @param {number} [opts.storageCapacity=2]  saved signals the terminal holds
   */
  constructor({ signalsPerNight = 5, payloadPool = [], storageFromNight = null, storageCapacity = 2 } = {}) {
    this.signalsPerNight = signalsPerNight;
    this.payloadPool = payloadPool;
    this.storageFromNight = storageFromNight;
    this.storageCapacity = storageCapacity;
  }

  /** Generate a fresh set of signals for a new night. */
  startNight(nightNumber) {
    this.signals = [];
    this.saved = 0;
    this.pending = 0;
    this.stored = 0;
    this.storageLimit =
      this.storageFromNight != null && nightNumber >= this.storageFromNight
        ? this.storageCapacity
        : null;
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

  /** Mark a signal as scanned (scan complete, awaiting save/delete). */
  markScanned(id) {
    const sig = this._find(id);
    if (sig) sig.scanned = true;
  }

  /** Room on the terminal for another saved signal. */
  canSave() {
    return this.storageLimit == null || this.pending < this.storageLimit;
  }

  /** Save a scanned signal — increments the saved counter. With storage on
   *  it waits as pending, and a full terminal refuses it.
   *  @returns {boolean} whether it was saved */
  saveSignal(id) {
    const sig = this._find(id);
    if (!sig || sig.saved || sig.deleted) return false;
    if (!this.canSave()) return false;
    sig.saved = true;
    this.saved++;
    if (this.storageLimit != null) this.pending++;
    return true;
  }

  /** Move every waiting signal into storage (the server console).
   *  @returns {number} how many were stored */
  storeSignals() {
    const n = this.pending;
    this.stored += n;
    this.pending = 0;
    return n;
  }

  /** Delete a scanned signal — discarded, does NOT increment counter. */
  deleteSignal(id) {
    const sig = this._find(id);
    if (!sig || sig.saved || sig.deleted) return;
    sig.deleted = true;
  }

  /** The signals that count toward the quota: stored ones while storage
   *  is on, every saved one otherwise. */
  get counted() {
    return this.storageLimit != null ? this.stored : this.saved;
  }

  /** True when enough signals count to pass the night. */
  isComplete() {
    return this.counted >= this.required;
  }

  /** Snapshot of current progress. */
  getProgress() {
    return {
      saved: this.saved,
      stored: this.stored,
      pending: this.pending,
      counted: this.counted,
      required: this.required,
      remaining: Math.max(0, this.required - this.counted),
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
