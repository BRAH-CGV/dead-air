import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { framePose, ScreenFocusMotion, SCREEN_FOCUS } from '../gameplay/ScreenFocus.js';
import { quadToCss } from '../ui/screenTransform.js';

// ─────────────────────────────────────────────
// ScreenView  –  leaning in to a screen (#161)
// ─────────────────────────────────────────────
// Using a computer leans the view in until its screen fills the frame;
// closing it leans back out to the player's eyes. What is on the screen is
// the screen's own picture (ScreenCanvas, FeedDisplay), the same leaned in
// or not: this only moves the view, and lays the overlay's DOM — invisible
// on the page (`.on-screen` in index.html) — onto the screen, so the clicks
// and drags land on it. The browser hit-tests through the transform, and
// the picture paints the DOM's hover states and slider values.
//
//   const view = new ScreenView({ engine });   // on GameplaySystems
//   view.open(surface, overlayRoot);          // lean in
//   view.close(() => overlay.hide());         // lean out, then …
//
// The view is a camera of its own handed to engine.viewCamera, as the
// buggy's send-off does: the player's camera keeps the ears and the
// interaction ray, and the controller that writes it every frame is left
// alone. The overlay keeps the layout size it was given (BaseScene) and is
// laid onto the screen's projected corners each frame with a matrix3d
// (screenTransform); `.is-focused` lets it take the mouse meanwhile.
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
    /** The corners in the object's own space. */
    local,
    /** The corners in the world, now. The same four vectors every call. */
    worldCorners() {
      object.updateWorldMatrix(true, false);
      for (let i = 0; i < 4; i++) world[i].copy(local[i]).applyMatrix4(object.matrixWorld);
      return world;
    },
  };
}

/**
 * A quad over a screen, on its object: what the screen shows when nobody is
 * leaning in to it (a live camera feed, the radar). Its uv runs the way the
 * screen is read, (0, 1) at the top left. `lift` stands it off the glass
 * along the screen's normal, in the object's own units, so it never sinks
 * into a curved face.
 * @param {ReturnType<typeof screenSurface>} surface
 * @param {THREE.Material} material
 * @param {{ lift?: number }} [opts]
 */
export function screenMesh(surface, material, { lift = 0 } = {}) {
  const [tl, tr, br, bl] = surface.local;
  const normal = new THREE.Vector3().crossVectors(
    new THREE.Vector3().subVectors(tr, tl), new THREE.Vector3().subVectors(tl, bl)).normalize();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(
    [tl, tr, br, bl].flatMap(c => c.clone().addScaledVector(normal, lift).toArray()), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  geometry.setIndex([0, 3, 2, 0, 2, 1]);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ScreenPicture';
  mesh.castShadow = mesh.receiveShadow = false;
  surface.object.add(mesh);
  return mesh;
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
    this._target = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    this._quad = [[0, 0], [0, 0], [0, 0], [0, 0]];
    this._surface = null;
    this._element = null;
    this._onClosed = null;
  }

  /** Leaning in, on the screen, or leaning back out. */
  get active() { return this.motion.active; }

  /** The view is on `surface`: leaning in to it, on it, or leaning out. */
  holds(surface) {
    return this.motion.active && this._surface === surface;
  }

  /**
   * Lean in to `surface`, with `element` on it to take the mouse.
   * @param {ReturnType<typeof screenSurface>} surface
   * @param {HTMLElement|null} element  the overlay's root
   */
  open(surface, element) {
    if (this._element && this._element !== element) this._release();
    this._surface = surface;
    this._element = element;
    this._onClosed = null;
    element?.classList.add('is-focused');
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
    this._place();
    this._layOverlay();
  }

  onDestroy() {
    this.cut();
  }

  // ── Private ──

  get _width() { return this.engine.renderer?.domElement?.clientWidth || globalThis.innerWidth || 1; }
  get _height() { return this.engine.renderer?.domElement?.clientHeight || globalThis.innerHeight || 1; }

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

  /** The overlay's DOM laid onto the screen's corners as the camera sees
   *  them, at the layout size it keeps. Left where it was while a corner
   *  is behind the camera (only mid-lean). */
  _layOverlay() {
    const el = this._element;
    if (!el) return;
    const corners = this._surface.worldCorners();
    for (let i = 0; i < 4; i++) {
      this._toPage(corners[i], this._camera, this._quad[i]);
      if (_ndc.z > 1) return;
    }
    const w = el.offsetWidth || parseFloat(el.style.width) || 1;
    const h = el.offsetHeight || parseFloat(el.style.height) || 1;
    el.style.transform = quadToCss(w, h, this._quad);
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
      el.classList.remove('is-focused');
      el.style.transform = '';
    }
    this._element = null;
  }
}
