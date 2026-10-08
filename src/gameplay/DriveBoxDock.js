import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// DriveBoxDock  –  quota counter for a docked drive box (Component)
// ─────────────────────────────────────────────
// Sits on the airlock's dock pedestal, next to the SnapSocket that receives
// whole drive boxes. The night quota is no longer a pile of loose drives:
// whichever box is seated here counts only its signal-bearing drives.
//
// The count derives from the live socket on every read — no per-frame state
// — so picking the box back out (SnapSocket detaches it) drops it to zero.
//
// Usage:
//   const socket = pedestalGO.addComponent(new SnapSocket({
//     canAccept: item => item?.isDriveBox === true, ... }));
//   const dock = pedestalGO.addComponent(new DriveBoxDock({ socket }));
//   dock.requiredCount = 3;
//   dock.collectedCount;   // saved drives seated in the docked box
//   dock.isQuotaMet();     // collectedCount >= requiredCount
//   dock.empty();          // night reset: wipe + release the docked box
// ─────────────────────────────────────────────

export class DriveBoxDock extends Component {
  /** Saved drives needed to pass the night. */
  requiredCount = 0;

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
   *  count, and neither does anything outside the box. */
  get collectedCount() {
    const box = this.depositedBox;
    if (!box) return 0;
    return box.receiver.attachedItems.filter(drive => drive?.saved).length;
  }

  /** Whether enough saved drives are docked to pass the night. */
  isQuotaMet() {
    return this.collectedCount >= this.requiredCount;
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
}
