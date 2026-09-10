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

  it('slews toward the targets no faster than maxRotationSpeed', () => {
    const { root, neck, dish } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.maxRotationSpeed = 1;               // rad/s
    sat.targetYaw   = Math.PI / 2;
    sat.targetPitch = Math.PI / 2;

    sat._update(0.5);                       // half a second → half a radian
    expect(neck.rotation.y).toBeCloseTo(0.5);
    expect(dish.rotation.x).toBeCloseTo(0.5);
  });

  it('lands exactly on the target instead of overshooting', () => {
    const { root, neck, dish } = buildTower();
    const sat = Satellite.fromObject3D(root);
    sat.maxRotationSpeed = 10;              // far faster than needed
    sat.targetYaw   = 0.3;
    sat.targetPitch = -0.7;

    sat._update(1);
    expect(neck.rotation.y).toBeCloseTo(0.3);
    expect(dish.rotation.x).toBeCloseTo(-0.7);
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
    const { root } = buildTower();
    const sat = Satellite.fromObject3D(root);
    expect(sat.isRotating()).toBe(false);   // targets start on the shipped pose

    sat.targetYaw = 1;
    expect(sat.isRotating()).toBe(true);    // and immediately reflect a new aim

    sat._update(10);                        // 10 s at π/8 rad/s covers 1 rad
    expect(sat.isRotating()).toBe(false);   // settled exactly on target
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
