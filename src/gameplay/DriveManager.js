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
//   dm.saveEvilToDrive();          // …or the red one: the drive turns red
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

  /** Whether the inserted drive has a signal stored on it. */
  get insertedDriveHasSignal() { return this.insertedDrive?.saved === true; }

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

  /** Eject the inserted drive and shoot it out in a random direction.
   *  Detaches via the snap socket (which restores dynamic physics), then
   *  applies a random velocity so the drive flies away. Used by the evil
   *  signal to launch the corrupted drive out of the reader.
   *  @returns {object|null} The Drive that was ejected, or null. */
  ejectInsertedDrive() {
    const drive = this.insertedDrive;
    if (!drive) return null;

    // Clear the manager state first — the snap socket's onDetached callback
    // also calls ejectDrive(), but that is a harmless no-op once the state
    // is already cleared.
    this.ejectDrive();

    // Detach via the snap socket — this calls makeDynamic() to restore
    // physics, plays the eject beep, and fires onDetached.
    const socket = drive._snapOwner;
    socket?.detach(drive);

    // Block the socket from re-catching the drive while it flies away.
    // The rejection expires in 2 s, by which time the drive has landed
    // and the player may have picked it up or carried it elsewhere.
    socket?.reject(drive);

    // The drive is now dynamic: give it a random kick.
    if (drive.rigidBody) {
      const angle = Math.random() * Math.PI * 2;
      const hSpeed = 1.5 + Math.random() * 2;
      drive.rigidBody.setLinvel({
        x: Math.cos(angle) * hSpeed,
        y: 2.5 + Math.random() * 1.5,
        z: Math.sin(angle) * hSpeed,
      }, true);
      drive.rigidBody.setAngvel({
        x: (Math.random() - 0.5) * 10,
        y: (Math.random() - 0.5) * 10,
        z: (Math.random() - 0.5) * 10,
      }, true);
    }
    return drive;
  }

  /** Save a signal to the inserted drive. Marks the drive as saved (turns
   *  it green) so it cannot accept more signals until cleared.
   *  @returns {number} the new signalsOnDrive count */
  saveToDrive() {
    if (!this.insertedDrive) return this.signalsOnDrive;
    this.signalsOnDrive++;
    this.insertedDrive.setSaved(true);
    return this.signalsOnDrive;
  }

  /** Save the anomalous (evil) signal to the inserted drive. Like
   *  saveToDrive(), but the drive shows red (corrupted) and never counts
   *  towards the night quota (DriveBoxDock) until it is wiped.
   *  @returns {number} the new signalsOnDrive count */
  saveEvilToDrive() {
    if (!this.insertedDrive) return this.signalsOnDrive;
    this.signalsOnDrive++;
    this.insertedDrive.setSaved(true, { corrupted: true });
    return this.signalsOnDrive;
  }

  /** Clear the signal from the inserted drive, resetting it to the default
   *  colour. Used by the ServerRoom console to wipe a drive.
   *  @returns {boolean} true if a signal was cleared */
  clearInsertedDriveSignal() {
    if (!this.insertedDrive) return false;
    this.insertedDrive.setSaved(false);
    this.signalsOnDrive = 0;
    return true;
  }
}
