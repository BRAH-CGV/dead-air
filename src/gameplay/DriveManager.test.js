import { describe, it, expect, vi } from 'vitest';
import { DriveManager } from './DriveManager.js';
import { Pickupable } from '../components/Pickupable.js';

// ── Helpers ──────────────────────────────────────────────────

/** Minimal mock drive with a real Pickupable component. */
function makeMockDrive(held = false) {
  const pickupable = new Pickupable();
  pickupable.held = held;
  return {
    name: `Drive_${Math.random().toString(36).slice(2, 6)}`,
    components: [pickupable],
    saved: false,
    corrupted: false,
    setSaved(v, { corrupted = false } = {}) { this.saved = v; this.corrupted = v && corrupted; },
    getComponent(Type) {
      return this.components.find(c => c instanceof Type) ?? null;
    },
    _pickupable: pickupable,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('DriveManager', () => {
  it('starts empty with no drives', () => {
    const dm = new DriveManager();
    expect(dm.drives).toHaveLength(0);
    expect(dm.totalDrives).toBe(0);
    expect(dm.insertedDrive).toBeNull();
    expect(dm.driveInserted).toBe(false);
    expect(dm.signalsOnDrive).toBe(0);
  });

  it('addDrive registers a drive', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    dm.addDrive(d);
    expect(dm.drives).toHaveLength(1);
    expect(dm.totalDrives).toBe(1);
  });

  it('addDrive does not duplicate', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    dm.addDrive(d);
    dm.addDrive(d);
    expect(dm.drives).toHaveLength(1);
  });

  it('removeDrive unregisters a drive', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    dm.addDrive(d);
    dm.removeDrive(d);
    expect(dm.drives).toHaveLength(0);
  });

  it('removeDrive clears insertedDrive if that drive is removed', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    dm.addDrive(d);
    dm.insertDrive(d);
    expect(dm.driveInserted).toBe(true);
    dm.removeDrive(d);
    expect(dm.insertedDrive).toBeNull();
    expect(dm.driveInserted).toBe(false);
  });

  // ── Available drives ──

  it('hasAvailableDrives is true when drives are not held and not inserted', () => {
    const dm = new DriveManager();
    const d = makeMockDrive(false);
    dm.addDrive(d);
    expect(dm.hasAvailableDrives()).toBe(true);
  });

  it('hasAvailableDrives is false when all drives are held', () => {
    const dm = new DriveManager();
    const d = makeMockDrive(true);  // held by player
    dm.addDrive(d);
    expect(dm.hasAvailableDrives()).toBe(false);
  });

  it('hasAvailableDrives is false when the drive is inserted', () => {
    const dm = new DriveManager();
    const d = makeMockDrive(false);
    dm.addDrive(d);
    dm.insertDrive(d);
    expect(dm.hasAvailableDrives()).toBe(false);
  });

  // ── Insert ──

  it('insertDrive puts a specific drive into the reader', () => {
    const dm = new DriveManager();
    const d1 = makeMockDrive();
    const d2 = makeMockDrive();
    dm.addDrive(d1);
    dm.addDrive(d2);

    const ok = dm.insertDrive(d1);
    expect(ok).toBe(true);
    expect(dm.insertedDrive).toBe(d1);
    expect(dm.driveInserted).toBe(true);
    expect(dm.signalsOnDrive).toBe(0);
  });

  it('insertDrive fails when a drive is already inserted', () => {
    const dm = new DriveManager();
    const d1 = makeMockDrive();
    const d2 = makeMockDrive();
    dm.addDrive(d1);
    dm.addDrive(d2);
    dm.insertDrive(d1);
    expect(dm.insertDrive(d2)).toBe(false);
    expect(dm.insertedDrive).toBe(d1);
  });

  it('insertDrive fails for an unregistered drive', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    expect(dm.insertDrive(d)).toBe(false);
  });

  it('insertDrive fails for null', () => {
    const dm = new DriveManager();
    expect(dm.insertDrive(null)).toBe(false);
  });

  // ── Eject ──

  it('ejectDrive returns the inserted drive and resets signals', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    dm.addDrive(d);
    dm.insertDrive(d);
    dm.saveToDrive();
    dm.saveToDrive();
    expect(dm.signalsOnDrive).toBe(2);

    const ejected = dm.ejectDrive();
    expect(ejected).toBe(d);
    expect(dm.insertedDrive).toBeNull();
    expect(dm.driveInserted).toBe(false);
    expect(dm.signalsOnDrive).toBe(0);
  });

  it('ejectDrive returns null when no drive is inserted', () => {
    const dm = new DriveManager();
    expect(dm.ejectDrive()).toBeNull();
  });

  // ── Eject with impulse (evil signal) ──

  it('ejectInsertedDrive returns null when no drive is inserted', () => {
    const dm = new DriveManager();
    expect(dm.ejectInsertedDrive()).toBeNull();
  });

  it('ejectInsertedDrive detaches via the snap socket and applies a random kick', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    const detach = vi.fn();
    const setLinvel = vi.fn();
    const setAngvel = vi.fn();
    d._snapOwner = { detach, reject: vi.fn() };
    d.rigidBody = { setLinvel, setAngvel };
    dm.addDrive(d);
    dm.insertDrive(d);

    const ejected = dm.ejectInsertedDrive();
    expect(ejected).toBe(d);
    expect(detach).toHaveBeenCalledWith(d);
    expect(dm.insertedDrive).toBeNull();
    expect(setLinvel).toHaveBeenCalledTimes(1);
    expect(setAngvel).toHaveBeenCalledTimes(1);
    // The socket is told to reject the drive so it doesn't re-snap.
    expect(d._snapOwner.reject).toHaveBeenCalledWith(d);
    // The upward component is always positive (the drive flies up, not down).
    const linvel = setLinvel.mock.calls[0][0];
    expect(linvel.y).toBeGreaterThan(0);
  });

  it('ejectInsertedDrive works without a rigidBody (no physics yet)', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    const detach = vi.fn();
    d._snapOwner = { detach, reject: vi.fn() };
    // No rigidBody — the drive hasn't been _init'd yet.
    dm.addDrive(d);
    dm.insertDrive(d);

    const ejected = dm.ejectInsertedDrive();
    expect(ejected).toBe(d);
    expect(detach).toHaveBeenCalledWith(d);
  });

  it('ejectInsertedDrive works without a snap owner (drive not in a slot)', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    // No _snapOwner — the drive is inserted in the manager but not snapped.
    dm.addDrive(d);
    dm.insertDrive(d);

    const ejected = dm.ejectInsertedDrive();
    expect(ejected).toBe(d);
    expect(dm.insertedDrive).toBeNull();
  });

  // ── Save ──

  it('saveToDrive increments the signal count on the drive', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    dm.addDrive(d);
    dm.insertDrive(d);
    expect(dm.saveToDrive()).toBe(1);
    expect(dm.saveToDrive()).toBe(2);
    expect(dm.signalsOnDrive).toBe(2);
  });

  it('saveToDrive is a no-op without an inserted drive', () => {
    const dm = new DriveManager();
    expect(dm.saveToDrive()).toBe(0);
    expect(dm.signalsOnDrive).toBe(0);
  });

  it('saveToDrive marks the inserted drive as saved', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    dm.addDrive(d);
    dm.insertDrive(d);
    expect(d.saved).toBe(false);
    dm.saveToDrive();
    expect(d.saved).toBe(true);
  });

  // ── Save (the red one) ──

  it('saveEvilToDrive marks the inserted drive saved and corrupted', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    dm.addDrive(d);
    dm.insertDrive(d);
    expect(dm.saveEvilToDrive()).toBe(1);
    expect(d.saved).toBe(true);
    expect(d.corrupted).toBe(true);
    expect(dm.signalsOnDrive).toBe(1);
  });

  it('saveEvilToDrive is a no-op without an inserted drive', () => {
    const dm = new DriveManager();
    expect(dm.saveEvilToDrive()).toBe(0);
    expect(dm.signalsOnDrive).toBe(0);
  });

  it('a corrupted drive still reads as having a signal', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    dm.addDrive(d);
    dm.insertDrive(d);
    dm.saveEvilToDrive();
    expect(dm.insertedDriveHasSignal).toBe(true);
  });

  // ── insertedDriveHasSignal ──

  it('insertedDriveHasSignal is false when no drive is inserted', () => {
    const dm = new DriveManager();
    expect(dm.insertedDriveHasSignal).toBe(false);
  });

  it('insertedDriveHasSignal is false when the inserted drive has no signal', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    dm.addDrive(d);
    dm.insertDrive(d);
    expect(dm.insertedDriveHasSignal).toBe(false);
  });

  it('insertedDriveHasSignal is true after saveToDrive', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    dm.addDrive(d);
    dm.insertDrive(d);
    dm.saveToDrive();
    expect(dm.insertedDriveHasSignal).toBe(true);
  });

  // ── clearInsertedDriveSignal ──

  it('clearInsertedDriveSignal resets the drive and zeroes the counter', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    dm.addDrive(d);
    dm.insertDrive(d);
    dm.saveToDrive();
    dm.saveToDrive();
    expect(d.saved).toBe(true);
    expect(dm.signalsOnDrive).toBe(2);

    const result = dm.clearInsertedDriveSignal();
    expect(result).toBe(true);
    expect(d.saved).toBe(false);
    expect(dm.signalsOnDrive).toBe(0);
  });

  it('clearInsertedDriveSignal wipes a corrupted drive back to blank', () => {
    const dm = new DriveManager();
    const d = makeMockDrive();
    dm.addDrive(d);
    dm.insertDrive(d);
    dm.saveEvilToDrive();
    expect(d.corrupted).toBe(true);

    expect(dm.clearInsertedDriveSignal()).toBe(true);
    expect(d.saved).toBe(false);
    expect(d.corrupted).toBe(false);
  });

  it('clearInsertedDriveSignal is a no-op without an inserted drive', () => {
    const dm = new DriveManager();
    expect(dm.clearInsertedDriveSignal()).toBe(false);
  });

  // ── Full cycle ──

  it('supports a full insert → save → eject → reinsert cycle', () => {
    const dm = new DriveManager();
    const d1 = makeMockDrive();
    const d2 = makeMockDrive();
    dm.addDrive(d1);
    dm.addDrive(d2);

    dm.insertDrive(d1);
    dm.saveToDrive();
    const ejected = dm.ejectDrive();
    expect(ejected).toBe(d1);
    expect(dm.hasAvailableDrives()).toBe(true);

    dm.insertDrive(d2);
    expect(dm.insertedDrive).toBe(d2);
    expect(dm.signalsOnDrive).toBe(0);   // reset on new insert
    dm.saveToDrive();
    expect(dm.signalsOnDrive).toBe(1);
  });
});
