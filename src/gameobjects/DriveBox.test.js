import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { DriveBox } from './DriveBox.js';
import { Pickupable } from '../components/Pickupable.js';
import { ImpactSound, IMPACT_SOUNDS } from '../components/ImpactSound.js';
import { FakeWorld, rapierModule } from '../test/fakeRapier.js';

function makeSceneContext() {
  const scene = new THREE.Scene();
  const engine = {
    RAPIER: rapierModule().default,
    _bodyToGO: new Map(),
    rigidBodyMap: new Map(),
  };
  scene.userData.engine = engine;
  return { scene, world: new FakeWorld(), engine };
}

function makeDrive(position = [0, 0, 0]) {
  const pickupable = new Pickupable();
  pickupable.promptLabel = '[E] Pick up';
  const object3d = new THREE.Object3D();
  object3d.position.set(...position);
  return {
    isDrive: true,
    object3d,
    components: [pickupable],
    rigidBody: {
      setTranslation: vi.fn(),
      setRotation: vi.fn(),
    },
    makeKinematic: vi.fn(),
    makeDynamic: vi.fn(),
    getComponent(Type) {
      return this.components.find(c => c instanceof Type) ?? null;
    },
    _pickupable: pickupable,
  };
}

describe('DriveBox', () => {
  it('carries the box clips for when it is put down or dropped', () => {
    const impact = new DriveBox().getComponent(ImpactSound);
    expect(impact).toBeTruthy();
    expect(impact.clips).toEqual(IMPACT_SOUNDS.box.clips);
    // Picked up, docked and undocked with a clip of its own.
    expect(impact.handling).toEqual(IMPACT_SOUNDS.box.handling);
  });

  it('seats and gives up its drives with their own knock, not a beep', () => {
    expect(new DriveBox().receiver.sounds).toBe('item');
  });

  it('creates a dynamic physics pickupable box on init', () => {
    const box = new DriveBox('ExampleDriveBox');
    const { scene, world, engine } = makeSceneContext();

    box._init(scene, world);

    expect(box.rigidBody).toBeTruthy();
    expect(box.collider).toBeTruthy();
    // Low magazine: half the old height, z ≈ 0.8×x.
    expect(box.collider.halfExtents()).toEqual({ x: 0.16, y: 0.06, z: 0.14 });
    expect(box.getComponent(Pickupable)?.promptLabel).toBe('[E] Pick up drive box');
    expect(box.snapDistance).toBe(0.1);
    expect(engine.rigidBodyMap.get(box.rigidBody.handle)).toBe(box);
  });

  it('marks itself as a drive box for snap receivers', () => {
    const box = new DriveBox('ExampleDriveBox');
    expect(box.isDriveBox).toBe(true);
  });

  it('makeKinematic swaps to a kinematic body at the same pose', () => {
    const box = new DriveBox('ExampleDriveBox');
    const { scene, world, engine } = makeSceneContext();
    box._init(scene, world);
    box.rigidBody.setTranslation({ x: 3, y: 1.2, z: -2 }, true);
    const oldHandle = box.rigidBody.handle;

    box.makeKinematic();

    expect(box.rigidBody.bodyType()).toBe('kinematic');
    expect(box.rigidBody.handle).not.toBe(oldHandle);
    expect(box.rigidBody.translation()).toEqual({ x: 3, y: 1.2, z: -2 });
    // The engine maps follow the rebuild: old entry gone, new one registered.
    expect(engine.rigidBodyMap.get(box.rigidBody.handle)).toBe(box);
    expect(engine._bodyToGO.get(box.rigidBody.handle)).toBe(box);
    expect(engine.rigidBodyMap.has(oldHandle)).toBe(false);
  });

  it('makeDynamic swaps back to a dynamic body', () => {
    const box = new DriveBox('ExampleDriveBox');
    const { scene, world, engine } = makeSceneContext();
    box._init(scene, world);
    box.makeKinematic();

    box.makeDynamic();

    expect(box.rigidBody.bodyType()).toBe('dynamic');
    expect(engine.rigidBodyMap.get(box.rigidBody.handle)).toBe(box);
    // The rebuilt collider matches the visual, same as the initial body.
    expect(box.collider.halfExtents()).toEqual({ x: 0.16, y: 0.06, z: 0.14 });
  });

  it('snaps a drive to a floating socket and changes its prompt', () => {
    const box = new DriveBox('ExampleDriveBox', { snapDistance: 0.5 });
    const drive = makeDrive([0, 0.1, 0]);
    box.addDrive(drive);

    box.receiver.onUpdate(0.016);

    expect(box.insertedDrive).toBe(drive);
    expect(drive.makeKinematic).toHaveBeenCalledTimes(1);
    expect(drive._pickupable.promptLabel).toBe('[E] Take drive');
  });

  it('detaches the drive before pickup and restores its prompt', () => {
    const box = new DriveBox('ExampleDriveBox', { snapDistance: 0.5 });
    const drive = makeDrive([0, 0.1, 0]);
    box.addDrive(drive);
    box.receiver.onUpdate(0.016);

    drive._pickupable.onBeforePickUp();

    expect(box.insertedDrive).toBeNull();
    expect(drive.makeDynamic).toHaveBeenCalledTimes(1);
    expect(drive._pickupable.promptLabel).toBe('[E] Pick up');
  });

  it('moves the attached drive with the box', () => {
    const box = new DriveBox('ExampleDriveBox', { snapDistance: 0.5 });
    const drive = makeDrive([0, 0.1, 0]);
    box.addDrive(drive);
    box.receiver.onUpdate(0.016);

    box.object3d.position.set(2, 0, -1);
    box.receiver.onUpdate(0.016);

    const calls = drive.rigidBody.setTranslation.mock.calls;
    const [pos] = calls[calls.length - 1];
    const slot = box.receiver.slots[0].offset;
    expect(pos.x).toBeCloseTo(2 + slot.x);
    expect(pos.y).toBeCloseTo(slot.y);
    expect(pos.z).toBeCloseTo(-1 + slot.z);
  });

  it('carries two rows of four drive sockets on its lid', () => {
    const box = new DriveBox('ExampleDriveBox');
    const slots = box.receiver.slots;

    expect(box.slotRows).toBe(2);
    expect(box.slotColumns).toBe(4);
    expect(slots).toHaveLength(8);
    expect(new Set(slots.map(s => s.offset.x)).size).toBe(4);
    expect(new Set(slots.map(s => s.offset.y)).size).toBe(1);
    expect(new Set(slots.map(s => s.offset.z)).size).toBe(2);
    // Standing drives have a [0.02, 0.12, 0.08] footprint: columns within a
    // row sit at 4× that footprint (0.08 pitch) along x, rows keep a gutter
    // apart along z, and sockets seat 0.02 below the lid (0.06 − 0.02).
    expect(slots[0].offset.x).toBeCloseTo(-0.12);
    expect(slots[0].offset.y).toBeCloseTo(0.04);
    expect(slots[0].offset.z).toBeCloseTo(-0.06);
  });

  it('snaps drives in standing: 90° about X, then 90° about Y', () => {
    const box = new DriveBox('ExampleDriveBox', { snapDistance: 0.5 });
    const drive = makeDrive([0, 0.3, 0]);
    box.addDrive(drive);
    box.receiver.onUpdate(0.016);

    const calls = drive.rigidBody.setRotation.mock.calls;
    const [q] = calls[calls.length - 1];
    const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    // The long axis points down the lid's Y; the thin edge faces +X.
    const long = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    const thin = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    expect(long.x).toBeCloseTo(0);
    expect(long.y).toBeCloseTo(-1);
    expect(long.z).toBeCloseTo(0);
    expect(thin.x).toBeCloseTo(1);
    expect(thin.y).toBeCloseTo(0);
    expect(thin.z).toBeCloseTo(0);
  });

  it('holds eight drives at once, one per socket', () => {
    const box = new DriveBox('ExampleDriveBox', { snapDistance: 0.02 });
    const drives = box.receiver.slots.map(slot => {
      const drive = makeDrive([slot.offset.x, slot.offset.y, slot.offset.z]);
      box.addDrive(drive);
      return drive;
    });

    for (let i = 0; i < drives.length; i++) box.receiver.onUpdate(0.016);

    expect(box.receiver.attachedItems).toEqual(drives);
  });

  it('takes one drive out of a full box and leaves the rest attached', () => {
    const box = new DriveBox('ExampleDriveBox', { snapDistance: 0.02 });
    const drives = box.receiver.slots.map(slot => {
      const drive = makeDrive([slot.offset.x, slot.offset.y, slot.offset.z]);
      box.addDrive(drive);
      return drive;
    });
    for (let i = 0; i < drives.length; i++) box.receiver.onUpdate(0.016);

    drives[3]._pickupable.onBeforePickUp();

    const attached = box.receiver.attachedItems;
    expect(attached[3]).toBeNull();
    expect(attached.filter(Boolean)).toHaveLength(7);
    expect(drives[3].makeDynamic).toHaveBeenCalledTimes(1);
    expect(drives[3]._pickupable.promptLabel).toBe('[E] Pick up');
  });
});
