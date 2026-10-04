import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { Interactable } from '../components/Interactable.js';

// ─────────────────────────────────────────────
// DriveSupply  –  Drive dispenser (Component)
// ─────────────────────────────────────────────
// Attach to a GameObject representing a supply box. Holds a pool of Drive
// objects; each interaction dispenses one drive at a configurable offset
// from the box. When the pool is empty the interactable reads "No drives
// left".
//
// All drives ever added are exposed via `drives` so the scene can register
// them with DriveManager and DriveSlots regardless of whether they have
// been dispensed yet.
//
// Usage:
//   const supply = new DriveSupply({ dispenseOffset: [0.3, 0.1, 0.5] });
//   supplyBoxGO.addComponent(supply);
//   supplyBoxGO.addComponent(createSupplyInteractable(supply));
//   supply.addDrive(drive1);
//   supply.addDrive(drive2);
// ─────────────────────────────────────────────

/** Default offset from the box where a dispensed drive appears. */
const DEFAULT_DISPENSE_OFFSET = [0.3, 0.1, 0.5];

export class DriveSupply extends Component {
  /** Pool of drives not yet dispensed. @type {object[]} */
  _pool = [];

  /** All drives ever added (including dispensed ones). @type {object[]} */
  _allDrives = [];

  /** Offset from the box's position where dispensed drives appear.
   *  @type {number[]} */
  dispenseOffset = [...DEFAULT_DISPENSE_OFFSET];

  /**
   * @param {object} [opts]
   * @param {number[]} [opts.dispenseOffset]
   */
  constructor(opts = {}) {
    super();
    if (opts.dispenseOffset) this.dispenseOffset = [...opts.dispenseOffset];
  }

  /** Add a drive to the supply pool. */
  addDrive(drive) {
    if (drive && !this._allDrives.includes(drive)) {
      this._allDrives.push(drive);
      this._pool.push(drive);
    }
  }

  /** All drives ever added (for external registration). */
  get drives() { return this._allDrives; }

  /** How many drives remain in the pool. */
  get remaining() { return this._pool.length; }

  /** Take the next drive from the pool and position it near the box.
   *  The drive is NOT added to the scene graph — the caller (BaseScene)
   *  must add it so it gets physics via _init().
   *  @returns {object|null} The dispensed drive, or null if empty. */
  dispenseOne() {
    const drive = this._pool.shift();
    if (!drive) return null;

    // Position the drive relative to the supply box's world position.
    const boxPos = this.gameObject?.object3d?.position;
    if (boxPos) {
      drive.object3d.position.set(
        boxPos.x + this.dispenseOffset[0],
        boxPos.y + this.dispenseOffset[1],
        boxPos.z + this.dispenseOffset[2],
      );
    }
    return drive;
  }

  /** Reset the supply for a new night.
   *  Clears the pool and returns all drives to it.
   *  The caller must ensure drives are in the scene and registered with slots.
   *  @param {object} [parent]  If provided, add all drives to this Object3D
   *                            (so they're in the scene graph for physics). */
  reset(parent) {
    this._pool.length = 0;
    for (const drive of this._allDrives) {
      this._pool.push(drive);
      if (parent && drive.object3d.parent !== parent) {
        parent.addChild(drive);
      }
    }
  }
}

/** Create an Interactable that delegates to a DriveSupply.
 *  Prompt follows the remaining count.
 *  @param {DriveSupply} supply */
export function createSupplyInteractable(supply) {
  const interact = new class extends Interactable {
    promptLabel = '[E] Take a drive';
    interactRange = 2;

    onHover() {
      this.promptLabel = supply.remaining > 0
        ? '[E] Take a drive'
        : 'No drives left';
    }

    onInteract() {
      supply.dispenseOne();
      this.promptLabel = supply.remaining > 0
        ? '[E] Take a drive'
        : 'No drives left';
    }
  }();
  return interact;
}
