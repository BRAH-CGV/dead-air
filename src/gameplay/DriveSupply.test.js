import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { DriveSupply, createSupplyInteractable } from './DriveSupply.js';
import { Interactable } from '../components/Interactable.js';

// ── Helpers ──────────────────────────────────────────────────

/** Minimal mock drive with position stub. */
function makeMockDrive(name = 'Drive_1') {
  const object3d = new THREE.Object3D();
  object3d.name = name;
  return { name, object3d };
}

/** Create a DriveSupply with a mock gameObject context. */
function makeSupplyWithContext(opts = {}) {
  const supply = new DriveSupply(opts);
  const object3d = new THREE.Object3D();
  object3d.position.set(10, 0, 20); // distinct world position
  supply.gameObject = { object3d };
  return supply;
}

// ── Tests ────────────────────────────────────────────────────

describe('DriveSupply', () => {
  it('starts with zero remaining', () => {
    const supply = makeSupplyWithContext();
    expect(supply.remaining).toBe(0);
  });

  it('addDrive increases remaining count', () => {
    const supply = makeSupplyWithContext();
    const d1 = makeMockDrive('Drive_1');
    const d2 = makeMockDrive('Drive_2');
    supply.addDrive(d1);
    supply.addDrive(d2);
    expect(supply.remaining).toBe(2);
  });

  it('dispenseOne returns the next drive and decreases remaining', () => {
    const supply = makeSupplyWithContext();
    const d1 = makeMockDrive('Drive_1');
    const d2 = makeMockDrive('Drive_2');
    supply.addDrive(d1);
    supply.addDrive(d2);

    const dispensed = supply.dispenseOne();
    expect(dispensed).toBe(d1);
    expect(supply.remaining).toBe(1);
  });

  it('dispenseOne returns null when pool is empty', () => {
    const supply = makeSupplyWithContext();
    expect(supply.dispenseOne()).toBeNull();
  });

  it('reset returns all drives to the pool', () => {
    const supply = makeSupplyWithContext();
    supply.addDrive(makeMockDrive());
    supply.addDrive(makeMockDrive());
    supply.dispenseOne();
    expect(supply.remaining).toBe(1);

    supply.reset();
    expect(supply.remaining).toBe(2);  // all drives back in the pool
  });

  it('dispensed drive is positioned relative to the supply box', () => {
    const supply = makeSupplyWithContext({ dispenseOffset: [0.3, 0.1, 0.5] });
    supply.gameObject.object3d.position.set(10, 0, 20);

    const drive = makeMockDrive('Drive_1');
    supply.addDrive(drive);
    supply.dispenseOne();

    expect(drive.object3d.position.x).toBeCloseTo(10.3);
    expect(drive.object3d.position.y).toBeCloseTo(0.1);
    expect(drive.object3d.position.z).toBeCloseTo(20.5);
  });

  it('exposes all drives (including dispensed) via drives getter', () => {
    const supply = makeSupplyWithContext();
    const d1 = makeMockDrive('Drive_1');
    const d2 = makeMockDrive('Drive_2');
    supply.addDrive(d1);
    supply.addDrive(d2);

    expect(supply.drives).toContain(d1);
    expect(supply.drives).toContain(d2);
    expect(supply.drives).toHaveLength(2);

    // Even after dispensing, drives still lists all of them
    supply.dispenseOne();
    expect(supply.drives).toHaveLength(2);
  });
});

describe('createSupplyInteractable', () => {
  it('returns an Interactable that dispenses on interact', () => {
    const supply = makeSupplyWithContext();
    const d1 = makeMockDrive('Drive_1');
    supply.addDrive(d1);

    const interact = createSupplyInteractable(supply);
    expect(interact).toBeInstanceOf(Interactable);

    interact.onInteract();
    expect(supply.remaining).toBe(0);
    expect(d1.object3d.position.x).not.toBe(0); // was positioned
  });

  it('prompt shows "[E] Take a drive" when drives remain', () => {
    const supply = makeSupplyWithContext();
    supply.addDrive(makeMockDrive());

    const interact = createSupplyInteractable(supply);
    // Simulate hover refresh
    interact.onHover();
    expect(interact.promptLabel).toBe('[E] Take a drive');
  });

  it('prompt shows "No drives left" when empty', () => {
    const supply = makeSupplyWithContext();
    // No drives added

    const interact = createSupplyInteractable(supply);
    interact.onHover();
    expect(interact.promptLabel).toBe('No drives left');
  });
});
