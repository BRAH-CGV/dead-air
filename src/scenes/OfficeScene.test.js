import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

// Mock RAPIER to avoid WASM load in test environment
vi.mock('@dimforge/rapier3d', () => {
  const chain = () => new Proxy({}, { get: () => chain });
  return {
    default: {
      RigidBodyDesc: { fixed: () => ({ setTranslation: chain }), dynamic: () => ({ setTranslation: chain, setLinvel: chain }) },
      ColliderDesc: {
        cuboid: () => ({ setTranslation: chain }),
        heightfield: () => ({ setTranslation: chain }),
      },
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

  it('ground exposes its rigid body and collider for scene teardown', () => {
    scene.build();

    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    const outside = sceneRoot.children.find(go => go.name === 'Outside');
    const ground = outside.descendants().find(go => go.name === 'MarsTerrain');

    // An orphan ground body would survive loadScene() and stack a ghost
    // floor collider on every scene reload.
    expect(ground.rigidBody).toBeDefined();
    expect(ground.colliders.length).toBeGreaterThan(0);
    expect(ground._originalSize).toEqual([1024, 1, 1024]);
  });

  it('static boxes expose their rigid body and collider for editor sync', () => {
    scene.build();

    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    const office = sceneRoot.children.find(go => go.name === 'Office');
    const walls = office.descendants().filter(go => go.name.includes('Wall'));

    expect(walls.length).toBeGreaterThan(0);
    for (const wall of walls) {
      // Without go.rigidBody the editor's _syncSingleTransformToPhysics
      // early-returns and scale/rotate never reach the collider.
      expect(wall.rigidBody).toBeDefined();
      expect(wall.collider).toBeDefined();
      expect(wall.colliders.length).toBeGreaterThan(0);
    }
  });

  it('static boxes are centred on their own pivot (mesh at local origin)', () => {
    scene.build();

    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    const office = sceneRoot.children.find(go => go.name === 'Office');
    const walls = office.descendants().filter(go => go.name.includes('Wall'));

    for (const wall of walls) {
      const mesh = wall.object3d.children.find(c => c.isMesh);
      expect(mesh).toBeDefined();
      // Mesh centred on the GameObject so scale/rotate pivot on the box centre
      expect(mesh.position.x).toBe(0);
      expect(mesh.position.y).toBe(0);
      expect(mesh.position.z).toBe(0);
      // Position lives on the GameObject itself
      expect(wall.object3d.position.lengthSq()).toBeGreaterThan(0);
    }
  });

  it('static boxes record _originalSize for procedural collider rebuilds', () => {
    scene.build();

    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    const office = sceneRoot.children.find(go => go.name === 'Office');
    const walls = office.descendants().filter(go => go.name.includes('Wall'));

    for (const wall of walls) {
      expect(Array.isArray(wall._originalSize)).toBe(true);
      expect(wall._originalSize.length).toBe(3);
    }
  });
});

describe('OfficeScene ground', () => {
  let scene;
  let mockEngine;

  beforeEach(() => {
    mockEngine = {
      scene: new THREE.Scene(),
      world: {
        createRigidBody: vi.fn(() => ({ handle: Math.random() })),
        createCollider: vi.fn(() => ({ handle: Math.random() })),
      },
      assets: { get: vi.fn(() => null) },
      spawnModel: vi.fn((key, opts) => new GameObject(opts.name || key)),
      buildPlayer: vi.fn(),
      _rootObjects: [],
      rigidBodyMap: new Map(),
      _bodyToGO: new Map(),
    };
    mockEngine.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);
    scene = new OfficeScene(mockEngine);
  });

  function outside() {
    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    return sceneRoot.children.find(go => go.name === 'Outside');
  }

  it('stands the office on the Mars valley rather than a flat pad', () => {
    scene.build();
    expect(outside().children.find(go => go.name === 'MarsTerrain')).toBeDefined();
  });

  it('keeps a textured floor inside the office', () => {
    scene.build();
    const sceneRoot = mockEngine._rootObjects.find(go => go.name === 'SceneRoot');
    const office = sceneRoot.children.find(go => go.name === 'Office');
    const floor = office.children.find(go => go.name === 'OfficeFloor');
    expect(floor).toBeDefined();
    // Just above the terrain's flat pad — co-planar would z-fight.
    expect(floor.object3d.position.y).toBeGreaterThan(0);
    expect(floor.object3d.position.y).toBeLessThan(0.05);
  });

  it('thins the fog so the valley rim is visible at all', () => {
    // The engine default is opaque by ~150 m; the rim is at 350-500 m.
    const before = mockEngine.scene.fog.density;
    scene.build();
    expect(mockEngine.scene.fog.density).toBeLessThan(before);
    // Still enough aerial perspective to separate the far hills.
    expect(mockEngine.scene.fog.density).toBeGreaterThan(0);
  });

  it('hands the fog back on dispose, so the next scene starts clean', () => {
    const before = mockEngine.scene.fog.density;
    scene.build();
    scene.dispose();
    expect(mockEngine.scene.fog.density).toBe(before);
  });

  it('leaves the fog colour alone — that belongs to the sky', () => {
    const before = mockEngine.scene.fog.color.getHex();
    scene.build();
    expect(mockEngine.scene.fog.color.getHex()).toBe(before);
  });
});
