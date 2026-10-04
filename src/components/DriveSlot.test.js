import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { DriveSlot } from './DriveSlot.js';
import { Pickupable } from './Pickupable.js';

// ── Helpers ──────────────────────────────────────────────────

/** Minimal mock drive with position, Pickupable, and physics stubs. */
function makeMockDrive(name = 'Drive_1', position = [0, 0, 0], held = false) {
  const pickupable = new Pickupable();
  pickupable.held = held;
  const object3d = new THREE.Object3D();
  object3d.name = name;
  object3d.position.set(...position);
  return {
    name,
    object3d,
    components: [pickupable],
    saved: false,
    rigidBody: {
      setTranslation: vi.fn(),
      setRotation: vi.fn(),
    },
    makeKinematic: vi.fn(),
    makeDynamic: vi.fn(),
    setSaved(v) { this.saved = v; },
    getComponent(Type) {
      return this.components.find(c => c instanceof Type) ?? null;
    },
    _pickupable: pickupable,
  };
}

/** Minimal mock DriveManager. */
function makeMockDriveManager() {
  return {
    drives: [],
    insertedDrive: null,
    addDrive: vi.fn(function(drive) {
      if (drive && !this.drives.includes(drive)) this.drives.push(drive);
    }),
    insertDrive: vi.fn(function(drive) {
      if (this.insertedDrive || !drive) return false;
      if (!this.drives.includes(drive)) return false;
      this.insertedDrive = drive;
      return true;
    }),
    ejectDrive: vi.fn(function() {
      const drive = this.insertedDrive;
      this.insertedDrive = null;
      return drive;
    }),
  };
}

/** Create a DriveSlot attached to a minimal GameObject-like object. */
function makeSlotWithContext(opts = {}) {
  const slot = new DriveSlot(opts);
  // Simulate the GameObject wrapper
  const object3d = new THREE.Object3D();
  slot.gameObject = {
    object3d,
    scene: { userData: { engine: null } },
  };
  return slot;
}

// ── Tests ────────────────────────────────────────────────────

describe('DriveSlot', () => {
  it('starts with no inserted drive', () => {
    const slot = makeSlotWithContext();
    expect(slot.hasDrive).toBe(false);
    expect(slot.insertedDrive).toBeNull();
  });

  it('addDrive registers a drive to watch', () => {
    const slot = makeSlotWithContext();
    const drive = makeMockDrive();
    slot.addDrive(drive);
    expect(slot.drives).toHaveLength(1);
    expect(slot.drives[0]).toBe(drive);
  });

  it('addDrive does not duplicate', () => {
    const slot = makeSlotWithContext();
    const drive = makeMockDrive();
    slot.addDrive(drive);
    slot.addDrive(drive);
    expect(slot.drives).toHaveLength(1);
  });

  it('bindDriveManager stores the manager reference', () => {
    const slot = makeSlotWithContext();
    const dm = makeMockDriveManager();
    slot.bindDriveManager(dm);
    expect(slot.driveManager).toBe(dm);
  });

  it('snaps a nearby unheld drive when none is inserted', () => {
    const slot = makeSlotWithContext({ snapDistance: 0.5 });
    slot.gameObject.object3d.position.set(0, 0, 0);
    
    const dm = makeMockDriveManager();
    slot.bindDriveManager(dm);
    
    const drive = makeMockDrive('Drive_1', [0.1, 0, 0]); // within 0.5m
    slot.addDrive(drive);
    dm.addDrive(drive);
    
    slot.onUpdate(0.016);
    
    expect(dm.insertDrive).toHaveBeenCalledWith(drive);
    expect(drive.makeKinematic).toHaveBeenCalled();
    expect(slot.hasDrive).toBe(true);
    expect(slot.insertedDrive).toBe(drive);
  });

  it('does not snap a held drive', () => {
    const slot = makeSlotWithContext({ snapDistance: 0.5 });
    slot.gameObject.object3d.position.set(0, 0, 0);
    
    const dm = makeMockDriveManager();
    slot.bindDriveManager(dm);
    
    const drive = makeMockDrive('Drive_1', [0.1, 0, 0], true); // held
    slot.addDrive(drive);
    dm.addDrive(drive);
    
    slot.onUpdate(0.016);
    
    expect(dm.insertDrive).not.toHaveBeenCalled();
    expect(drive.makeKinematic).not.toHaveBeenCalled();
    expect(slot.hasDrive).toBe(false);
  });

  it('does not snap when a drive is already inserted', () => {
    const slot = makeSlotWithContext({ snapDistance: 0.5 });
    slot.gameObject.object3d.position.set(0, 0, 0);
    
    const dm = makeMockDriveManager();
    slot.bindDriveManager(dm);
    
    const drive1 = makeMockDrive('Drive_1', [0.1, 0, 0]);
    const drive2 = makeMockDrive('Drive_2', [0.2, 0, 0]);
    slot.addDrive(drive1);
    slot.addDrive(drive2);
    dm.addDrive(drive1);
    dm.addDrive(drive2);
    
    // Insert first drive
    slot.onUpdate(0.016);
    expect(dm.insertDrive).toHaveBeenCalledWith(drive1);
    expect(slot.insertedDrive).toBe(drive1);
    
    // Second drive should not be inserted
    expect(dm.insertDrive).toHaveBeenCalledTimes(1);
    expect(slot.insertedDrive).toBe(drive1);
  });

  it('respects snapDistance (drive too far away is not snapped)', () => {
    const slot = makeSlotWithContext({ snapDistance: 0.5 });
    slot.gameObject.object3d.position.set(0, 0, 0);
    
    const dm = makeMockDriveManager();
    slot.bindDriveManager(dm);
    
    const drive = makeMockDrive('Drive_1', [1.0, 0, 0]); // too far
    slot.addDrive(drive);
    dm.addDrive(drive);
    
    slot.onUpdate(0.016);
    
    expect(dm.insertDrive).not.toHaveBeenCalled();
    expect(drive.makeKinematic).not.toHaveBeenCalled();
    expect(slot.hasDrive).toBe(false);
  });

  it('detects when the inserted drive is picked up (held flag set)', () => {
    const slot = makeSlotWithContext({ snapDistance: 0.5 });
    slot.gameObject.object3d.position.set(0, 0, 0);
    
    const dm = makeMockDriveManager();
    slot.bindDriveManager(dm);
    
    const drive = makeMockDrive('Drive_1', [0.1, 0, 0]);
    slot.addDrive(drive);
    dm.addDrive(drive);
    
    // Insert the drive
    slot.onUpdate(0.016);
    expect(slot.hasDrive).toBe(true);
    expect(slot.insertedDrive).toBe(drive);
    
    // Simulate player picking it up (PickupSystem sets held = true)
    drive._pickupable.held = true;
    
    // Next update should detect removal
    slot.onUpdate(0.016);
    
    expect(dm.ejectDrive).toHaveBeenCalled();
    expect(drive.makeDynamic).toHaveBeenCalled();
    expect(slot.hasDrive).toBe(false);
    expect(slot.insertedDrive).toBeNull();
  });

  it('calls makeKinematic on insert and makeDynamic on removal', () => {
    const slot = makeSlotWithContext({ snapDistance: 0.5 });
    slot.gameObject.object3d.position.set(0, 0, 0);
    
    const dm = makeMockDriveManager();
    slot.bindDriveManager(dm);
    
    const drive = makeMockDrive('Drive_1', [0.1, 0, 0]);
    slot.addDrive(drive);
    dm.addDrive(drive);
    
    // Insert
    slot.onUpdate(0.016);
    expect(drive.makeKinematic).toHaveBeenCalledTimes(1);
    expect(drive.makeDynamic).not.toHaveBeenCalled();
    
    // Remove
    drive._pickupable.held = true;
    slot.onUpdate(0.016);
    expect(drive.makeDynamic).toHaveBeenCalledTimes(1);
  });

  it('snaps the drive position to the slot with configured offset', () => {
    const slot = makeSlotWithContext({ snapDistance: 0.5, snapOffset: { y: 0.05 } });
    slot.gameObject.object3d.position.set(1, 2, 3);
    
    const dm = makeMockDriveManager();
    slot.bindDriveManager(dm);
    
    const drive = makeMockDrive('Drive_1', [1.1, 2, 3]);
    slot.addDrive(drive);
    dm.addDrive(drive);
    
    slot.onUpdate(0.016);
    
    // Check that setTranslation was called with slot position + offset
    expect(drive.rigidBody.setTranslation).toHaveBeenCalled();
    const [pos] = drive.rigidBody.setTranslation.mock.calls[0];
    expect(pos.x).toBeCloseTo(1, 5);
    expect(pos.y).toBeCloseTo(2.05, 5); // 2 + 0.05 offset
    expect(pos.z).toBeCloseTo(3, 5);
  });

  it('works without a DriveManager (local insertion tracking only)', () => {
    const slot = makeSlotWithContext({ snapDistance: 0.5 });
    slot.gameObject.object3d.position.set(0, 0, 0);
    
    const drive = makeMockDrive('Drive_1', [0.1, 0, 0]);
    slot.addDrive(drive);
    
    // No manager bound — slot still snaps the drive locally.
    slot.onUpdate(0.016);
    expect(slot.hasDrive).toBe(true);
    expect(slot.insertedDrive).toBe(drive);
    expect(drive.makeKinematic).toHaveBeenCalled();
    
    // Pick it up — slot ejects locally.
    drive._pickupable.held = true;
    slot.onUpdate(0.016);
    expect(slot.hasDrive).toBe(false);
    expect(drive.makeDynamic).toHaveBeenCalled();
  });

  it('fires onDriveInserted callback when a drive snaps in', () => {
    const onInsert = vi.fn();
    const slot = makeSlotWithContext({ snapDistance: 0.5, onDriveInserted: onInsert });
    slot.gameObject.object3d.position.set(0, 0, 0);

    const drive = makeMockDrive('Drive_1', [0.1, 0, 0]);
    slot.addDrive(drive);

    slot.onUpdate(0.016);
    expect(onInsert).toHaveBeenCalledWith(drive);
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  it('fires onDriveRemoved callback when the inserted drive is picked up', () => {
    const onRemove = vi.fn();
    const slot = makeSlotWithContext({ snapDistance: 0.5, onDriveRemoved: onRemove });
    slot.gameObject.object3d.position.set(0, 0, 0);

    const drive = makeMockDrive('Drive_1', [0.1, 0, 0]);
    slot.addDrive(drive);

    // Insert the drive
    slot.onUpdate(0.016);
    expect(slot.hasDrive).toBe(true);
    expect(onRemove).not.toHaveBeenCalled();

    // Pick it up
    drive._pickupable.held = true;
    slot.onUpdate(0.016);
    expect(onRemove).toHaveBeenCalledWith(drive);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('does nothing without any drives registered', () => {
    const slot = makeSlotWithContext({ snapDistance: 0.5 });
    slot.gameObject.object3d.position.set(0, 0, 0);
    
    const dm = makeMockDriveManager();
    slot.bindDriveManager(dm);
    
    // No drives added
    expect(() => slot.onUpdate(0.016)).not.toThrow();
    expect(slot.hasDrive).toBe(false);
  });
});
