import { describe, it, expect, vi } from 'vitest';
import { SleepDemonLogic, SLEEP_DEMON as T, stageFor } from './SleepDemonLogic.js';

describe('SLEEP_DEMON tuning', () => {
  it('five stages, one step per 8 s at most, 6 s behind you before it takes you', () => {
    expect(T.stages).toBe(5);
    expect(T.moveInterval).toBe(8);
    expect(T.finalGrace).toBe(6);
    expect(T.behindDistance).toBe(1.5);
  });
});

describe('stageFor', () => {
  it('is 0 while wide awake and 5 once stamina is down to a sixth', () => {
    expect(stageFor(1, 0)).toBe(0);
    expect(stageFor(1 / 6 - 0.001, 0)).toBe(5);
    expect(stageFor(0, 0)).toBe(5);
  });

  it('climbs one band per sixth of stamina lost', () => {
    expect(stageFor(0.8, 0)).toBe(1);        // (1 − 0.8) × 6 = 1.2
    expect(stageFor(0.5, 0)).toBe(3);
    expect(stageFor(0.3, 0)).toBe(4);
  });

  it('holds its stage just under a boundary instead of jittering across it', () => {
    expect(stageFor(0.84, 1)).toBe(1);       // 0.96 bands: still 1, not back to 0
    expect(stageFor(0.9, 1)).toBe(0);        // 0.6: well clear, steps back
  });
});

describe('SleepDemonLogic', () => {
  function make({ canSee = () => false } = {}) {
    const onKill = vi.fn();
    const onMove = vi.fn();
    const logic = new SleepDemonLogic({ canSee, onKill, onMove });
    logic.start();
    return { logic, onKill, onMove };
  }

  /** Frames of `dt` for `seconds` at a fixed stamina. */
  function run(logic, seconds, stamina, dt = 0.1) {
    for (let t = 0; t < seconds - 1e-9; t += dt) logic.update(dt, stamina);
  }

  it('starts hidden, at stage 0', () => {
    const { logic } = make();
    expect(logic.stage).toBe(0);
    run(logic, 30, 1);
    expect(logic.stage).toBe(0);
  });

  it('comes one stage closer at a time, no more than once every 8 s', () => {
    const { logic, onMove } = make();
    run(logic, 7.9, 0.1);
    expect(logic.stage).toBe(0);
    run(logic, 0.2, 0.1);
    expect(logic.stage).toBe(1);
    expect(onMove).toHaveBeenLastCalledWith(1);
    run(logic, 7.9, 0.1);
    expect(logic.stage).toBe(1);
    run(logic, 0.2, 0.1);
    expect(logic.stage).toBe(2);
  });

  it('stops where its stamina band is', () => {
    const { logic } = make();
    run(logic, 60, 0.5);                    // band 3
    expect(logic.stage).toBe(3);
  });

  it('never moves while its spot or the next one is in view', () => {
    let seen = new Set([1]);
    const { logic } = make({ canSee: stage => seen.has(stage) });
    run(logic, 9, 0.5);                     // 0 → 1: the next spot is watched
    expect(logic.stage).toBe(0);

    seen = new Set();
    run(logic, 0.1, 0.5);                   // it moves the moment you look away
    expect(logic.stage).toBe(1);

    seen = new Set([1]);                    // watching where it is now
    run(logic, 20, 0.5);
    expect(logic.stage).toBe(1);
  });

  it('backs off the same way when the player eats', () => {
    const { logic } = make();
    run(logic, 30, 0.5);
    expect(logic.stage).toBe(3);
    run(logic, 8.1, 1);
    expect(logic.stage).toBe(2);
    run(logic, 20, 1);
    expect(logic.stage).toBe(0);
  });

  it('takes the player after 6 s behind them', () => {
    const { logic, onKill } = make();
    run(logic, 5 * 8 + 0.5, 0.1);
    expect(logic.stage).toBe(5);
    expect(onKill).not.toHaveBeenCalled();
    run(logic, T.finalGrace, 0.1);
    expect(onKill).toHaveBeenCalledTimes(1);
    run(logic, 10, 0.1);
    expect(onKill).toHaveBeenCalledTimes(1);
  });

  it('eating in the grace saves them: it steps back before the 6 s are up', () => {
    const { logic, onKill } = make();
    run(logic, 5 * 8 + 0.5, 0.1);
    run(logic, 5, 0.1);                     // 5 s behind them
    run(logic, 8, 0.5);                     // ate: steps back to 4 by the 8 s gate …
    expect(logic.stage).toBeLessThan(5);
    expect(onKill).not.toHaveBeenCalled();  // … and the grace starts again
  });

  it('takes the player the moment stamina runs out, wherever it is', () => {
    const { logic, onKill } = make();
    logic.update(0.1, 0);
    expect(onKill).toHaveBeenCalledTimes(1);
  });

  it('start() puts it back to stage 0 for a new or retried night', () => {
    const { logic, onKill } = make();
    run(logic, 60, 0);
    logic.start();
    expect(logic.stage).toBe(0);
    expect(logic.target).toBe(0);
    run(logic, 7.9, 0.1);
    expect(logic.stage).toBe(0);            // the 8 s gate starts again too
    logic.update(0.1, 0);
    expect(onKill).toHaveBeenCalledTimes(2);
  });
});
