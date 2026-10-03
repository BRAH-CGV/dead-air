import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

// Recording Rapier fake — see Room.test.js.
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

import { MainOffice } from './MainOffice.js';
import { GameObject } from '../../core/GameObject.js';
import { Interactable } from '../../components/Interactable.js';
import { Pickupable } from '../../components/Pickupable.js';
import { WallClock } from '../../gameobjects/WallClock.js';
import { SignalAlertLight } from '../../gameobjects/SignalAlertLight.js';
import { Drive } from '../../gameobjects/Drive.js';
import { PRELOAD } from '../../assets/manifest.js';

let nextHandle = 1;
class FakeWorld {
  _bodies = new Set();
  bodies = { len: () => this._bodies.size };
  createRigidBody(desc) {
    const body = {
      handle: nextHandle++,
      isFixed: () => desc.type === 'fixed',
      translation: () => ({ ...desc.t }),
    };
    this._bodies.add(body);
    return body;
  }
  createCollider(desc) {
    let sensor = desc.sensor;
    return { halfExtents: () => ({ ...desc.half }), isSensor: () => sensor, setSensor: s => { sensor = s; } };
  }
  removeRigidBody(body) { this._bodies.delete(body); }
}

/** Engine stand-in. spawnModel mimics the real one where it matters here:
 *  the body goes where `position` says (world space), and the GameObject is
 *  registered as a root object. */
function makeEngine() {
  const engine = {
    world: new FakeWorld(),
    _rootObjects: [],
    _bodyToGO: new Map(),
    rigidBodyMap: new Map(),
    spawnModel: vi.fn((key, opts = {}) => {
      const go = new GameObject(opts.name ?? key);
      const [x, y, z] = opts.position ?? [0, 0, 0];
      go.object3d.position.set(x, y, z);
      go.object3d.rotation.y = opts.rotationY ?? 0;
      if (opts.physics !== 'none') {
        go.rigidBody = engine.world.createRigidBody({ type: 'fixed', t: { x, y, z } });
        engine._bodyToGO.set(go.rigidBody.handle, go);
      }
      go.physicsAssetKey = key;
      engine._rootObjects.push(go);
      return go;
    }),
  };
  return engine;
}

function pointLights(room) {
  const lights = [];
  room.root.object3d.traverse(o => { if (o.isPointLight) lights.push(o); });
  return lights;
}

function childNames(room) {
  return room.root.children.map(c => c.name);
}

/** Real floor size [x, z] of each spawned model, unrotated: its .glb's
 *  measured bounds times the manifest scale. The fake spawnModel loads no
 *  mesh, so there's nothing to measure. */
const MODEL_SIZE = {
  ComputerDesk: [1.6, 0.8],
  DeskChair: [0.44, 0.51],
  TrashBin: [0.31, 0.33],
  Shelf: [0.36, 1.03],
  FireExtinguisher: [0.2, 0.25],
};

/** Floor footprint {x0, x1, z0, z1} of a room child, room-local. A
 *  procedural prop is measured; a spawned model is its MODEL_SIZE turned by
 *  its yaw. */
function footprint(go) {
  const box = new THREE.Box3().setFromObject(go.object3d);
  if (!box.isEmpty()) return { x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z };
  const [w, d] = MODEL_SIZE[go.name];
  const { x, z } = go.object3d.position;
  const cos = Math.abs(Math.cos(go.object3d.rotation.y));
  const sin = Math.abs(Math.sin(go.object3d.rotation.y));
  const hx = (cos * w + sin * d) / 2;
  const hz = (sin * w + cos * d) / 2;
  return { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz };
}

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

/** The first metre of floor inside each doorway, where the player walks through. */
function doorwayApproaches(room) {
  const inX = room.width / 2 - room.wallThick / 2;
  const inZ = room.depth / 2 - room.wallThick / 2;
  return room.doors.map(door => {
    const { x, z } = door.object3d.position;
    const half = door.doorSize[0] / 2 + 0.1;
    if (Math.abs(z) >= inZ) {
      const z0 = z > 0 ? inZ - 1 : -inZ;
      return { name: door.name, x0: x - half, x1: x + half, z0, z1: z0 + 1 };
    }
    const x0 = x > 0 ? inX - 1 : -inX;
    return { name: door.name, x0, x1: x0 + 1, z0: z - half, z1: z + half };
  });
}

/** Everything standing on the floor that isn't part of the shell. */
const FURNITURE = ['ComputerDesk', 'DeskChair', 'VendingMachine', 'TrashBin', 'Shelf', 'FireExtinguisher'];

describe('MainOffice', () => {
  let engine, room;

  beforeEach(() => {
    engine = makeEngine();
    room = new MainOffice(engine);
    room.build();
  });

  it('is a 12 × 10 × 3 room named MainOffice, at the origin by default', () => {
    expect(room.root.name).toBe('Room:MainOffice');
    expect([room.width, room.depth, room.height]).toEqual([12, 10, 3]);
    expect(room.root.object3d.position.toArray()).toEqual([0, 0, 0]);
  });

  it('keeps the computer desk and clears out the props with no job', () => {
    expect(room.root.find('ComputerDesk')).not.toBeNull();
    for (const name of ['ServerRack', 'RadarTerminal', 'Switchboard']) {
      expect(room.root.find(name), name).toBeNull();
    }
    expect(childNames(room).filter(n => n.startsWith('SecurityCamera_'))).toEqual([]);

    const keys = engine.spawnModel.mock.calls.map(([key]) => key);
    for (const gone of ['model:server-rack', 'model:radar-terminal', 'model:switchboard', 'model:security-camera']) {
      expect(keys, gone).not.toContain(gone);
    }
  });

  it('is dressed for the job: a chair at the desk, a bin, a shelf, an extinguisher and a poster', () => {
    const expected = {
      DeskChair: 'model:metal-chair',
      TrashBin: 'model:trash-bin',
      Shelf: 'model:shelf',
      FireExtinguisher: 'model:fire-extinguisher',
      Poster: 'model:poster',
    };
    for (const [name, key] of Object.entries(expected)) {
      expect(room.root.find(name)?.physicsAssetKey, name).toBe(key);
    }
  });

  it('spawns only models the scene preloads', () => {
    const keys = engine.spawnModel.mock.calls.map(([key]) => key);
    expect(PRELOAD).toEqual(expect.arrayContaining(keys));
  });

  it('pulls the chair out beside the desk, leaving the kneehole open to crouch into', () => {
    // The desk collider's kneehole runs between its side walls, x −0.545 …
    // 0.545, and opens toward +z from the desk front at z −2.15. The player
    // has to be able to walk straight up to it.
    const kneehole = { x0: -0.545, x1: 0.545, z0: -2.15, z1: -1.15 };
    const chair = room.root.find('DeskChair');
    expect(overlaps(footprint(chair), kneehole)).toBe(false);
    // Still at the desk, not across the room.
    expect(chair.object3d.position.distanceTo(new THREE.Vector3(0, 0, -2.55))).toBeLessThan(1.5);
  });

  it('has a food-ration dispenser against the left wall: solid, lit and usable', () => {
    const dispenser = room.root.find('VendingMachine');
    expect(dispenser.parent).toBe(room.root);
    expect(dispenser.rigidBody.isFixed()).toBe(true);           // the interact ray hits it
    expect(engine._bodyToGO.get(dispenser.rigidBody.handle)).toBe(dispenser);

    const box = new THREE.Box3().setFromObject(dispenser.object3d);
    expect(box.min.x).toBeGreaterThan(-5.9 - 1e-6);             // not sunk into the wall
    expect(box.min.x).toBeLessThan(-5.8);                       // but standing against it
    expect(box.max.y).toBeGreaterThan(1.6);                     // machine-sized

    const glows = [];
    dispenser.object3d.traverse(o => { if (o.isMesh && o.material.emissive?.getHex()) glows.push(o); });
    expect(glows.length).toBeGreaterThan(0);                    // findable in the dark

    const use = dispenser.getComponent(Interactable);
    expect(use.promptLabel).toMatch(/\[E\].*ration/i);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => use.onInteract({})).not.toThrow();
    log.mockRestore();
  });

  it('keeps the furniture inside the room and out of every doorway', () => {
    const inX = room.width / 2 - room.wallThick / 2;
    const inZ = room.depth / 2 - room.wallThick / 2;
    const approaches = doorwayApproaches(room);
    expect(approaches.length).toBe(3);

    for (const name of FURNITURE) {
      const f = footprint(room.root.find(name));
      expect(f.x0, name).toBeGreaterThan(-inX - 1e-6);
      expect(f.x1, name).toBeLessThan(inX + 1e-6);
      expect(f.z0, name).toBeGreaterThan(-inZ - 1e-6);
      expect(f.z1, name).toBeLessThan(inZ + 1e-6);
      for (const door of approaches) {
        expect(overlaps(f, door), `${name} blocks ${door.name}`).toBe(false);
      }
    }
  });

  it('hangs the poster flat on the right wall, facing into the room', () => {
    const [, opts] = engine.spawnModel.mock.calls.find(([key]) => key === 'model:poster');
    expect(opts.physics).toBe('none');
    const poster = room.root.find('Poster').object3d;
    expect(poster.position.x).toBeCloseTo(5.9);
    // The model faces +z; a quarter turn clockwise points that at −x.
    const facing = new THREE.Vector3(0, 0, 1).applyEuler(poster.rotation);
    expect(facing.x).toBeCloseTo(-1);
  });

  it('props are room children only — not also root objects (no double update)', () => {
    const computer = room.root.find('ComputerDesk');
    expect(computer.parent).toBe(room.root);
    expect(engine._rootObjects).not.toContain(computer);
  });

  it('has a window opening in the back wall: 4 segments plus the frame', () => {
    const back = childNames(room).filter(n => n.startsWith('BackWall')).sort();
    expect(back).toEqual(['BackWall_A', 'BackWall_B', 'BackWall_Header', 'BackWall_Sill']);
    const frame = childNames(room).filter(n => n.startsWith('WindowFrame_'));
    expect(frame.length).toBe(7);
  });

  it('has a doorway to the server room (right wall) and living quarters (left wall)', () => {
    const right = room.doors.find(d => d.targetRoom === 'ServerRoom');
    const left  = room.doors.find(d => d.targetRoom === 'LivingQuarters');
    expect(right.name).toBe('Door:ToServerRoom');
    expect(right.object3d.position.x).toBeCloseTo(6);
    expect(left.name).toBe('Door:ToLivingQuarters');
    expect(left.object3d.position.x).toBeCloseTo(-6);
    expect(childNames(room)).toEqual(expect.arrayContaining(['RightWall_A', 'RightWall_B', 'RightWall_Header']));
    expect(childNames(room)).toEqual(expect.arrayContaining(['LeftWall_A', 'LeftWall_B', 'LeftWall_Header']));
  });

  it('keeps the original front door, now leading into the airlock', () => {
    // Never straight outside: this is Mars. The airlock's hatch is the door
    // onto the surface.
    expect(room.doors.some(d => d.targetRoom === 'Outside')).toBe(false);
    const front = room.doors.find(d => d.targetRoom === 'Airlock');
    expect(front.name).toBe('Door:ToAirlock');
    expect(front.locked).toBe(false);
    expect(front.object3d.position.x).toBeCloseTo(2);
    expect(front.object3d.position.z).toBeCloseTo(5);
  });

  it('puts the side doorways toward the front, leaving the back of the side walls for furniture', () => {
    // The dispenser and bin stand on the left wall and the shelf on the
    // right, all well behind z = 2; the doorways sit forward of it.
    for (const door of room.doors.filter(d => d.targetRoom !== 'Airlock')) {
      const [w] = door.doorSize;
      const z = door.object3d.position.z;
      expect(z - w / 2).toBeGreaterThan(2);
    }
  });

  it('lighting matches the original office: warm ceiling light and cool desk glow', () => {
    const lights = pointLights(room);
    expect(lights.length).toBe(2);
    const ceiling = room.root.find('CeilingLight').object3d.children.find(o => o.isPointLight);
    const desk    = room.root.find('DeskGlow').object3d.children.find(o => o.isPointLight);
    expect(ceiling.position.toArray()).toEqual([0, 2.75, 0.4]);
    expect(ceiling.color.getHex()).toBe(0xffd8a8);
    expect(ceiling.castShadow).toBe(true);
    expect(desk.position.toArray()).toEqual([0, 1.1, -2.1]);
    expect(desk.color.getHex()).toBe(0x66ccff);
  });

  it('turns the computer desk to face the window, so the seat looks out at the dish', () => {
    const [, opts] = engine.spawnModel.mock.calls.find(([key]) => key === 'model:retro-computer');
    expect(opts.rotationY).toBe(0);
  });

  it('leaves the computer desk without an Interactable — the scene wires the terminal onto it', () => {
    // A second Interactable would shadow the terminal's: InteractionSystem
    // resolves getComponent(Interactable), which returns the first match.
    expect(room.root.find('ComputerDesk').getComponent(Interactable)).toBeNull();
  });

  it('hangs a wall clock on the back wall beside the window, facing into the room', () => {
    const clock = room.root.find('WallClock');
    expect(clock).toBeInstanceOf(WallClock);
    expect(room.wallClock).toBe(clock);             // the scene hands it the NightClock

    const box = new THREE.Box3().setFromObject(clock.object3d);
    expect(clock.object3d.position.z).toBeCloseTo(-4.9);   // flush on the wall's inner face
    expect(box.min.z).toBeGreaterThan(-4.9 - 1e-6);        // not sunk into it
    expect(box.min.x).toBeGreaterThan(4.43);               // clear of the window frame
    expect(box.max.x).toBeLessThan(5.9);                   // clear of the right wall
    expect(box.min.y).toBeGreaterThan(1.5);                // above the desk, readable
    expect(box.max.y).toBeLessThan(2.9);                   // below the ceiling
  });

  it('perches a signal alert lamp above the computer desk, in sight of the room', () => {
    const light = room.root.find('SignalAlertLight');
    expect(light).toBeInstanceOf(SignalAlertLight);
    expect(room.signalLight).toBe(light);            // the scene wires it to gameplay

    const pos = light.object3d.position;
    expect(Math.abs(pos.x)).toBeLessThan(0.5);       // over the desk…
    expect(pos.z).toBeGreaterThan(-3.05);            // …which stands at z −2.55
    expect(pos.z).toBeLessThan(-2.05);
    expect(pos.y).toBeGreaterThan(1.0);              // clear of the monitor
    expect(pos.y).toBeLessThan(2.2);                 // below the ceiling
  });

  it('has a drive reader on the desk surface with an Interactable', () => {
    const reader = room.root.find('DriveReader');
    expect(reader).not.toBeNull();
    expect(reader.rigidBody.isFixed()).toBe(true);
    const interact = reader.getComponent(Interactable);
    expect(interact).not.toBeNull();
    expect(interact.promptLabel).toMatch(/\[E\].*drive/i);
  });

  it('places three placeholder drive cubes beside the desk', () => {
    expect(room.drives).toHaveLength(3);
    for (const drive of room.drives) {
      expect(drive).toBeInstanceOf(Drive);
      expect(drive.parent).toBe(room.root);
    }
    // Drives are on the floor, near the desk (not inside the room shell walls)
    for (const drive of room.drives) {
      const pos = drive.object3d.position;
      expect(pos.y).toBeCloseTo(0.01, 1);
      expect(Math.abs(pos.x)).toBeLessThan(5.8);
      expect(Math.abs(pos.z)).toBeLessThan(4.8);
    }
  });

  it('bindDriveManager wires the manager and refreshes the reader prompt', () => {
    const dm = { driveInserted: false, hasAvailableDrives: () => true, addDrive: vi.fn() };
    room.bindDriveManager(dm);
    const interact = room.driveReader.getComponent(Interactable);
    // With available drives but nothing held, the prompt tells the player to pick one up.
    expect(interact.promptLabel).toMatch(/Pick up a drive first/);

    // When a drive is inserted, the prompt offers to eject it.
    dm.driveInserted = true;
    room.updateDriveReaderPrompt();
    expect(interact.promptLabel).toMatch(/Eject drive/);

    // When the player is holding one of our drives, the prompt offers to insert it.
    dm.driveInserted = false;
    room._pickupSystem = { heldPickupable: { gameObject: room.drives[0] } };
    room.updateDriveReaderPrompt();
    expect(interact.promptLabel).toMatch(/Insert drive/);

    // Anything else in hand is not insertable — only the drives are.
    room._pickupSystem = { heldPickupable: { gameObject: new GameObject('Crate') } };
    room.updateDriveReaderPrompt();
    expect(interact.promptLabel).toMatch(/Pick up a drive first/);
  });

  it('inserts a carried drive: registers it, locks it, and snaps it onto the reader upright', () => {
    const drive = room.drives[0];
    drive.rigidBody = { setTranslation: vi.fn(), setRotation: vi.fn() };
    const makeKinematic = vi.spyOn(drive, 'makeKinematic').mockImplementation(() => {});
    const dropHeld = vi.fn();
    room._pickupSystem = { heldPickupable: { gameObject: drive, held: true }, dropHeld };
    const dm = { driveInserted: false, hasAvailableDrives: () => true, addDrive: vi.fn(), insertDrive: vi.fn() };
    room.bindDriveManager(dm);

    room.driveReader.getComponent(Interactable).onInteract({});

    expect(dropHeld).toHaveBeenCalled();
    expect(dm.insertDrive).toHaveBeenCalledWith(drive);
    expect(makeKinematic).toHaveBeenCalled();

    // Snapped onto the reader lid, upright — not left floating mid-air.
    const slot = new THREE.Vector3();
    room.driveReader.object3d.getWorldPosition(slot);
    const [snap, wake] = drive.rigidBody.setTranslation.mock.calls[0];
    expect(wake).toBe(true);
    expect(snap.x).toBeCloseTo(slot.x, 5);
    expect(snap.y).toBeCloseTo(slot.y + 0.015 + drive._size[1] / 2, 5);
    expect(snap.z).toBeCloseTo(slot.z, 5);
    expect(drive.rigidBody.setRotation).toHaveBeenCalledWith({ x: 0, y: 0, z: 0, w: 1 }, true);
  });

  it('ejects the inserted drive and hands it to the player when their hands are free', () => {
    const drive = room.drives[2];
    drive.setSaved(true);                                      // written to during its night
    const pickupable = drive.addComponent(new Pickupable());   // _init does this at runtime
    const pickUp = vi.fn();
    room._pickupSystem = { heldPickupable: null, pickUp };
    const dm = { driveInserted: true, hasAvailableDrives: () => true, addDrive: vi.fn(), ejectDrive: vi.fn(() => drive) };
    room.bindDriveManager(dm);

    room.driveReader.getComponent(Interactable).onInteract({});

    expect(dm.ejectDrive).toHaveBeenCalled();
    expect(drive.saved).toBe(false);                           // indicator reset for reuse
    expect(pickUp).toHaveBeenCalledWith(pickupable);
  });

  it('leaves global lights (ambient, moon) to the scene', () => {
    let globals = 0;
    room.root.object3d.traverse(o => { if (o.isAmbientLight || o.isDirectionalLight) globals++; });
    expect(globals).toBe(0);
  });
});

describe('MainOffice placement', () => {
  it('spawns props at world position (room offset + local) but keeps them local under the room', () => {
    const engine = makeEngine();
    const room = new MainOffice(engine, { position: [5, 0, 0] });
    room.build();

    const [, opts] = engine.spawnModel.mock.calls.find(([key]) => key === 'model:shelf');
    const shelf = room.root.find('Shelf');
    const local = shelf.object3d.position;
    expect(opts.position[0]).toBeCloseTo(local.x + 5);
    expect(opts.position[2]).toBeCloseTo(local.z);
    expect(local.x).toBeGreaterThan(5);                   // still room-local, on its right wall
    expect(shelf.rigidBody.translation().x).toBeCloseTo(local.x + 5);
    expect(shelf.parent).toBe(room.root);
  });

  it('dispose removes every body, including the props, and forgets their handles', () => {
    const engine = makeEngine();
    const room = new MainOffice(engine);
    room.build();
    expect(engine._bodyToGO.size).toBeGreaterThan(0);

    room.dispose();
    expect(engine.world.bodies.len()).toBe(0);
    expect(engine._bodyToGO.size).toBe(0);
  });

  it('dispose frees the light fixture it created', () => {
    const engine = makeEngine();
    const room = new MainOffice(engine);
    room.build();
    const fixture = room.root.find('CeilingLight').object3d.children.find(o => o.isMesh);
    let geom = false, mat = false;
    fixture.geometry.addEventListener('dispose', () => { geom = true; });
    fixture.material.addEventListener('dispose', () => { mat = true; });
    room.dispose();
    expect(geom).toBe(true);
    expect(mat).toBe(true);
  });
});

describe('MainOffice wall clock teardown', () => {
  it('dispose frees the wall clock with the rest of the room', () => {
    const room = new MainOffice(makeEngine());
    room.build();
    const dispose = vi.spyOn(room.wallClock, 'dispose');
    room.dispose();
    expect(dispose).toHaveBeenCalled();
  });
});

describe('MainOffice signal alert light teardown', () => {
  it('dispose frees the alert light with the rest of the room', () => {
    const room = new MainOffice(makeEngine());
    room.build();
    const dispose = vi.spyOn(room.signalLight, 'dispose');
    room.dispose();
    expect(dispose).toHaveBeenCalled();
  });
});

describe('MainOffice window frame', () => {
  it('frame parts are static boxes centred on their pivots', () => {
    const room = new MainOffice(makeEngine());
    room.build();
    for (const go of room.root.children.filter(c => c.name.startsWith('WindowFrame_'))) {
      expect(go.rigidBody.isFixed(), go.name).toBe(true);
      const mesh = go.object3d.children.find(c => c.isMesh);
      expect(mesh.position.equals(new THREE.Vector3()), go.name).toBe(true);
    }
  });
});
