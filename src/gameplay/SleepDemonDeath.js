// ─────────────────────────────────────────────
// SleepDemonDeath  –  the beats of falling asleep on him, with no scene
// ─────────────────────────────────────────────
// At empty the player doesn't just drop dead: their fatigue takes them, and
// when their eyes flare open he is right on top of them, peering down.
//
//   passOut   the lids slam shut as the body slumps; the world's sound falls away
//   black     lids shut, near-silence
//   flare     the lids snap open: he looms over them, eyes flaring
//   cut       to black (ScreenFade)
//   over      the night is failed; held until the night starts again
//
// Timed on the game clock (update(dt)), so a pause freezes it. SleepDemon
// maps it onto the camera, the overlay, the figure and the sound.
// ─────────────────────────────────────────────

export const SLEEP_DEMON_DEATH = Object.freeze({
  /** Seconds to pass out: the lids close and the body slumps. */
  passOut: 1,
  /** Seconds of black, lids shut, before they open. */
  black: 0.7,
  /** Seconds he looms over the player once their eyes are open. */
  loom: 1.3,
  /** Seconds of the cut to black: ScreenFade's own fade. */
  cut: 0.7,
  /** Seconds the lids take to snap open. */
  lidSnap: 0.08,
  /** Seconds the eyes take to flare. */
  eyeSnap: 0.15,
  /** The eye's height above the floor once slumped, metres. */
  slumpEye: 0.3,
  /** Where the slumped view ends up, radians: looking up, tipped over. */
  slumpPitch: 0.85,
  slumpRoll: 0.35,
  /** Metres in front of the slumped eye he stands … */
  loomDistance: 1.1,
  /** … leaning over the player by this much, radians. */
  lean: 0.3,
  /** The eyes' scale at full flare. */
  eyeFlare: 1.8,
  /** The share of the world's sound left once passed out. */
  hush: 0.05,
});

const BEATS = ['passOut', 'black', 'flare', 'cut'];
/** The tuning key each beat's length is under. */
const LENGTH = { passOut: 'passOut', black: 'black', flare: 'loom', cut: 'cut' };

const clamp01 = x => Math.min(1, Math.max(0, x));

export class SleepDemonDeath {
  /** @type {'idle'|'passOut'|'black'|'flare'|'cut'|'over'} */
  phase = 'idle';
  /** Seconds into the phase. */
  elapsed = 0;

  /**
   * @param {object} [opts]
   * @param {(phase: string) => void} [opts.onPhase]  each beat as it begins, and 'over'
   * @param {() => void} [opts.onDone]  every beat has run: once
   * @param {typeof SLEEP_DEMON_DEATH} [opts.tuning]
   */
  constructor({ onPhase = () => {}, onDone = () => {}, tuning = SLEEP_DEMON_DEATH } = {}) {
    Object.assign(this, { onPhase, onDone, tuning });
  }

  /** It has started and not been called off: the scene is its. */
  get active() { return this.phase !== 'idle'; }

  /** A beat is still playing. */
  get running() { return this.active && this.phase !== 'over'; }

  /** @returns {boolean} false while it runs or once over: one death a night. */
  start() {
    if (this.active) return false;
    this._enter('passOut');
    return true;
  }

  /** Back to idle, at once and without a word. */
  cancel() {
    this.phase = 'idle';
    this.elapsed = 0;
  }

  /** @param {number} dt */
  update(dt) {
    if (!this.running) return;
    this.elapsed += dt;
    // A long frame runs through every beat it covers.
    while (this.running && this.elapsed >= this.tuning[LENGTH[this.phase]]) {
      const left = this.elapsed - this.tuning[LENGTH[this.phase]];
      const next = BEATS[BEATS.indexOf(this.phase) + 1] ?? 'over';
      this._enter(next);
      this.elapsed = left;
      if (next === 'over') this.onDone();
    }
  }

  /** The lids, 0 open … 1 shut: slow, then slammed. */
  get lid() {
    const { phase, tuning: t } = this;
    if (phase === 'passOut') return this._k() ** 3;
    if (phase === 'black') return 1;
    if (phase === 'flare') return 1 - clamp01(this.elapsed / t.lidSnap);
    return 0;
  }

  /** How far the body has slumped, 0 … 1: falling, so slow, then fast. */
  get slump() {
    if (this.phase === 'idle') return 0;
    return this.phase === 'passOut' ? this._k() ** 2 : 1;
  }

  /** The eyes' flare, 0 … 1, from the moment the lids open. */
  get flare() {
    const { phase, tuning: t } = this;
    if (phase === 'flare') return clamp01(this.elapsed / t.eyeSnap);
    return phase === 'cut' || phase === 'over' ? 1 : 0;
  }

  // ── Private ──

  /** Share of the pass out run. */
  _k() {
    return clamp01(this.elapsed / this.tuning.passOut);
  }

  _enter(phase) {
    this.phase = phase;
    this.elapsed = 0;
    this.onPhase(phase);
  }
}
