import { describe, it, expect, vi } from 'vitest';
import { StormOutage, STORM_OUTAGE } from './StormOutage.js';
import { PowerGrid } from '../systems/PowerGrid.js';

// ─────────────────────────────────────────────
// StormOutage — a sandstorm may take the power out, once
// ─────────────────────────────────────────────

function makeSound() {
  return {
    isPlaying: false, volume: 0,
    play: vi.fn(function () { this.isPlaying = true; }),
    stop: vi.fn(function () { this.isPlaying = false; }),
    setVolume: vi.fn(function (v) { this.volume = v; }),
  };
}

/** Every storm cuts the power unless a test says otherwise (`chance`). */
function makeRig({ random = () => 0.5, chance = 1, night = 1, sureNights } = {}) {
  const listeners = [];
  const controller = { state: 'playing', nightNumber: night, onNightStart: fn => { listeners.push(fn); return () => {}; } };
  // A storm the test moves through by hand.
  const sandstorm = { level: 1, stormId: 1, stormProgress: 0 };
  const grid = new PowerGrid();
  const cutPower = vi.fn(() => grid.setOn(false));
  const sounds = { flicker: makeSound() };
  const outage = new StormOutage({ controller, sandstorm, grid, cutPower, sounds, random, chance, sureNights });
  outage.onStart();
  return { outage, controller, sandstorm, grid, cutPower, sounds, startNight: n => listeners.forEach(fn => fn(n)) };
}

const run = (c, seconds, step = 0.05) => {
  for (let t = 0; t < seconds - 1e-9; t += step) c.onUpdate(step);
};

/** Walk the storm from `from` to `to` of the way through, a little each frame. */
function through(rig, from, to, frames = 40) {
  for (let i = 0; i <= frames; i++) {
    rig.sandstorm.stormProgress = from + (to - from) * (i / frames);
    rig.outage.onUpdate(0.05);
  }
}

describe('StormOutage', () => {
  it('comes at a random point in the storm, inside its strong middle', () => {
    expect(STORM_OUTAGE.at[0]).toBeGreaterThan(0);
    expect(STORM_OUTAGE.at[1]).toBeLessThan(1);
    const rig = makeRig({ random: () => 0.5 });
    const when = STORM_OUTAGE.at[0] + 0.5 * (STORM_OUTAGE.at[1] - STORM_OUTAGE.at[0]);
    through(rig, 0, when - 0.02);
    expect(rig.grid.brownout).toBe(0);
    through(rig, when - 0.02, when + 0.02, 4);
    expect(rig.grid.brownout).toBeGreaterThan(0);
  });

  it('says while it is flickering — the buzz is loud enough to wake a sleeper', () => {
    const rig = makeRig();
    expect(rig.outage.flickering).toBe(false);
    through(rig, 0, 0.9);
    expect(rig.outage.flickering).toBe(true);
    run(rig.outage, STORM_OUTAGE.flickerSeconds + 0.1);
    expect(rig.outage.flickering).toBe(false);
  });

  it('a storm that takes it: the lights flicker first, then the power goes', () => {
    const rig = makeRig();
    through(rig, 0, 0.9);
    expect(rig.sounds.flicker.isPlaying).toBe(true);
    run(rig.outage, STORM_OUTAGE.flickerSeconds + 0.1);
    expect(rig.cutPower).toHaveBeenCalledTimes(1);
    expect(rig.grid.on).toBe(false);
    expect(rig.grid.brownout).toBe(0);
    expect(rig.sounds.flicker.isPlaying).toBe(false);
  });

  it('once a storm — the power back on stays on until the next one', () => {
    const rig = makeRig();
    through(rig, 0, 0.9);
    run(rig.outage, STORM_OUTAGE.flickerSeconds + 0.1);
    rig.grid.setOn(true);
    through(rig, 0.9, 1);
    run(rig.outage, 10);
    expect(rig.cutPower).toHaveBeenCalledTimes(1);
    rig.sandstorm.stormId = 2;   // the next storm
    through(rig, 0, 0.9);
    run(rig.outage, STORM_OUTAGE.flickerSeconds + 0.1);
    expect(rig.cutPower).toHaveBeenCalledTimes(2);
  });

  it('an ordinary shut-down: nothing tripped, nothing broken — flip the switches to restore it', () => {
    const rig = makeRig();
    through(rig, 0, 0.9);
    run(rig.outage, STORM_OUTAGE.flickerSeconds + 0.2);
    expect(rig.grid.tripped).toBe(false);
    expect(rig.grid.broken).toBe(false);
    rig.grid.setOn(true);
    expect(rig.grid.on).toBe(true);
  });

  it('with the power already off when its time comes, it waits for it to come back on', () => {
    const rig = makeRig();
    rig.grid.setOn(false);
    through(rig, 0, 0.85);
    expect(rig.grid.brownout).toBe(0);
    rig.grid.setOn(true);
    through(rig, 0.85, 0.9, 2);
    expect(rig.grid.brownout).toBeGreaterThan(0);
  });

  it('never without a storm', () => {
    const rig = makeRig();
    rig.sandstorm.stormProgress = null;
    rig.sandstorm.level = 0;
    run(rig.outage, 60);
    expect(rig.cutPower).not.toHaveBeenCalled();
  });

  it('stands down with the shift, and a new night starts with the lamps steady', () => {
    const rig = makeRig();
    through(rig, 0, 0.9);
    expect(rig.grid.brownout).toBeGreaterThan(0);
    rig.controller.state = 'morning';
    run(rig.outage, 0.1);
    expect(rig.grid.brownout).toBe(0);
    rig.controller.state = 'playing';
    rig.startNight(2);
    expect(rig.grid.brownout).toBe(0);
    expect(rig.cutPower).not.toHaveBeenCalled();
  });
});

describe('StormOutage — not every storm (#107)', () => {
  /** A dice that rolls these in turn, then the last for ever. */
  const dice = (...rolls) => () => (rolls.length > 1 ? rolls.shift() : rolls[0]);

  it('about half the storms take the power', () => {
    expect(STORM_OUTAGE.chance).toBeGreaterThan(0.3);
    expect(STORM_OUTAGE.chance).toBeLessThan(0.7);
  });

  it('a storm that misses blows through with the lights steady', () => {
    const rig = makeRig({ chance: 0.5, random: () => 0.9 });
    through(rig, 0, 1, 80);
    run(rig.outage, STORM_OUTAGE.flickerSeconds + 0.1);
    expect(rig.grid.brownout).toBe(0);
    expect(rig.sounds.flicker.play).not.toHaveBeenCalled();
    expect(rig.cutPower).not.toHaveBeenCalled();
    expect(rig.grid.on).toBe(true);
  });

  // The tutorial's storm has to take the power, and soon.
  it('force(at) makes this storm take the power at that point, whatever the roll', () => {
    const rig = makeRig({ chance: 0 });
    rig.outage.force(0.1);
    through(rig, 0, 0.05, 4);
    expect(rig.sounds.flicker.play).not.toHaveBeenCalled();
    through(rig, 0.05, 0.12, 4);
    expect(rig.sounds.flicker.play).toHaveBeenCalledTimes(1);
    run(rig.outage, STORM_OUTAGE.flickerSeconds + 0.1);
    expect(rig.cutPower).toHaveBeenCalledTimes(1);
  });

  it('a storm that hits takes it as before', () => {
    const rig = makeRig({ chance: 0.5, random: () => 0.1 });
    through(rig, 0, 0.9);
    run(rig.outage, STORM_OUTAGE.flickerSeconds + 0.1);
    expect(rig.cutPower).toHaveBeenCalledTimes(1);
  });

  it('each storm rolls its own', () => {
    const rig = makeRig({ chance: 0.5, random: dice(0.9, 0.1, 0.5) });
    through(rig, 0, 1);
    run(rig.outage, STORM_OUTAGE.flickerSeconds + 0.1);
    expect(rig.cutPower).not.toHaveBeenCalled();
    rig.sandstorm.stormId = 2;   // the next storm
    through(rig, 0, 1);
    run(rig.outage, STORM_OUTAGE.flickerSeconds + 0.1);
    expect(rig.cutPower).toHaveBeenCalledTimes(1);
  });

  it('a new night rolls again for a storm it had already passed over', () => {
    const rig = makeRig({ chance: 0.5, random: dice(0.9, 0.1, 0.5) });
    through(rig, 0, 0.5);
    rig.startNight(2);            // a retry: the same stormId comes round again
    through(rig, 0, 0.9);
    run(rig.outage, STORM_OUTAGE.flickerSeconds + 0.1);
    expect(rig.cutPower).toHaveBeenCalledTimes(1);
  });

  it('rolls STORM_OUTAGE.chance unless told otherwise', () => {
    for (const [roll, cuts] of [[STORM_OUTAGE.chance + 0.01, 0], [STORM_OUTAGE.chance - 0.01, 1]]) {
      const controller = { state: 'playing', onNightStart: () => () => {} };
      const sandstorm = { level: 1, stormId: 1, stormProgress: 0 };
      const grid = new PowerGrid();
      const cutPower = vi.fn(() => grid.setOn(false));
      const outage = new StormOutage({ controller, sandstorm, grid, cutPower, sounds: {}, random: () => roll });
      outage.onStart();
      for (let i = 0; i <= 40; i++) { sandstorm.stormProgress = 0.9 * i / 40; outage.onUpdate(0.05); }
      run(outage, STORM_OUTAGE.flickerSeconds + 0.1);
      expect(cutPower, `roll ${roll}`).toHaveBeenCalledTimes(cuts);
    }
  });
});

// Night 2 is where the player first has to get the power back in a storm,
// so its storm always takes it; the other nights keep the roll.
describe('StormOutage — sure on some nights', () => {
  /** Through a whole storm and out the other side of the flicker. */
  const blowThrough = rig => {
    through(rig, 0, 1, 80);
    run(rig.outage, STORM_OUTAGE.flickerSeconds + 0.1);
  };

  it('night 2 is sure, night 3 keeps its chance', () => {
    expect(STORM_OUTAGE.sureNights).toContain(2);
    expect(STORM_OUTAGE.sureNights).not.toContain(3);
  });

  it('on a sure night the storm takes the power, however the dice fall', () => {
    const rig = makeRig({ chance: 0.5, random: () => 0.99, night: 2 });
    blowThrough(rig);
    expect(rig.cutPower).toHaveBeenCalledTimes(1);
    expect(rig.grid.on).toBe(false);
  });

  it('still at a random point inside its strong middle', () => {
    const rig = makeRig({ chance: 0.5, random: () => 0.5, night: 2 });
    const when = STORM_OUTAGE.at[0] + 0.5 * (STORM_OUTAGE.at[1] - STORM_OUTAGE.at[0]);
    through(rig, 0, when - 0.02);
    expect(rig.grid.brownout).toBe(0);
    through(rig, when - 0.02, when + 0.02, 4);
    expect(rig.grid.brownout).toBeGreaterThan(0);
  });

  it('still once a storm: the power brought back stays on', () => {
    const rig = makeRig({ chance: 0.5, random: () => 0.99, night: 2 });
    through(rig, 0, 0.8);
    run(rig.outage, STORM_OUTAGE.flickerSeconds + 0.1);
    rig.grid.setOn(true);
    through(rig, 0.8, 1);
    run(rig.outage, STORM_OUTAGE.flickerSeconds + 0.1);
    expect(rig.cutPower).toHaveBeenCalledTimes(1);
    expect(rig.grid.on).toBe(true);
  });

  it('a retry of a sure night takes it again', () => {
    const rig = makeRig({ chance: 0.5, random: () => 0.99, night: 2 });
    blowThrough(rig);
    rig.startNight(2);
    rig.grid.setOn(true);
    blowThrough(rig);
    expect(rig.cutPower).toHaveBeenCalledTimes(2);
  });

  it('the other nights still roll', () => {
    for (const night of [1, 3]) {
      const rig = makeRig({ chance: 0.5, random: () => 0.99, night });
      blowThrough(rig);
      expect(rig.cutPower, `night ${night}`).not.toHaveBeenCalled();
    }
  });

  it('the sure nights can be handed in', () => {
    const rig = makeRig({ chance: 0.5, random: () => 0.99, night: 2, sureNights: [] });
    blowThrough(rig);
    expect(rig.cutPower).not.toHaveBeenCalled();
  });
});
