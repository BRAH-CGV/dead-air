import { describe, it, expect } from 'vitest';
import { FootstepLogic, FOOTSTEPS } from './FootstepLogic.js';

const DT = 1 / 60;

/** Run `seconds` in the given state; every event, with its time. */
function run(logic, seconds, state, t0 = 0) {
  const out = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    for (const e of logic.update(DT, state)) out.push({ t: t0 + i * DT, kind: e.kind, weight: e.weight });
  }
  return out;
}

const walking = { grounded: true, speed: 5, vertVel: 0, crouched: false };
const standing = { grounded: true, speed: 0, vertVel: 0, crouched: false };

describe('FootstepLogic', () => {
  it('nothing standing still', () => {
    expect(run(new FootstepLogic(), 3, standing)).toHaveLength(0);
  });

  it('a step every stride while walking: the first half a stride in', () => {
    const steps = run(new FootstepLogic(), 4, walking);
    expect(steps.every(e => e.kind === 'step')).toBe(true);
    const every = FOOTSTEPS.stride / walking.speed;
    expect(steps[0].t).toBeCloseTo(every / 2, 1);
    expect(steps.length).toBeCloseTo(4 / every, -0.5);
  });

  it('faster feet, quicker steps', () => {
    const slow = run(new FootstepLogic(), 4, { ...walking, speed: 2 });
    const fast = run(new FootstepLogic(), 4, walking);
    expect(fast.length).toBeGreaterThan(slow.length);
  });

  it('crouched: shorter strides, softer steps', () => {
    const steps = run(new FootstepLogic(), 4, { ...walking, speed: 2.5, crouched: true });
    expect(steps.length).toBeGreaterThan(4 * 2.5 / FOOTSTEPS.stride);
    expect(steps[0].weight).toBeLessThan(1);
  });

  it('a jump pushes off, softly; walking off a ledge does not', () => {
    const logic = new FootstepLogic();
    run(logic, 0.1, standing);
    const jump = run(logic, DT * 1.5, { grounded: false, speed: 0, vertVel: 4, crouched: false });
    expect(jump.map(e => e.kind)).toEqual(['jump']);
    expect(jump[0].weight).toBeLessThan(1);
    const ledge = new FootstepLogic();
    run(ledge, 0.1, standing);
    expect(run(ledge, 0.1, { grounded: false, speed: 0, vertVel: -1, crouched: false })).toHaveLength(0);
  });

  it('lands with a thump, heavier the harder the fall; a stumble over a lip makes none', () => {
    const land = fall => {
      const logic = new FootstepLogic();
      run(logic, 0.1, standing);
      run(logic, 0.5, { grounded: false, speed: 0, vertVel: -fall, crouched: false });
      return run(logic, DT * 1.5, standing);
    };
    const soft = land(3), hard = land(8);
    expect(soft.map(e => e.kind)).toEqual(['land']);
    expect(hard[0].weight).toBeGreaterThan(soft[0].weight);
    const lip = new FootstepLogic();
    run(lip, 0.1, standing);
    run(lip, FOOTSTEPS.minAir / 2, { grounded: false, speed: 0, vertVel: -1, crouched: false });
    expect(run(lip, DT * 1.5, standing)).toHaveLength(0);
  });
});
