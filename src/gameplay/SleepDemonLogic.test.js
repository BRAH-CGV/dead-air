import { describe, it, expect, vi } from 'vitest';
import { SleepDemonLogic, SLEEP_DEMON as T, closenessFor, angleToUpright, duckFor } from './SleepDemonLogic.js';

const DEG = Math.PI / 180;
/** In view and off to one side: the corner of the eye. */
const CORNER = 40 * DEG;

const unit = (x, y, z) => { const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; };
const toward = (from, to) => unit(to.x - from.x, to.y - from.y, to.z - from.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

describe('SLEEP_DEMON tuning', () => {
  it('shows below 0.85 stamina, 10 m away, and comes in to 0.8 m at empty', () => {
    expect(T.appearBelow).toBe(0.85);
    expect(T.farthest).toBe(10);
    expect(T.nearest).toBe(0.8);
  });

  it('a look within 12° of it is looking at it', () => {
    expect(T.focusAngle).toBeCloseTo(12 * DEG);
  });
});

describe('closenessFor', () => {
  it('is 0 until it shows, and climbs to 1 as stamina runs out', () => {
    expect(closenessFor(1)).toBe(0);
    expect(closenessFor(T.appearBelow)).toBe(0);
    expect(closenessFor(T.appearBelow / 2)).toBeCloseTo(0.5);
    expect(closenessFor(0)).toBe(1);
  });
});

describe('angleToUpright', () => {
  // The player's eye 1.24 m up at the origin; a 1.8 m figure 2 m ahead (−Z).
  const eye = { x: 0, y: 1.24, z: 0 };
  const feet = { x: 0, y: 0, z: -2 };

  it('is 0 looking anywhere along it, feet to crown', () => {
    expect(angleToUpright(eye, unit(0, 0, -1), feet, 1.8)).toBeCloseTo(0);
    expect(angleToUpright(eye, toward(eye, { x: 0, y: 1.7, z: -2 }), feet, 1.8)).toBeCloseTo(0);
    expect(angleToUpright(eye, toward(eye, { x: 0, y: 0.1, z: -2 }), feet, 1.8)).toBeCloseTo(0);
  });

  it('is the angle off to the side, looking level past it', () => {
    const past = unit(Math.sin(30 * DEG), 0, -Math.cos(30 * DEG));
    expect(angleToUpright(eye, past, feet, 1.8)).toBeCloseTo(30 * DEG);
  });

  it('counts from its crown when looking over its head', () => {
    const over = toward(eye, { x: 0, y: 3, z: -2 });
    const crown = toward(eye, { x: 0, y: 1.8, z: -2 });
    expect(angleToUpright(eye, over, feet, 1.8)).toBeCloseTo(Math.acos(dot(over, crown)));
  });

  it('is past 90° when it stands behind', () => {
    expect(angleToUpright(eye, unit(0, 0, 1), feet, 1.8)).toBeGreaterThan(90 * DEG);
  });
});

describe('SleepDemonLogic', () => {
  /** Where the player's view is from it: lookAngle() returns this. */
  let angle;

  function make({ place = () => true, rand = () => 0.9 } = {}) {
    angle = CORNER;
    const spies = { place: vi.fn(place), hide: vi.fn(), onKill: vi.fn() };
    const logic = new SleepDemonLogic({ ...spies, lookAngle: () => angle, rand });
    return { logic, ...spies };
  }

  /** Frames of `dt` for `seconds` at a fixed stamina. */
  function run(logic, seconds, stamina, dt = 0.1) {
    for (let t = 0; t < seconds - 1e-9; t += dt) logic.update(dt, stamina);
  }

  /** Run until it first shows, at `stamina`. */
  function shown(logic, stamina) {
    run(logic, 7, stamina);
    expect(logic.shown).toBe(true);
  }

  it('is nowhere while the player is awake enough', () => {
    const { logic, place } = make();
    run(logic, 60, 1);
    run(logic, 60, 0.86);
    expect(place).not.toHaveBeenCalled();
    expect(logic.around).toBe(false);
    expect(logic.shown).toBe(false);
  });

  it('shows at the edge of the view a few seconds after the player tires', () => {
    const { logic, place } = make();
    run(logic, 3.1, 0.425);                 // halfway: 3.25 s before it shows
    expect(logic.around).toBe(true);        // about already (it breathes), not yet seen
    expect(place).not.toHaveBeenCalled();
    run(logic, 0.3, 0.425);
    expect(place).toHaveBeenCalledTimes(1);
    expect(place).toHaveBeenCalledWith({
      side: 1, distance: expect.closeTo(5.4, 5), edge: expect.closeTo(0.65, 5),
    });
    expect(logic.shown).toBe(true);
  });

  it('the more tired the player, the nearer it stands and the nearer the middle of the view', () => {
    const a = make();
    shown(a.logic, 0.8);
    const b = make();
    shown(b.logic, 0.1);
    const [{ distance: far, edge: wide }] = a.place.mock.calls[0];
    const [{ distance: near, edge: narrow }] = b.place.mock.calls[0];
    expect(near).toBeLessThan(far);
    expect(near).toBeLessThan(2);
    expect(narrow).toBeLessThan(wide);
  });

  it('looked at, it is gone at once, and back a moment later at the other edge of the view', () => {
    const { logic, place, hide } = make();
    shown(logic, 0.425);
    angle = 5 * DEG;
    logic.update(0.1, 0.425);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(logic.shown).toBe(false);

    angle = CORNER;
    run(logic, 3.1, 0.425);
    expect(place).toHaveBeenCalledTimes(1);
    run(logic, 0.3, 0.425);
    expect(place).toHaveBeenCalledTimes(2);
    expect(place).toHaveBeenLastCalledWith(expect.objectContaining({ side: -1 }));
  });

  it('comes back sooner the more tired the player is', () => {
    const tired = make();
    shown(tired.logic, 0.1);
    angle = 0;
    run(tired.logic, 1.3, 0.1);
    expect(tired.place).toHaveBeenCalledTimes(2);

    const awake = make();
    shown(awake.logic, 0.8);
    angle = 0;
    awake.logic.update(0.1, 0.8);
    angle = CORNER;
    run(awake.logic, 5, 0.8);
    expect(awake.place).toHaveBeenCalledTimes(1);
  });

  it('out of view for 1.5 s, it finds the edge of the view again, straight away', () => {
    const { logic, place, hide } = make();
    shown(logic, 0.425);
    angle = Infinity;                       // turned away, or something in the way
    run(logic, 1.4, 0.425);
    expect(place).toHaveBeenCalledTimes(1);
    run(logic, 0.2, 0.425);
    expect(place).toHaveBeenCalledTimes(2);
    expect(hide).not.toHaveBeenCalled();
    expect(logic.shown).toBe(true);
  });

  it('caught again in the corner of the eye within 1.5 s, it stays where it was', () => {
    const { logic, place } = make();
    shown(logic, 0.425);
    angle = Infinity;
    run(logic, 1, 0.425);
    angle = CORNER;
    run(logic, 0.1, 0.425);
    angle = Infinity;
    run(logic, 1, 0.425);
    expect(place).toHaveBeenCalledTimes(1);
  });

  it('steps in as stamina falls, without being looked at: a new spot every eighth of the way', () => {
    const { logic, place } = make();
    shown(logic, 0.8);                      // the first eighth
    run(logic, 1, 0.76);
    expect(place).toHaveBeenCalledTimes(1);
    logic.update(0.1, 0.7);                 // into the second
    expect(place).toHaveBeenCalledTimes(2);
    expect(place.mock.calls[1][0].distance).toBeLessThan(place.mock.calls[0][0].distance);
    expect(place.mock.calls[1][0].side).toBe(place.mock.calls[0][0].side);
  });

  it('backs off when the player eats, and goes once they are awake enough', () => {
    const { logic, place, hide } = make();
    shown(logic, 0.2);
    logic.update(0.1, 0.55);                // a ration: 0.35 back
    expect(place).toHaveBeenCalledTimes(2);
    expect(place.mock.calls[1][0].distance).toBeGreaterThan(place.mock.calls[0][0].distance);
    logic.update(0.1, 0.9);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(logic.shown).toBe(false);
    expect(logic.around).toBe(false);
  });

  it('at the very end it no longer flees a look', () => {
    const { logic, hide } = make();
    shown(logic, 0.05);
    angle = 0;
    run(logic, 3, 0.05);
    expect(hide).not.toHaveBeenCalled();
    expect(logic.shown).toBe(true);
  });

  it('takes the player the moment stamina runs out, once', () => {
    const { logic, onKill } = make();
    logic.update(0.1, 0);
    expect(onKill).toHaveBeenCalledTimes(1);
    run(logic, 5, 0);
    expect(onKill).toHaveBeenCalledTimes(1);
  });

  it('with no room on its side it tries the other one', () => {
    const { logic, place } = make({ place: ({ side }) => side === -1 });
    shown(logic, 0.425);
    expect(place.mock.calls.map(([spot]) => spot.side)).toEqual([1, -1]);
    expect(logic.side).toBe(-1);
  });

  it('with no room either side it waits, and tries again a moment later', () => {
    let room = false;
    const { logic, place } = make({ place: () => room });
    run(logic, 7, 0.425);
    expect(logic.shown).toBe(false);
    const tries = place.mock.calls.length;
    expect(tries).toBeGreaterThanOrEqual(2);
    room = true;
    run(logic, 0.3, 0.425);
    expect(place.mock.calls.length).toBeGreaterThan(tries);
    expect(logic.shown).toBe(true);
  });

  it('while the view is covered (the terminal screen), it neither flees nor wanders', () => {
    const { logic, place, hide } = make();
    shown(logic, 0.425);
    angle = null;
    run(logic, 10, 0.425);
    expect(hide).not.toHaveBeenCalled();
    expect(place).toHaveBeenCalledTimes(1);
  });

  it('closeness: 0 while it is away, rising as stamina falls', () => {
    const { logic } = make();
    run(logic, 1, 1);
    expect(logic.closeness).toBe(0);
    run(logic, 1, 0.425);
    expect(logic.closeness).toBeCloseTo(0.5);
  });

  it('start() sends it away for a new or retried night', () => {
    const { logic, onKill } = make();
    shown(logic, 0.2);
    logic.update(0.1, 0);
    logic.start();
    expect(logic.shown).toBe(false);
    expect(logic.around).toBe(false);
    expect(logic.closeness).toBe(0);
    logic.update(0.1, 0);
    expect(onKill).toHaveBeenCalledTimes(2);
  });
});

describe('duckFor: dead air', () => {
  /** Where it showed: 40° off the centre of the view. */
  const SHOWN_AT = 40 * DEG;

  it('a mild duck where it shows', () => {
    expect(duckFor(SHOWN_AT, SHOWN_AT)).toBeCloseTo(T.duckEdge);
    expect(T.duckEdge).toBeLessThan(1);
    expect(T.duckEdge).toBeGreaterThanOrEqual(0.5);
  });

  it('no deeper with the view turned further away from it', () => {
    expect(duckFor(60 * DEG, SHOWN_AT)).toBeCloseTo(T.duckEdge);
  });

  it('deepens as the view comes round to it', () => {
    const wide = duckFor(35 * DEG, SHOWN_AT);
    const half = duckFor(25 * DEG, SHOWN_AT);
    const near = duckFor(15 * DEG, SHOWN_AT);
    expect(wide).toBeLessThan(T.duckEdge);
    expect(half).toBeLessThan(wide);
    expect(near).toBeLessThan(half);
  });

  it('is deepest at the look: near-silence, not a hard mute', () => {
    expect(duckFor(T.focusAngle, SHOWN_AT)).toBeCloseTo(T.duckFloor);
    expect(duckFor(0, SHOWN_AT)).toBeCloseTo(T.duckFloor);     // stared at, below holdBelow
    expect(T.duckFloor).toBeGreaterThan(0);
    expect(T.duckFloor).toBeLessThan(0.15);
  });

  it('out of view, or nowhere: no duck', () => {
    expect(duckFor(Infinity, SHOWN_AT)).toBe(1);
  });

  it('while the terminal screen covers the view, the mild duck holds', () => {
    expect(duckFor(null, SHOWN_AT)).toBeCloseTo(T.duckEdge);
  });

  it('showing inside the look already, it is the floor', () => {
    expect(duckFor(8 * DEG, 10 * DEG)).toBeCloseTo(T.duckFloor);
    expect(duckFor(20 * DEG, 10 * DEG)).toBeCloseTo(T.duckEdge);
  });
});
