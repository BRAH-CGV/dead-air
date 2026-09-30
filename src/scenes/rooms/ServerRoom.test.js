import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../../test/fakeRapier.js')).rapierModule());

import { ServerRoom, StorageConsole } from './ServerRoom.js';
import { makeEngine, pointLights } from '../../test/fakeRapier.js';
import { Interactable } from '../../components/Interactable.js';
import { SightlineZone } from '../../gameobjects/SightlineZone.js';
import { LEDStrip } from '../../components/LEDStrip.js';
import { SecurityCameraRig } from '../../gameobjects/SecurityCameraRig.js';
import { inCone } from '../../gameplay/threats/CameraEntityLogic.js';

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

  describe('storage console', () => {
    it("is the ServerConsole's Interactable, exposed for the scene to wire", () => {
      const interactable = room.root.find('ServerConsole').getComponent(Interactable);
      expect(interactable).toBeInstanceOf(StorageConsole);
      expect(room.storageConsole).toBe(interactable);
    });

    it('says there is nothing to store until something is waiting', () => {
      room.storageConsole.onUpdate(0.016);
      expect(room.storageConsole.promptLabel).not.toMatch(/\[E\]/);

      room.storageConsole.waiting = () => 2;
      room.storageConsole.onUpdate(0.016);
      expect(room.storageConsole.promptLabel).toBe('[E] Store signals (2)');
    });

    it('stores through onUse, only when something is waiting', () => {
      const onUse = vi.fn();
      room.storageConsole.onUse = onUse;
      room.storageConsole.onInteract({});
      expect(onUse).not.toHaveBeenCalled();

      room.storageConsole.waiting = () => 1;
      room.storageConsole.onInteract({});
      expect(onUse).toHaveBeenCalledTimes(1);
    });
  });

  describe('camera watch', () => {
    const local = (x, y, z) => room.root.object3d.localToWorld(new THREE.Vector3(x, y, z));
    // Where the player stands to use the console, and hugging the left wall.
    const AT_CONSOLE = [-1, 1.24, -1.8];
    const LEFT_WALL  = [-2.7, 1.24, 0];
    const BEHIND_RACKS = [2.4, 1.24, 0];

    it('exposes the sightline zone, covering the whole aisle but not behind the racks', () => {
      expect(room.sightline).toBeInstanceOf(SightlineZone);
      expect(room.sightline.parent).toBe(room.root);
      expect(room.sightline.containsPoint(local(...AT_CONSOLE))).toBe(true);
      expect(room.sightline.containsPoint(local(...LEFT_WALL))).toBe(true);
      expect(room.sightline.containsPoint(local(...BEHIND_RACKS))).toBe(false);
      // Inside the walls.
      const [w, , d] = room.sightline.size;
      const c = room.sightline.object3d.position;
      expect(Math.abs(c.x) + w / 2).toBeLessThanOrEqual(room.width / 2);
      expect(Math.abs(c.z) + d / 2).toBeLessThanOrEqual(room.depth / 2);
    });

    it('hangs a security camera from the ceiling in a corner', () => {
      const rig = room.securityCamera;
      expect(rig).toBeInstanceOf(SecurityCameraRig);
      expect(rig.parent).toBe(room.root);
      const p = rig.object3d.position;
      expect(p.y).toBeGreaterThan(room.height - 0.5);
      expect(Math.abs(p.x)).toBeGreaterThan(room.width / 2 - 0.8);
      expect(Math.abs(p.z)).toBeGreaterThan(room.depth / 2 - 0.8);
    });

    it('mounts the camera model on the moving head, render-only', () => {
      const call = engine.spawnModel.mock.calls.find(([key]) => key === 'model:security-camera');
      expect(call).toBeDefined();
      expect(call[1].physics).toBe('none');
      const model = room.root.find(call[1].name);
      expect(model.parent).toBe(room.securityCamera.head);
      expect(engine._rootObjects).not.toContain(model);
    });

    it('sweeps between the racks and the console: one end sees the console, the other does not', () => {
      const rig = room.securityCamera;
      expect(rig.yaw).toBe(rig.minYaw);
      expect(rig.tilt).toBe(rig.restTilt);
      expect(rig.restTilt).toBeGreaterThan(0);          // looking down

      const sees = (yaw, point) => {
        rig.yaw = yaw;
        room.root.object3d.updateMatrixWorld(true);
        const at = rig.getLensPosition(new THREE.Vector3());
        const dir = rig.getLensDirection(new THREE.Vector3());
        return inCone(at, dir, local(...point), 25 * Math.PI / 180, 7);
      };
      expect(sees(rig.maxYaw, AT_CONSOLE)).toBe(true);
      expect(sees(rig.minYaw, AT_CONSOLE)).toBe(false);
    });

    it('its lens looks into the room, not at a wall', () => {
      const rig = room.securityCamera;
      room.root.object3d.updateMatrixWorld(true);
      const at = rig.getLensPosition(new THREE.Vector3());
      const ahead = rig.getLensDirection(new THREE.Vector3()).multiplyScalar(3).add(at);
      expect(room.containsPoint(ahead)).toBe(true);
    });

    it('is placed room-locally, so a moved room carries it', () => {
      const moved = new ServerRoom(makeEngine(), { position: [20, 0, 0] });
      moved.build();
      expect(moved.securityCamera.object3d.position.toArray())
        .toEqual(room.securityCamera.object3d.position.toArray());
    });
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

describe('ServerRoom lights', () => {
  it("every light it built is on the power, but the racks' LEDs blink on their own", () => {
    const room = new ServerRoom(makeEngine());
    room.build();
    const lights = pointLights(room);
    expect(lights.length).toBeGreaterThan(1);
    for (const light of lights) expect(room.lights).toContain(light);
    for (const strip of room.root.descendants().flatMap(go => go.components.filter(c => c instanceof LEDStrip))) {
      for (const led of strip.leds) expect(room.lights).not.toContain(led);
    }
  });
});
