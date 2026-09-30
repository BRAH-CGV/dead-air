import { describe, it, expect } from 'vitest';
import {
  DishRig,
  createDefaultNeighbourDishes,
  DISH_SLEW_RATE,
  angleDelta,
  SETTLED_EPSILON,
} from './DishRig.js';

describe('DishRig', () => {
  // ── Physics parity with Satellite (ported headless) ──────

  it('holds its starting aim until a target is set', () => {
    const rig = new DishRig({ currentYaw: 0.5, currentPitch: -0.25 });

    expect(rig.targetYaw).toBeCloseTo(0.5);
    expect(rig.targetPitch).toBeCloseTo(-0.25);

    rig.update(1);   // a whole second of headroom — nothing may move
    expect(rig.currentYaw).toBeCloseTo(0.5);
    expect(rig.currentPitch).toBeCloseTo(-0.25);
  });

  it('accelerates from rest instead of moving at constant rate', () => {
    const rig = new DishRig();
    rig.maxRotationSpeed = 2;
    rig.angularAccel = 4;
    rig.targetYaw = Math.PI;

    rig.update(0.1);
    expect(rig.currentYaw).toBeGreaterThan(0);
    expect(rig.velYaw).toBeGreaterThan(0);
    expect(rig.velYaw).toBeLessThan(rig.maxRotationSpeed);

    rig.update(0.5);
    expect(rig.velYaw).toBeGreaterThan(0);
  });

  it('clamps velocity to maxRotationSpeed', () => {
    const rig = new DishRig();
    rig.maxRotationSpeed = 1;
    rig.angularAccel = 100;
    rig.targetYaw = Math.PI;

    rig.update(1);
    expect(rig.velYaw).toBeLessThanOrEqual(1 + 0.001);
    expect(rig.velYaw).toBeGreaterThanOrEqual(-1 - 0.001);
  });

  it('settles near target with damping', () => {
    const rig = new DishRig();
    rig.maxRotationSpeed = 2;
    rig.angularAccel = 3;
    rig.angularDamping = 6;
    rig.targetYaw = 1.0;

    for (let i = 0; i < 120; i++) rig.update(1 / 30);  // 4 seconds

    expect(Math.abs(rig.currentYaw - 1.0)).toBeLessThan(0.15);
  });

  it('moves both axes with momentum', () => {
    const rig = new DishRig();
    rig.maxRotationSpeed = 2;
    rig.angularAccel = 4;
    rig.angularDamping = 3;
    rig.targetYaw   = Math.PI / 2;
    rig.targetPitch = Math.PI / 2;

    rig.update(0.5);
    expect(rig.currentYaw).toBeGreaterThan(0);
    expect(rig.currentPitch).toBeGreaterThan(0);
    expect(rig.velYaw).toBeGreaterThan(0);
    expect(rig.velPitch).toBeGreaterThan(0);
  });

  it('takes the short way around the circle', () => {
    const rig = new DishRig({ currentYaw: 3 });
    rig.targetYaw = -3;                      // just past −π the other way

    rig.update(0.01);                        // a small step must head toward π
    expect(rig.currentYaw).toBeGreaterThan(3);
    expect(rig.currentYaw).toBeLessThanOrEqual(3 + (Math.PI / 8) * 0.01);
  });

  it('isRotating reports false when settled and true once a target is set', () => {
    const rig = new DishRig();
    expect(rig.isRotating()).toBe(false);    // targets start on the current pose

    rig.targetYaw = 1;
    expect(rig.isRotating()).toBe(true);
  });

  it('isRotating is true while either axis is off target', () => {
    const rig = new DishRig({ currentPitch: 0.2 });
    rig.targetPitch = -0.2;                  // yaw settled, pitch not

    expect(rig.isRotating()).toBe(true);
  });

  it('isRotating treats a target one full turn away as settled', () => {
    const rig = new DishRig({ currentYaw: 1 });
    rig.targetYaw = 1 + Math.PI * 2;         // same heading, wrapped

    expect(rig.isRotating()).toBe(false);
  });

  it('comes to rest without swinging past the target', () => {
    const rig = new DishRig();
    const target = Math.PI / 2;
    rig.targetYaw = target;
    let furthest = 0;
    for (let i = 0; i < 600; i++) {
      rig.update(1 / 60);
      furthest = Math.max(furthest, rig.currentYaw);
    }
    expect(furthest - target).toBeLessThan(Math.PI / 180);   // < 1° overshoot
  });

  // ── Aim queries ──────────────────────────────────────────

  it('aimAt sets both target angles', () => {
    const rig = new DishRig();
    rig.aimAt(1.2, -0.4);
    expect(rig.targetYaw).toBeCloseTo(1.2);
    expect(rig.targetPitch).toBeCloseTo(-0.4);
  });

  it('getAimError returns combined angular distance', () => {
    const rig = new DishRig();
    // yaw error = 0.3, pitch error = 0.4, combined = 0.5 (Pythagorean)
    expect(rig.getAimError(0.3, 0.4)).toBeCloseTo(0.5);
  });

  it('isAimedAt returns true within tolerance and false outside', () => {
    const rig = new DishRig();
    expect(rig.isAimedAt(0.01, 0.01, 0.1)).toBe(true);
    expect(rig.isAimedAt(1.0, 1.0, 0.1)).toBe(false);
  });

  // ── Coverage ─────────────────────────────────────────────

  it('covers() is true inside the radius, false outside, inclusive on the boundary', () => {
    const rig = new DishRig({ originYaw: 0, originPitch: -0.5, coverageRadius: 0.65 });

    expect(rig.covers(0, -0.5)).toBe(true);              // dead centre
    expect(rig.covers(0.6, -0.5)).toBe(true);            // inside on yaw alone
    expect(rig.covers(0, -0.5 + 0.6)).toBe(true);        // inside on pitch alone
    expect(rig.covers(1.0, -0.5)).toBe(false);           // outside
    expect(rig.covers(0, 0.5)).toBe(false);              // outside
  });

  it('covers() wraps yaw around ±π', () => {
    const rig = new DishRig({ originYaw: Math.PI - 0.1, originPitch: 0, coverageRadius: 0.5 });

    expect(rig.covers(-Math.PI + 0.1, 0)).toBe(true);    // across the wrap seam
  });

  it('an infinite coverageRadius covers the whole hemisphere (the local dish)', () => {
    const rig = new DishRig({ coverageRadius: Infinity });

    expect(rig.covers(-Math.PI, 0)).toBe(true);
    expect(rig.covers(Math.PI, -Math.PI / 2)).toBe(true);
    expect(rig.covers(2.4, -1.1)).toBe(true);
  });

  // ── Default tuning ───────────────────────────────────────

  it('defaults to the same tuning as the local dish', () => {
    const rig = new DishRig();
    expect(DISH_SLEW_RATE).toBeCloseTo(Math.PI / 8);
    expect(rig.maxRotationSpeed).toBe(DISH_SLEW_RATE);
    expect(rig.angularAccel).toBeCloseTo(25.0);
    expect(rig.angularDamping).toBeCloseTo(10.0);
  });

  // ── Neighbour layout ─────────────────────────────────────

  it('creates six neighbour dishes, each aimed at its own origin', () => {
    const neighbours = createDefaultNeighbourDishes();

    expect(neighbours).toHaveLength(6);
    for (const rig of neighbours) {
      expect(rig).toBeInstanceOf(DishRig);
      expect(rig.currentYaw).toBeCloseTo(rig.originYaw);
      expect(rig.currentPitch).toBeCloseTo(rig.originPitch);
      expect(rig.targetYaw).toBeCloseTo(rig.originYaw);
      expect(rig.targetPitch).toBeCloseTo(rig.originPitch);
      expect(rig.isRotating()).toBe(false);
      expect(Number.isFinite(rig.coverageRadius)).toBe(true);
    }
  });

  it('spreads the neighbour origins evenly in yaw and overlaps adjacent sections', () => {
    const neighbours = createDefaultNeighbourDishes();
    const spacing = (2 * Math.PI) / neighbours.length;

    // Sorted yaw gaps are all the even spacing, including across the seam.
    const yaws = neighbours.map(r => r.originYaw).sort((a, b) => a - b);
    for (let i = 0; i < yaws.length; i++) {
      const next = yaws[(i + 1) % yaws.length];
      const gap = angleDelta(yaws[i], next);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeCloseTo(spacing, 1);
    }

    // Each neighbour covers its own origin…
    for (const rig of neighbours) {
      expect(rig.covers(rig.originYaw, rig.originPitch)).toBe(true);
      // …and reaches a neighbouring origin's yaw ring, so sections overlap.
      expect(rig.covers(rig.originYaw + spacing - rig.coverageRadius + 0.01, rig.originPitch))
        .toBe(true);
    }
  });
});

describe('angleDelta', () => {
  it('returns the shortest signed difference, wrapped into ±π', () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(angleDelta(0, -Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    expect(angleDelta(3, -3)).toBeCloseTo(angleDelta(3, 3 + 2 * (Math.PI - 3)));  // -3 ≡ 3.28 wrapped
    expect(angleDelta(1, 1 + 2 * Math.PI)).toBeCloseTo(0);                        // a full turn away = no delta
    expect(SETTLED_EPSILON).toBeCloseTo(0.05);
  });
});
