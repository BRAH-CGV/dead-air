import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SightlineZone } from './SightlineZone.js';
import { GameObject } from '../core/GameObject.js';

describe('SightlineZone', () => {
  it('is a GameObject with no physics, positioned and sized from opts', () => {
    const zone = new SightlineZone('Watch', { position: [1, 2, 3], size: [2, 3, 4] });
    expect(zone.name).toBe('Watch');
    expect(zone.rigidBody).toBeNull();
    expect(zone.object3d.position.toArray()).toEqual([1, 2, 3]);
    expect(zone.size).toEqual([2, 3, 4]);
  });

  it('defaults to a 1x1x1 box at the origin', () => {
    const zone = new SightlineZone();
    expect(zone.object3d.position.toArray()).toEqual([0, 0, 0]);
    expect(zone.size).toEqual([1, 1, 1]);
  });

  it('containsPoint is true inside the box, false outside', () => {
    const zone = new SightlineZone('Watch', { position: [0, 0, 0], size: [2, 2, 2] });
    expect(zone.containsPoint(new THREE.Vector3(0, 0, 0))).toBe(true);
    expect(zone.containsPoint(new THREE.Vector3(0.9, 0.9, 0.9))).toBe(true);
    expect(zone.containsPoint(new THREE.Vector3(1.1, 0, 0))).toBe(false);
  });

  it('follows a parent GameObject transform (room offset included)', () => {
    const room = new GameObject('Room').makeGroup();
    room.object3d.position.set(10, 0, -5);
    const zone = new SightlineZone('Watch', { position: [1, 0, 0], size: [2, 2, 2] });
    room.addChild(zone);

    expect(zone.containsPoint(new THREE.Vector3(11, 0, -5))).toBe(true);
    expect(zone.containsPoint(new THREE.Vector3(0, 0, 0))).toBe(false);
  });
});
