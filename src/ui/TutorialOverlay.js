// ─────────────────────────────────────────────
// TutorialOverlay  –  night 0's big words and arrow (#tutorial)
// ─────────────────────────────────────────────
// What the tutorial says (TutorialSteps' view) drawn over the game: a big
// title, a line under it, and an arrow at whatever the step is about. On
// screen, the arrow stands over the target and points down at it; off
// screen or behind, it is pinned to the edge nearest it and points the way
// to turn. While the computer is up the words shrink to a strip at the top
// (`compact`), out of the radar's way.
//
// The markup is built here, inside #tutorial; the styles live in
// index.html. Like the other overlays, this is the one place game code
// touches the element.
// ─────────────────────────────────────────────

import { withKeys } from './promptKeys.js';

/** In pixels: how high over an on-screen target the arrow stands, and how
 *  far in from the edge an off-screen one is pinned. */
export const ARROW = Object.freeze({ above: 46, margin: 56 });

/**
 * Where the arrow goes for a target projected to NDC.
 * @param {{ x: number, y: number, behind: boolean }} ndc  `behind` when the
 *        target is behind the camera (its projection is mirrored)
 * @param {number} width   The screen, in pixels
 * @param {number} height
 * @param {object} out     Written and returned: { x, y, angle, onScreen },
 *        x / y in pixels from the top left, angle in radians the way it
 *        points (screen y down: π/2 is straight down).
 */
export function placeArrow(ndc, width, height, out) {
  const onScreen = !ndc.behind && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
  out.onScreen = onScreen;
  if (onScreen) {
    out.x = (ndc.x + 1) / 2 * width;
    out.y = (1 - ndc.y) / 2 * height - ARROW.above;
    out.angle = Math.PI / 2;
    return out;
  }
  // Off screen: from the middle toward it (away from it, if behind).
  const flip = ndc.behind ? -1 : 1;
  let dx = flip * ndc.x * width / 2;
  let dy = -flip * ndc.y * height / 2;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) { dx = 0; dy = 1; }   // dead behind
  const reachX = width / 2 - ARROW.margin;
  const reachY = height / 2 - ARROW.margin;
  const scale = Math.min(
    Math.abs(dx) > 1e-9 ? reachX / Math.abs(dx) : Infinity,
    Math.abs(dy) > 1e-9 ? reachY / Math.abs(dy) : Infinity,
  );
  out.x = width / 2 + dx * scale;
  out.y = height / 2 + dy * scale;
  out.angle = Math.atan2(dy, dx);
  return out;
}

// A right-pointing arrow; the element is turned to point it.
const ARROW_SVG = '<svg viewBox="0 0 64 40" width="64" height="40" aria-hidden="true">'
  + '<path d="M2 14h36V2l24 18-24 18V26H2z"/></svg>';

export class TutorialOverlay {
  /**
   * @param {HTMLElement|null} [root]  #tutorial
   * @param {{ keyLabel?: (text: string) => string }} [opts]
   */
  constructor(root = (typeof document !== 'undefined' ? document.getElementById('tutorial') : null),
    { keyLabel = withKeys } = {}) {
    this.root = root;
    this.keyLabel = keyLabel;
    this._title = null;
    this._text = null;
    this._compact = null;
    this._arrowShown = null;
    if (!root) return;
    root.innerHTML = '<div class="tutorial-card"><div class="tutorial-title"></div>'
      + '<div class="tutorial-text"></div></div>'
      + `<div class="tutorial-arrow"><div class="tutorial-arrow-bob">${ARROW_SVG}</div></div>`;
    this.titleEl = root.querySelector('.tutorial-title');
    this.textEl = root.querySelector('.tutorial-text');
    this.arrowEl = root.querySelector('.tutorial-arrow');
    this.hide();
  }

  /** @param {{ title: string, text: string, compact: boolean }} view */
  show(view) {
    if (!this.root) return;
    this.root.style.display = '';
    if (view.title !== this._title) {
      this._title = view.title;
      this.titleEl.textContent = view.title;
    }
    const text = this.keyLabel(view.text);
    if (text !== this._text) {
      this._text = text;
      this.textEl.textContent = text;
    }
    if (view.compact !== this._compact) {
      this._compact = view.compact;
      this.root.classList.toggle('compact', view.compact);
    }
  }

  /** @param {{ x: number, y: number, angle: number }|null} placement */
  setArrow(placement) {
    if (!this.arrowEl) return;
    const shown = !!placement;
    if (shown !== this._arrowShown) {
      this._arrowShown = shown;
      this.arrowEl.style.display = shown ? '' : 'none';
    }
    if (!shown) return;
    const deg = placement.angle * 180 / Math.PI;
    this.arrowEl.style.transform =
      `translate(${Math.round(placement.x)}px, ${Math.round(placement.y)}px) rotate(${Math.round(deg)}deg)`;
  }

  hide() {
    if (!this.root) return;
    this.root.style.display = 'none';
    this.setArrow(null);
  }
}
