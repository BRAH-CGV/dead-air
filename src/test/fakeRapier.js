import { vi } from 'vitest';
import { GameObject } from '../core/GameObject.js';
import { onCleanup } from './cleanup.js';

// ─────────────────────────────────────────────
// Test helpers: a recording Rapier fake and an engine stub
// ─────────────────────────────────────────────
// The real Rapier WASM build doesn't load under vitest in this repo
// (pre-existing, see AGENTS.md), and a catch-all Proxy mock can't tell a
// test whether a collider matches the geometry it belongs to. This fake
// keeps each desc's body type, pose, half-extents and sensor flag.
//
// Not a test file (no .test.js), so vitest doesn't collect it, and nothing
// in the app imports it, so it never reaches the production build.
//
// Usage:
//   vi.mock('@dimforge/rapier3d', async () =>
//     (await import('../../test/fakeRapier.js')).rapierModule());
//   import { makeEngine } from '../../test/fakeRapier.js';
//
// An engine made in a test is emptied once the test is over, so whatever a
// mock still holds of it keeps nothing; one made in a beforeAll lasts to the
// end of the file (see cleanup.js).
// ─────────────────────────────────────────────

function bodyDesc(type) {
  const d = {
    type, t: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 },
    linearDamping: 0, angularDamping: 0, gravityScale: 1, ccd: false,
    setTranslation(x, y, z) { d.t = { x, y, z }; return d; },
    setRotation(q) { d.q = { ...q }; return d; },
    setLinearDamping(v) { d.linearDamping = v; return d; },
    setAngularDamping(v) { d.angularDamping = v; return d; },
    setGravityScale(v) { d.gravityScale = v; return d; },
    setCcdEnabled(v) { d.ccd = v; return d; },
  };
  return d;
}

/** Module shape for `vi.mock('@dimforge/rapier3d', …)`. */
export function rapierModule() {
  return {
    default: {
      RigidBodyDesc: {
        fixed: () => bodyDesc('fixed'),
        dynamic: () => bodyDesc('dynamic'),
        kinematicPositionBased: () => bodyDesc('kinematic'),
      },
      ColliderDesc: {
        cuboid: (x, y, z) => {
          const d = {
            half: { x, y, z }, t: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 }, sensor: false,
            setSensor(s) { d.sensor = s; return d; },
            setFriction(v) { d.friction = v; return d; },
            setRestitution(v) { d.restitution = v; return d; },
            setDensity(v) { d.density = v; return d; },
            setCollisionGroups(v) { d.groups = v; return d; },
            // Real Rapier supports positioning a collider independently of
            // its body — a fixed body carrying several colliders at their
            // own offsets, the pattern the rock field and the fence both use.
            setTranslation(tx, ty, tz) { d.t = { x: tx, y: ty, z: tz }; return d; },
            setRotation(q) { d.q = { ...q }; return d; },
          };
          return d;
        },
        // BunkerShell's slopes. Records the points; real Rapier returns null
        // for a set it can't hull, which this never does.
        convexHull: (points) => {
          const d = {
            points, sensor: false,
            setSensor(v) { d.sensor = v; return d; },
            setFriction(v) { d.friction = v; return d; },
          };
          return d;
        },
        // MarsTerrain's ground. Records its shape so tests can check the grid
        // and the footprint without a real physics world; the heights array is
        // kept by reference rather than copied, since it is 257 x 257 floats.
        heightfield: (nrows, ncols, heights, scale) => {
          const d = {
            heightfield: { nrows, ncols, heights, scale },
            sensor: false,
            setSensor(v) { d.sensor = v; return d; },
          };
          return d;
        },
        // A solid no box fits (the office's desk wings). Keeps its points, so
        // a test can rebuild the hull it describes.
        convexHull: points => {
          const d = { points, sensor: false, setSensor(v) { d.sensor = v; return d; } };
          return d;
        },
      },
    },
  };
}

let nextHandle = 1;

export class FakeWorld {
  _bodies = new Set();
  bodies = { len: () => this._bodies.size };

  createRigidBody(desc) {
    const body = {
      handle: nextHandle++,
      isFixed: () => desc.type === 'fixed',
      translation: () => ({ ...desc.t }),
      rotation: () => ({ ...desc.q }),
      bodyType: () => desc.type,
      setTranslation: (t) => { desc.t = { ...t }; },
      setRotation: (q) => { desc.q = { ...q }; },
      // Plain functions, not vi.fn: a body per prop made seven mocks each,
      // and Vitest keeps every mock until the file ends.
      setGravityScale: () => {},
      setLinearDamping: () => {},
      setAngularDamping: () => {},
      setLinvel: () => {},
      setAngvel: () => {},
      resetForces: () => {},
      addForce: () => {},
      mass: () => 1,
      linvel: () => ({ x: 0, y: 0, z: 0 }),
    };
    this._bodies.add(body);
    return body;
  }

  createCollider(desc) {
    let sensor = desc.sensor;
    return {
      // Only meaningful for cuboids; a heightfield collider reports its shape
      // through `heightfield` instead, the way the real API splits them.
      halfExtents: () => ({ ...desc.half }),
      translation: () => ({ ...desc.t }),
      rotation: () => ({ ...desc.q }),
      heightfield: desc.heightfield,
      points: desc.points,
      isSensor: () => sensor,
      setSensor: s => { sensor = s; },
    };
  }

  removeRigidBody(body) { this._bodies.delete(body); }
}

/** Engine stand-in. `spawnModel` mimics the real one where rooms depend on
 *  it: the body goes where `position` says (world space), unless physics is
 *  'none', and the GameObject is registered as a root object. */
export function makeEngine() {
  const engine = {
    world: new FakeWorld(),
    scene: null,
    _rootObjects: [],
    _bodyToGO: new Map(),
    rigidBodyMap: new Map(),
    spawnModel: vi.fn((key, opts = {}) => {
      const go = new (opts.type ?? GameObject)(opts.name ?? key);
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
  onCleanup(() => releaseEngine(engine));
  return engine;
}

/** Empties an engine: its scene, its world and what it spawned go with it,
 *  however long a mock that closes over it is kept. */
function releaseEngine(engine) {
  for (const key of Object.keys(engine)) delete engine[key];
}

/** Every PointLight under a room. */
export function pointLights(room) {
  const lights = [];
  room.root.object3d.traverse(o => { if (o.isPointLight) lights.push(o); });
  return lights;
}
