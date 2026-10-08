import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FatigueEffects, FATIGUE_SOUNDS } from './FatigueEffects.js';
import { Stamina } from '../gameplay/Stamina.js';
import { FATIGUE, tunnel } from '../gameplay/Fatigue.js';

/** A controller that announces nights the way GameController does. */
function fakeController() {
  const listeners = new Set();
  return {
    state: 'playing',
    nightNumber: 1,
    onNightStart: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    startNight(night, opts = {}) {
      this.state = 'playing';
      this.nightNumber = night;
      for (const fn of listeners) fn(night, opts);
    },
    listeners,
  };
}

function fakeSound() {
  return {
    isPlaying: false, volume: 1, playbackRate: 1,
    play: vi.fn(function () { this.isPlaying = true; }),
    stop: vi.fn(function () { this.isPlaying = false; }),
    setVolume: vi.fn(function (v) { this.volume = v; }),
    setPlaybackRate: vi.fn(function (r) { this.playbackRate = r; }),
  };
}

describe('FatigueEffects', () => {
  let stamina, controller, overlay, grid, sounds, frozen, fx;

  beforeEach(() => {
    stamina = new Stamina();
    controller = fakeController();
    overlay = { set: vi.fn(), clear: vi.fn() };
    grid = { setFactor: vi.fn() };
    sounds = { heartbeat: fakeSound(), yawn: fakeSound() };
    frozen = false;
    fx = new FatigueEffects({ stamina, controller, overlay, grid, sounds, isFrozen: () => frozen, rand: () => 0 });
    fx.onStart();
  });

  function run(seconds, dt = 0.05) {
    for (let t = 0; t < seconds - 1e-9; t += dt) fx.onUpdate(dt);
  }

  it('names the clips it plays', () => {
    expect(FATIGUE_SOUNDS).toEqual({ heartbeat: 'sfx:heartbeat', yawn: 'sfx:yawn' });
  });

  it('narrows the view as stamina falls', () => {
    stamina.value = 0.2;
    fx.onUpdate(0.016);
    expect(overlay.set).toHaveBeenLastCalledWith(tunnel(0.2), 0);
  });

  it('yawns out loud when tired', () => {
    stamina.value = 0.4;
    run(FATIGUE.firstYawn[0] - 0.1);
    expect(sounds.yawn.play).not.toHaveBeenCalled();
    run(0.2);
    expect(sounds.yawn.play).toHaveBeenCalledTimes(1);
    expect(sounds.yawn.volume).toBeGreaterThan(0);
  });

  it('blinks when critical: the overlay gets the lids', () => {
    stamina.value = 0.15;
    let shut = 0;
    for (let t = 0; t < FATIGUE.blinkGap[0] + 0.3; t += 0.01) {
      fx.onUpdate(0.01);
      shut = Math.max(shut, overlay.set.mock.lastCall[1]);
    }
    expect(shut).toBeGreaterThan(0.9);
  });

  it("writes the grid's 'dread' factor: 1, stuttering when critical", () => {
    fx.onUpdate(0.016);
    expect(grid.setFactor).toHaveBeenLastCalledWith('dread', 1);
    stamina.value = 0.1;
    const seen = new Set();
    for (let t = 0; t < 20; t += 0.01) {
      fx.onUpdate(0.01);
      seen.add(grid.setFactor.mock.lastCall[1]);
    }
    expect(seen).toEqual(new Set([1, FATIGUE.dreadMin]));
  });

  it('a heartbeat, silent until critical, then louder and quicker towards empty', () => {
    const beat = sounds.heartbeat;
    stamina.value = 0.5;
    fx.onUpdate(0.016);
    expect(beat.isPlaying).toBe(false);

    stamina.value = 0.1;
    fx.onUpdate(0.016);
    expect(beat.isPlaying).toBe(true);
    const quiet = beat.volume;
    const slow = beat.playbackRate;
    expect(quiet).toBeGreaterThan(0);
    expect(slow).toBeGreaterThanOrEqual(1);

    stamina.value = 0.02;
    fx.onUpdate(0.016);
    expect(beat.volume).toBeGreaterThan(quiet);
    expect(beat.playbackRate).toBeGreaterThan(slow);
  });

  it('touches the heartbeat only when its level changes', () => {
    stamina.value = 0.1;
    fx.onUpdate(0.016);
    const writes = sounds.heartbeat.setVolume.mock.calls.length;
    for (let i = 0; i < 30; i++) fx.onUpdate(0.016);
    expect(sounds.heartbeat.setVolume.mock.calls.length).toBe(writes);
    expect(sounds.heartbeat.play).toHaveBeenCalledTimes(1);
  });

  it('eating back above critical stops the heart', () => {
    stamina.value = 0.1;
    fx.onUpdate(0.016);
    stamina.value = 0.45;
    fx.onUpdate(0.016);
    expect(sounds.heartbeat.isPlaying).toBe(false);
  });

  it('off shift: eyes open, lights steady, heart quiet, no yawns', () => {
    stamina.value = 0.05;
    run(FATIGUE.blinkGap[0] + 0.05, 0.01);
    controller.state = 'morning';
    fx.onUpdate(0.016);
    expect(overlay.set).toHaveBeenLastCalledWith(0, 0);
    expect(grid.setFactor).toHaveBeenLastCalledWith('dread', 1);
    expect(sounds.heartbeat.isPlaying).toBe(false);
    sounds.yawn.play.mockClear();
    run(60);
    expect(sounds.yawn.play).not.toHaveBeenCalled();
  });

  it('a new night starts the clocks again: no yawn until tiredness sets in anew', () => {
    stamina.value = 0.4;
    run(1);
    controller.startNight(2);
    run(FATIGUE.firstYawn[0] - 0.2);
    expect(sounds.yawn.play).not.toHaveBeenCalled();
  });

  it('the fly camera sees the scene clear: no tunnel, no lids', () => {
    stamina.value = 0.1;
    frozen = true;
    fx.onUpdate(0.016);
    expect(overlay.set).toHaveBeenLastCalledWith(0, 0);
  });

  it('torn down: the view clear, the heart quiet, no more nights heard', () => {
    stamina.value = 0.1;
    fx.onUpdate(0.016);
    fx.onDestroy();
    expect(overlay.clear).toHaveBeenCalled();
    expect(sounds.heartbeat.isPlaying).toBe(false);
    expect(controller.listeners.size).toBe(0);
  });

  it('runs without sounds, overlay or grid', () => {
    const bare = new FatigueEffects({ stamina, controller });
    bare.onStart();
    stamina.value = 0.1;
    expect(() => { for (let i = 0; i < 200; i++) bare.onUpdate(0.05); }).not.toThrow();
    expect(() => bare.onDestroy()).not.toThrow();
  });
});
