import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { GameObject } from './GameObject.js';

describe('GameObject hierarchy extensions', () => {
  describe('descendants()', () => {
    it('returns [self] when no children', () => {
      const go = new GameObject('Root');
      const descendants = go.descendants();
      
      expect(descendants).toHaveLength(1);
      expect(descendants[0]).toBe(go);
    });

    it('returns self + direct children', () => {
      const root = new GameObject('Root');
      const child1 = new GameObject('Child1');
      const child2 = new GameObject('Child2');
      
      root.addChild(child1);
      root.addChild(child2);
      
      const descendants = root.descendants();
      
      expect(descendants).toHaveLength(3);
      expect(descendants).toContain(root);
      expect(descendants).toContain(child1);
      expect(descendants).toContain(child2);
    });

    it('returns self + all nested descendants depth-first', () => {
      const root = new GameObject('Root');
      const child1 = new GameObject('Child1');
      const child2 = new GameObject('Child2');
      const grandchild1 = new GameObject('Grandchild1');
      const grandchild2 = new GameObject('Grandchild2');
      
      root.addChild(child1);
      root.addChild(child2);
      child1.addChild(grandchild1);
      child1.addChild(grandchild2);
      
      const descendants = root.descendants();
      
      expect(descendants).toHaveLength(5);
      expect(descendants[0]).toBe(root);
      expect(descendants[1]).toBe(child1);
      expect(descendants[2]).toBe(grandchild1);
      expect(descendants[3]).toBe(grandchild2);
      expect(descendants[4]).toBe(child2);
    });
  });

  describe('makeGroup()', () => {
    it('sets isGroup to true', () => {
      const go = new GameObject('Group');
      expect(go.isGroup).toBe(false);
      
      go.makeGroup();
      
      expect(go.isGroup).toBe(true);
    });

    it('returns this for chaining', () => {
      const go = new GameObject('Group');
      const result = go.makeGroup();
      
      expect(result).toBe(go);
    });
  });

  describe('reparentUnder()', () => {
    it('moves object from root to under a group', () => {
      const root = new GameObject('Root');
      const group = new GameObject('Group');
      const obj = new GameObject('Object');
      
      root.addChild(group);
      root.addChild(obj);
      
      expect(obj.parent).toBe(root);
      expect(group.children).not.toContain(obj);
      
      obj.reparentUnder(group);
      
      expect(obj.parent).toBe(group);
      expect(group.children).toContain(obj);
      expect(root.children).not.toContain(obj);
    });

    it('moves object from one group to another', () => {
      const root = new GameObject('Root');
      const group1 = new GameObject('Group1');
      const group2 = new GameObject('Group2');
      const obj = new GameObject('Object');
      
      root.addChild(group1);
      root.addChild(group2);
      group1.addChild(obj);
      
      expect(group1.children).toContain(obj);
      expect(group2.children).not.toContain(obj);
      
      obj.reparentUnder(group2);
      
      expect(group1.children).not.toContain(obj);
      expect(group2.children).toContain(obj);
      expect(obj.parent).toBe(group2);
    });

    it('preserves world position after reparenting', () => {
      const root = new GameObject('Root');
      const group = new GameObject('Group');
      const obj = new GameObject('Object');
      
      root.addChild(group);
      root.addChild(obj);
      
      // Set group at position (5, 0, 0)
      group.object3d.position.set(5, 0, 0);
      // Set object at world position (10, 0, 0)
      obj.object3d.position.set(10, 0, 0);
      
      const worldPosBefore = new THREE.Vector3();
      obj.object3d.getWorldPosition(worldPosBefore);
      expect(worldPosBefore.x).toBe(10);
      
      obj.reparentUnder(group);
      
      const worldPosAfter = new THREE.Vector3();
      obj.object3d.getWorldPosition(worldPosAfter);
      
      // World position should be preserved
      expect(worldPosAfter.x).toBeCloseTo(10, 5);
      // Local position should now be relative to group (5, 0, 0)
      expect(obj.object3d.position.x).toBeCloseTo(5, 5);
    });

    it('preserves world position when new parent has a non-zero transform', () => {
      const root = new GameObject('Root');
      const group = new GameObject('Group');
      const obj = new GameObject('Object');
      
      root.addChild(group);
      root.addChild(obj);
      
      // Group at (2, 3, 4)
      group.object3d.position.set(2, 3, 4);
      // Object at world (10, 10, 10)
      obj.object3d.position.set(10, 10, 10);
      
      const worldPosBefore = new THREE.Vector3();
      obj.object3d.getWorldPosition(worldPosBefore);
      
      obj.reparentUnder(group);
      
      const worldPosAfter = new THREE.Vector3();
      obj.object3d.getWorldPosition(worldPosAfter);
      
      expect(worldPosAfter.x).toBeCloseTo(worldPosBefore.x, 5);
      expect(worldPosAfter.y).toBeCloseTo(worldPosBefore.y, 5);
      expect(worldPosAfter.z).toBeCloseTo(worldPosBefore.z, 5);
    });
  });

  describe('group transform propagation', () => {
    it('moving a group object3d.position moves all children world positions', () => {
      const group = new GameObject('Group');
      const child1 = new GameObject('Child1');
      const child2 = new GameObject('Child2');
      
      group.addChild(child1);
      group.addChild(child2);
      
      // Children at local positions
      child1.object3d.position.set(1, 0, 0);
      child2.object3d.position.set(0, 1, 0);
      
      // Move group
      group.object3d.position.set(10, 20, 30);
      group.object3d.updateMatrixWorld(true);
      
      const child1World = new THREE.Vector3();
      const child2World = new THREE.Vector3();
      child1.object3d.getWorldPosition(child1World);
      child2.object3d.getWorldPosition(child2World);
      
      expect(child1World.x).toBe(11);
      expect(child1World.y).toBe(20);
      expect(child1World.z).toBe(30);
      
      expect(child2World.x).toBe(10);
      expect(child2World.y).toBe(21);
      expect(child2World.z).toBe(30);
    });

    it('rotating a group object3d.rotation rotates all children', () => {
      const group = new GameObject('Group');
      const child = new GameObject('Child');
      
      group.addChild(child);
      child.object3d.position.set(1, 0, 0);
      
      // Rotate group 90 degrees around Y
      group.object3d.rotation.y = Math.PI / 2;
      group.object3d.updateMatrixWorld(true);
      
      const childWorld = new THREE.Vector3();
      child.object3d.getWorldPosition(childWorld);
      
      // Child should now be at (0, 0, -1) after 90-degree Y rotation
      expect(childWorld.x).toBeCloseTo(0, 5);
      expect(childWorld.y).toBeCloseTo(0, 5);
      expect(childWorld.z).toBeCloseTo(-1, 5);
    });
  });

  describe('_init() hierarchy preservation', () => {
    it('does NOT break Three.js parent-child links when initialising a hierarchy', () => {
      // Build a hierarchy: SceneRoot → Office → Wall
      const sceneRoot = new GameObject('SceneRoot');
      sceneRoot.makeGroup();
      const office = new GameObject('Office');
      office.makeGroup();
      const wall = new GameObject('Wall');

      sceneRoot.addChild(office);
      office.addChild(wall);

      // Position the wall via a grandchild mesh (same pattern as _addStaticBox)
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      mesh.position.set(3, 1.5, -5);
      wall.object3d.add(mesh);

      // Before _init: wall.object3d should be a child of office.object3d
      expect(wall.object3d.parent).toBe(office.object3d);

      // Simulate what Engine.init() does: call _init on root objects
      const scene = new THREE.Scene();
      sceneRoot._init(scene, {});

      // After _init: the Three.js hierarchy must be preserved
      expect(wall.object3d.parent).toBe(office.object3d);
      expect(office.object3d.parent).toBe(sceneRoot.object3d);
      // sceneRoot should be in the scene
      expect(sceneRoot.object3d.parent).toBe(scene);
    });

    it('moving a group after _init cascades to all children', () => {
      const sceneRoot = new GameObject('SceneRoot');
      sceneRoot.makeGroup();
      const office = new GameObject('Office');
      office.makeGroup();
      const wall = new GameObject('Wall');

      sceneRoot.addChild(office);
      office.addChild(wall);
      wall.object3d.position.set(3, 1.5, -5);

      const scene = new THREE.Scene();
      sceneRoot._init(scene, {});

      // Move the office group
      office.object3d.position.set(10, 0, 0);
      office.object3d.updateMatrixWorld(true);

      const wallWorld = new THREE.Vector3();
      wall.object3d.getWorldPosition(wallWorld);

      // Wall should have moved with the office group
      expect(wallWorld.x).toBeCloseTo(13, 5);
      expect(wallWorld.y).toBeCloseTo(1.5, 5);
      expect(wallWorld.z).toBeCloseTo(-5, 5);
    });

    it('root objects without a parent are added to the scene directly', () => {
      const root = new GameObject('Root');
      const scene = new THREE.Scene();

      root._init(scene, {});

      expect(root.object3d.parent).toBe(scene);
    });
  });
});
