import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Pickupable } from '../components/Pickupable.js';
import { SnapSocket } from '../components/SnapSocket.js';
import { packGroups } from '../core/PhysicsLayers.js';

// Low, slightly rectangular magazine: about half the old height, z ≈ 0.8×x,
// long side across the lid so the rows of seated drives run along it.
const DEFAULT_SIZE = [0.32, 0.12, 0.28];
const DEFAULT_COLOR = 0x405064;
const DEFAULT_DRIVE_SIZE = [0.08, 0.02, 0.12];
const DEFAULT_GROUPS = packGroups(['DEFAULT'], ['DEFAULT', 'SHELF']);
/** How far sockets sit below the lid — drives seat slightly inside. */
const SOCKET_RECESS = 0.02;
/** Columns within a row sit at this multiple of the slot footprint. */
const COLUMN_PITCH_SCALE = 4;

/** Socket orientation: 90° about X stands a drive up on its long edge, then
 *  90° about Y turns it to face across the lid. */
const SLOT_ROTATION = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));

/**
 * Placeholder pickupable physics tray whose lid carries a grid of drive
 * sockets — two rows of four by default, drives standing on end and seated
 * slightly inside. The sockets use the generic SnapSocket system; this class
 * only supplies the visual, dynamic body and drive-specific policy. The box
 * itself seats kinematically in the airlock's dock (DriveBoxDock).
 */
export class DriveBox extends GameObject {
  /** Marker used by generic snap receivers to accept only drive boxes. */
  isDriveBox = true;

  constructor(name = 'DriveBox', opts = {}) {
    super(name);
    this.size = opts.size ?? DEFAULT_SIZE;
    this.driveSize = opts.driveSize ?? DEFAULT_DRIVE_SIZE;
    this.slotRows = opts.slotRows ?? 2;
    this.slotColumns = opts.slotColumns ?? 4;
    this.mass = opts.mass ?? 1.2;
    /** Range at which a released drive snaps into a socket. */
    this.snapDistance = opts.snapDistance ?? 0.1;
    this._material = opts.material ?? new THREE.MeshStandardMaterial({
      color: opts.color ?? DEFAULT_COLOR,
      roughness: 0.65,
      metalness: 0.25,
      emissive: 0x081824,
      emissiveIntensity: 0.25,
    });
    this._ownsMaterial = !opts.material;

    this.receiver = this.addComponent(new SnapSocket({
      snapDistance: this.snapDistance,
      slots: this._buildSlots(opts),
      attachedPromptLabel: opts.attachedPromptLabel ?? '[E] Take drive',
      canAccept: item => item?.isDrive === true,
    }));

    this._buildVisual();

    this.pickupable = this.addComponent(new Pickupable());
    this.pickupable.promptLabel = opts.promptLabel ?? '[E] Pick up drive box';
    this.pickupable.holdDistance = opts.holdDistance ?? 1.2;
  }

  /** The socket grid on the lid: rows × columns of drives standing on end
   *  just above the box. Spacing follows the rotated drive's footprint, with
   *  a gutter between rows. */
  _buildSlots(opts) {
    const rotation = opts.slotRotation ?? SLOT_ROTATION;
    this.slotExtents = this._rotatedExtents(rotation);
    // Sockets sit just below the lid: drives seat slightly inside the box.
    const height = this.size[1] / 2 - (opts.socketRecess ?? SOCKET_RECESS);
    const spacingX = opts.slotSpacingX ?? this.slotExtents[0] * COLUMN_PITCH_SCALE;
    const spacingZ = opts.slotSpacingZ ?? this.slotExtents[2] + 0.04;

    const slots = [];
    for (let row = 0; row < this.slotRows; row++) {
      for (let col = 0; col < this.slotColumns; col++) {
        slots.push({
          offset: {
            x: (col - (this.slotColumns - 1) / 2) * spacingX,
            y: height,
            z: (row - (this.slotRows - 1) / 2) * spacingZ,
          },
          rotation,
        });
      }
    }
    return slots;
  }

  /** A rotated drive's axis-aligned extents: each host axis sums the drive
   *  size weighted by the absolute rotation-matrix entries for that axis. */
  _rotatedExtents(rotation) {
    const e = new THREE.Matrix4().makeRotationFromQuaternion(rotation).elements;
    return [0, 1, 2].map(axis =>
      Math.abs(e[axis]) * this.driveSize[0] +
      Math.abs(e[4 + axis]) * this.driveSize[1] +
      Math.abs(e[8 + axis]) * this.driveSize[2],
    );
  }

  get insertedDrive() {
    return this.receiver.firstAttached;
  }

  addDrive(drive) {
    this.receiver.addCandidate(drive);
  }

  _init(scene, world) {
    super._init(scene, world);

    const RAPIER = scene.userData.engine?.RAPIER;
    if (!RAPIER) return;

    const worldPos = new THREE.Vector3();
    this.object3d.getWorldPosition(worldPos);

    this._swapBody(RAPIER, world, RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(worldPos.x, worldPos.y, worldPos.z)
      .setLinearDamping(0.8)
      .setAngularDamping(1.2)
      .setGravityScale(1)
      .setCcdEnabled(true));
  }

  /** The box's collider: a cuboid matching the visual, dense for its size. */
  _colliderDesc(RAPIER) {
    return RAPIER.ColliderDesc.cuboid(...this.size.map(v => v / 2))
      .setFriction(0.7)
      .setRestitution(0.05)
      .setDensity(this.mass / (this.size[0] * this.size[1] * this.size[2]))
      .setCollisionGroups(DEFAULT_GROUPS);
  }

  /** (Re)create the rigid body and collider from `bodyDesc`, replacing any
   *  existing pair and keeping the engine maps in step — the same rebuild
   *  pattern Drive uses to switch body types. */
  _swapBody(RAPIER, world, bodyDesc) {
    const engine = this.scene?.userData?.engine;
    if (this.rigidBody) {
      for (const c of this.colliders) {
        try { world.removeCollider(c, true); } catch (_) { /* already gone */ }
      }
      const oldHandle = this.rigidBody.handle;
      try { world.removeRigidBody(this.rigidBody); } catch (_) { /* already gone */ }
      if (engine) {
        engine._bodyToGO.delete(oldHandle);
        engine.rigidBodyMap.delete(oldHandle);
      }
    }

    this.rigidBody = world.createRigidBody(bodyDesc);
    this.collider = world.createCollider(this._colliderDesc(RAPIER), this.rigidBody);
    this.colliders = [this.collider];

    if (engine) {
      engine._bodyToGO.set(this.rigidBody.handle, this);
      engine.rigidBodyMap.set(this.rigidBody.handle, this);
    }
  }

  /** Switch to a kinematic body — locked in place (e.g. seated in the
   *  airlock's dock). Same collision groups: a docked box overlaps nothing
   *  solid, and kinematic-vs-kinematic with its seated drives is inert. */
  makeKinematic() {
    if (!this.rigidBody || !this.world) return;
    const RAPIER = this.scene?.userData?.engine?.RAPIER;
    if (!RAPIER) return;
    const t = this.rigidBody.translation();
    const r = this.rigidBody.rotation();
    this._swapBody(RAPIER, this.world, RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(t.x, t.y, t.z)
      .setRotation(r));
  }

  /** Switch back to a dynamic body (e.g. released from the dock). */
  makeDynamic() {
    if (!this.rigidBody || !this.world) return;
    const RAPIER = this.scene?.userData?.engine?.RAPIER;
    if (!RAPIER) return;
    const t = this.rigidBody.translation();
    this._swapBody(RAPIER, this.world, RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(t.x, t.y, t.z)
      .setLinearDamping(0.8)
      .setAngularDamping(1.2)
      .setGravityScale(1)
      .setCcdEnabled(true));
  }

  dispose() {
    this._mesh?.geometry?.dispose();
    this._slotMarkerGeometry?.dispose();
    this._slotMarkerMaterial?.dispose();
    if (this._ownsMaterial) this._material?.dispose();
    this.rigidBody = null;
    this.collider = null;
    this.colliders = [];
  }

  _buildVisual() {
    this._mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...this.size),
      this._material,
    );
    this._mesh.name = 'DriveBoxMesh';
    this._mesh.castShadow = true;
    this._mesh.receiveShadow = true;
    this.object3d.add(this._mesh);

    // Black rectangles mark each slot — thin quads in the X-Z plane (facing
    // ±Y) sized to the standing drive's footprint. Placeholder visual.
    const markerSize = [this.slotExtents[0], 0.002, this.slotExtents[2]];
    this._slotMarkerGeometry = new THREE.BoxGeometry(...markerSize);
    this._slotMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    for (const slot of this.receiver.slots) {
      const marker = new THREE.Mesh(this._slotMarkerGeometry, this._slotMarkerMaterial);
      marker.name = 'DriveBoxSlotMarker';
      marker.position.set(slot.offset.x, this.size[1] / 2 + 0.002, slot.offset.z);
      this.object3d.add(marker);
    }
  }
}
