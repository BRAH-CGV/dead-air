import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { DriveBox } from './DriveBox.js';
import { Pickupable } from '../components/Pickupable.js';
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
  it('creates a dynamic physics pickupable box on init', () => {
    const box = new DriveBox('ExampleDriveBox');
    const { scene, world, engine } = makeSceneContext();

    box._init(scene, world);

    expect(box.rigidBody).toBeTruthy();
    expect(box.collider).toBeTruthy();
    expect(box.getComponent(Pickupable)?.promptLabel).toBe('[E] Pick up drive box');
    expect(engine.rigidBodyMap.get(box.rigidBody.handle)).toBe(box);
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
    expect(pos.x).toBeCloseTo(2);
    expect(pos.y).toBeGreaterThan(0.15);
    expect(pos.z).toBeCloseTo(-1);
  });
});
