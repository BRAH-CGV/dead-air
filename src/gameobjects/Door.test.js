import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

// Recording Rapier fake — the WASM build doesn't load under vitest here
// (pre-existing, see AGENTS.md). Keeps enough state to check body type,
// pose, collider size and the sensor flag.
vi.mock('@dimforge/rapier3d', () => {
  const bodyDesc = type => {
    const d = {
      type, t: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 },
      setTranslation(x, y, z) { d.t = { x, y, z }; return d; },
      setRotation(q) { d.q = { ...q }; return d; },
    };
    return d;
  };
  return {
    default: {
      RigidBodyDesc: { fixed: () => bodyDesc('fixed') },
      ColliderDesc: {
        cuboid: (x, y, z) => {
          const d = { half: { x, y, z }, sensor: false, setSensor(s) { d.sensor = s; return d; } };
          return d;
        },
      },
    },
  };
});

import { Door } from './Door.js';
import { GameObject } from '../core/GameObject.js';

class FakeWorld {
  _bodies = new Set();
  bodies = { len: () => this._bodies.size };
  createRigidBody(desc) {
    const body = {
      isFixed: () => desc.type === 'fixed',
      translation: () => ({ ...desc.t }),
      rotation: () => ({ ...desc.q }),
    };
    this._bodies.add(body);
    return body;
  }
  createCollider(desc) {
    let sensor = desc.sensor;
    return {
      halfExtents: () => ({ ...desc.half }),
      isSensor: () => sensor,
      setSensor: s => { sensor = s; },
    };
  }
  removeRigidBody(body) { this._bodies.delete(body); }
}

const SIZE = [1, 2.2, 0.2];

describe('Door state', () => {
  it('starts unlocked by default', () => {
    expect(new Door('Door:A').locked).toBe(false);
  });

  it('locked = true sets locked state', () => {
    const door = new Door('Door:A', { size: SIZE });
    door.locked = true;
    expect(door.locked).toBe(true);
    door.locked = false;
    expect(door.locked).toBe(false);
  });

  it('keeps its target room, size and a locked prompt', () => {
    const door = new Door('Door:A', { size: SIZE, targetRoom: 'ServerRoom', locked: true });
    expect(door.targetRoom).toBe('ServerRoom');
    expect(door.doorSize).toEqual(SIZE);
    expect(door.locked).toBe(true);
    expect(typeof door.lockedPrompt).toBe('string');
    expect(door.lockedPrompt.length).toBeGreaterThan(0);
  });

  it('shows a door panel only while locked', () => {
    const door = new Door('Door:A', { size: SIZE });
    const panel = door.object3d.getObjectByName('DoorPanel');
    expect(panel.isMesh).toBe(true);
    expect(panel.geometry.parameters).toMatchObject({ width: 1, height: 2.2 });
    expect(panel.visible).toBe(false);
    door.locked = true;
    expect(panel.visible).toBe(true);
  });

  it('has overridable onPlayerEnter / onPlayerExit hooks', () => {
    const door = new Door('Door:A');
    expect(() => door.onPlayerEnter(new GameObject('Player'))).not.toThrow();
    expect(() => door.onPlayerExit(new GameObject('Player'))).not.toThrow();
  });
});

describe('Door collider', () => {
  let world;
  beforeEach(() => { world = new FakeWorld(); });

  it('has a sensor collider while unlocked', () => {
    const door = new Door('Door:A', { size: SIZE });
    door.attachCollider(world, [2, 1.1, 5]);
    expect(door.rigidBody.isFixed()).toBe(true);
    expect(door.colliders).toEqual([door.collider]);
    expect(door.collider.isSensor()).toBe(true);
    const h = door.collider.halfExtents();
    expect([h.x * 2, h.y * 2, h.z * 2]).toEqual(SIZE);
    expect(door.rigidBody.translation()).toEqual({ x: 2, y: 1.1, z: 5 });
  });

  it('locking turns the collider solid so the player cannot pass; unlocking reverts', () => {
    const door = new Door('Door:A', { size: SIZE });
    door.attachCollider(world, [0, 1.1, 0]);
    door.locked = true;
    expect(door.collider.isSensor()).toBe(false);
    door.locked = false;
    expect(door.collider.isSensor()).toBe(true);
  });

  it('a door created locked gets a solid collider', () => {
    const door = new Door('Door:A', { size: SIZE, locked: true });
    door.attachCollider(world, [0, 1.1, 0]);
    expect(door.collider.isSensor()).toBe(false);
  });

  it('rotates its body with the door (side-wall doors)', () => {
    const door = new Door('Door:A', { size: SIZE });
    door.attachCollider(world, [0, 1.1, 0], Math.PI / 2);
    const q = door.rigidBody.rotation();
    expect(q.y).toBeCloseTo(Math.sin(Math.PI / 4));
    expect(q.w).toBeCloseTo(Math.cos(Math.PI / 4));
  });
});

describe('Door.containsPoint', () => {
  const p = (x, y, z) => new THREE.Vector3(x, y, z);

  it('tests a world-space point against the doorway box', () => {
    const door = new Door('Door:A', { size: SIZE });
    door.object3d.position.set(2, 1.1, 5);
    expect(door.containsPoint(p(2, 1, 5))).toBe(true);
    expect(door.containsPoint(p(2.45, 0.1, 5.09))).toBe(true);
    expect(door.containsPoint(p(2, 1, 5.5))).toBe(false);
    expect(door.containsPoint(p(2.6, 1, 5))).toBe(false);
  });

  it('margin grows the box on every side', () => {
    const door = new Door('Door:A', { size: SIZE });
    door.object3d.position.set(2, 1.1, 5);
    expect(door.containsPoint(p(2, 1, 5.8), 0.75)).toBe(true);
    expect(door.containsPoint(p(2, 1, 5.9), 0.75)).toBe(false);
  });

  it('respects the door rotation', () => {
    const door = new Door('Door:A', { size: SIZE });
    door.object3d.position.set(-4, 1.1, 0);
    door.object3d.rotation.y = Math.PI / 2;
    // Width now runs along z, thickness along x
    expect(door.containsPoint(p(-4, 1, 0.45))).toBe(true);
    expect(door.containsPoint(p(-3.8, 1, 0))).toBe(false);
  });

  it('respects parent transforms (doors live inside room groups)', () => {
    const room = new GameObject('Room:X').makeGroup();
    room.object3d.position.set(10, 0, 0);
    const door = new Door('Door:A', { size: SIZE });
    door.object3d.position.set(2, 1.1, 5);
    room.addChild(door);
    expect(door.containsPoint(p(12, 1, 5))).toBe(true);
    expect(door.containsPoint(p(2, 1, 5))).toBe(false);
  });
});

describe('Door.fromObject3D', () => {
  it('wraps a cloned mesh as a Door, like other GameObject subclasses', () => {
    const src = new THREE.Group();
    src.name = 'door-interior';
    src.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.1)));
    const door = Door.fromObject3D(src.clone());
    expect(door).toBeInstanceOf(Door);
    expect(door.name).toBe('door-interior');
    expect(door.children.length).toBe(1);
    expect(door.locked).toBe(false);
  });
});
