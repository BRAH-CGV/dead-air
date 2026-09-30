import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// ShadowRefresh  –  draw a light's shadow only when something in it moves
// ─────────────────────────────────────────────
// three redraws every shadow map every frame by default. For a light that
// never moves over a base that mostly never moves, that is wasted work: the
// office ceiling light is a PointLight, so its shadow is a cube map — six
// extra passes over the office every frame.
//
// This turns a light's `shadow.autoUpdate` off and asks for one redraw
// (`shadow.needsUpdate`) whenever a watched caster moves, turns or shows /
// hides. Watch everything that casts a shadow and can move: the monsters,
// the door panels, the dish. Anything it can't see (a prop added at run
// time) calls flag().
//
// The moon's own turning is Daylight's to flag (shouldRefreshShadow below):
// the light moves there, not the casters.
//
// Each caster's last world matrix and visibility are kept in one
// preallocated array; a frame compares 17 numbers per caster and allocates
// nothing.
// ─────────────────────────────────────────────

/**
 * Has a light turned far enough since its shadow was last drawn to need a
 * new one? Both are unit vectors; a zero `prevDir` (no shadow yet) always
 * does.
 * @param {THREE.Vector3} prevDir       The light's direction at the last draw.
 * @param {THREE.Vector3} dir           Its direction now.
 * @param {number}        thresholdRad
 */
export function shouldRefreshShadow(prevDir, dir, thresholdRad) {
  return prevDir.dot(dir) < Math.cos(thresholdRad);
}

/** Numbers kept per caster: its world matrix, then 1 / 0 for visible. */
const STRIDE = 17;

export class ShadowRefresh extends Component {
  /**
   * @param {object} opts
   * @param {THREE.Light[]} opts.lights           Shadow-casting lights to hold still.
   * @param {(THREE.Object3D|null)[]} [opts.casters]  What can move in them.
   */
  constructor({ lights, casters = [] }) {
    super();
    this.lights = lights;
    this.casters = [];
    this._last = new Float32Array(0);
    for (const light of lights) {
      light.shadow.autoUpdate = false;
      light.shadow.needsUpdate = true;
    }
    for (const caster of casters) this.watch(caster);
  }

  /** Watch one more caster, from where it is now. Null is skipped. */
  watch(object3d) {
    if (!object3d) return;
    const last = new Float32Array((this.casters.length + 1) * STRIDE);
    last.set(this._last);
    this._last = last;
    this.casters.push(object3d);
    this._changed(this.casters.length - 1);
  }

  onLateUpdate() {
    let moved = false;
    // No early exit: every snapshot has to catch up this frame.
    for (let i = 0; i < this.casters.length; i++) moved = this._changed(i) || moved;
    if (moved) this.flag();
  }

  /** Ask every light for one new shadow. */
  flag() {
    for (const light of this.lights) light.shadow.needsUpdate = true;
  }

  /** Back to three's default: every light redraws its shadow every frame. */
  release() {
    for (const light of this.lights) light.shadow.autoUpdate = true;
  }

  /** Has caster `i` moved or shown / hidden since the last look? Records
   *  where it is now either way. */
  _changed(i) {
    const object3d = this.casters[i];
    object3d.updateWorldMatrix(true, false);
    const m = object3d.matrixWorld.elements;
    const last = this._last;
    const at = i * STRIDE;
    let changed = false;
    for (let k = 0; k < 16; k++) {
      // Stored as 32-bit floats, so compare what was stored, not the double.
      const v = Math.fround(m[k]);
      if (last[at + k] !== v) { last[at + k] = v; changed = true; }
    }
    const visible = object3d.visible ? 1 : 0;
    if (last[at + 16] !== visible) { last[at + 16] = visible; changed = true; }
    return changed;
  }
}
