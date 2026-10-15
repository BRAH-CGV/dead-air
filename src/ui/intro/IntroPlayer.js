import { beatAt, captionAlpha, captionFor, arrayLabel, INTRO_SECONDS } from './IntroTimeline.js';
import { drawIntro, makeStars } from './introDraw.js';

// ─────────────────────────────────────────────
// IntroPlayer  –  the intro on the page (#intro in index.html)
// ─────────────────────────────────────────────
// Runs IntroTimeline's clock on animation frames, paints each frame with
// introDraw onto a full-screen canvas, and puts the beat's caption over
// it. At the end it holds a card naming the array the player is posted to
// until they begin.
//
// It knows nothing of the menus: App opens it for New game and hands it
// `onBegin`, which must run inside the click or key that begins (the
// pointer lock needs that gesture). advance() is the one input: it skips
// to the end card, and on the card it begins — once the card has been up
// BEGIN_DELAY, so a double click that skips doesn't run straight on into
// the shift.
// ─────────────────────────────────────────────

/** Seconds the end card is up before a click begins. */
export const BEGIN_DELAY = 0.4;

/** The longest step the clock takes in one frame: a hidden tab stops
 *  the frames, and coming back mustn't jump beats. */
const MAX_STEP = 0.1;

const BEGIN_TEXT = 'CLICK TO BEGIN YOUR SHIFT';
const SKIP_TEXT = 'SPACE / CLICK skip · ESC back';

export class IntroPlayer {
  /** The player for the page's #intro, or null on a page without one. */
  static fromDocument(doc, opts) {
    const root = doc.getElementById('intro');
    return root ? new IntroPlayer(root, opts) : null;
  }

  /**
   * @param {HTMLElement} root  Emptied and filled with the intro's parts
   * @param {object} [opts]
   * @param {(cb: FrameRequestCallback) => number} [opts.raf]
   * @param {(id: number) => void} [opts.caf]
   * @param {() => number} [opts.now]  Milliseconds
   * @param {() => number} [opts.random]
   * @param {(canvas: HTMLCanvasElement) => CanvasRenderingContext2D|null} [opts.context]
   * @param {() => void} [opts.onBegin]  Called inside the begin gesture
   */
  constructor(root, {
    raf = (cb) => requestAnimationFrame(cb),
    caf = (id) => cancelAnimationFrame(id),
    now = () => performance.now(),
    random = Math.random,
    context = (canvas) => canvas.getContext('2d'),
    onBegin = null,
  } = {}) {
    this.root = root;
    this._raf = raf;
    this._caf = caf;
    this._now = now;
    this._random = random;
    this._context = context;
    this.onBegin = onBegin;

    /** Seconds into the intro. */
    this.time = 0;
    /** The array named in the story and on the end card. */
    this.array = '';
    this.playing = false;

    this._frameId = 0;
    this._last = 0;
    this._ctx = undefined;          // fetched on first draw
    this._captionIndex = -1;
    this._info = { index: 0, id: '', beat: null, local: 0, progress: 0 };
    this._scene = { stars: makeStars(160, random), array: '' };

    root.replaceChildren();
    root.hidden = true;
    this.canvas = this._el('canvas', 'intro-canvas');
    this.caption = this._el('div', 'intro-caption');
    this.card = this._el('div', 'intro-card');
    this.card.hidden = true;
    this._cardArray = this._el('div', 'intro-array', this.card);
    this._cardBegin = this._el('div', 'intro-begin', this.card);
    this._cardBegin.textContent = BEGIN_TEXT;
    this._cardHint = this._el('div', 'intro-hint', this.card);
    this._skip = this._el('div', 'intro-skip');
    this._skip.textContent = SKIP_TEXT;

    root.addEventListener('click', this._onClick);
  }

  /** On the end card. */
  get atEnd() { return this.time >= INTRO_SECONDS; }

  /** From the top, with a new array. */
  play() {
    this.stop();
    this.time = 0;
    this.array = arrayLabel(this._random);
    this._scene.array = this.array;
    this._cardArray.textContent = this.array;
    this._captionIndex = -1;
    this.setHint('');
    this.playing = true;
    this.root.hidden = false;
    this._last = this._now();
    this._draw();
    this._frameId = this._raf(this._frame);
  }

  /** Hide it and stop the frames. */
  stop() {
    if (this._frameId) this._caf(this._frameId);
    this._frameId = 0;
    this.playing = false;
    this.root.hidden = true;
  }

  /** Straight to the end card. */
  skip() {
    if (!this.playing || this.atEnd) return;
    this.time = INTRO_SECONDS;
    this._draw();
  }

  /** The player's one input: skip the story, or begin from the end card. */
  advance() {
    if (!this.playing) return;
    if (!this.atEnd) {
      this.skip();
      return;
    }
    if (this.time < INTRO_SECONDS + BEGIN_DELAY) return;
    this.setHint('');
    this.onBegin?.();
  }

  /** A line under the end card's call to begin (a refused pointer lock). */
  setHint(text) {
    this._cardHint.textContent = text;
  }

  dispose() {
    this.stop();
    this.root.removeEventListener('click', this._onClick);
  }

  _onClick = () => this.advance();

  _frame = () => {
    this._frameId = this._raf(this._frame);
    const t = this._now();
    this.time += Math.min(MAX_STEP, Math.max(0, (t - this._last) / 1000));
    this._last = t;
    this._draw();
  };

  _draw() {
    const info = beatAt(this.time, this._info);
    const { beat } = info;

    if (info.index !== this._captionIndex) {
      this._captionIndex = info.index;
      this.caption.textContent = captionFor(beat, this.array);
    }
    this.caption.style.opacity = String(captionAlpha(info.local, beat.seconds));
    const end = this.atEnd;
    this.card.hidden = !end;
    this._skip.hidden = end;

    const ctx = this._ctx === undefined ? (this._ctx = this._context(this.canvas) ?? null) : this._ctx;
    if (!ctx) return;
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    if (!w || !h) return;
    const pw = Math.round(w * ratio), ph = Math.round(h * ratio);
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawIntro(ctx, w, h, info, this._scene);
  }

  _el(tag, className, parent = this.root) {
    const el = parent.ownerDocument.createElement(tag);
    el.className = className;
    parent.appendChild(el);
    return el;
  }
}
