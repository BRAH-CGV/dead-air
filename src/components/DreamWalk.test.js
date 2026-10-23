import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { DreamWalk } from './DreamWalk.js';
import { dreamLevel } from '../gameplay/dream.js';

const DT = 1 / 60;

function setup(level = 1, base = { x: 0, z: 0 }) {
  const position = new THREE.Vector3(0, 1, 6);
  const camera = new THREE.PerspectiveCamera(75);
  const controller = {
    speedScale: 1, inputLocked: false, yaw: Math.PI, pitch: 0,
    gameObject: { object3d: { position } },
    teleport: vi.fn(([x, y, z]) => position.set(x, y, z)),
  };
  const walk = new DreamWalk({
    level,
    base,
    controller,
    camera,
    sky: { setStorm: vi.fn() },
    fog: { density: 0 },
    fade: { cover: vi.fn((cb) => { cb(); return true; }), play: vi.fn() },
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

  it('past the pull radius: takes the legs, not the eyes, and drags the player back towards the base', () => {
    stepTo(walk, position, 0, L.pullRadius + 1);
    expect(walk.state).toBe('pulled');
    expect(controller.moveLocked).toBe(true);
    expect(controller.inputLocked).toBe(false);          // free to look round as they fly
    const before = Math.hypot(position.x, position.z);
    walk.onUpdate(DT);
    walk.onUpdate(DT);
    expect(Math.hypot(position.x, position.z)).toBeLessThan(before);
    // Dragged backwards: the way they were looking is kept.
    expect(controller.teleport.mock.calls.at(-1)[1]).toEqual({ yaw: Math.PI, pitch: 0 });
    // …and wherever they look round to as they go.
    controller.yaw = 0.4;
    controller.pitch = -0.2;
    walk.onUpdate(DT);
    expect(controller.teleport.mock.calls.at(-1)[1]).toEqual({ yaw: 0.4, pitch: -0.2 });
  });

  it('says how fast it is dragging them (for the wind)', () => {
    expect(walk.pullSpeed).toBe(0);
    stepTo(walk, position, 0, L.pullRadius + 40);
    walk.onUpdate(DT);
    walk.onUpdate(DT);
    expect(walk.pullSpeed).toBeGreaterThan(0);
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
    // Covered and left black: the scene uncovers once the next one is ready.
    expect(walk.fade.cover).toHaveBeenCalledOnce();
    expect(walk.fade.play).not.toHaveBeenCalled();
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
    expect(three.controller.moveLocked).toBe(false);
    expect(three.camera.fov).toBe(75);
  });

  describe('a base with a footprint: measured from its walls, not its middle', () => {
    const BASE = { x: 0, z: 2, halfX: 16, halfZ: 6 };

    it('walks at full speed beside a long wall, however far that is from the middle', () => {
      const s = setup(3, BASE);
      // 15 m from the middle along the long side, but only 3 m from the east end.
      stepTo(s.walk, s.position, BASE.halfX + 3, 2);
      expect(s.controller.speedScale).toBe(1);
      expect(s.walk.fog.density).toBeCloseTo(s.L.fogBase);
    });

    it('slows and pulls by the distance from the nearest wall', () => {
      const s = setup(1, BASE);
      stepTo(s.walk, s.position, 0, 2 + BASE.halfZ + (s.L.slowStart + s.L.pullRadius) / 2);
      expect(s.controller.speedScale).toBeLessThan(1);
      stepTo(s.walk, s.position, 0, 2 + BASE.halfZ + s.L.pullRadius + 1);
      expect(s.walk.state).toBe('pulled');
    });

    it('drags the player straight back to the nearest wall, and wakes them clear of it', () => {
      const s = setup(1, BASE);
      stepTo(s.walk, s.position, BASE.halfX + s.L.pullRadius + 1, 4);
      let nearest = Infinity;
      for (let i = 0; i < 60 * 120 && s.walk.state === 'pulled'; i++) {
        s.walk.onUpdate(DT);
        expect(s.position.z).toBeCloseTo(4, 6);   // straight back, along x
        nearest = Math.min(nearest, s.position.x - BASE.halfX);
      }
      expect(s.walk.state).toBe('awake');
      // Never into the base: it lets go a few metres out from the wall.
      expect(nearest).toBeGreaterThan(5);
      expect(nearest).toBeLessThan(10);
    });
  });

  describe('no endless crawl (playtest)', () => {
    /** A spot deep in the slow ring but short of the pull radius. */
    const deep = (L) => L.slowStart + 0.9 * (L.pullRadius - L.slowStart);

    it('a few seconds deep in the slow ring starts the pull, even short of the radius', () => {
      stepTo(walk, position, 0, deep(L));
      for (let t = 0; t < L.ringSeconds - 0.5; t += DT) walk.onUpdate(DT);
      expect(walk.state).toBe('walking');
      for (let t = 0; t < 1; t += DT) walk.onUpdate(DT);
      expect(walk.state).toBe('pulled');
    });

    it('stepping back out of the deep ring resets the count', () => {
      stepTo(walk, position, 0, deep(L));
      for (let t = 0; t < L.ringSeconds - 0.5; t += DT) walk.onUpdate(DT);
      stepTo(walk, position, 0, L.slowStart, 10);
      stepTo(walk, position, 0, deep(L));
      for (let t = 0; t < L.ringSeconds - 0.5; t += DT) walk.onUpdate(DT);
      expect(walk.state).toBe('walking');
    });
  });
});
