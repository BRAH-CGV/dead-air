import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Pickupable } from '../components/Pickupable.js';

// ─────────────────────────────────────────────
// Drive  –  Physical hard drive (pickup-able small cube)
// ─────────────────────────────────────────────
// A small box representing a hard drive. Placed near the desk as a physics
// object the player can pick up and carry to the drive reader. When a signal
// is saved to it, the material turns green (later this will be an indicator
// light on a proper model).
//
// The drive is a dynamic physics body created in _init() (the engine
// lifecycle hook). Before _init it is a plain visual; after _init it has a
// rigid body, collider, and a Pickupable component so the player's
// PickupSystem can carry it. Gravity is on from the start: the drive rests
// on the floor (or desk) until picked up, and falls when dropped.
//
//   const drive = new Drive('Drive_1');
//   drive.object3d.position.set(1.2, 0.02, -2.0);
//   // After _init runs (engine lifecycle):
//   drive.setSaved(true);        // turns green
//   drive.enablePhysics();       // gravity on, rest damping (the default)
//   drive.disablePhysics();      // floats in place — scripted states
//   drive.makeKinematic();       // locked in place (e.g. in the reader)
//
// Owns its geometry and material; dispose() frees them.
// ─────────────────────────────────────────────

/** Default colour — dark grey plastic. */
const DEFAULT_COLOR = 0x3a3a3a;

/** Emissive colour when a signal has been saved — green indicator. */
const SAVED_EMISSIVE = 0x22cc44;
const SAVED_EMISSIVE_INTENSITY = 1.5;

export class Drive extends GameObject {
  /** @type {THREE.Mesh} */
  _mesh;
  /** @type {THREE.MeshStandardMaterial} */
  _material;

  /** Whether this drive currently shows the "saved" indicator. */
  saved = false;

  /**
   * @param {string} [name]
   * @param {object} [opts]
   * @param {number[]} [opts.size]  Full metres [w, h, d].
   */
  constructor(name = 'Drive', { size = [0.08, 0.02, 0.12] } = {}) {
    super(name);
    this._size = size;
    this._build();
  }

  // ── Lifecycle ──────────────────────────────────────────────

  /** Called by the engine when the scene graph initialises. Creates the
   *  dynamic rigid body and collider, registers with the engine maps, and
   *  attaches a Pickupable component. */
  _init(scene, world) {
    super._init(scene, world);

    const engine = scene.userData.engine;
    if (!engine?.RAPIER) return;
    const RAPIER = engine.RAPIER;
    // Use world position for the rigid body, since Rapier works in world space.
    // The drive's object3d.position is local (relative to the parent room), so
    // we must convert to world space before creating the body.
    const worldPos = new THREE.Vector3();
    this.object3d.getWorldPosition(worldPos);

    // Dynamic body with gravity — the drive rests where it is placed and
    // falls when dropped. Light damping on both axes so a nudge slides it
    // to a stop instead of spinning it forever; CCD keeps the thin, light
    // box from tunnelling through the floor when it is kicked or dropped.
    this.rigidBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(worldPos.x, worldPos.y, worldPos.z)
        .setLinearDamping(0.5)
        .setAngularDamping(1.0)
        .setGravityScale(1)
        .setCcdEnabled(true),
    );

    const halfSize = [this._size[0] / 2, this._size[1] / 2, this._size[2] / 2];
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(...halfSize)
        .setFriction(0.6)
        .setRestitution(0.1)
        .setDensity(800),
      this.rigidBody,
    );
    this.colliders = [this.collider];

    // Register with engine maps (same pattern as Engine._attachPhysics).
    engine._bodyToGO.set(this.rigidBody.handle, this);
    engine.rigidBodyMap.set(this.rigidBody.handle, this);

    // Mark as pickup-able.
    this.addComponent(new Pickupable());
  }

  // ── Physics helpers (used by PickupSystem / drive reader) ──

  /** Restore normal physics — gravity on, rest damping. The drive falls
   *  and settles (the default body state). */
  enablePhysics() {
    if (!this.rigidBody) return;
    this.rigidBody.setGravityScale(1, true);
    this.rigidBody.setLinearDamping(0.5, true);
    this.rigidBody.setAngularDamping(1.0, true);
  }

  /** Disable gravity and raise damping — the drive floats in place.
   *  A scripted-state helper; the normal resting state has gravity on. */
  disablePhysics() {
    if (!this.rigidBody) return;
    this.rigidBody.setGravityScale(0, true);
    this.rigidBody.setLinearDamping(5.0, true);
    this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Switch to a kinematic body — locked in place (e.g. inserted in reader). */
  makeKinematic() {
    if (!this.rigidBody || !this.world) return;
    const RAPIER = this.scene?.userData?.engine?.RAPIER;
    if (!RAPIER) return;
    const t = this.rigidBody.translation();
    const r = this.rigidBody.rotation();
    const engine = this.scene?.userData?.engine;
    const oldHandle = this.rigidBody.handle;
    // Remove old colliders before changing body type.
    for (const c of this.colliders) {
      try { this.world.removeCollider(c, true); } catch (_) { /* already gone */ }
    }
    try { this.world.removeRigidBody(this.rigidBody); } catch (_) { /* already gone */ }
    // Remove old handle from engine maps to prevent stale entries.
    if (engine) {
      engine._bodyToGO.delete(oldHandle);
      engine.rigidBodyMap.delete(oldHandle);
    }

    this.rigidBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(t.x, t.y, t.z)
        .setRotation(r),
    );
    const halfSize = [this._size[0] / 2, this._size[1] / 2, this._size[2] / 2];
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(...halfSize)
        .setFriction(0.6).setRestitution(0.1).setDensity(800),
      this.rigidBody,
    );
    this.colliders = [this.collider];

    if (engine) {
      engine._bodyToGO.set(this.rigidBody.handle, this);
      engine.rigidBodyMap.set(this.rigidBody.handle, this);
    }
  }

  /** Switch back to a dynamic body (e.g. after ejecting from reader). */
  makeDynamic() {
    if (!this.rigidBody || !this.world) return;
    const RAPIER = this.scene?.userData?.engine?.RAPIER;
    if (!RAPIER) return;
    const t = this.rigidBody.translation();
    const engine = this.scene?.userData?.engine;
    const oldHandle = this.rigidBody.handle;
    // Remove old colliders before changing body type.
    for (const c of this.colliders) {
      try { this.world.removeCollider(c, true); } catch (_) { /* already gone */ }
    }
    try { this.world.removeRigidBody(this.rigidBody); } catch (_) { /* already gone */ }
    // Remove old handle from engine maps to prevent stale entries.
    if (engine) {
      engine._bodyToGO.delete(oldHandle);
      engine.rigidBodyMap.delete(oldHandle);
    }

    this.rigidBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(t.x, t.y, t.z)
        .setLinearDamping(0.5)
        .setAngularDamping(1.0)
        .setGravityScale(1)
        .setCcdEnabled(true),
    );
    const halfSize = [this._size[0] / 2, this._size[1] / 2, this._size[2] / 2];
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(...halfSize)
        .setFriction(0.6).setRestitution(0.1).setDensity(800),
      this.rigidBody,
    );
    this.colliders = [this.collider];

    if (engine) {
      engine._bodyToGO.set(this.rigidBody.handle, this);
      engine.rigidBodyMap.set(this.rigidBody.handle, this);
    }
  }

  // ── Visual ─────────────────────────────────────────────────

  /** Turn the indicator green (signal saved to this drive). */
  setSaved(saved) {
    this.saved = saved;
    if (saved) {
      this._material.emissive.setHex(SAVED_EMISSIVE);
      this._material.emissiveIntensity = SAVED_EMISSIVE_INTENSITY;
    } else {
      this._material.emissive.setHex(0x000000);
      this._material.emissiveIntensity = 0;
    }
  }

  /** Reset to the default unmarked colour (drive ejected). */
  setEjected() {
    this.setSaved(false);
  }

  /** Free the geometry, material, and physics resources this drive built. */
  dispose() {
    this._mesh?.geometry?.dispose();
    this._material?.dispose();
    // Physics bodies are owned by the Rapier world — the engine frees the
    // whole world on scene teardown, so we don't remove individual bodies
    // here. Just clear our references.
    this.rigidBody = null;
    this.collider = null;
    this.colliders = [];
  }

  _build() {
    this._material = new THREE.MeshStandardMaterial({
      color: DEFAULT_COLOR,
      roughness: 0.6,
      metalness: 0.3,
      emissive: 0x000000,
      emissiveIntensity: 0,
    });
    this._mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...this._size),
      this._material,
    );
    this._mesh.name = 'DriveMesh';
    this._mesh.castShadow = true;
    this._mesh.receiveShadow = true;
    this.object3d.add(this._mesh);
  }
}
