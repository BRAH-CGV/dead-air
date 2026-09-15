import { vi } from 'vitest';
import { GameObject } from '../core/GameObject.js';

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
// ─────────────────────────────────────────────

function bodyDesc(type) {
  const d = {
    type, t: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 },
    setTranslation(x, y, z) { d.t = { x, y, z }; return d; },
    setRotation(q) { d.q = { ...q }; return d; },
  };
  return d;
}

/** Module shape for `vi.mock('@dimforge/rapier3d', …)`. */
export function rapierModule() {
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
    };
    this._bodies.add(body);
    return body;
  }

  createCollider(desc) {
    let sensor = desc.sensor;
    return {
      halfExtents: () => ({ ...desc.half }),
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

/** Every PointLight under a room. */
export function pointLights(room) {
  const lights = [];
  room.root.object3d.traverse(o => { if (o.isPointLight) lights.push(o); });
  return lights;
}
