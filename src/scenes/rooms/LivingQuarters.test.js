import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@dimforge/rapier3d', async () => (await import('../../test/fakeRapier.js')).rapierModule());

import { LivingQuarters } from './LivingQuarters.js';
import { makeEngine, pointLights } from '../../test/fakeRapier.js';
import { Interactable } from '../../components/Interactable.js';
import { Bed } from '../../components/Bed.js';
import { PRELOAD } from '../../assets/manifest.js';

function childNames(room) {
  return room.root.children.map(c => c.name);
}

/** Real floor size [x, z] of each model, unrotated, and where its footprint
 *  centre sits relative to its origin: the .glb's measured bounds times the
 *  manifest and spawn scale. The fake spawnModel loads no mesh to measure.
 *  locker.glb's origin is 0.274 m off-centre along its width (× 0.9). */
const MODEL = {
  Bunk:      { size: [1.08, 2.0] },
  Lockers:   { size: [1.31, 0.44], centre: [0.246, 0.018] },
  Desk:      { size: [1.6, 0.8] },
  DeskChair: { size: [0.44, 0.51] },
};
const FURNITURE = Object.keys(MODEL);

/** Floor footprint {x0, x1, z0, z1} of a spawned model, room-local, turned
 *  by its yaw. */
function footprint(go) {
  const { size: [w, d], centre: [cx, cz] = [0, 0] } = MODEL[go.name];
  const yaw = go.object3d.rotation.y;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const x = go.object3d.position.x + cx * cos + cz * sin;
  const z = go.object3d.position.z - cx * sin + cz * cos;
  const hx = (Math.abs(cos) * w + Math.abs(sin) * d) / 2;
  const hz = (Math.abs(sin) * w + Math.abs(cos) * d) / 2;
  return { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz };
}

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

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

  it('exposes the corridor end for the sleep demon: just inside the doorway, following doorOffset', () => {
    const shifted = new LivingQuarters(makeEngine(), { doorOffset: 2 });
    shifted.build();
    const [x, y, z] = shifted.threatAnchors.corridorEnd;
    const inX = shifted.width / 2 - shifted.wallThick / 2;
    expect(x).toBeLessThan(inX);
    expect(x).toBeGreaterThan(inX - 1);                         // in the clear metre by the wall
    expect(z).toBeCloseTo(2);
    expect(y).toBe(0);
  });

  it('is furnished with real models: bunk, lockers, desk and chair', () => {
    const expected = {
      Bunk: 'model:bunk-bed',
      Lockers: 'model:locker',
      Desk: 'model:desk',
      DeskChair: 'model:metal-chair',
    };
    for (const [name, key] of Object.entries(expected)) {
      const go = room.root.find(name);
      expect(go?.physicsAssetKey, name).toBe(key);
      expect(go.parent, name).toBe(room.root);
      expect(engine._rootObjects, name).not.toContain(go);          // updated once, as a room child
    }
  });

  it('spawns only models the scene preloads', () => {
    const keys = engine.spawnModel.mock.calls.map(([key]) => key);
    expect(PRELOAD).toEqual(expect.arrayContaining(keys));
  });

  it('has no vending machine and no stand-in boxes left', () => {
    expect(room.root.find('VendingMachine')).toBeNull();
    expect(room.root.descendants().filter(go => go.placeholderFor)).toEqual([]);
  });

  it('the bunk is the bed: it carries the sleep interactable, exposed for the scene to wire', () => {
    const bunk = room.root.find('Bunk');
    const bed = bunk.getComponent(Interactable);
    expect(bed).toBeInstanceOf(Bed);
    expect(room.bed).toBe(bed);                                        // scene sets controller + fade
    expect(engine._bodyToGO.get(bunk.rigidBody.handle)).toBe(bunk);   // raycastable
  });

  it('keeps the furniture inside the room', () => {
    const inX = room.width / 2 - room.wallThick / 2;
    const inZ = room.depth / 2 - room.wallThick / 2;
    for (const name of FURNITURE) {
      const f = footprint(room.root.find(name));
      expect(f.x0, name).toBeGreaterThan(-inX - 1e-6);
      expect(f.x1, name).toBeLessThan(inX + 1e-6);
      expect(f.z0, name).toBeGreaterThan(-inZ - 1e-6);
      expect(f.z1, name).toBeLessThan(inZ + 1e-6);
    }
  });

  it('keeps a clear metre along the right wall, so the doorway works wherever doorOffset puts it', () => {
    const inX = room.width / 2 - room.wallThick / 2;
    for (const name of FURNITURE) {
      expect(footprint(room.root.find(name)).x1, name).toBeLessThan(inX - 1);
    }
  });

  it('stands the furniture apart, nothing overlapping', () => {
    const prints = FURNITURE.map(name => [name, footprint(room.root.find(name))]);
    for (const [i, [a, fa]] of prints.entries()) {
      for (const [b, fb] of prints.slice(i + 1)) {
        expect(overlaps(fa, fb), `${a} overlaps ${b}`).toBe(false);
      }
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

  it('dispose removes every body, the furniture included', () => {
    expect(engine._bodyToGO.get(room.bed.gameObject.rigidBody.handle)).toBe(room.bed.gameObject);
    room.dispose();
    expect(engine.world.bodies.len()).toBe(0);
  });
});

describe('LivingQuarters lights', () => {
  it('its lamp and the glowing shade are on the power', () => {
    const room = new LivingQuarters(makeEngine());
    room.build();
    for (const light of pointLights(room)) expect(room.lights).toContain(light);
    const shade = room.root.find('CeilingLamp').object3d.children.find(o => o.isMesh);
    expect(room.lights).toContain(shade);
  });
});
