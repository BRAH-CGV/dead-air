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
//   • someone said so — invalidate(): a door shut, an occlusion zone swapped;
//   • a moving physics body moved — update(bodies) is handed the engine's
//     dynamic and kinematic bodies each frame, so a carried drive or a
//     knocked crate takes its shadow with it (#57) instead of leaving it
//     baked where it spawned. Only the maps it is in are redrawn: a light
//     with a range (`distance`) is left alone while the body moves beyond
//     it, so a drive carried across the office doesn't redraw the corridor
//     lamps (#87). Bodies at rest, and ones that cast no shadow (the
//     player), cost one matrix compare and redraw nothing.
//
// Per light (`light.shadow.autoUpdate`), not the renderer-wide switch, so a
// moving moon doesn't drag the static ceiling light along with it.
//
//   engine.shadows.adopt(scene);         // after the scene is built
//   engine.shadows.update(bodies);       // every frame, before render
//   engine.shadows.invalidate();         // something casting shadows changed
// ─────────────────────────────────────────────

const _pos = new THREE.Vector3();
const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _lightPos = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _sphere = new THREE.Sphere();

/** How far out a directional light's eye is put, for what it can see. */
const SUN_DISTANCE = 1000;

export class ShadowScheduler {
  /** Lights under management. @type {THREE.Light[]} */
  lights = [];

  /** What a light can see through the building (PortalCulling, #175), or
   *  null. With it, a moving body redraws only the maps of the lights that
   *  can see it, and a map is drawn without the casters its light can't
   *  see: behind a wall from the light, they would change nothing in it.
   *  @type {{ look(eye: THREE.Vector3): void, sees(sphere: THREE.Sphere): boolean,
   *           hideUnseenCasters?(): void, restore?(): void }|null} */
  visibility = null;

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
    /** Moving bodies seen by update(): object3d → { casts, last matrix }. */
    this._bodyPoses = new Map();
    /** Lights owed a redraw that were dark when it fell due (#175): drawn
     *  as they come on. A dark light's map shows nothing. */
    this._pending = new Set();
    this._due = [];
  }

  /** Take over every shadow-casting light under `root`. Each gets one render
   *  now, and from then on only when it needs one. */
  adopt(root) {
    root.traverse((o) => {
      if (!o.isLight || !o.castShadow || !o.shadow || this.lights.includes(o)) return;
      o.shadow.autoUpdate = false;
      this.lights.push(o);
      // Drawn now even if dark: three makes a map only as it first draws it.
      this._redraw(o, true);
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

  /** Call once a frame, before rendering.
   *  @param {Map<any, {object3d: THREE.Object3D}>} [bodies]  The moving bodies
   *         (Engine.rigidBodyMap): any shadow caster among them that moved
   *         redraws every map that reaches it. */
  update(bodies) {
    for (const light of this._pending) {
      if (!isLit(light)) continue;
      this._pending.delete(light);
      this._redraw(light, true);
    }
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

    if (bodies) this._followBodies(bodies);
  }

  /** Hand every light back to per-frame shadow updates and forget it. */
  release() {
    for (const light of this.lights) light.shadow.autoUpdate = true;
    this.lights.length = 0;
    this.visibility = null;
    this._pending.clear();
    this._lastPose.clear();
    this._watched.clear();
    this._bodyPoses.clear();
  }

  // ── Internals ─────────────────────────────

  /** Redraw the maps of every shadow-casting body that moved past
   *  `distance` since they were last drawn for it: those of the lights that
   *  reach where it was (so its old shadow goes) or where it is. A body seen
   *  for the first time is remembered and drawn where it is. */
  _followBodies(bodies) {
    for (const go of bodies.values()) {
      const object = go?.object3d;
      if (!object) continue;
      let pose = this._bodyPoses.get(object);
      if (!pose) {
        object.updateWorldMatrix(true, false);
        pose = { casts: castsShadow(object), reach: reachOf(object), last: object.matrixWorld.clone() };
        this._bodyPoses.set(object, pose);
        if (pose.casts) this._redrawReaching(_from.setFromMatrixPosition(pose.last), null, pose.reach);
        continue;
      }
      if (!pose.casts) continue;
      object.updateWorldMatrix(true, false);
      if (matrixMoved(pose.last, object.matrixWorld, this.distance)) {
        _from.setFromMatrixPosition(pose.last);
        _to.setFromMatrixPosition(object.matrixWorld);
        pose.last.copy(object.matrixWorld);
        this._redrawReaching(_from, _to, pose.reach);
      }
    }
  }

  /** Redraw every light that reaches a body `reach` metres round `from`, or
   *  round `to` if given. */
  _redrawReaching(from, to, reach) {
    for (const light of this.lights) {
      if (light.shadow.needsUpdate) continue;
      if (!(reaches(light, from, reach) || (to && reaches(light, to, reach)))) continue;
      if (this.visibility && !this._sees(light, from, to, reach)) continue;
      this._redraw(light);
    }
  }

  /** Can `light` see a body `reach` round `from` or `to`? */
  _sees(light, from, to, reach) {
    this.visibility.look(eyeOf(light, _eye));
    if (this.visibility.sees(_sphere.set(from, reach))) return true;
    return !!to && this.visibility.sees(_sphere.set(to, reach));
  }

  /**
   * Draw the shadow maps that are due, as three's shadowMap.render would,
   * but one light at a time, each without the casters it can't see (when
   * there is a visibility to ask). The engine routes three's call through
   * here. @param {(...args: any[]) => void} draw  three's own render
   */
  renderMaps(draw, ...args) {
    const visibility = this.visibility;
    const due = this._due;
    due.length = 0;
    if (visibility?.hideUnseenCasters) {
      for (const light of this.lights) if (light.shadow.needsUpdate) due.push(light);
    }
    if (due.length === 0) return draw(...args);
    for (const light of due) light.shadow.needsUpdate = false;
    for (const light of due) {
      light.shadow.needsUpdate = true;
      visibility.look(eyeOf(light, _eye));
      visibility.hideUnseenCasters();
      try {
        draw(...args);
      } finally {
        visibility.restore();
      }
      light.shadow.needsUpdate = false;
    }
    due.length = 0;
  }

  _redraw(light, force = false) {
    if (!force && !isLit(light)) {
      this._pending.add(light);
      return;
    }
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

/** Does anything under `object` cast a shadow? Asked once per body. */
/** Whether `light` can light anything of a body within `reach` of `point`.
 *  A directional light, or one with no range, reaches everywhere; a point or
 *  spot light lights nothing past its `distance` (its shadow camera's far
 *  plane is set to it too). */
/** Lighting anything: a dark light's map shows nothing, so it can wait. */
function isLit(light) {
  return light.visible !== false && light.intensity > 0;
}

/** Where a light sees from: a point or spot light's position; a
 *  directional light's, put far out along its direction. */
function eyeOf(light, out) {
  light.updateWorldMatrix(true, false);
  out.setFromMatrixPosition(light.matrixWorld);
  if (!light.isDirectionalLight || !light.target) return out;
  light.target.updateWorldMatrix(true, false);
  _target.setFromMatrixPosition(light.target.matrixWorld);
  return out.sub(_target).normalize().multiplyScalar(SUN_DISTANCE).add(_target);
}

function reaches(light, point, reach) {
  if (light.isDirectionalLight || !(light.distance > 0)) return true;
  _lightPos.setFromMatrixPosition(light.matrixWorld);
  return _lightPos.distanceTo(point) <= light.distance + reach;
}

/** How far a body's meshes reach from its origin: their bounding sphere,
 *  plus how far its centre sits off the origin. Measured once, when the
 *  body is first seen; a body doesn't change shape. */
function reachOf(object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return 0;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  return sphere.radius + sphere.center.distanceTo(_from.setFromMatrixPosition(object.matrixWorld));
}

function castsShadow(object) {
  let casts = false;
  object.traverse((o) => { if (o.isMesh && o.castShadow) casts = true; });
  return casts;
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
