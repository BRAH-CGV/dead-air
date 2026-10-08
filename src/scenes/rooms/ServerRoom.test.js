import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../../test/fakeRapier.js')).rapierModule());

import { ServerRoom } from './ServerRoom.js';
import { makeEngine, pointLights } from '../../test/fakeRapier.js';
import { Interactable } from '../../components/Interactable.js';
import { DriveSlot } from '../../components/DriveSlot.js';
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

    const back = childNames(room).filter(n => n.startsWith('ServerRackBack_'));
    const keys = engine.spawnModel.mock.calls.map(([key]) => key);
    expect(keys.filter(k => k === 'model:server-rack').length).toBe(racks.length + back.length);
    for (const name of [...racks, ...back, 'ServerConsole']) {
      expect(engine._rootObjects).not.toContain(room.root.find(name));
    }
  });

  /** One side's racks by name prefix: side 1 = right (+x), −1 = left.
   *  `ServerRack_` is the row facing the aisle, `ServerRackBack_` the row
   *  behind it, against the wall. */
  const sideRacks = (r, side, prefix = 'ServerRack_') => childNames(r).filter(n => n.startsWith(prefix)).map(n => r.root.find(n))
    .filter(rack => Math.sign(rack.object3d.position.x) === side);
  const wallRacks = (r, side) => sideRacks(r, side);

  it('sixteen racks: four pairs down each side wall, one against the wall and one in front of it, facing the aisle', () => {
    const inX = room.width / 2 - room.wallThick / 2;
    for (const side of [1, -1]) {
      const front = sideRacks(room, side), back = sideRacks(room, side, 'ServerRackBack_');
      expect(front.length, `side ${side}`).toBe(4);
      expect(back.length, `side ${side}`).toBe(4);

      for (const rack of back) {
        // A rack is 0.666 m deep: its back within 5 cm of the wall, not in it.
        const off = inX - (Math.abs(rack.object3d.position.x) + 0.333);
        expect(off, rack.name).toBeGreaterThanOrEqual(0);
        expect(off, rack.name).toBeLessThan(0.05);
      }
      for (const rack of front) {
        // Its partner stands right behind it: same place along the wall,
        // one rack's depth nearer the wall, not overlapping.
        const partner = room.root.find(rack.name.replace('ServerRack_', 'ServerRackBack_'));
        expect(partner, rack.name).not.toBeNull();
        expect(partner.object3d.position.z, rack.name).toBeCloseTo(rack.object3d.position.z);
        const depth = side * (partner.object3d.position.x - rack.object3d.position.x);
        expect(depth, rack.name).toBeGreaterThan(0.666);
        expect(depth, rack.name).toBeLessThan(0.7);
      }
      for (const rack of [...front, ...back]) {
        expect(new THREE.Vector3(0, 0, 1).applyEuler(rack.object3d.rotation).x, rack.name).toBeCloseTo(-side);
      }
      // Each row in a line.
      expect(new Set(front.map(r => r.object3d.position.x.toFixed(3))).size, `side ${side}`).toBe(1);
      expect(new Set(back.map(r => r.object3d.position.x.toFixed(3))).size, `side ${side}`).toBe(1);
    }
    expect(engine.spawnModel.mock.calls.filter(([key]) => key === 'model:server-rack').length).toBe(16);

    // The aisle between the two front rows is still a room's width to walk down.
    const face = side => Math.abs(sideRacks(room, side)[0].object3d.position.x) - 0.333;
    expect(face(1) + face(-1)).toBeGreaterThan(2.5);
  });

  it('fits all four of the left wall\'s pairs in clear of the doorway, wherever it is slid to', () => {
    const inZ = room.depth / 2 - room.wallThick / 2;
    for (const doorOffset of [0, 2.5, -2]) {
      const r = new ServerRoom(makeEngine(), { doorOffset });
      r.build();
      for (const prefix of ['ServerRack_', 'ServerRackBack_']) {
        const racks = sideRacks(r, -1, prefix);
        expect(racks.length, `${prefix}, door at ${doorOffset}`).toBe(4);
        const zs = racks.map(rack => rack.object3d.position.z).sort((a, b) => a - b);
        for (const [i, z] of zs.entries()) {
          // Doorway 1.2 m wide, rack 0.666 m: more than a pace between them.
          expect(Math.abs(z - doorOffset) - 0.6 - 0.333, `door at ${doorOffset}`).toBeGreaterThan(0.25);
          expect(Math.abs(z) + 0.333, `door at ${doorOffset}`).toBeLessThan(inZ);      // inside the room
          if (i) expect(z - zs[i - 1], `door at ${doorOffset}`).toBeGreaterThan(0.7);    // not into each other
        }
      }
      expect(sideRacks(r, 1).length, `door at ${doorOffset}`).toBe(4);   // the right wall has no door
    }
  });

  it('where the base puts the doorway, the two sides stand opposite each other', () => {
    const r = new ServerRoom(makeEngine(), { doorOffset: 2.5 });
    r.build();
    const zs = side => sideRacks(r, side).map(rack => rack.object3d.position.z).sort((a, b) => a - b);
    const left = zs(-1), right = zs(1);
    for (const [i, z] of right.entries()) expect(left[i]).toBeCloseTo(z);
  });

  it('stands the console in the middle of the aisle at the back of the room, facing down it', () => {
    const console_ = room.root.find('ServerConsole').object3d;
    expect(console_.position.x).toBeCloseTo(0);
    // Its footprint runs 0.24 m behind its origin: backed up to the wall.
    const inZ = room.depth / 2 - room.wallThick / 2;
    expect(console_.position.z - 0.243).toBeGreaterThan(-inZ);
    expect(console_.position.z - 0.243).toBeLessThan(-inZ + 0.1);
    expect(console_.rotation.y).toBeCloseTo(0);              // the screen faces +z, down the aisle

    // The drive slot keeps its place on the console's front.
    const slot = room.root.find('DriveSlot').object3d.position;
    expect(slot.x - console_.position.x).toBeCloseTo(-0.16);
    expect(slot.z - console_.position.z).toBeCloseTo(0.7);
    expect(slot.y).toBeCloseTo(0.405);

    // Clear of the racks either side.
    for (const name of childNames(room).filter(n => n.startsWith('ServerRack_'))) {
      expect(Math.abs(room.root.find(name).object3d.position.x) - 0.333, name).toBeGreaterThan(0.6);
    }
  });

  it('has minimal room lighting: a dim blue status light plus one per rack, no ambient', () => {
    const lights = pointLights(room);
    // 1 fixed status light + 1 faint glow per aisle-facing rack on the
    // right. The left side's glow without casting: the light count is
    // compiled into every lit shader, and four rack lights is plenty.
    expect(lights.length).toBe(1 + wallRacks(room, 1).length);
    for (const l of lights) expect(l.intensity).toBeLessThanOrEqual(2.5);
    expect(lights.every(l => l.color.b > l.color.r)).toBe(true);   // blue palette only — no red warning light

    let globals = 0;
    room.root.object3d.traverse(o => { if (o.isAmbientLight || o.isDirectionalLight || o.isHemisphereLight) globals++; });
    expect(globals).toBe(0);
  });

  it('each rack facing the aisle has its own glow group on its face: glow-in-the-dark trim and blinking LEDs, plus a faint light on the right', () => {
    const racks = childNames(room).filter(n => n.startsWith('ServerRack_')).map(n => room.root.find(n));
    expect(childNames(room).filter(n => n.startsWith('RackGlow_')).length).toBe(racks.length);

    for (const rack of racks) {
      const group = room.root.find(rack.name.replace('ServerRack_', 'RackGlow_'));
      const side = Math.sign(rack.object3d.position.x);
      // On the rack's face: just proud of it, on the aisle side, at its z.
      expect(group.object3d.position.z, group.name).toBeCloseTo(rack.object3d.position.z);
      expect(side * (rack.object3d.position.x - group.object3d.position.x), group.name).toBeCloseTo(0.35);

      const strip = group.getComponent(LEDStrip);
      expect(strip, group.name).not.toBeNull();
      expect(strip.leds.length).toBeGreaterThanOrEqual(2);

      // Static glow-in-the-dark trim — unlit (MeshBasicMaterial), so it
      // reads as self-luminous no matter how dark the room is.
      const trim = group.object3d.children.filter(o => o.isMesh && o.material.isMeshBasicMaterial);
      expect(trim.length, group.name).toBeGreaterThanOrEqual(1);

      const glow = group.object3d.children.find(o => o.isPointLight);
      if (side < 0) { expect(glow, group.name).toBeUndefined(); continue; }
      expect(glow, group.name).toBeTruthy();
      expect(glow.intensity, group.name).toBeLessThanOrEqual(1);   // faint — several stack up, not one bright light
      // The light sits at the LED cluster — the blinking dots are the
      // point of light, not a separate invisible source elsewhere.
      expect(glow.position.distanceTo(strip.leds[0].position), group.name).toBeLessThan(0.5);
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

  it('the console has a separate DriveSlot box for inserting drives', () => {
    const slotBox = room.root.find('DriveSlot');
    expect(slotBox).not.toBeNull();
    const slot = slotBox.getComponent(DriveSlot);
    expect(slot).not.toBeNull();
    expect(slot.snapDistance).toBe(0.25);
  });

  it('the console Interactable clears the signal from the inserted drive in the slot', () => {
    const interactable = room.root.find('ServerConsole').getComponent(Interactable);
    const slotBox = room.root.find('DriveSlot');
    const slot = slotBox.getComponent(DriveSlot);
    expect(interactable).not.toBeNull();
    expect(slot).not.toBeNull();

    // Simulate a saved drive inserted in the slot.
    const fakeDrive = { saved: true, setSaved(v) { this.saved = v; } };
    slot._insertedDrive = fakeDrive;

    // The prompt shows the delete option.
    interactable.refreshPrompt();
    expect(interactable.promptLabel).toBe('[E] Delete signal');

    // Interact to clear the signal.
    interactable.onInteract({});
    expect(fakeDrive.saved).toBe(false);

    // After clearing, the prompt should revert.
    interactable.refreshPrompt();
    expect(interactable.promptLabel).toBe('No signal to delete');
  });

  it('the console shows "No signal to delete" when the slot has no drive', () => {
    const interactable = room.root.find('ServerConsole').getComponent(Interactable);
    interactable.refreshPrompt();
    expect(interactable.promptLabel).toBe('No signal to delete');
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
