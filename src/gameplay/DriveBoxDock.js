import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// DriveBoxDock  –  quota counter for a docked drive box (Component)
// ─────────────────────────────────────────────
// Sits on the airlock's dock pedestal, next to the SnapSocket that receives
// whole drive boxes. The night quota is no longer a pile of loose drives:
// whichever box is seated here counts only its signal-bearing drives — and
// never the corrupted (red) ones, which must be wiped at the ServerRoom
// console like any other deleted signal.
//
// The count derives from the live socket on every read — no per-frame state
// — so picking the box back out (SnapSocket detaches it) drops it to zero.
//
// Each night also asks for so many of those drives to be processed (taken
// to PROCESSED_LEVEL at the ServerRoom's processing console):
// requiredProcessed, 1 / 2 / 4 on nights 1 / 2 / 3 (SignalManager). A
// processed drive still counts as one of the drives.
//
// Usage:
//   const socket = pedestalGO.addComponent(new SnapSocket({
//     canAccept: item => item?.isDriveBox === true, ... }));
//   const dock = pedestalGO.addComponent(new DriveBoxDock({ socket }));
//   dock.requiredCount = 3;
//   dock.requiredProcessed = 1;
//   dock.collectedCount;   // saved drives seated in the docked box
//   dock.processedCount;   // ... of them processed
//   dock.isQuotaMet();     // enough of both
//   dock.empty();          // night reset: wipe + release the docked box
// ─────────────────────────────────────────────

/** The signal level a drive has once processed (the cyan indicator). */
export const PROCESSED_LEVEL = 2;

export class DriveBoxDock extends Component {
  /** Saved drives needed to pass the night. */
  requiredCount = 0;

  /** How many of those drives must have been processed. */
  requiredProcessed = 0;

  /** The SnapSocket that receives drive boxes.
   *  @type {import('../components/SnapSocket.js').SnapSocket|null} */
  socket = null;

  /**
   * @param {object} [opts]
   * @param {import('../components/SnapSocket.js').SnapSocket} [opts.socket]
   * @param {number} [opts.requiredCount]
   */
  constructor({ socket = null, requiredCount = 0 } = {}) {
    super();
    this.socket = socket;
    this.requiredCount = requiredCount;
  }

  /** The box currently seated in the dock, or null. */
  get depositedBox() {
    return this.socket?.firstAttached ?? null;
  }

  /** Signal-bearing drives seated in the docked box. Unsaved drives don't
   *  count, and neither does anything outside the box. Corrupted (red)
   *  drives never count: the evil signal has to be deleted, not stored. */
  get collectedCount() {
    return this._good().length;
  }

  /** The counted drives that have been processed (PROCESSED_LEVEL up). */
  get processedCount() {
    return this._good().filter(drive => (drive.signalLevel ?? 1) >= PROCESSED_LEVEL).length;
  }

  /** Whether enough saved drives are docked to pass the night, and enough
   *  of them processed. */
  isQuotaMet() {
    return this.collectedCount >= this.requiredCount
      && this.processedCount >= this.requiredProcessed;
  }

  /** Night reset: wipe every drive seated in the docked box (even over
   *  quota) and release the box back to normal physics.
   *  @returns {object|null} the released box, or null if none was docked. */
  empty() {
    const box = this.depositedBox;
    if (!box) return null;
    for (const drive of box.receiver.attachedItems) {
      drive?.setEjected?.();
    }
    return this.socket.detach(box);
  }

  /** The drives in the docked box that count: saved and not corrupted. */
  _good() {
    const box = this.depositedBox;
    if (!box) return [];
    return box.receiver.attachedItems.filter(drive => drive?.saved && !drive?.corrupted);
  }
}
