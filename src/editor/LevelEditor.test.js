/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { LevelEditor } from './LevelEditor.js';
import { GameObject } from '../core/GameObject.js';

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

  describe('hierarchy building', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
    });

    it('creates a sceneRoot group on _buildHierarchy()', () => {
      mockEngine._rootObjects = [];
      editor._buildHierarchy();

      expect(editor.sceneRoot).toBeDefined();
      expect(editor.sceneRoot.isGroup).toBe(true);
      expect(editor.sceneRoot.name).toBe('SceneRoot');
    });

    it('places static spawned models under sceneRoot', () => {
      const staticGO = new GameObject('Desk');
      staticGO.object3d.position.set(0, 0, 0);
      // No rigidBody = static/render-only

      mockEngine._rootObjects = [staticGO];
      editor._buildHierarchy();

      expect(editor.sceneRoot.children).toContain(staticGO);
      expect(staticGO.parent).toBe(editor.sceneRoot);
    });

    it('keeps dynamic-body objects out of sceneRoot (in dynamicObjects)', () => {
      const dynamicGO = new GameObject('Crate');
      dynamicGO.rigidBody = {
        handle: 42,
        bodyType: vi.fn(() => 'dynamic'),
      };
      // In the real engine, dynamic bodies are registered in rigidBodyMap
      mockEngine.rigidBodyMap.set(42, dynamicGO);

      mockEngine._rootObjects = [dynamicGO];
      editor._buildHierarchy();

      expect(editor.sceneRoot.children).not.toContain(dynamicGO);
      expect(editor.dynamicObjects).toContain(dynamicGO);
    });

    it('excludes Player from both sceneRoot and dynamicObjects', () => {
      const playerGO = new GameObject('Player');

      mockEngine._rootObjects = [playerGO];
      editor._buildHierarchy();

      expect(editor.sceneRoot.children).not.toContain(playerGO);
      expect(editor.dynamicObjects).not.toContain(playerGO);
    });

    it('places render-only objects (no rigidBody, not dynamic) under sceneRoot', () => {
      const renderOnly = new GameObject('VisibleMoon');
      // No rigidBody at all — purely decorative

      mockEngine._rootObjects = [renderOnly];
      editor._buildHierarchy();

      expect(editor.sceneRoot.children).toContain(renderOnly);
      expect(editor.dynamicObjects).not.toContain(renderOnly);
    });

    it('initializes dynamicObjects as empty array', () => {
      expect(editor.dynamicObjects).toBeDefined();
      expect(Array.isArray(editor.dynamicObjects)).toBe(true);
    });
  });

  describe('group selection and transform', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
    });

    it('selectObject() accepts a group (isGroup = true)', () => {
      const group = new GameObject('Office');
      group.makeGroup();

      editor.selectObject(group);

      expect(editor.selectedObject).toBe(group);
      expect(editor.selectedObject.isGroup).toBe(true);
    });

    it('translating a group moves all descendant object3d positions', () => {
      const group = new GameObject('Office');
      group.makeGroup();
      const child1 = new GameObject('Wall1');
      const child2 = new GameObject('Wall2');
      group.addChild(child1);
      group.addChild(child2);

      child1.object3d.position.set(1, 0, 0);
      child2.object3d.position.set(0, 0, 2);

      // Select the group and translate it
      editor.selectObject(group);
      editor.mode = 'translate';

      const event = new KeyboardEvent('keydown', { code: 'ArrowRight' });
      dispatchEvent(event);

      // Group moved, so children world positions should have shifted
      expect(group.object3d.position.x).toBe(editor.stepSize);
    });

    it('_syncTransformToPhysics() on a group updates all descendant rigid bodies', () => {
      const group = new GameObject('Office');
      group.makeGroup();

      const rb1 = { setTranslation: vi.fn(), setRotation: vi.fn() };
      const rb2 = { setTranslation: vi.fn(), setRotation: vi.fn() };

      const child1 = new GameObject('Wall1');
      child1.rigidBody = rb1;
      const child2 = new GameObject('Wall2');
      child2.rigidBody = rb2;

      group.addChild(child1);
      group.addChild(child2);

      editor.selectObject(group);
      editor._syncTransformToPhysics();

      expect(rb1.setTranslation).toHaveBeenCalled();
      expect(rb2.setTranslation).toHaveBeenCalled();
    });

    it('_syncTransformToPhysics() on a group skips children without rigidBody', () => {
      const group = new GameObject('Office');
      group.makeGroup();

      const rb1 = { setTranslation: vi.fn(), setRotation: vi.fn() };
      const child1 = new GameObject('Wall1');
      child1.rigidBody = rb1;
      const child2 = new GameObject('Decoration');
      // child2 has no rigidBody

      group.addChild(child1);
      group.addChild(child2);

      editor.selectObject(group);

      // Should not throw
      expect(() => editor._syncTransformToPhysics()).not.toThrow();
      expect(rb1.setTranslation).toHaveBeenCalled();
    });

    it('info panel shows group name and child count when group is selected', () => {
      const group = new GameObject('Office');
      group.makeGroup();
      const child1 = new GameObject('Wall1');
      const child2 = new GameObject('Wall2');
      group.addChild(child1);
      group.addChild(child2);

      editor.selectObject(group);

      // The info div should mention the group name
      expect(editor.infoDiv.textContent).toContain('Office');
    });
  });

  describe('reparenting', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
    });

    it('_reparentSelected() moves object under new parent group', () => {
      const group1 = new GameObject('Group1');
      group1.makeGroup();
      const group2 = new GameObject('Group2');
      group2.makeGroup();
      const obj = new GameObject('Object');

      group1.addChild(obj);
      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();
      editor.sceneRoot.addChild(group1);
      editor.sceneRoot.addChild(group2);

      editor.selectObject(obj);
      editor._reparentSelected(group2);

      expect(group2.children).toContain(obj);
      expect(group1.children).not.toContain(obj);
      expect(obj.parent).toBe(group2);
    });

    it('_reparentSelected() preserves world position', () => {
      const group1 = new GameObject('Group1');
      group1.makeGroup();
      const group2 = new GameObject('Group2');
      group2.makeGroup();
      const obj = new GameObject('Object');

      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();
      editor.sceneRoot.addChild(group1);
      editor.sceneRoot.addChild(group2);
      group1.addChild(obj);

      // group1 at (5, 0, 0), obj at local (3, 0, 0) → world (8, 0, 0)
      group1.object3d.position.set(5, 0, 0);
      obj.object3d.position.set(3, 0, 0);
      group1.object3d.updateMatrixWorld(true);

      const worldPosBefore = new THREE.Vector3();
      obj.object3d.getWorldPosition(worldPosBefore);

      editor.selectObject(obj);
      editor._reparentSelected(group2);

      group2.object3d.updateMatrixWorld(true);
      const worldPosAfter = new THREE.Vector3();
      obj.object3d.getWorldPosition(worldPosAfter);

      expect(worldPosAfter.x).toBeCloseTo(worldPosBefore.x, 5);
    });

    it('_reparentSelected() updates editableObjects tree', () => {
      const group1 = new GameObject('Group1');
      group1.makeGroup();
      const group2 = new GameObject('Group2');
      group2.makeGroup();
      const obj = new GameObject('Object');

      group1.addChild(obj);

      // Set up engine._rootObjects with the groups (not the obj, which is a child of group1)
      mockEngine._rootObjects = [group1, group2];
      editor._buildHierarchy();

      // Now obj should be in editableObjects (it's under group1 which is under sceneRoot)
      expect(editor.editableObjects).toContain(obj);

      editor.selectObject(obj);
      editor._reparentSelected(group2);

      // Object should still be in editableObjects after reparenting
      expect(editor.editableObjects).toContain(obj);
    });

    it('prevents reparenting a group under its own descendant (cycle guard)', () => {
      const group = new GameObject('Group');
      group.makeGroup();
      const child = new GameObject('Child');
      group.addChild(child);

      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();
      editor.sceneRoot.addChild(group);

      editor.selectObject(group);
      editor._reparentSelected(child);

      // Group should NOT have been reparented under its own child
      expect(group.parent).not.toBe(child);
      expect(group.parent).toBe(editor.sceneRoot);
    });

    it('prevents reparenting Player', () => {
      const player = new GameObject('Player');
      const group = new GameObject('Group');
      group.makeGroup();

      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();

      editor.selectObject(player);
      editor._reparentSelected(group);

      // Player should not have been reparented
      expect(player.parent).not.toBe(group);
    });
  });

  describe('tree view UI', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
    });

    it('_updateTreeView() renders group nodes with folder icon', () => {
      const group = new GameObject('Office');
      group.makeGroup();
      const child = new GameObject('Wall1');
      group.addChild(child);

      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();
      editor.sceneRoot.addChild(group);

      editor._updateTreeView();

      const items = editor.objectList.querySelectorAll('div');
      const groupItem = Array.from(items).find(el => el.textContent.includes('Office'));
      expect(groupItem).toBeDefined();
      expect(groupItem.textContent).toContain('\uD83D\uDCC1');
    });

    it('_updateTreeView() indents children deeper than parents', () => {
      const group = new GameObject('Office');
      group.makeGroup();
      const child = new GameObject('Wall1');
      group.addChild(child);

      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();
      editor.sceneRoot.addChild(group);

      editor._updateTreeView();

      const items = editor.objectList.querySelectorAll('div');
      const groupItem = Array.from(items).find(el => el.textContent.includes('Office'));
      const childItem = Array.from(items).find(el => el.textContent.includes('Wall1'));

      const groupIndent = parseInt(groupItem.style.paddingLeft || '0');
      const childIndent = parseInt(childItem.style.paddingLeft || '0');
      expect(childIndent).toBeGreaterThan(groupIndent);
    });

    it('_updateTreeView() highlights selected object or group', () => {
      const group = new GameObject('Office');
      group.makeGroup();

      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();
      editor.sceneRoot.addChild(group);

      editor.selectObject(group);
      editor._updateTreeView();

      const items = editor.objectList.querySelectorAll('div');
      const groupItem = Array.from(items).find(el => el.textContent.includes('Office'));
      expect(groupItem.style.background).toContain('rgb(34, 85, 170)');
    });

    it('clicking a group name selects the group', () => {
      const group = new GameObject('Office');
      group.makeGroup();

      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();
      editor.sceneRoot.addChild(group);

      editor._updateTreeView();

      const items = editor.objectList.querySelectorAll('div');
      const groupItem = Array.from(items).find(el => el.textContent.includes('Office'));
      groupItem.click();

      expect(editor.selectedObject).toBe(group);
    });

    it('clicking a child name selects the child', () => {
      const group = new GameObject('Office');
      group.makeGroup();
      const child = new GameObject('Wall1');
      group.addChild(child);

      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();
      editor.sceneRoot.addChild(group);

      editor._updateTreeView();

      const items = editor.objectList.querySelectorAll('div');
      const childItem = Array.from(items).find(el => el.textContent.includes('Wall1'));
      childItem.click();

      expect(editor.selectedObject).toBe(child);
    });

    it('shows "Parent:" dropdown in info panel when object is selected', () => {
      const group = new GameObject('Office');
      group.makeGroup();
      const child = new GameObject('Wall1');
      group.addChild(child);

      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();
      editor.sceneRoot.addChild(group);

      editor.selectObject(child);

      const select = editor.infoDiv.querySelector('select');
      expect(select).toBeDefined();
    });

    it('dropdown contains all available groups as options', () => {
      const group1 = new GameObject('Group1');
      group1.makeGroup();
      const group2 = new GameObject('Group2');
      group2.makeGroup();
      const child = new GameObject('Wall1');
      group1.addChild(child);

      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();
      editor.sceneRoot.addChild(group1);
      editor.sceneRoot.addChild(group2);

      editor.selectObject(child);

      const select = editor.infoDiv.querySelector('select');
      // Dropdown should exist (reparenting via dropdown is tested in reparenting describe block)
      expect(select).toBeDefined();
      expect(select.tagName.toLowerCase()).toBe('select');
    });
  });

  describe('group creation', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
    });

    it('_createGroup() creates a group with isGroup = true', () => {
      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();

      const group = editor._createGroup('TestGroup', editor.sceneRoot);

      expect(group.isGroup).toBe(true);
      expect(group.name).toBe('TestGroup');
    });

    it('_createGroup() adds the group as child of specified parent', () => {
      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();

      const group = editor._createGroup('TestGroup', editor.sceneRoot);

      expect(editor.sceneRoot.children).toContain(group);
      expect(group.parent).toBe(editor.sceneRoot);
    });

    it('_createGroup() with no parent adds to sceneRoot', () => {
      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();

      const group = editor._createGroup('TestGroup');

      expect(editor.sceneRoot.children).toContain(group);
    });
  });

  describe('sibling reordering', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
    });

    it('_moveSiblingUp() swaps object with previous sibling', () => {
      const parent = new GameObject('Parent');
      parent.makeGroup();
      const child1 = new GameObject('Child1');
      const child2 = new GameObject('Child2');
      const child3 = new GameObject('Child3');
      parent.addChild(child1);
      parent.addChild(child2);
      parent.addChild(child3);

      editor.selectObject(child2);
      editor._moveSiblingUp();

      expect(parent.children[0]).toBe(child2);
      expect(parent.children[1]).toBe(child1);
    });

    it('_moveSiblingDown() swaps object with next sibling', () => {
      const parent = new GameObject('Parent');
      parent.makeGroup();
      const child1 = new GameObject('Child1');
      const child2 = new GameObject('Child2');
      const child3 = new GameObject('Child3');
      parent.addChild(child1);
      parent.addChild(child2);
      parent.addChild(child3);

      editor.selectObject(child2);
      editor._moveSiblingDown();

      expect(parent.children[1]).toBe(child3);
      expect(parent.children[2]).toBe(child2);
    });

    it('_moveSiblingUp() at index 0 is a no-op', () => {
      const parent = new GameObject('Parent');
      parent.makeGroup();
      const child1 = new GameObject('Child1');
      const child2 = new GameObject('Child2');
      parent.addChild(child1);
      parent.addChild(child2);

      editor.selectObject(child1);
      editor._moveSiblingUp();

      expect(parent.children[0]).toBe(child1);
    });

    it('_moveSiblingDown() at last index is a no-op', () => {
      const parent = new GameObject('Parent');
      parent.makeGroup();
      const child1 = new GameObject('Child1');
      const child2 = new GameObject('Child2');
      parent.addChild(child1);
      parent.addChild(child2);

      editor.selectObject(child2);
      editor._moveSiblingDown();

      expect(parent.children[1]).toBe(child2);
    });
  });

  describe('hierarchy-aware export', () => {
    let sceneRoot, office, outside, desk, server, crate;

    beforeEach(() => {
      editor.init();
      editor.toggle();

      // Build a hierarchy:
      // SceneRoot
      //   ├── Office (group)
      //   │   ├── Desk (static)
      //   │   └── Server (static)
      //   └── Outside (group)
      //       └── (empty)
      // Crate_A (dynamic)
      sceneRoot = new GameObject('SceneRoot');
      sceneRoot.makeGroup();

      office = new GameObject('Office');
      office.makeGroup();
      sceneRoot.addChild(office);

      outside = new GameObject('Outside');
      outside.makeGroup();
      sceneRoot.addChild(outside);

      const deskObj = new THREE.Object3D();
      deskObj.position.set(1, 0, -2);
      desk = new GameObject('ComputerDesk');
      desk.object3d = deskObj;
      desk.physicsAssetKey = 'model:retro-computer';
      office.addChild(desk);

      const serverObj = new THREE.Object3D();
      serverObj.position.set(4, 0, -1);
      server = new GameObject('ServerRack');
      server.object3d = serverObj;
      server.physicsAssetKey = 'model:server-rack';
      office.addChild(server);

      const crateObj = new THREE.Object3D();
      crateObj.position.set(-2, 0.5, -7);
      crate = new GameObject('Crate_A');
      crate.object3d = crateObj;
      crate.physicsAssetKey = 'crate';

      // Set up editor state
      editor.sceneRoot = sceneRoot;
      editor.dynamicObjects = [crate];
      editor.editableObjects = [sceneRoot, desk, server, crate];

      mockEngine._rootObjects = [sceneRoot, crate];
    });

    it('_generateCode() emits group creation before spawn calls', () => {
      const code = editor._generateCode();
      expect(code).toContain("new GameObject('SceneRoot')");
      expect(code).toContain('makeGroup()');
      expect(code).toContain("new GameObject('Office')");
    });

    it('_generateCode() nests spawn calls inside their parent group', () => {
      const code = editor._generateCode();
      // Desk and Server should be added to Office group
      expect(code).toContain('Office');
      expect(code).toContain('ComputerDesk');
      expect(code).toContain('ServerRack');
      // Verify spawnModel calls reference the parent group
      const officeSection = code.indexOf("'Office'");
      const deskSection = code.indexOf('ComputerDesk');
      expect(deskSection).toBeGreaterThan(officeSection);
    });

    it('_generateCode() emits dynamic objects at root level', () => {
      const code = editor._generateCode();
      // Crate should appear outside the group hierarchy section
      expect(code).toContain('Crate_A');
    });

    it('_generateJSON() includes parent reference for each object', () => {
      const json = editor._generateJSON();
      const parsed = JSON.parse(json);
      // Should have hierarchy structure with parent info
      expect(parsed.root).toBeDefined();
      expect(parsed.root.name).toBe('SceneRoot');
      expect(parsed.dynamicObjects).toBeDefined();
    });

    it('_generateCode() returns a string', () => {
      const code = editor._generateCode();
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);
    });

    it('_generateJSON() returns valid JSON string', () => {
      const json = editor._generateJSON();
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('_exportCode() triggers a download', () => {
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

    it('_exportJSON() triggers a download', () => {
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
  });

  describe('scene file management', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
    });

    describe('scene tracking', () => {
      it('displays current scene name in the editor header', () => {
        expect(editor._sceneNameEl).not.toBeNull();
        expect(editor._sceneNameEl.textContent).toBe('OfficeScene');
      });

      it('reads scene name from engine.activeScene metadata', () => {
        mockEngine.activeScene = { constructor: { name: 'CustomScene' } };
        editor._updateSceneHeader();
        expect(editor._sceneNameEl.textContent).toBe('CustomScene');
      });
    });

    describe('dirty tracking', () => {
      it('starts with dirty = false', () => {
        expect(editor._dirty).toBe(false);
      });

      it('_markDirty() sets dirty flag and shows indicator', () => {
        editor._markDirty();
        expect(editor._dirty).toBe(true);
        expect(editor._dirtyIndicator.style.display).toBe('inline');
      });

      it('clears dirty flag after save', () => {
        editor._markDirty();
        editor._dirty = false;
        editor._updateDirtyIndicator();
        expect(editor._dirtyIndicator.style.display).toBe('none');
      });
    });

    describe('save functionality', () => {
      it('Save button exists in the editor UI', () => {
        expect(editor._saveBtn).not.toBeNull();
      });

      it('_saveHierarchy() downloads a JSON file', () => {
        const createObjectURL = vi.fn(() => 'blob:test');
        const revokeObjectURL = vi.fn();
        global.URL.createObjectURL = createObjectURL;
        global.URL.revokeObjectURL = revokeObjectURL;
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

        editor.sceneRoot = new GameObject('SceneRoot');
        editor.sceneRoot.makeGroup();
        editor.dynamicObjects = [];
        editor._saveHierarchy();

        expect(createObjectURL).toHaveBeenCalled();
        expect(clickSpy).toHaveBeenCalled();

        clickSpy.mockRestore();
      });

      it('_saveSceneCode() downloads a JS file', () => {
        const createObjectURL = vi.fn(() => 'blob:test');
        const revokeObjectURL = vi.fn();
        global.URL.createObjectURL = createObjectURL;
        global.URL.revokeObjectURL = revokeObjectURL;
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

        editor.sceneRoot = new GameObject('SceneRoot');
        editor.sceneRoot.makeGroup();
        editor.dynamicObjects = [];
        editor._saveSceneCode();

        expect(createObjectURL).toHaveBeenCalled();
        expect(clickSpy).toHaveBeenCalled();

        clickSpy.mockRestore();
      });

      it('_saveHierarchy() clears dirty flag after save', () => {
        const createObjectURL = vi.fn(() => 'blob:test');
        global.URL.createObjectURL = createObjectURL;
        global.URL.revokeObjectURL = vi.fn();
        vi.spyOn(HTMLAnchorElement.prototype, 'click');

        editor.sceneRoot = new GameObject('SceneRoot');
        editor.sceneRoot.makeGroup();
        editor.dynamicObjects = [];
        editor._markDirty();
        editor._saveHierarchy();

        expect(editor._dirty).toBe(false);
      });
    });

    describe('scene switcher', () => {
      it('has a scene switcher dropdown in the header', () => {
        expect(editor._sceneSwitcher).not.toBeNull();
      });
    });
  });

  describe('expandable tree view', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
    });

    it('groups start expanded by default', () => {
      const group = new GameObject('Office');
      group.makeGroup();
      const child = new GameObject('Wall1');
      group.addChild(child);

      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();
      editor.sceneRoot.addChild(group);

      editor._updateTreeView();

      // Child should be visible (group is expanded)
      const items = editor.objectList.querySelectorAll('div');
      const childItem = Array.from(items).find(el => el.textContent.includes('Wall1'));
      expect(childItem).toBeDefined();
    });

    it('has a toggle arrow on group nodes', () => {
      const group = new GameObject('Office');
      group.makeGroup();
      const child = new GameObject('Wall1');
      group.addChild(child);

      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();
      editor.sceneRoot.addChild(group);

      editor._updateTreeView();

      // Find the toggle arrow element inside the group row
      const items = editor.objectList.querySelectorAll('div');
      const groupItem = Array.from(items).find(el => el.textContent.includes('Office'));
      const toggle = groupItem.querySelector('.tree-toggle');
      expect(toggle).toBeDefined();
      expect(toggle).not.toBeNull();
    });

    it('clicking the toggle arrow collapses the group (hides children)', () => {
      const group = new GameObject('Office');
      group.makeGroup();
      const child = new GameObject('Wall1');
      group.addChild(child);

      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();
      editor.sceneRoot.addChild(group);

      editor._updateTreeView();

      // Click the toggle arrow to collapse
      const items = editor.objectList.querySelectorAll('div');
      const groupItem = Array.from(items).find(el => el.textContent.includes('Office'));
      const toggle = groupItem.querySelector('.tree-toggle');
      toggle.click();

      // Child should now be hidden (not rendered)
      const itemsAfter = editor.objectList.querySelectorAll('div');
      const childItem = Array.from(itemsAfter).find(el => el.textContent.includes('Wall1'));
      expect(childItem).toBeUndefined();
    });

    it('clicking the toggle arrow again re-expands the group', () => {
      const group = new GameObject('Office');
      group.makeGroup();
      const child = new GameObject('Wall1');
      group.addChild(child);

      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();
      editor.sceneRoot.addChild(group);

      editor._updateTreeView();

      // Collapse
      const items = editor.objectList.querySelectorAll('div');
      const groupItem = Array.from(items).find(el => el.textContent.includes('Office'));
      const toggle = groupItem.querySelector('.tree-toggle');
      toggle.click();
      // Re-expand
      toggle.click();

      // Child should be visible again
      const itemsAfter = editor.objectList.querySelectorAll('div');
      const childItem = Array.from(itemsAfter).find(el => el.textContent.includes('Wall1'));
      expect(childItem).toBeDefined();
    });
  });

  describe('group editable fields', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
    });

    it('info panel shows position/rotation/scale inputs when a group is selected', () => {
      const group = new GameObject('Office');
      group.makeGroup();
      const child = new GameObject('Wall1');
      group.addChild(child);

      editor.selectObject(group);

      const inputs = editor.infoDiv.querySelectorAll('input');
      expect(inputs.length).toBeGreaterThanOrEqual(9); // 3 pos + 3 rot + 3 scale
    });

    it('group info panel inputs have correct data-prop attributes', () => {
      const group = new GameObject('Office');
      group.makeGroup();

      editor.selectObject(group);

      const posInputs = editor.infoDiv.querySelectorAll('input[data-prop="position"]');
      const rotInputs = editor.infoDiv.querySelectorAll('input[data-prop="rotation"]');
      const scaleInputs = editor.infoDiv.querySelectorAll('input[data-prop="scale"]');
      expect(posInputs.length).toBe(3);
      expect(rotInputs.length).toBe(3);
      expect(scaleInputs.length).toBe(3);
    });

    it('changing a group input value updates the group object3d', () => {
      const group = new GameObject('Office');
      group.makeGroup();

      editor.selectObject(group);

      const posXInput = editor.infoDiv.querySelector('input[data-prop="position"][data-axis="x"]');
      expect(posXInput).not.toBeNull();

      // Simulate user editing the value
      posXInput.value = '5.0';
      posXInput.dispatchEvent(new Event('change'));

      expect(group.object3d.position.x).toBe(5.0);
    });

    it('_updateInfoPanelValues() updates group input fields live', () => {
      const group = new GameObject('Office');
      group.makeGroup();
      group.object3d.position.set(1, 2, 3);

      editor.selectObject(group);

      // Simulate a transform happening externally
      group.object3d.position.set(4, 5, 6);
      editor._updateInfoPanelValues();

      const posXInput = editor.infoDiv.querySelector('input[data-prop="position"][data-axis="x"]');
      expect(posXInput.value).toBe('4.000');
    });

    it('group info panel includes parent dropdown', () => {
      const group = new GameObject('Office');
      group.makeGroup();

      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();
      editor.sceneRoot.addChild(group);

      editor.selectObject(group);

      const select = editor.infoDiv.querySelector('select');
      expect(select).not.toBeNull();
    });
  });

  describe('deep nested editable objects', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
    });

    it('_buildHierarchy collects deeply nested descendants into editableObjects', () => {
      // Simulate OfficeScene hierarchy:
      // OfficeSceneSceneRoot → Office → Wall1
      const officeSceneRoot = new GameObject('SceneRoot');
      officeSceneRoot.makeGroup();
      const office = new GameObject('Office');
      office.makeGroup();
      officeSceneRoot.addChild(office);
      const wall = new GameObject('BackWall_Left');
      office.addChild(wall);

      mockEngine._rootObjects = [officeSceneRoot];
      editor._buildHierarchy();

      // Wall should be editable even though it's 2 levels deep
      expect(editor.editableObjects).toContain(wall);
      expect(editor.editableObjects).toContain(office);
    });

    it('nested objects can be selected via click in the tree view', () => {
      const officeSceneRoot = new GameObject('SceneRoot');
      officeSceneRoot.makeGroup();
      const office = new GameObject('Office');
      office.makeGroup();
      officeSceneRoot.addChild(office);
      const wall = new GameObject('BackWall_Left');
      office.addChild(wall);

      mockEngine._rootObjects = [officeSceneRoot];
      editor._buildHierarchy();

      editor._updateTreeView();

      const items = editor.objectList.querySelectorAll('div');
      const wallItem = Array.from(items).find(el => el.textContent.includes('BackWall_Left'));
      expect(wallItem).toBeDefined();
      wallItem.click();

      expect(editor.selectedObject).toBe(wall);
    });
  });

  describe('hierarchy transform propagation', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
    });

    it('_buildHierarchy adopts existing SceneRoot from _rootObjects', () => {
      const existingRoot = new GameObject('SceneRoot');
      existingRoot.makeGroup();
      mockEngine._rootObjects = [existingRoot];

      editor._buildHierarchy();

      expect(editor.sceneRoot).toBe(existingRoot);
    });

    it('creates a new sceneRoot when no existing one is found', () => {
      const go = new GameObject('SomeObject');
      mockEngine._rootObjects = [go];

      editor._buildHierarchy();

      expect(editor.sceneRoot).toBeDefined();
      expect(editor.sceneRoot.name).toBe('SceneRoot');
      expect(editor.sceneRoot).not.toBe(go);
    });

    it('moving a parent group cascades to children world positions in Three.js', () => {
      const office = new GameObject('Office');
      office.makeGroup();
      const wall = new GameObject('Wall1');
      office.addChild(wall);
      wall.object3d.position.set(1, 0, 0);

      const existingRoot = new GameObject('SceneRoot');
      existingRoot.makeGroup();
      existingRoot.addChild(office);
      mockEngine._rootObjects = [existingRoot];
      editor._buildHierarchy();

      // Record wall world position before
      const worldBefore = new THREE.Vector3();
      wall.object3d.getWorldPosition(worldBefore);

      // Move the office group
      office.object3d.position.x += 5;
      office.object3d.updateMatrixWorld(true);

      // Wall world position should have shifted
      const worldAfter = new THREE.Vector3();
      wall.object3d.getWorldPosition(worldAfter);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x + 5, 5);
    });

    it('deeply nested children move when top-level group is translated', () => {
      const existingRoot = new GameObject('SceneRoot');
      existingRoot.makeGroup();
      const office = new GameObject('Office');
      office.makeGroup();
      existingRoot.addChild(office);
      const wall = new GameObject('Wall1');
      office.addChild(wall);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      mesh.position.set(-6, 1.5, -5);
      wall.object3d.add(mesh);

      mockEngine._rootObjects = [existingRoot];
      editor._buildHierarchy();

      // Get mesh world position before
      existingRoot.object3d.updateMatrixWorld(true);
      const worldBefore = new THREE.Vector3();
      mesh.getWorldPosition(worldBefore);

      // Move the sceneRoot
      existingRoot.object3d.position.x += 3;
      existingRoot.object3d.updateMatrixWorld(true);

      // Mesh world position should have shifted by 3
      const worldAfter = new THREE.Vector3();
      mesh.getWorldPosition(worldAfter);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x + 3, 5);
    });
  });

  describe('create group button', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
    });

    it('has a "Create Group" button in the editor UI', () => {
      expect(editor._createGroupBtn).toBeDefined();
      expect(editor._createGroupBtn).not.toBeNull();
    });

    it('clicking "Create Group" button creates a new group under sceneRoot', () => {
      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();

      editor._createGroupBtn.click();

      // A new group should have been added to sceneRoot
      const groups = editor.sceneRoot.children.filter(c => c.isGroup);
      expect(groups.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('export modes', () => {
    beforeEach(() => {
      editor.init();
      editor.toggle();
      editor.sceneRoot = new GameObject('SceneRoot');
      editor.sceneRoot.makeGroup();
      editor.dynamicObjects = [];
    });

    describe('standalone export', () => {
      it('_exportStandalone() generates a complete Scene class', () => {
        const code = editor._generateFullSceneClass();
        expect(code).toContain('import');
        expect(code).toContain('extends Scene');
        expect(code).toContain('build()');
      });

      it('_exportStandalone() includes all imports', () => {
        const code = editor._generateFullSceneClass();
        expect(code).toContain("import * as THREE from 'three'");
        expect(code).toContain("import { GameObject }");
        expect(code).toContain("import { Scene }");
      });

      it('_exportStandalone() triggers a download', () => {
        const createObjectURL = vi.fn(() => 'blob:test');
        global.URL.createObjectURL = createObjectURL;
        global.URL.revokeObjectURL = vi.fn();
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

        editor._exportStandalone();

        expect(createObjectURL).toHaveBeenCalled();
        expect(clickSpy).toHaveBeenCalled();
        clickSpy.mockRestore();
      });
    });

    describe('hierarchy export', () => {
      it('_exportHierarchy() triggers a JSON download', () => {
        const createObjectURL = vi.fn(() => 'blob:test');
        global.URL.createObjectURL = createObjectURL;
        global.URL.revokeObjectURL = vi.fn();
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

        editor._exportHierarchy();

        expect(createObjectURL).toHaveBeenCalled();
        expect(clickSpy).toHaveBeenCalled();
        clickSpy.mockRestore();
      });
    });
  });

  describe('scene switching', () => {
    let switchEditor;
    let switchEngine;

    class FakeOfficeScene {
      constructor(engine) { this.engine = engine; }
      build() {}
      dispose() {}
    }
    Object.defineProperty(FakeOfficeScene, 'name', { value: 'OfficeScene' });
    class FakeTestScene {
      constructor(engine) { this.engine = engine; }
      build() {}
      dispose() {}
    }
    Object.defineProperty(FakeTestScene, 'name', { value: 'TestScene' });

    beforeEach(() => {
      document.exitPointerLock = vi.fn();

      switchEngine = {
        scene: { add: vi.fn(), remove: vi.fn() },
        camera: new THREE.PerspectiveCamera(),
        renderer: { domElement: document.createElement('canvas') },
        input: { locked: false },
        _rootObjects: [],
        world: { removeRigidBody: vi.fn() },
        rigidBodyMap: new Map(),
        _bodyToGO: new Map(),
        rebuildModelPhysicsForScale: vi.fn(() => true),
        sceneRegistry: new Map([
          ['OfficeScene', FakeOfficeScene],
          ['TestScene', FakeTestScene],
        ]),
        getRegisteredSceneNames: vi.fn(() => ['OfficeScene', 'TestScene']),
        loadScene: vi.fn((SceneClass) => {
          switchEngine._rootObjects.length = 0;
          switchEngine.activeScene = new SceneClass(switchEngine);
          switchEngine.activeScene.build();
        }),
        activeScene: null,
      };
      switchEngine.activeScene = new FakeOfficeScene(switchEngine);

      switchEditor = new LevelEditor(switchEngine);
      switchEditor.init();
      switchEditor.toggle(); // enable
    });

    it('scene switcher dropdown lists all registered scenes', () => {
      const options = Array.from(switchEditor._sceneSwitcher.options);
      const names = options.map(o => o.value);

      expect(names).toContain('OfficeScene');
      expect(names).toContain('TestScene');
    });

    it('current scene is selected in the dropdown', () => {
      expect(switchEditor._sceneSwitcher.value).toBe('OfficeScene');
    });

    it('switching scene calls engine.loadScene with the correct class', () => {
      switchEditor._switchToScene('TestScene');

      expect(switchEngine.loadScene).toHaveBeenCalledWith(FakeTestScene);
    });

    it('does not switch when selecting the already-active scene', () => {
      switchEditor._switchToScene('OfficeScene');

      expect(switchEngine.loadScene).not.toHaveBeenCalled();
    });

    it('refreshes the hierarchy after switching', () => {
      const refreshSpy = vi.spyOn(switchEditor, '_refreshEditableObjects');

      switchEditor._switchToScene('TestScene');

      expect(refreshSpy).toHaveBeenCalled();
    });

    it('updates the header after switching', () => {
      switchEditor._switchToScene('TestScene');

      // After switching, the scene name should reflect the new scene
      expect(switchEditor._getSceneName()).toBe('TestScene');
    });

    it('repopulates the switcher dropdown after switching', () => {
      switchEditor._switchToScene('TestScene');

      expect(switchEditor._sceneSwitcher.value).toBe('TestScene');
    });
  });
});
