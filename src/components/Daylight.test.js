import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Daylight, dawnFactor } from './Daylight.js';
import { createMarsSky } from '../gameobjects/MarsSky.js';

// ─────────────────────────────────────────────
// dawnFactor — how far into the day it is, 0 … 1
// ─────────────────────────────────────────────

describe('dawnFactor', () => {
  it('is full night for most of the shift', () => {
    for (const hour of [0, 1, 3, 4.99]) {
      expect(dawnFactor(hour, 'playing')).toBe(0);
    }
  });

  it('rises through the last hour, 5 → 6 AM, without jumping', () => {
    expect(dawnFactor(5.5, 'playing')).toBeCloseTo(0.5);

    let prev = 0;
    for (let hour = 5; hour <= 6; hour += 0.05) {
      const f = dawnFactor(hour, 'playing');
      expect(f).toBeGreaterThanOrEqual(prev);
      expect(f - prev).toBeLessThan(0.1);
      prev = f;
    }
    expect(dawnFactor(6, 'playing')).toBe(1);
  });

  it('holds at full day all morning, and after the last shift', () => {
    expect(dawnFactor(6, 'morning')).toBe(1);
    expect(dawnFactor(0, 'morning')).toBe(1);
    expect(dawnFactor(0, 'finished')).toBe(1);
  });

  it('is day at 6 AM after a failed night too — the Sun rises either way', () => {
    expect(dawnFactor(6, 'gameOver')).toBe(1);
  });

  it('follows a shift that ends at a different hour', () => {
    expect(dawnFactor(4.5, 'playing', { endHour: 5 })).toBeCloseTo(0.5);
    expect(dawnFactor(4.5, 'playing')).toBe(0);
  });
});

// ─────────────────────────────────────────────
// Daylight — applies the factor to the scene
// ─────────────────────────────────────────────

describe('Daylight', () => {
  let controller, sky, ambient, sun, fog, daylight;

  beforeEach(() => {
    controller = { state: 'playing', nightClock: { currentTime: 0, endHour: 6 } };
    sky        = createMarsSky({ starCount: 10 });
    ambient    = new THREE.AmbientLight(0x435472, 0.72);
    sun        = new THREE.DirectionalLight(0xd4d4d4, 0.8);
    fog        = new THREE.FogExp2(0x1f2a38, 0.02);
    daylight   = new Daylight({ controller, sky, ambient, sun, fog });
  });

  const at = (hour, state = 'playing') => {
    controller.nightClock.currentTime = hour;
    controller.state = state;
    daylight.onUpdate(0.016);
  };

  it('leaves the night alone while it is night', () => {
    at(3);
    expect(sky.skyUniforms.uDawn.value).toBe(0);
    expect(ambient.intensity).toBe(0.72);
    expect(sun.intensity).toBe(0.8);
    expect(fog.color.getHex()).toBe(0x1f2a38);
  });

  it('drives the sky shader uniform from the clock', () => {
    at(5.5);
    expect(sky.skyUniforms.uDawn.value).toBeCloseTo(0.5);
    at(6, 'morning');
    expect(sky.skyUniforms.uDawn.value).toBe(1);
  });

  it('brightens the ambient and the sun light for the day', () => {
    at(6, 'morning');
    expect(ambient.intensity).toBeGreaterThan(0.72);
    expect(sun.intensity).toBeGreaterThan(0.8);
  });

  it('warms the light: day light is redder than blue, unlike the cool night', () => {
    at(6, 'morning');
    expect(ambient.color.r).toBeGreaterThan(ambient.color.b);
    expect(sun.color.r).toBeGreaterThan(sun.color.b);
  });

  it('turns the fog to the day horizon, so the terrain still fades into the sky', () => {
    at(6, 'morning');
    expect(fog.color.getHex()).toBe(sky.skyUniforms.uDayHorizonColor.value.getHex());
  });

  it('is part-way there part-way through the dawn', () => {
    at(5.5);
    expect(ambient.intensity).toBeGreaterThan(0.72);
    at(6, 'morning');
    const full = ambient.intensity;
    at(5.5);
    expect(ambient.intensity).toBeLessThan(full);
  });

  it('goes back to exactly the night it started from when the next shift begins', () => {
    at(6, 'morning');
    at(0);                                   // slept — the next night starts
    expect(sky.skyUniforms.uDawn.value).toBe(0);
    expect(ambient.intensity).toBe(0.72);
    expect(ambient.color.getHex()).toBe(0x435472);
    expect(sun.intensity).toBe(0.8);
    expect(sun.color.getHex()).toBe(0xd4d4d4);
    expect(fog.color.getHex()).toBe(0x1f2a38);
  });

  it('takes its day targets as options', () => {
    daylight = new Daylight({
      controller, sky, ambient, sun, fog,
      day: { ambientIntensity: 3, sunIntensity: 4, fogColor: 0x112233 },
    });
    at(6, 'morning');
    expect(ambient.intensity).toBe(3);
    expect(sun.intensity).toBe(4);
    expect(fog.color.getHex()).toBe(0x112233);
  });

  it('works with only some of the pieces — no sky, no fog, no lights', () => {
    const bare = new Daylight({ controller });
    controller.state = 'morning';
    expect(() => bare.onUpdate(0.016)).not.toThrow();
    expect(bare.factor).toBe(1);
  });

  it('does nothing without a clock to read', () => {
    const idle = new Daylight({ controller: { state: 'idle', nightClock: null }, ambient });
    expect(() => idle.onUpdate(0.016)).not.toThrow();
    expect(ambient.intensity).toBe(0.72);
  });
});
