import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { WindowSand, WINDOW_SAND, windowDistance, sandLevel } from './WindowSand.js';
import { GameObject } from '../core/GameObject.js';
import { ASSETS, PRELOAD } from '../assets/manifest.js';

// ─────────────────────────────────────────────
// Built by hand: a window as the plain rectangle the scene hands out, a
// storm that is just a number, and a sound with THREE.Audio's surface.
// ─────────────────────────────────────────────

/** A window 8 m wide, from 0.5 m to 2.5 m up, in the wall at z = -5. */
const WIN = { x0: -4, x1: 4, z: -5, sill: 0.5, top: 2.5 };
const at = (x, y, z) => new THREE.Vector3(x, y, z);

function fakeSound() {
  const sound = {
    isPlaying: false,
    volume: 1,
    play: vi.fn(() => { sound.isPlaying = true; }),
    stop: vi.fn(() => { sound.isPlaying = false; }),
    setVolume: vi.fn((v) => { sound.volume = v; }),
    disconnect: vi.fn(),
  };
  return sound;
}

function build({ storm = 1, ear = at(0, 1.2, -4), inside = true, sound = fakeSound() } = {}) {
  const state = { storm, ear, inside };
  const go = new GameObject('Ambience');
  const sand = go.addComponent(new WindowSand({
    window: WIN,
    storm: () => state.storm,
    listenerPosition: out => out.copy(state.ear),
    isInside: () => state.inside,
    sound,
  }));
  sand.onStart();
  return { sand, sound, state };
}

const run = (sand, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) sand.onUpdate(1 / 60); };
const { near, far, volume } = WINDOW_SAND;

describe('windowDistance', () => {
  it('is how far you stand from the glass, anywhere in front of it', () => {
    expect(windowDistance(at(0, 1.2, -2), WIN)).toBeCloseTo(3);
    expect(windowDistance(at(3.5, 2, -4), WIN)).toBeCloseTo(1);
    expect(windowDistance(at(0, 1.2, -5), WIN)).toBeCloseTo(0);
  });

  it('is measured to the nearest edge from off to one side', () => {
    // 3 m past the right-hand end and 4 m back: a 3-4-5 triangle.
    expect(windowDistance(at(7, 1.2, -1), WIN)).toBeCloseTo(5);
  });

  it('counts height too: crouched under the sill is a little further', () => {
    expect(windowDistance(at(0, 0.1, -5), WIN)).toBeCloseTo(0.4);
    expect(windowDistance(at(0, 3.5, -5), WIN)).toBeCloseTo(1);
  });

  it('is the same from either side of the glass', () => {
    expect(windowDistance(at(0, 1.2, -8), WIN)).toBeCloseTo(3);
  });
});

describe('sandLevel', () => {
  it('is full at the glass and gone across the room', () => {
    expect(sandLevel(0)).toBe(1);
    expect(sandLevel(near)).toBe(1);
    expect(sandLevel(far)).toBe(0);
    expect(sandLevel(far + 5)).toBe(0);
  });

  it('rises all the way in as you walk toward the window', () => {
    let last = -1;
    for (let d = far; d >= near; d -= 0.25) {
      const level = sandLevel(d);
      expect(level).toBeGreaterThanOrEqual(last);
      last = level;
    }
    expect(sandLevel((near + far) / 2)).toBeGreaterThan(0.2);
    expect(sandLevel((near + far) / 2)).toBeLessThan(0.8);
  });

  it('is a close-up sound: silent from 3 m, and a fade over the last steps to the glass', () => {
    expect(far).toBe(3);
    expect(near).toBeLessThanOrEqual(1);
    expect(far - near).toBeGreaterThanOrEqual(2);
    expect(sandLevel(3)).toBe(0);
    expect(sandLevel(2.9)).toBeGreaterThan(0);
  });
});

describe('WindowSand', () => {
  it('is silent on a calm night, however close you stand', () => {
    const { sand, sound } = build({ storm: 0, ear: at(0, 1.2, -4.9) });
    run(sand, 3);
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('is heard at the glass in a storm', () => {
    const { sand, sound } = build({ ear: at(0, 1.2, -4.5) });
    run(sand, 3);
    expect(sound.isPlaying).toBe(true);
    expect(sound.volume).toBeCloseTo(volume);
  });

  it('fades up as you walk toward the window', () => {
    const { sand, sound, state } = build({ ear: at(0, 1.2, -2.2) });   // 2.8 m back
    run(sand, 3);
    const back = sound.isPlaying ? sound.volume : 0;

    state.ear = at(0, 1.2, -3.25);   // 1.75 m
    run(sand, 3);
    const middle = sound.volume;

    state.ear = at(0, 1.2, -4.5);    // at the glass
    run(sand, 3);
    const close = sound.volume;

    expect(back).toBeGreaterThan(0);
    expect(middle).toBeGreaterThan(back);
    expect(close).toBeGreaterThan(middle);
    expect(middle).toBeCloseTo(volume * sandLevel(1.75));
  });

  it('is not heard from the middle of the room', () => {
    const { sand, sound } = build({ ear: at(0, 1.2, -1.5) });   // 3.5 m back
    run(sand, 3);
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('follows the storm as it builds and dies down', () => {
    const { sand, sound, state } = build({ storm: 0.5, ear: at(0, 1.2, -4.5) });
    run(sand, 3);
    expect(sound.volume).toBeCloseTo(volume * 0.5);

    state.storm = 0;
    run(sand, 5);
    expect(sound.isPlaying).toBe(false);
  });

  it('is only heard in the room the window is in', () => {
    // Close as the crow flies, but through a wall.
    const { sand, sound } = build({ inside: false, ear: at(5, 1.2, -4) });
    run(sand, 3);
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('eases in and out rather than switching', () => {
    const { sand, sound } = build({ ear: at(0, 1.2, -4.5) });
    sand.onUpdate(1 / 60);
    expect(sound.volume).toBeGreaterThan(0);
    expect(sound.volume).toBeLessThan(volume * 0.2);
  });

  it('never plays above the level its clip was mixed at', () => {
    expect(volume).toBeGreaterThan(0);
    expect(volume).toBeLessThanOrEqual(1);
  });

  it('carries on without a clip', () => {
    const { sand } = build({ sound: null });
    expect(() => run(sand, 1)).not.toThrow();
  });

  it('falls silent and unhooks when the scene is torn down', () => {
    const { sand, sound } = build({ ear: at(0, 1.2, -4.5) });
    run(sand, 1);
    sand.onDestroy();
    expect(sound.isPlaying).toBe(false);
    expect(sound.disconnect).toHaveBeenCalled();
  });

  it('uses a small clip that is ready before the first storm', () => {
    expect(ASSETS[WINDOW_SAND.key]).toMatchObject({ type: 'audio' });
    expect(PRELOAD).toContain(WINDOW_SAND.key);
  });
});
