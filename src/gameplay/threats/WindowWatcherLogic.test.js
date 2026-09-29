import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WindowWatcherLogic, WINDOW_WATCHERS, lookAngleTo } from './WindowWatcherLogic.js';
import * as THREE from 'three';

const T = WINDOW_WATCHERS;

/** rand() that always returns `v` — idle then lasts min + v × (max − min). */
const fixed = v => () => v;

/** Step the logic in small frames for `seconds`. */
function run(logic, seconds, dt = 0.05) {
  for (let t = 0; t < seconds - 1e-9; t += dt) logic.update(Math.min(dt, seconds - t));
}

describe('WindowWatcherLogic', () => {
  let seen, angle, onKill, logic;

  beforeEach(() => {
    seen = false;
    angle = Infinity;
    onKill = vi.fn();
    logic = new WindowWatcherLogic({
      rand: fixed(0), isSeen: () => seen, lookAngle: () => angle, onKill,
    });
    logic.start();
  });

  it('starts idle and hidden, for a random 25–45 s', () => {
    expect(logic.phase).toBe('idle');
    expect(logic.visible).toBe(false);
    expect(T.idleMin).toBe(25);
    expect(T.idleMax).toBe(45);

    const late = new WindowWatcherLogic({ rand: fixed(0.999) });
    late.start();
    expect(late.duration).toBeCloseTo(45, 1);
    expect(logic.duration).toBe(25);
  });

  it('runs idle → approach (~8 s) → peer (5 s) → leave → idle', () => {
    run(logic, 25.01);
    expect(logic.phase).toBe('approach');
    expect(logic.visible).toBe(true);
    expect(logic.progress).toBeLessThan(0.05);

    run(logic, T.approachTime / 2);
    expect(logic.progress).toBeCloseTo(0.5, 1);

    run(logic, T.approachTime / 2);
    expect(logic.phase).toBe('peer');
    expect(T.approachTime).toBe(8);

    run(logic, T.peerTime);
    expect(logic.phase).toBe('leave');
    expect(T.peerTime).toBe(5);

    run(logic, T.leaveTime);
    expect(logic.phase).toBe('idle');
    expect(logic.visible).toBe(false);
    expect(logic.visits).toBe(1);
  });

  it('picks a fresh spot at the glass for every visit, inside the window', () => {
    const r = [0, 0.9, 0.1, 0.9, 0.2, 0.3];
    let i = 0;
    const l = new WindowWatcherLogic({ rand: () => r[i++ % r.length] });
    l.start();
    run(l, 25.01);
    expect(Math.abs(l.glassX)).toBeLessThanOrEqual(T.glassSpread);
    expect(l.farDistance).toBeGreaterThanOrEqual(T.farMin);
    expect(l.farDistance).toBeLessThanOrEqual(T.farMax);
    expect(Math.abs(l.farLateral)).toBeGreaterThan(0);
  });

  it('kills only during peer, and only when the player is seen', () => {
    seen = true;
    run(logic, 25 + T.approachTime - 0.1);   // the whole idle and approach
    expect(onKill).not.toHaveBeenCalled();
    expect(logic.phase).toBe('approach');

    run(logic, 0.1 + T.peerGrace + 0.05);
    expect(logic.phase).toBe('peer');
    expect(onKill).toHaveBeenCalledTimes(1);
  });

  it('gives the player a moment at the glass before it looks — the grace', () => {
    run(logic, 25 + T.approachTime + 0.01);
    expect(logic.phase).toBe('peer');
    seen = true;
    logic.update(T.peerGrace / 2);
    expect(onKill).not.toHaveBeenCalled();
  });

  it('never kills a hidden player, or one out of the office', () => {
    seen = false;
    run(logic, 25 + T.approachTime + T.peerTime + T.leaveTime + 1);
    expect(onKill).not.toHaveBeenCalled();
    expect(logic.phase).toBe('idle');
  });

  it('does not kill while leaving', () => {
    run(logic, 25 + T.approachTime + T.peerTime + 0.1);
    expect(logic.phase).toBe('leave');
    seen = true;
    run(logic, 1);
    expect(onKill).not.toHaveBeenCalled();
  });

  it('kills once, then holds still', () => {
    seen = true;
    run(logic, 25 + T.approachTime + T.peerTime);
    expect(onKill).toHaveBeenCalledTimes(1);
  });

  describe("the look rule: don't stare at it", () => {
    it(`staring within ${T.lookHalfAngleDeg}° for ${T.lookHold} s during approach sends it straight to the glass`, () => {
      run(logic, 25.01);
      angle = THREE.MathUtils.degToRad(T.lookHalfAngleDeg - 1);
      run(logic, T.lookHold - 0.1);
      expect(logic.phase).toBe('approach');
      run(logic, 0.15);
      expect(logic.phase).toBe('peer');
    });

    it('glancing away resets the stare', () => {
      run(logic, 25.01);
      angle = 0;
      run(logic, T.lookHold - 0.2);
      angle = Math.PI / 2;
      logic.update(0.05);
      angle = 0;
      run(logic, T.lookHold - 0.2);
      expect(logic.phase).toBe('approach');
    });

    it('looking only matters during approach', () => {
      angle = 0;
      run(logic, 20);
      expect(logic.phase).toBe('idle');
    });
  });

  it('start() resets the phases and the visit count', () => {
    run(logic, 25 + T.approachTime + 1);
    expect(logic.phase).toBe('peer');
    logic.start();
    expect(logic.phase).toBe('idle');
    expect(logic.visits).toBe(0);
    expect(logic.timer).toBe(0);
  });

  it('stop() hides the figure and freezes it', () => {
    run(logic, 25.5);
    expect(logic.visible).toBe(true);
    logic.stop();
    expect(logic.visible).toBe(false);
    expect(logic.phase).toBe('off');
    seen = true;
    run(logic, 60);
    expect(onKill).not.toHaveBeenCalled();
  });
});

describe('lookAngleTo', () => {
  const eye = new THREE.Vector3(0, 1.24, 0);
  const forward = new THREE.Vector3(0, 0, -1);

  it('is 0 looking straight at the point and π/2 at right angles to it', () => {
    expect(lookAngleTo(eye, forward, new THREE.Vector3(0, 1.24, -10))).toBeCloseTo(0);
    expect(lookAngleTo(eye, forward, new THREE.Vector3(10, 1.24, 0))).toBeCloseTo(Math.PI / 2);
  });

  it('measures the angle off the view centre', () => {
    const p = new THREE.Vector3(Math.tan(THREE.MathUtils.degToRad(10)) * 10, 1.24, -10);
    expect(THREE.MathUtils.radToDeg(lookAngleTo(eye, forward, p))).toBeCloseTo(10, 4);
  });

  it('is π for a point right behind', () => {
    expect(lookAngleTo(eye, forward, new THREE.Vector3(0, 1.24, 5))).toBeCloseTo(Math.PI);
  });
});
