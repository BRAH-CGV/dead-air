import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { DustClouds, DustCloudsMotion, CLOUDS, windDrift } from './DustClouds.js';
import { WIND_DIRECTION } from '../gameplay/Sandstorm.js';

// ─────────────────────────────────────────────
// DustClouds — low billowing dust drifting past outside, thickening in a storm
// ─────────────────────────────────────────────
// Wiring and the CPU side only; how the shaders paint is checked by eye.

const motionOf = (clouds) => clouds.getComponent(DustCloudsMotion);
const u = (clouds) => clouds.mesh.material.uniforms;

/** Run the motion `seconds` with the camera at `at`. */
function run(clouds, seconds, at = new THREE.Vector3(0, 1.2, 10), step = 0.05) {
  const motion = motionOf(clouds);
  for (let t = 0; t < seconds - 1e-9; t += step) motion.advance(step, at);
}

describe('windDrift', () => {
  it('carries everything downwind along the one wind axis', () => {
    const a = windDrift(0, new THREE.Vector2());
    const b = windDrift(20, new THREE.Vector2());
    const d = b.clone().sub(a).normalize();
    expect(d.x).toBeCloseTo(WIND_DIRECTION[0], 2);
    expect(d.y).toBeCloseTo(WIND_DIRECTION[1], 2);
  });

  it('gusts: it covers ground unevenly through a gust cycle', () => {
    const step = CLOUDS.gustPeriod / 8;
    const runs = [];
    for (let i = 0; i < 8; i++) {
      runs.push(windDrift((i + 1) * step, new THREE.Vector2()).distanceTo(windDrift(i * step, new THREE.Vector2())));
    }
    expect(Math.max(...runs)).toBeGreaterThan(Math.min(...runs) * 1.4);
    // Never blowing backward.
    expect(Math.min(...runs)).toBeGreaterThan(0);
  });
});

describe('DustClouds', () => {
  it('is one mesh — one draw call — holding a quad for every cloud it may ever need', () => {
    const clouds = new DustClouds();
    const { mesh } = clouds;
    expect(mesh.isMesh).toBe(true);
    expect(mesh.geometry.getAttribute('position').count).toBe(CLOUDS.storm.count * 4);
    expect(mesh.geometry.index.count).toBe(CLOUDS.storm.count * 6);
    expect(mesh.material.isShaderMaterial).toBe(true);
    expect(mesh.material.transparent).toBe(true);
    expect(mesh.material.depthWrite).toBe(false);
    expect(mesh.material.fog).toBe(false);
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.castShadow).toBe(false);
  });

  it('cuts its billows from a small tiling noise texture made at load', () => {
    const clouds = new DustClouds();
    const tex = u(clouds).uNoise.value;
    expect(tex.isDataTexture).toBe(true);
    expect(tex.image.width).toBe(64);
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.wrapT).toBe(THREE.RepeatWrapping);
  });

  it('calm: a rare few, faint, and blended into the night', () => {
    const clouds = new DustClouds();
    run(clouds, 0.1);
    expect(CLOUDS.calm.count).toBeGreaterThan(0);
    expect(CLOUDS.calm.count).toBeLessThanOrEqual(20);
    expect(clouds.mesh.geometry.drawRange.count).toBe(CLOUDS.calm.count * 6);
    expect(clouds.mesh.visible).toBe(true);
    expect(u(clouds).uOpacity.value).toBeLessThanOrEqual(0.2);
    // Mostly the fog's own colour: they blend in rather than stand out.
    expect(u(clouds).uBlend.value).toBeGreaterThan(0.4);
    expect(u(clouds).uSizeScale.value.toArray()).toEqual([1, 1]);
  });

  it('a storm brings out their own colour', () => {
    const clouds = new DustClouds();
    motionOf(clouds).setStorm(1);
    run(clouds, CLOUDS.storm.ramp + 0.2);
    expect(u(clouds).uBlend.value).toBeCloseTo(CLOUDS.storm.blend);
    expect(CLOUDS.storm.blend).toBeLessThan(CLOUDS.calm.blend);
  });

  it('in a storm: more, bigger, thicker, faster, and closer to the walls and the player', () => {
    const clouds = new DustClouds();
    motionOf(clouds).setStorm(1);
    run(clouds, CLOUDS.storm.ramp + 0.2);
    const uni = u(clouds);
    expect(clouds.mesh.geometry.drawRange.count).toBe(CLOUDS.storm.count * 6);
    expect(uni.uOpacity.value).toBeCloseTo(CLOUDS.storm.opacity);
    expect(uni.uSizeScale.value.x).toBeCloseTo(CLOUDS.storm.width);
    expect(uni.uSizeScale.value.y).toBeCloseTo(CLOUDS.storm.height);
    expect(uni.uClearance.value).toBeCloseTo(CLOUDS.storm.clearance);
    expect(uni.uNear.value.toArray()).toEqual(CLOUDS.storm.near);
    expect(motionOf(clouds).storm).toBeCloseTo(1);
  });

  it('eases into a storm rather than snapping', () => {
    const clouds = new DustClouds();
    motionOf(clouds).setStorm(1);
    run(clouds, CLOUDS.storm.ramp * 0.3);
    const k = motionOf(clouds).storm;
    expect(k).toBeGreaterThan(0);
    expect(k).toBeLessThan(1);
  });

  it('moves faster through a storm: its clock runs quicker', () => {
    const calm = new DustClouds();
    const storm = new DustClouds();
    motionOf(storm).setStorm(1);
    run(storm, CLOUDS.storm.ramp + 0.2);
    const t0 = u(storm).uTime.value;
    run(calm, 1);
    run(storm, 1);
    expect(u(storm).uTime.value - t0).toBeCloseTo(CLOUDS.storm.speed, 1);
    expect(u(calm).uTime.value).toBeCloseTo(1, 1);
  });

  it('keeps its scatter on the camera, and the drift on the wind', () => {
    const clouds = new DustClouds();
    run(clouds, 2, new THREE.Vector3(5, 1.2, -3));
    expect(u(clouds).uCamera.value.toArray()).toEqual([5, 1.2, -3]);
    expect(u(clouds).uDrift.value.length()).toBeGreaterThan(0);
  });

  it('rust at night, pale dust by day', () => {
    const clouds = new DustClouds();
    const motion = motionOf(clouds);
    motion.setDaylight(0);
    run(clouds, 0.05);
    expect(u(clouds).uColor.value.getHex()).toBe(new THREE.Color(CLOUDS.nightColor).getHex());
    motion.setDaylight(1);
    run(clouds, 0.05);
    expect(u(clouds).uColor.value.getHex()).toBe(new THREE.Color(CLOUDS.dayColor).getHex());
  });

  it('sinks into the scene fog like everything else, following it as it thickens', () => {
    const fog = new THREE.FogExp2(0x5a3f2c, 0.06);
    const clouds = new DustClouds({ fog });
    run(clouds, 0.05);
    expect(u(clouds).uFogDensity.value).toBe(0.06);
    expect(u(clouds).uFogColor.value.getHex()).toBe(0x5a3f2c);
    fog.density = 0.02;
    run(clouds, 0.05);
    expect(u(clouds).uFogDensity.value).toBe(0.02);
  });

  it('stays out of the building: cut out of every room, and dropped near its walls', () => {
    const clouds = new DustClouds();
    const rooms = [new THREE.Box3(new THREE.Vector3(-6, 0, -5), new THREE.Vector3(6, 3, 5))];
    clouds.setBuilding(rooms);
    const uni = u(clouds);
    expect(uni.uCutoutCount.value).toBe(1);
    expect(uni.uCutoutMin.value[0].toArray()).toEqual([-6, 0, -5]);
    expect(uni.uFootprint.value.toArray()).toEqual([-6, -5, 6, 5]);
    expect(clouds.mesh.material.vertexShader).toMatch(/uFootprint/);
    expect(clouds.mesh.material.fragmentShader).toMatch(/uCutoutMin/);
  });

  it('frees what it built', () => {
    const clouds = new DustClouds();
    let freed = 0;
    for (const r of [clouds.mesh.geometry, clouds.mesh.material, u(clouds).uNoise.value]) {
      r.addEventListener('dispose', () => freed++);
    }
    clouds.dispose();
    expect(freed).toBe(3);
  });
});
