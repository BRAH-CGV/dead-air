import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@dimforge/rapier3d', async () => (await import('../../test/fakeRapier.js')).rapierModule());

import { LivingQuarters } from './LivingQuarters.js';
import { makeEngine, pointLights } from '../../test/fakeRapier.js';
import { Interactable } from '../../components/Interactable.js';
import { Bed, BUNK_POSES } from '../../components/Bed.js';
import { CoffeeMachine, COFFEE } from '../../components/CoffeeMachine.js';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { ASSETS, PRELOAD } from '../../assets/manifest.js';
import { NAP_WATCH } from '../../gameplay/SleepDemon.js';
import { BedroomPC } from '../../components/BedroomPC.js';
import { LAPTOP, LAPTOP_SCREEN, COFFEE_MACHINE } from './LivingQuarters.js';

function childNames(room) {
  return room.root.children.map(c => c.name);
}

/** Real floor size [x, z] of each model, unrotated, and where its footprint
 *  centre sits relative to its origin: the .glb's measured bounds times the
 *  manifest and spawn scale. The fake spawnModel loads no mesh to measure.
 *  locker.glb's origin is 0.274 m off-centre along its width (× 0.9). */
const LOCKER = { size: [1.31, 0.44], centre: [0.246, 0.018] };
const SHELF  = { size: [0.37, 1.03] };
const RACK   = { size: [0.92, 0.6] };     // bigger-shelf.glb, authored in metres
const MODEL = {
  Bunk:      { size: [0.9, 2.0] },    // bed.glb, a single bed authored in metres
  Lockers:   LOCKER,
  Desk:      { size: [0.88, 1.76] },   // simple-desk.glb at its manifest scale, long side along z
  DeskChair: { size: [0.44, 0.51] },
  OfficeShelf_1:  SHELF, OfficeShelf_2:  SHELF,
  StorageRack_1: RACK, StorageRack_2: RACK, StorageRack_3: RACK,
  StorageRack_4: RACK, StorageRack_5: RACK, StorageRack_6: RACK,
};
const RACKS = Object.keys(MODEL).filter(name => MODEL[name] === RACK);
const SHELVES = Object.keys(MODEL).filter(name => MODEL[name] === SHELF);
/** Everything standing on the floor: the spawned models and the procedural boxes. */
const FURNITURE = [...Object.keys(MODEL), 'SideTable', 'CoffeeTable'];   // the coffee machine stands on its table

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

/** Each mesh of a .glb under public/, by node name: its bounds { min, max },
 *  read off the POSITION accessors (the nodes must carry no transform). */
function glbParts(url) {
  const glb = readFileSync(new URL(`../../../public/${url}`, import.meta.url));
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
  return Object.fromEntries(json.nodes.filter(node => node.mesh !== undefined).map(node => {
    expect(node.matrix ?? node.translation ?? node.rotation ?? node.scale, node.name).toBeUndefined();
    const accessors = json.meshes[node.mesh].primitives.map(prim => json.accessors[prim.attributes.POSITION]);
    const min = [0, 1, 2].map(i => Math.min(...accessors.map(a => a.min[i])));
    const max = [0, 1, 2].map(i => Math.max(...accessors.map(a => a.max[i])));
    return [node.name, { min, max }];
  }));
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

  it('is furnished with real models: bunk, lockers, desk and chair, shelves', () => {
    const expected = {
      Bunk: 'model:bed',
      Lockers: 'model:locker',
      Desk: 'model:simple-desk',
      DeskChair: 'model:metal-chair',
      ...Object.fromEntries(SHELVES.map(name => [name, 'model:shelf'])),
      ...Object.fromEntries(RACKS.map(name => [name, 'model:bigger-shelf'])),
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
    // Only the storage racks stand on the right wall, in the back half
    // (z < −0.5). From there forward the metre inside the wall is clear:
    // BaseScene puts the doorway at z 2.5.
    const inX = room.width / 2 - room.wallThick / 2;
    for (const name of FURNITURE) {
      const f = footprint(room.root.find(name));
      if (f.x1 > inX - 1) expect(f.z1, name).toBeLessThan(-0.5);
    }
  });

  it('the bedroom: the bunk in the back-left corner, lockers on the back wall beside its table, and no wardrobe', () => {
    expect(engine.spawnModel.mock.calls.filter(([key]) => key === 'model:locker').length).toBe(1);
    expect(room.root.find('Wardrobe')).toBeNull();
    expect(room.root.find('DividerShelf_1')).toBeNull();               // no shelves out from the wall

    const at = name => footprint(room.root.find(name));
    const bunk = at('Bunk'), lockers = at('Lockers'), table = at('SideTable');
    expect(bunk.x0).toBeLessThan(-2.85);                              // along the left wall
    expect(bunk.z0).toBeLessThan(-3.85);                              // in the back corner
    expect(lockers.z0).toBeLessThan(-3.85);                           // against the back wall…
    expect(lockers.z0).toBeGreaterThan(-3.9);                         // …not sunk into it
    expect(lockers.x0).toBeGreaterThan(table.x1);                     // past the side table
    expect(lockers.x0 - table.x1).toBeLessThan(0.3);                  // and right by it
    const facing = new THREE.Vector3(0, 0, 1).applyEuler(room.root.find('Lockers').object3d.rotation);
    expect(facing.z).toBeCloseTo(1);                                  // doors into the room
  });

  it('storage, in the back right: two rows of big racks with an aisle to walk down', () => {
    expect(room.root.find('StorageShelf_1')).toBeNull();               // the small shelves are gone
    const at = name => footprint(room.root.find(name));
    const racks = RACKS.map(at);
    const rows = new Map();
    for (const r of racks) {
      const key = r.x0.toFixed(2);
      rows.set(key, [...(rows.get(key) ?? []), r]);
    }
    const xs = [...rows.values()].map(row => row[0]).sort((a, b) => a.x0 - b.x0);
    expect(xs.length).toBe(2);
    for (const row of rows.values()) {
      expect(row.length).toBe(3);
      expect(Math.min(...row.map(r => r.z0))).toBeLessThan(-3.85);   // from the back wall
      for (const r of row) expect(r.z1 - r.z0).toBeCloseTo(0.92);     // end-on to it
    }
    expect(xs[0].x0).toBeGreaterThan(at('Lockers').x1);               // clear of the bedroom
    expect(xs[1].x1).toBeGreaterThan(2.85);                           // the second against the right wall
    expect(xs[1].x0 - xs[0].x1).toBeGreaterThan(0.75);                // an aisle wider than the player
  });

  it('keeps the main paths clear: in from the door, across to the desk, and round into the bedroom', () => {
    const base = new LivingQuarters(makeEngine(), { doorOffset: 2.5 });   // where BaseScene puts the doorway
    base.build();
    const inX = base.width / 2 - base.wallThick / 2;
    const paths = {
      'in at the door':       { x0: inX - 1, x1: inX, z0: 1.8, z1: 3.2 },
      'across the room':      { x0: -0.8, x1: inX, z0: -0.7, z1: 1.7 },   // up to the desk's end
      'round to the bedroom': { x0: -1.75, x1: 0.15, z0: -1.75, z1: 0.15 },
    };
    for (const name of FURNITURE) {
      const f = footprint(base.root.find(name));
      for (const [path, area] of Object.entries(paths)) {
        expect(overlaps(f, area), `${name} stands in the way ${path}`).toBe(false);
      }
    }
  });

  it('the office: the simple desk end-on to the front wall, its chair beside it, shelves along the wall behind it, a lamp on top', () => {
    const at = name => footprint(room.root.find(name));
    const desk = at('Desk');
    expect(desk.z1 - desk.z0).toBeCloseTo(1.76);                      // turned to run front to back
    expect(desk.x1 - desk.x0).toBeCloseTo(0.88);
    const chair = room.root.find('DeskChair').object3d;
    expect(desk.x0 - chair.position.x).toBeGreaterThan(0.3);         // on the desk's left
    expect(desk.x0 - chair.position.x).toBeLessThan(1.2);
    expect(new THREE.Vector3(0, 0, 1).applyEuler(chair.rotation).x).toBeGreaterThan(0.8);   // facing it
    // Drawers toward the chair: simple-desk.glb's drawers are on its +x side.
    expect(new THREE.Vector3(1, 0, 0).applyEuler(room.root.find('Desk').object3d.rotation).x).toBeCloseTo(-1);
    for (const name of ['OfficeShelf_1', 'OfficeShelf_2']) {
      expect(at(name).z1, name).toBeGreaterThan(3.85);               // against the front wall
      expect(at(name).z0, name).toBeGreaterThan(desk.z1);             // behind the desk's end
    }

    // The lamp is drawn only (no collider), and lit (#79): one small light
    // of its own beside the ceiling lamp, over the desk.
    const lamp = room.root.find('DeskLamp');
    expect(lamp.rigidBody).toBeNull();
    const { x, y, z } = lamp.object3d.position;
    expect(y).toBeCloseTo(0.79);                                     // on the desk top (0.9 m × 0.88)
    expect(x).toBeGreaterThan(desk.x0); expect(x).toBeLessThan(desk.x1);
    expect(z).toBeGreaterThan(desk.z0); expect(z).toBeLessThan(desk.z1);
    const glows = [];
    lamp.object3d.traverse(o => { if (o.isMesh && o.material.emissive?.getHex()) glows.push(o); });
    expect(glows.length).toBeGreaterThan(0);
    expect(pointLights(room).length).toBe(2);
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

  it('the bed is a single bed, not a bunk: no upper tier or ladder between the pillow and the clock (#113)', () => {
    const parts = glbParts(ASSETS['model:bed'].url);
    const all = Object.values(parts);
    const min = [0, 1, 2].map(i => Math.min(...all.map(part => part.min[i])));
    const max = [0, 1, 2].map(i => Math.max(...all.map(part => part.max[i])));
    expect(min[1]).toBeCloseTo(0, 3);                                   // standing on the floor
    expect(max[0] - min[0]).toBeCloseTo(MODEL.Bunk.size[0], 1);        // the footprint the layout tests use
    expect(max[2] - min[2]).toBeCloseTo(MODEL.Bunk.size[1], 1);
    expect(max[1]).toBeLessThan(0.9);                                   // the headboard's arch is its top

    // Lying on the pillow, the eye is over it and above all the bedding;
    // only the headboard, behind the head, stands taller.
    const [ex, ey, ez] = BUNK_POSES.pillow.position;
    for (const [name, part] of Object.entries(parts)) {
      if (name !== 'Frame') expect(part.max[1], name).toBeLessThan(ey);
    }
    expect(ex).toBeGreaterThan(parts.Pillow.min[0]);
    expect(ex).toBeLessThan(parts.Pillow.max[0]);
    expect(ez).toBeGreaterThan(parts.Pillow.min[2]);
    expect(ez).toBeLessThan(parts.Pillow.max[2]);
  });

  it('a clock on the side table, its face turned to the sleeper and in the middle of their view (#113)', () => {
    const clock = room.bedsideClock;
    const table = room.root.find('SideTable');
    room.root.object3d.updateMatrixWorld(true);
    const at = clock.object3d.getWorldPosition(new THREE.Vector3());
    const top = new THREE.Box3().setFromObject(table.object3d);
    expect(at.y).toBeCloseTo(top.max.y, 2);                             // standing on it
    expect(at.x).toBeGreaterThan(top.min.x);
    expect(at.x).toBeLessThan(top.max.x);
    expect(at.z).toBeGreaterThan(top.min.z);
    expect(at.z).toBeLessThan(top.max.z);

    const pillow = room.bed.pillowPose();
    const toEye = pillow.position.clone().sub(at);
    toEye.y = 0;
    const face = new THREE.Vector3(0, 0, 1).applyQuaternion(clock.object3d.getWorldQuaternion(new THREE.Quaternion()));
    expect(THREE.MathUtils.radToDeg(face.angleTo(toEye.normalize()))).toBeLessThan(25);

    const view = new THREE.Vector3(0, 0, -1)
      .applyEuler(new THREE.Euler(pillow.pitch, pillow.yaw, 0, 'YXZ'));
    const toClock = at.clone().setY(at.y + 0.055).sub(pillow.position).normalize();
    expect(THREE.MathUtils.radToDeg(view.angleTo(toClock))).toBeLessThan(15);
  });

  it('the Sleep Demon watches a sleeper from inside the room, in view of the pillow, not beside it', () => {
    const pillow = room.bed.pillowPose();
    const view = new THREE.Vector3(0, 0, -1)
      .applyEuler(new THREE.Euler(pillow.pitch, pillow.yaw, 0, 'YXZ')).setY(0).normalize();
    const spots = room.bed.watchSpots();
    expect(spots.length).toBeGreaterThan(0);
    for (const spot of spots) {
      const name = spot.toArray().join();
      expect(Math.abs(spot.x), name).toBeLessThan(room.width / 2 - room.wallThick);
      expect(Math.abs(spot.z), name).toBeLessThan(room.depth / 2 - room.wallThick);
      const to = spot.clone().sub(pillow.position).setY(0);
      expect(to.length(), name).toBeGreaterThan(NAP_WATCH.floor);
      // Within 40° of the middle of the view: on screen at 4:3 and the
      // narrowest field of view the settings allow.
      expect(THREE.MathUtils.radToDeg(view.angleTo(to.normalize())), name).toBeLessThan(40);
    }
  });

  it('the coffee machine: on a table on the left wall between the bunk and the desk, facing into the room', () => {
    const at = name => footprint(room.root.find(name));
    const table = at('CoffeeTable'), bunk = at('Bunk'), chair = at('DeskChair');
    const inX = room.width / 2 - room.wallThick / 2;
    expect(table.x0).toBeCloseTo(-inX);                              // against the left wall
    expect(table.z0).toBeGreaterThan(bunk.z1 + 0.25);                // past the foot of the bunk
    expect(table.z1).toBeLessThan(chair.z0 - 0.5);                   // and short of the desk's corner
    expect(room.root.find('CoffeeTable').rigidBody.isFixed()).toBe(true);

    // The machine stands on the table top, wholly over it, a box its size
    // the collider the interact ray lands on.
    const go = room.root.find('CoffeeMachine');
    const top = room.root.find('CoffeeTable')._originalSize[1];
    const machine = at('CoffeeMachine');
    expect(go.object3d.position.y - go._originalSize[1] / 2).toBeCloseTo(top);
    expect(go._originalSize).toEqual([COFFEE_MACHINE[2], COFFEE_MACHINE[1], COFFEE_MACHINE[0]]);
    expect(machine.x0).toBeGreaterThanOrEqual(table.x0);
    expect(machine.x1).toBeLessThanOrEqual(table.x1);
    expect(machine.z0).toBeGreaterThanOrEqual(table.z0);
    expect(machine.z1).toBeLessThanOrEqual(table.z1);

    // The model, drawn only, its front (+z) turned into the room (+x).
    const model = room.root.find('CoffeeMachineModel');
    expect(model.physicsAssetKey).toBe('model:coffee-machine');
    expect(model.rigidBody).toBeFalsy();
    expect(model.object3d.position.y).toBeCloseTo(top);
    const facing = new THREE.Vector3(0, 0, 1).applyEuler(model.object3d.rotation);
    expect(facing.x).toBeCloseTo(1);
  });

  it('reads the coffee machine\'s size off coffee-machine.glb, at its manifest scale', () => {
    const entry = ASSETS['model:coffee-machine'];
    const glb = readFileSync(new URL(`../../../public/${entry.url}`, import.meta.url));
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
    const box = new THREE.Box3();
    for (const node of json.nodes.filter(n => n.mesh !== undefined)) {
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...(node.translation ?? [0, 0, 0])),
        new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
        new THREE.Vector3(...(node.scale ?? [1, 1, 1])));
      for (const prim of json.meshes[node.mesh].primitives) {
        const { min, max } = json.accessors[prim.attributes.POSITION];
        box.union(new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)).applyMatrix4(matrix));
      }
    }
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(entry.scale);
    expect(entry.origin).toBe('floor');
    size.toArray().forEach((v, i) => expect(COFFEE_MACHINE[i]).toBeCloseTo(v, 3));
  });

  it('lights the machine\'s white switch as its status light, on its own copy of the material', () => {
    const shared = Object.assign(new THREE.MeshStandardMaterial(), { name: 'Plastic_white' });
    const chrome = Object.assign(new THREE.MeshStandardMaterial(), { name: 'Chrome' });
    const spawn = engine.spawnModel.getMockImplementation();
    engine.spawnModel.mockImplementation((key, opts) => {
      const go = spawn(key, opts);
      if (key === 'model:coffee-machine') go.object3d.add(new THREE.Mesh(new THREE.BoxGeometry(), shared), new THREE.Mesh(new THREE.BoxGeometry(), chrome));
      return go;
    });
    const lit = new LivingQuarters(engine);
    lit.build();

    const meshes = [];
    lit.root.find('CoffeeMachineModel').object3d.traverse(o => { if (o.isMesh) meshes.push(o); });
    const [switchMesh, chromeMesh] = meshes;
    const use = lit.coffeeMachine;
    expect(switchMesh.material).toBe(use.screen);
    expect(use.screen).not.toBe(shared);                           // the cached model's material is untouched
    expect(shared.emissive.getHex()).toBe(0);
    expect(chromeMesh.material).toBe(chrome);
    expect(use.screen.emissive.getHex()).toBe(COFFEE.screen.ready);
    expect(use.screen.emissiveIntensity).toBeGreaterThan(0);
  });

  it("makes the machine usable: it is the room's CoffeeMachine, raycastable, its screen lit by what it is doing", () => {
    const go = room.root.find('CoffeeMachine');
    const use = go.getComponent(Interactable);
    expect(use).toBeInstanceOf(CoffeeMachine);
    expect(use).toBe(room.coffeeMachine);
    expect(engine._bodyToGO.get(go.rigidBody.handle)).toBe(go);
    expect(use.promptLabel).toMatch(/^\[E\] Brew a coffee/);
    expect(() => use.onInteract({})).not.toThrow();              // no stamina wired: nothing to brew for
    expect(use.state).toBe('ready');
    expect(use.screen.emissive.getHex()).toBe(COFFEE.screen.ready);
    expect(use.screen.emissiveIntensity).toBeGreaterThan(0);     // a glow the power grid collects
  });

  it('marks the computer\'s screen (#161): the laptop\'s face, turned to the chair', () => {
    const [tl, tr, , bl] = room.pcScreen.worldCorners();
    expect(room.pcScreen.object).toBe(room.root.find('BedroomPCModel').object3d);
    expect(tl.distanceTo(tr)).toBeCloseTo(0.224, 3);
    expect(tl.distanceTo(bl)).toBeCloseTo(0.183, 3);
    expect(tl.y).toBeGreaterThan(bl.y);
    // Facing the chair, which is at −x.
    const normal = new THREE.Vector3().crossVectors(tr.clone().sub(tl), tl.clone().sub(bl)).normalize();
    expect(normal.x).toBeCloseTo(-1);
  });

  it('reads the laptop\'s screen and size off laptop.glb, at its manifest scale', () => {
    const entry = ASSETS['model:laptop'];
    const glb = readFileSync(new URL(`../../../public/${entry.url}`, import.meta.url));
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
    const s = entry.scale;
    // Every primitive's bounds, moved by its node and scaled: metres in the model's root.
    const parts = json.nodes.flatMap(node => json.meshes[node.mesh].primitives.map(prim => {
      const { min, max } = json.accessors[prim.attributes.POSITION];
      const t = node.translation ?? [0, 0, 0];
      return {
        material: json.materials[prim.material].name,
        min: min.map((v, i) => (v + t[i]) * s),
        max: max.map((v, i) => (v + t[i]) * s),
      };
    }));
    const screen = parts.find(p => p.material === 'classic_laptop_screen');
    const [tl, tr, br, bl] = LAPTOP_SCREEN;
    expect(tl).toEqual([expect.closeTo(screen.min[0], 4), expect.closeTo(screen.max[1], 4), expect.closeTo(screen.max[2], 4)]);
    expect(tr).toEqual([expect.closeTo(screen.max[0], 4), expect.closeTo(screen.max[1], 4), expect.closeTo(screen.max[2], 4)]);
    expect(br).toEqual([expect.closeTo(screen.max[0], 4), expect.closeTo(screen.min[1], 4), expect.closeTo(screen.max[2], 4)]);
    expect(bl).toEqual([expect.closeTo(screen.min[0], 4), expect.closeTo(screen.min[1], 4), expect.closeTo(screen.max[2], 4)]);

    // LAPTOP is the whole model's width, height and depth.
    const min = [0, 1, 2].map(i => Math.min(...parts.map(p => p.min[i])));
    const max = [0, 1, 2].map(i => Math.max(...parts.map(p => p.max[i])));
    LAPTOP.forEach((size, i) => expect(size).toBeCloseTo(max[i] - min[i], 3));
  });

  it('puts the computer on the desk (#114): a laptop facing the chair, the BedroomPC on it', () => {
    const go = room.root.find('BedroomPC');
    expect(go).toBeTruthy();
    expect(room.pc).toBeInstanceOf(BedroomPC);
    expect(go.getComponent(Interactable)).toBe(room.pc);
    expect(engine._bodyToGO.get(go.rigidBody.handle)).toBe(go);    // the interact ray lands on it

    // Standing on the desk top, wholly over the desk, clear of the lamp.
    const desk = footprint(room.root.find('Desk'));
    const pc = footprint(go);
    expect(go.object3d.position.y - go._originalSize[1] / 2).toBeCloseTo(0.79);
    expect(pc.x0).toBeGreaterThanOrEqual(desk.x0);
    expect(pc.x1).toBeLessThanOrEqual(desk.x1);
    expect(pc.z0).toBeGreaterThanOrEqual(desk.z0);
    expect(pc.z1).toBeLessThanOrEqual(desk.z1);
    const lamp = room.root.find('DeskLamp').object3d.position;
    expect(overlaps(pc, { x0: lamp.x - 0.12, x1: lamp.x + 0.12, z0: lamp.z - 0.12, z1: lamp.z + 0.12 })).toBe(false);

    // The laptop, drawn only, its screen (+z) turned to the chair; the box
    // round it is the laptop's size.
    const model = room.root.find('BedroomPCModel');
    expect(model.physicsAssetKey).toBe('model:laptop');
    expect(go._originalSize).toEqual([LAPTOP[2], LAPTOP[1], LAPTOP[0]]);
    expect(model.rigidBody).toBeFalsy();
    expect(model.object3d.position.y).toBeCloseTo(0.79);
    const chair = room.root.find('DeskChair').object3d.position;
    const facing = new THREE.Vector3(0, 0, 1).applyEuler(model.object3d.rotation);
    const toChair = new THREE.Vector3(chair.x - model.object3d.position.x, 0, chair.z - model.object3d.position.z).normalize();
    expect(facing.dot(toChair)).toBeGreaterThan(0.95);
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

  describe('the bedroom desk', () => {
    it('has no notebook on it: the desk is free for the PC (#114)', () => {
      expect(room.root.find('Notebook')).toBeFalsy();
    });

    it('lights the desk lamp: a real light, no shadow, under the room (so the grid switches it)', () => {
      const lamp = room.root.find('DeskLamp');
      const lights = [];
      lamp.object3d.traverse(o => { if (o.isPointLight) lights.push(o); });
      expect(lights.length).toBe(1);
      expect(lights[0].castShadow).toBe(false);
      expect(lights[0].intensity).toBeGreaterThan(0);
    });

    it('wakes the player beside the bunk, on clear floor, facing the desk', () => {
      const { position: [wx, , wz], yaw } = room.spawn;
      const [ox, , oz] = room.position;
      const p = { x: wx - ox, z: wz - oz };
      const r = 0.3;                                            // the player's radius
      const me = { x0: p.x - r, x1: p.x + r, z0: p.z - r, z1: p.z + r };
      for (const name of FURNITURE) {
        expect(overlaps(me, footprint(room.root.find(name))), name).toBe(false);
      }
      const bunk = footprint(room.root.find('Bunk'));
      const gap = Math.max(bunk.x0 - p.x, p.x - bunk.x1, bunk.z0 - p.z, p.z - bunk.z1);
      expect(gap).toBeLessThan(1.2);
      // Looking along yaw (forward is (-sin, -cos)) points at the desk.
      const desk = room.root.find('Desk').object3d.position;
      const to = new THREE.Vector2(desk.x - p.x, desk.z - p.z).normalize();
      expect(to.dot(new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw)))).toBeGreaterThan(0.95);
    });
  });
});
