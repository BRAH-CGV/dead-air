// ─────────────────────────────────────────────
// ScreenFade  –  fade to black and back, with a callback at full black
// ─────────────────────────────────────────────
// Covers a change the player shouldn't watch happen — going to sleep swaps
// the morning for the next night:
//
//   fade.play(() => controller.sleep());
//
// Wraps the #fade element in index.html (the markup and the `is-dark`
// style live there, like the other overlays). The transition's duration is
// set from here, so it always matches the timers. Without a DOM the
// callback runs at once, so gameplay code needs no branch for tests.
// ─────────────────────────────────────────────

export class ScreenFade {
  /** True from play() until the screen is clear again. */
  playing = false;

  /**
   * @param {HTMLElement|null} [root]  Defaults to the page's #fade.
   * @param {object} [opts]
   * @param {number} [opts.fadeMs=700]  Each way.
   * @param {number} [opts.holdMs=500]  Time held at black.
   */
  constructor(
    root = typeof document !== 'undefined' ? document.getElementById('fade') : null,
    { fadeMs = 700, holdMs = 500 } = {},
  ) {
    this.root = root;
    this.fadeMs = fadeMs;
    this.holdMs = holdMs;
    if (root) root.style.transitionDuration = `${fadeMs}ms`;
  }

  /**
   * Fade out, call `onDark` at full black, hold, fade back in.
   * @param {() => void} [onDark]
   * @returns {boolean} false if a fade was already running (and `onDark` won't run)
   */
  play(onDark) {
    if (this.playing) return false;
    if (!this.root) {
      onDark?.();
      return true;
    }

    this.playing = true;
    this.root.classList.add('is-dark');
    setTimeout(() => {
      onDark?.();
      setTimeout(() => {
        this.root.classList.remove('is-dark');
        setTimeout(() => { this.playing = false; }, this.fadeMs);
      }, this.holdMs);
    }, this.fadeMs);
    return true;
  }

  /**
   * Cut to black at once, then fade up to the scene over `ms` — the way in
   * from the loading screen. The cut hides the loading screen being taken
   * away; the fade is the first thing the player sees.
   * @param {number} [ms=1500]
   * @param {() => void} [onDone]  Once the scene is fully clear.
   */
  fadeIn(ms = 1500, onDone) {
    if (!this.root) {
      onDone?.();
      return;
    }

    this.playing = true;
    const { style, classList } = this.root;
    style.transitionDuration = '0ms';
    classList.add('is-dark');

    // A tick for the black to be painted with no transition, before the
    // long one starts — removing the class in the same frame would just
    // run the fade from wherever the opacity was.
    setTimeout(() => {
      style.transitionDuration = `${ms}ms`;
      classList.remove('is-dark');
      setTimeout(() => {
        style.transitionDuration = `${this.fadeMs}ms`;
        this.playing = false;
        onDone?.();
      }, ms);
    }, 30);
  }
}
