import { describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d';
import { FirstPersonController } from './FirstPersonController.js';

// ─────────────────────────────────────────────
// Permanent tests for Source-style movement math
// ─────────────────────────────────────────────
// These test the pure math in _applyFriction and _accelerate,
// which don't depend on the Rapier world or character controller.

const DT = 1 / 60;

/** Build a controller with Rapier colliders (needed for halfHeight/radius). */
function buildController(opts = {}) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const rb = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  const stand  = world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.3), rb);
  const crouch = world.createCollider(RAPIER.ColliderDesc.capsule(0.025, 0.3), rb);
  const ctrl   = world.createCharacterController(0.01);

  return new FirstPersonController(ctrl, {
    speed: 5, accel: 6, airAccel: 2, friction: 6, stopSpeed: 1,
    standCollider: stand, crouchCollider: crouch,
    ...opts,
  });
}

describe('FirstPersonController movement math', () => {
  describe('_accelerate', () => {
    it('first tick adds accel × wishSpeed × dt', () => {
      const c = buildController();
      c._accelerate({ x: 1, z: 0 }, 5, 6, DT);
      expect(c._vel.x).toBeCloseTo(6 * 5 * DT, 10);   // 0.5
      expect(c._vel.z).toBe(0);
    });

    it('asymptotes to wishSpeed without overshooting', () => {
      const c = buildController();
      const dir = { x: 1, z: 0 };
      for (let i = 0; i < 60; i++) c._accelerate(dir, 5, 6, DT);
      expect(c._vel.x).toBeGreaterThan(4.9);
      expect(c._vel.x).toBeLessThanOrEqual(5);
    });

    it('never adds speed past the wish projection (perpendicular momentum survives)', () => {
      const c = buildController();
      c._vel.x = 3;   // existing sideways momentum
      c._vel.z = 4;   // existing forward momentum
      c._accelerate({ x: 1, z: 0 }, 5, 6, DT);
      // Projection along wish: current = 3.  add = 5 - 3 = 2.
      // accelSpeed = min(6 * 5 * DT, 2) = min(0.5, 2) = 0.5.
      expect(c._vel.x).toBeCloseTo(3.5, 10);
      expect(c._vel.z).toBe(4);   // z untouched
    });

    it('does nothing when wishSpeed is zero', () => {
      const c = buildController();
      c._vel.x = 3;
      c._accelerate({ x: 1, z: 0 }, 0, 6, DT);
      expect(c._vel.x).toBe(3);
    });

    it('does nothing when already at wish speed along the direction', () => {
      const c = buildController();
      c._vel.x = 5;
      c._accelerate({ x: 1, z: 0 }, 5, 6, DT);
      expect(c._vel.x).toBe(5);
    });
  });

  describe('_applyFriction', () => {
    it('bleeds speed proportionally above stopSpeed', () => {
      const c = buildController();
      c._vel.x = 5;
      c._applyFriction(DT);
      // drop = max(5, 1) * 6 * DT = 0.5;  scale = (5 - 0.5) / 5 = 0.9
      expect(c._vel.x).toBeCloseTo(4.5, 10);
    });

    it('uses constant drop below stopSpeed (clean stop)', () => {
      const c = buildController();
      c._vel.x = 0.5;     // below stopSpeed (1)
      c._applyFriction(DT);
      // drop = max(0.5, 1) * 6 * DT = 0.1;  scale = max(0, 0.5 - 0.1) / 0.5 = 0.8
      expect(c._vel.x).toBeCloseTo(0.4, 10);
    });

    it('reaches exactly zero (no asymptote)', () => {
      const c = buildController();
      c._vel.x = 5;
      for (let i = 0; i < 60; i++) c._applyFriction(DT);
      expect(c._vel.x).toBe(0);
      expect(c._vel.z).toBe(0);
    });

    it('no-ops at zero speed', () => {
      const c = buildController();
      c._applyFriction(DT);
      expect(c._vel.x).toBe(0);
    });

    it('preserves direction (scales both axes equally)', () => {
      const c = buildController();
      c._vel.x = 3;
      c._vel.z = 4;       // speed = 5
      c._applyFriction(DT);
      // scale = (5 - 0.5) / 5 = 0.9
      expect(c._vel.x).toBeCloseTo(2.7, 10);
      expect(c._vel.z).toBeCloseTo(3.6, 10);
      // Direction unchanged: 2.7/3.6 = 3/4
      expect(c._vel.x / c._vel.z).toBeCloseTo(3 / 4, 10);
    });
  });

  describe('combined accelerate + friction', () => {
    it('reaches equilibrium below wishSpeed when friction is active', () => {
      const c = buildController();
      const dir = { x: 1, z: 0 };
      // Run accelerate + friction together for many ticks.
      for (let i = 0; i < 200; i++) {
        c._applyFriction(DT);
        c._accelerate(dir, 5, 6, DT);
      }
      // Speed converges where accel gain = friction loss.
      // It should be close to wishSpeed (5) but slightly below.
      expect(c._vel.x).toBeGreaterThan(4.8);
      expect(c._vel.x).toBeLessThanOrEqual(5);
    });
  });
});
