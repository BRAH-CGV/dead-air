/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { LevelEditor } from './LevelEditor.js';

describe('LevelEditor', () => {
  let editor;
  let mockEngine;
  let mockScene;
  let mockCamera;
  let mockRenderer;

  beforeEach(() => {
    // Mock document.exitPointerLock for jsdom
    document.exitPointerLock = vi.fn();
    
    // Mock Three.js objects
    mockScene = {
      add: vi.fn(),
      remove: vi.fn(),
    };

    mockCamera = new THREE.PerspectiveCamera();
    
    mockRenderer = {
      domElement: document.createElement('canvas'),
    };

    // Mock engine
    mockEngine = {
      scene: mockScene,
      camera: mockCamera,
      renderer: mockRenderer,
      input: { locked: false },
      _rootObjects: [],
      world: {
        removeRigidBody: vi.fn(),
      },
      rigidBodyMap: new Map(),
      _bodyToGO: new Map(),
      rebuildModelPhysicsForScale: vi.fn(() => true),
    };
    
    editor = new LevelEditor(mockEngine);
  });

  describe('initialization', () => {
    it('creates editor with correct initial state', () => {
      expect(editor.enabled).toBe(false);
      expect(editor.selectedObject).toBe(null);
      expect(editor.editableObjects).toEqual([]);
    });

    it('initializes UI panel', () => {
      editor.init();
      
      expect(editor.panel).toBeDefined();
    });
  });

  describe('toggle', () => {
    beforeEach(() => {
      editor.init();
    });

    it('toggles enabled state', () => {
      expect(editor.enabled).toBe(false);
      editor.toggle();
      expect(editor.enabled).toBe(true);
      editor.toggle();
      expect(editor.enabled).toBe(false);
    });

    it('enables editor when toggled on', () => {
      editor.toggle();
      expect(editor.panel.style.display).toBe('block');
    });

    it('disables editor when toggled off', () => {
      editor.toggle();
      editor.toggle();
      expect(editor.panel.style.display).toBe('none');
    });
  });

  describe('object selection', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
    });

    it('filters out player from editable objects', () => {
      const playerGO = { name: 'Player', object3d: new THREE.Object3D() };
      const propGO = { name: 'Desk', object3d: new THREE.Object3D() };
      mockEngine._rootObjects = [playerGO, propGO];

      editor._refreshEditableObjects();

      expect(editor.editableObjects).not.toContain(playerGO);
      expect(editor.editableObjects).toContain(propGO);
    });

    it('selects object', () => {
      const go = { name: 'Desk', object3d: new THREE.Object3D() };
      mockEngine._rootObjects = [go];
      editor._refreshEditableObjects();

      editor.selectObject(go);

      expect(editor.selectedObject).toBe(go);
    });

    it('deselects object', () => {
      const go = { name: 'Desk', object3d: new THREE.Object3D() };
      mockEngine._rootObjects = [go];
      editor._refreshEditableObjects();

      editor.selectObject(go);
      editor.deselectAll();

      expect(editor.selectedObject).toBe(null);
    });
  });

  describe('transform modes', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
    });

    it('switches to translate mode with G key', () => {
      const event = new KeyboardEvent('keydown', { code: 'KeyG' });
      dispatchEvent(event);
      
      expect(editor.mode).toBe('translate');
    });

    it('switches to rotate mode with R key', () => {
      const event = new KeyboardEvent('keydown', { code: 'KeyR' });
      dispatchEvent(event);
      
      expect(editor.mode).toBe('rotate');
    });

    it('switches to scale mode with T key', () => {
      const event = new KeyboardEvent('keydown', { code: 'KeyT' });
      dispatchEvent(event);
      
      expect(editor.mode).toBe('scale');
    });

    it('moves object with arrow keys in translate mode', () => {
      const go = { name: 'Desk', object3d: new THREE.Object3D() };
      mockEngine._rootObjects = [go];
      editor._refreshEditableObjects();
      editor.selectObject(go);
      editor.mode = 'translate';
      
      const initialX = go.object3d.position.x;
      const event = new KeyboardEvent('keydown', { code: 'ArrowRight' });
      dispatchEvent(event);
      
      expect(go.object3d.position.x).toBe(initialX + editor.stepSize);
    });

    it('rotates object with arrow keys in rotate mode', () => {
      const go = { name: 'Desk', object3d: new THREE.Object3D() };
      mockEngine._rootObjects = [go];
      editor._refreshEditableObjects();
      editor.selectObject(go);
      editor.mode = 'rotate';
        
      const initialY = go.object3d.rotation.y;
      const event = new KeyboardEvent('keydown', { code: 'ArrowRight' });
      dispatchEvent(event);
        
      expect(go.object3d.rotation.y).toBe(initialY + editor.rotationStep);
    });
  });
  
  describe('physics sync', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
    });
  
    it('syncs position and rotation to the selected rigid body', () => {
      const rb = {
        setTranslation: vi.fn(),
        setRotation: vi.fn(),
      };
      const go = { name: 'Desk', object3d: new THREE.Object3D(), rigidBody: rb };
      go.object3d.position.set(1, 2, 3);
      go.object3d.rotation.y = Math.PI / 2;
      editor.selectObject(go);
  
      editor._syncTransformToPhysics();
  
      expect(rb.setTranslation).toHaveBeenCalledWith({ x: 1, y: 2, z: 3 }, true);
      expect(rb.setRotation).toHaveBeenCalled();
    });
  
    it('asks the engine to rebuild model physics when visual scale changes', () => {
      const rb = {
        setTranslation: vi.fn(),
        setRotation: vi.fn(),
      };
      const go = {
        name: 'model:desk',
        object3d: new THREE.Object3D(),
        rigidBody: rb,
        physicsAssetKey: 'model:desk',
        _physicsScale: [1, 1, 1],
      };
      go.object3d.scale.setScalar(1.5);
      editor.selectObject(go);
  
      editor._syncTransformToPhysics();
  
      expect(mockEngine.rebuildModelPhysicsForScale).toHaveBeenCalledWith(go);
    });
  
    it('does not rebuild model physics when scale is unchanged', () => {
      const rb = {
        setTranslation: vi.fn(),
        setRotation: vi.fn(),
      };
      const go = {
        name: 'model:desk',
        object3d: new THREE.Object3D(),
        rigidBody: rb,
        physicsAssetKey: 'model:desk',
        _physicsScale: [1, 1, 1],
      };
      editor.selectObject(go);
  
      editor._syncTransformToPhysics();
  
      expect(mockEngine.rebuildModelPhysicsForScale).not.toHaveBeenCalled();
    });
  });
  
  describe('export', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
      
      // Add test objects
      const obj1 = new THREE.Object3D();
      obj1.position.set(1, 2, 3);
      obj1.rotation.set(0, Math.PI / 2, 0);
      obj1.scale.setScalar(2);
      
      const obj2 = new THREE.Object3D();
      obj2.position.set(-1, 0, 5);
      
      mockEngine._rootObjects = [
        { name: 'model:desk', object3d: obj1 },
        { name: 'model:chair', object3d: obj2 },
      ];
      editor._refreshEditableObjects();
    });

    it('exports JSON layout with correct structure', () => {
      const createObjectURL = vi.fn(() => 'blob:test');
      const revokeObjectURL = vi.fn();
      global.URL.createObjectURL = createObjectURL;
      global.URL.revokeObjectURL = revokeObjectURL;
      
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');
      
      editor._exportJSON();
      
      expect(createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      
      clickSpy.mockRestore();
    });

    it('exports JavaScript code with spawnModel calls', () => {
      const createObjectURL = vi.fn(() => 'blob:test');
      const revokeObjectURL = vi.fn();
      global.URL.createObjectURL = createObjectURL;
      global.URL.revokeObjectURL = revokeObjectURL;
      
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');
      
      editor._exportCode();
      
      expect(createObjectURL).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      
      clickSpy.mockRestore();
    });
  });

  describe('dispose', () => {
    it('cleans up resources', () => {
      editor.init();
      
      const removeSpy = vi.spyOn(editor.panel, 'remove');
      
      editor.dispose();
      
      expect(removeSpy).toHaveBeenCalled();
    });
  });
});
