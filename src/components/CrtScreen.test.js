import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { CrtScreen, CRT_NOISE, createCrtScreenMesh, RETRO_COMPUTER_SCREEN } from './CrtScreen.js';
import { createCrtMaterial } from '../shaders/CrtScreen.js';
import { EMERGENCY_LEVEL } from '../gameplay/Power.js';

describe('CrtScreen', () => {
  let material, satellite, power, disturbed, screen;

  const run = (seconds, dt = 1 / 60) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) screen.onUpdate(dt);
  };

  beforeEach(() => {
    material = createCrtMaterial();
    satellite = { scanProgress: 0, scanTarget: null, isScanning: false };
    power = { on: true, level: 1 };
    disturbed = false;
    screen = new CrtScreen({ material, satellite, power, disturbed: () => disturbed });
  });

  it("shows how far the dish's scan has got as uSignal", () => {
    satellite.scanTarget = { scanTime: 6 };
    satellite.scanProgress = 3;
    screen.onUpdate(0);
    expect(material.uniforms.uSignal.value).toBeCloseTo(0.5);
    satellite.scanProgress = 9;
    screen.onUpdate(0);
    expect(material.uniforms.uSignal.value).toBe(1);
    satellite.scanTarget = null;
    screen.onUpdate(0);
    expect(material.uniforms.uSignal.value).toBe(0);
  });

  it('dies with the power: uPower 0 once only the emergency glow is left', () => {
    screen.onUpdate(0);
    expect(material.uniforms.uPower.value).toBe(1);
    power.on = false;
    power.level = EMERGENCY_LEVEL;
    screen.onUpdate(0);
    expect(material.uniforms.uPower.value).toBe(0);
  });

  it('follows the stutter on the way down', () => {
    power.on = false;
    power.level = 0.5;
    screen.onUpdate(0);
    expect(material.uniforms.uPower.value).toBeGreaterThan(0);
    expect(material.uniforms.uPower.value).toBeLessThan(1);
  });

  it('is clean while the dish scans, and hisses with static while it sits idle', () => {
    satellite.isScanning = true;
    run(2);
    expect(material.uniforms.uNoise.value).toBeCloseTo(CRT_NOISE.scanning, 2);
    satellite.isScanning = false;
    run(2);
    expect(material.uniforms.uNoise.value).toBeCloseTo(CRT_NOISE.idle, 2);
    expect(CRT_NOISE.idle).toBeGreaterThan(CRT_NOISE.scanning);
  });

  it('breaks up while something disturbs it, or while the power is out', () => {
    satellite.isScanning = true;
    disturbed = true;
    run(2);
    expect(material.uniforms.uNoise.value).toBeCloseTo(CRT_NOISE.disturbed, 2);
    disturbed = false;
    power.on = false;
    run(2);
    expect(material.uniforms.uNoise.value).toBeCloseTo(CRT_NOISE.disturbed, 2);
  });

  it('runs its clock on uTime', () => {
    run(1.5);
    expect(material.uniforms.uTime.value).toBeCloseTo(1.5, 5);
  });

  it('writes into the same uniform objects every frame, allocating nothing', () => {
    const before = { ...material.uniforms };
    satellite.scanTarget = { scanTime: 6 };
    satellite.scanProgress = 2;
    run(0.5);
    for (const name of ['uTime', 'uSignal', 'uNoise', 'uPower']) {
      expect(material.uniforms[name]).toBe(before[name]);
    }
  });

  it('works with nothing wired up: a powered, idle screen', () => {
    screen = new CrtScreen({ material });
    expect(() => run(0.5)).not.toThrow();
    expect(material.uniforms.uPower.value).toBe(1);
    expect(material.uniforms.uSignal.value).toBe(0);
  });
});

describe('createCrtScreenMesh', () => {
  it("is a thin bent plane in front of the retro computer's glass, in the model's own units", () => {
    const material = createCrtMaterial();
    const mesh = createCrtScreenMesh(material);
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh.name).toBe('CrtScreen');
    expect(mesh.material).toBe(material);
    expect(mesh.position.toArray()).toEqual(RETRO_COMPUTER_SCREEN.position);
    expect(mesh.castShadow).toBe(false);
    // Enough vertices for the vertex shader's bulge to bend.
    expect(mesh.geometry.parameters.widthSegments).toBeGreaterThan(1);
    expect(mesh.geometry.parameters.heightSegments).toBeGreaterThan(1);
  });

  it('faces the chair: toward +Z (the kneehole side), tilted back to look up at the eye', () => {
    const mesh = createCrtScreenMesh(createCrtMaterial());
    const facing = new THREE.Vector3(0, 0, 1).applyEuler(mesh.rotation);
    expect(facing.z).toBeGreaterThan(0.8);
    expect(facing.y).toBeGreaterThan(0.4);
  });
});
