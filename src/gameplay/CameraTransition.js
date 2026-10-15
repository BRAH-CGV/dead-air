// ─────────────────────────────────────────────
// CameraTransition  –  a camera switch as a feed losing and finding signal
// ─────────────────────────────────────────────
// One timeline that both the picture (CameraSignalPass) and the hiss read,
// so they move as one. Pure: no Three.js, no DOM.
//
//   const t = new CameraTransition();
//   t.cut();                  // a switch: capture the screen first
//   t.update(dt, feed.live);  // once a frame
//   pass.set(t);              // frozen, noise, tear, roll, desat, band
//   hiss.set(level * t.hiss, dt);
//
//   idle ─cut()─▶ drop ─▶ wait ─live─▶ resolve ─▶ idle
//                  ▲        ▲            │
//                  └─cut()──┴──not live──┘
//
//   drop     the last frame, frozen, tears and drains of colour; grain in
//   wait     it holds, rolling slowly under dim grain, for as long as the
//            new camera's zones are loading (CameraFeed.live is the gate)
//   resolve  the live picture shows through the grain as it dies away, with
//            one tear band sweeping down
//
// Nothing here decides when the picture is ready: `live` is CameraFeed's,
// and resolve never starts before it — a slow machine waits on the frozen
// frame, with `waitingLong` set for a CONNECTING label.
// ─────────────────────────────────────────────

/** Tuning. Seconds unless stated. */
export const SIGNAL = {
  /** The freeze tearing in. */
  drop: 0.08,
  /** The live picture coming through. */
  resolve: 0.18,
  /** Grain over the frozen frame (0..1 of the shader's full grain). */
  waitNoise: 0.45,
  /** Desaturation of the frozen frame. */
  waitDesat: 0.8,
  /** Line tear at the cut, and what it settles to through the wait. */
  dropTear: 1,
  waitTear: 0.18,
  /** Screen heights a second the frozen frame rolls. */
  rollRate: 0.06,
  /** A wait longer than this shows CONNECTING. */
  longWait: 0.6,
  /** The hiss's tail once the picture is live: it is at full from the cut
   *  and drops out this quickly, ahead of the grain. Longer read as flowy. */
  hissOut: 0.04,
};

const lerp = (a, b, t) => a + (b - a) * t;

export class CameraTransition {
  /** 'idle' | 'drop' | 'wait' | 'resolve' */
  phase = 'idle';
  /** Show the captured frame (else the live picture under the effect). */
  frozen = false;
  /** 0..1 each. */
  noise = 0;
  tear = 0;
  desat = 0;
  /** Vertical offset of the frozen frame, 0..1 of the screen, wrapping. */
  roll = 0;
  /** Where the resolve's tear band is, 0 (top) .. 1 (bottom). */
  band = 0;
  waitingLong = false;
  /** No old picture to freeze (sitting down): the cover is grain over
   *  black rather than a frozen frame. */
  blank = false;

  /** @param {{ reducedMotion?: boolean }} [opts] */
  constructor({ reducedMotion = false } = {}) {
    this.reducedMotion = reducedMotion;
    this._t = 0;
    this._waited = 0;
  }

  /** Drawing anything (the pass is skipped when not). */
  get active() { return this.phase !== 'idle'; }

  /** The hiss, 0..1: full from the cut through the wait, then a short tail
   *  (`hissOut`) once the picture is live — not the grain's slow fade. */
  get hiss() {
    if (this.phase === 'drop' || this.phase === 'wait') return 1;
    if (this.phase === 'resolve') return Math.max(0, 1 - this._t / SIGNAL.hissOut);
    return 0;
  }

  /** A switch. The caller captures the screen on this frame — unless
   *  `blank`: there is no picture worth freezing (sitting down, where it
   *  would be the desk), so the cover is grain over black.
   *  @param {{ blank?: boolean }} [opts] */
  cut({ blank = false } = {}) {
    this.blank = blank;
    this._enter('drop');
    this._waited = 0;
    this.roll = 0;
    this._apply();
  }

  /** Back to nothing at once (leaving the monitor). */
  reset() {
    this.blank = false;
    this._enter('idle');
    this._waited = 0;
    this.roll = 0;
    this._apply();
  }

  /** @param {number} dt  @param {boolean} live  The new picture is ready. */
  update(dt, live) {
    if (this.phase === 'idle') return;
    this._t += dt;
    if (this.phase === 'drop' && this._t >= SIGNAL.drop) this._enter(live ? 'resolve' : 'wait');
    else if (this.phase === 'wait') {
      this._waited += dt;
      if (live) this._enter('resolve');
    } else if (this.phase === 'resolve') {
      if (!live) this._enter('wait');
      else if (this._t >= SIGNAL.resolve) this._enter('idle');
    }
    if (this.frozen && !this.reducedMotion) this.roll = (this.roll + SIGNAL.rollRate * dt) % 1;
    this._apply();
  }

  // ── Internals ─────────────────────────────

  _enter(phase) {
    this.phase = phase;
    this._t = 0;
  }

  /** The outputs for where the timeline is. */
  _apply() {
    const motion = this.reducedMotion ? 0 : 1;
    switch (this.phase) {
      case 'drop': {
        const k = Math.min(this._t / SIGNAL.drop, 1);
        this.frozen = true;
        this.noise = lerp(0.1, SIGNAL.waitNoise, k);
        this.desat = lerp(0, SIGNAL.waitDesat, k);
        this.tear = lerp(SIGNAL.dropTear, SIGNAL.waitTear, k) * motion;
        this.band = 0;
        break;
      }
      case 'wait':
        this.frozen = true;
        this.noise = SIGNAL.waitNoise;
        this.desat = SIGNAL.waitDesat;
        this.tear = SIGNAL.waitTear * motion;
        this.band = 0;
        break;
      case 'resolve': {
        const k = Math.min(this._t / SIGNAL.resolve, 1);
        const fade = (1 - k) * (1 - k);
        this.frozen = false;
        this.noise = SIGNAL.waitNoise * fade;
        this.desat = SIGNAL.waitDesat * 0.5 * fade;
        this.tear = SIGNAL.dropTear * 0.5 * (1 - k) * motion;
        this.band = k;
        this.roll = 0;
        break;
      }
      default:
        this.frozen = false;
        this.noise = this.desat = this.tear = this.band = this.roll = 0;
    }
    if (!motion) this.roll = 0;
    this.waitingLong = this.phase === 'wait' && this._waited >= SIGNAL.longWait;
  }
}
