// ─────────────────────────────────────────────
// EventBanner  –  centred on-screen event messages
// ─────────────────────────────────────────────
// Important events (a nap's alarm, the quota met, the shift ending) deserve
// more than the 11 px grey line in the top-right corner. The banner shows
// large readable text in the upper third of the screen, with a subtle dark
// backing for contrast, and fades in / holds / fades out.
//
// Markup and CSS live in index.html (#event-banner); this class is the
// single place game code touches the DOM. The timing logic (BannerTimer)
// is pure and unit-tested; a small component on GameplaySystems ticks it
// with engine.realDt, so a nap's 15× timeScale doesn't rush it and a
// pause holds it.
//
// scene.banner.show is the one way to show an event.
// ─────────────────────────────────────────────

import { withKeys } from './promptKeys.js';

/** Each fade (in and out) takes this many real seconds. */
export const BANNER_FADE = 0.3;
/** How long a banner message holds before it starts fading out. */
export const BANNER_DEFAULT_SECONDS = 4;

// ── BannerTimer (pure) ─────────────────────────────────────

/**
 * Pure timing logic for the banner. A component on GameplaySystems calls
 * update(realDt) each frame; the timer tracks whether the banner is visible
 * and fires onDone when the message has finished.
 *
 * Lifecycle: show() → visible (fade-in) → hold → fade-out → invisible → onDone.
 * A new show() replaces whatever is showing and resets the clock.
 */
export class BannerTimer {
  /**
   * @param {{ onDone?: () => void }} [opts]
   */
  constructor({ onDone } = {}) {
    this._seconds = 0;
    this._elapsed = 0;
    this._showing = false;
    this._doneFired = true;   // true = idle, no callback pending
    this.onDone = onDone ?? null;
  }

  /** Whether the banner is currently visible (fading in or holding). */
  get visible() { return this._showing && this._elapsed < this._totalDuration(); }

  /** The text currently showing, or ''. */
  get text() { return this._text; }
  _text = '';

  /** The current tone, or 'info'. */
  get tone() { return this._tone; }
  _tone = 'info';

  /** Show a message. Replaces whatever is currently showing.
   *  @param {string} text
   *  @param {{ seconds?: number, tone?: string }} [opts] */
  show(text, { seconds = BANNER_DEFAULT_SECONDS, tone = 'info' } = {}) {
    this._text = text;
    this._tone = tone;
    this._seconds = seconds;
    this._elapsed = 0;
    this._showing = true;
    this._doneFired = false;
  }

  /** Hide the banner at once. */
  clear() {
    this._showing = false;
    this._text = '';
    this._tone = 'info';
    this._elapsed = 0;
    this._fireDone();
  }

  /** Advance the timer by dt real seconds. */
  update(dt) {
    if (!this._showing) return;
    this._elapsed += dt;
    if (this._elapsed >= this._totalDuration()) {
      this._showing = false;
      this._fireDone();
    }
  }

  _totalDuration() {
    return BANNER_FADE + this._seconds + BANNER_FADE;
  }

  _fireDone() {
    if (this._doneFired) return;
    this._doneFired = true;
    this.onDone?.();
  }
}

// ── EventBanner (DOM) ──────────────────────────────────────

/**
 * The DOM wrapper. Takes the #event-banner root element (or null for tests)
 * and a keyLabel function (defaults to withKeys so [E] shows the bound key).
 *
 * show(text, opts) sets the text, applies the tone, and starts the timer.
 * clear() hides the banner.
 */
export class EventBanner {
  /**
   * @param {HTMLElement|null} [root]
   * @param {{ keyLabel?: (text: string) => string, timer?: BannerTimer } & { onDone?: () => void }} [opts]
   */
  constructor(root = typeof document !== 'undefined' ? document.getElementById('event-banner') : null, { keyLabel = withKeys, timer, onDone } = {}) {
    this.root = root;
    this.keyLabel = keyLabel;
    this._textEl = root?.querySelector('#event-banner-text') ?? null;
    this.timer = timer ?? new BannerTimer({ onDone });
    if (onDone && timer) timer.onDone = onDone;
  }

  /** Show an event message.
   *  @param {string} text
   *  @param {{ seconds?: number, tone?: 'info'|'warning'|'danger' }} [opts] */
  show(text, opts) {
    this.timer.show(text, opts);
    if (!this.root) return;
    if (this._textEl) this._textEl.textContent = text ? this.keyLabel(text) : '';
    if (this.root) this.root.dataset.tone = opts?.tone ?? 'info';
    this.root.classList.add('is-shown');
  }

  /** Hide the banner. */
  clear() {
    this.timer.clear();
    if (!this.root) return;
    if (this._textEl) this._textEl.textContent = '';
    this.root.classList.remove('is-shown');
  }
}
