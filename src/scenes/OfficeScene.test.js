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

import { OfficeScene } from './OfficeScene.js';
import { GameObject } from '../core/GameObject.js';

describe('OfficeScene hierarchy', () => {
  let scene;
  let mockEngine;

  beforeEach(() => {
    // Mock engine with minimal required properties
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

    scene = new OfficeScene(mockEngine);
  });

  it('creates SceneRoot group', () => {
    scene.build();
    
    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    expect(sceneRoot).toBeDefined();
    expect(sceneRoot.isGroup).toBe(true);
  });

  it('creates Office group as child of SceneRoot', () => {
    scene.build();
    
    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    const office = sceneRoot.children.find(go => go.name === 'Office');
    expect(office).toBeDefined();
    expect(office.isGroup).toBe(true);
  });

  it('creates Outside group as child of SceneRoot', () => {
    scene.build();
    
    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    const outside = sceneRoot.children.find(go => go.name === 'Outside');
    expect(outside).toBeDefined();
    expect(outside.isGroup).toBe(true);
  });

  it('creates Lighting group as child of SceneRoot', () => {
    scene.build();
    
    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    const lighting = sceneRoot.children.find(go => go.name === 'Lighting');
    expect(lighting).toBeDefined();
    expect(lighting.isGroup).toBe(true);
  });

  it('all wall segments are children of Office group', () => {
    scene.build();
    
    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    const office = sceneRoot.children.find(go => go.name === 'Office');
    
    // Check that wall GameObjects exist under Office
    const wallDescendants = office.descendants();
    const walls = wallDescendants.filter(go => go.name.includes('Wall'));
    expect(walls.length).toBeGreaterThan(0);
  });

  it('all window parts are children of Office group', () => {
    scene.build();
    
    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    const office = sceneRoot.children.find(go => go.name === 'Office');
    
    const windowDescendants = office.descendants();
    const windowParts = windowDescendants.filter(go => go.name.includes('WindowFrame'));
    expect(windowParts.length).toBeGreaterThan(0);
  });

  it('dynamic crates remain at engine._rootObjects (not under SceneRoot)', () => {
    scene.build();
    
    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    const crateDescendants = sceneRoot.descendants();
    const cratesInHierarchy = crateDescendants.filter(go => go.name.includes('Crate'));
    
    // Crates should NOT be under SceneRoot
    expect(cratesInHierarchy.length).toBe(0);
  });

  it('player remains at engine._rootObjects', () => {
    scene.build();
    
    // buildPlayer is called, which adds Player to _rootObjects
    expect(mockEngine.buildPlayer).toHaveBeenCalled();
  });
});
