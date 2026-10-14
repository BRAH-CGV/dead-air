import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { StaminaDrain, fatigueLight, FATIGUE_DIM_MIN } from './StaminaDrain.js';
import { Stamina, STAMINA } from '../gameplay/Stamina.js';
import { PowerGrid } from '../systems/PowerGrid.js';

/** A controller that announces nights the way GameController does. */
function fakeController() {
  const listeners = new Set();
  return {
    state: 'playing',
    onNightStart: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    startNight(night, opts = {}) {
      this.state = 'playing';
      for (const fn of listeners) fn(night, opts);
    },
    listeners,
  };
}

describe('StaminaDrain', () => {
  let stamina, controller, hud, drain, onNightStart;

  beforeEach(() => {
    stamina = new Stamina({ drainPerSecond: 0.01 });
    controller = fakeController();
    hud = { setStamina: vi.fn() };
    onNightStart = vi.fn();
    drain = new StaminaDrain({ stamina, controller, hud, onNightStart });
    drain.onStart();
  });

  it('drains stamina while the night is being played', () => {
    drain.onUpdate(10);
    expect(stamina.value).toBeCloseTo(0.9);
  });

  it('holds it in the morning and behind a failed night', () => {
    drain.onUpdate(1);
    const v = stamina.value;
    controller.state = 'morning';
    drain.onUpdate(10);
    controller.state = 'gameOver';
    drain.onUpdate(10);
    expect(stamina.value).toBe(v);
  });

  it('fills it when a night starts: the next night, or a retry of this one', () => {
    drain.onUpdate(30);
    controller.startNight(1, { retry: true });
    expect(stamina.value).toBe(1);
    expect(onNightStart).toHaveBeenCalledTimes(1);

    drain.onUpdate(30);
    controller.startNight(2);
    expect(stamina.value).toBe(1);
    expect(onNightStart).toHaveBeenCalledTimes(2);
  });

  it('shows it on the HUD with its level', () => {
    stamina.value = 0.3;
    drain.onUpdate(0);
    expect(hud.setStamina).toHaveBeenLastCalledWith(0.3, 'tired');
  });

  it('stops listening when destroyed', () => {
    drain.onDestroy();
    expect(controller.listeners.size).toBe(0);
  });

  it('works without a HUD, a grid or a controller that announces nights', () => {
    drain = new StaminaDrain({ stamina, controller: { state: 'playing' } });
    drain.onStart();
    expect(() => drain.onUpdate(1)).not.toThrow();
  });
});

describe('fatigueLight', () => {
  it('is full light while the player is awake, down to FATIGUE_DIM_MIN asleep on their feet', () => {
    expect(fatigueLight(1)).toBe(1);
    expect(fatigueLight(STAMINA.tiredBelow)).toBe(1);
    expect(fatigueLight(0)).toBeCloseTo(FATIGUE_DIM_MIN);
    expect(FATIGUE_DIM_MIN).toBeCloseTo(0.6);
  });

  it('dims smoothly as stamina falls through tired', () => {
    let prev = fatigueLight(STAMINA.tiredBelow);
    for (let s = STAMINA.tiredBelow; s >= 0; s -= 0.05) {
      const v = fatigueLight(s);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
    expect(fatigueLight(0.25)).toBeGreaterThan(FATIGUE_DIM_MIN);
    expect(fatigueLight(0.25)).toBeLessThan(1);
  });
});

describe('StaminaDrain fatigue', () => {
  it("dims the base's lights through the grid's 'fatigue' factor as the player tires", () => {
    const stamina = new Stamina();
    const controller = fakeController();
    const grid = new PowerGrid();
    const drain = new StaminaDrain({ stamina, controller, grid });
    drain.onStart();
    drain.onUpdate(0);
    expect(grid.getFactor('fatigue')).toBe(1);
    stamina.value = 0.1;
    drain.onUpdate(0);
    expect(grid.getFactor('fatigue')).toBeCloseTo(fatigueLight(0.1));
    controller.startNight(2);                         // a new night: wide awake
    drain.onUpdate(0);
    expect(grid.getFactor('fatigue')).toBe(1);
  });

  it('composes with a brown-out instead of fighting it: the switch still kills the lamps', () => {
    const grid = new PowerGrid();
    const light = new THREE.PointLight(0xffffff, 4);
    grid.addLight(light);
    const stamina = new Stamina();
    const drain = new StaminaDrain({ stamina, controller: fakeController(), grid });
    drain.onStart();
    stamina.value = 0;
    drain.onUpdate(0);
    grid.update(0.016);
    expect(light.intensity).toBeCloseTo(4 * FATIGUE_DIM_MIN);
    grid.setOn(false);
    grid.update(0.016);
    expect(light.intensity).toBe(0);
  });
});
