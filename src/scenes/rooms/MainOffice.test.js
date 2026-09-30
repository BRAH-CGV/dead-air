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

import { MainOffice, RationDispenser } from './MainOffice.js';
import { GameObject } from '../../core/GameObject.js';
import { Interactable } from '../../components/Interactable.js';
import { WallClock } from '../../gameobjects/WallClock.js';
import { PRELOAD } from '../../assets/manifest.js';
import { SightlineZone } from '../../gameobjects/SightlineZone.js';
import { PLAYER_BODY } from '../../components/PlayerBody.js';

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
    expect(use).toBeInstanceOf(RationDispenser);
    expect(use).toBe(room.rationDispenser);
    expect(use.promptLabel).toMatch(/\[E\].*ration/i);
    expect(() => use.onInteract({})).not.toThrow();              // no stamina wired: nothing to feed
    expect(use.promptLabel).toMatch(/\[E\].*ration/i);
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

describe('MainOffice ration dispenser (night 1)', () => {
  function make() {
    const dispenser = new RationDispenser();
    dispenser.stamina = { value: 0.3, restore(a) { this.value = Math.min(1, this.value + a); } };
    return dispenser;
  }

  it('a ration gives back 0.35 stamina', () => {
    const dispenser = make();
    dispenser.onInteract({});
    expect(dispenser.stamina.value).toBeCloseTo(0.65);
  });

  it('refills for 40 s after each ration, and says so', () => {
    const dispenser = make();
    dispenser.onInteract({});
    expect(dispenser.promptLabel).toBe('Dispenser refilling…');

    dispenser.onInteract({});                                   // nothing while refilling
    expect(dispenser.stamina.value).toBeCloseTo(0.65);

    dispenser.onUpdate(39.9);
    expect(dispenser.promptLabel).toBe('Dispenser refilling…');
    dispenser.onUpdate(0.2);
    expect(dispenser.promptLabel).toMatch(/\[E\].*ration/i);
    dispenser.onInteract({});
    expect(dispenser.stamina.value).toBeCloseTo(1);
  });

  it('tells the scene when the player eats', () => {
    const dispenser = make();
    dispenser.onEat = vi.fn();
    dispenser.onInteract({});
    dispenser.onInteract({});
    expect(dispenser.onEat).toHaveBeenCalledTimes(1);
  });

  it('reset() has a ration ready for a new or retried night', () => {
    const dispenser = make();
    dispenser.onInteract({});
    dispenser.reset();
    expect(dispenser.promptLabel).toMatch(/\[E\].*ration/i);
    dispenser.onInteract({});
    expect(dispenser.stamina.value).toBeCloseTo(1);
  });
});

describe('MainOffice sleep demon anchors (night 1)', () => {
  const room = new MainOffice(makeEngine());
  room.build();
  const inX = room.width / 2 - room.wallThick / 2;
  const inZ = room.depth / 2 - room.wallThick / 2;

  it('outsideWindow stands out in the dust, framed by the back window', () => {
    const [x, y, z] = room.threatAnchors.outsideWindow;
    expect(z).toBeLessThan(room.threatAnchors.windowGlass[2] - 2);
    expect(Math.abs(x)).toBeLessThan(8.5 / 2 - 0.5);
    expect(y).toBe(0);
  });

  it('leftDoorway is just inside the doorway to the living quarters', () => {
    const [x, y, z] = room.threatAnchors.leftDoorway;
    const door = room.doors.find(d => d.targetRoom === 'LivingQuarters');
    expect(x).toBeGreaterThan(-inX);
    expect(x).toBeLessThan(-inX + 1);
    expect(z).toBeCloseTo(door.object3d.position.z);
    expect(y).toBe(0);
  });

  it('cornerBehindDesk is in the back-left corner, clear of the dispenser and the window', () => {
    const [x, y, z] = room.threatAnchors.cornerBehindDesk;
    expect(x).toBeLessThan(-8.5 / 2);                          // beside the glass, not in front of it
    expect(x).toBeGreaterThan(-inX + 0.2);
    expect(z).toBeLessThan(-2.55);                             // past the desk
    expect(z).toBeGreaterThan(-inZ + 0.2);
    expect(z).toBeLessThan(-1.0 - 0.45 - 0.5);                 // a body's width off the dispenser
    expect(y).toBe(0);
  });
});

describe('MainOffice hiding spot and window anchor (night 2)', () => {
  const { crouchEyeHeight, standEyeHeight } = PLAYER_BODY;

  it('builds an UnderDesk zone: a crouched eye in the kneehole is inside, a player at the chair is not', () => {
    const room = new MainOffice(makeEngine());
    room.build();
    const zone = room.underDesk;
    expect(zone).toBeInstanceOf(SightlineZone);
    expect(zone.name).toBe('UnderDesk');

    // Kneehole: between the side walls (x ±0.545), in front of the solid back
    // region (z -2.61), and the player's 0.3 m radius keeps the eye 0.3 m off it.
    expect(zone.containsPoint(new THREE.Vector3(0, crouchEyeHeight, -2.35))).toBe(true);
    expect(zone.containsPoint(new THREE.Vector3(0.95, standEyeHeight, -1.75))).toBe(false);
    expect(zone.containsPoint(new THREE.Vector3(0.95, crouchEyeHeight, -1.75))).toBe(false);
    // Standing up in the kneehole puts the eye over the desk top.
    expect(zone.containsPoint(new THREE.Vector3(0, standEyeHeight, -2.35))).toBe(false);
  });

  it('the zone rides the room offset, like every other room feature', () => {
    const room = new MainOffice(makeEngine(), { position: [10, 0, 5] });
    room.build();
    expect(room.underDesk.containsPoint(new THREE.Vector3(10, crouchEyeHeight, 5 - 2.35))).toBe(true);
    expect(room.underDesk.containsPoint(new THREE.Vector3(0, crouchEyeHeight, -2.35))).toBe(false);
  });

  it('is a marker, not a body: nothing to bump into or raycast', () => {
    const room = new MainOffice(makeEngine());
    room.build();
    expect(room.underDesk.rigidBody).toBeFalsy();
  });

  it('exposes the spot outside the window glass, room-local, clear of the back wall', () => {
    const room = new MainOffice(makeEngine());
    room.build();
    const [x, y, z] = room.threatAnchors.windowGlass;
    const backOuterFace = -(room.depth / 2 + room.wallThick / 2);
    expect(z).toBeLessThan(backOuterFace - 0.3);
    expect(z).toBeGreaterThan(backOuterFace - 1);
    expect(x).toBe(0);
    expect(y).toBe(0);
  });
});

describe('MainOffice lights', () => {
  it('every light it built is on the power, with the ceiling fixture and the dispenser glow', () => {
    const room = new MainOffice(makeEngine());
    room.build();
    for (const light of pointLights(room)) expect(room.lights).toContain(light);
    const fixture = room.root.find('CeilingLight').object3d.children.find(o => o.isMesh);
    expect(room.lights).toContain(fixture);
    const glowing = [];
    room.root.find('VendingMachine').object3d.traverse(o => {
      if (o.isMesh && o.material.emissiveIntensity > 0 && o.material.emissive?.getHex()) glowing.push(o);
    });
    expect(glowing.length).toBeGreaterThan(0);
    for (const mesh of glowing) expect(room.lights).toContain(mesh);
  });
});
