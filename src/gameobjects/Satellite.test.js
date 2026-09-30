import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Satellite, DISH_SLEW_RATE } from './Satellite.js';

/** Minimal dish-tower stand-in: Base → Neck_block → Dish, matching the node
 *  names the real GLB ships with. */
function buildTower() {
  const root = new THREE.Object3D(); root.name = 'Base';
  const neck = new THREE.Object3D(); neck.name = 'Neck_block';
  const dish = new THREE.Object3D(); dish.name = 'Dish';
  neck.add(dish);
  root.add(neck);
  return { root, neck, dish };
}

describe('Satellite', () => {
  it('wraps the model root as a Satellite and latches onto the moving parts', () => {
    const { root } = buildTower();
    const sat = Satellite.fromObject3D(root);

    expect(sat).toBeInstanceOf(Satellite);
    expect(sat.neck).toBeInstanceOf(GameObject);   // children stay plain wrappers
    expect(sat.neck.name).toBe('Neck_block');
    expect(sat.dish.name).toBe('Dish');
  });

  it('holds the pose the model shipped with until a target is set', () => {
    const { root, neck, dish } = buildTower();
    neck.rotation.y = 0.5;
    dish.rotation.x = -0.25;
    const sat = Satellite.fromObject3D(root);

    expect(sat.targetYaw).toBeCloseTo(0.5);
    expect(sat.targetPitch).toBeCloseTo(-0.25);

    sat._update(1);   // a whole second of headroom — nothing may move
    expect(neck.rotation.y).toBeCloseTo(0.5);
    expect(dish.rotation.x).toBeCloseTo(-0.25);
  });

  it('accelerates from rest instead of moving at constant rate', () => {
    const { root, neck } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.maxRotationSpeed = 2;
    sat.angularAccel = 4;     // rad/s^2
    sat.targetYaw = Math.PI;  // far away

    // First small step: velocity builds up from zero
    sat._update(0.1);
    const firstMove = neck.rotation.y;
    expect(firstMove).toBeGreaterThan(0);
    // With momentum starting from rest, initial movement is gradual
    expect(sat.velYaw).toBeGreaterThan(0);
    expect(sat.velYaw).toBeLessThan(sat.maxRotationSpeed);

    // After more time, velocity builds up
    sat._update(0.5);
    expect(neck.rotation.y).toBeGreaterThan(firstMove);
  });

  it('decelerates as it approaches the target', () => {
    const { root, neck } = buildTower();
    neck.rotation.y = 0;
    const sat = Satellite.fromObject3D(root);
    sat.maxRotationSpeed = 10;
    sat.angularAccel = 5;
    sat.angularDamping = 8;  // high damping for quick decel
    sat.targetYaw = 0.5;     // close target

    // Get it moving
    sat._update(0.2);
    const vel1 = sat.velYaw;
    expect(vel1).toBeGreaterThan(0);

    // As it nears target, velocity should decrease
    sat._update(0.2);
    const vel2 = sat.velYaw;
    // Either velocity decreased or it settled
    expect(vel2 <= vel1 || Math.abs(neck.rotation.y - 0.5) < 0.01).toBe(true);
  });

  it('clamps velocity to maxRotationSpeed', () => {
    const { root } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.maxRotationSpeed = 1;
    sat.angularAccel = 100;   // very high accel
    sat.targetYaw = Math.PI;  // far target

    sat._update(1);  // enough time to accelerate
    expect(sat.velYaw).toBeLessThanOrEqual(1 + 0.001);  // clamped to max
    expect(sat.velYaw).toBeGreaterThanOrEqual(-1 - 0.001);
  });

  it('settles near target with damping', () => {
    const { root, neck } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.maxRotationSpeed = 2;
    sat.angularAccel = 3;
    sat.angularDamping = 6;  // higher damping for faster settling
    sat.targetYaw = 1.0;

    // Run for a while — momentum causes overshoot, but damping settles it
    for (let i = 0; i < 120; i++) sat._update(1/30);  // 4 seconds

    // Should be close to target after settling
    expect(Math.abs(neck.rotation.y - 1.0)).toBeLessThan(0.15);
  });

  it('moves toward the target with momentum', () => {
    const { root, neck, dish } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.maxRotationSpeed = 2;
    sat.angularAccel = 4;
    sat.angularDamping = 3;
    sat.targetYaw   = Math.PI / 2;
    sat.targetPitch = Math.PI / 2;

    sat._update(0.5);  // dish moves toward target with momentum
    expect(neck.rotation.y).toBeGreaterThan(0);
    expect(dish.rotation.x).toBeGreaterThan(0);
    // Velocity is building up
    expect(sat.velYaw).toBeGreaterThan(0);
    expect(sat.velPitch).toBeGreaterThan(0);
  });

  it('takes the short way around the circle', () => {
    const { root, neck } = buildTower();
    neck.rotation.y = 3;                    // just shy of +π
    const sat = Satellite.fromObject3D(root);
    sat.targetYaw = -3;                     // just past −π the other way

    sat._update(0.01);                      // a small step must head toward π
    expect(neck.rotation.y).toBeGreaterThan(3);
    expect(neck.rotation.y).toBeLessThanOrEqual(3 + (Math.PI / 8) * 0.01);
  });

  it('isRotating reports false when spawned and true once a target is set', () => {
    const { root, neck } = buildTower();
    const sat = Satellite.fromObject3D(root);
    expect(sat.isRotating()).toBe(false);   // targets start on the shipped pose

    sat.targetYaw = 1;
    sat.maxRotationSpeed = 10;  // fast cap so it can reach target in time
    sat.angularAccel = 10;  // high accel for fast response
    sat.angularDamping = 10;  // high damping to prevent oscillation
    expect(sat.isRotating()).toBe(true);    // and immediately reflect a new aim

    // With momentum, the dish moves toward target and eventually settles
    for (let i = 0; i < 500; i++) sat._update(1/30);  // ~17 seconds
    // Should be close to target (within a few degrees)
    expect(Math.abs(neck.rotation.y - 1.0)).toBeLessThan(0.1);
  });

  it('isRotating is true while either axis is off target', () => {
    const { root, dish } = buildTower();
    dish.rotation.x = 0.2;
    const sat = Satellite.fromObject3D(root);
    sat.targetPitch = -0.2;                 // yaw settled, pitch not

    expect(sat.isRotating()).toBe(true);
  });

  it('isRotating treats a target one full turn away as settled', () => {
    const { root, neck } = buildTower();
    neck.rotation.y = 1;
    const sat = Satellite.fromObject3D(root);
    sat.targetYaw = 1 + Math.PI * 2;        // same heading, wrapped

    expect(sat.isRotating()).toBe(false);
  });

  // ── Gameplay helpers ─────────────────────────────────────

  it('aimAt sets both target angles', () => {
    const { root } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.aimAt(1.2, -0.4);
    expect(sat.targetYaw).toBeCloseTo(1.2);
    expect(sat.targetPitch).toBeCloseTo(-0.4);
  });

  it('getAimError returns 0 when on target', () => {
    const { root, neck, dish } = buildTower();
    neck.rotation.y = 0.5;
    dish.rotation.x = -0.3;
    const sat = Satellite.fromObject3D(root);
    expect(sat.getAimError(0.5, -0.3)).toBeCloseTo(0);
  });

  it('getAimError returns combined angular distance', () => {
    const { root, neck, dish } = buildTower();
    neck.rotation.y = 0;
    dish.rotation.x = 0;
    const sat = Satellite.fromObject3D(root);
    // yaw error = 0.3, pitch error = 0.4, combined = 0.5 (Pythagorean)
    const error = sat.getAimError(0.3, 0.4);
    expect(error).toBeCloseTo(0.5);
  });

  it('isAimedAt returns true within tolerance and false outside', () => {
    const { root, neck, dish } = buildTower();
    neck.rotation.y = 0;
    dish.rotation.x = 0;
    const sat = Satellite.fromObject3D(root);

    expect(sat.isAimedAt(0.01, 0.01, 0.1)).toBe(true);   // tiny error < 0.1
    expect(sat.isAimedAt(1.0, 1.0, 0.1)).toBe(false);     // large error > 0.1
  });

  // ── Default tuning — how the dish feels in the minigame ───
  // These use the shipped constants, not per-test overrides: they pin the
  // pace a player actually waits through while the dish chases the cursor.

  /** Step at 60 fps until both axes have stayed within 1° of target for a
   *  full second; returns the time that settled run began. */
  function timeToSettle(sat, neck, dish, maxSeconds = 20) {
    const DT = 1 / 60, ONE_DEG = Math.PI / 180;
    let settledAt = null;
    for (let t = 0; t < maxSeconds; t += DT) {
      sat._update(DT);
      const onTarget = Math.abs(neck.rotation.y - sat.targetYaw) < ONE_DEG
                    && Math.abs(dish.rotation.x - sat.targetPitch) < ONE_DEG;
      if (!onTarget) settledAt = null;
      else if (settledAt === null) settledAt = t;
      else if (t - settledAt >= 1) return settledAt;
    }
    return Infinity;
  }

  it('swings round to face the opposite sky within 10 s', () => {
    const { root, neck, dish } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.aimAt(Math.PI * 0.99, 0);
    expect(timeToSettle(sat, neck, dish)).toBeLessThanOrEqual(10);
  });

  it('takes its time over a half turn — heavy, not twitchy (at least 8 s)', () => {
    const { root, neck, dish } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.aimAt(Math.PI * 0.99, 0);
    expect(timeToSettle(sat, neck, dish)).toBeGreaterThanOrEqual(8);
  });

  it('slews at DISH_SLEW_RATE, 22.5°/s, by default', () => {
    const { root } = buildTower();
    const sat = Satellite.fromObject3D(root);
    expect(DISH_SLEW_RATE).toBeCloseTo(Math.PI / 8);
    expect(sat.maxRotationSpeed).toBe(DISH_SLEW_RATE);
  });

  it('makes a small correction in under a second', () => {
    const { root, neck, dish } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.aimAt(12 * Math.PI / 180, -12 * Math.PI / 180);
    expect(timeToSettle(sat, neck, dish)).toBeLessThan(1);
  });

  it('comes to rest without swinging past the target', () => {
    const { root, neck } = buildTower();
    const sat = Satellite.fromObject3D(root);
    const target = Math.PI / 2;
    sat.targetYaw = target;
    let furthest = 0;
    for (let i = 0; i < 600; i++) {
      sat._update(1 / 60);
      furthest = Math.max(furthest, neck.rotation.y);
    }
    expect(furthest - target).toBeLessThan(Math.PI / 180);   // < 1° overshoot
  });

  it('still looks like heavy machinery — never snaps faster than 60°/s', () => {
    const { root, neck } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.targetYaw = Math.PI * 0.99;
    let prev = neck.rotation.y, fastest = 0;
    for (let i = 0; i < 300; i++) {
      sat._update(1 / 60);
      fastest = Math.max(fastest, (neck.rotation.y - prev) * 60);
      prev = neck.rotation.y;
    }
    expect(fastest).toBeLessThanOrEqual(Math.PI / 3 + 1e-9);
  });

  it('scan state starts cleared', () => {
    const { root } = buildTower();
    const sat = Satellite.fromObject3D(root);
    expect(sat.scanProgress).toBe(0);
    expect(sat.scanTarget).toBeNull();
    expect(sat.isScanning).toBe(false);
  });
});

describe('Satellite power', () => {
  it('is powered to begin with', () => {
    expect(Satellite.fromObject3D(buildTower().root).powered).toBe(true);
  });

  it('with the power cut it stops dead where it is, and keeps its target', () => {
    const { root, neck } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.targetYaw = Math.PI / 2;
    sat._update(0.5);
    const where = neck.rotation.y;
    expect(sat.velYaw).toBeGreaterThan(0);

    sat.powered = false;
    for (let i = 0; i < 60; i++) sat._update(1 / 60);
    expect(neck.rotation.y).toBe(where);
    expect(sat.velYaw).toBe(0);
    expect(sat.targetYaw).toBe(Math.PI / 2);
  });

  it('picks the slew back up when the power returns', () => {
    const { root, neck } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.targetYaw = Math.PI / 2;
    sat.powered = false;
    sat._update(1);
    expect(neck.rotation.y).toBe(0);
    sat.powered = true;
    for (let i = 0; i < 600; i++) sat._update(1 / 60);
    expect(neck.rotation.y).toBeCloseTo(Math.PI / 2, 2);
  });

  it('a scan stops with the power, keeping the progress it had', () => {
    const { root } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.scanTarget = { yaw: 0, pitch: 0, tolerance: 0.2, scanTime: 5, scanned: false };
    sat.isScanning = true;
    sat._update(1);
    expect(sat.scanProgress).toBeCloseTo(1);
    sat.powered = false;
    sat._update(1);
    expect(sat.isScanning).toBe(false);
    expect(sat.scanProgress).toBeCloseTo(1);
    expect(sat.scanTarget.scanned).toBe(false);
  });
});
