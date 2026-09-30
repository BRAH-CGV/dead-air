import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoffeeThermos, keyLabel } from './CoffeeThermos.js';
import { Thermos, THERMOS } from '../gameplay/Thermos.js';
import { Stamina } from '../gameplay/Stamina.js';
import { fakeAudioSystem } from '../test/fakeAudio.js';

describe('keyLabel(code)', () => {
  it('names a key the way the HUD shows it', () => {
    expect(keyLabel('KeyF')).toBe('F');
    expect(keyLabel('Digit2')).toBe('2');
    expect(keyLabel('Space')).toBe('Space');
  });
});

describe('CoffeeThermos', () => {
  let thermos, stamina, controller, hud, audio, engine, coffee;

  beforeEach(() => {
    thermos = new Thermos();
    stamina = new Stamina();
    stamina.value = 0.3;
    controller = { state: 'playing' };
    hud = { setCoffee: vi.fn() };
    audio = fakeAudioSystem(vi);
    engine = { input: { keys: {}, pressed: {} }, keyBinds: { drink: 'KeyF' }, debugCamera: { active: false } };
    coffee = new CoffeeThermos({ thermos, stamina, controller, hud, audio, engine });
  });

  function press() {
    engine.input.pressed.KeyF = true;
    coffee.onUpdate(0.016);
    engine.input.pressed = {};
  }

  it('the drink key takes a cup, with a sip', () => {
    press();
    expect(thermos.cups).toBe(THERMOS.cups - 1);
    expect(stamina.value).toBeCloseTo(0.3 + THERMOS.restore);
    expect(audio.play).toHaveBeenCalledWith('sfx:sip', expect.any(Object));
  });

  it('shows the cups left and the key on the HUD', () => {
    coffee.onUpdate(0.016);
    expect(hud.setCoffee).toHaveBeenLastCalledWith(THERMOS.cups, 'F');
    press();
    expect(hud.setCoffee).toHaveBeenLastCalledWith(THERMOS.cups - 1, 'F');
  });

  it('a held key is one cup; the next waits for the sip to finish', () => {
    press();
    press();
    expect(thermos.cups).toBe(THERMOS.cups - 1);
    for (let t = 0; t < THERMOS.sipSeconds + 0.1; t += 0.1) coffee.onUpdate(0.1);
    press();
    expect(thermos.cups).toBe(THERMOS.cups - 2);
  });

  it('an empty thermos is silent', () => {
    thermos.cups = 0;
    press();
    expect(audio.play).not.toHaveBeenCalled();
  });

  it('only during the shift, and not from the fly camera', () => {
    controller.state = 'morning';
    press();
    controller.state = 'playing';
    engine.debugCamera.active = true;
    press();
    expect(thermos.cups).toBe(THERMOS.cups);
  });

  it('follows a remapped key', () => {
    engine.keyBinds.drink = 'KeyG';
    engine.input.pressed.KeyG = true;
    coffee.onUpdate(0.016);
    expect(thermos.cups).toBe(THERMOS.cups - 1);
    expect(hud.setCoffee).toHaveBeenLastCalledWith(THERMOS.cups - 1, 'G');
  });
});
