import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { DustStorm, DUST } from './DustStorm.js';

// ─────────────────────────────────────────────
// DustStorm — the grit streaming past the player in a sandstorm
// ─────────────────────────────────────────────

describe('DustStorm', () => {
  it('is one point cloud drawn by a custom shader, never culled or shadowed', () => {
    const dust = new DustStorm();
    const points = dust.points;
    expect(points.isPoints).toBe(true);
    expect(points.geometry.getAttribute('position').count).toBe(DUST.count);
    expect(points.geometry.getAttribute('aSeed').count).toBe(DUST.count);
    expect(points.material.isShaderMaterial).toBe(true);
    expect(points.material.vertexShader).toMatch(/uTime/);
    expect(points.material.fragmentShader).toMatch(/uLevel/);
    expect(points.frustumCulled).toBe(false);
    expect(points.castShadow).toBe(false);
  });

  it('is undrawn while calm, drawn while it blows', () => {
    const dust = new DustStorm();
    expect(dust.points.visible).toBe(false);
    dust.setLevel(0.5);
    expect(dust.points.visible).toBe(true);
    expect(dust.points.material.uniforms.uLevel.value).toBe(0.5);
    dust.setLevel(0);
    expect(dust.points.visible).toBe(false);
  });

  it('blows along the storm\'s wind, horizontally', () => {
    const dust = new DustStorm();
    dust.setWind(Math.PI / 2, 10);
    const wind = dust.points.material.uniforms.uWind.value;
    expect(wind.length()).toBeCloseTo(10);
    expect(wind.y).toBe(0);
  });

  it('keeps its box on the player and its clock running while it blows', () => {
    const dust = new DustStorm();
    dust.setLevel(1);
    dust.tick(0.5, new THREE.Vector3(3, 1, -4));
    const u = dust.points.material.uniforms;
    expect(u.uCenter.value.toArray()).toEqual([3, 1, -4]);
    expect(u.uTime.value).toBeCloseTo(0.5);
  });

  it('does no work while calm', () => {
    const dust = new DustStorm();
    dust.tick(0.5, new THREE.Vector3(3, 1, -4));
    expect(dust.points.material.uniforms.uTime.value).toBe(0);
  });

  it('is cut out of the building, so grains only blow past the windows, never through the rooms', () => {
    const dust = new DustStorm();
    const boxes = [
      new THREE.Box3(new THREE.Vector3(-6, 0, -5), new THREE.Vector3(6, 3, 5)),
      new THREE.Box3(new THREE.Vector3(6, 0, -1), new THREE.Vector3(12, 3, 1)),
    ];
    dust.setCutouts(boxes);
    const u = dust.points.material.uniforms;
    expect(u.uCutoutCount.value).toBe(2);
    expect(u.uCutoutMin.value[1].toArray()).toEqual([6, 0, -1]);
    expect(u.uCutoutMax.value[0].toArray()).toEqual([6, 3, 5]);
    expect(dust.points.material.vertexShader).toMatch(/uCutoutMin/);
  });

  it('frees its own geometry and material', () => {
    const dust = new DustStorm();
    let freed = 0;
    dust.points.geometry.addEventListener('dispose', () => freed++);
    dust.points.material.addEventListener('dispose', () => freed++);
    dust.dispose();
    expect(freed).toBe(2);
  });
});
