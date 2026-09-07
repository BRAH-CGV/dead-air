import * as THREE from 'three';

// ─────────────────────────────────────────────
// GameObject  –  Scene-graph node
// ─────────────────────────────────────────────
// Wraps a THREE.Object3D and an optional RAPIER.RigidBody.
// Children form a hierarchy; lifecycle calls propagate downward.
// ─────────────────────────────────────────────

export class GameObject {
  /** @type {string} */
  name;
  /** @type {THREE.Object3D} */
  object3d;
  /** @type {RAPIER.RigidBody|null} */
  rigidBody = null;
  /** Shorthand for `colliders[0]` — most objects have exactly one.
   *  @type {RAPIER.Collider|null} */
  collider = null;
  /** A compound shape is just a body owning several colliders; Rapier has no
   *  separate compound type. Kept so teardown and queries can reach them all.
   *  @type {RAPIER.Collider[]} */
  colliders = [];
  /** @type {import('./Component').Component[]} */
  components = [];
  /** @type {GameObject[]} */
  children = [];
  /** @type {GameObject|null} */
  parent = null;
  /** @type {THREE.Scene|null} */
  scene = null;
  /** @type {RAPIER.World|null} */
  world = null;

  _started = false;

  constructor(name = 'GameObject') {
    this.name = name;
    this.object3d = new THREE.Object3D();
    this.object3d.name = name;
  }

  // ── Component management ──────────────────

  addComponent(component) {
    component.gameObject = this;
    this.components.push(component);
    return component;
  }

  removeComponent(component) {
    const i = this.components.indexOf(component);
    if (i !== -1) {
      this.components[i].onDestroy();
      this.components[i].gameObject = null;
      this.components.splice(i, 1);
    }
  }

  /** First component matching the class constructor, or null. */
  getComponent(Type) {
    return this.components.find(c => c instanceof Type) ?? null;
  }

  // ── Hierarchy ─────────────────────────────

  addChild(child) {
    if (child.parent) child.parent.removeChild(child);
    child.parent = this;
    this.children.push(child);
    this.object3d.add(child.object3d);
    return child;
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i !== -1) {
      this.children.splice(i, 1);
      this.object3d.remove(child.object3d);
      child.parent = null;
    }
  }

  /** Depth-first search by name. */
  find(name) {
    if (this.name === name) return this;
    for (const c of this.children) {
      const found = c.find(name);
      if (found) return found;
    }
    return null;
  }

  // ── Lifecycle propagation ─────────────────

  _init(scene, world) {
    this.scene = scene;
    this.world = world;
    scene.add(this.object3d);
    for (const c of this.components) c.onAwake();
    for (const ch of this.children) ch._init(scene, world);
  }

  _update(dt) {
    if (!this._started) {
      this._started = true;
      for (const c of this.components) c.onStart();
    }
    for (const c of this.components) c.onUpdate(dt);
    for (const ch of this.children) ch._update(dt);
  }

  _fixedUpdate(dt) {
    for (const c of this.components) c.onFixedUpdate(dt);
    for (const ch of this.children) ch._fixedUpdate(dt);
  }

  _lateUpdate(dt) {
    for (const c of this.components) c.onLateUpdate(dt);
    for (const ch of this.children) ch._lateUpdate(dt);
  }
}
