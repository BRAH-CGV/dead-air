// ─────────────────────────────────────────────
// FrameSettle  –  "has the frame rate calmed down yet?"
// ─────────────────────────────────────────────
// The first frames after a scene goes up are the expensive ones: the JIT is
// still warming, the physics world takes its first steps, the GPU finishes
// uploads the warm-up queued. Engine keeps the loading screen up, with the
// game loop running underneath it, until this says the frames have been
// smooth for a run — so the player's first look around is the smooth one.
//
//   const settle = new FrameSettle();
//   if (settle.push(frameDt)) loadingScreen.hide();
//
// It wants a calm *run*, not a calm average: one stall restarts the count.
// A machine that never gets there is let in after `timeoutMs` anyway —
// a slow game beats a loading screen that never ends.
// ─────────────────────────────────────────────

export class FrameSettle {
  /** True once the frames have settled (or the wait timed out). Stays true. */
  settled = false;

  /**
   * @param {object} [opts]
   * @param {number} [opts.frames=20]       Smooth frames needed in a row.
   * @param {number} [opts.maxFrameMs=50]   A frame longer than this is a hitch.
   * @param {number} [opts.timeoutMs=5000]  Give up waiting after this long.
   */
  constructor({ frames = 20, maxFrameMs = 50, timeoutMs = 5000 } = {}) {
    this.frames = frames;
    this.maxFrame = maxFrameMs / 1000;
    this.timeout = timeoutMs / 1000;
    this._run = 0;
    this._elapsed = 0;
  }

  /** Report one frame. @param {number} dt  Seconds. @returns {boolean} settled */
  push(dt) {
    if (this.settled) return true;
    this._elapsed += dt;
    this._run = dt <= this.maxFrame ? this._run + 1 : 0;
    // A small epsilon: elapsed is a float sum of frame times.
    this.settled = this._run >= this.frames || this._elapsed >= this.timeout - 1e-9;
    return this.settled;
  }
}
