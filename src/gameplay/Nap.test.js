import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Nap, NAP } from './Nap.js';
import { Stamina } from './Stamina.js';

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
  const banner = { show: vi.fn() };
  const hint = { show: vi.fn(), hide: vi.fn() };
  const hooks = { setPlayerLocked: vi.fn(), restless: vi.fn(() => false), watched: vi.fn(() => false) };
  const state = { power: false, ufo: false, eyes: false, ...alarms };
  const nap = new Nap({
    controller, engine, banner, hooks, rest, hint,
    alarms: [
      { test: () => state.power, message: 'The power went out.' },
      { test: () => state.ufo,   message: 'Something on the radar woke you.' },
      { test: () => state.eyes,  message: 'You feel watched.' },
    ],
  });
  return { nap, controller, engine, rest, hud, banner, hooks, state, hint };
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
    const { nap, controller, engine, rest, banner } = rig;
    nap.start();
    nap.onUpdate(1);
    expect(nap.napping).toBe(true);
    controller.state = 'morning';                // 6 AM came
    nap.onUpdate(1);
    expect(nap.napping).toBe(false);
    expect(engine.timeScale).toBe(1);
    expect(rest.getUp).toHaveBeenCalledWith('calm');
    expect(banner.show).not.toHaveBeenCalled();
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
    const { nap, state, engine, banner, rest } = rig;
    nap.start();
    state.power = true;
    nap.onUpdate(1);
    expect(nap.napping).toBe(false);
    expect(engine.timeScale).toBe(1);
    expect(rest.getUp).toHaveBeenCalledWith('startled');
    expect(banner.show).toHaveBeenLastCalledWith('The power went out.', { tone: 'warning' });
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
    expect(r.banner.show).toHaveBeenLastCalledWith('Something on the radar woke you.', { tone: 'warning' });
  });

  it("says what woke you on the banner, leaving the HUD's prompt (the shift's own) alone", () => {
    const { nap, state, hud, banner } = rig;
    nap.start();
    state.eyes = true;
    nap.onUpdate(0.016);
    expect(banner.show).toHaveBeenCalledOnce();
    for (let i = 0; i < 10; i++) nap.onUpdate(1);
    expect(hud.setPrompt).not.toHaveBeenCalled();
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
    const { nap, engine, rest, banner } = rig;
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
    expect(banner.show).not.toHaveBeenCalled(); // you know why you're up
    expect(engine.consumed).toBe(true);           // the bunk doesn't take it as a new nap
  });

  describe('the way out: E wakes you, and the screen says so', () => {
    it('while napping, "[E] Wake up" shows over the closed lids', () => {
      const { nap, hint } = rig;
      expect(hint.show).not.toHaveBeenCalled();
      nap.start();
      expect(hint.show).toHaveBeenCalledWith(NAP.wakeHint);
      expect(NAP.wakeHint).toMatch(/^\[E\] Wake up/);
    });

    it('from the moment you lie down: E works then too', () => {
      const r = makeRig({ instant: false });
      r.nap.start();
      expect(r.hint.show).toHaveBeenCalled();
      r.engine.held = false;
      r.engine.press();
      r.nap.onUpdate(0.016);
      expect(r.nap.napping).toBe(false);
      expect(r.rest.getUp).toHaveBeenCalledWith('calm');
    });

    it('gone the moment you wake, whatever woke you', () => {
      for (const wake of [
        r => { r.engine.held = false; r.engine.press(); r.nap.onUpdate(0.016); },   // E
        r => { r.state.power = true; r.nap.onUpdate(0.016); },                       // an alarm
        r => { r.controller.nightClock.currentTime = 9; r.nap.onUpdate(0.016); },    // past the alarm clock
        r => { r.controller.state = 'morning'; r.nap.onUpdate(0.016); },             // 6 AM
        r => { r.controller.state = 'gameOver'; r.nap.onUpdate(0.016); },            // a failed night
        r => r.nap.onDestroy(),                                                      // torn down
      ]) {
        const r = makeRig();
        r.nap.start(1);
        r.hint.hide.mockClear();
        wake(r);
        expect(r.nap.napping).toBe(false);
        expect(r.hint.hide).toHaveBeenCalled();
      }
    });
  });

  describe('the demon\'s stretches: the night holds to real time while the demon is there', () => {
    it('runs at real time while the demon stands watching, and fast again once it goes', () => {
      const { nap, engine, hooks } = rig;
      nap.start();
      nap.onUpdate(0.016);
      expect(engine.timeScale).toBe(NAP.timeScale);
      hooks.watched.mockReturnValue(true);
      nap.onUpdate(0.016);
      expect(engine.timeScale).toBe(1);
      hooks.watched.mockReturnValue(false);
      nap.onUpdate(0.016);
      expect(engine.timeScale).toBe(NAP.timeScale);
    });

    it('a nap nobody watches races all the way: the stretches alone hold nothing back', () => {
      const { nap, engine, rest } = rig;
      nap.start();
      rest.peeking = true;
      nap.onUpdate(0.016);
      expect(engine.timeScale).toBe(NAP.timeScale);
    });

    it('not before the darkness has closed: getting in stays at real time', () => {
      const r = makeRig({ instant: false });
      r.rest.peeking = false;
      r.nap.start();
      r.nap.onUpdate(0.016);
      expect(r.engine.timeScale).toBe(1);
    });

    it('so the alarm cannot cut the scene short: the clock barely moves through a stretch', () => {
      const { nap, controller, hooks } = rig;
      controller.nightClock.currentTime = 1;
      nap.start(0.5);
      hooks.watched.mockReturnValue(true);
      nap.onUpdate(0.016);
      expect(nap.napping).toBe(true);
    });
  });

  describe('the alarm', () => {
    it('offers a set of lengths, in clock hours, ending with "until 6 AM" (null)', () => {
      expect(NAP.lengths).toEqual([0.5, 1, 2, 3, null]);
    });

    it('wakes you, calmly, when the clock has run on by the length you set', () => {
      const { nap, controller, banner, engine, rest } = rig;
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
      expect(banner.show).toHaveBeenLastCalledWith(expect.stringMatching(/alarm/i), { tone: 'info' });
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
      const { nap, state, banner } = rig;
      nap.start(3);
      state.power = true;
      nap.onUpdate(1);
      expect(nap.napping).toBe(false);
      expect(banner.show).toHaveBeenLastCalledWith('The power went out.', { tone: 'warning' });
    });
  });

  describe('stamina', () => {
    function napRig(startValue) {
      const r = makeRig();
      const stamina = new Stamina();
      stamina.value = startValue;
      r.nap.stamina = stamina;
      return { ...r, stamina };
    }
    /** Run the clock on `hours`, a frame at a time, while napping. */
    function sleepFor(r, hours, steps = 20) {
      for (let i = 0; i < steps; i++) {
        r.controller.nightClock.currentTime += hours / steps;
        r.nap.onUpdate(0.5);
      }
    }

    it('gives stamina back by the clock hours slept: a longer nap restores more', () => {
      const short = napRig(0.1);
      short.nap.start(1);
      sleepFor(short, 1);
      const long = napRig(0.1);
      long.nap.start(3);
      sleepFor(long, 3);
      expect(short.stamina.value).toBeCloseTo(0.1 + NAP.staminaPerHour);
      expect(long.stamina.value).toBeCloseTo(0.1 + 3 * NAP.staminaPerHour);
      expect(long.stamina.value).toBeGreaterThan(short.stamina.value);
    });

    it('woken early, only what was slept is given back', () => {
      const r = napRig(0.2);
      r.nap.start(3);
      sleepFor(r, 0.5);
      r.engine.press();
      r.nap.onUpdate(0.5);
      expect(r.nap.napping).toBe(false);
      const v = r.stamina.value;
      expect(v).toBeCloseTo(0.2 + 0.5 * NAP.staminaPerHour);
      r.controller.nightClock.currentTime += 1;
      r.nap.onUpdate(0.5);
      expect(r.stamina.value).toBe(v);
    });

    it('never past full', () => {
      const r = napRig(0.9);
      r.nap.start(3);
      sleepFor(r, 3);
      expect(r.stamina.value).toBe(1);
    });

    it('the alarm lengths on offer restore a sensible spread: 1 h is a fair top-up, 3 h most of a bar', () => {
      expect(NAP.staminaPerHour).toBeGreaterThan(0.1);
      expect(3 * NAP.staminaPerHour).toBeLessThan(1);
    });
  });
});
