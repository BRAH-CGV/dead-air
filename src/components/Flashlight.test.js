import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Flashlight, FlashlightStutter, FLASHLIGHT_STUTTER as S } from './Flashlight.js';
import { Component } from '../core/Component.js';
import { GameObject } from '../core/GameObject.js';
import { makeRandom } from '../core/Random.js';

// ─────────────────────────────────────────────
// Flashlight  –  weak, short-range torch on the player's camera
// ─────────────────────────────────────────────
// Built by hand rather than through the Engine, which would drag in Rapier's
// WASM for a component that only needs a camera and the input table.

function buildPlayer(opts) {
  const camera = new THREE.PerspectiveCamera();
  const engine = {
    camera,
    keyBinds: { flashlight: 'KeyF' },
    input: { keys: {}, pressed: {} },
  };
  const go = new GameObject('Player');
  go.scene = { userData: { engine } };
  const torch = go.addComponent(new Flashlight(opts));
  torch.onAwake();
  torch.onStart();
  return { engine, camera, torch };
}

/** One frame with F freshly pressed — the engine clears `pressed` after each. */
function pressF(engine, torch) {
  engine.input.pressed.KeyF = true;
  torch.onUpdate(1 / 60);
  engine.input.pressed = {};
}

describe('Flashlight', () => {
  it('is a component, so it can ride on the player', () => {
    expect(new Flashlight()).toBeInstanceOf(Component);
  });

  it('mounts a spotlight on the camera, aimed down the view direction', () => {
    const { camera, torch } = buildPlayer();
    expect(torch.light).toBeInstanceOf(THREE.SpotLight);
    expect(torch.light.parent).toBe(camera);
    expect(torch.light.target.parent).toBe(camera);
    expect(torch.light.target.position.z).toBeLessThan(0);   // cameras look down -Z
  });

  it('starts off', () => {
    const { torch } = buildPlayer();
    expect(torch.on).toBe(false);
    expect(torch.light.intensity).toBe(0);
  });

  it('F toggles it on and off', () => {
    const { engine, torch } = buildPlayer();
    pressF(engine, torch);
    expect(torch.on).toBe(true);
    expect(torch.light.intensity).toBeGreaterThan(0);
    pressF(engine, torch);
    expect(torch.on).toBe(false);
    expect(torch.light.intensity).toBe(0);
  });

  it('holding F does not flicker it — only the press counts', () => {
    const { engine, torch } = buildPlayer();
    pressF(engine, torch);
    engine.input.keys.KeyF = true;           // still held, no new press
    torch.onUpdate(1 / 60);
    torch.onUpdate(1 / 60);
    expect(torch.on).toBe(true);
  });

  it('switches by intensity, never visibility — a light count change recompiles every shader', () => {
    const { engine, torch } = buildPlayer();
    expect(torch.light.visible).toBe(true);
    pressF(engine, torch);
    pressF(engine, torch);
    expect(torch.light.visible).toBe(true);
  });

  it('is bright up close but short-ranged, so the dark further off stays dark', () => {
    const { torch } = buildPlayer();
    const { light } = torch;
    expect(light.distance).toBeGreaterThan(0);
    expect(light.distance).toBeLessThanOrEqual(9);
    expect(light.decay).toBe(2);
    expect(light.angle).toBeLessThan(Math.PI / 5);
    expect(torch.intensity).toBeGreaterThanOrEqual(35);   // floods what is in front of you
  });

  it('takes its tunables from the constructor', () => {
    const { engine, torch } = buildPlayer({ intensity: 2, distance: 5 });
    pressF(engine, torch);
    expect(torch.light.intensity).toBe(2);
    expect(torch.light.distance).toBe(5);
  });

  it('removes its light from the camera when destroyed', () => {
    const { camera, torch } = buildPlayer();
    const { light } = torch;
    torch.onDestroy();
    expect(light.parent).toBeNull();
    expect(light.target.parent).toBeNull();
    expect(camera.children).toHaveLength(0);
  });

  it('waits quietly with no engine wired up', () => {
    const torch = new Flashlight();
    new GameObject('Player').addComponent(torch);
    expect(() => { torch.onAwake(); torch.onStart(); torch.onUpdate(1 / 60); torch.onDestroy(); }).not.toThrow();
  });
});

describe('Flashlight timing', () => {
  it('is on the camera from awake — before the boot warm-up compiles the shaders it changes', () => {
    // A light added on the first frame instead changes the light count every
    // lit shader is compiled for, after the warm-up: a full recompile.
    const camera = new THREE.PerspectiveCamera();
    const go = new GameObject('Player');
    go.scene = { userData: { engine: { camera, keyBinds: {}, input: { keys: {}, pressed: {} } } } };
    const torch = go.addComponent(new Flashlight());
    torch.onAwake();
    expect(torch.light.parent).toBe(camera);
  });
});

describe('FlashlightStutter', () => {
  const DT = 1 / 60;
  /** Levels frame by frame, `seconds` long. */
  function levels(seconds, seed = 7) {
    const stutter = new FlashlightStutter({ rand: makeRandom(seed) });
    const out = [];
    for (let t = 0; t < seconds; t += DT) out.push(stutter.update(DT));
    return out;
  }
  /** Runs of one level: [level, frames]. */
  function runs(series) {
    const out = [];
    for (const level of series) {
      if (out.length && out.at(-1)[0] === level) out.at(-1)[1]++;
      else out.push([level, 1]);
    }
    return out;
  }

  it('dips fast and irregularly toward a low floor, never above full', () => {
    const series = levels(10);
    const lit = series.filter(l => l > 0);
    expect(Math.max(...series)).toBeLessThanOrEqual(1);
    expect(Math.min(...lit)).toBeGreaterThanOrEqual(S.floor);
    expect(Math.min(...lit)).toBeLessThan(S.floor + 0.1);           // reaches down near the floor
    expect(lit.reduce((a, b) => a + b, 0) / lit.length).toBeLessThan(0.8);   // reads as interference
    expect(runs(series).length / 10).toBeGreaterThan(8);           // changes many times a second
  });

  it('is never a clean strobe: neither its levels nor how long each holds repeat', () => {
    const r = runs(levels(5));
    expect(new Set(r.map(([level]) => level)).size).toBeGreaterThan(r.length * 0.6);
    expect(new Set(r.map(([, frames]) => frames)).size).toBeGreaterThanOrEqual(4);
  });

  it('drops out a few times a second, at random moments, each no longer than a blink', () => {
    for (const seed of [1, 2, 3]) {
      const dark = runs(levels(10, seed)).filter(([level]) => level === 0);
      expect(dark.length / 10).toBeGreaterThan(1.5);
      expect(dark.length / 10).toBeLessThan(4.5);
      for (const [, frames] of dark) expect(frames * DT).toBeLessThanOrEqual(0.1);
    }
  });

  it('opens with a dip, so even a quick sweep shows', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const stutter = new FlashlightStutter({ rand: makeRandom(seed) });
      expect(stutter.update(DT)).toBeLessThanOrEqual((1 + S.floor) / 2);
    }
  });

  it('starts afresh each time it is asked to', () => {
    const stutter = new FlashlightStutter({ rand: makeRandom(3) });
    for (let i = 0; i < 100; i++) stutter.update(DT);
    stutter.start();
    expect(stutter.update(DT)).toBeLessThanOrEqual((1 + S.floor) / 2);
  });
});

describe('Flashlight interference', () => {
  /** On, with a seeded stutter. */
  function lit(opts) {
    const built = buildPlayer({ rand: makeRandom(11), ...opts });
    pressF(built.engine, built.torch);
    return built;
  }
  const frames = (torch, n) => {
    const out = [];
    for (let i = 0; i < n; i++) { torch.onUpdate(1 / 60); out.push(torch.light.intensity); }
    return out;
  };

  it('stutters the light while something interferes: dips and dropouts, never brighter than full', () => {
    const { torch } = lit();
    torch.setInterference(true, 'test');
    const seen = frames(torch, 300);
    expect(Math.max(...seen)).toBeLessThanOrEqual(torch.intensity);
    expect(Math.min(...seen)).toBe(0);                         // a dropout
    expect(new Set(seen).size).toBeGreaterThan(20);
  });

  it('is back to exactly its intensity the moment the interference stops', () => {
    const { torch } = lit();
    torch.setInterference(true, 'test');
    frames(torch, 37);
    torch.setInterference(false, 'test');
    expect(torch.light.intensity).toBe(torch.intensity);
    expect(frames(torch, 30).every(i => i === torch.intensity)).toBe(true);
  });

  it('switched off it stays off, and the stutter costs nothing', () => {
    const { torch } = buildPlayer({ rand: makeRandom(11) });
    const tick = vi.spyOn(torch.stutter, 'update');
    torch.setInterference(true, 'test');
    expect(frames(torch, 60).every(i => i === 0)).toBe(true);
    expect(tick).not.toHaveBeenCalled();
    torch.setInterference(false, 'test');
    expect(torch.light.intensity).toBe(0);
  });

  it('switched on mid-interference it comes on stuttering; switched off, it is off', () => {
    const { engine, torch } = buildPlayer({ rand: makeRandom(11) });
    torch.setInterference(true, 'test');
    pressF(engine, torch);
    expect(torch.light.intensity).toBeLessThan(torch.intensity);
    pressF(engine, torch);
    expect(torch.light.intensity).toBe(0);
    expect(frames(torch, 30).every(i => i === 0)).toBe(true);
  });

  it('stutters while any source still interferes', () => {
    const { torch } = lit();
    torch.setInterference(true, 'a');
    torch.setInterference(true, 'b');
    torch.setInterference(false, 'a');
    expect(torch.interfered).toBe(true);
    expect(new Set(frames(torch, 60)).size).toBeGreaterThan(3);
    torch.setInterference(false, 'b');
    expect(torch.interfered).toBe(false);
    expect(torch.light.intensity).toBe(torch.intensity);
  });

  it('stutters by intensity, never visibility', () => {
    const { torch } = lit();
    torch.setInterference(true, 'test');
    frames(torch, 120);
    expect(torch.light.visible).toBe(true);
  });
});
