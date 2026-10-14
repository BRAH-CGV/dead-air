// ─────────────────────────────────────────────
// BedTransition  –  getting into and out of the bunk, with no scene
// ─────────────────────────────────────────────
// There is no player body to animate, so going to bed is the view: the
// camera's place, pitch and roll, and the FatigueOverlay's eyelids. This is
// the sequence of steps; BedRest maps it onto the camera and the overlay.
//
//   lyingDown   the view goes from where you stood ('here') to the pillow
//               ('lie'), tipping up to the ceiling and onto its side; the
//               lids close slowly over the last of it
//   asleep      lids shut — onAsleep() is called on the way in: only now
//               does a nap speed the night up, or the morning sleep run.
//               Every now and again the eyes come half open (a peek), hold,
//               and shut again completely
//   opening     the lids open: slowly (calm), or snapped (startled)
//   sittingUp   from wherever the view is ('here') to sitting on the edge
//               of the bunk ('sit'): eased (calm), or sharp (startled)
//   standingUp  from 'sit' to standing beside it ('out'); onUp() is called
//               as it returns to idle
//
// A wake while still getting in turns straight into getting out, from
// wherever the view got to: the lids open from where they are.
//
// pose is { from, to, t } between the named views, t eased 0 … 1. 'here'
// is wherever the view is as the phase begins: the driver takes a snapshot
// of it on 'lyingDown' and 'opening'.
//
// Timed on whatever clock update(dt) is handed — BedRest hands it real
// seconds, since a nap runs the game's clock fifteen times faster.
// ─────────────────────────────────────────────

export const BED_TRANSITION = Object.freeze({
  /** Seconds from standing to lying on the pillow. */
  lieDown: 2,
  /** The share of the lie-down run before the lids start to close. */
  lidsFrom: 0.35,
  /** Seconds of each step out of bed: the eyes opening, sitting up, standing. */
  calm: Object.freeze({ open: 0.8, sitUp: 0.65, standUp: 0.6 }),
  startled: Object.freeze({ open: 0.07, sitUp: 0.3, standUp: 0.4 }),
  /** The half-open eyes while asleep, real seconds: the first after
   *  `first` — soon, since a 30-minute nap is ~1.7 s of real time, and the
   *  nap holds the night at real time while the eyes are open — then one
   *  every `every`; each opens over `open` to `lid`
   *  (0 open … 1 shut), holds for `hold`, and shuts over `close`. */
  peek: Object.freeze({
    first: [0.6, 1.2], every: [6, 11], open: 1, hold: [2.5, 4], close: 0.6, lid: 0.5,
  }),
});

const clamp01 = x => Math.min(1, Math.max(0, x));
const smooth = k => k * k * (3 - 2 * k);
const easeOut = k => 1 - (1 - k) ** 3;
const between = ([lo, hi], r) => lo + (hi - lo) * r;

/** The next phase out of bed. */
const NEXT = { opening: 'sittingUp', sittingUp: 'standingUp', standingUp: 'idle' };

export class BedTransition {
  /** @type {'idle'|'lyingDown'|'asleep'|'opening'|'sittingUp'|'standingUp'} */
  phase = 'idle';
  /** Seconds into the phase. */
  elapsed = 0;
  /** How the getting out runs: 'calm' or 'startled'. Null until woken. */
  style = null;

  /**
   * @param {object} [opts]
   * @param {(phase: string) => void} [opts.onPhase]  each phase as it begins, 'idle' at the end
   * @param {() => void} [opts.onAsleep]  the lids have shut on the way in
   * @param {() => void} [opts.onUp]  standing beside the bunk: all done
   * @param {() => number} [opts.rand]  when the peeks come
   * @param {typeof BED_TRANSITION} [opts.tuning]
   */
  constructor({ onPhase = () => {}, onAsleep = () => {}, onUp = () => {}, rand = Math.random, tuning = BED_TRANSITION } = {}) {
    Object.assign(this, { onPhase, onAsleep, onUp, rand, tuning });
    this._lidFrom = 0;       // the lids as the eyes began to open
    this._peek = 'shut';     // 'shut' | 'opening' | 'holding' | 'closing'
    this._peekIn = 0;        // seconds left in this part of the peek
    this._peekLength = 0;    // how long this part of the peek runs
  }

  /** Getting in, asleep or getting out. */
  get active() { return this.phase !== 'idle'; }

  /** Lying with the lids down (peeks included). */
  get asleep() { return this.phase === 'asleep'; }

  /** The eyes are half open while asleep. */
  get peeking() { return this.asleep && this._peek !== 'shut'; }

  /** @returns {boolean} false unless idle */
  lieDown() {
    if (this.active) return false;
    this.style = null;
    this._enter('lyingDown');
    return true;
  }

  /**
   * Out of bed, from getting in or asleep.
   * @param {'calm'|'startled'} [style]
   * @returns {boolean} false when not in bed, or already getting out
   */
  getUp(style = 'calm') {
    if (this.phase !== 'lyingDown' && this.phase !== 'asleep') return false;
    this._lidFrom = this.lid;
    this.style = style;
    this._peek = 'shut';
    this._enter('opening');
    return true;
  }

  /** Back to idle, at once and without a word. */
  cancel() {
    this.phase = 'idle';
    this.elapsed = 0;
    this.style = null;
    this._peek = 'shut';
  }

  /** @param {number} dt  seconds, on the clock the steps keep */
  update(dt) {
    if (!this.active) return;
    if (this.asleep) return this._tickPeek(dt);
    this.elapsed += dt;
    // A long frame runs through every step it covers.
    while (this.active && !this.asleep && this.elapsed >= this._length()) {
      const left = this.elapsed - this._length();
      if (this.phase === 'lyingDown') {
        this._enter('asleep');
        this._schedulePeek(this.tuning.peek.first);
        this.onAsleep();
        return;
      }
      const next = NEXT[this.phase];
      this._enter(next);
      this.elapsed = left;
      if (next === 'idle') {
        this.style = null;
        this.onUp();
      }
    }
  }

  /** The lids, 0 open … 1 shut. */
  get lid() {
    const t = this.tuning;
    switch (this.phase) {
      case 'lyingDown': return smooth(clamp01((this._k() - t.lidsFrom) / (1 - t.lidsFrom)));
      case 'asleep': return 1 - (1 - t.peek.lid) * this._peekOpen();
      case 'opening': {
        const k = this._k();
        return this._lidFrom * (1 - (this.style === 'startled' ? k : smooth(k)));
      }
      default: return 0;
    }
  }

  /** Where the view is: between two named views, t eased 0 … 1. */
  get pose() {
    switch (this.phase) {
      case 'lyingDown': return { from: 'here', to: 'lie', t: smooth(this._k()) };
      case 'asleep': return { from: 'lie', to: 'lie', t: 1 };
      case 'opening': return { from: 'here', to: 'here', t: 0 };
      case 'sittingUp': {
        const k = this._k();
        return { from: 'here', to: 'sit', t: this.style === 'startled' ? easeOut(k) : smooth(k) };
      }
      case 'standingUp': return { from: 'sit', to: 'out', t: smooth(this._k()) };
      default: return { from: 'out', to: 'out', t: 1 };
    }
  }

  // ── Private ──

  /** Seconds the current phase runs. Opening takes as long as the lids
   *  have left to open: none if they never closed. */
  _length() {
    const t = this.tuning;
    if (this.phase === 'lyingDown') return t.lieDown;
    const steps = t[this.style ?? 'calm'];
    if (this.phase === 'opening') return steps.open * this._lidFrom;
    if (this.phase === 'sittingUp') return steps.sitUp;
    if (this.phase === 'standingUp') return steps.standUp;
    return Infinity;
  }

  /** Share of the current phase run. */
  _k() {
    const length = this._length();
    return length > 0 ? clamp01(this.elapsed / length) : 1;
  }

  _enter(phase) {
    this.phase = phase;
    this.elapsed = 0;
    this.onPhase(phase);
  }

  // ── Peeks ──

  _schedulePeek(range) {
    this._peek = 'shut';
    this._peekLength = this._peekIn = between(range, this.rand());
  }

  /** A frame of the peek cycle: shut → opening → holding → closing → shut. */
  _tickPeek(dt) {
    const p = this.tuning.peek;
    this._peekIn -= dt;
    while (this._peekIn <= 0) {
      const over = -this._peekIn;
      if (this._peek === 'shut') this._peekPart('opening', p.open);
      else if (this._peek === 'opening') this._peekPart('holding', between(p.hold, this.rand()));
      else if (this._peek === 'holding') this._peekPart('closing', p.close);
      else this._schedulePeek(p.every);
      this._peekIn -= over;
    }
  }

  _peekPart(part, seconds) {
    this._peek = part;
    this._peekLength = this._peekIn = seconds;
  }

  /** How open the eyes are through the peek, 0 shut … 1 as open as a peek goes. */
  _peekOpen() {
    const k = this._peekLength > 0 ? clamp01(1 - this._peekIn / this._peekLength) : 1;
    if (this._peek === 'opening') return smooth(k);
    if (this._peek === 'holding') return 1;
    if (this._peek === 'closing') return 1 - smooth(k);
    return 0;
  }
}
