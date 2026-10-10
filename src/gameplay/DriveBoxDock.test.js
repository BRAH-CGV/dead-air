import { describe, it, expect } from 'vitest';
import { DriveBoxDock } from './DriveBoxDock.js';

// Pure stub sockets: the dock only reads `socket.firstAttached`,
// `box.receiver.attachedItems` and calls `socket.detach(box)` — no physics
// or scene graph needed.

/** A duck-typed seated drive: only `saved`, `corrupted` and `setEjected`
 *  matter. setEjected mirrors the real Drive — it clears both flags. */
function makeDrive({ saved = false, corrupted = false } = {}) {
  return {
    saved,
    corrupted,
    setEjected() { this.saved = false; this.corrupted = false; },
  };
}

/** A duck-typed docked box: the dock reads its receiver's attachedItems. */
function makeBox(drives = []) {
  return { receiver: { attachedItems: drives } };
}

/** A duck-typed SnapSocket whose single occupant the test controls. */
function makeSocket(box = null) {
  return {
    firstAttached: box,
    detach(item) { return item; },
  };
}

describe('DriveBoxDock', () => {
  it('counts nothing when no box is docked', () => {
    const dock = new DriveBoxDock({ socket: makeSocket(null), requiredCount: 2 });

    expect(dock.depositedBox).toBeNull();
    expect(dock.collectedCount).toBe(0);
    expect(dock.isQuotaMet()).toBe(false);
  });

  it('counts only the saved drives seated in the docked box', () => {
    const box = makeBox([
      makeDrive({ saved: true }),
      makeDrive({ saved: false }),
      makeDrive({ saved: true }),
      null,
    ]);
    const dock = new DriveBoxDock({ socket: makeSocket(box), requiredCount: 2 });

    expect(dock.depositedBox).toBe(box);
    expect(dock.collectedCount).toBe(2);
    expect(dock.isQuotaMet()).toBe(true);
  });

  it('never counts a corrupted (red) drive, even seated saved in the dock', () => {
    const box = makeBox([
      makeDrive({ saved: true }),
      makeDrive({ saved: true, corrupted: true }),
      makeDrive({ saved: true, corrupted: true }),
    ]);
    const dock = new DriveBoxDock({ socket: makeSocket(box), requiredCount: 2 });

    expect(dock.collectedCount).toBe(1);
    expect(dock.isQuotaMet()).toBe(false);
  });

  it('ignores saved drives in boxes that are not docked', () => {
    const docked = makeBox([makeDrive({ saved: false })]);
    const elsewhere = makeBox([makeDrive({ saved: true }), makeDrive({ saved: true })]);
    const dock = new DriveBoxDock({ socket: makeSocket(docked), requiredCount: 1 });

    expect(dock.collectedCount).toBe(0);
    expect(dock.isQuotaMet()).toBe(false);
    expect(elsewhere.receiver.attachedItems).toHaveLength(2);
  });

  it('isQuotaMet() tracks requiredCount changes', () => {
    const box = makeBox([makeDrive({ saved: true })]);
    const dock = new DriveBoxDock({ socket: makeSocket(box), requiredCount: 2 });

    expect(dock.isQuotaMet()).toBe(false);
    dock.requiredCount = 1;
    expect(dock.isQuotaMet()).toBe(true);
  });

  it('empty() wipes every seated drive and returns the released box', () => {
    const drives = [
      makeDrive({ saved: true }),
      makeDrive({ saved: true }),
      makeDrive({ saved: true }),
    ];
    const box = makeBox(drives);
    let detached = null;
    const socket = makeSocket(box);
    socket.detach = item => { detached = item; return item; };
    const dock = new DriveBoxDock({ socket, requiredCount: 3 });

    const released = dock.empty();

    expect(released).toBe(box);
    expect(detached).toBe(box);
    for (const drive of drives) expect(drive.saved).toBe(false);
  });

  it('empty() clears corruption along with the save', () => {
    const drive = makeDrive({ saved: true, corrupted: true });
    const box = makeBox([drive]);
    const dock = new DriveBoxDock({ socket: makeSocket(box) });

    expect(dock.empty()).toBe(box);
    expect(drive.saved).toBe(false);
    expect(drive.corrupted).toBe(false);
  });

  it('empty() tolerates empty slots among the seated drives', () => {
    const drive = makeDrive({ saved: true });
    const box = makeBox([null, drive, null]);
    const dock = new DriveBoxDock({ socket: makeSocket(box) });

    expect(dock.empty()).toBe(box);
    expect(drive.saved).toBe(false);
  });

  it('empty() with nothing docked returns null', () => {
    const dock = new DriveBoxDock({ socket: makeSocket(null) });

    expect(dock.empty()).toBeNull();
  });
});
