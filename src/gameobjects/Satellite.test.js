import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Satellite } from './Satellite.js';

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

  it('scan state starts cleared', () => {
    const { root } = buildTower();
    const sat = Satellite.fromObject3D(root);
    expect(sat.scanProgress).toBe(0);
    expect(sat.scanTarget).toBeNull();
    expect(sat.isScanning).toBe(false);
  });
});
