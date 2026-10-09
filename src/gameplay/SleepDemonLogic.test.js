import { describe, it, expect, vi } from 'vitest';
import { SleepDemonLogic, SLEEP_DEMON as T, closenessFor, focusAngleFor, angleToUpright, duckFor } from './SleepDemonLogic.js';
import { STAMINA } from './Stamina.js';

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

  it('the look that counts starts at 40° and closes to 5° as stamina falls', () => {
    expect(T.focusFar).toBeCloseTo(40 * DEG);
    expect(T.focusNear).toBeCloseTo(5 * DEG);
    expect(T.focusNear).toBeLessThan(T.focusFar);
  });

  it('past half asleep it no longer flees a look: the hold', () => {
    expect(T.holdBelow).toBeCloseTo(0.45);
  });

  it('while the view is covered it stands past the edge of the view, further round as it nears', () => {
    expect(T.ambushEdgeFar).toBeGreaterThan(1);
    expect(T.ambushEdgeNear).toBeGreaterThan(T.ambushEdgeFar);
  });

  it('out of sight it may loom much nearer than standing in view ever allows', () => {
    expect(T.ambushDistanceFar).toBeLessThan(T.farthest);
    expect(T.ambushDistanceNear).toBeLessThan(T.ambushDistanceFar);
    expect(T.ambushDistanceNear).toBeGreaterThan(T.nearest);
  });

  it('out of sight it sneaks in quicker than the creep, and some showings land that way by the roll', () => {
    expect(T.sneakSpeed).toBeGreaterThan(T.stareSpeed);
    expect(T.sneakSpeed).toBeGreaterThan(0);
    expect(T.behindChance).toBeGreaterThan(0);
    expect(T.behindChance).toBeLessThan(1);
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
  it('is the widest look until it shows, and the narrowest from the hold down', () => {
    expect(focusAngleFor(1)).toBeCloseTo(T.focusFar);
    expect(focusAngleFor(T.appearBelow)).toBeCloseTo(T.focusFar);
    expect(focusAngleFor(T.holdBelow)).toBeCloseTo(T.focusNear);
    expect(focusAngleFor(0)).toBeCloseTo(T.focusNear);
  });

  it('closes as stamina falls: the tireder the player, the nearer the centre a look can reach it', () => {
    expect(focusAngleFor(0.7)).toBeLessThan(focusAngleFor(0.8));
    expect(focusAngleFor(0.5)).toBeLessThan(focusAngleFor(0.6));
    // Halfway from the show to the hold is halfway down the cone.
    expect(focusAngleFor(0.65)).toBeCloseTo((T.focusFar + T.focusNear) / 2);
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
    shown(logic, 0.5);
    angle = 5 * DEG;
    logic.update(0.1, 0.5);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(logic.shown).toBe(false);

    angle = CORNER;
    run(logic, 3.6, 0.5);                   // gone 3.7 s at this stamina
    expect(place).toHaveBeenCalledTimes(1);
    run(logic, 0.3, 0.5);
    expect(place).toHaveBeenCalledTimes(2);
    expect(place).toHaveBeenLastCalledWith(expect.objectContaining({ side: -1 }));
  });

  it('the tireder the player, the nearer the centre a look must be to count', () => {
    const awake = make();
    shown(awake.logic, 0.8);
    angle = 30 * DEG;                       // inside the wide cone of a barely-tired player
    awake.logic.update(0.1, 0.8);
    expect(awake.hide).toHaveBeenCalledTimes(1);

    const tired = make();
    shown(tired.logic, 0.5);
    angle = 20 * DEG;                       // outside the narrow cone: the peripheral life survives
    tired.logic.update(0.1, 0.5);
    expect(tired.hide).not.toHaveBeenCalled();
    angle = 5 * DEG;                        // close to the centre: gone
    tired.logic.update(0.1, 0.5);
    expect(tired.hide).toHaveBeenCalledTimes(1);
  });

  it('comes back sooner the more tired the player is', () => {
    const tired = make();
    shown(tired.logic, 0.5);
    angle = 0;
    run(tired.logic, 3.9, 0.5);             // gone 3.7 s: back already
    expect(tired.place).toHaveBeenCalledTimes(2);

    const awake = make();
    shown(awake.logic, 0.8);
    angle = 0;
    awake.logic.update(0.1, 0.8);
    angle = CORNER;
    run(awake.logic, 5, 0.8);               // gone 5.7 s: not yet
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

  it('once past the hold (more than about half asleep) it no longer flees a look', () => {
    const { logic, hide } = make();
    shown(logic, 0.4);
    angle = 0;
    run(logic, 3, 0.4);
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
    expect(place).toHaveBeenCalledTimes(2);  // once more: it slips out of sight
  });

  it('the view covered, it slips round out of sight at once: much nearer, past the edge of the view', () => {
    const { logic, place, hide } = make();
    shown(logic, 0.425);
    expect(logic.ambush).toBe(false);
    angle = null;
    logic.update(0.1, 0.425);
    expect(place).toHaveBeenCalledTimes(2);
    const [[before], [after]] = place.mock.calls;
    // Nobody is watching the room: it may loom — halfway, at this stamina,
    // to the nearest it would ever dare stand in view.
    expect(after).toEqual({
      ...before,
      distance: expect.closeTo((T.ambushDistanceFar + T.ambushDistanceNear) / 2, 5),
      edge: expect.any(Number),
      ambush: true,
    });
    expect(after.distance).toBeLessThan(before.distance);
    expect(after.edge).toBeGreaterThan(1);
    expect(hide).not.toHaveBeenCalled();
    expect(logic.shown).toBe(true);
    expect(logic.ambush).toBe(true);
  });

  it('first showing while the view is covered, it shows out of sight', () => {
    const { logic, place } = make();
    angle = null;
    shown(logic, 0.425);
    expect(place).toHaveBeenCalledTimes(1);
    expect(place.mock.calls[0][0]).toMatchObject({ ambush: true, side: 1 });
    // Half asleep: halfway between the far loom and the nearest.
    expect(place.mock.calls[0][0].distance).toBeCloseTo((T.ambushDistanceFar + T.ambushDistanceNear) / 2, 5);
    expect(logic.ambush).toBe(true);
  });

  it('while the player works it steps in band by band, each time out of sight, and further round', () => {
    const { logic, place } = make();
    angle = null;
    shown(logic, 0.8);
    logic.update(0.1, 0.7);                 // into the second band
    logic.update(0.1, 0.05);                // near empty
    const spots = place.mock.calls.map(([spot]) => spot);
    expect(spots).toHaveLength(3);
    for (const spot of spots) expect(spot.ambush).toBe(true);
    expect(spots[1].distance).toBeLessThan(spots[0].distance);
    expect(spots[2].distance).toBeLessThan(spots[1].distance);
    expect(spots[1].edge).toBeGreaterThan(spots[0].edge);
    expect(spots[2].edge).toBeGreaterThan(spots[1].edge);
    expect(spots[0].edge).toBeGreaterThanOrEqual(T.ambushEdgeFar);
    expect(spots[2].edge).toBeLessThanOrEqual(T.ambushEdgeNear);
    expect(spots[0].distance).toBeLessThan(T.ambushDistanceFar);   // looms: never the out-in-view distance
    expect(spots[2].distance).toBeLessThan(1.5);                   // near empty: right there
  });

  it('with no room out of sight on either side it waits, and tries again a moment later', () => {
    let room = true;
    const { logic, place, hide } = make({ place: ({ ambush }) => room || !ambush });
    shown(logic, 0.425);
    room = false;
    angle = null;
    logic.update(0.1, 0.425);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(logic.shown).toBe(false);
    expect(logic.ambush).toBe(false);
    const tries = place.mock.calls.length;
    room = true;
    run(logic, 0.3, 0.425);
    expect(place.mock.calls.length).toBeGreaterThan(tries);
    expect(logic.ambush).toBe(true);
  });

  it('the screen closed, the usual rules come back: out of view for 1.5 s, it finds the edge of the view', () => {
    const { logic, place } = make();
    shown(logic, 0.425);
    angle = null;
    logic.update(0.1, 0.425);               // out of sight, behind the player
    angle = Infinity;                       // the screen closed: still out of view
    run(logic, 1.4, 0.425);
    expect(place).toHaveBeenCalledTimes(2);
    run(logic, 0.2, 0.425);
    expect(place).toHaveBeenCalledTimes(3);
    expect(place.mock.calls[2][0].ambush).toBeUndefined();
    expect(place.mock.calls[2][0].edge).toBeLessThan(1);
    expect(logic.ambush).toBe(false);
  });

  it('the screen closed, turning round to look at it sends it away', () => {
    const { logic, hide } = make();
    shown(logic, 0.5);
    angle = null;
    logic.update(0.1, 0.5);
    angle = 5 * DEG;
    logic.update(0.1, 0.5);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(logic.shown).toBe(false);
    expect(logic.ambush).toBe(false);
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

describe('the stare-down, below holdBelow', () => {
  /** Where the player's view is from it, and how far off it stands. */
  let angle, standing;

  /** approach() walks it in `step` from where it stands, with no floor of
   *  its own: the floor these tests check is the logic's. */
  function make({ tuning = T, approach = step => (standing -= step), playerDrift = () => 0 } = {}) {
    angle = CORNER;
    standing = Infinity;
    const spies = {
      place: vi.fn(spot => { standing = spot.distance; return true; }),
      hide: vi.fn(), onKill: vi.fn(), approach: vi.fn(approach), playerDrift: vi.fn(playerDrift),
    };
    const logic = new SleepDemonLogic({ ...spies, lookAngle: () => angle, rand: () => 0.9, tuning });
    return { logic, ...spies };
  }

  function run(logic, seconds, stamina, dt = 0.1) {
    for (let t = 0; t < seconds - 1e-9; t += dt) logic.update(dt, stamina);
  }

  /** At `stamina`, shown and seen in the corner of the eye. */
  function shown(logic, stamina) {
    run(logic, 2, stamina);
    expect(logic.shown).toBe(true);
  }

  /** Where the rules alone stand it at `stamina`. */
  const ruled = stamina => T.farthest + (T.nearest - T.farthest) * closenessFor(stamina);

  it('is on, a slow walk, down to arm\'s length', () => {
    expect(T.stareDown).toBe(true);
    expect(T.stareSpeed).toBeGreaterThan(0);
    expect(T.stareSpeed).toBeLessThan(0.2);
    expect(T.stareFloor).toBeGreaterThanOrEqual(0.45);
    expect(T.stareFloor).toBeLessThanOrEqual(0.55);
  });

  it('stared at from the hold on, arm\'s length arrives as the last of the stamina runs out', () => {
    // The real rules on a real shift: stamina draining, the player watching
    // it from the corner of the eye (never a look it would have to flee).
    const { logic } = make();
    let stamina = 1;
    let arrivedAt = null;
    for (let t = 0; t < 240; t += 0.1) {
      stamina = Math.max(0, stamina - STAMINA.drainPerSecond * 0.1);
      logic.update(0.1, stamina);
      if (arrivedAt === null && logic.distance <= T.stareFloor + 1e-9) arrivedAt = t;
    }
    expect(arrivedAt).not.toBeNull();
    expect(arrivedAt).toBeGreaterThan(0.9 * 240);   // not there early, looming
    expect(arrivedAt).toBeLessThan(240);            // and there before the kill
  });

  it('stared at, it walks in over dt, and never past the floor', () => {
    const { logic, hide } = make();
    shown(logic, 0.05);
    angle = 0;
    const before = logic.distance;
    logic.update(0.1, 0.05);
    expect(logic.distance).toBeCloseTo(before - T.stareSpeed * 0.1);
    expect(standing).toBeCloseTo(logic.distance);
    run(logic, 60, 0.05);
    expect(logic.distance).toBeCloseTo(T.stareFloor);
    expect(standing).toBeGreaterThanOrEqual(T.stareFloor - 1e-9);
    expect(hide).not.toHaveBeenCalled();
    expect(logic.shown).toBe(true);
  });

  it('in the corner of the eye it walks in too', () => {
    const { logic } = make();
    shown(logic, 0.05);
    const before = logic.distance;
    run(logic, 1, 0.05);
    expect(logic.distance).toBeCloseTo(before - T.stareSpeed);
  });

  it('a player who backs away is walked after — half the retreat, no more: they gain ground, it doesn\'t stick', () => {
    const away = 0.03;                      // metres the eye backs off each frame
    const { logic } = make({
      playerDrift: () => away,              // what the scene reports back, frame by frame
      // The gap as the scene sees it: the retreat grows it, the step closes it.
      approach: step => (standing = Math.max(T.stareFloor, standing + away - step)),
    });
    shown(logic, 0.05);
    const before = logic.distance;
    run(logic, 4, 0.05);                    // 1.2 m of retreat
    // The step is the creep plus stareFollow of the retreat: the demon walks
    // after them, the player keeps the rest of the ground.
    const net = away - (T.stareSpeed * 0.1 + away * T.stareFollow);
    expect(logic.distance).toBeCloseTo(before + 40 * net, 5);
    expect(logic.distance).toBeGreaterThan(before);      // they still won ground
    expect(logic.walking).toBe(true);
    expect(T.stareFollow).toBeCloseTo(0.5);
  });

  it('walking is up only while a step is taken: at the floor, or out of view, it is off', () => {
    const { logic } = make();
    shown(logic, 0.05);
    logic.update(0.1, 0.05);
    expect(logic.walking).toBe(true);
    angle = Infinity;
    logic.update(0.1, 0.05);
    expect(logic.walking).toBe(false);      // out of sight: the sneak, not the walk-down
    expect(logic.sneaking).toBe(true);
    angle = CORNER;
    run(logic, 60, 0.05);
    logic.update(0.1, 0.05);
    expect(logic.walking).toBe(false);      // at arm's length: nothing left to walk
    expect(logic.closingIn).toBeCloseTo(1);
  });

  it('out of sight completely, it sneaks: the rules ask the scene to step it in unseen', () => {
    const { logic, approach } = make();
    shown(logic, 0.05);
    approach.mockClear();
    angle = Infinity;
    run(logic, 0.5, 0.05);                  // half a second of sneak: room to spare
    expect(approach).toHaveBeenCalled();
    expect(approach.mock.calls[0][1]).toBe(true);
    expect(logic.sneaking).toBe(true);
    expect(logic.walking).toBe(false);      // the sneak is not the walk-down: nothing slows down
  });

  it('behind the terminal screen it holds where it slipped to', () => {
    const { logic, approach } = make();
    shown(logic, 0.05);
    approach.mockClear();
    angle = null;
    run(logic, 5, 0.05);
    expect(approach).not.toHaveBeenCalled();
  });

  it('a step it can\'t take, it holds, and tries again the next frame', () => {
    let room = false;
    const { logic, approach } = make({ approach: step => (room ? (standing -= step) : false) });
    shown(logic, 0.05);
    const before = logic.distance;
    run(logic, 1, 0.05);
    expect(logic.distance).toBe(before);
    room = true;
    const tries = approach.mock.calls.length;
    logic.update(0.1, 0.05);
    expect(approach.mock.calls.length).toBe(tries + 1);
    expect(logic.distance).toBeLessThan(before);
  });

  it('closingIn: 0 until it walks, 1 at arm\'s length', () => {
    const { logic } = make();
    run(logic, 4, 0.5);                     // shows 3.7 s in, above the hold: standing, not walking
    expect(logic.shown).toBe(true);
    expect(logic.closingIn).toBe(0);
    shown(logic, 0.05);
    expect(logic.closingIn).toBeGreaterThan(0);
    expect(logic.closingIn).toBeLessThan(1);
    run(logic, 60, 0.05);
    expect(logic.closingIn).toBeCloseTo(1);
  });

  it('a look away doesn\'t send it back out: it shows again no farther than it had come', () => {
    // The walk-down alone: the sneak has its own describe, below.
    const { logic, place } = make({ tuning: { ...T, sneakSpeed: 0 } });
    shown(logic, 0.05);
    run(logic, 3, 0.05);
    const walked = logic.distance;
    angle = Infinity;
    run(logic, T.lostAfter + 0.2, 0.05);
    expect(place).toHaveBeenCalledTimes(2);
    expect(place.mock.calls[1][0].distance).toBeCloseTo(walked);

    angle = CORNER;
    run(logic, 60, 0.05);                   // to arm's length; it can't show nearer than it needs room for
    angle = Infinity;
    run(logic, T.lostAfter + 0.2, 0.05);
    expect(place.mock.calls.at(-1)[0].distance).toBeCloseTo(T.minDistance);
  });

  it('above holdBelow nothing changes: seen, it stands, and a look sends it off', () => {
    const { logic, approach, hide } = make();
    run(logic, 4, 0.5);                     // shows 3.7 s in, above the hold
    expect(logic.shown).toBe(true);
    run(logic, 3, 0.5);
    expect(approach).not.toHaveBeenCalled();
    angle = 0;
    logic.update(0.1, 0.5);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('a ration back above holdBelow restores the flee and the return', () => {
    const { logic, place, hide, approach } = make();
    shown(logic, 0.05);
    run(logic, 5, 0.05);
    logic.update(0.1, 0.55);                // a ration: 0.35 back, up out of the hold
    expect(place).toHaveBeenCalledTimes(2);
    expect(place.mock.calls[1][0].distance).toBeCloseTo(ruled(0.55));
    expect(logic.closingIn).toBe(0);
    approach.mockClear();
    run(logic, 1, 0.55);
    expect(approach).not.toHaveBeenCalled();

    angle = 0;
    logic.update(0.1, 0.55);
    expect(hide).toHaveBeenCalledTimes(1);
    angle = CORNER;
    run(logic, 6, 0.55);
    expect(place).toHaveBeenCalledTimes(3);
    expect(place.mock.calls[2][0].side).toBe(-1);
    expect(place.mock.calls[2][0].distance).toBeCloseTo(ruled(0.55));
  });

  it('turned off, or at a speed of 0, it only stands there, as before', () => {
    for (const tuning of [{ ...T, stareDown: false }, { ...T, stareSpeed: 0, sneakSpeed: 0 }]) {
      const { logic, approach, place } = make({ tuning });
      shown(logic, 0.05);
      angle = 0;
      run(logic, 10, 0.05);
      angle = Infinity;
      run(logic, T.lostAfter + 0.2, 0.05);
      expect(approach).not.toHaveBeenCalled();
      expect(place.mock.calls.at(-1)[0].distance).toBeCloseTo(ruled(0.05));
      expect(logic.closingIn).toBe(0);
    }
  });

  it('at empty it takes the player, as before, once', () => {
    const { logic, onKill } = make();
    shown(logic, 0.05);
    run(logic, 3, 0.05);
    logic.update(0.1, 0);
    run(logic, 2, 0);
    expect(onKill).toHaveBeenCalledTimes(1);
  });

  it('start() ends a stare-down', () => {
    const { logic, place } = make();
    shown(logic, 0.05);
    run(logic, 10, 0.05);
    logic.start();
    expect(logic.closingIn).toBe(0);
    run(logic, 2, 0.05);
    expect(place.mock.calls.at(-1)[0].distance).toBeCloseTo(ruled(0.05));
  });
});

describe('the sneak, out of sight completely', () => {
  /** Where the player's view is from it, and how far off it stands. */
  let angle, standing;

  /** approach() walks it in `step` from where it stands, with no floor of
   *  its own: the floor these tests check is the logic's. */
  function make({ tuning = T, approach = step => (standing -= step), playerDrift = () => 0 } = {}) {
    angle = CORNER;
    standing = Infinity;
    const spies = {
      place: vi.fn(spot => { standing = spot.distance; return true; }),
      hide: vi.fn(), onKill: vi.fn(), approach: vi.fn(approach), playerDrift: vi.fn(playerDrift),
    };
    const logic = new SleepDemonLogic({ ...spies, lookAngle: () => angle, rand: () => 0.9, tuning });
    return { logic, ...spies };
  }

  function run(logic, seconds, stamina, dt = 0.1) {
    for (let t = 0; t < seconds - 1e-9; t += dt) logic.update(dt, stamina);
  }

  it('turned away from, it comes in every frame, unseen — above the hold too', () => {
    const { logic, approach, hide } = make();
    run(logic, 4, 0.5);                     // shows 3.7 s in, above the hold
    expect(logic.shown).toBe(true);
    const before = logic.distance;
    approach.mockClear();
    angle = Infinity;                       // turned away completely
    run(logic, 1, 0.5);
    expect(approach).toHaveBeenCalledTimes(10);
    expect(approach.mock.calls[0][1]).toBe(true);
    expect(logic.distance).toBeCloseTo(standing, 5);
    expect(logic.distance).toBeCloseTo(before - T.sneakSpeed, 5);
    expect(logic.sneaking).toBe(true);
    expect(logic.walking).toBe(false);      // it is not the walk-down: nothing slows down
    expect(hide).not.toHaveBeenCalled();
  });

  it('nobody looks for long enough and it slips to a new spot — nearer than it stood', () => {
    const { logic, place } = make();
    run(logic, 4, 0.5);                     // out at the edge of the view
    const before = logic.distance;
    expect(place).toHaveBeenCalledTimes(1);
    angle = Infinity;
    run(logic, T.lostAfter + 0.2, 0.5);     // creeping all the while, then out of sight
    expect(place).toHaveBeenCalledTimes(2);
    const [{ distance }] = place.mock.calls[1];
    const closed = before - distance;
    expect(closed).toBeGreaterThan(T.sneakSpeed * 1.2);   // about lostAfter of sneak
    expect(closed).toBeLessThan(T.sneakSpeed * 1.8);
    expect(distance).toBeGreaterThanOrEqual(T.minDistance - 1e-9);
  });

  it('it comes no nearer than arm\'s length, however long nobody looks', () => {
    const { logic } = make();
    run(logic, 4, 0.5);
    angle = Infinity;
    run(logic, 60, 0.5);
    expect(logic.distance).toBeGreaterThanOrEqual(T.stareFloor - 1e-9);
    expect(logic.distance).toBeLessThan(T.minDistance + 0.1);   // at the floor, or just re-shown
    expect(logic.shown).toBe(true);
  });

  it('a look that banishes it gives the ground back', () => {
    const { logic, place } = make();
    run(logic, 4, 0.5);
    const before = logic.distance;
    angle = Infinity;
    run(logic, 1, 0.5);                     // 0.9 m of sneak
    angle = 0;                              // turn and stare: banished, above the hold
    logic.update(0.1, 0.5);
    expect(logic.shown).toBe(false);
    angle = CORNER;
    run(logic, 4.5, 0.5);                   // gone 3.7 s at this stamina
    expect(place.mock.calls.at(-1)[0].distance).toBeCloseTo(before, 5);
  });

  it('a step it can\'t take, it holds where it was, and tries again the next frame', () => {
    let room = false;
    const { logic, approach } = make({ approach: step => (room ? (standing -= step) : false) });
    run(logic, 2, 0.05);
    const before = logic.distance;
    angle = Infinity;
    run(logic, 1, 0.05);
    expect(logic.distance).toBe(before);    // never through what hides it
    expect(logic.sneaking).toBe(false);
    room = true;
    const tries = approach.mock.calls.length;
    logic.update(0.1, 0.05);
    expect(approach.mock.calls.length).toBe(tries + 1);
    expect(logic.distance).toBeLessThan(before);
  });

  it('a player who backs away is crept after unseen too: the sneak takes up the retreat with it', () => {
    const away = 0.03;
    const { logic } = make({
      playerDrift: () => away,
      approach: step => (standing = Math.max(T.stareFloor, standing + away - step)),
    });
    run(logic, 4, 0.5);                     // shows at 3.7 s
    const before = logic.distance;
    angle = Infinity;
    run(logic, 1, 0.5);
    const net = away - (T.sneakSpeed * 0.1 + away * T.stareFollow);
    expect(logic.distance).toBeCloseTo(before + 10 * net, 5);
    expect(net).toBeLessThan(0);            // the sneak beats a slow backstep: it closes
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
    expect(duckFor(20 * DEG, SHOWN_AT, focusAngleFor(0.5))).toBeGreaterThan(T.duckFloor);
  });

  it('showing inside the look already, it is the floor', () => {
    const focus = 30 * DEG;
    expect(duckFor(8 * DEG, 10 * DEG, focus)).toBeCloseTo(T.duckFloor);
    expect(duckFor(35 * DEG, 10 * DEG, focus)).toBeCloseTo(T.duckEdge);   // turned away: never deeper
  });
});
