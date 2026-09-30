import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StaminaDrain, fatigueLight, FATIGUE_DIM_MIN } from './StaminaDrain.js';
import { Stamina, STAMINA } from '../gameplay/Stamina.js';
import { BaseLights } from '../gameplay/BaseLights.js';

describe('StaminaDrain', () => {
  let stamina, controller, hud, drain, onNightStart;

  beforeEach(() => {
    stamina = new Stamina({ drainPerSecond: 0.01 });
    controller = { state: 'playing', nightNumber: 1 };
    hud = { setStamina: vi.fn() };
    onNightStart = vi.fn();
    drain = new StaminaDrain({ stamina, controller, hud, onNightStart });
  });

  it('drains stamina while the night is being played', () => {
    drain.onUpdate(0);                                // the night starts: full
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
    drain.onUpdate(1);
    expect(onNightStart).toHaveBeenCalledTimes(1);   // the first night

    drain.onUpdate(30);
    controller.state = 'gameOver';
    drain.onUpdate(1);
    controller.state = 'playing';                     // retry
    drain.onUpdate(0);
    expect(stamina.value).toBe(1);
    expect(onNightStart).toHaveBeenCalledTimes(2);

    drain.onUpdate(30);
    controller.nightNumber = 2;                        // N key, or slept
    drain.onUpdate(0);
    expect(stamina.value).toBe(1);
    expect(onNightStart).toHaveBeenCalledTimes(3);
  });

  it('shows it on the HUD with its level', () => {
    stamina.value = 0.3;
    drain.onUpdate(0);
    // A new night filled it first.
    expect(hud.setStamina).toHaveBeenLastCalledWith(1, 'ok');
    stamina.value = 0.3;
    drain.onUpdate(0);
    expect(hud.setStamina).toHaveBeenLastCalledWith(0.3, 'tired');
  });

  it('works without a HUD', () => {
    drain = new StaminaDrain({ stamina, controller });
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
  it("dims the base's lights through their 'fatigue' factor as the player tires", () => {
    const stamina = new Stamina();
    const controller = { state: 'playing', nightNumber: 1 };
    const lights = new BaseLights();
    const drain = new StaminaDrain({ stamina, controller, lights });
    drain.onUpdate(0);
    expect(lights.getFactor('fatigue')).toBe(1);
    stamina.value = 0.1;
    drain.onUpdate(0);
    expect(lights.getFactor('fatigue')).toBeCloseTo(fatigueLight(0.1));
    controller.nightNumber = 2;                        // a new night: wide awake
    drain.onUpdate(0);
    expect(lights.getFactor('fatigue')).toBe(1);
  });

  it('composes with the power instead of fighting it', () => {
    const lights = new BaseLights();
    lights.setFactor('power', 0.5);
    const stamina = new Stamina();
    const drain = new StaminaDrain({ stamina, controller: { state: 'playing', nightNumber: 1 }, lights });
    drain.onUpdate(0);
    stamina.value = 0;
    drain.onUpdate(0);
    expect(lights.level).toBeCloseTo(0.5 * FATIGUE_DIM_MIN);
    expect(lights.getFactor('power')).toBe(0.5);
  });
});
