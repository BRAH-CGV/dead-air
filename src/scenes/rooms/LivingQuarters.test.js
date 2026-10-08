import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@dimforge/rapier3d', async () => (await import('../../test/fakeRapier.js')).rapierModule());

import { LivingQuarters } from './LivingQuarters.js';
import { makeEngine, pointLights } from '../../test/fakeRapier.js';
import { Interactable } from '../../components/Interactable.js';
import { Bed } from '../../components/Bed.js';
import * as THREE from 'three';
import { PRELOAD } from '../../assets/manifest.js';

function childNames(room) {
  return room.root.children.map(c => c.name);
}

/** Real floor size [x, z] of each model, unrotated, and where its footprint
 *  centre sits relative to its origin: the .glb's measured bounds times the
 *  manifest and spawn scale. The fake spawnModel loads no mesh to measure.
 *  locker.glb's origin is 0.274 m off-centre along its width (× 0.9). */
const LOCKER = { size: [1.31, 0.44], centre: [0.246, 0.018] };
const SHELF  = { size: [0.37, 1.03] };
const MODEL = {
  Bunk:      { size: [1.08, 2.0] },
  Lockers:   LOCKER,
  Desk:      { size: [1.6, 0.8] },
  DeskChair: { size: [0.44, 0.51] },
  DividerShelf_1: SHELF, DividerShelf_2: SHELF,
  OfficeShelf_1:  SHELF, OfficeShelf_2:  SHELF,
  StorageShelf_1: SHELF, StorageShelf_2: SHELF, StorageShelf_3: SHELF, StorageShelf_4: SHELF,
  StorageShelf_5: SHELF, StorageShelf_6: SHELF, StorageShelf_7: SHELF,
};
const SHELVES = Object.keys(MODEL).filter(name => MODEL[name] === SHELF);
/** Everything standing on the floor: the spawned models and the one procedural box. */
const FURNITURE = [...Object.keys(MODEL), 'SideTable'];

/** Floor footprint {x0, x1, z0, z1} of a piece of furniture, room-local: a
 *  spawned model's MODEL size turned by its yaw, or a static box's own size. */
function footprint(go) {
  if (go._originalSize) {
    const [w, , d] = go._originalSize;
    const { x, z } = go.object3d.position;
    return { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 };
  }
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

  it('is furnished with real models: bunk, lockers, desk and chair, shelves', () => {
    const expected = {
      Bunk: 'model:bunk-bed',
      Lockers: 'model:locker',
      Desk: 'model:desk',
      DeskChair: 'model:metal-chair',
      ...Object.fromEntries(SHELVES.map(name => [name, 'model:shelf'])),
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

  it('keeps the right wall clear forward of the storage corner, so the doorway works wherever the base slides it', () => {
    // Only the storage shelves stand on the right wall, in the back half
    // (z < −0.5). From there forward the metre inside the wall is clear:
    // BaseScene puts the doorway at z 2.5.
    const inX = room.width / 2 - room.wallThick / 2;
    for (const name of FURNITURE) {
      const f = footprint(room.root.find(name));
      if (f.x1 > inX - 1) expect(f.z1, name).toBeLessThan(-0.5);
    }
  });

  it('the bedroom: one set of lockers against the left wall at the foot of the bed, and no wardrobe', () => {
    expect(engine.spawnModel.mock.calls.filter(([key]) => key === 'model:locker').length).toBe(1);
    expect(room.root.find('Wardrobe')).toBeNull();

    const at = name => footprint(room.root.find(name));
    const bunk = at('Bunk'), lockers = at('Lockers');
    expect(lockers.x0).toBeLessThan(-2.85);                          // against the left wall…
    expect(lockers.x0).toBeGreaterThan(-2.9);                        // …not sunk into it
    expect(lockers.z0).toBeGreaterThan(bunk.z1);                     // past the foot of the bunk
    expect(lockers.z0 - bunk.z1).toBeLessThan(0.15);                 // and right at it
    const facing = new THREE.Vector3(0, 0, 1).applyEuler(room.root.find('Lockers').object3d.rotation);
    expect(facing.x).toBeCloseTo(1);                                 // doors into the room

    // A row of shelves out from the left wall parts the bedroom from the office.
    const divider = [at('DividerShelf_1'), at('DividerShelf_2')], desk = at('Desk');
    expect(divider[0].x0).toBeLessThan(-2.85);
    expect(divider[1].x0 - divider[0].x1).toBeLessThan(0.05);
    for (const d of divider) {
      expect(d.z0).toBeGreaterThan(lockers.z1);
      expect(d.z1).toBeLessThan(desk.z0);
    }
  });

  it('storage, in the back right: three rows of shelves with aisles to walk down', () => {
    const at = name => footprint(room.root.find(name));
    const shelves = [1, 2, 3, 4, 5, 6, 7].map(i => at(`StorageShelf_${i}`));
    // Rows run front to back; gather them by x.
    const rows = new Map();
    for (const sh of shelves) {
      const key = sh.x0.toFixed(2);
      rows.set(key, [...(rows.get(key) ?? []), sh]);
    }
    const xs = [...rows.values()].map(r => r[0]).sort((a, b) => a.x0 - b.x0);
    expect(xs.length).toBe(3);
    expect(xs[0].x0).toBeGreaterThan(0);                             // right of the bedroom
    expect(xs[2].x1).toBeGreaterThan(2.85);                          // the last row on the right wall
    // Aisles wider than the player (0.6 m), with room to turn.
    expect(xs[1].x0 - xs[0].x1).toBeGreaterThan(0.75);
    expect(xs[2].x0 - xs[1].x1).toBeGreaterThan(0.75);
    // Every row starts at the back wall, so the aisles are entered from the front.
    for (const row of rows.values()) expect(Math.min(...row.map(sh => sh.z0))).toBeLessThan(-3.8);
  });

  it('keeps the main paths clear: in from the door, across to the desk, and round into the bedroom', () => {
    const base = new LivingQuarters(makeEngine(), { doorOffset: 2.5 });   // where BaseScene puts the doorway
    base.build();
    const inX = base.width / 2 - base.wallThick / 2;
    const paths = {
      'in at the door':       { x0: inX - 1, x1: inX, z0: 1.8, z1: 3.2 },
      'across the room':      { x0: -0.8, x1: inX, z0: -0.7, z1: 1.8 },
      'round to the bedroom': { x0: -1.75, x1: 0.15, z0: -1.75, z1: 0.15 },
    };
    for (const name of FURNITURE) {
      const f = footprint(base.root.find(name));
      for (const [path, area] of Object.entries(paths)) {
        expect(overlaps(f, area), `${name} stands in the way ${path}`).toBe(false);
      }
    }
  });

  it('the office: the desk end-on to the front wall, its chair beside it, shelves along the wall, a lamp on top', () => {
    const at = name => footprint(room.root.find(name));
    const desk = at('Desk');
    expect(desk.z1 - desk.z0).toBeCloseTo(1.6);                      // turned to run front to back
    expect(desk.x1 - desk.x0).toBeCloseTo(0.8);
    const chair = room.root.find('DeskChair').object3d;
    expect(desk.x0 - chair.position.x).toBeGreaterThan(0.3);         // on the desk's left
    expect(desk.x0 - chair.position.x).toBeLessThan(1.2);
    expect(new THREE.Vector3(0, 0, 1).applyEuler(chair.rotation).x).toBeGreaterThan(0.8);   // facing it
    for (const name of ['OfficeShelf_1', 'OfficeShelf_2']) expect(at(name).z1, name).toBeGreaterThan(3.85);

    // The lamp is a glow, not a light: render-only, and no new PointLight.
    const lamp = room.root.find('DeskLamp');
    expect(lamp.rigidBody).toBeNull();
    const { x, y, z } = lamp.object3d.position;
    expect(y).toBeCloseTo(0.745);                                    // on the desk top
    expect(x).toBeGreaterThan(desk.x0); expect(x).toBeLessThan(desk.x1);
    expect(z).toBeGreaterThan(desk.z0); expect(z).toBeLessThan(desk.z1);
    const glows = [];
    lamp.object3d.traverse(o => { if (o.isMesh && o.material.emissive?.getHex()) glows.push(o); });
    expect(glows.length).toBeGreaterThan(0);
    expect(pointLights(room).length).toBe(1);
  });

  it('a side table by the bunk, with the floor beside the bed left free to sleep from', () => {
    const table = room.root.find('SideTable');
    expect(table.rigidBody.isFixed()).toBe(true);
    const bunk = footprint(room.root.find('Bunk'));
    const beside = { x0: bunk.x1, x1: bunk.x1 + 0.8, z0: -3.0, z1: bunk.z1 };
    for (const name of FURNITURE.filter(n => n !== 'Bunk')) {
      expect(overlaps(footprint(room.root.find(name)), beside), name).toBe(false);
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
