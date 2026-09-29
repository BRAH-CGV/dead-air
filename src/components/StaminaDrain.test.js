import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StaminaDrain } from './StaminaDrain.js';
import { Stamina } from '../gameplay/Stamina.js';

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
