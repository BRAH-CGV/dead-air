import * as THREE from 'three';

// ─────────────────────────────────────────────
// ShadowScheduler  –  render shadow maps when something changed, not every frame
// ─────────────────────────────────────────────
// docs/PERFORMANCE-PLAN.md §3. Every shadow-casting light re-renders its
// whole shadow map every frame by default — the office ceiling light is a
// point light, so that's six extra passes over the office, every frame, for
// a picture that never changes. This freezes each light's map and asks for
// a new one only when it would actually look different:
//
//   • the light itself moved — Daylight swings the moon across the night
//     sky, so its map is redrawn each time it has turned past `angle`
//     (a fraction of a degree), not on every one of the frames in between;
//   • a watched shadow caster moved — the satellite dish slewing;
//   • someone said so — invalidate(): a door shut, an occlusion zone swapped.
//
// Per light (`light.shadow.autoUpdate`), not the renderer-wide switch, so a
// moving moon doesn't drag the static ceiling light along with it.
//
//   engine.shadows.adopt(scene);         // after the scene is built
//   engine.shadows.update();             // every frame, before render
//   engine.shadows.invalidate();         // something casting shadows changed
// ─────────────────────────────────────────────

const _pos = new THREE.Vector3();
const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class ShadowScheduler {
  /** Lights under management. @type {THREE.Light[]} */
  lights = [];

  /**
   * @param {object} [opts]
   * @param {number} [opts.angle]     Radians a directional/spot light may turn
   *        before its map is redrawn. Default 0.25°: well under what a
   *        shadow edge visibly jumps by at the base's size.
   * @param {number} [opts.distance=0.01]  Metres a light or watched caster may move.
   */
  constructor({ angle = THREE.MathUtils.degToRad(0.25), distance = 0.01 } = {}) {
    this.angle = angle;
    this.distance = distance;
    /** Per light: where it was when its map was last drawn. */
    this._lastPose = new Map();
    /** Watched casters: object → { lights, last matrix }. */
    this._watched = new Map();
  }

  /** Take over every shadow-casting light under `root`. Each gets one render
   *  now, and from then on only when it needs one. */
  adopt(root) {
    root.traverse((o) => {
      if (!o.isLight || !o.castShadow || !o.shadow || this.lights.includes(o)) return;
      o.shadow.autoUpdate = false;
      this.lights.push(o);
      this._redraw(o);
    });
  }

  /** Redraw `lights` (default: all of ours) whenever `object` moves.
   *  @param {THREE.Object3D} object
   *  @param {THREE.Light[]} [lights] */
  watch(object, lights = this.lights) {
    object.updateWorldMatrix(true, false);
    this._watched.set(object, { lights: [...lights], last: object.matrixWorld.clone() });
  }

  /** Redraw every map on the next render. */
  invalidate() {
    for (const light of this.lights) this._redraw(light);
  }

  /** Call once a frame, before rendering. */
  update() {
    for (const light of this.lights) {
      if (light.shadow.needsUpdate) continue;
      if (this._moved(light)) this._redraw(light);
    }

    for (const [object, watch] of this._watched) {
      object.updateWorldMatrix(true, false);
      if (matrixMoved(watch.last, object.matrixWorld, this.distance)) {
        watch.last.copy(object.matrixWorld);
        for (const light of watch.lights) this._redraw(light);
      }
    }
  }

  /** Hand every light back to per-frame shadow updates and forget it. */
  release() {
    for (const light of this.lights) light.shadow.autoUpdate = true;
    this.lights.length = 0;
    this._lastPose.clear();
    this._watched.clear();
  }

  // ── Internals ─────────────────────────────

  _redraw(light) {
    light.shadow.needsUpdate = true;
    this._lastPose.set(light, poseOf(light));
  }

  _moved(light) {
    const last = this._lastPose.get(light);
    const now = poseOf(light, true);
    // A directional light's shadows depend on its direction alone; a point
    // or spot light's on where it stands too.
    if (!light.isDirectionalLight && now.position.distanceTo(last.position) > this.distance) return true;
    return !!(now.direction && last.direction) && now.direction.angleTo(last.direction) > this.angle;
  }
}

/**
 * Where a light is, as far as its shadow cares: a point light's position, a
 * directional or spot light's direction (light → target). A directional
 * light's shadow camera follows its target, so its direction is what moves
 * the shadows.
 * @param {boolean} [scratch]  Reuse module vectors — for a comparison only.
 */
function poseOf(light, scratch = false) {
  light.updateWorldMatrix(true, false);
  const position = (scratch ? _pos : new THREE.Vector3()).setFromMatrixPosition(light.matrixWorld);
  if (!light.target) return { position, direction: null };

  light.target.updateWorldMatrix(true, false);
  _target.setFromMatrixPosition(light.target.matrixWorld);
  const direction = (scratch ? _dir : new THREE.Vector3()).subVectors(position, _target).normalize();
  return { position, direction };
}

/** Has a world matrix changed by more than `distance` in translation, or
 *  at all in rotation/scale beyond float noise? */
function matrixMoved(a, b, distance) {
  const ea = a.elements;
  const eb = b.elements;
  for (let i = 0; i < 12; i++) {
    if (Math.abs(ea[i] - eb[i]) > 1e-4) return true;
  }
  const dx = ea[12] - eb[12], dy = ea[13] - eb[13], dz = ea[14] - eb[14];
  return dx * dx + dy * dy + dz * dz > distance * distance;
}
