import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// SightlineZone  –  box volume a camera-entity AI can query (stub)
// ─────────────────────────────────────────────
// Phase 10 stub for the camera-entity sightline hook: a marker volume with
// no rendering and no physics collider, just a bounds check. Wire it up to
// the camera entity once that system exists — for now it only records
// where the watch area is.
// ─────────────────────────────────────────────

const _local = new THREE.Vector3();
const _inverse = new THREE.Matrix4();

export class SightlineZone extends GameObject {
  /** Box size, full metres: [width, height, depth]. */
  size = [1, 1, 1];

  /**
   * @param {string} [name]
   * @param {object} [opts]
   * @param {number[]} [opts.position]  Local position of the box centre
   * @param {number[]} [opts.size]      [width, height, depth]
   */
  constructor(name = 'SightlineZone', { position = [0, 0, 0], size } = {}) {
    super(name);
    this.object3d.position.set(...position);
    if (size) this.size = [...size];
  }

  /** Is the world-space point inside the box? Follows the zone's full
   *  world transform, room offset included.
   *  @param {THREE.Vector3} point */
  containsPoint(point) {
    this.object3d.updateWorldMatrix(true, false);
    _local.copy(point).applyMatrix4(_inverse.copy(this.object3d.matrixWorld).invert());
    const [w, h, d] = this.size;
    return Math.abs(_local.x) <= w / 2
        && Math.abs(_local.y) <= h / 2
        && Math.abs(_local.z) <= d / 2;
  }
}
