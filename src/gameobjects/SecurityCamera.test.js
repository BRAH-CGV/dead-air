import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SecurityCamera, aimAngles, CAMERA_CLEARANCE } from './SecurityCamera.js';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// SecurityCamera  –  a wall-mounted placeholder camera with a lens to see by
// ─────────────────────────────────────────────

const dirOf = (cam) => cam.lens.getWorldDirection(new THREE.Vector3());
const posOf = (o) => o.getWorldPosition(new THREE.Vector3());

function mounted(opts) {
  const cam = new SecurityCamera(opts);
  const root = new GameObject('Root').makeGroup();
  root.addChild(cam);
  root.object3d.updateMatrixWorld(true);
  return cam;
}

describe('aimAngles', () => {
  it('gives the yaw and pitch that point a camera from one point at another', () => {
    const { yaw, pitch } = aimAngles([0, 3, 0], [4, 0, 4]);
    const d = new THREE.Vector3(4, -3, 4).normalize();
    const back = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    expect(back.distanceTo(d)).toBeLessThan(1e-6);
  });
});

describe('SecurityCamera', () => {
  it('is a GameObject with a perspective camera for a lens', () => {
    const cam = new SecurityCamera({ name: 'Cam', label: 'Test' });
    expect(cam).toBeInstanceOf(GameObject);
    expect(cam.lens).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(cam.label).toBe('Test');
  });

  it('looks where it is aimed at rest', () => {
    const cam = mounted({ position: [1, 2.6, 1], target: [5, 0, -3] });
    const want = new THREE.Vector3(4, -2.6, -4).normalize();
    expect(dirOf(cam).distanceTo(want)).toBeLessThan(1e-6);
  });

  it('pans about the vertical: + turns it left, and the pitch is kept', () => {
    const cam = mounted({ position: [0, 3, 0], target: [0, 0, -5] });
    const before = dirOf(cam);
    cam.setPan(0.4);
    cam.object3d.updateMatrixWorld(true);
    const after = dirOf(cam);
    expect(after.y).toBeCloseTo(before.y);
    expect(after.x).toBeLessThan(0);   // facing −z, left is −x
  });

  it('holds its lens in front of its own housing, so the view is clear of it', () => {
    const cam = mounted({ position: [0, 3, 0], target: [0, 3, -5] });
    const lens = posOf(cam.lens);
    const box = new THREE.Box3();
    cam.housing.updateWorldMatrix(true, true);
    box.setFromObject(cam.housing);
    // Looking down −z: every bit of the housing is behind the lens's near plane.
    expect(box.min.z).toBeGreaterThan(lens.z - cam.lens.near);
  });

  it('carries its viewing details: pan range and the zones it sees into', () => {
    const cam = new SecurityCamera({ panRange: 0.7, zones: ['yard'] });
    expect(cam.panRange).toBe(0.7);
    expect(cam.zones).toEqual(['yard']);
  });

  it('casts no shadow and takes none, so it never redraws a frozen shadow map', () => {
    const cam = mounted({ position: [0, 3, 0], target: [0, 0, -5] });
    cam.object3d.traverse(o => {
      if (o.isMesh) expect(o.castShadow).toBe(false);
    });
  });

  describe('the wedge behind an angled bracket', () => {
    const wedgeBox = (cam) => {
      const wedge = cam.object3d.getObjectByName('CameraWedge');
      if (!wedge) return null;
      cam.object3d.updateWorldMatrix(true, true);
      return new THREE.Box3().setFromObject(wedge, true);   // precise: the bracket is turned
    };
    const plateBack = (cam) => cam.object3d.localToWorld(new THREE.Vector3(0, 0, 0.02));

    it('in a corner, fills the gap between both walls and the bracket', () => {
      // The corner's walls are x = −3 and z = −4; the camera sits in from both.
      const cam = mounted({ position: [-2.8, 2.7, -3.8], target: [0, 0, 0], mount: { corner: [-3, -4] } });
      const box = wedgeBox(cam);
      expect(box).not.toBeNull();
      expect(box.min.x).toBeCloseTo(-3, 3);
      expect(box.min.z).toBeCloseTo(-4, 3);
      // It reaches out to the bracket's back, and covers the plate's height.
      const back = plateBack(cam);
      expect(box.max.x).toBeGreaterThan(back.x);
      expect(box.max.z).toBeGreaterThan(back.z);
      expect(box.min.y).toBeLessThan(2.7 - 0.07);
      expect(box.max.y).toBeGreaterThan(2.7 + 0.07);
    });

    it('on one wall, turned away from square, fills the gap to that wall', () => {
      // On a wall at z = 5 facing +z, aimed off to one side.
      const cam = mounted({ position: [-10, 2.6, 5.02], target: [0, 0, 15], mount: { wall: { axis: 'z', at: 5 } } });
      const box = wedgeBox(cam);
      expect(box).not.toBeNull();
      expect(box.min.z).toBeCloseTo(5, 3);
      expect(box.max.z).toBeGreaterThan(5.04);
    });

    it('a bracket square to its wall needs none', () => {
      const cam = mounted({ position: [0, 2.6, 5.02], target: [0, 0, 15], mount: { wall: { axis: 'z', at: 5 } } });
      expect(wedgeBox(cam)).toBeNull();
    });

    it('is drawn in the wall’s own material, which it never frees', () => {
      const wall = new THREE.MeshStandardMaterial({ color: 0x334455 });
      let freed = false;
      wall.addEventListener('dispose', () => { freed = true; });
      const cam = mounted({ position: [-2.8, 2.7, -3.8], target: [0, 0, 0], mount: { corner: [-3, -4], material: wall } });
      expect(cam.object3d.getObjectByName('CameraWedge').material).toBe(wall);
      cam.dispose();
      expect(freed).toBe(false);
    });

    it('no mount, no wedge', () => {
      expect(wedgeBox(mounted({ position: [0, 3, 0], target: [3, 0, 3] }))).toBeNull();
    });
  });

  describe('pan limits', () => {
    it('without a wall to mind, the pan range either way', () => {
      const cam = new SecurityCamera({ panRange: 0.7 });
      expect(cam.panLimits).toEqual([-0.7, 0.7]);
    });

    it('on a wall, never far enough round that the lens swings into it, or the view looks along it', () => {
      // A yard camera: on a wall at z = 5 facing +z, turned well off square.
      const cam = mounted({ position: [-10, 2.6, 5.02], target: [0, 0, 15], panRange: 1.0, mount: { wall: { axis: 'z', at: 5 } } });
      const [lo, hi] = cam.panLimits;
      expect(lo).toBeGreaterThanOrEqual(-1.0);
      expect(hi).toBeLessThanOrEqual(1.0);
      // Turned toward +x already, so it is the left (+) side that meets the wall.
      expect(hi).toBeLessThan(1.0);
      expect(lo).toBeCloseTo(-1.0);
      for (let p = lo; p <= hi + 1e-9; p += (hi - lo) / 40) {
        cam.setPan(p);
        cam.object3d.updateMatrixWorld(true);
        const lens = cam.lens.getWorldPosition(new THREE.Vector3());
        expect(lens.z - 5, `pan ${p}`).toBeGreaterThanOrEqual(CAMERA_CLEARANCE.lens - 1e-6);
        const d = cam.lens.getWorldDirection(new THREE.Vector3());
        const along = Math.atan2(Math.abs(d.x), d.z);   // from the wall's normal, level
        expect(along, `pan ${p}`).toBeLessThanOrEqual(CAMERA_CLEARANCE.view + 1e-6);
      }
    });

    it('square to the wall, turned neither way, the full range is safe', () => {
      const cam = mounted({ position: [0, 2.6, 5.02], target: [0, 0, 15], panRange: 1.0, mount: { wall: { axis: 'z', at: 5 } } });
      expect(cam.panLimits[0]).toBeCloseTo(-1.0);
      expect(cam.panLimits[1]).toBeCloseTo(1.0);
    });
  });

  it('frees what it built on dispose', () => {
    const cam = new SecurityCamera({});
    let disposed = 0;
    cam.object3d.traverse(o => { if (o.geometry) o.geometry.addEventListener('dispose', () => disposed++); });
    cam.dispose();
    expect(disposed).toBeGreaterThan(0);
  });
});
