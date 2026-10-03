// ─────────────────────────────────────────────
// PointerLock  –  a request() that answers yes or no, and never throws
// ─────────────────────────────────────────────
// The browser API is awkward to build a pause menu on:
//   • requestPointerLock() only works inside a user gesture (a click). Esc
//     is not one, which is why only the Resume button resumes.
//   • Current Chrome returns a Promise; older versions return undefined and
//     report failure as a `pointerlockerror` event on document.
//   • For about a second after the player leaves with Esc, Chrome rejects a
//     new request with a SecurityError — a fast Resume click hits that.
// request() folds all of it, plus a timeout, into Promise<boolean>. jsdom
// has no pointer lock at all, so tests drive a fake behind this adapter.
// ─────────────────────────────────────────────

export class PointerLock {
  /**
   * @param {HTMLElement} element  What to lock (the canvas)
   * @param {object} [opts]
   * @param {Document} [opts.doc]
   * @param {number} [opts.timeoutMs=1000]  Give up if no event arrives
   */
  constructor(element, { doc = document, timeoutMs = 1000 } = {}) {
    this.element = element;
    this.doc = doc;
    this.timeoutMs = timeoutMs;
  }

  /** Whether our element holds the lock right now. */
  get locked() {
    return !!this.element && this.doc.pointerLockElement === this.element;
  }

  /** Ask for the lock. Call from inside a click handler.
   *  @returns {Promise<boolean>} true once the lock is confirmed */
  request() {
    if (this.locked) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.doc.removeEventListener('pointerlockchange', onChange);
        this.doc.removeEventListener('pointerlockerror', onError);
        resolve(ok);
      };
      const onChange = () => { if (this.locked) finish(true); };
      const onError = () => finish(false);
      const timer = setTimeout(() => finish(this.locked), this.timeoutMs);
      this.doc.addEventListener('pointerlockchange', onChange);
      this.doc.addEventListener('pointerlockerror', onError);

      try {
        const result = this.element?.requestPointerLock?.();
        if (!this.element?.requestPointerLock) finish(false);
        // The promise settles before (or without) the change event on some
        // builds; the event is still the source of truth for success.
        else if (result && typeof result.then === 'function') {
          result.then(() => { if (this.locked) finish(true); }, () => finish(false));
        }
      } catch {
        finish(false);
      }
    });
  }

  /** Release the lock, if we hold it. */
  exit() {
    if (this.locked) this.doc.exitPointerLock?.();
  }

  /** Subscribe to lock changes: `listener(locked)`.
   *  @returns {() => void} unsubscribe */
  onChange(listener) {
    const handler = () => listener(this.locked);
    this.doc.addEventListener('pointerlockchange', handler);
    return () => this.doc.removeEventListener('pointerlockchange', handler);
  }
}
