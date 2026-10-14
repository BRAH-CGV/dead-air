import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Nap, NAP } from './Nap.js';

// ─────────────────────────────────────────────
// Nap — sleep through part of the night, fast-forwarded, until something
// wakes you or it is 6 AM
// ─────────────────────────────────────────────

/** A bed animation: `instant` falls asleep the moment it lies down. */
function makeRest({ instant = true } = {}) {
  const rest = {
    active: false,
    _asleep: null,
    lieDown: vi.fn(onAsleep => {
      rest.active = true;
      rest._asleep = onAsleep;
      if (instant) rest.fallAsleep();
      return true;
    }),
    /** The lids shut. */
    fallAsleep() { const fn = rest._asleep; rest._asleep = null; fn?.(); },
    getUp: vi.fn(() => true),
    cancel: vi.fn(() => { rest.active = false; }),
  };
  return rest;
}

function makeRig({ alarms = {}, instant = true, rest = makeRest({ instant }) } = {}) {
  const controller = {
    state: 'playing',
    refreshPrompt: vi.fn(),
    nightClock: { currentTime: 0, endHour: 6 },
  };
  const engine = {
    timeScale: 1,
    held: false,
    consumed: false,
    isAction(action) { return action === 'interact' && this.held && !this.consumed; },
    consumeAction(action) { if (action === 'interact') this.consumed = true; },
  };
  /** Press E (a fresh press: the last one was let go). */
  engine.press = () => { engine.held = true; engine.consumed = false; };
  const hud = { setPrompt: vi.fn() };
  const hooks = { setPlayerLocked: vi.fn(), restless: vi.fn(() => false) };
  const state = { power: false, ufo: false, eyes: false, ...alarms };
  const nap = new Nap({
    controller, engine, hud, hooks, rest,
    alarms: [
      { test: () => state.power, message: 'The power went out.' },
      { test: () => state.ufo,   message: 'Something on the radar woke you.' },
      { test: () => state.eyes,  message: 'You feel watched.' },
    ],
  });
  return { nap, controller, engine, rest, hud, hooks, state };
}

describe('Nap', () => {
  let rig;
  beforeEach(() => { rig = makeRig(); });

  it('during the shift: lies down, and only once the eyes are shut runs the night fast', () => {
    const r = makeRig({ instant: false });
    const { nap, engine, rest } = r;
    expect(nap.canNap).toBe(true);
    expect(nap.start()).toBe(true);
    expect(nap.napping).toBe(true);
    expect(rest.lieDown).toHaveBeenCalledOnce();
    expect(engine.timeScale).toBe(1);             // still getting in
    rest.fallAsleep();
    expect(engine.timeScale).toBe(NAP.timeScale);
    expect(NAP.timeScale).toBeGreaterThanOrEqual(10);
  });

  it('woken while still getting in: the night was never sped up, and you get straight back out', () => {
    const r = makeRig({ instant: false });
    r.nap.start();
    r.state.power = true;
    r.nap.onUpdate(0.016);
    expect(r.nap.napping).toBe(false);
    expect(r.rest.getUp).toHaveBeenCalledWith('startled');
    r.rest.fallAsleep();                          // a late callback changes nothing
    expect(r.engine.timeScale).toBe(1);
  });

  it('not while still getting out of bed from the last one', () => {
    const { nap, rest } = rig;
    rest.active = true;
    expect(nap.canNap).toBe(false);
  });

  it('with no bed animation, freezes the player and runs fast at once', () => {
    const r = makeRig({ rest: null });
    r.nap.start();
    expect(r.hooks.setPlayerLocked).toHaveBeenLastCalledWith(true);
    expect(r.engine.timeScale).toBe(NAP.timeScale);
    r.nap.wake();
    expect(r.hooks.setPlayerLocked).toHaveBeenLastCalledWith(false);
    expect(r.engine.timeScale).toBe(1);
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

  it('sleeps on until the shift ends, then wakes calmly without a word', () => {
    const { nap, controller, engine, rest, hud } = rig;
    nap.start();
    nap.onUpdate(1);
    expect(nap.napping).toBe(true);
    controller.state = 'morning';                // 6 AM came
    nap.onUpdate(1);
    expect(nap.napping).toBe(false);
    expect(engine.timeScale).toBe(1);
    expect(rest.getUp).toHaveBeenCalledWith('calm');
    expect(hud.setPrompt).not.toHaveBeenCalled();
  });

  it('a night failed under it (not the morning): real time, and the view handed straight back', () => {
    const { nap, controller, engine, rest } = rig;
    nap.start();
    controller.state = 'gameOver';
    nap.onUpdate(1);
    expect(nap.napping).toBe(false);
    expect(engine.timeScale).toBe(1);
    expect(rest.getUp).not.toHaveBeenCalled();
    expect(rest.cancel).toHaveBeenCalled();
  });

  it('wakes when something happens, startled, and says what', () => {
    const { nap, state, engine, hud, rest } = rig;
    nap.start();
    state.power = true;
    nap.onUpdate(1);
    expect(nap.napping).toBe(false);
    expect(engine.timeScale).toBe(1);
    expect(rest.getUp).toHaveBeenCalledWith('startled');
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

  it('a scene torn down mid-nap leaves the engine at real time and the view handed back', () => {
    const { nap, engine, rest } = rig;
    nap.start();
    nap.onDestroy();
    expect(engine.timeScale).toBe(1);
    expect(nap.napping).toBe(false);
    expect(rest.cancel).toHaveBeenCalled();
    expect(rest.getUp).not.toHaveBeenCalled();
  });

  it('wake() by hand does nothing when not napping', () => {
    const { nap, rest } = rig;
    nap.wake();
    expect(rest.getUp).not.toHaveBeenCalled();
  });

  it('pressing E wakes you yourself, calmly — not the press that lay you down', () => {
    const { nap, engine, rest, hud } = rig;
    engine.press();                               // E at the bunk
    nap.start();
    nap.onUpdate(0.016);
    expect(nap.napping).toBe(true);               // still the same press
    engine.held = false;                          // let go
    nap.onUpdate(0.016);
    engine.press();                               // pressed again
    nap.onUpdate(0.016);
    expect(nap.napping).toBe(false);
    expect(engine.timeScale).toBe(1);
    expect(rest.getUp).toHaveBeenCalledOnce();
    expect(rest.getUp).toHaveBeenCalledWith('calm');
    expect(hud.setPrompt).not.toHaveBeenCalled(); // you know why you're up
    expect(engine.consumed).toBe(true);           // the bunk doesn't take it as a new nap
  });

  describe('the alarm', () => {
    it('offers a set of lengths, in clock hours, ending with "until 6 AM" (null)', () => {
      expect(NAP.lengths).toEqual([0.5, 1, 2, 3, null]);
    });

    it('wakes you, calmly, when the clock has run on by the length you set', () => {
      const { nap, controller, hud, engine, rest } = rig;
      controller.nightClock.currentTime = 1;      // 1:00 AM
      nap.start(2);
      expect(nap.wakeAt).toBe(3);
      controller.nightClock.currentTime = 2.9;
      nap.onUpdate(1);
      expect(nap.napping).toBe(true);
      controller.nightClock.currentTime = 3;
      nap.onUpdate(1);
      expect(nap.napping).toBe(false);
      expect(engine.timeScale).toBe(1);
      expect(hud.setPrompt).toHaveBeenLastCalledWith(expect.stringMatching(/alarm/i));
      expect(rest.getUp).toHaveBeenCalledWith('calm');
    });

    it('with no length, sleeps on to 6 AM', () => {
      const { nap, controller } = rig;
      nap.start();
      expect(nap.wakeAt).toBeNull();
      controller.nightClock.currentTime = 5.99;
      nap.onUpdate(1);
      expect(nap.napping).toBe(true);
    });

    it('anything that would wake you still does before the alarm', () => {
      const { nap, state, hud } = rig;
      nap.start(3);
      state.power = true;
      nap.onUpdate(1);
      expect(nap.napping).toBe(false);
      expect(hud.setPrompt).toHaveBeenLastCalledWith('The power went out.');
    });
  });
});
