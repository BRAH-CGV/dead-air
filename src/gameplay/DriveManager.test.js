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
