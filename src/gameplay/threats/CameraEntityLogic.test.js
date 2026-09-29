import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CAMERA_ENTITY as T, CameraSweep, CameraExposure, inCone, turnToward } from './CameraEntityLogic.js';

const DEG = Math.PI / 180;

describe('CAMERA_ENTITY tuning', () => {
  it('matches the handoff: 8 s sweeps, 1.5 s pauses, a 25° / 7 m cone, lock-on at 0.6', () => {
    expect(T.sweepTime).toBe(8);
    expect(T.pauseTime).toBe(1.5);
    expect(T.halfAngle).toBeCloseTo(25 * DEG);
    expect(T.range).toBe(7);
    expect(T.rise).toBe(1.2);
    expect(T.decay).toBe(0.5);
    expect(T.lockOn).toBe(0.6);
  });
});

describe('CameraSweep', () => {
  const make = () => new CameraSweep({ minYaw: 0, maxYaw: 1, sweepTime: 8, pauseTime: 1.5 });

  it('starts paused at one limit', () => {
    const sweep = make();
    expect(sweep.yaw).toBe(0);
    sweep.update(1.4);
    expect(sweep.yaw).toBe(0);
  });

  it('sweeps across in sweepTime, through the middle halfway', () => {
    const sweep = make();
    sweep.update(1.5 + 4);
    expect(sweep.yaw).toBeCloseTo(0.5);
    sweep.update(4);
    expect(sweep.yaw).toBeCloseTo(1);
  });

  it('eases in and out rather than snapping into motion', () => {
    const sweep = make();
    sweep.update(1.5 + 0.8);            // a tenth of the way in time
    expect(sweep.yaw).toBeGreaterThan(0);
    expect(sweep.yaw).toBeLessThan(0.1);
  });

  it('pauses at the far limit, then comes back', () => {
    const sweep = make();
    sweep.update(1.5 + 8 + 1.4);
    expect(sweep.yaw).toBeCloseTo(1);
    sweep.update(0.1 + 4);
    expect(sweep.yaw).toBeCloseTo(0.5);
    sweep.update(4);
    expect(sweep.yaw).toBeCloseTo(0);
  });

  it('repeats every two sweeps and two pauses', () => {
    const sweep = make();
    const period = 2 * (8 + 1.5);
    sweep.update(period + 1.5 + 4);
    expect(sweep.yaw).toBeCloseTo(0.5);
  });

  it('reset() goes back to the start of the cycle', () => {
    const sweep = make();
    sweep.update(7);
    sweep.reset();
    expect(sweep.time).toBe(0);
    expect(sweep.yaw).toBe(0);
  });
});

describe('inCone', () => {
  const apex = new THREE.Vector3(0, 0, 0);
  const forward = new THREE.Vector3(0, 0, 1);
  const at = (deg, dist) => new THREE.Vector3(Math.sin(deg * DEG) * dist, 0, Math.cos(deg * DEG) * dist);

  it('sees a point straight ahead and in range', () => {
    expect(inCone(apex, forward, at(0, 3), 25 * DEG, 7)).toBe(true);
  });

  it('sees just inside the edge, not just outside it', () => {
    expect(inCone(apex, forward, at(24.5, 3), 25 * DEG, 7)).toBe(true);
    expect(inCone(apex, forward, at(25.5, 3), 25 * DEG, 7)).toBe(false);
  });

  it('stops at its range', () => {
    expect(inCone(apex, forward, at(0, 6.9), 25 * DEG, 7)).toBe(true);
    expect(inCone(apex, forward, at(0, 7.1), 25 * DEG, 7)).toBe(false);
  });

  it('does not see behind itself', () => {
    expect(inCone(apex, forward, at(180, 2), 25 * DEG, 7)).toBe(false);
  });

  it('works from any apex', () => {
    const from = new THREE.Vector3(5, 2, -1);
    const point = from.clone().add(at(10, 4));
    expect(inCone(from, forward, point, 25 * DEG, 7)).toBe(true);
  });
});

describe('turnToward', () => {
  it('moves at most maxStep toward the target', () => {
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(turnToward(1, 0, 0.25)).toBeCloseTo(0.75);
  });

  it('lands on the target when it is within a step', () => {
    expect(turnToward(0.9, 1, 0.25)).toBe(1);
  });

  it('turns the short way round', () => {
    expect(turnToward(3, -3, 0.1)).toBeCloseTo(3.1);
  });
});

describe('CameraExposure', () => {
  function make() {
    const onKill = vi.fn();
    const exposure = new CameraExposure({ onKill });
    exposure.start();
    return { exposure, onKill };
  }

  it('rises at rise per second while the player is seen', () => {
    const { exposure } = make();
    exposure.update(0.5, true);
    expect(exposure.exposure).toBeCloseTo(0.6);
  });

  it('decays at decay per second while the player is not seen, never below 0', () => {
    const { exposure } = make();
    exposure.update(0.5, true);         // 0.6
    exposure.update(0.4, false);        // 0.4
    expect(exposure.exposure).toBeCloseTo(0.4);
    exposure.update(5, false);
    expect(exposure.exposure).toBe(0);
  });

  it('fails the night once, at 1', () => {
    const { exposure, onKill } = make();
    exposure.update(0.8, true);
    expect(onKill).not.toHaveBeenCalled();
    exposure.update(0.1, true);         // 0.96 + 0.12 > 1
    expect(onKill).toHaveBeenCalledTimes(1);
    expect(exposure.exposure).toBe(1);
    exposure.update(1, true);
    expect(onKill).toHaveBeenCalledTimes(1);
  });

  it('locks on above 0.6 and lets go only once exposure has decayed', () => {
    const { exposure } = make();
    exposure.update(0.45, true);        // 0.54
    expect(exposure.locked).toBe(false);
    exposure.update(0.1, true);         // 0.66
    expect(exposure.locked).toBe(true);

    exposure.update(0.2, false);        // 0.56: still locked, just under the line
    expect(exposure.locked).toBe(true);
    exposure.update(2, false);          // decayed away
    expect(exposure.exposure).toBe(0);
    expect(exposure.locked).toBe(false);
  });

  it('start() resets for a new or retried night', () => {
    const { exposure, onKill } = make();
    exposure.update(2, true);
    exposure.start();
    expect(exposure.exposure).toBe(0);
    expect(exposure.locked).toBe(false);
    exposure.update(0.8, true);         // 0.96
    expect(onKill).toHaveBeenCalledTimes(1);   // not killed again until it reaches 1 again
    exposure.update(0.1, true);
    expect(onKill).toHaveBeenCalledTimes(2);
  });
});
