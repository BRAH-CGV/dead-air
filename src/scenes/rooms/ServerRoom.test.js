import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../../test/fakeRapier.js')).rapierModule());

import { ServerRoom } from './ServerRoom.js';
import { makeEngine, pointLights } from '../../test/fakeRapier.js';
import { Interactable } from '../../components/Interactable.js';
import { SightlineZone } from '../../gameobjects/SightlineZone.js';
import { LEDStrip } from '../../components/LEDStrip.js';

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

  it('has minimal room lighting: a dim blue status light plus one per rack, no ambient', () => {
    const lights = pointLights(room);
    // 1 fixed status light + 1 faint glow per rack.
    expect(lights.length).toBeGreaterThanOrEqual(2);
    for (const l of lights) expect(l.intensity).toBeLessThanOrEqual(2.5);
    expect(lights.every(l => l.color.b > l.color.r)).toBe(true);   // blue palette only — no red warning light

    let globals = 0;
    room.root.object3d.traverse(o => { if (o.isAmbientLight || o.isDirectionalLight || o.isHemisphereLight) globals++; });
    expect(globals).toBe(0);
  });

  it('each rack has its own glow group: faint light, glow-in-the-dark trim, blinking LEDs', () => {
    const racks = childNames(room).filter(n => n.startsWith('ServerRack_'));
    const glowGroups = childNames(room).filter(n => n.startsWith('RackGlow_')).map(n => room.root.find(n));
    expect(glowGroups.length).toBe(racks.length);

    for (const group of glowGroups) {
      const glow = group.object3d.children.find(o => o.isPointLight);
      expect(glow, group.name).toBeTruthy();
      expect(glow.intensity, group.name).toBeLessThanOrEqual(1);   // faint — several stack up, not one bright light

      // The light sits at the LED cluster — the blinking dots are the
      // point of light, not a separate invisible source elsewhere.
      const strip = group.getComponent(LEDStrip);
      expect(strip, group.name).not.toBeNull();
      expect(strip.leds.length).toBeGreaterThanOrEqual(2);
      const led = strip.leds[0];
      expect(glow.position.distanceTo(led.position), group.name).toBeLessThan(0.5);

      // Static glow-in-the-dark trim — unlit (MeshBasicMaterial), so it
      // reads as self-luminous no matter how dark the room is.
      const trim = group.object3d.children.filter(o => o.isMesh && o.material.isMeshBasicMaterial);
      expect(trim.length, group.name).toBeGreaterThanOrEqual(1);
    }
  });

  it('a rack glow group is not scaled — its children sit at the metres it wrote, not shrunk by the rack model scale', () => {
    const group = room.root.find('RackGlow_1');
    expect(group.object3d.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('the LED strip actually blinks — emissiveIntensity changes over time', () => {
    const group = room.root.find('RackGlow_1');
    const strip = group.getComponent(LEDStrip);
    const before = strip.leds.map(l => l.material.emissiveIntensity);

    strip.onUpdate(strip.period / 2);

    const after = strip.leds.map(l => l.material.emissiveIntensity);
    expect(after).not.toEqual(before);
  });

  it('the console is an Interactable stub for evil-signal deletion (phase 10)', () => {
    const interactable = room.root.find('ServerConsole').getComponent(Interactable);
    expect(interactable).not.toBeNull();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    interactable.onInteract({});
    expect(log).toHaveBeenCalledWith(expect.stringContaining('signal deleted'));
    log.mockRestore();
  });

  it('has a SightlineZone stub for the camera entity, somewhere inside the room (phase 10)', () => {
    const zone = room.root.children.find(c => c instanceof SightlineZone);
    expect(zone).toBeDefined();
    expect(room.containsPoint(zone.object3d.getWorldPosition(new THREE.Vector3()))).toBe(true);
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
