// ─────────────────────────────────────────────
// WhiteOut  –  the screen burning to white when the UFO takes you
// ─────────────────────────────────────────────
// A slow fade to white that holds — the game is over until the player
// retries — with a line of text surfacing once it is fully white:
//
//   whiteOut.play('You were taken. [E] to retry');
//   whiteOut.play('You have been eaten. Press [E] to try again', { tone: 'blood' });
//     // black at once, slowly turning red (redMs), the message once it has
//   whiteOut.clear();   // the retry
//
// Wraps #whiteout in index.html (markup and the `is-white` / `is-shown`
// styles live there, like the other overlays); the fade's duration is set
// from here. Without a DOM every call is a no-op.
// ─────────────────────────────────────────────

/** Where the 'blood' screen ends up. */
const BLOOD_RED = '#6e0606';

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

  /**
   * @param {string} [message]
   * @param {{ tone?: 'white'|'blood', fadeMs?: number, messageDelayMs?: number, redMs?: number }} [opts]
   *        'blood' (DustEyes) cuts to black at once and turns slowly red over
   *        redMs. fadeMs / messageDelayMs override this WhiteOut's own for
   *        this play only.
   */
  play(message = '', {
    tone = 'white', fadeMs = this.fadeMs, messageDelayMs = this.messageDelayMs, redMs = 2500,
  } = {}) {
    this.active = true;
    if (!this.root) return;
    const blood = tone === 'blood';
    this.root.classList.toggle('is-blood', blood);
    clearTimeout(this._redTimer);
    if (blood) {
      // Black this instant — with no transition at all, and the style flushed
      // so the browser has really taken it (otherwise the switch to black is
      // itself eased, and the screen fades from white). Then the slow turn
      // to red.
      this.root.style.transition = 'none';
      this.root.style.backgroundColor = '#000';
      this.root.classList.add('is-white');
      void getComputedStyle(this.root).backgroundColor;
      this.root.style.transition = `opacity 0ms, background-color ${redMs}ms ease-in`;
      this._redTimer = setTimeout(() => { this.root.style.backgroundColor = BLOOD_RED; }, 30);
    } else {
      this.root.style.transition = '';
      this.root.style.backgroundColor = '';
      this.root.style.transitionDuration = `${fadeMs}ms`;
    }
    this.root.classList.add('is-white');
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      if (!this._message) return;
      this._message.textContent = message;
      this._message.classList.add('is-shown');
    }, messageDelayMs);
  }

  /** Back to the scene — quickly; the retry is a fresh start. */
  clear() {
    this.active = false;
    if (!this.root) return;
    clearTimeout(this._timer);
    clearTimeout(this._redTimer);
    this._timer = null;
    this.root.style.transitionDuration = '600ms';
    // The tone stays through the fade back — dropping it here would flash
    // the fading red white. The next play() sets it.
    this.root.classList.remove('is-white');
    this._message?.classList.remove('is-shown');
  }
}
