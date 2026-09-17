import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@dimforge/rapier3d', async () => (await import('../../test/fakeRapier.js')).rapierModule());

import { LivingQuarters } from './LivingQuarters.js';
import { makeEngine, pointLights } from '../../test/fakeRapier.js';
import { Interactable } from '../../components/Interactable.js';

function childNames(room) {
  return room.root.children.map(c => c.name);
}

describe('LivingQuarters', () => {
  let engine, room;

  beforeEach(() => {
    engine = makeEngine();
    room = new LivingQuarters(engine);
    room.build();
  });

  it('is a 6 × 8 × 3 room named LivingQuarters', () => {
    expect(room.root.name).toBe('Room:LivingQuarters');
    expect([room.width, room.depth, room.height]).toEqual([6, 8, 3]);
  });

  it('builds its shell with a doorway in the right wall, back to the office', () => {
    expect(childNames(room)).toEqual(expect.arrayContaining(['RightWall_A', 'RightWall_B', 'RightWall_Header']));
    expect(room.doors.length).toBe(1);
    const door = room.doors[0];
    expect(door.name).toBe('Door:ToMainOffice');
    expect(door.targetRoom).toBe('MainOffice');
    expect(door.object3d.position.x).toBeCloseTo(3);
  });

  it('doorOffset slides the doorway along the wall', () => {
    const shifted = new LivingQuarters(makeEngine(), { doorOffset: 2 });
    shifted.build();
    expect(shifted.doors[0].object3d.position.z).toBeCloseTo(2);
  });

  it('has a bunk, a vending machine and a row of lockers', () => {
    expect(room.root.find('Bunk')).not.toBeNull();
    expect(room.root.find('VendingMachine')).not.toBeNull();
    expect(childNames(room).filter(n => n.startsWith('Locker_')).length).toBe(3);
  });

  it('stand-ins record which model they are waiting for, and are solid', () => {
    const expected = {
      Bunk: 'bunk-bed.glb',
      VendingMachine: 'vending-machine.glb',
      Locker_1: 'locker.glb',
    };
    for (const [name, file] of Object.entries(expected)) {
      const go = room.root.find(name);
      expect(go.placeholderFor, name).toBe(file);
      expect(go.rigidBody.isFixed(), name).toBe(true);
    }
  });

  it('the vending machine is an Interactable stub for coffee/stamina (phase 10)', () => {
    const vending = room.root.find('VendingMachine');
    const interactable = vending.getComponent(Interactable);
    expect(interactable).not.toBeNull();
    expect(engine._bodyToGO.get(vending.rigidBody.handle)).toBe(vending);   // raycastable

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    interactable.onInteract({});
    expect(log).toHaveBeenCalledWith(expect.stringContaining('coffee'));
    log.mockRestore();
  });

  it('the vending machine glows faintly (dim internal light)', () => {
    const mesh = room.root.find('VendingMachine').object3d.children.find(o => o.isMesh);
    expect(mesh.material.emissive.getHex()).not.toBe(0);
  });

  it('spawns the desk model', () => {
    expect(room.root.find('Desk')).not.toBeNull();
    expect(engine.spawnModel).toHaveBeenCalledWith('model:desk', expect.anything());
    expect(engine._rootObjects).not.toContain(room.root.find('Desk'));
  });

  it('keeps furniture clear of the doorway', () => {
    // Doorway on the right wall (x = +3) at z = 0: nothing within 1.2 m of it.
    for (const go of room.root.children) {
      if (!/^(Bunk|VendingMachine|Locker_|Desk)/.test(go.name)) continue;
      const { x, z } = go.object3d.position;
      expect(Math.hypot(x - 3, z), go.name).toBeGreaterThan(1.2);
    }
  });

  it('has warm lighting and no global lights', () => {
    const lights = pointLights(room);
    expect(lights.length).toBeGreaterThanOrEqual(1);
    expect(lights.length).toBeLessThanOrEqual(2);
    expect(lights[0].color.r).toBeGreaterThan(lights[0].color.b);

    let globals = 0;
    room.root.object3d.traverse(o => { if (o.isAmbientLight || o.isDirectionalLight || o.isHemisphereLight) globals++; });
    expect(globals).toBe(0);
  });

  it('dispose frees the stand-in materials it created', () => {
    const mesh = room.root.find('VendingMachine').object3d.children.find(o => o.isMesh);
    let disposed = false;
    mesh.material.addEventListener('dispose', () => { disposed = true; });
    room.dispose();
    expect(disposed).toBe(true);
    expect(engine.world.bodies.len()).toBe(0);
  });
});
