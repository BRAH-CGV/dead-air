import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { SecurityCameraRig } from './SecurityCameraRig.js';

const DEG = Math.PI / 180;

function lens(rig) {
  rig.object3d.updateMatrixWorld(true);
  return {
    at: rig.getLensPosition(new THREE.Vector3()),
    dir: rig.getLensDirection(new THREE.Vector3()),
  };
}

describe('SecurityCameraRig', () => {
  it('looks along +Z at yaw 0, and yaw pans it about the vertical', () => {
    const rig = new SecurityCameraRig();
    expect(lens(rig).dir.z).toBeCloseTo(1);

    rig.yaw = Math.PI / 2;
    const { dir } = lens(rig);
    expect(dir.x).toBeCloseTo(1);
    expect(rig.yaw).toBe(Math.PI / 2);
  });

  it('a positive tilt looks down', () => {
    const rig = new SecurityCameraRig();
    rig.tilt = 30 * DEG;
    const { dir } = lens(rig);
    expect(dir.y).toBeCloseTo(-Math.sin(30 * DEG));
    expect(rig.tilt).toBeCloseTo(30 * DEG);
  });

  it('the lens sits in front of the pivot, and follows the rig round the room', () => {
    const room = new GameObject('Room');
    room.object3d.position.set(10, 0, 0);
    const rig = room.addChild(new SecurityCameraRig());
    rig.object3d.position.set(1, 2.8, 3);
    const { at } = lens(rig);
    expect(at.x).toBeCloseTo(11);
    expect(at.y).toBeCloseTo(2.8);
    expect(at.z).toBeGreaterThan(3);
  });

  it('its cone starts at the lens and reaches `range` along the view, range·tan(halfAngle) wide', () => {
    const rig = new SecurityCameraRig();
    rig.setCone(7, 25 * DEG);
    rig.object3d.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rig.cone);
    const { at } = lens(rig);
    expect(box.min.z).toBeCloseTo(at.z, 5);
    expect(box.max.z).toBeCloseTo(at.z + 7, 5);
    expect(box.max.x).toBeCloseTo(7 * Math.tan(25 * DEG), 2);
  });

  it('the cone is a faint additive glow that never hides what is behind it', () => {
    const { material } = new SecurityCameraRig().cone;
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(true);
  });

  it('the cone only shows while the threat drives it (its night)', () => {
    const rig = new SecurityCameraRig();
    expect(rig.cone.visible).toBe(false);
    rig.setActive(true);
    expect(rig.cone.visible).toBe(true);
    rig.setActive(false);
    expect(rig.cone.visible).toBe(false);
  });

  it('setAlert reddens the tally and brightens the cone as exposure rises', () => {
    const rig = new SecurityCameraRig();
    rig.setAlert(0);
    const calmTally = rig.tally.material.color.r;
    const calmCone = rig.cone.material.opacity;
    rig.setAlert(1);
    expect(rig.tally.material.color.r).toBeGreaterThan(calmTally);
    expect(rig.cone.material.opacity).toBeGreaterThan(calmCone);
    expect(rig.cone.material.color.r).toBeGreaterThan(rig.cone.material.color.b);
  });

  it('attachModel puts a model on the moving head, at its origin', () => {
    const rig = new SecurityCameraRig();
    const model = new GameObject('Model');
    model.object3d.position.set(5, 5, 5);
    rig.attachModel(model);
    expect(model.parent).toBe(rig.head);
    expect(model.object3d.position.toArray()).toEqual([0, 0, 0]);
  });

  it('is not physics, and lists what it built for the owner to free', () => {
    const rig = new SecurityCameraRig();
    expect(rig.rigidBody).toBeNull();
    expect(rig.resources.length).toBeGreaterThanOrEqual(4);
    for (const r of rig.resources) expect(typeof r.dispose).toBe('function');
  });
});
