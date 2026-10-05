// ─────────────────────────────────────────────
// WhiteOut  –  the screen burning to white when the UFO takes you
// ─────────────────────────────────────────────
// A slow fade to white that holds — the game is over until the player
// retries — with a line of text surfacing once it is fully white:
//
//   whiteOut.play('You were taken. [E] to retry');
//   whiteOut.clear();   // the retry
//
// Wraps #whiteout in index.html (markup and the `is-white` / `is-shown`
// styles live there, like the other overlays); the fade's duration is set
// from here. Without a DOM every call is a no-op.
// ─────────────────────────────────────────────

export class WhiteOut {
  /** True from play() until clear(). */
  active = false;

  /**
   * @param {HTMLElement|null} [root]  Defaults to the page's #whiteout.
   * @param {object} [opts]
   * @param {number} [opts.fadeMs=2500]          Clear to fully white.
   * @param {number} [opts.messageDelayMs=3000]  play() to the message showing.
   */
  constructor(
    root = typeof document !== 'undefined' ? document.getElementById('whiteout') : null,
    { fadeMs = 2500, messageDelayMs = 3000 } = {},
  ) {
    this.root = root;
    this.fadeMs = fadeMs;
    this.messageDelayMs = messageDelayMs;
    this._message = root?.querySelector('.whiteout-message') ?? null;
    this._timer = null;
  }

  /** @param {string} [message] */
  play(message = '') {
    this.active = true;
    if (!this.root) return;
    this.root.style.transitionDuration = `${this.fadeMs}ms`;
    this.root.classList.add('is-white');
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      if (!this._message) return;
      this._message.textContent = message;
      this._message.classList.add('is-shown');
    }, this.messageDelayMs);
  }

  /** Back to the scene — quickly; the retry is a fresh start. */
  clear() {
    this.active = false;
    if (!this.root) return;
    clearTimeout(this._timer);
    this._timer = null;
    this.root.style.transitionDuration = '600ms';
    this.root.classList.remove('is-white');
    this._message?.classList.remove('is-shown');
  }
}
