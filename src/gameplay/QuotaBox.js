import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { Pickupable } from '../components/Pickupable.js';

// ─────────────────────────────────────────────
// QuotaBox  –  Drive-collection quota tracker (Component)
// ─────────────────────────────────────────────
// Attach to a GameObject representing the "outgoing" drive box.
// Scans for nearby unheld drives that have been scanned (drive.saved === true)
// and counts them toward the night quota. Unscanned drives are ignored —
// the player must scan a signal onto a drive before depositing it.
//
// Unlike DriveSlot (which holds one drive at a time), the QuotaBox accepts
// multiple drives. Each deposited drive is made kinematic and sits in the
// box as visual feedback. If the player picks a deposited drive back up,
// the count decreases.
//
// Usage:
//   const qb = new QuotaBox({ requiredCount: 3 });
//   quotaBoxGO.addComponent(qb);
//   qb.addDrive(drive1);
//   qb.addDrive(drive2);
//   qb.collectedCount;   // how many scanned drives are in the box
//   qb.isQuotaMet();     // collectedCount >= requiredCount
// ─────────────────────────────────────────────

/** Metres within which a drive is collected. */
const DEFAULT_SNAP_DISTANCE = 0.3;

/** Pre-allocated scratch vectors. */
const _boxPos = new THREE.Vector3();
const _drivePos = new THREE.Vector3();

export class QuotaBox extends Component {
  /** Minimum scanned drives needed to pass the night. */
  requiredCount = 0;

  /** How many scanned drives are currently in the box. */
  _collected = 0;

  /** All drives this box watches (registered by the scene).
   *  @type {object[]} */
  drives = [];

  /** Drives that have been deposited (counted). @type {Set<object>} */
  _deposited = new Set();

  /** Metres within which a saved drive is collected. */
  snapDistance = DEFAULT_SNAP_DISTANCE;

  /**
   * @param {object} [opts]
   * @param {number} [opts.requiredCount]
   * @param {number} [opts.snapDistance]
   */
  constructor({ requiredCount = 0, snapDistance } = {}) {
    super();
    this.requiredCount = requiredCount;
    if (snapDistance !== undefined) this.snapDistance = snapDistance;
  }

  /** How many scanned drives are currently in the box. */
  get collectedCount() { return this._collected; }

  /** Whether enough scanned drives have been collected to pass the night. */
  isQuotaMet() { return this._collected >= this.requiredCount; }

  /** Register a drive this box should watch. */
  addDrive(drive) {
    if (drive && !this.drives.includes(drive)) {
      this.drives.push(drive);
    }
  }

  /** Reset for a new night: eject all deposited drives, zero count. */
  reset() {
    for (const drive of this._deposited) {
      // Restore normal physics so the drive can be picked up / falls.
      drive.makeDynamic?.();
      const pickupable = drive.getComponent?.(Pickupable);
      if (pickupable) {
        pickupable.onBeforePickUp = null;
        pickupable.held = false;
      }
    }
    this._deposited.clear();
    this._collected = 0;
  }

  // ── Lifecycle ─────────────────────────────────────────────

  /** Per-frame: scan for nearby unheld SAVED drives and collect them. */
  onUpdate(_dt) {
    if (!this.gameObject) return;
    this.gameObject.object3d.getWorldPosition(_boxPos);

    // 1. Check if any deposited drive was picked up (undo the count).
    for (const drive of this._deposited) {
      const pickupable = drive.getComponent?.(Pickupable);
      if (pickupable?.held) {
        this._deposited.delete(drive);
        this._collected = Math.max(0, this._collected - 1);
        // The PickupSystem handles physics; just clear our hook.
        pickupable.onBeforePickUp = null;
      }
    }

    // 2. Scan for nearby unheld SAVED drives to collect.
    for (const drive of this.drives) {
      if (this._deposited.has(drive)) continue;

      // Skip if held by the player.
      const pickupable = drive.getComponent?.(Pickupable);
      if (pickupable?.held) continue;

      // Only collect drives that have been scanned (signal saved on them).
      if (!drive.saved) continue;

      // Check distance.
      drive.object3d.getWorldPosition(_drivePos);
      const dist = _boxPos.distanceTo(_drivePos);
      if (dist > this.snapDistance) continue;

      // Collect this drive: make kinematic, count it.
      this._deposited.add(drive);
      this._collected++;
      drive.makeKinematic?.();

      // Set a hook so if the player picks it up, we convert the body back
      // to dynamic first (kinematic bodies can't be picked up).
      if (pickupable) {
        pickupable.onBeforePickUp = () => {
          drive.makeDynamic?.();
        };
      }
    }
  }
}
