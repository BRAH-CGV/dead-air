import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';

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
          const d = {
            half: { x, y, z }, t: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 }, sensor: false,
            setSensor(s) { d.sensor = s; return d; },
            setTranslation(x, y, z) { d.t = { x, y, z }; return d; },
            setRotation(q) { d.q = { ...q }; return d; },
          };
          return d;
        },
        convexHull: points => {
          const d = { points, sensor: false, setSensor(s) { d.sensor = s; return d; } };
          return d;
        },
      },
    },
  };
});

import { MainOffice, WINDOW_CORNER_RADIUS } from './MainOffice.js';
import { CoffeeMachine } from '../../components/CoffeeMachine.js';
import { CoffeeBushes } from '../../components/CoffeeBushes.js';
import { CoffeeProcessor } from '../../components/CoffeeProcessor.js';
import { GameObject } from '../../core/GameObject.js';
import { Interactable } from '../../components/Interactable.js';
import { Pickupable } from '../../components/Pickupable.js';
import { READER_SLOT } from '../../gameobjects/DriveReader.js';
import { DriveSlot } from '../../components/DriveSlot.js';
import { WallClock } from '../../gameobjects/WallClock.js';
import { DigitalClock } from '../../gameobjects/DigitalClock.js';
import { GlobeSpin } from '../../components/GlobeSpin.js';
import { deskWingOutline } from './DeskWing.js';
import { SignalAlertLight, BULB } from '../../gameobjects/SignalAlertLight.js';
import { Drive } from '../../gameobjects/Drive.js';
import { ASSETS, PRELOAD } from '../../assets/manifest.js';
import { readFileSync } from 'node:fs';

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
    return {
      halfExtents: () => ({ ...desc.half }), points: desc.points,
      // Where a collider sits on its body (real Rapier reports the world pose).
      translation: () => ({ ...desc.t }), rotation: () => ({ ...desc.q }),
      isSensor: () => sensor, setSensor: s => { sensor = s; },
    };
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
      go.object3d.scale.setScalar(opts.scale ?? 1);
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
const FURNITURE = ['ComputerDesk', 'DeskWing_Left', 'DeskWing_Right', 'GrowBeds', 'BeanProcessor', 'TrashBin', 'Shelf'];

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
    for (const gone of ['model:server-rack', 'model:switchboard', 'model:security-camera']) {
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

  // Things set down on a wing fell through the wedge between it and the
  // desk's side: the solid was a square turned 45° under the wing's top,
  // which left the wedge (A, B, E in DeskWing.js) hollow under its top.
  // Then one convex hull of the whole wing let drives sink through the left
  // one: Rapier made next to no contacts against it. So it is a box under
  // the square and a small hull for the wedge.
  it('the wings are solid under all of their top, the wedge beside the desk included', () => {
    for (const [label, side] of [['Left', -1], ['Right', 1]]) {
      const solid = room.root.find(`DeskWingSolid_${label}`);
      expect(solid.rigidBody.isFixed(), label).toBe(true);
      expect(solid.object3d.children.some(c => c.isMesh), label).toBe(false);   // the wing mesh is what is drawn
      expect(solid.colliders.length, label).toBe(2);
      const [box, filler] = solid.colliders;
      expect(box.points, `${label} square is a box, not a hull`).toBeUndefined();

      const { x, y, z } = solid.rigidBody.translation();
      const origin = new THREE.Vector3(x, y, z);

      const half = box.halfExtents(), at = box.translation(), q = box.rotation();
      const toBox = new THREE.Matrix4().compose(
        origin.clone().add(new THREE.Vector3(at.x, at.y, at.z)),
        new THREE.Quaternion(q.x, q.y, q.z, q.w),
        new THREE.Vector3(1, 1, 1),
      ).invert();
      const inBox = p => {
        const l = p.clone().applyMatrix4(toBox);
        return Math.abs(l.x) <= half.x + 1e-6 && Math.abs(l.y) <= half.y + 1e-6 && Math.abs(l.z) <= half.z + 1e-6;
      };
      expect(at.y + half.y, label).toBeCloseTo(0.864);              // level with the desk top: the globe stands on it
      expect(at.y - half.y, label).toBeCloseTo(0);

      const points = [];
      for (let i = 0; i < filler.points.length; i += 3) {
        const [px, py, pz] = filler.points.subarray(i, i + 3);
        points.push(new THREE.Vector3(px, py, pz).add(origin));
      }
      expect(points.length, label).toBe(8);                         // a prism on four corners
      const tops = points.map(p => p.y);
      expect(Math.max(...tops), label).toBeCloseTo(0.864);
      expect(Math.min(...tops), label).toBeCloseTo(0);
      const hull = new ConvexHull().setFromPoints(points);
      const solidAt = p => inBox(p) || hull.containsPoint(p);

      const [[ax, az], [bx, bz], , , [ex, ez]] = deskWingOutline(side, { halfW: 0.8, topHalfW: 0.752, front: -2.15, back: -2.95 }).body;
      const wedge = [(ax + bx + ex) / 3, (az + bz + ez) / 3];       // the middle of the wedge beside the desk
      for (const h of [0.1, 0.5, 0.85]) {
        expect(solidAt(new THREE.Vector3(wedge[0], h, wedge[1])), `${label} wedge at ${h}`).toBe(true);
        expect(solidAt(new THREE.Vector3(side * 1.401, h, -2.15)), `${label} centre at ${h}`).toBe(true);
      }
      expect(solidAt(new THREE.Vector3(wedge[0], 0.9, wedge[1])), `${label} above the top`).toBe(false);
      expect(solidAt(new THREE.Vector3(side * 1.401, 0.9, -2.15)), `${label} above the square`).toBe(false);
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

  it('draws the desk from inside too, dark, so the kneehole has a ceiling and walls from a crouch', () => {
    const withMesh = makeEngine();
    const deskMaterial = new THREE.MeshStandardMaterial({ name: 'Computer', map: new THREE.Texture(), side: THREE.FrontSide });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const spawn = withMesh.spawnModel.getMockImplementation();
    withMesh.spawnModel.mockImplementation((key, opts) => {
      const go = spawn(key, opts);
      if (key === 'model:retro-computer') go.object3d.add(new THREE.Mesh(geometry, deskMaterial));
      return go;
    });
    const office = new MainOffice(withMesh);
    office.build();
    const [shell] = office.root.find('ComputerDesk').object3d.children;
    const inside = shell.children.find(c => c.name === 'DeskInside');
    expect(inside.geometry).toBe(geometry);                    // the same shell
    expect(inside.material.side).toBe(THREE.BackSide);         // only where the front faces aren't
    expect(shell.material).toBe(deskMaterial);                 // the desk itself as it was
    // The geometry is the asset cache's; the lining's own material is the room's.
    let geometryFreed = false, liningFreed = false;
    geometry.addEventListener('dispose', () => { geometryFreed = true; });
    inside.material.addEventListener('dispose', () => { liningFreed = true; });
    office.dispose();
    expect(geometryFreed).toBe(false);
    expect(liningFreed).toBe(true);
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

  it('stands the security-camera monitor on the left wing, square to the wing, solid for the interact ray', () => {
    const monitor = room.root.find('CameraMonitor');
    expect(monitor).not.toBeNull();
    expect(room.cameraMonitor).toBe(monitor);

    // The real model (the bottom-left screen of wall-screen.glb), drawn only:
    // the collider below is what the interact ray lands on.
    const model = room.root.find('CameraMonitorModel');
    expect(model.physicsAssetKey).toBe('model:camera-monitor');
    expect(model.rigidBody).toBeFalsy();
    expect(model.object3d.position.toArray()).toEqual(
      [monitor.object3d.position.x, 0.864, monitor.object3d.position.z]);   // on the wing's top
    expect(model.object3d.rotation.y).toBeCloseTo(monitor.object3d.rotation.y);

    // On the left wing's top, well in from its edges.
    const { top, centre } = deskWingOutline(-1, { halfW: 0.8, topHalfW: 0.752, front: -2.15, back: -2.95 });
    const pos = monitor.object3d.position;
    expect(Math.hypot(pos.x - centre[0], pos.z - centre[1])).toBeLessThan(0.15);
    const half = monitor.collider.halfExtents();
    expect(pos.y - half.y).toBeCloseTo(0.864, 2);                    // standing on the top
    expect(half.x * 2).toBeGreaterThan(0.58);                         // a proper monitor, not a tablet
    const yaw = monitor.object3d.rotation.y;
    const xs = top.map(p => p[0]);
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const x = pos.x + Math.cos(yaw) * sx * half.x + Math.sin(yaw) * sz * half.z;
      expect(x).toBeLessThan(Math.max(...xs));
      expect(x).toBeGreaterThan(Math.min(...xs));
    }

    // Its screen faces straight out of the wing's front edge, square to the
    // wing (which is turned 45°): toward the front of the room and the seat.
    const facing = new THREE.Vector3(0, 0, 1).applyEuler(monitor.object3d.rotation);
    expect(facing.x).toBeCloseTo(Math.SQRT1_2);
    expect(facing.z).toBeCloseTo(Math.SQRT1_2);

    // Something for the interact ray to land on: its own fixed body.
    expect(monitor.rigidBody.isFixed()).toBe(true);
    expect(engine._bodyToGO.get(monitor.rigidBody.handle)).toBe(monitor);
    // No Interactable of its own: the scene attaches the CameraTerminal's.
    expect(monitor.getComponent(Interactable)).toBeNull();
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

  it('lines the left wall with the coffee corner: a two-tier rack of coffee bushes, then the bean processor and the bin', () => {
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
    rack.object3d.traverse(o => { if (o.isMesh && o.name.startsWith('GrowLight') && o.material.emissive?.getHex()) glows.push(o); });
    expect(glows.length).toBe(2);
    expect(new THREE.Box3().setFromObject(rack.object3d).max.y).toBeLessThan(1.9);

    // Front to back along the wall: beds, processor, bin — nothing touching.
    const d = footprint(room.root.find('BeanProcessor'));
    const b = footprint(room.root.find('TrashBin'));
    expect(c.z1).toBeLessThan(d.z0);
    expect(d.z1).toBeLessThan(b.z0);
    // The hopper on the processor's side, toward the bin, clear of it too.
    const hopper = new THREE.Box3().setFromObject(room.root.find('BeanProcessor').object3d.getObjectByName('Processor_hopper'));
    expect(hopper.max.z).toBeLessThan(b.z0 - 0.1);
    expect(room.root.find('BeanProcessor').object3d.position.z).toBeCloseTo(0.95);
  });

  it('keeps only a little trash in the bin, on its floor, inside its wall', () => {
    // trash-bin.glb: the bin (Trashbin) and its trash (Trash) in one frame,
    // z up, the bin 0 … 2 high, its inside wall 1.0 round its axis.
    const glb = readFileSync(new URL(`../../../public/${ASSETS['model:trash-bin'].url}`, import.meta.url));
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
    const bounds = name => {
      const prim = json.meshes.flatMap(m => m.primitives).find(p => json.materials[p.material].name === name);
      return json.accessors[prim.attributes.POSITION];
    };
    const bin = bounds('Trashbin'), trash = bounds('Trash');
    const height = bin.max[2] - bin.min[2];
    expect(trash.min[2]).toBeGreaterThan(bin.min[2]);                     // on the floor, not through it
    expect(trash.max[2]).toBeLessThan(bin.min[2] + height * 0.1);        // a bit at the bottom
    for (const v of [...trash.min.slice(0, 2), ...trash.max.slice(0, 2)]) expect(Math.abs(v)).toBeLessThan(1.0);

    // Lit, so the bin's own shade darkens it, and dull: an unlit layer
    // shone at full brightness at the bottom of a dark bin.
    const material = json.materials.find(m => m.name === 'Trash');
    expect(material.extensions?.KHR_materials_unlit).toBeUndefined();
    expect(json.extensionsUsed ?? []).not.toContain('KHR_materials_unlit');
    const [r, g, b] = material.pbrMetallicRoughness.baseColorFactor ?? [1, 1, 1];
    expect(Math.max(r, g, b)).toBeLessThanOrEqual(0.6);
    expect(material.pbrMetallicRoughness.roughnessFactor ?? 1).toBeGreaterThan(0.8);
  });

  it('the coffee starts here (#168): bushes to pick on the rack, the processor beside them; the machine is in the bedroom', () => {
    expect(room.coffeeBushes).toBeInstanceOf(CoffeeBushes);
    expect(room.root.find('GrowBeds').getComponent(Interactable)).toBe(room.coffeeBushes);
    expect(room.coffeeBushes.bushes.length).toBe(12);
    expect(room.beanProcessor).toBeInstanceOf(CoffeeProcessor);
    expect(room.root.find('BeanProcessor').getComponent(Interactable)).toBe(room.beanProcessor);
    expect(room.beanProcessor.promptLabel).toMatch(/bean processor/i);
    expect(() => room.beanProcessor.onInteract({})).not.toThrow();   // nothing wired, nothing to do
    expect(room.root.find('CoffeeMachine')).toBeNull();
    expect(room.root.descendants().some(go => go.getComponent(CoffeeMachine))).toBe(false);
  });

  it('builds the bean processor on its collider: hopper, process window, the bay and its chute, its plates', () => {
    const go = room.root.find('BeanProcessor');
    expect(go._originalSize).toEqual([0.7, 1.7, 0.9]);
    expect(go.colliders.length).toBeGreaterThan(1);                      // solid round the bay, not across it
    expect(engine._bodyToGO.get(go.rigidBody.handle)).toBe(go);
    for (const part of ['steel', 'hopper', 'window', 'chute', 'bayLight', 'pipes', 'labels', 'paddles']) {
      expect(go.object3d.getObjectByName(`Processor_${part}`), part).toBeDefined();
    }
    const pipes = new THREE.Box3().setFromObject(go.object3d.getObjectByName('Processor_pipes'));
    expect(pipes.max.y).toBeCloseTo(room.height, 2);                     // the conduit meets the ceiling

    const entry = ASSETS['tex:processor-labels'];
    expect(entry).toMatchObject({ type: 'texture', colorSpace: 'srgb' });
    expect(PRELOAD).toContain('tex:processor-labels');
    expect(() => readFileSync(new URL(`../../../public/${entry.url}`, import.meta.url))).not.toThrow();
    const atlas = new THREE.Texture();
    engine.assets = { get: key => (key === 'tex:processor-labels' ? atlas : null) };
    const dressed = new MainOffice(engine);
    dressed.build();
    expect(dressed.root.find('BeanProcessor').object3d.getObjectByName('Processor_labels').material.map).toBe(atlas);
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

  it('marks the computer\'s screen: the monitor\'s face, tilted back toward the seat (#161)', () => {
    const [tl, tr, br, bl] = room.computerScreen.worldCorners();
    expect(tl.distanceTo(tr)).toBeCloseTo(0.351, 2);
    expect(tl.distanceTo(bl)).toBeCloseTo(0.196, 2);
    expect(br.distanceTo(bl)).toBeCloseTo(tl.distanceTo(tr), 5);
    // Over the desk's top, under the monitor's, in its back half.
    const centre = tl.clone().add(tr).add(br).add(bl).multiplyScalar(0.25);
    expect(centre.x).toBeCloseTo(0);
    expect(centre.y).toBeGreaterThan(0.86);
    expect(centre.y).toBeLessThan(1.0);
    expect(centre.z).toBeLessThan(-2.55);
    // It faces the seat, and up: the face slopes back.
    const normal = new THREE.Vector3().crossVectors(tr.clone().sub(tl), tl.clone().sub(bl)).normalize();
    expect(normal.z).toBeGreaterThan(0.7);
    expect(normal.y).toBeGreaterThan(0.3);
    // The right way round from the seat: its right is the seat's right.
    expect(tr.x).toBeGreaterThan(tl.x);
  });

  it('marks the camera monitor\'s screen: upright, turned with it to face the room (#161)', () => {
    const [tl, tr, , bl] = room.cameraScreen.worldCorners();
    expect(tl.distanceTo(tr)).toBeCloseTo(0.55, 2);
    expect(tl.distanceTo(bl)).toBeCloseTo(0.323, 2);
    expect(tl.y).toBeGreaterThan(bl.y);
    expect(tl.y - tr.y).toBeCloseTo(0);
    // On the left wing's monitor, facing out of its front edge (45° to the room).
    const model = room.root.find('CameraMonitorModel').object3d;
    expect(room.cameraScreen.object).toBe(model);
    const normal = new THREE.Vector3().crossVectors(tr.clone().sub(tl), tl.clone().sub(bl)).normalize();
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(model.quaternion);
    expect(normal.dot(front)).toBeCloseTo(1);
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

  it('stands the signal lamp on the desk\'s shelf beside the monitor, in sight of the chair', () => {
    const light = room.root.find('SignalAlertLight');
    expect(light).toBeInstanceOf(SignalAlertLight);
    expect(room.signalLight).toBe(light);            // the scene wires it to gameplay

    // On the flat shelf left of the monitor (x −0.42 … −0.30, z −2.93 …
    // −2.77 at 0.864 m, read off retro-computer.glb): the monitor's own top
    // slopes, and nothing stands up on a slope.
    const pos = light.object3d.position;
    expect(pos.y).toBeCloseTo(0.864, 3);
    expect(pos.x - BULB.socket.plate).toBeGreaterThan(-0.42 - 0.03);
    expect(pos.x + BULB.socket.plate).toBeLessThan(-0.255);          // clear of the monitor's side
    expect(pos.z - BULB.socket.plate).toBeGreaterThan(-2.93);
    expect(pos.z + BULB.socket.plate).toBeLessThan(-2.77);
  });

  it('dresses the lamp in the bulb model when it is loaded', () => {
    const instance = new THREE.Group();
    instance.add(new THREE.Mesh(new THREE.SphereGeometry(0.03), new THREE.MeshStandardMaterial({ name: 'lightbulb_01_glass' })));
    engine.assets = { get: () => null, instantiate: key => (key === 'model:bulb' ? instance : null) };
    const dressed = new MainOffice(engine);
    dressed.build();
    expect(dressed.signalLight.bulb.parent).toBe(instance);
    expect(instance.parent).toBe(dressed.signalLight.object3d);
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

  it("knows a point on the desk top or a wing from one on the floor or the shelf (the tutorial's box on the desk)", () => {
    const at = (x, y, z) => room.root.object3d.localToWorld(new THREE.Vector3(x, y, z));
    expect(room.isOnDesk(at(0, 0.93, -2.6))).toBe(true);       // the desk top
    expect(room.isOnDesk(at(0.3, 0.81, -2.3))).toBe(true);     // the keyboard tray
    expect(room.isOnDesk(at(1.4, 0.93, -2.15))).toBe(true);    // the right wing
    expect(room.isOnDesk(at(-1.4, 0.93, -2.15))).toBe(true);   // the left wing
    expect(room.isOnDesk(at(0, 0.06, -2.6))).toBe(false);      // under it, on the floor
    expect(room.isOnDesk(at(0, 0.93, -1.2))).toBe(false);      // in front of it
    expect(room.isOnDesk(at(5.68, 0.71, -2.17))).toBe(false);  // the shelf
    for (const box of room.driveBoxes) {
      expect(room.isOnDesk(box.object3d.getWorldPosition(new THREE.Vector3())), box.name).toBe(false);
    }
  });

  it("marks the bare middle of the right wing's top, where the tutorial asks for the drive box", () => {
    const spot = room.boxSpot;
    expect(spot).toBeInstanceOf(THREE.Object3D);
    expect(spot.parent).toBe(room.root.object3d);
    const { position: p } = spot;
    expect(p.y).toBeCloseTo(0.864);                        // on the top
    // A drive box (0.32 × 0.28 m: half its diagonal is 0.21 m) wholly on it…
    expect(onRightWing(p, 0.21)).toBe(true);
    expect(room.isOnDesk(room.root.object3d.localToWorld(p.clone().setY(0.93)))).toBe(true);
    // …and clear of the globe's base (r 0.124) and the clock.
    for (const name of ['Globe', 'DeskClock']) {
      const o = room.root.find(name).object3d.position;
      expect(Math.hypot(o.x - p.x, o.z - p.z), name).toBeGreaterThan(0.21 + 0.143);
    }
  });

  it('DriveSlot seats a drive half into the reader\'s front slot, pins first', () => {
    const reader = room.driveReader;
    const slot = reader.getComponent(DriveSlot);
    expect(slot).not.toBeNull();
    expect(slot.slots[0].offset).toMatchObject(READER_SLOT.offset);
    // Turned half round: the drive's pins (+z) lead into the reader (−z).
    const pins = new THREE.Vector3(0, 0, 1).applyQuaternion(slot.slots[0].rotation);
    expect(pins.z).toBeCloseTo(-1);
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

  it('dispose frees the drives it stocks the boxes with', () => {
    // Each drive builds its own geometry and material. Left unowned, every
    // rebuild from the menu kept 32 of each on the GPU.
    const room = new MainOffice(makeEngine());
    room.build();
    expect(room.drives.length).toBeGreaterThan(0);
    const freed = new Set();
    for (const drive of room.drives) {
      drive.object3d.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.addEventListener('dispose', () => freed.add(o.geometry));
        o.material.addEventListener('dispose', () => freed.add(o.material));
      });
    }
    const meshes = room.drives.flatMap(d => d.object3d.children.filter(o => o.isMesh));
    expect(meshes.length).toBeGreaterThan(0);
    room.dispose();
    for (const mesh of meshes) {
      expect(freed.has(mesh.geometry)).toBe(true);
      expect(freed.has(mesh.material)).toBe(true);
    }
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

  it('rounds the window\'s corners inside: a curved steel fillet in each, through the wall', () => {
    const room = new MainOffice(makeEngine());
    room.build();
    const fillets = room.root.object3d.getObjectByName('WindowFillets');
    expect(fillets).toBeDefined();
    const { width, height, sill } = room.openings.find(o => o.side === 'back');
    fillets.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(fillets);
    // Within the opening, reaching into each corner.
    expect(box.min.x).toBeCloseTo(-width / 2, 3);
    expect(box.max.x).toBeCloseTo(width / 2, 3);
    expect(box.min.y).toBeCloseTo(sill, 3);
    expect(box.max.y).toBeCloseTo(sill + height, 3);
    // As deep as the wall.
    expect(box.max.z - box.min.z).toBeCloseTo(room.wallThick, 3);
    // But the middle of each side of the opening is clear.
    const ray = new THREE.Raycaster(new THREE.Vector3(0, sill + 0.02, 0), new THREE.Vector3(0, 0, -1));
    expect(ray.intersectObject(fillets, true)).toHaveLength(0);
    expect(WINDOW_CORNER_RADIUS).toBeGreaterThan(0.2);
  });

  it('bolts the window frame: a row of bolt heads round it, facing the room', () => {
    const room = new MainOffice(makeEngine());
    room.build();
    const bolts = room.root.object3d.getObjectByName('WindowBolts');
    expect(bolts?.isMesh).toBe(true);
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
