// ─────────────────────────────────────────────
// MouseSpikes  –  drop a touchpad's glitch, keep a fast flick (#117)
// ─────────────────────────────────────────────
// Touchpads (and Chrome's pointer lock on some systems) now and then send one
// mousemove with a huge movement out of nowhere, which threw the view half
// way round. They used to be clamped: each event to 40 px, each frame to
// 32 px. But Chrome sends about one coalesced mousemove a frame, so that cap
// was also the fastest the view could turn — ~2000 px a second — and the
// faster the mouse moved the more of it was cut off.
//
// A real flick builds up over a few events; a spike jumps straight from
// nothing. So an event is dropped only when it is both big (past `minimum`)
// and many times (`ratio`) bigger than the last one let through. Everything
// else passes untouched, however fast.
// ─────────────────────────────────────────────

export const MOUSE_SPIKE = {
  /** Pixels. A delta this big or smaller is never a spike. */
  minimum: 300,
  /** How many times the last accepted delta a big one must be to be dropped. */
  ratio: 8,
};

export class MouseSpikeFilter {
  /** The size of the last delta let through. */
  _last = 0;

  /** @returns {boolean} true to use this movement, false to drop it */
  accept(dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    const size = Math.hypot(dx, dy);
    if (size > MOUSE_SPIKE.minimum && size > this._last * MOUSE_SPIKE.ratio) return false;
    this._last = size;
    return true;
  }

  /** Forget the last movement: the pointer lock was gained or lost. */
  reset() {
    this._last = 0;
  }
}
