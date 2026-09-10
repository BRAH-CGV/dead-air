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
