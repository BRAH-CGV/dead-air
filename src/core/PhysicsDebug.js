import * as THREE from 'three';

// ─────────────────────────────────────────────
// PhysicsDebug  –  see what Rapier actually thinks is there
// ─────────────────────────────────────────────
// Authoring a custom collider blind is guesswork: a UCX_ mesh exported with a
// stray transform, or a hand-typed box off by half its height, looks perfectly
// fine until you walk into thin air. This draws the collision world over the
// scene so the mismatch is obvious.
//
// `world.debugRender()` hands back a fresh line soup every call — every
// collider, in Rapier's own colours. We only ask for it while visible, so the
// overlay costs nothing when it's off.
// ─────────────────────────────────────────────

/** Grow the buffers past what we need so a few new bodies don't reallocate. */
const GROWTH = 1.5;

export class PhysicsDebug {
  /** @type {THREE.LineSegments} */
  lines;
  visible = false;

  /**
   * @param {THREE.Scene} scene
   * @param {RAPIER.World} world
   */
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geometry.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(0), 4));

    this.lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        // Colliders sit exactly on the surfaces they wrap, so z-fighting is
        // guaranteed. Drawing on top is the point of an overlay anyway.
        depthTest: false,
        transparent: true,
      }),
    );
    this.lines.frustumCulled = false;   // the buffer is world-space already
    this.lines.renderOrder = 999;
    this.lines.visible = false;

    scene.add(this.lines);
  }

  toggle() {
    this.visible = !this.visible;
    this.lines.visible = this.visible;
    return this.visible;
  }

  /** Call once per rendered frame, before `renderer.render`. */
  update() {
    if (!this.visible) return;

    const { vertices, colors } = this.world.debugRender();
    this._upload('position', vertices, 3);
    this._upload('color', colors, 4);
    this.lines.geometry.setDrawRange(0, vertices.length / 3);
  }

  /** Copy into the existing buffer, reallocating only when it's outgrown. */
  _upload(name, data, itemSize) {
    let attribute = this.lines.geometry.getAttribute(name);

    if (!attribute || attribute.array.length < data.length) {
      const capacity = Math.ceil(data.length * GROWTH);
      attribute = new THREE.BufferAttribute(new Float32Array(capacity), itemSize);
      attribute.setUsage(THREE.DynamicDrawUsage);
      this.lines.geometry.setAttribute(name, attribute);
    }

    attribute.array.set(data);
    attribute.needsUpdate = true;
  }

  dispose() {
    this.lines.removeFromParent();
    this.lines.geometry.dispose();
    this.lines.material.dispose();
  }
}
