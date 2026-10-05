import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Pickupable } from '../components/Pickupable.js';
import { SnapSocket } from '../components/SnapSocket.js';
import { packGroups } from '../core/PhysicsLayers.js';

const DEFAULT_SIZE = [0.32, 0.24, 0.32];
const DEFAULT_COLOR = 0x405064;
const DEFAULT_DRIVE_SIZE = [0.08, 0.02, 0.12];
const DEFAULT_GROUPS = packGroups(['DEFAULT'], ['DEFAULT', 'SHELF']);

/**
 * Placeholder pickupable physics cube that can passively hold one drive in a
 * socket floating just above it. The socket uses the generic SnapSocket system;
 * this class only supplies the visual, dynamic body and drive-specific policy.
 */
export class DriveBox extends GameObject {
  constructor(name = 'DriveBox', opts = {}) {
    super(name);
    this.size = opts.size ?? DEFAULT_SIZE;
    this.driveSize = opts.driveSize ?? DEFAULT_DRIVE_SIZE;
    this.mass = opts.mass ?? 1.2;
    this.snapDistance = opts.snapDistance ?? 0.35;
    this._material = opts.material ?? new THREE.MeshStandardMaterial({
      color: opts.color ?? DEFAULT_COLOR,
      roughness: 0.65,
      metalness: 0.25,
      emissive: 0x081824,
      emissiveIntensity: 0.25,
    });
    this._ownsMaterial = !opts.material;

    this._buildVisual();

    this.pickupable = this.addComponent(new Pickupable());
    this.pickupable.promptLabel = opts.promptLabel ?? '[E] Pick up drive box';
    this.pickupable.holdDistance = opts.holdDistance ?? 1.2;

    const gap = opts.socketGap ?? 0.08;
    const socketOffset = opts.socketOffset ?? {
      x: 0,
      y: this.size[1] / 2 + this.driveSize[1] / 2 + gap,
      z: 0,
    };

    this.receiver = this.addComponent(new SnapSocket({
      snapDistance: this.snapDistance,
      slots: [{ offset: socketOffset }],
      attachedPromptLabel: opts.attachedPromptLabel ?? '[E] Take drive',
      canAccept: item => item?.isDrive === true,
    }));
  }

  get insertedDrive() {
    return this.receiver.firstAttached;
  }

  addDrive(drive) {
    this.receiver.addCandidate(drive);
  }

  _init(scene, world) {
    super._init(scene, world);

    const engine = scene.userData.engine;
    const RAPIER = engine?.RAPIER;
    if (!RAPIER) return;

    const worldPos = new THREE.Vector3();
    this.object3d.getWorldPosition(worldPos);

    this.rigidBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(worldPos.x, worldPos.y, worldPos.z)
        .setLinearDamping(0.8)
        .setAngularDamping(1.2)
        .setGravityScale(1)
        .setCcdEnabled(true),
    );

    const half = this.size.map(v => v / 2);
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(...half)
        .setFriction(0.7)
        .setRestitution(0.05)
        .setDensity(this.mass / (this.size[0] * this.size[1] * this.size[2]))
        .setCollisionGroups(DEFAULT_GROUPS),
      this.rigidBody,
    );
    this.colliders = [this.collider];

    engine._bodyToGO.set(this.rigidBody.handle, this);
    engine.rigidBodyMap.set(this.rigidBody.handle, this);
  }

  dispose() {
    this._mesh?.geometry?.dispose();
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

    const top = new THREE.Mesh(
      new THREE.BoxGeometry(this.size[0] * 0.72, 0.012, this.size[2] * 0.72),
      this._material,
    );
    top.name = 'DriveBoxSocketPad';
    top.position.y = this.size[1] / 2 + 0.008;
    top.castShadow = true;
    top.receiveShadow = true;
    this.object3d.add(top);
  }
}
