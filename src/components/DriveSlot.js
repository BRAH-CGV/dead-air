import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { Pickupable } from './Pickupable.js';

// ─────────────────────────────────────────────
// DriveSlot  –  Proximity-based drive receptacle (Component)
// ─────────────────────────────────────────────
// Attach to any GameObject to make it a drive slot. When an unheld drive
// comes within snapDistance, it auto-snaps into place (kinematic, positioned
// on the slot). The inserted drive keeps its Pickupable — the player can
// pick it up directly (no [E] Insert/Eject prompt). The slot detects the
// removal and updates the DriveManager.
//
// Designed for reuse: any machine (computer terminal, server rack, etc.)
// can have a DriveSlot component. The slot knows nothing about specific
// rooms or machines — it takes a DriveManager and a list of drives to watch.
//
// Sounds:
//   Insert/eject beeps are generated procedurally at runtime (no audio files
//   needed). The frequencies and duration are configurable.
//
// Usage:
//   const slot = new DriveSlot({ snapDistance: 0.25, snapOffset: { y: 0.05 } });
//   driveReaderGO.addComponent(slot);
//   slot.bindDriveManager(driveManager);
//   slot.addDrive(drive1);
//   slot.addDrive(drive2);
// ─────────────────────────────────────────────

/** Default snap distance in metres. */
const DEFAULT_SNAP_DISTANCE = 0.25;

/** Default snap offset (local Y above the slot surface). */
const DEFAULT_SNAP_OFFSET = { y: 0.025 };

/** Insert beep: short high-pitched tone. */
const INSERT_BEEP_FREQ = 880;
const INSERT_BEEP_DURATION = 0.1;

/** Eject beep: short low-pitched tone. */
const EJECT_BEEP_FREQ = 440;
const EJECT_BEEP_DURATION = 0.1;

// Pre-allocated scratch vectors to avoid per-frame allocations.
const _slotWorldPos = new THREE.Vector3();
const _driveWorldPos = new THREE.Vector3();

export class DriveSlot extends Component {
  /** Metres within which a drive snaps in. */
  snapDistance = DEFAULT_SNAP_DISTANCE;

  /** Local offset from the slot's origin where the drive sits. */
  snapOffset = { ...DEFAULT_SNAP_OFFSET };

  /** @type {import('../gameplay/DriveManager.js').DriveManager|null} */
  driveManager = null;

  /** Drives this slot watches. @type {object[]} */
  drives = [];

  /** Drive currently inserted (or null). @type {object|null} */
  _insertedDrive = null;

  /** Whether the slot is enabled (auto-snap active). */
  enabled = true;

  /** Called after a drive snaps into the slot. @type {((drive: object) => void)|null} */
  onDriveInserted = null;

  /** Called after a drive is ejected from the slot. @type {((drive: object) => void)|null} */
  onDriveRemoved = null;

  /**
   * @param {object} [opts]
   * @param {number} [opts.snapDistance]
   * @param {{x?:number, y?:number, z?:number}} [opts.snapOffset]
   * @param {((drive: object) => void)|null} [opts.onDriveInserted]
   * @param {((drive: object) => void)|null} [opts.onDriveRemoved]
   */
  constructor(opts = {}) {
    super();
    if (opts.snapDistance !== undefined) this.snapDistance = opts.snapDistance;
    if (opts.snapOffset) this.snapOffset = { ...DEFAULT_SNAP_OFFSET, ...opts.snapOffset };
    if (opts.onDriveInserted) this.onDriveInserted = opts.onDriveInserted;
    if (opts.onDriveRemoved) this.onDriveRemoved = opts.onDriveRemoved;
  }

  // ── Public API ────────────────────────────────────────────

  /** Wire the DriveManager. Called by the scene after gameplay systems. */
  bindDriveManager(dm) {
    this.driveManager = dm;
  }

  /** Register a drive this slot should watch. */
  addDrive(drive) {
    if (drive && !this.drives.includes(drive)) {
      this.drives.push(drive);
    }
  }

  /** The drive currently in the slot (or null). */
  get insertedDrive() { return this._insertedDrive; }

  /** Whether a drive is in the slot. */
  get hasDrive() { return this._insertedDrive !== null; }

  // ── Per-frame update ──────────────────────────────────────

  onUpdate(_dt) {
    if (!this.enabled) return;

    // 1. If we have an inserted drive, check if it was removed (picked up).
    if (this._insertedDrive) {
      const pickupable = this._insertedDrive.getComponent?.(Pickupable);
      if (pickupable?.held) {
        // Player picked it up — eject from manager, restore physics.
        this._ejectDrive(this._insertedDrive);
      }
      return;
    }

    // 2. No inserted drive — scan for nearby unheld drives and snap one in.
    this.gameObject.object3d.getWorldPosition(_slotWorldPos);

    for (const drive of this.drives) {
      // Skip if this drive is already inserted (shouldn't happen, but guard).
      if (drive === this._insertedDrive) continue;

      // Skip if the drive is held by the player.
      const pickupable = drive.getComponent?.(Pickupable);
      if (pickupable?.held) continue;

      // Check distance.
      drive.object3d.getWorldPosition(_driveWorldPos);
      const dist = _slotWorldPos.distanceTo(_driveWorldPos);
      if (dist > this.snapDistance) continue;

      // Snap this drive in.
      this._insertDrive(drive);
      return; // Only snap one drive per frame.
    }
  }

  // ── Internal ──────────────────────────────────────────────

  /** Snap a drive into the slot. */
  _insertDrive(drive) {
    // Notify the manager (if bound).
    if (this.driveManager) {
      const ok = this.driveManager.insertDrive(drive);
      if (!ok) return;
    }

    // Lock the drive in the slot: convert to kinematic and snap position.
    drive.makeKinematic?.();
    if (drive.rigidBody) {
      // Compute snap position: slot world pos + offset.
      this.gameObject.object3d.getWorldPosition(_slotWorldPos);
      const snapX = _slotWorldPos.x + (this.snapOffset.x ?? 0);
      const snapY = _slotWorldPos.y + (this.snapOffset.y ?? 0);
      const snapZ = _slotWorldPos.z + (this.snapOffset.z ?? 0);
      drive.rigidBody.setTranslation(
        { x: snapX, y: snapY, z: snapZ },
        true,
      );
      drive.rigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);

      // Kinematic bodies skip physics interpolation, and _syncPhysicsToScene
      // only covers _rootObjects (unparented). Drives are children of the
      // room root, so we must update the visual transform ourselves.
      // Convert world snap position to local space.
      const parent = drive.object3d.parent;
      if (parent) {
        parent.updateMatrixWorld(true);
        const localPos = parent.worldToLocal(
          new THREE.Vector3(snapX, snapY, snapZ),
        );
        drive.object3d.position.copy(localPos);
        // Parent inverse rotation for the orientation.
        const parentQuat = new THREE.Quaternion();
        parent.getWorldQuaternion(parentQuat);
        parentQuat.invert();
        drive.object3d.quaternion.copy(parentQuat);
      } else {
        drive.object3d.position.set(snapX, snapY, snapZ);
        drive.object3d.quaternion.set(0, 0, 0, 1);
      }
    }

    // Set the onBeforePickUp hook so PickupSystem ejects the drive before
    // modifying its physics (kinematic → dynamic conversion).
    const pickupable = drive.getComponent?.(Pickupable);
    if (pickupable) {
      pickupable.onBeforePickUp = () => this._ejectDrive(drive);
    }

    this._insertedDrive = drive;
    this._playBeep('insert');
    this.onDriveInserted?.(drive);
  }

  /** Eject a drive from the slot (player picked it up). */
  _ejectDrive(drive) {
    // Notify the manager (if bound).
    if (this.driveManager) {
      this.driveManager.ejectDrive();
    }

    // Restore normal physics so the drive can be carried.
    drive.makeDynamic?.();

    // Clear the hook so it doesn't fire again on a drive no longer in the slot.
    const pickupable = drive.getComponent?.(Pickupable);
    if (pickupable) pickupable.onBeforePickUp = null;

    this._insertedDrive = null;
    this._playBeep('eject');
    this.onDriveRemoved?.(drive);
  }

  /** Play a placeholder beep sound. */
  _playBeep(type) {
    const engine = this.gameObject?.scene?.userData?.engine;
    if (!engine?.audioListener) return;

    const context = engine.audioListener.context;
    if (context.state === 'suspended') return; // Chrome blocks audio before user gesture.

    const freq = type === 'insert' ? INSERT_BEEP_FREQ : EJECT_BEEP_FREQ;
    const duration = type === 'insert' ? INSERT_BEEP_DURATION : EJECT_BEEP_DURATION;

    // Generate a short sine wave buffer.
    const sampleRate = context.sampleRate;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = context.createBuffer(1, numSamples, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      // Fade out to avoid clicks.
      const envelope = 1 - (i / numSamples);
      data[i] = Math.sin(2 * Math.PI * freq * t) * 0.3 * envelope;
    }

    // Play through a PositionalAudio at the slot's position.
    const sound = new THREE.PositionalAudio(engine.audioListener);
    sound.setBuffer(buffer);
    sound.setRefDistance(1);
    sound.setVolume(0.5);
    sound.play();

    // Attach to the slot's Object3D so it's spatialised.
    this.gameObject.object3d.add(sound);

    // Clean up after playback.
    setTimeout(() => {
      this.gameObject.object3d.remove(sound);
      sound.disconnect();
    }, duration * 1000 + 100);
  }
}
