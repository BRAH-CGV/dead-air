import { describe, it, expect, vi } from 'vitest';
import { StormOutage, STORM_OUTAGE } from './StormOutage.js';
import { PowerGrid } from '../systems/PowerGrid.js';

// ─────────────────────────────────────────────
// StormOutage — every sandstorm takes the power out, once
// ─────────────────────────────────────────────

function makeSound() {
  return {
    isPlaying: false, volume: 0,
    play: vi.fn(function () { this.isPlaying = true; }),
    stop: vi.fn(function () { this.isPlaying = false; }),
    setVolume: vi.fn(function (v) { this.volume = v; }),
  };
}

function makeRig({ random = () => 0.5 } = {}) {
  const listeners = [];
  const controller = { state: 'playing', onNightStart: fn => { listeners.push(fn); return () => {}; } };
  // A storm the test moves through by hand.
  const sandstorm = { level: 1, stormId: 1, stormProgress: 0 };
  const grid = new PowerGrid();
  const cutPower = vi.fn(() => grid.setOn(false));
  const sounds = { flicker: makeSound() };
  const outage = new StormOutage({ controller, sandstorm, grid, cutPower, sounds, random });
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

  it('every storm: the lights flicker first, then the power goes', () => {
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
