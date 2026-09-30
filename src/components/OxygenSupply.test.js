import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OxygenSupply, OXYGEN_KILL } from './OxygenSupply.js';
import { Oxygen, OXYGEN } from '../gameplay/Oxygen.js';
import { fakeAudioSystem } from '../test/fakeAudio.js';

describe('OxygenSupply', () => {
  let oxygen, suit, controller, outside, refilling, hud, audio, supply;

  const run = (seconds, dt = 0.1) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) supply.onUpdate(dt);
  };

  beforeEach(() => {
    oxygen = new Oxygen();
    suit = { worn: true };
    controller = { state: 'playing', fail: vi.fn(() => { controller.state = 'gameOver'; }) };
    outside = true;
    refilling = false;
    hud = { setOxygen: vi.fn() };
    audio = fakeAudioSystem(vi);
    supply = new OxygenSupply({
      oxygen, suit, controller, hud, audio,
      isOutside:   () => outside,
      isRefilling: () => refilling,
    });
  });

  it('drains only while the suit is worn and the player is outside', () => {
    run(9);
    expect(oxygen.value).toBeCloseTo(0.9);
    for (const [worn, out] of [[false, true], [true, false], [false, false]]) {
      suit.worn = worn;
      outside = out;
      const before = oxygen.value;
      run(5);
      expect(oxygen.value, `worn ${worn}, outside ${out}`).toBe(before);
    }
  });

  it('holds while no shift is running', () => {
    controller.state = 'morning';
    run(20);
    expect(oxygen.value).toBe(1);
  });

  it('refills in the pressurised airlock', () => {
    run(45);
    outside = false;
    suit.worn = false;
    refilling = true;
    run(OXYGEN.refillSeconds + 0.5);
    expect(oxygen.value).toBe(1);
  });

  it('ends the night when the tank runs dry, once', () => {
    run(OXYGEN.tankSeconds + 5);
    expect(oxygen.value).toBe(0);
    expect(controller.fail).toHaveBeenCalledTimes(1);
    expect(controller.fail).toHaveBeenCalledWith(OXYGEN_KILL);
    expect(OXYGEN_KILL).toBe('You ran out of air.');
  });

  it('shows the gauge only while the suit is worn', () => {
    run(0.1);
    expect(hud.setOxygen).toHaveBeenLastCalledWith(oxygen.value);
    suit.worn = false;
    outside = false;
    run(0.1);
    expect(hud.setOxygen).toHaveBeenLastCalledWith(null);
  });

  it('beeps in the helmet once it runs low, and keeps beeping while it drains', () => {
    run(OXYGEN.tankSeconds * (1 - OXYGEN.lowBelow) - 1);
    expect(audio.play).not.toHaveBeenCalled();
    run(1.2);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenLastCalledWith('sfx:o2-warning');
    run(OXYGEN.beepEvery * 3);
    expect(audio.play.mock.calls.length).toBeGreaterThanOrEqual(3);
    const beeps = audio.play.mock.calls.length;
    outside = false;                                   // back inside: quiet
    run(OXYGEN.beepEvery * 3);
    expect(audio.play).toHaveBeenCalledTimes(beeps);
  });

  it('works without a HUD or sound', () => {
    supply = new OxygenSupply({ oxygen, suit, controller, isOutside: () => true, isRefilling: () => false });
    expect(() => run(OXYGEN.tankSeconds + 1)).not.toThrow();
  });
});
