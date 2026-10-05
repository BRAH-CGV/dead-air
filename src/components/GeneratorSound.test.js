import * as THREE from 'three';
import { describe, it, expect, vi } from 'vitest';
import { GeneratorSound, GENERATOR } from './GeneratorSound.js';
import { PowerGrid } from '../systems/PowerGrid.js';

// ─────────────────────────────────────────────
// GeneratorSound — start-up, running hum, wind-down; faint indoors
// ─────────────────────────────────────────────

function makeSound() {
  return {
    isPlaying: false,
    volume: 0,
    play: vi.fn(function () { this.isPlaying = true; }),
    stop: vi.fn(function () { this.isPlaying = false; }),
    setVolume: vi.fn(function (v) { this.volume = v; }),
    setLoop: vi.fn(),
  };
}

function makeRig({ outside = true, ear = [7, 1.2, 11] } = {}) {
  const grid = new PowerGrid();
  const sounds = { start: makeSound(), running: makeSound(), stop: makeSound() };
  const hooks = {
    listenerPosition: out => out.set(...ear),
    isOutside: vi.fn(() => outside),
  };
  const gen = new GeneratorSound({ grid, sounds, hooks, position: new THREE.Vector3(7, 0.8, 9) });
  gen.onStart();
  return { gen, grid, sounds, hooks };
}

const run = (gen, seconds, step = 0.05) => {
  for (let t = 0; t < seconds - 1e-9; t += step) gen.onUpdate(step);
};

describe('GeneratorSound', () => {
  it('hums while the power is on — from the start of the night, no start-up', () => {
    const { gen, sounds } = makeRig();
    run(gen, 0.5);
    expect(sounds.running.isPlaying).toBe(true);
    expect(sounds.start.play).not.toHaveBeenCalled();
  });

  it('switching on plays the start-up, then hands over to the hum', () => {
    const { gen, grid, sounds } = makeRig();
    grid.setOn(false);
    run(gen, 0.5);
    expect(sounds.running.isPlaying).toBe(false);

    gen.switchOn();
    expect(grid.on).toBe(true);
    expect(sounds.start.play).toHaveBeenCalledTimes(1);
    run(gen, 1);
    expect(sounds.running.isPlaying).toBe(false);   // the start-up is still catching
    run(gen, GENERATOR.humFadeEnd);
    expect(sounds.running.isPlaying).toBe(true);
    expect(sounds.running.volume).toBeGreaterThan(sounds.start.volume);
  });

  it('switching off plays only the wind-down', () => {
    const { gen, grid, sounds } = makeRig();
    run(gen, 0.5);
    gen.switchOff();
    expect(grid.on).toBe(false);
    expect(sounds.running.isPlaying).toBe(false);
    expect(sounds.stop.play).toHaveBeenCalledTimes(1);
    expect(sounds.start.play).not.toHaveBeenCalled();
  });

  it('the UFO tripping it silences the hum without a wind-down', () => {
    const { gen, grid, sounds } = makeRig();
    run(gen, 0.5);
    grid.breakLights();
    run(gen, 0.2);
    expect(sounds.running.isPlaying).toBe(false);
    expect(sounds.stop.play).not.toHaveBeenCalled();
  });

  it('is very faint from inside the base', () => {
    const outside = makeRig({ outside: true, ear: [7, 1.2, 11] });
    const inside = makeRig({ outside: false, ear: [0, 1.2, 0] });
    run(outside.gen, 3);
    run(inside.gen, 3);
    expect(inside.sounds.running.volume).toBeGreaterThan(0);
    expect(inside.sounds.running.volume).toBeLessThan(outside.sounds.running.volume * 0.1);
  });

  it('fades with distance outside', () => {
    const near = makeRig({ ear: [7, 1.2, 11] });
    const far = makeRig({ ear: [-8, 1.2, 14] });
    run(near.gen, 3);
    run(far.gen, 3);
    expect(far.sounds.running.volume).toBeLessThan(near.sounds.running.volume);
  });

  it('eases between outside and inside rather than jumping', () => {
    const { gen, sounds, hooks } = makeRig({ outside: true });
    run(gen, 3);
    const out = sounds.running.volume;
    hooks.isOutside.mockReturnValue(false);
    gen.onUpdate(0.05);
    expect(sounds.running.volume).toBeLessThan(out);
    expect(sounds.running.volume).toBeGreaterThan(out * 0.2);
  });

  it('with the breakers tripped, switching on does nothing — not even the start-up', () => {
    const { gen, grid, sounds } = makeRig();
    grid.breakLights();
    gen.switchOn();
    expect(grid.on).toBe(false);
    expect(sounds.start.play).not.toHaveBeenCalled();
  });
});
