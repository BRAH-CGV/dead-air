import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { BaseLights, DARK_LEVEL } from './BaseLights.js';

describe('BaseLights', () => {
  let lights, lamp, spot, fixture, lamp2;

  beforeEach(() => {
    lamp = new THREE.PointLight(0xffffff, 14);
    spot = new THREE.PointLight(0xffffff, 0.9);
    fixture = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ emissive: 0xffc36b, emissiveIntensity: 1.8 }));
    lamp2 = new THREE.PointLight(0xffffff, 6);
    lights = new BaseLights();
    lights.register([lamp, spot, fixture]);
  });

  it('starts at the intensities the rooms were built with', () => {
    expect(lights.level).toBe(1);
    expect(lamp.intensity).toBe(14);
    expect(fixture.material.emissiveIntensity).toBe(1.8);
    expect(lights.has(lamp)).toBe(true);
    expect(lights.has(fixture)).toBe(true);
    expect(lights.has(lamp2)).toBe(false);
  });

  it('factors multiply, on lights and glowing fixtures alike', () => {
    lights.setFactor('power', 0.5);
    lights.setFactor('fatigue', 0.5);
    expect(lights.level).toBe(0.25);
    expect(lamp.intensity).toBeCloseTo(3.5);
    expect(spot.intensity).toBeCloseTo(0.225);
    expect(fixture.material.emissiveIntensity).toBeCloseTo(0.45);
    expect(lights.getFactor('power')).toBe(0.5);
    expect(lights.getFactor('threat')).toBe(1);
  });

  it('puts the base values back exactly once every factor is 1 again', () => {
    lights.setFactor('power', 0.08);
    lights.setFactor('fatigue', 0.63);
    lights.setFactor('power', 1);
    lights.setFactor('fatigue', 1);
    expect(lamp.intensity).toBe(14);
    expect(spot.intensity).toBe(0.9);
    expect(fixture.material.emissiveIntensity).toBe(1.8);
  });

  it('a light registered late takes the factors already set', () => {
    lights.setFactor('power', 0.5);
    lights.register([lamp2]);
    expect(lamp2.intensity).toBe(3);
    lights.setFactor('power', 1);
    expect(lamp2.intensity).toBe(6);
  });

  it('counts each light and each shared material once', () => {
    const twin = new THREE.Mesh(fixture.geometry, fixture.material);
    lights.register([lamp, twin]);
    lights.setFactor('power', 0.5);
    expect(lamp.intensity).toBe(7);
    expect(fixture.material.emissiveIntensity).toBeCloseTo(0.9);
  });

  it('never goes negative', () => {
    lights.setFactor('power', -1);
    expect(lamp.intensity).toBe(0);
  });

  it('is dark below a quarter of full', () => {
    expect(lights.dark).toBe(false);
    lights.setFactor('power', DARK_LEVEL - 0.01);
    expect(lights.dark).toBe(true);
    lights.setFactor('power', 0.08);
    expect(lights.dark).toBe(true);
  });

  it('restore() hands every base value back and forgets the lights', () => {
    lights.setFactor('power', 0.08);
    lights.restore();
    expect(lamp.intensity).toBe(14);
    expect(fixture.material.emissiveIntensity).toBe(1.8);
    lights.setFactor('power', 0.5);
    expect(lamp.intensity).toBe(14);
  });
});
