import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// Door  –  doorway between rooms, lockable per night
// ─────────────────────────────────────────────
// One box-shaped collider filling the doorway. Unlocked it is a sensor —
// the player walks through (the character controller excludes sensors) and
// RoomTransitionSystem notices the overlap. Locked it turns solid and a
// door panel appears, so the doorway is physically closed.
//
// Overlap is tested geometrically with containsPoint() rather than through
// Rapier intersection events: fixed-vs-kinematic pairs aren't reported by
// default, and a point-in-box test needs no WASM to unit-test.
//
// Room.addDoor creates these. For a door model later, spawn with
// `engine.spawnModel('model:door-interior', { type: Door })` — the model
// becomes the visual and the procedural panel is dropped.
// ─────────────────────────────────────────────

const _local = new THREE.Vector3();
const _inverse = new THREE.Matrix4();

export class Door extends GameObject {
  /** Name of the room this door leads to. @type {string|null} */
  targetRoom = null;

  /** Doorway box, full metres: [width, height, depth]. */
  doorSize = [1, 2.2, 0.2];

  /** Shown by RoomTransitionSystem while the player is at a locked door. */
  lockedPrompt = 'Locked';

  /** Procedural panel, visible only while locked. @type {THREE.Mesh|null} */
  panel = null;

  _locked = false;

  /**
   * @param {string} [name]
   * @param {object} [opts]
   * @param {number[]} [opts.size]         [width, height, depth] of the doorway
   * @param {string}   [opts.targetRoom]
   * @param {boolean}  [opts.locked=false]
   * @param {string}   [opts.lockedPrompt]
   */
  constructor(name = 'Door', { size, targetRoom = null, locked = false, lockedPrompt } = {}) {
    super(name);
    if (size) this.doorSize = [...size];
    this.targetRoom = targetRoom;
    if (lockedPrompt) this.lockedPrompt = lockedPrompt;
    this._buildPanel();
    this.locked = locked;
  }

  /** Wrap a door model. The model is the visual, so the procedural panel
   *  built by the constructor is freed. */
  static fromObject3D(obj) {
    const door = super.fromObject3D(obj);
    door._disposePanel();
    return door;
  }

  get locked() { return this._locked; }

  set locked(value) {
    this._locked = !!value;
    if (this.panel) this.panel.visible = this._locked;
    this.collider?.setSensor(!this._locked);
  }

  /** Create the doorway body and collider. The door has no physics parent,
   *  so it takes the world pose explicitly (the room offset included).
   *  @param {RAPIER.World} world
   *  @param {number[]} worldPos  Centre of the doorway box
   *  @param {number} [rotY=0]    Yaw — π/2 for doors in side walls */
  attachCollider(world, worldPos, rotY = 0) {
    const [w, h, d] = this.doorSize;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(...worldPos)
        .setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) }),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setSensor(!this._locked),
      body,
    );
    this.rigidBody = body;
    this.collider  = collider;
    this.colliders = [collider];
    return collider;
  }

  /** Is the world-space point inside the doorway box, grown by `margin` on
   *  every side? Follows the door's full world transform, parents included.
   *  @param {THREE.Vector3} point
   *  @param {number} [margin=0] */
  containsPoint(point, margin = 0) {
    this.object3d.updateWorldMatrix(true, false);
    _local.copy(point).applyMatrix4(_inverse.copy(this.object3d.matrixWorld).invert());
    const [w, h, d] = this.doorSize;
    return Math.abs(_local.x) <= w / 2 + margin
        && Math.abs(_local.y) <= h / 2 + margin
        && Math.abs(_local.z) <= d / 2 + margin;
  }

  /** Called by RoomTransitionSystem when the player reaches the doorway
   *  (for a locked door: its approach zone). Override per door. */
  onPlayerEnter(_player) {}

  /** Called when the player leaves the doorway zone. */
  onPlayerExit(_player) {}

  /** Free the panel's GPU resources. Physics is the owner's to remove. */
  dispose() {
    this._disposePanel();
  }

  _buildPanel() {
    const [w, h, d] = this.doorSize;
    // Half the wall depth: recessed in the opening, so its faces never sit
    // flush with the wall surfaces around it.
    this.panel = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d * 0.5),
      new THREE.MeshStandardMaterial({ color: 0x3a3f44, metalness: 0.6, roughness: 0.5 }),
    );
    this.panel.name = 'DoorPanel';
    this.panel.castShadow = this.panel.receiveShadow = true;
    this.object3d.add(this.panel);
  }

  _disposePanel() {
    if (!this.panel) return;
    this.panel.removeFromParent();
    this.panel.geometry.dispose();
    this.panel.material.dispose();
    this.panel = null;
  }
}
