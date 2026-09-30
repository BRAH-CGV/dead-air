import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

// Mock RAPIER to avoid WASM load in test environment
vi.mock('@dimforge/rapier3d', () => {
  const chain = () => new Proxy({}, { get: () => chain });
  return {
    default: {
      RigidBodyDesc: { fixed: () => ({ setTranslation: chain }), dynamic: () => ({ setTranslation: chain, setLinvel: chain }) },
      ColliderDesc: { cuboid: () => ({ setTranslation: chain }) },
    },
  };
});

import { TestScene } from './TestScene.js';
import { GameObject } from '../core/GameObject.js';

describe('TestScene hierarchy', () => {
  let scene;
  let mockEngine;

  beforeEach(() => {
    mockEngine = {
      scene: new THREE.Scene(),
      world: {
        createRigidBody: vi.fn(() => ({
          handle: Math.random(),
          bodyType: vi.fn(() => 'fixed'),
          setTranslation: vi.fn(),
          setRotation: vi.fn(),
        })),
        createCollider: vi.fn(() => ({ handle: Math.random() })),
      },
      assets: {
        get: vi.fn(() => null),
      },
      spawnModel: vi.fn((key, opts) => {
        const go = new GameObject(opts.name || key);
        go.object3d.position.set(...(opts.position || [0, 0, 0]));
        return go;
      }),
      buildPlayer: vi.fn(),
      _rootObjects: [],
      rigidBodyMap: new Map(),
      _bodyToGO: new Map(),
    };

    scene = new TestScene(mockEngine);
  });

  it('creates SceneRoot group', () => {
    scene.build();

    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    expect(sceneRoot).toBeDefined();
    expect(sceneRoot.isGroup).toBe(true);
  });

  it('creates Corridor group as child of SceneRoot', () => {
    scene.build();

    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    const corridor = sceneRoot.children.find(go => go.name === 'Corridor');
    expect(corridor).toBeDefined();
    expect(corridor.isGroup).toBe(true);
  });

  it('creates Outside group as child of SceneRoot', () => {
    scene.build();

    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    const outside = sceneRoot.children.find(go => go.name === 'Outside');
    expect(outside).toBeDefined();
  });

  it('creates Lighting group as child of SceneRoot', () => {
    scene.build();

    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    const lighting = sceneRoot.children.find(go => go.name === 'Lighting');
    expect(lighting).toBeDefined();
  });

  it('wall segments are children of Corridor group', () => {
    scene.build();

    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    const corridor = sceneRoot.children.find(go => go.name === 'Corridor');

    const wallDescendants = corridor.descendants();
    const walls = wallDescendants.filter(go => go.name.includes('Wall'));
    expect(walls.length).toBeGreaterThan(0);
  });

  it('calls buildPlayer', () => {
    scene.build();
    expect(mockEngine.buildPlayer).toHaveBeenCalled();
  });

  it('is distinct from OfficeScene (has Corridor, not Office)', () => {
    scene.build();

    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    const office = sceneRoot.children.find(go => go.name === 'Office');
    const corridor = sceneRoot.children.find(go => go.name === 'Corridor');

    expect(office).toBeUndefined();
    expect(corridor).toBeDefined();
  });
});

// ─────────────────────────────────────────────
// Bugs from docs/BUG-TRACKER.md. The editor's scene switcher ships in the
// production build, so this scene is still reachable there.
// ─────────────────────────────────────────────

/** An engine whose spawnModel registers the model as a root object, the way
 *  the real Engine.spawnModel does, and whose buildPlayer remembers where it
 *  put the player. Every static box's name, centre and size is recorded. */
function bugEngine(SceneClass) {
  const engine = {
    scene: new THREE.Scene(),
    world: {
      createRigidBody: vi.fn(() => ({ handle: Math.random(), bodyType: vi.fn(() => 'fixed'), setTranslation: vi.fn(), setRotation: vi.fn() })),
      createCollider: vi.fn(() => ({ handle: Math.random() })),
    },
    assets: { get: vi.fn(() => null) },
    _rootObjects: [],
    rigidBodyMap: new Map(),
    _bodyToGO: new Map(),
    spawnModel: vi.fn((key, opts = {}) => {
      const go = new GameObject(opts.name || key);
      go.object3d.position.set(...(opts.position || [0, 0, 0]));
      engine._rootObjects.push(go);
      return go;
    }),
    buildPlayer: vi.fn(({ position = [0, 1, 5] } = {}) => {
      engine.spawn = position;
      const player = new GameObject('Player');
      engine._rootObjects.push(player);
      return player;
    }),
  };
  engine.boxes = [];
  const add = SceneClass.prototype._addStaticBox;
  vi.spyOn(SceneClass.prototype, '_addStaticBox').mockImplementation(function (name, position, size, ...rest) {
    engine.boxes.push({ name, position, size });
    return add.call(this, name, position, size, ...rest);
  });
  return engine;
}

/** Does a standing player's capsule at `spawn` (its centre) overlap `box`? */
function overlaps(spawn, box, radius = 0.3, halfHeight = 0.675) {
  const reach = [radius, halfHeight, radius];
  return [0, 1, 2].every(axis =>
    Math.abs(spawn[axis] - box.position[axis]) < box.size[axis] / 2 + reach[axis]);
}

describe('TestScene bugs', () => {
  let engine;

  beforeEach(() => {
    vi.restoreAllMocks();
    engine = bugEngine(TestScene);
    new TestScene(engine).build();
  });

  // BUG-001, the same pattern as OfficeScene: spawned props parented under
  // the Corridor group were also left as root objects.
  it('updates each prop once: nothing it parents is still a root object', () => {
    const doubled = engine._rootObjects.filter(go => go.parent).map(go => go.name);
    expect(doubled).toEqual([]);
  });

  // BUG-002 asked to check this scene's layout: the corridor has no front
  // wall, so the default spawn is already clear.
  it('starts the player clear of every wall', () => {
    const inside = engine.boxes.filter(box => overlaps(engine.spawn, box)).map(box => box.name);
    expect(inside).toEqual([]);
  });
});
