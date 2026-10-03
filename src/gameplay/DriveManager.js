// ─────────────────────────────────────────────
// DriveManager  –  Physical drive state tracking
// ─────────────────────────────────────────────
// Tracks actual Drive objects: which exist in the scene, which is in the
// reader, and how many signals have been saved. Scanning is blocked unless
// a drive is inserted.
//
// Drives are registered with addDrive() after creation. The manager tracks
// each drive's state (held by player, in reader, or available on the floor)
// by querying the drive's Pickupable component.
//
// Usage:
//   const dm = new DriveManager();
//   dm.addDrive(drive1);
//   dm.addDrive(drive2);
//   dm.hasAvailableDrives();       // true
//   dm.insertDrive(drive1);        // drive1 is now in the reader
//   dm.saveToDrive();              // signalsOnDrive = 1
//   const ejected = dm.ejectDrive(); // returns drive1
// ─────────────────────────────────────────────

import { Pickupable } from '../components/Pickupable.js';

export class DriveManager {
  /** All registered Drive objects. @type {object[]} */
  drives = [];

  /** Drive currently in the reader slot (or null). @type {object|null} */
  insertedDrive = null;

  /** Signals saved to the currently inserted drive. */
  signalsOnDrive = 0;

  /** Register a drive in the pool. */
  addDrive(drive) {
    if (drive && !this.drives.includes(drive)) {
      this.drives.push(drive);
    }
  }

  /** Unregister a drive (e.g. if removed from the scene). */
  removeDrive(drive) {
    const idx = this.drives.indexOf(drive);
    if (idx !== -1) this.drives.splice(idx, 1);
    if (this.insertedDrive === drive) {
      this.insertedDrive = null;
      this.signalsOnDrive = 0;
    }
  }

  /** Total drives in the scene. */
  get totalDrives() { return this.drives.length; }

  /** Whether a drive is currently in the reader slot. */
  get driveInserted() { return this.insertedDrive !== null; }

  /** Return drives that are neither held by the player nor in the reader.
   *  A drive is "available" if its Pickupable component exists and is not
   *  held, and it is not the inserted drive. */
  getAvailableDrives() {
    return this.drives.filter(d => {
      if (d === this.insertedDrive) return false;
      const pickupable = d.getComponent?.(Pickupable);
      if (pickupable?.held) return false;
      return true;
    });
  }

  /** True if there are drives available (not held, not in reader). */
  hasAvailableDrives() {
    return this.getAvailableDrives().length > 0;
  }

  /** Insert a specific drive into the reader.
   *  @param {object} drive  The Drive object to insert.
   *  @returns {boolean} true if the drive was inserted */
  insertDrive(drive) {
    if (this.insertedDrive || !drive) return false;
    if (!this.drives.includes(drive)) return false;
    this.insertedDrive = drive;
    this.signalsOnDrive = 0;
    return true;
  }

  /** Eject the drive from the reader.
   *  @returns {object|null} The Drive that was ejected, or null. */
  ejectDrive() {
    if (!this.insertedDrive) return null;
    const drive = this.insertedDrive;
    this.insertedDrive = null;
    this.signalsOnDrive = 0;
    return drive;
  }

  /** Save a signal to the inserted drive.
   *  @returns {number} the new signalsOnDrive count */
  saveToDrive() {
    if (!this.insertedDrive) return this.signalsOnDrive;
    this.signalsOnDrive++;
    return this.signalsOnDrive;
  }
}
