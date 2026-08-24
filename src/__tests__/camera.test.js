import { describe, it, expect } from 'vitest';
import { createCameraRig, updateCameraPosition, toggleCameraMode } from '../camera.js';

describe('camera', () => {
  describe('createCameraRig', () => {
    it('creates a camera rig in first-person mode by default', () => {
      const rig = createCameraRig();
      expect(rig.mode).toBe('first-person');
    });

    it('creates a camera rig with default third-person offset', () => {
      const rig = createCameraRig();
      expect(rig.thirdPersonOffset).toBeDefined();
      expect(rig.thirdPersonOffset.y).toBeGreaterThan(0); // behind and above
      expect(rig.thirdPersonOffset.z).toBeGreaterThan(0); // behind
    });

    it('accepts custom third-person offset', () => {
      const rig = createCameraRig({ x: 0, y: 3, z: 5 });
      expect(rig.thirdPersonOffset.x).toBe(0);
      expect(rig.thirdPersonOffset.y).toBe(3);
      expect(rig.thirdPersonOffset.z).toBe(5);
    });
  });

  describe('updateCameraPosition', () => {
    it('places camera at player position in first-person mode', () => {
      const rig = createCameraRig();
      const player = {
        position: { x: 10, y: 1, z: -5 },
        yaw: 0,
        pitch: 0,
        height: 1.7,
      };
      const cam = updateCameraPosition(rig, player);
      expect(cam.position.x).toBe(10);
      expect(cam.position.y).toBeCloseTo(1 + 1.7, 5); // player y + eye height
      expect(cam.position.z).toBe(-5);
    });

    it('places camera behind player in third-person mode', () => {
      const rig = createCameraRig();
      rig.mode = 'third-person';
      const player = {
        position: { x: 0, y: 0, z: 0 },
        yaw: 0,
        pitch: 0,
        height: 1.7,
      };
      const cam = updateCameraPosition(rig, player);
      // in third-person, camera should be offset behind (positive z when yaw=0)
      expect(cam.position.z).toBeGreaterThan(0);
    });

    it('returns yaw and pitch for camera rotation', () => {
      const rig = createCameraRig();
      const player = {
        position: { x: 0, y: 0, z: 0 },
        yaw: 1.0,
        pitch: -0.3,
        height: 1.7,
      };
      const cam = updateCameraPosition(rig, player);
      expect(cam.yaw).toBe(1.0);
      expect(cam.pitch).toBe(-0.3);
    });
  });

  describe('toggleCameraMode', () => {
    it('switches from first-person to third-person', () => {
      const rig = createCameraRig();
      expect(rig.mode).toBe('first-person');
      toggleCameraMode(rig);
      expect(rig.mode).toBe('third-person');
    });

    it('switches from third-person back to first-person', () => {
      const rig = createCameraRig();
      toggleCameraMode(rig);
      toggleCameraMode(rig);
      expect(rig.mode).toBe('first-person');
    });
  });
});
