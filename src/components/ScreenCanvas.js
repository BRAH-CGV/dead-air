import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { screenMesh } from './ScreenView.js';
import { createScreenMaterial } from '../gameobjects/ScreenGlass.js';

// ─────────────────────────────────────────────
// ScreenCanvas  –  a screen's own picture, painted in 2D (#161)
// ─────────────────────────────────────────────
// What a computer's screen shows, the same whether the player is leaned in
// to it or across the room: its overlay's DOM, painted into a canvas
// (`painter`, paintDom) and shown on a quad over the screen. Leaned in
// (`focused()`), the same picture is painted closeFps times a second at the
// overlay's own layout size, so it is sharp up close; otherwise a small one a few
// times a second, and only while `seen()` — each repaint is uploaded to the
// GPU, so from another room it costs nothing.
//
//   gameplay.addComponent(new ScreenCanvas({
//     surface, layout: [w, h], painter: (ctx, w, h) => paintDom(root, ctx, w, h),
//     seen: () => …, focused: () => view.holds(surface),
//   }));
//
// The quad's shader wears the screen's glass — scanlines, a darker edge,
// the rounded corners (ScreenGlass, as the camera monitor's does) — so a
// repaint is only the overlay's own picture. Unlit and not tone mapped: the
// screen glows at the colours painted. With `quad: false` it is a texture
// only, for another screen's shader to lay over its own picture (the camera
// feed's overlay, FeedDisplay).
// ─────────────────────────────────────────────

export const SCREEN_CANVAS = {
  /** Rows of the picture from across the room; its width follows the
   *  overlay's shape. Leaned in, it is the overlay's own layout size. */
  height: 384,
  /** Repaints a second from across the room, while it can be seen. */
  fps: 10,
  /** Repaints a second leaned in: smooth enough for a cursor and a slider,
   *  half the cost of every frame. */
  closeFps: 30,
};

const defaultCanvas = () => (typeof document !== 'undefined' ? document.createElement('canvas') : null);

export class ScreenCanvas extends Component {
  /**
   * @param {object} opts
   * @param {ReturnType<typeof import('./ScreenView.js').screenSurface>} [opts.surface]
   *        The screen to lay the quad on (none with `quad: false`).
   * @param {(ctx: CanvasRenderingContext2D, width: number, height: number) => void} opts.painter
   * @param {number[]} opts.layout  The overlay's layout size, [width, height] CSS px.
   * @param {() => boolean} [opts.seen]     Worth repainting: someone can see it.
   * @param {() => boolean} [opts.focused]  The view is leaned in to it.
   * @param {number} [opts.corner]  The screen's corner radius, a share of its height.
   * @param {number} [opts.lift]    Off the glass, in the surface object's units.
   * @param {boolean} [opts.quad]   Show it on a quad over `surface`.
   * @param {string} [opts.colorSpace]
   * @param {() => HTMLCanvasElement|null} [opts.createCanvas]
   */
  constructor({
    surface = null, painter, layout, seen = () => true, focused = () => false,
    corner = 0, lift = 0, quad = true, colorSpace = THREE.SRGBColorSpace, createCanvas = defaultCanvas,
  }) {
    super();
    this.painter = painter;
    this.layout = layout;
    this.seen = seen;
    this.focused = focused;
    this._since = 0;
    this._detail = null;

    this.canvas = createCanvas();
    this._ctx = this.canvas?.getContext('2d') ?? null;
    this.texture = null;
    if (this.canvas) {
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.colorSpace = colorSpace;
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.generateMipmaps = false;
      this._setDetail('idle');
    }
    this.material = null;
    this.mesh = null;
    if (quad && surface) {
      this.material = createScreenMaterial({ picture: this.texture, aspect: layout[0] / layout[1], corner });
      this.mesh = screenMesh(surface, this.material, { lift });
    }
  }

  onStart() {
    this._paint();
  }

  onUpdate(dt) {
    // The glass's scanlines crawl, whether or not the picture is repainted.
    if (this.material) this.material.uniforms.uTime.value += dt;
    if (!this.canvas) return;
    const detail = this.focused() ? 'close' : 'idle';
    if (detail !== this._detail) {
      this._setDetail(detail);
      this._paint();
      return;
    }
    this._since += dt;
    const close = detail === 'close';
    if (this._since + 1e-6 < 1 / (close ? SCREEN_CANVAS.closeFps : SCREEN_CANVAS.fps)) return;
    if (!close && !this.seen()) return;
    this._since = 0;
    this._paint();
  }

  onDestroy() {
    this.mesh?.removeFromParent();
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.texture?.dispose();
  }

  /** 'idle': small; 'close': the overlay's own size. A new size is a new
   *  texture on the GPU. */
  _setDetail(detail) {
    this._detail = detail;
    const [lw, lh] = this.layout;
    const height = detail === 'close' ? lh : SCREEN_CANVAS.height;
    const width = detail === 'close' ? lw : Math.round(SCREEN_CANVAS.height * lw / lh);
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.texture.dispose();
  }

  _paint() {
    const ctx = this._ctx;
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    this.painter(ctx, w, h);
    ctx.restore();
    this.texture.needsUpdate = true;
  }
}
