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
import { Pickupable } from '../../components/Pickupable.js';
import { DriveSlot } from '../../components/DriveSlot.js';
import { WallClock } from '../../gameobjects/WallClock.js';
import { DigitalClock } from '../../gameobjects/DigitalClock.js';
import { GlobeSpin } from '../../components/GlobeSpin.js';
import { deskWingOutline } from './DeskWing.js';
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
  TrashBin: [0.31, 0.33],
  Shelf: [0.36, 1.03],
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
const FURNITURE = ['ComputerDesk', 'DeskWing_Left', 'DeskWing_Right', 'GrowBeds', 'VendingMachine', 'TrashBin', 'Shelf'];

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

  it('is dressed for the job: a bin, a shelf and a poster', () => {
    const expected = {
      TrashBin: 'model:trash-bin',
      Shelf: 'model:shelf',
      Poster: 'model:poster',
    };
    for (const [name, key] of Object.entries(expected)) {
      expect(room.root.find(name)?.physicsAssetKey, name).toBe(key);
    }
    // One poster only: none over the grow beds.
    expect(engine.spawnModel.mock.calls.filter(([key]) => key === 'model:poster').length).toBe(1);
    expect(room.root.find('Poster_Left')).toBeNull();
  });

  it('has no chair at the station and no extinguisher by the door (interior layout mock-up)', () => {
    for (const name of ['DeskChair', 'FireExtinguisher']) expect(room.root.find(name), name).toBeNull();
    const keys = engine.spawnModel.mock.calls.map(([key]) => key);
    expect(keys).not.toContain('model:metal-chair');
    expect(keys).not.toContain('model:fire-extinguisher');
  });

  it('spawns only models the scene preloads', () => {
    const keys = engine.spawnModel.mock.calls.map(([key]) => key);
    expect(PRELOAD).toEqual(expect.arrayContaining(keys));
  });

  it('extends the desk top with an angled wing on each side, leaving the kneehole open to crouch into', () => {
    // The desk collider's kneehole runs between its side walls, x −0.545 …
    // 0.545, and opens toward +z from the desk front at z −2.15. The player
    // has to be able to walk straight up to it.
    const kneehole = { x0: -0.545, x1: 0.545, z0: -2.15, z1: -1.15 };
    for (const [name, side] of [['DeskWing_Left', -1], ['DeskWing_Right', 1]]) {
      const wing = room.root.find(name);
      const meshes = wing.object3d.children.filter(c => c.isMesh);
      expect(meshes.length, name).toBe(1);                       // one continuous piece

      const box = new THREE.Box3().setFromObject(wing.object3d);
      expect(box.max.y, name).toBeCloseTo(0.864);                // level with the desk top
      expect(box.min.y, name).toBeCloseTo(0);
      // It starts on the desk top's own edge (x ±0.75) and reaches the desk's back (z −2.95).
      expect(side > 0 ? box.min.x : -box.max.x, name).toBeCloseTo(0.75, 2);
      expect(box.min.z, name).toBeCloseTo(-2.95);
      expect(overlaps(footprint(wing), kneehole), name).toBe(false);
    }
  });

  it('the wings are solid: a turned box under each top, and a back that closes the wedge beside the desk', () => {
    for (const side of ['Left', 'Right']) {
      const solid = room.root.find(`DeskWingSolid_${side}`);
      expect(solid.rigidBody.isFixed(), side).toBe(true);
      expect(Math.abs(solid.object3d.rotation.y), side).toBeCloseTo(Math.PI / 4);
      expect(solid.object3d.children.some(c => c.isMesh), side).toBe(false);   // the wing mesh is what is drawn
      const half = solid.collider.halfExtents();
      expect(half.x * 2, side).toBeCloseTo(0.85);
      expect(half.y * 2, side).toBeCloseTo(0.864);
      expect(room.root.find(`DeskWingBack_${side}`).rigidBody.isFixed(), side).toBe(true);
    }
  });

  it('draws the wings with the desk\'s own material, so the wood, the dark and the cream are the desk\'s', () => {
    // The real desk comes with its baked texture; the fake one here has no mesh.
    const withMesh = makeEngine();
    const deskMaterial = new THREE.MeshStandardMaterial({ name: 'Computer', map: new THREE.Texture() });
    const spawn = withMesh.spawnModel.getMockImplementation();
    withMesh.spawnModel.mockImplementation((key, opts) => {
      const go = spawn(key, opts);
      if (key === 'model:retro-computer') go.object3d.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), deskMaterial));
      return go;
    });
    const textured = new MainOffice(withMesh);
    textured.build();
    for (const name of ['DeskWing_Left', 'DeskWing_Right']) {
      expect(textured.root.find(name).object3d.children[0].material, name).toBe(deskMaterial);
    }
    // The asset cache owns that material: the room must not free it.
    let freed = false;
    deskMaterial.addEventListener('dispose', () => { freed = true; });
    textured.dispose();
    expect(freed).toBe(false);

    // Without it (no texture to map into), a plain wood stand-in.
    const plain = room.root.find('DeskWing_Left').object3d.children[0].material;
    expect(plain.map).toBeNull();
  });

  it('leaves the desk itself bare: no joystick, no camera console', () => {
    expect(room.root.find('Joystick')).toBeNull();
    expect(room.root.find('CameraConsole')).toBeNull();
  });

  /** Is the room-local point over the right wing's top, at least `margin`
   *  in from every edge of it? */
  const onRightWing = ({ x, z }, margin = 0) => {
    const { top } = deskWingOutline(1, { halfW: 0.8, topHalfW: 0.752, front: -2.15, back: -2.95 });
    return top.every(([ax, az], i) => {
      const [bx, bz] = top[(i + 1) % top.length];
      // The outline runs clockwise seen from above: inside is to the right of each edge.
      const inside = ((bx - ax) * (z - az) - (bz - az) * (x - ax)) / Math.hypot(bx - ax, bz - az);
      return inside >= margin;
    });
  };

  it('stands a digital clock where the desk meets its right wing, turned to the seat, for the scene to run off the night clock', () => {
    const clock = room.root.find('DeskClock');
    expect(clock).toBeInstanceOf(DigitalClock);
    expect(room.deskClock).toBe(clock);
    expect(clock.rigidBody).toBeNull();                    // nothing for the interact ray to stop on

    // Placed by eye in the level editor.
    const pos = clock.object3d.position;
    expect(pos.x).toBeCloseTo(0.8);
    expect(pos.y).toBeCloseTo(0.864);                      // standing on the top
    expect(pos.z).toBeCloseTo(-2.6);
    expect(THREE.MathUtils.radToDeg(clock.object3d.rotation.y)).toBeCloseTo(-22.7, 1);
    // Its display looks back toward the seat.
    const facing = new THREE.Vector3(0, 0, 1).applyEuler(clock.object3d.rotation);
    expect(facing.x).toBeLessThan(0);
    expect(facing.z).toBeGreaterThan(0.5);
    // Clear of the drive reader on the desk's right rim (0.65, −2.26).
    expect(Math.hypot(pos.x - 0.65, pos.z + 2.26)).toBeGreaterThan(0.25);
  });

  it('a globe on its stand, on the right wing beside the clock: [E] gives it a spin', () => {
    const globe = room.root.find('Globe'), stand = room.root.find('GlobeStand');
    expect(globe.physicsAssetKey).toBe('model:mars-globe');
    expect(stand.physicsAssetKey).toBe('model:mars-stand');

    // The two models share one origin — the globe's centre — so they are
    // spawned in the same place and turned the same way.
    expect(stand.object3d.position.toArray()).toEqual(globe.object3d.position.toArray());
    expect(stand.object3d.rotation.y).toBeCloseTo(globe.object3d.rotation.y);
    // Placed by eye in the level editor, toward the back of the wing.
    expect(globe.object3d.position.x).toBeCloseTo(1.1);
    expect(globe.object3d.position.z).toBeCloseTo(-2.58);
    // The stand's base is 0.245 m below that origin: on the wing's top.
    expect(globe.object3d.position.y - 0.245).toBeCloseTo(0.864, 2);
    expect(onRightWing(globe.object3d.position, 0.124)).toBe(true);   // the base (r 0.124) wholly on the top

    // Clear of the clock.
    const clock = room.root.find('DeskClock').object3d.position;
    expect(Math.hypot(clock.x - globe.object3d.position.x, clock.z - globe.object3d.position.z)).toBeGreaterThan(0.143 + 0.14);

    // The globe is what the ray hits and what answers it; the stand is drawn only.
    expect(globe.rigidBody.isFixed()).toBe(true);
    expect(engine._bodyToGO.get(globe.rigidBody.handle)).toBe(globe);
    expect(stand.rigidBody).toBeNull();
    const spin = globe.getComponent(Interactable);
    expect(spin).toBeInstanceOf(GlobeSpin);
    expect(spin.promptLabel).toMatch(/\[E\].*globe/i);

    const rest = globe.object3d.quaternion.clone();
    spin.onInteract({});
    for (let i = 0; i < 30; i++) spin.onUpdate(1 / 60);
    expect(globe.object3d.quaternion.angleTo(rest)).toBeGreaterThan(0.3);
    expect(stand.object3d.rotation.y).toBeCloseTo(Math.PI / 4);   // the stand stays put
  });

  it('the ceiling light\'s shadows are biased along the normal, so curved things under it are not striped', () => {
    // Shadow acne: with no bias, the globe (and every other round surface in
    // the office) shadows itself in fine stripes. Not fixed on the globe
    // itself — the base makes every room mesh receive shadows, to keep the
    // UFO's searchlight out (ShadowSides.js).
    const { normalBias, bias } = room.ceilingLight.shadow;
    expect(normalBias).toBeGreaterThanOrEqual(0.02);      // 0.02 clears a 0.14 m ball under a 1024 px map
    expect(normalBias).toBeLessThanOrEqual(0.04);         // more and shadows start to pull away from their casters
    expect(bias).toBe(0);
  });

  it('lines the left wall with the food corner: a two-tier rack of grow beds, then the dispenser and the bin', () => {
    const rack = room.root.find('GrowBeds');
    expect(rack.rigidBody.isFixed()).toBe(true);
    expect(room.root.find('GrowCounter')).toBeNull();          // no counter top any more
    const c = footprint(rack);
    expect(c.x0).toBeCloseTo(-5.9);                            // against the wall
    expect(c.x1 - c.x0).toBeCloseTo(0.7);
    expect(c.z1 - c.z0).toBeCloseTo(3.75);

    // Two layers of three beds, one above the other.
    const beds = rack.object3d.children.filter(o => o.name.startsWith('GrowBed_'));
    expect(beds.length).toBe(6);
    const levels = [...new Set(beds.map(b => b.position.y.toFixed(3)))].map(Number).sort((a, b) => a - b);
    expect(levels.length).toBe(2);
    expect(levels[1] - levels[0]).toBeGreaterThan(0.5);        // room for the plants under the upper tier
    for (const level of levels) {
      const row = beds.filter(b => Math.abs(b.position.y - level) < 1e-3);
      expect(row.length).toBe(3);
    }
    const lower = beds.filter(b => Math.abs(b.position.y - levels[0]) < 1e-3).map(b => b.position.z).sort();
    const upper = beds.filter(b => Math.abs(b.position.y - levels[1]) < 1e-3).map(b => b.position.z).sort();
    expect(upper).toEqual(lower);                              // stacked, not staggered

    // A grow light over each tier — glows, not light sources.
    const glows = [];
    rack.object3d.traverse(o => { if (o.isMesh && o.material.emissive?.getHex()) glows.push(o); });
    expect(glows.length).toBe(2);
    expect(new THREE.Box3().setFromObject(rack.object3d).max.y).toBeLessThan(1.9);

    // Front to back along the wall: beds, dispenser, bin — nothing touching.
    const d = footprint(room.root.find('VendingMachine'));
    const b = footprint(room.root.find('TrashBin'));
    expect(c.z1).toBeLessThan(d.z0);
    expect(d.z1).toBeLessThan(b.z0);
    expect(room.root.find('VendingMachine').object3d.position.z).toBeCloseTo(0.95);
  });

  it('makes the dispenser usable: it is the room\'s RationDispenser', () => {
    const use = room.root.find('VendingMachine').getComponent(Interactable);
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

  it('a faint green, unbreakable glow off the terminal screen — the sign it still works in the dark', () => {
    const glow = room.root.find('ScreenGlow');
    expect(glow.object3d.userData.unbreakable).toBe(true);
    expect(room.screenGlow.color.getHex()).toBe(0x4dff7a);
    expect(room.screenGlow.intensity).toBeLessThan(2);
  });

  it('lighting matches the original office: warm ceiling light and cool desk glow', () => {
    const lights = pointLights(room);
    expect(lights.length).toBe(3);   // + the screen's glow
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

  it('has a drive reader on the desk surface with a DriveSlot component', () => {
    const reader = room.root.find('DriveReader');
    expect(reader).not.toBeNull();
    expect(reader.rigidBody.isFixed()).toBe(true);
    const slot = reader.getComponent(DriveSlot);
    expect(slot).not.toBeNull();
    expect(slot.snapDistance).toBeGreaterThan(0);
  });

  it('stocks one drive registry: the pre-seated box drives', () => {
    // 4 shelf boxes × 8 sockets each.
    expect(room.drives.length).toBe(32);

    // The seated drives are in the registry too — the scene's wiring
    // registers every drive with every snap receiver from it.
    const seated = room.driveBoxes.flatMap(box => box.receiver.attachedItems);
    expect(seated).toHaveLength(32);
    for (const drive of seated) {
      expect(drive, drive.name).toBeInstanceOf(Drive);
      expect(room.drives, drive.name).toContain(drive);
    }
  });

  it('stocks the shelf: four pre-filled drive boxes on the two lowest boards', () => {
    expect(room.driveBoxes).toHaveLength(4);

    // Each rests on its board (top + half box height); each pair sits
    // either side of the board centre along z, clear of the board edges.
    const onBoard = (box, top) => {
      const pos = box.object3d.position;
      expect(pos.x, box.name).toBeCloseTo(5.68);
      expect(pos.y, box.name).toBeCloseTo(top + 0.06);
      return pos.z;
    };
    const [a, b, c, d] = room.driveBoxes;
    expect(onBoard(a, 0.2236)).toBeCloseTo(-2.17);
    expect(onBoard(b, 0.2236)).toBeCloseTo(-1.83);
    expect(onBoard(c, 0.6458)).toBeCloseTo(-2.17);
    expect(onBoard(d, 0.6458)).toBeCloseTo(-1.83);

    // Every socket full: seated drives belong to their box, show the take
    // prompt and carry the detach-on-pickup hook even before _init.
    for (const box of room.driveBoxes) {
      const seated = box.receiver.attachedItems;
      expect(seated, box.name).toHaveLength(8);
      for (const drive of seated) {
        expect(drive._snapOwner, box.name).toBe(box.receiver);
        const pickupable = drive.getComponent(Pickupable);
        expect(pickupable.promptLabel).toBe('[E] Take drive');
        expect(pickupable.onBeforePickUp).toBeTypeOf('function');
        expect(drive.parent).toBe(room.root);
      }
    }
  });

  it('DriveSlot component is configured with a snap offset for the reader surface', () => {
    const reader = room.driveReader;
    const slot = reader.getComponent(DriveSlot);
    expect(slot).not.toBeNull();
    // The snap offset lifts the drive above the reader surface.
    expect(slot.snapOffset.y).toBeGreaterThan(0);
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

describe('MainOffice desk clock teardown', () => {
  it('dispose frees the desk clock with the rest of the room', () => {
    const room = new MainOffice(makeEngine());
    room.build();
    const dispose = vi.spyOn(room.deskClock, 'dispose');
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
  it('the window is glazed: a solid pane fills the whole opening', () => {
    const room = new MainOffice(makeEngine());
    room.build();
    const pane = room.root.find('BackWindow');
    expect(pane.rigidBody.isFixed()).toBe(true);
    const half = pane.collider.halfExtents();
    expect(half.x * 2).toBeCloseTo(8.5);
    expect(half.y * 2).toBeCloseTo(2.35);
    // Sill at 0.475 m, top at 2.825 m, in the back wall's plane.
    expect(pane.object3d.position.y).toBeCloseTo(1.65);
    expect(pane.object3d.position.z).toBeCloseTo(-5);
  });

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

describe('MainOffice window glass', () => {
  const build = () => {
    const room = new MainOffice(makeEngine());
    room.build();
    return room;
  };

  it('glazes the window: a smudged pane fills the opening, in the plane of the wall', () => {
    const room = build();
    const glass = room.windowGlass;
    expect(glass.parent).toBe(room.root);
    expect(glass.object3d.position.x).toBeCloseTo(0);
    expect(glass.object3d.position.y).toBeCloseTo(1.65);
    // Mid-wall: behind the frame and mullions from inside, set back in the
    // reveal from outside.
    expect(glass.object3d.position.z).toBeCloseTo(-5);
    const { width, height } = glass.mesh.geometry.parameters;
    expect(width).toBeCloseTo(8.5);
    expect(height).toBeCloseTo(2.35);
  });

  it('shows by the ceiling light, and goes dark when the power grid zeroes it', () => {
    const room = build();
    const light = room.windowGlass.mesh.material.uniforms.uLight.value;
    room.windowGlass.mesh.onBeforeRender();
    expect(light.length()).toBeGreaterThan(0.3);
    room.root.find('CeilingLight').object3d.children.find(c => c.isLight).intensity = 0;
    room.windowGlass.mesh.onBeforeRender();
    expect(light.length()).toBe(0);
  });

  it('dispose frees the glass with the rest of the room', () => {
    const room = build();
    const dispose = vi.spyOn(room.windowGlass, 'dispose');
    room.dispose();
    expect(dispose).toHaveBeenCalled();
  });
});
