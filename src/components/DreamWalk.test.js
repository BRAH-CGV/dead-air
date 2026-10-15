import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { DreamWalk } from './DreamWalk.js';
import { dreamLevel } from '../gameplay/dream.js';

const DT = 1 / 60;

function setup(level = 1) {
  const position = new THREE.Vector3(0, 1, 6);
  const camera = new THREE.PerspectiveCamera(75);
  const controller = {
    speedScale: 1, inputLocked: false, yaw: Math.PI, pitch: 0,
    gameObject: { object3d: { position } },
    teleport: vi.fn(([x, y, z]) => position.set(x, y, z)),
  };
  const walk = new DreamWalk({
    level,
    base: { x: 0, z: 0 },
    controller,
    camera,
    sky: { setStorm: vi.fn() },
    fog: { density: 0 },
    fade: { play: vi.fn((cb) => { cb(); return true; }) },
    onWake: vi.fn(),
  });
  return { walk, controller, position, camera, L: dreamLevel(level) };
}

const stepTo = (walk, position, x, z, frames = 1) => {
  position.x = x; position.z = z;
  for (let i = 0; i < frames; i++) walk.onUpdate(DT);
};

describe('DreamWalk (#101)', () => {
  let walk, controller, position, camera, L;
  beforeEach(() => ({ walk, controller, position, camera, L } = setup()));

  it('walks at full speed near the base, with the fog and sky still clear', () => {
    stepTo(walk, position, 0, 5);
    expect(controller.speedScale).toBe(1);
    expect(walk.fog.density).toBeCloseTo(L.fogBase);
    expect(walk.state).toBe('walking');
  });

  it('slows the player, and thickens the fog and the sky, further out', () => {
    stepTo(walk, position, 0, (L.slowStart + L.pullRadius) / 2);
    expect(controller.speedScale).toBeLessThan(1);
    expect(walk.fog.density).toBeGreaterThan(L.fogBase);
    const storm = walk.sky.setStorm.mock.calls.at(-1)[0];
    expect(storm).toBeGreaterThan(L.skyBase);
  });

  it('past the pull radius: takes the controls and drags the player back towards the base', () => {
    stepTo(walk, position, 0, L.pullRadius + 1);
    expect(walk.state).toBe('pulled');
    expect(controller.inputLocked).toBe(true);
    const before = Math.hypot(position.x, position.z);
    walk.onUpdate(DT);
    walk.onUpdate(DT);
    expect(Math.hypot(position.x, position.z)).toBeLessThan(before);
    // Dragged backwards: the way they were looking is kept.
    expect(controller.teleport.mock.calls.at(-1)[1]).toEqual({ yaw: Math.PI, pitch: 0 });
  });

  it('the drag picks up speed the longer it lasts', () => {
    stepTo(walk, position, 0, L.pullRadius + 40);
    const d0 = position.z;
    walk.onUpdate(DT);
    const first = d0 - position.z;
    for (let i = 0; i < 60; i++) walk.onUpdate(DT);
    const d1 = position.z;
    walk.onUpdate(DT);
    expect(d1 - position.z).toBeGreaterThan(first);
  });

  it('back at the base it wakes the player, once, through the fade', () => {
    stepTo(walk, position, 0, L.pullRadius + 1);
    for (let i = 0; i < 60 * 120 && walk.state === 'pulled'; i++) walk.onUpdate(DT);
    expect(walk.state).toBe('awake');
    walk.onUpdate(DT);
    expect(walk.fade.play).toHaveBeenCalledOnce();
    expect(walk.onWake).toHaveBeenCalledOnce();
  });

  it('wakes even with no fade to play', () => {
    walk.fade = null;
    walk.wake();
    expect(walk.onWake).toHaveBeenCalledOnce();
  });

  it('level 3 makes the view breathe as you get further out; level 1 does not', () => {
    const three = setup(3);
    stepTo(three.walk, three.position, 0, three.L.pullRadius - 1, 30);
    expect(three.camera.fov).not.toBeCloseTo(75, 3);
    stepTo(walk, position, 0, L.pullRadius - 1, 30);
    expect(camera.fov).toBeCloseTo(75, 6);
  });

  it('gives back the speed, the controls and the field of view when it goes', () => {
    const three = setup(3);
    stepTo(three.walk, three.position, 0, three.L.pullRadius + 1, 3);
    three.walk.onDestroy();
    expect(three.controller.speedScale).toBe(1);
    expect(three.controller.inputLocked).toBe(false);
    expect(three.camera.fov).toBe(75);
  });
});
