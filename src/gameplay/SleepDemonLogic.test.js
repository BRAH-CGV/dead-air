import { describe, it, expect, vi } from 'vitest';
import {
  SleepDemonLogic, SLEEP_DEMON as T, closenessFor, focusAngleFor, presenceFor, sneakSpeedFor, creepFloorFor,
  angleToUpright, duckFor,
} from './SleepDemonLogic.js';

const DEG = Math.PI / 180;
/** In view and well off to one side: the corner of the eye, outside every
 *  look cone (the widest is 50°). */
const CORNER = 55 * DEG;

const unit = (x, y, z) => { const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; };
const toward = (from, to) => unit(to.x - from.x, to.y - from.y, to.z - from.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

describe('SLEEP_DEMON tuning', () => {
  it('shows below 0.85 stamina, 10 m away, and comes in to 0.8 m at empty', () => {
    expect(T.appearBelow).toBe(0.85);
    expect(T.farthest).toBe(10);
    expect(T.nearest).toBe(0.8);
  });

  it('the look that sends it away is a 50° cone at 85 % stamina, closing to 15° at 10 %', () => {
    expect(T.focusFar).toBeCloseTo(50 * DEG);
    expect(T.focusNear).toBeCloseTo(15 * DEG);
  });

  it('from 10 % it no longer fades from a look; from 5 % it walks in; at 1 % it smiles', () => {
    expect(T.holdBelow).toBeCloseTo(0.10);
    expect(T.walkBelow).toBeCloseTo(0.05);
    expect(T.smileBelow).toBeCloseTo(0.01);
  });

  it('fades in slowly wherever it shows: a presence, not a pop', () => {
    expect(T.fadeIn).toBeGreaterThanOrEqual(2);
    expect(T.fadeOut).toBeGreaterThan(0);
    expect(T.fadeOut).toBeLessThan(T.fadeIn);
  });

  it('some showings land behind the player by the roll; the rest in the periphery', () => {
    expect(T.behindChance).toBeGreaterThan(0);
    expect(T.behindChance).toBeLessThan(1);
    expect(T.ambushEdgeFar).toBeGreaterThan(1);
    expect(T.ambushEdgeNear).toBeGreaterThan(T.ambushEdgeFar);
    expect(T.ambushDistanceNear).toBeLessThan(T.ambushDistanceFar);
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

describe('focusAngleFor', () => {
  it('is 50° until it shows and 15° from 10 % stamina down', () => {
    expect(focusAngleFor(1)).toBeCloseTo(50 * DEG);
    expect(focusAngleFor(0.85)).toBeCloseTo(50 * DEG);
    expect(focusAngleFor(0.10)).toBeCloseTo(15 * DEG);
    expect(focusAngleFor(0)).toBeCloseTo(15 * DEG);
  });

  it('closes steadily in between', () => {
    expect(focusAngleFor(0.5)).toBeLessThan(focusAngleFor(0.6));
    expect(focusAngleFor(0.475)).toBeCloseTo(32.5 * DEG);   // halfway down, halfway in
  });
});

describe('presenceFor', () => {
  it('is faint — barely there — down to half stamina', () => {
    expect(presenceFor(0.84)).toBeCloseTo(T.faintest);
    expect(presenceFor(0.5)).toBeCloseTo(T.faintest);
    expect(T.faintest).toBeGreaterThan(0);
    expect(T.faintest).toBeLessThanOrEqual(0.35);
  });

  it('grows solid below half stamina', () => {
    expect(presenceFor(0.4)).toBeGreaterThan(T.faintest);
    expect(presenceFor(0.4)).toBeLessThan(1);
    expect(presenceFor(T.solidBelow)).toBe(1);
    expect(presenceFor(0)).toBe(1);
  });
});

describe('sneakSpeedFor and creepFloorFor', () => {
  it('creeps very slowly while the player is fresh, quicker as they tire', () => {
    expect(sneakSpeedFor(0.8)).toBeLessThan(0.15);
    expect(sneakSpeedFor(0.1)).toBeGreaterThan(sneakSpeedFor(0.5));
    expect(sneakSpeedFor(0)).toBeCloseTo(T.sneakNear);
  });

  it('keeps its distance while the player is fresh, and may come to arm\'s length at the end', () => {
    expect(creepFloorFor(0.84)).toBeGreaterThan(4.5);
    expect(creepFloorFor(0.5)).toBeGreaterThan(2.5);
    expect(creepFloorFor(0)).toBeCloseTo(T.stareFloor);
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
  let angle, standing;

  /** approach() walks it in `step` from where it stands, with no floor of
   *  its own: the floors these tests check are the logic's. */
  function make({ rand = () => 0.9, tuning = T, approach = step => (standing -= step), place } = {}) {
    angle = CORNER;
    standing = Infinity;
    const spies = {
      place: vi.fn(place ?? (spot => { standing = spot.distance; return true; })),
      hide: vi.fn(), onKill: vi.fn(), approach: vi.fn(approach), playerDrift: vi.fn(() => 0),
    };
    const logic = new SleepDemonLogic({ ...spies, lookAngle: () => angle, rand, tuning });
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
  });

  it('shows in the periphery a few seconds after the player tires, outside the look cone', () => {
    const { logic, place } = make();
    run(logic, 3.4, 0.425);                 // halfway: 3.5 s before it shows
    expect(logic.around).toBe(true);
    expect(place).not.toHaveBeenCalled();
    run(logic, 0.2, 0.425);
    expect(place).toHaveBeenCalledTimes(1);
    expect(place).toHaveBeenCalledWith({
      side: 1, distance: expect.closeTo(5.4, 5), edge: expect.closeTo(0.725, 5),
      focus: expect.closeTo(focusAngleFor(0.425), 5),
    });
  });

  it('the more tired the player, the nearer it stands and the nearer the middle of the view', () => {
    const a = make();
    shown(a.logic, 0.8);
    const b = make();
    shown(b.logic, 0.15);
    const [{ distance: far, edge: wide }] = a.place.mock.calls[0];
    const [{ distance: near, edge: narrow }] = b.place.mock.calls[0];
    expect(near).toBeLessThan(far);
    expect(narrow).toBeLessThan(wide);
  });

  it('by the roll it may show behind the player instead', () => {
    const { logic, place } = make({ rand: () => 0.1 });
    shown(logic, 0.5);
    const [spot] = place.mock.calls[0];
    expect(spot.ambush).toBe(true);
    expect(spot.edge).toBeGreaterThan(1);   // past the edge of the view: beside or behind
    expect(logic.ambush).toBe(true);
  });

  it('looked at inside the cone, it fades away, and is back later at the other side', () => {
    const { logic, place, hide } = make();
    shown(logic, 0.5);
    angle = 30 * DEG;                       // the cone at 0.5 is ~33.7°
    logic.update(0.1, 0.5);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(logic.shown).toBe(false);

    angle = CORNER;
    const gone = T.goneFar + (T.goneNear - T.goneFar) * closenessFor(0.5);
    run(logic, gone - 0.15, 0.5);
    expect(place).toHaveBeenCalledTimes(1);
    run(logic, 0.3, 0.5);
    expect(place).toHaveBeenCalledTimes(2);
    expect(place).toHaveBeenLastCalledWith(expect.objectContaining({ side: -1 }));
  });

  it('at 85 % a glance within 50° sends it away; by 15 % that glance no longer counts', () => {
    const fresh = make();
    shown(fresh.logic, 0.84);
    angle = 45 * DEG;
    fresh.logic.update(0.1, 0.84);
    expect(fresh.hide).toHaveBeenCalled();

    const tired = make();
    shown(tired.logic, 0.15);
    angle = 25 * DEG;
    tired.logic.update(0.1, 0.15);
    expect(tired.hide).not.toHaveBeenCalled();
    angle = 15 * DEG;
    tired.logic.update(0.1, 0.15);
    expect(tired.hide).toHaveBeenCalled();
  });

  it('never teleports: as stamina falls and while it is unseen, it is placed only once', () => {
    const { logic, place } = make();
    shown(logic, 0.8);
    for (let s = 0.8; s > 0.12; s -= 0.001) {
      angle = Math.round(s * 1000) % 3 ? CORNER : Infinity;   // seen, then not, then seen
      logic.update(0.1, s);
    }
    expect(place).toHaveBeenCalledTimes(1);
    expect(logic.shown).toBe(true);
  });

  it('unseen, it creeps in — very slowly while the player is fresh', () => {
    const { logic, approach } = make();
    shown(logic, 0.7);
    const before = logic.distance;
    approach.mockClear();
    angle = Infinity;
    run(logic, 1, 0.7);
    expect(approach).toHaveBeenCalledTimes(10);
    expect(approach.mock.calls[0][1]).toBe(true);           // unseen: the spot need not be in view
    expect(logic.distance).toBeCloseTo(before - sneakSpeedFor(0.7), 5);
    expect(before - logic.distance).toBeLessThan(0.15);
    expect(logic.sneaking).toBe(true);
    expect(logic.walking).toBe(false);
  });

  it('seen, it holds still: footsteps only while it moves', () => {
    const { logic, approach } = make();
    shown(logic, 0.3);
    approach.mockClear();
    run(logic, 2, 0.3);
    expect(approach).not.toHaveBeenCalled();
    expect(logic.sneaking).toBe(false);
    expect(logic.walking).toBe(false);
  });

  it('unseen it comes no nearer than the creep floor for the stamina', () => {
    const { logic } = make();
    shown(logic, 0.7);
    angle = Infinity;
    run(logic, 120, 0.7);
    expect(logic.distance).toBeCloseTo(creepFloorFor(0.7), 5);
    expect(logic.sneaking).toBe(false);     // there: no more steps
  });

  it('shut out (a wall in the way) for a while, it fades in somewhere new', () => {
    const { logic, place, approach } = make();
    shown(logic, 0.5);
    angle = Infinity;
    approach.mockImplementation(() => false);
    run(logic, T.stuckAfter - 0.2, 0.5);
    expect(place).toHaveBeenCalledTimes(1);
    run(logic, 0.4, 0.5);
    expect(place).toHaveBeenCalledTimes(2);
  });

  it('a look that banishes it gives back the ground it crept', () => {
    const { logic, place } = make();
    shown(logic, 0.5);
    const ruled = place.mock.calls[0][0].distance;
    angle = Infinity;
    run(logic, 5, 0.5);
    expect(logic.distance).toBeLessThan(ruled);
    angle = 0;
    logic.update(0.1, 0.5);
    angle = CORNER;
    run(logic, 6, 0.5);
    expect(place.mock.calls.at(-1)[0].distance).toBeCloseTo(ruled, 5);
  });

  it('below 10 % it no longer fades from a look: it stands there', () => {
    const { logic, hide } = make();
    shown(logic, 0.08);
    angle = 0;
    run(logic, 1, 0.08);
    expect(hide).not.toHaveBeenCalled();
    expect(logic.shown).toBe(true);
    expect(logic.walking).toBe(false);      // above 5 %: it only stares
  });

  it('below 5 % it walks in on the player, seen or not', () => {
    const { logic, approach } = make();
    run(logic, 1.3, 0.04);                  // just shown: 1.24 m off, room to walk
    expect(logic.shown).toBe(true);
    const before = logic.distance;
    approach.mockClear();
    angle = 0;
    run(logic, 1, 0.04);
    expect(approach.mock.calls[0][1]).toBe(false);
    expect(logic.walking).toBe(true);
    expect(logic.distance).toBeCloseTo(before - T.stareSpeed, 5);
    angle = Infinity;
    logic.update(0.1, 0.04);
    expect(logic.sneaking).toBe(true);
  });

  it('a player who backs away below 5 % is walked after — half the retreat', () => {
    const { logic, playerDrift } = make();
    run(logic, 1.3, 0.04);
    angle = 0;
    playerDrift.mockReturnValue(1);
    const before = logic.distance;
    logic.update(0.1, 0.04);
    expect(logic.distance).toBeCloseTo(before - (T.stareSpeed * 0.1 + T.stareFollow), 5);
  });

  it('a ration back above 10 % restores the fade from a look', () => {
    const { logic, hide } = make();
    shown(logic, 0.08);
    angle = 0;
    run(logic, 1, 0.08);
    expect(hide).not.toHaveBeenCalled();
    logic.update(0.1, 0.43);
    expect(hide).toHaveBeenCalled();
  });

  it('goes once the player is awake enough again', () => {
    const { logic, hide } = make();
    shown(logic, 0.5);
    logic.update(0.1, 0.9);
    expect(hide).toHaveBeenCalled();
    expect(logic.around).toBe(false);
  });

  it('presence follows the stamina: faint until half, solid by 30 %', () => {
    const { logic } = make();
    shown(logic, 0.7);
    expect(logic.presence).toBeCloseTo(T.faintest);
    logic.update(0.1, 0.2);
    expect(logic.presence).toBe(1);
  });

  it('smiles from 1 % stamina, and keeps it through the kill', () => {
    const { logic, onKill } = make();
    shown(logic, 0.3);
    expect(logic.smiling).toBe(false);
    logic.update(0.1, 0.02);
    expect(logic.smiling).toBe(false);
    logic.update(0.1, 0.01);
    expect(logic.smiling).toBe(true);
    logic.update(0.1, 0);
    logic.update(0.1, 0);
    expect(onKill).toHaveBeenCalledTimes(1);
    expect(logic.smiling).toBe(true);
  });

  it('with no room on its side it tries the other one; with none either side it waits', () => {
    const one = make({ place: spot => spot.side === -1 });
    shown(one.logic, 0.5);
    expect(one.logic.side).toBe(-1);

    const none = make({ place: () => false });
    run(none.logic, 7, 0.5);
    expect(none.logic.shown).toBe(false);
    expect(none.hide).toHaveBeenCalled();
    const calls = none.place.mock.calls.length;
    run(none.logic, T.retryAfter + 0.05, 0.5);
    expect(none.place.mock.calls.length).toBeGreaterThan(calls);
  });

  it('while the view is covered (the terminal), its first showing is out of sight, and it creeps', () => {
    const { logic, place, approach } = make();
    angle = null;
    run(logic, 7, 0.5);
    expect(place.mock.calls[0][0].ambush).toBe(true);
    approach.mockClear();
    run(logic, 1, 0.5);
    expect(approach).toHaveBeenCalled();
    expect(approach.mock.calls[0][1]).toBe(true);
    expect(logic.sneaking).toBe(true);
  });

  it('the view covered while it stands in view, it slips round out of sight', () => {
    const { logic, place, hide } = make();
    shown(logic, 0.5);
    angle = null;
    logic.update(0.1, 0.5);
    expect(place).toHaveBeenCalledTimes(2);
    expect(place.mock.calls[1][0].ambush).toBe(true);
    expect(hide).not.toHaveBeenCalled();
  });

  it('turned off (stareDown: false), it never moves on its own', () => {
    const { logic, approach } = make({ tuning: { ...T, stareDown: false } });
    shown(logic, 0.04);
    angle = Infinity;
    run(logic, 2, 0.04);
    expect(approach).not.toHaveBeenCalled();
  });

  it('start() sends it away for a new or retried night', () => {
    const { logic } = make();
    shown(logic, 0.005);
    logic.start();
    expect(logic.shown).toBe(false);
    expect(logic.around).toBe(false);
    expect(logic.smiling).toBe(false);
    expect(logic.distance).toBe(Infinity);
  });
});

describe('duckFor: dead air', () => {
  /** Where it showed: 40° off the centre of the view. */
  const SHOWN_AT = 40 * DEG;
  /** The look as it is by the time the dead air matters: fatigue sets in at
   *  about half asleep, where the cone has closed to its floor. */
  const FOCUS = T.focusNear;

  it('a mild duck where it shows', () => {
    expect(duckFor(SHOWN_AT, SHOWN_AT, FOCUS)).toBeCloseTo(T.duckEdge);
    expect(T.duckEdge).toBeLessThan(1);
    expect(T.duckEdge).toBeGreaterThanOrEqual(0.5);
  });

  it('no deeper with the view turned further away from it', () => {
    expect(duckFor(60 * DEG, SHOWN_AT, FOCUS)).toBeCloseTo(T.duckEdge);
  });

  it('deepens as the view comes round to it', () => {
    const wide = duckFor(36 * DEG, SHOWN_AT, FOCUS);
    const half = duckFor(34 * DEG, SHOWN_AT, FOCUS);
    const near = duckFor(31 * DEG, SHOWN_AT, FOCUS);
    expect(wide).toBeLessThan(T.duckEdge);
    expect(half).toBeLessThan(wide);
    expect(near).toBeLessThan(half);
  });

  it('is deepest at the look: near-silence, not a hard mute', () => {
    expect(duckFor(FOCUS, SHOWN_AT, FOCUS)).toBeCloseTo(T.duckFloor);
    expect(duckFor(0, SHOWN_AT, FOCUS)).toBeCloseTo(T.duckFloor);   // stared at, below holdBelow
    expect(T.duckFloor).toBeGreaterThan(0);
    expect(T.duckFloor).toBeLessThan(0.15);
  });

  it('out of view, or nowhere: no duck', () => {
    expect(duckFor(Infinity, SHOWN_AT, FOCUS)).toBe(1);
  });

  it('while the terminal screen covers the view, the mild duck holds', () => {
    expect(duckFor(null, SHOWN_AT, FOCUS)).toBeCloseTo(T.duckEdge);
  });

  it('the look closes in as stamina falls, so the floor arrives nearer the centre, too', () => {
    expect(duckFor(20 * DEG, SHOWN_AT, focusAngleFor(0.8))).toBeCloseTo(T.duckFloor);
    expect(duckFor(20 * DEG, SHOWN_AT, focusAngleFor(0.1))).toBeGreaterThan(T.duckFloor);
  });

  it('showing inside the look already, it is the floor', () => {
    const focus = 30 * DEG;
    expect(duckFor(8 * DEG, 10 * DEG, focus)).toBeCloseTo(T.duckFloor);
    expect(duckFor(35 * DEG, 10 * DEG, focus)).toBeCloseTo(T.duckEdge);   // turned away: never deeper
  });
});
