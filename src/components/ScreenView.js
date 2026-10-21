import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { framePose, ScreenFocusMotion, SCREEN_FOCUS } from '../gameplay/ScreenFocus.js';
import { quadToCss } from '../ui/screenTransform.js';

// ─────────────────────────────────────────────
// ScreenView  –  leaning in to a screen, its overlay drawn on it (#161)
// ─────────────────────────────────────────────
// Using a computer leans the view in until its screen fills the frame, and
// the computer's overlay (the radar, the processing console) is laid onto
// the screen in the world, in its perspective, rather than thrown over the
// whole view. Closing it leans back out to the player's eyes, the picture
// fading as the screen shrinks away.
//
//   const view = new ScreenView({ engine });          // on GameplaySystems
//   view.open(surface, overlayRoot, { onSize });      // lean in
//   view.close(() => overlay.hide());                 // lean out, then …
//
// The view is a camera of its own handed to engine.viewCamera, as the
// buggy's send-off does: the player's camera keeps the ears and the
// interaction ray, and the controller that writes it every frame is left
// alone. The overlay is plain DOM: sized to the screen as it will be seen
// (so its text is drawn at the size it shows, not scaled up), put at the
// page's top left (`.on-screen` in index.html) and laid onto the screen's
// projected corners each frame with a matrix3d (screenTransform). The
// browser hit-tests through the transform, so its buttons still click.
//
// The rules are ScreenFocus (pure): where the camera stands, and the lean.
// ─────────────────────────────────────────────

/**
 * A screen in the world: its corners in an object's own space, read off
 * the model. [tl, tr, br, bl] as the screen is read.
 * @param {THREE.Object3D} object
 * @param {number[][]} corners  each [x, y, z], local to `object`
 */
export function screenSurface(object, corners) {
  const local = corners.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const world = local.map(() => new THREE.Vector3());
  return {
    object,
    /** The corners in the world, now. The same four vectors every call. */
    worldCorners() {
      object.updateWorldMatrix(true, false);
      for (let i = 0; i < 4; i++) world[i].copy(local[i]).applyMatrix4(object.matrixWorld);
      return world;
    },
  };
}

const _eyePos = new THREE.Vector3();
const _eyeQuat = new THREE.Quaternion();
const _ndc = new THREE.Vector3();

export class ScreenView extends Component {
  /** @param {{ engine: import('../core/Engine.js').Engine }} opts */
  constructor({ engine }) {
    super();
    this.engine = engine;
    this.motion = new ScreenFocusMotion();
    /** The camera the frame is drawn through while leaning in. */
    this._camera = new THREE.PerspectiveCamera(SCREEN_FOCUS.fov, 1, 0.02, 1000);
    /** Measures the screen as it will be seen, to size the overlay. */
    this._sizer = new THREE.PerspectiveCamera(SCREEN_FOCUS.fov, 1, 0.02, 1000);
    this._target = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    this._quad = [[0, 0], [0, 0], [0, 0], [0, 0]];
    this._surface = null;
    this._element = null;
    this._onSize = null;
    this._onClosed = null;
    this._size = [0, 0];
    this._fixedSize = null;
    this._viewport = [0, 0];
  }

  /** Leaning in, on the screen, or leaning back out. */
  get active() { return this.motion.active; }

  /**
   * Lean in to `surface` and lay `element` onto it.
   * @param {ReturnType<typeof screenSurface>} surface
   * @param {HTMLElement|null} element  the overlay's root
   * @param {{ onSize?: (width: number, height: number) => void, size?: number[] }} [opts]
   *        `onSize` is told the overlay's size in CSS pixels, as it opens and
   *        on a resize. `size` [width, height] keeps the overlay at a layout
   *        of its own, scaled onto the screen, for one that doesn't reflow
   *        (the processing console); left out, it is sized to the screen.
   */
  open(surface, element, { onSize = null, size = null } = {}) {
    if (this._element && this._element !== element) this._release();
    this._surface = surface;
    this._element = element;
    this._onSize = onSize;
    this._fixedSize = size;
    this._onClosed = null;
    element?.classList.add('on-screen');
    this._fit(true);
    this.engine.viewCamera = this._camera;
    this.motion.enter();
  }

  /** Lean back out to the eyes; `onClosed` once there. */
  close(onClosed = null) {
    if (!this.motion.active) { onClosed?.(); return; }
    this._onClosed = onClosed;
    this.motion.leave();
  }

  /** Straight back to the eyes, no lean: a kill or a new night wants the
   *  player's own view now. `close`'s callback still runs. */
  cut() {
    if (!this.motion.active) return;
    this.motion.cut();
    this._finish();
  }

  onLateUpdate(dt) {
    if (!this.motion.active || !this._surface) return;
    if (this.engine.debugCamera?.active) return;
    if (this.motion.update(this.engine.realDt ?? dt)) {
      this._finish();
      return;
    }
    this._fit(false);
    this._place();
    this._layOverlay();
  }

  onDestroy() {
    this.cut();
  }

  // ── Private ──

  get _width() { return this.engine.renderer?.domElement?.clientWidth || globalThis.innerWidth || 1; }
  get _height() { return this.engine.renderer?.domElement?.clientHeight || globalThis.innerHeight || 1; }

  /** Size the overlay to the screen as it is seen once leaned in (unless
   *  it keeps a size of its own). Only on opening and when the page
   *  changes size. */
  _fit(force) {
    const w = this._width, h = this._height;
    if (!force && w === this._viewport[0] && h === this._viewport[1]) return;
    this._viewport[0] = w;
    this._viewport[1] = h;
    if (this._fixedSize) {
      if (force) this._resize(this._fixedSize[0], this._fixedSize[1]);
      return;
    }
    const corners = this._surface.worldCorners();
    const pose = framePose(corners, { fov: SCREEN_FOCUS.fov, aspect: w / h }, this._target);
    const cam = this._sizer;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    cam.position.copy(pose.position);
    cam.quaternion.copy(pose.quaternion);
    cam.updateMatrixWorld();
    const [tl, tr, , bl] = corners.map((c, i) => this._toPage(c, cam, this._quad[i]));
    this._resize(Math.round(Math.hypot(tr[0] - tl[0], tr[1] - tl[1])),
      Math.round(Math.hypot(bl[0] - tl[0], bl[1] - tl[1])));
  }

  _resize(width, height) {
    this._size[0] = width;
    this._size[1] = height;
    const el = this._element;
    if (el) {
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
    }
    this._onSize?.(width, height);
  }

  /** The camera between the eye and the screen. The eye is read live, so
   *  leaning out lands wherever the player's view is by then. */
  _place() {
    const eye = this.engine.camera;
    const cam = this._camera;
    cam.aspect = eye.aspect;
    cam.near = Math.min(eye.near, 0.02);
    cam.far = eye.far;
    framePose(this._surface.worldCorners(), { fov: SCREEN_FOCUS.fov, aspect: eye.aspect }, this._target);
    eye.updateWorldMatrix(true, false);
    eye.getWorldPosition(_eyePos);
    eye.getWorldQuaternion(_eyeQuat);
    const t = this.motion.t;
    cam.position.lerpVectors(_eyePos, this._target.position, t);
    cam.quaternion.slerpQuaternions(_eyeQuat, this._target.quaternion, t);
    cam.fov = THREE.MathUtils.lerp(eye.fov, SCREEN_FOCUS.fov, t);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /** The overlay laid onto the screen's corners as the camera sees them. */
  _layOverlay() {
    const el = this._element;
    if (!el) return;
    const corners = this._surface.worldCorners();
    let behind = false;
    for (let i = 0; i < 4; i++) {
      this._toPage(corners[i], this._camera, this._quad[i]);
      if (_ndc.z > 1) behind = true;
    }
    if (behind) {
      el.style.opacity = '0';
      return;
    }
    el.style.transform = quadToCss(this._size[0], this._size[1], this._quad);
    el.style.opacity = String(+this.motion.reveal.toFixed(3));
  }

  /** A world point to page pixels through `camera`; leaves its NDC in _ndc. */
  _toPage(point, camera, out) {
    _ndc.copy(point).project(camera);
    out[0] = (_ndc.x + 1) / 2 * this._width;
    out[1] = (1 - _ndc.y) / 2 * this._height;
    return out;
  }

  /** Back at the eyes: the frame given back, the overlay let go. */
  _finish() {
    if (this.engine.viewCamera === this._camera) this.engine.viewCamera = null;
    this._release();
    const onClosed = this._onClosed;
    this._onClosed = null;
    this._surface = null;
    onClosed?.();
  }

  _release() {
    const el = this._element;
    if (el) {
      el.classList.remove('on-screen');
      el.style.transform = '';
      el.style.opacity = '';
      el.style.width = '';
      el.style.height = '';
    }
    this._element = null;
    this._onSize = null;
    this._fixedSize = null;
  }
}
