import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { QuotaBox } from './QuotaBox.js';
import { Pickupable } from '../components/Pickupable.js';

// ── Helpers ──────────────────────────────────────────────────

/** Minimal mock drive with position, Pickupable, and physics stubs. */
function makeMockDrive(name = 'Drive_1', position = [0, 0, 0]) {
  const pickupable = new Pickupable();
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

/** Create a QuotaBox with a mock gameObject context. */
function makeQuotaBoxWithContext(opts = {}) {
  const qb = new QuotaBox(opts);
  const object3d = new THREE.Object3D();
  qb.gameObject = {
    object3d,
    scene: { userData: { engine: null } },
  };
  return qb;
}

// ── Tests ────────────────────────────────────────────────────

describe('QuotaBox', () => {
  it('starts with zero collected count', () => {
    const qb = makeQuotaBoxWithContext({ requiredCount: 3 });
    expect(qb.collectedCount).toBe(0);
  });

  it('collects a nearby SAVED drive', () => {
    const qb = makeQuotaBoxWithContext({ requiredCount: 3, snapDistance: 0.5 });
    qb.gameObject.object3d.position.set(0, 0, 0);

    const drive = makeMockDrive('Drive_1', [0.1, 0, 0]);
    drive.saved = true;
    qb.addDrive(drive);

    qb.onUpdate(0.016);
    expect(qb.collectedCount).toBe(1);
    expect(drive.makeKinematic).toHaveBeenCalled();
  });

  it('ignores nearby drives that have NOT been scanned', () => {
    const qb = makeQuotaBoxWithContext({ requiredCount: 3, snapDistance: 0.5 });
    qb.gameObject.object3d.position.set(0, 0, 0);

    const drive = makeMockDrive('Drive_1', [0.1, 0, 0]);
    // drive.saved is false (default)
    qb.addDrive(drive);

    qb.onUpdate(0.016);
    expect(qb.collectedCount).toBe(0);
    expect(drive.makeKinematic).not.toHaveBeenCalled();
  });

  it('ignores drives that are too far away', () => {
    const qb = makeQuotaBoxWithContext({ requiredCount: 3, snapDistance: 0.5 });
    qb.gameObject.object3d.position.set(0, 0, 0);

    const drive = makeMockDrive('Drive_1', [5, 0, 0]);  // far away
    drive.saved = true;
    qb.addDrive(drive);

    qb.onUpdate(0.016);
    expect(qb.collectedCount).toBe(0);
  });

  it('collects multiple saved drives', () => {
    const qb = makeQuotaBoxWithContext({ requiredCount: 3, snapDistance: 0.5 });
    qb.gameObject.object3d.position.set(0, 0, 0);

    const d1 = makeMockDrive('Drive_1', [0.1, 0, 0]);
    const d2 = makeMockDrive('Drive_2', [0.2, 0, 0]);
    const d3 = makeMockDrive('Drive_3', [0.3, 0, 0]);
    d1.saved = true;
    d2.saved = true;
    d3.saved = true;
    qb.addDrive(d1);
    qb.addDrive(d2);
    qb.addDrive(d3);

    qb.onUpdate(0.016);
    expect(qb.collectedCount).toBe(3);
  });

  it('only counts saved drives when mixed with unsaved ones', () => {
    const qb = makeQuotaBoxWithContext({ requiredCount: 3, snapDistance: 0.5 });
    qb.gameObject.object3d.position.set(0, 0, 0);

    const saved = makeMockDrive('Saved', [0.1, 0, 0]);
    const unsaved = makeMockDrive('Unsaved', [0.2, 0, 0]);
    saved.saved = true;
    // unsaved.saved stays false
    qb.addDrive(saved);
    qb.addDrive(unsaved);

    qb.onUpdate(0.016);
    expect(qb.collectedCount).toBe(1);
  });

  it('decrement count when a deposited drive is picked up', () => {
    const qb = makeQuotaBoxWithContext({ requiredCount: 3, snapDistance: 0.5 });
    qb.gameObject.object3d.position.set(0, 0, 0);

    const drive = makeMockDrive('Drive_1', [0.1, 0, 0]);
    drive.saved = true;
    qb.addDrive(drive);

    qb.onUpdate(0.016);
    expect(qb.collectedCount).toBe(1);

    // Player picks up the deposited drive
    drive._pickupable.held = true;
    qb.onUpdate(0.016);
    expect(qb.collectedCount).toBe(0);
  });

  it('isQuotaMet returns true when enough saved drives are collected', () => {
    const qb = makeQuotaBoxWithContext({ requiredCount: 2, snapDistance: 0.5 });
    qb.gameObject.object3d.position.set(0, 0, 0);

    const d1 = makeMockDrive('Drive_1', [0.1, 0, 0]);
    const d2 = makeMockDrive('Drive_2', [0.2, 0, 0]);
    d1.saved = true;
    d2.saved = true;
    qb.addDrive(d1);
    qb.addDrive(d2);

    expect(qb.isQuotaMet()).toBe(false);
    qb.onUpdate(0.016);
    expect(qb.isQuotaMet()).toBe(true);
  });

  it('reset ejects all deposited drives and zeroes count', () => {
    const qb = makeQuotaBoxWithContext({ requiredCount: 3, snapDistance: 0.5 });
    qb.gameObject.object3d.position.set(0, 0, 0);

    const d1 = makeMockDrive('Drive_1', [0.1, 0, 0]);
    const d2 = makeMockDrive('Drive_2', [0.2, 0, 0]);
    d1.saved = true;
    d2.saved = true;
    qb.addDrive(d1);
    qb.addDrive(d2);

    qb.onUpdate(0.016);
    expect(qb.collectedCount).toBe(2);

    qb.reset();
    expect(qb.collectedCount).toBe(0);
    expect(d1.makeDynamic).toHaveBeenCalled();
    expect(d2.makeDynamic).toHaveBeenCalled();
  });

  it('does not double-count a drive that stays near the box', () => {
    const qb = makeQuotaBoxWithContext({ requiredCount: 3, snapDistance: 0.5 });
    qb.gameObject.object3d.position.set(0, 0, 0);

    const drive = makeMockDrive('Drive_1', [0.1, 0, 0]);
    drive.saved = true;
    qb.addDrive(drive);

    qb.onUpdate(0.016);
    expect(qb.collectedCount).toBe(1);

    // Run another frame — the drive is still nearby but already deposited
    qb.onUpdate(0.016);
    expect(qb.collectedCount).toBe(1);
  });

  it('addDrive is idempotent (same drive added twice is only watched once)', () => {
    const qb = makeQuotaBoxWithContext({ requiredCount: 3, snapDistance: 0.5 });
    const drive = makeMockDrive('Drive_1', [0.1, 0, 0]);
    qb.addDrive(drive);
    qb.addDrive(drive);
    expect(qb.drives).toHaveLength(1);
  });

  it('count never goes below zero', () => {
    const qb = makeQuotaBoxWithContext({ requiredCount: 3 });
    qb._collected = 0;
    // Simulate a pickup when nothing is deposited
    qb.onUpdate(0.016);
    expect(qb.collectedCount).toBe(0);
  });
});
