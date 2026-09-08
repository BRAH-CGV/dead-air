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
  /** Marker for group nodes (no mesh, no physics, just a container). */
  isGroup = false;

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

  /** Return all descendants (depth-first) including self. */
  descendants() {
    const result = [this];
    for (const c of this.children) {
      if (typeof c.descendants === 'function') {
        result.push(...c.descendants());
      } else {
        result.push(c);
      }
    }
    return result;
  }

  /** Convert this node into a group (strip render/physics, keep hierarchy). */
  makeGroup() {
    this.isGroup = true;
    return this;
  }

  /** Reparent: move this object under a new parent, preserving world transform. */
  reparentUnder(newParent) {
    // Capture world position before reparenting
    const worldPos = new THREE.Vector3();
    this.object3d.getWorldPosition(worldPos);

    // Remove from current parent
    if (this.parent) this.parent.removeChild(this);

    // Add to new parent
    newParent.addChild(this);

    // Recalculate local position so world position is unchanged
    newParent.object3d.updateWorldMatrix(true, false);
    const parentWorldInverse = new THREE.Matrix4();
    parentWorldInverse.copy(newParent.object3d.matrixWorld).invert();
    const localPos = worldPos.applyMatrix4(parentWorldInverse);
    this.object3d.position.copy(localPos);

    return this;
  }

  // ── Lifecycle propagation ─────────────────

  _init(scene, world) {
    this.scene = scene;
    this.world = world;
    // Only add to the Three.js scene if this object has no GameObject parent.
    // Children inherit their scene-graph position through the parent's object3d;
    // calling scene.add() on them would detach them from their parent (Three.js
    // automatically removes an Object3D from its previous parent on add).
    if (!this.parent) scene.add(this.object3d);
    for (const c of this.components) c.onAwake();
    for (const ch of this.children) ch._init(scene, world);
  }

  _update(dt) {
    if (!this._started) {
      this._started = true;
      for (const c of this.components) c.onStart();
    }
    for (const c of this.components) {
      if (c.enabled) c.onUpdate(dt);
    }
    for (const ch of this.children) ch._update(dt);
  }

  _fixedUpdate(dt) {
    for (const c of this.components) {
      if (c.enabled) c.onFixedUpdate(dt);
    }
    for (const ch of this.children) ch._fixedUpdate(dt);
  }

  _lateUpdate(dt) {
    for (const c of this.components) {
      if (c.enabled) c.onLateUpdate(dt);
    }
    for (const ch of this.children) ch._lateUpdate(dt);
  }
}
