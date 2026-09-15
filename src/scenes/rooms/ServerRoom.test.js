import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@dimforge/rapier3d', async () => (await import('../../test/fakeRapier.js')).rapierModule());

import { ServerRoom } from './ServerRoom.js';
import { makeEngine, pointLights } from '../../test/fakeRapier.js';

function childNames(room) {
  return room.root.children.map(c => c.name);
}

describe('ServerRoom', () => {
  let engine, room;

  beforeEach(() => {
    engine = makeEngine();
    room = new ServerRoom(engine);
    room.build();
  });

  it('is a 6 × 8 × 3 room named ServerRoom', () => {
    expect(room.root.name).toBe('Room:ServerRoom');
    expect([room.width, room.depth, room.height]).toEqual([6, 8, 3]);
  });

  it('builds its shell with a doorway in the left wall, back to the office', () => {
    expect(childNames(room)).toEqual(expect.arrayContaining(['LeftWall_A', 'LeftWall_B', 'LeftWall_Header']));
    expect(room.doors.length).toBe(1);
    const door = room.doors[0];
    expect(door.name).toBe('Door:ToMainOffice');
    expect(door.targetRoom).toBe('MainOffice');
    expect(door.object3d.position.x).toBeCloseTo(-3);
  });

  it('doorOffset slides the doorway along the wall so it can meet the corridor', () => {
    const shifted = new ServerRoom(makeEngine(), { doorOffset: 2 });
    shifted.build();
    expect(shifted.doors[0].object3d.position.z).toBeCloseTo(2);
  });

  it('spawns at least two server racks and a console, as static room props', () => {
    const racks = childNames(room).filter(n => n.startsWith('ServerRack_'));
    expect(racks.length).toBeGreaterThanOrEqual(2);
    expect(room.root.find('ServerConsole')).not.toBeNull();

    const keys = engine.spawnModel.mock.calls.map(([key]) => key);
    expect(keys.filter(k => k === 'model:server-rack').length).toBe(racks.length);
    for (const name of [...racks, 'ServerConsole']) {
      expect(engine._rootObjects).not.toContain(room.root.find(name));
    }
  });

  it('keeps the racks clear of the doorway', () => {
    // Doorway is on the left wall (x = -3); nothing within 1.5 m of it.
    for (const name of childNames(room).filter(n => n.startsWith('ServerRack_'))) {
      expect(room.root.find(name).object3d.position.x, name).toBeGreaterThan(-1.5);
    }
  });

  it('has minimal lighting: a few dim LED-coloured point lights, no ambient', () => {
    const lights = pointLights(room);
    expect(lights.length).toBeGreaterThanOrEqual(1);
    expect(lights.length).toBeLessThanOrEqual(3);
    for (const l of lights) expect(l.intensity).toBeLessThanOrEqual(1.5);
    expect(lights.some(l => l.color.b > l.color.r)).toBe(true);   // blue status LEDs
    expect(lights.some(l => l.color.r > l.color.b)).toBe(true);   // red warning LEDs

    let globals = 0;
    room.root.object3d.traverse(o => { if (o.isAmbientLight || o.isDirectionalLight || o.isHemisphereLight) globals++; });
    expect(globals).toBe(0);
  });

  it('is darker-walled than the office default', () => {
    const office = 0x2f3945;
    const lum = hex => ((hex >> 16) & 255) + ((hex >> 8) & 255) + (hex & 255);
    expect(lum(room.material.color.getHex())).toBeLessThan(lum(office));
  });

  it('dispose removes every body', () => {
    room.dispose();
    expect(engine.world.bodies.len()).toBe(0);
    expect(engine._bodyToGO.size).toBe(0);
  });
});
