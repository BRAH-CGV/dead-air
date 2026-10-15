// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  TuningGame,
  REQUIRED_TIME,
  TARGET_ZONE_WIDTH,
  TARGET_SPEED,
  CROSSHAIR_ACCEL,
  CROSSHAIR_DRAG,
  CROSSHAIR_MAX_VEL,
} from './TuningGame.js';

/** Deterministic random that returns values from a queue. */
function makeRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('TuningGame', () => {
  it('reset places the target within bounds and zeroes velocities', () => {
    const game = new TuningGame({ random: makeRng([0.5]) });
    game.reset();
    const half = TARGET_ZONE_WIDTH / 2;
    expect(game.targetPos).toBeGreaterThanOrEqual(half);
    expect(game.targetPos).toBeLessThanOrEqual(1 - half);
    expect(game.targetVel).toBe(0);
    expect(game.crosshairPos).toBe(0.5);
    expect(game.crosshairVel).toBe(0);
    expect(game.accumulated).toBe(0);
    expect(game.overlapping).toBe(false);
  });

  it('target stays within bounds during random walk', () => {
    const game = new TuningGame({ random: makeRng([0, 1, 0.5, 0.2, 0.8]) });
    game.reset();
    const half = TARGET_ZONE_WIDTH / 2;
    for (let i = 0; i < 500; i++) {
      game.update(1 / 60, 0);
      expect(game.targetPos).toBeGreaterThanOrEqual(half - 1e-9);
      expect(game.targetPos).toBeLessThanOrEqual(1 - half + 1e-9);
    }
  });

  it('target velocity jitters after the interval elapses', () => {
    const game = new TuningGame({ random: makeRng([0.75, 0.3]) });
    game.reset();
    const initialVel = game.targetVel;
    // Advance past the jitter interval (1.5 s).
    game.update(2.0, 0);
    // After the jitter timer fires, targetVel should have changed.
    expect(game.targetVel).not.toBe(initialVel);
  });

  it('positive slider accelerates the crosshair rightward', () => {
    const game = new TuningGame({ random: makeRng([0.5]) });
    game.reset();
    game.update(0.1, 1.0);
    expect(game.crosshairPos).toBeGreaterThan(0.5);
    expect(game.crosshairVel).toBeGreaterThan(0);
  });

  it('negative slider accelerates the crosshair leftward', () => {
    const game = new TuningGame({ random: makeRng([0.5]) });
    game.reset();
    game.update(0.1, -1.0);
    expect(game.crosshairPos).toBeLessThan(0.5);
    expect(game.crosshairVel).toBeLessThan(0);
  });

  it('crosshair velocity is capped at CROSSHAIR_MAX_VEL', () => {
    const game = new TuningGame({ random: makeRng([0.5]) });
    game.reset();
    // Drive the crosshair hard for a long time.
    for (let i = 0; i < 200; i++) game.update(1 / 60, 1.0);
    expect(Math.abs(game.crosshairVel)).toBeLessThanOrEqual(CROSSHAIR_MAX_VEL + 1e-9);
  });

  it('crosshair position is clamped to [0, 1]', () => {
    const game = new TuningGame({ random: makeRng([0.5]) });
    game.reset();
    for (let i = 0; i < 200; i++) game.update(1 / 60, 1.0);
    expect(game.crosshairPos).toBeLessThanOrEqual(1);
    for (let i = 0; i < 400; i++) game.update(1 / 60, -1.0);
    expect(game.crosshairPos).toBeGreaterThanOrEqual(0);
  });

  it('drag slows the crosshair when the slider is centred', () => {
    const game = new TuningGame({ random: makeRng([0.5]) });
    game.reset();
    // Build up some velocity.
    game.update(0.2, 1.0);
    const velAfterAccel = game.crosshairVel;
    // Release the slider — drag should decelerate.
    game.update(0.1, 0);
    expect(Math.abs(game.crosshairVel)).toBeLessThan(Math.abs(velAfterAccel));
  });

  it('overlap accumulates when the crosshair is inside the target zone', () => {
    // Place the target at 0.5 and the crosshair at 0.5 — they overlap.
    const game = new TuningGame({ random: () => 0.5 });
    game.reset();
    // Target is at ~0.5, crosshair at 0.5. Keep slider centred.
    game.update(0.5, 0);
    expect(game.overlapping).toBe(true);
    expect(game.accumulated).toBeGreaterThan(0);
  });

  it('no accumulation when the crosshair is outside the target zone', () => {
    // Place target at far right, crosshair at far left.
    const rng = makeRng([1.0]); // target at far right
    const game = new TuningGame({ random: rng });
    game.reset();
    // Move crosshair far left.
    for (let i = 0; i < 50; i++) game.update(1 / 60, -1.0);
    const before = game.accumulated;
    game.update(0.5, 0);
    // If the crosshair is far from the target, no accumulation.
    if (!game.overlapping) {
      expect(game.accumulated).toBe(before);
    }
  });

  it('progress reaches 1 after REQUIRED_TIME seconds of overlap', () => {
    const game = new TuningGame({ random: () => 0.5 });
    game.reset();
    // Simulate enough overlap time.
    for (let i = 0; i < REQUIRED_TIME * 60; i++) {
      game.update(1 / 60, 0);
    }
    expect(game.progress).toBeGreaterThanOrEqual(1);
    expect(game.isComplete).toBe(true);
  });

  it('progress is proportional to accumulated time', () => {
    const game = new TuningGame({ random: () => 0.5 });
    game.reset();
    // Accumulate half the required time.
    for (let i = 0; i < (REQUIRED_TIME / 2) * 60; i++) {
      game.update(1 / 60, 0);
    }
    expect(game.progress).toBeGreaterThan(0);
    expect(game.progress).toBeLessThan(1);
    expect(game.isComplete).toBe(false);
  });

  it('reset clears accumulated time', () => {
    const game = new TuningGame({ random: () => 0.5 });
    game.reset();
    game.update(1, 0);
    expect(game.accumulated).toBeGreaterThan(0);
    game.reset();
    expect(game.accumulated).toBe(0);
    expect(game.progress).toBe(0);
  });
});
