import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Nap, NAP } from './Nap.js';

// ─────────────────────────────────────────────
// Nap — sleep through part of the night, fast-forwarded, until something
// wakes you or it is 6 AM
// ─────────────────────────────────────────────

function makeRig({ alarms = {} } = {}) {
  const controller = {
    state: 'playing',
    refreshPrompt: vi.fn(),
  };
  const engine = { timeScale: 1 };
  const fade = { cover: vi.fn(onDark => { onDark(); return true; }), uncover: vi.fn() };
  const hud = { setPrompt: vi.fn() };
  const hooks = { setPlayerLocked: vi.fn(), restless: vi.fn(() => false) };
  const state = { power: false, ufo: false, eyes: false, ...alarms };
  const nap = new Nap({
    controller, engine, fade, hud, hooks,
    alarms: [
      { test: () => state.power, message: 'The power went out.' },
      { test: () => state.ufo,   message: 'Something on the radar woke you.' },
      { test: () => state.eyes,  message: 'You feel watched.' },
    ],
  });
  return { nap, controller, engine, fade, hud, hooks, state };
}

describe('Nap', () => {
  let rig;
  beforeEach(() => { rig = makeRig(); });

  it('during the shift: fades to black, freezes the player and runs the night fast', () => {
    const { nap, engine, fade, hooks } = rig;
    expect(nap.canNap).toBe(true);
    expect(nap.start()).toBe(true);
    expect(nap.napping).toBe(true);
    expect(fade.cover).toHaveBeenCalledOnce();
    expect(hooks.setPlayerLocked).toHaveBeenLastCalledWith(true);
    expect(engine.timeScale).toBe(NAP.timeScale);
    expect(NAP.timeScale).toBeGreaterThanOrEqual(10);
  });

  it('only during the shift, and not twice', () => {
    const { nap, controller } = rig;
    controller.state = 'morning';
    expect(nap.canNap).toBe(false);
    expect(nap.start()).toBe(false);
    controller.state = 'playing';
    nap.start();
    expect(nap.canNap).toBe(false);
    expect(nap.start()).toBe(false);
  });

  it('not while something is already coming (restless) — the UFO on its way', () => {
    rig.hooks.restless.mockReturnValue(true);
    expect(rig.nap.canNap).toBe(false);
    expect(rig.nap.start()).toBe(false);
    expect(rig.engine.timeScale).toBe(1);
  });

  it('sleeps on until the shift ends, then wakes without a word', () => {
    const { nap, controller, engine, fade, hooks, hud } = rig;
    nap.start();
    nap.onUpdate(1);
    expect(nap.napping).toBe(true);
    controller.state = 'morning';                // 6 AM came
    nap.onUpdate(1);
    expect(nap.napping).toBe(false);
    expect(engine.timeScale).toBe(1);
    expect(fade.uncover).toHaveBeenCalledOnce();
    expect(hooks.setPlayerLocked).toHaveBeenLastCalledWith(false);
    expect(hud.setPrompt).not.toHaveBeenCalled();
  });

  it('wakes when something happens, and says what', () => {
    const { nap, state, engine, hud } = rig;
    nap.start();
    state.power = true;
    nap.onUpdate(1);
    expect(nap.napping).toBe(false);
    expect(engine.timeScale).toBe(1);
    expect(hud.setPrompt).toHaveBeenLastCalledWith('The power went out.');
    expect(nap.wokeBy).toBe('The power went out.');
  });

  it('only on a change: already dark when you lay down doesn\'t wake you', () => {
    const r = makeRig({ alarms: { power: true } });
    r.nap.start();
    r.nap.onUpdate(1);
    expect(r.nap.napping).toBe(true);
    r.state.ufo = true;
    r.nap.onUpdate(1);
    expect(r.nap.napping).toBe(false);
    expect(r.hud.setPrompt).toHaveBeenLastCalledWith('Something on the radar woke you.');
  });

  it('puts the shift\'s own prompt back a few real seconds after the wake-up line', () => {
    const { nap, state, controller, hud } = rig;
    nap.start();
    state.eyes = true;
    nap.onUpdate(0.016);
    nap.onUpdate(NAP.messageSeconds - 0.1);
    expect(controller.refreshPrompt).not.toHaveBeenCalled();
    nap.onUpdate(0.2);
    expect(hud.setPrompt).toHaveBeenLastCalledWith('');
    expect(controller.refreshPrompt).toHaveBeenCalledOnce();
  });

  it('a scene torn down mid-nap leaves the engine at real time and the screen clear', () => {
    const { nap, engine, fade } = rig;
    nap.start();
    nap.onDestroy();
    expect(engine.timeScale).toBe(1);
    expect(fade.uncover).toHaveBeenCalled();
  });

  it('wake() by hand does nothing when not napping', () => {
    const { nap, fade } = rig;
    nap.wake();
    expect(fade.uncover).not.toHaveBeenCalled();
  });
});
