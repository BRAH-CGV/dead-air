import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameController } from './GameController.js';
import { NightClock, NIGHT_SECONDS, SHIFT } from './NightClock.js';
import { SignalManager } from './SignalManager.js';
import { NightManager } from '../systems/NightManager.js';

function makeHUD() {
  return {
    show: vi.fn(), hide: vi.fn(),
    setTime: vi.fn(), setSignals: vi.fn(), setNight: vi.fn(),
    setScanProgress: vi.fn(), setPrompt: vi.fn(),
  };
}

function makeSatellite() {
  return { scanProgress: 0, scanTarget: null, isScanning: false };
}

const POOL = ['s1.png', 's2.png', 's3.png', 's4.png', 's5.png'];

describe('GameController', () => {
  let gc, clock, mgr, hud, sat, quotaDock;

  beforeEach(() => {
    gc   = new GameController();
    clock = new NightClock({ startHour: 0, nightDuration: 300 });
    mgr  = new SignalManager({ signalsPerNight: 10, payloadPool: POOL });
    hud  = makeHUD();
    sat  = makeSatellite();
    // A plain dock stub — the controller only reads collectedCount /
    // requiredCount and calls isQuotaMet().
    quotaDock = {
      requiredCount: 3,
      collectedCount: 0,
      isQuotaMet() { return this.collectedCount >= this.requiredCount; },
    };

    gc.nightClock    = clock;
    gc.signalManager = mgr;
    gc.hud           = hud;
    gc.satellite     = sat;
    gc.quotaDock      = quotaDock;
    gc.autoStart     = false;  // manual control for tests
  });

  /** Save the current night's whole quota through the controller. */
  function meetQuota() {
    // Simulate saved drives seated in the docked box
    quotaDock.collectedCount = quotaDock.requiredCount;
    gc.onSignalSaved();
  }

  /** Give the controller the engine a scene would, so it can read keys. */
  function attachEngine() {
    const engine = { input: { keys: {}, pressed: {} }, keyBinds: { interact: 'KeyE' } };
    gc.gameObject = { scene: { userData: { engine } } };
    return engine;
  }

  it('starts in idle state', () => {
    expect(gc.state).toBe('idle');
    expect(gc.nightNumber).toBe(0);
  });

  it('startNight sets state to playing and resets systems', () => {
    gc.startNight(1);
    expect(gc.state).toBe('playing');
    expect(gc.nightNumber).toBe(1);
    expect(clock.elapsed).toBe(0);
    expect(mgr.signals).toHaveLength(10);
    expect(hud.show).toHaveBeenCalled();
    expect(hud.setNight).toHaveBeenCalledWith(1);
    expect(hud.setSignals).toHaveBeenCalledWith(0, 5);  // night 1's quota, synced to the dock
  });

  it('startNight scales required count with night number', () => {
    gc.startNight(1);
    expect(hud.setSignals).toHaveBeenCalledWith(0, 5);

    gc.startNight(2);
    expect(hud.setSignals).toHaveBeenCalledWith(0, 6);
  });

  it('auto-starts night 1 on first update when autoStart is true', () => {
    gc.autoStart = true;
    gc.onUpdate(0.016);
    expect(gc.state).toBe('playing');
    expect(gc.nightNumber).toBe(1);
  });

  it('advances the clock on each update', () => {
    gc.startNight(1);
    gc.onUpdate(50);  // 1 in-game hour
    expect(clock.currentTime).toBeCloseTo(1.0);
  });

  it('triggers gameOver when clock finishes without enough signals', () => {
    gc.startNight(1);
    gc.onUpdate(999);  // past 6 AM
    expect(gc.state).toBe('gameOver');
    expect(hud.setPrompt).toHaveBeenCalledWith('Night failed. [E] to retry');
  });

  it('meeting the quota early keeps the shift running until 6 AM', () => {
    gc.startNight(1);  // required = 3
    meetQuota();

    expect(gc.state).toBe('playing');
    expect(clock.paused).toBe(false);
    expect(hud.setPrompt).toHaveBeenLastCalledWith('Quota met — hold out until 6:00 AM');

    gc.onUpdate(50);
    expect(clock.currentTime).toBeCloseTo(1.0);
  });

  it('does not announce the quota before it is met', () => {
    gc.startNight(1);
    quotaDock.collectedCount = 2;  // 2 out of 3

    gc.onSignalSaved();
    expect(gc.state).toBe('playing');
    expect(hud.setPrompt).not.toHaveBeenCalledWith(expect.stringMatching(/Quota met/));
  });

  it('turns to morning at 6 AM when the quota was met, and tells the player to sleep', () => {
    gc.startNight(1);
    meetQuota();
    gc.onUpdate(999);

    expect(gc.state).toBe('morning');
    expect(hud.setPrompt).toHaveBeenLastCalledWith('Shift over — get some sleep (bedroom)');
    expect(hud.setTime).toHaveBeenLastCalledWith('6:00 AM');
  });

  it('retryNight restarts the same night from gameOver', () => {
    gc.startNight(2);
    gc.onUpdate(999);
    expect(gc.state).toBe('gameOver');

    gc.retryNight();
    expect(gc.state).toBe('playing');
    expect(gc.nightNumber).toBe(2);  // same night
    expect(clock.elapsed).toBe(0);
    expect(quotaDock.collectedCount).toBe(0);
  });

  it('retryNight does nothing if not in gameOver', () => {
    gc.startNight(1);
    gc.retryNight();
    expect(gc.state).toBe('playing');  // unchanged
  });

  it('the interact key retries a failed night, as the prompt promises', () => {
    const engine = attachEngine();
    gc.startNight(2);
    gc.onUpdate(999);
    expect(gc.state).toBe('gameOver');

    gc.onUpdate(0.016);                 // no key: stays failed
    expect(gc.state).toBe('gameOver');

    engine.input.pressed.KeyE = true;   // one-frame press
    gc.onUpdate(0.016);
    expect(gc.state).toBe('playing');
    expect(gc.nightNumber).toBe(2);
    expect(clock.elapsed).toBe(0);
  });

  it('the interact key does not restart a night that is still running', () => {
    const engine = attachEngine();
    gc.startNight(1);
    gc.onUpdate(100);
    engine.input.pressed.KeyE = true;
    gc.onUpdate(0.016);
    expect(clock.elapsed).toBeGreaterThan(100);
  });

  describe('sleeping through the day', () => {
    let nights;

    beforeEach(() => {
      nights = new NightManager({ maxNight: 3 });
      gc.bindNights(nights);
    });

    it('bindNights starts the night the NightManager is on, and follows it', () => {
      expect(gc.state).toBe('playing');
      expect(gc.nightNumber).toBe(1);

      nights.setNight(3);
      expect(gc.nightNumber).toBe(3);
      expect(hud.setNight).toHaveBeenLastCalledWith(3);
    });

    it('bindNights returns an unsubscribe', () => {
      const other = new GameController();
      other.autoStart = false;
      const off = other.bindNights(nights);
      off();
      nights.setNight(2);
      expect(other.nightNumber).toBe(1);
    });

    it('sleep does nothing while the shift is running', () => {
      expect(gc.sleep()).toBe(false);
      expect(gc.state).toBe('playing');
      expect(nights.currentNight).toBe(1);
    });

    it('sleep does nothing after a failed night', () => {
      gc.onUpdate(999);
      expect(gc.sleep()).toBe(false);
      expect(gc.state).toBe('gameOver');
      expect(nights.currentNight).toBe(1);
    });

    it('sleep in the morning advances the night and starts it at 12:00 AM', () => {
      meetQuota();
      gc.onUpdate(999);
      expect(gc.state).toBe('morning');

      // Reset the dock for the new night (in production, BaseScene does this)
      quotaDock.collectedCount = 0;

      expect(gc.sleep()).toBe(true);
      expect(nights.currentNight).toBe(2);
      expect(gc.nightNumber).toBe(2);
      expect(gc.state).toBe('playing');
      expect(clock.currentTime).toBe(0);
      expect(clock.timeString).toBe('12:00 AM');
      expect(hud.setSignals).toHaveBeenLastCalledWith(0, 6);  // night 2's quota
    });

    it('sleeping after the last night finishes the run', () => {
      nights.setNight(3);
      meetQuota();
      gc.onUpdate(999);
      expect(gc.state).toBe('morning');

      expect(gc.sleep()).toBe(true);
      expect(gc.state).toBe('finished');
      expect(nights.currentNight).toBe(3);
      expect(hud.setPrompt).toHaveBeenLastCalledWith(expect.stringMatching(/every shift/i));

      // Nothing restarts from here.
      expect(gc.sleep()).toBe(false);
      gc.onUpdate(999);
      expect(gc.state).toBe('finished');
    });
  });

  it('updates HUD time and signals each frame', () => {
    gc.startNight(1);
    gc.onUpdate(50);

    expect(hud.setTime).toHaveBeenCalled();
    expect(hud.setSignals).toHaveBeenCalled();
  });

  it('shows scan progress when satellite is scanning', () => {
    gc.startNight(1);
    const sig = mgr.signals[0];
    sat.isScanning = true;
    sat.scanTarget = sig;
    sat.scanProgress = 1.5;

    gc.onUpdate(0.016);
    // scanTime default = 3, so 1.5/3 = 0.5
    expect(hud.setScanProgress).toHaveBeenCalledWith(0.5);
  });

  it('hides scan bar when not scanning', () => {
    gc.startNight(1);
    sat.isScanning = false;

    gc.onUpdate(0.016);
    expect(hud.setScanProgress).toHaveBeenCalledWith(-1);
  });

  it('onSignalDeleted updates HUD but does not change state', () => {
    gc.startNight(1);
    mgr.markScanned(1);
    mgr.deleteSignal(1);

    gc.onSignalDeleted();
    expect(gc.state).toBe('playing');
    expect(hud.setSignals).toHaveBeenCalled();
  });

  it('the clock holds at 6:00 AM all morning', () => {
    gc.startNight(1);
    meetQuota();
    gc.onUpdate(999);

    const before = clock.elapsed;
    gc.onUpdate(10);
    expect(clock.elapsed).toBe(before);
    expect(clock.timeString).toBe('6:00 AM');
  });

  // ── Signal appearance ticking ──

  it('ticks signal appearance with the night clock while playing', () => {
    gc.startNight(1);

    // Nothing visible at 12:00.
    expect(mgr.signals.every(s => !s.revealed)).toBe(true);

    // Make every signal due immediately; a few frames past the fade
    // window reveal them all.
    for (const sig of mgr.signals) sig.appearAt = 0;
    for (let i = 0; i < 5; i++) gc.onUpdate(1);

    expect(mgr.signals.every(s => s.appeared)).toBe(true);
    expect(mgr.signals.every(s => s.revealed)).toBe(true);
  });

  it('freezes signal appearance outside playing state', () => {
    gc.startNight(1);
    meetQuota();
    gc.onUpdate(999);            // → morning (clock paused by _endShift)
    expect(gc.state).toBe('morning');

    const snapshot = mgr.signals.map(s => ({ a: s.appeared, f: s.fadeElapsed }));
    gc.onUpdate(10);
    expect(mgr.signals.map(s => ({ a: s.appeared, f: s.fadeElapsed }))).toEqual(snapshot);
  });

  it('tolerates a missing signal manager', () => {
    gc.signalManager = null;
    gc.startNight(1);   // must not throw
    expect(() => gc.onUpdate(0.016)).not.toThrow();
  });
  describe('state change events', () => {
    it('notifies listeners with (state, previous) when a night starts', () => {
      const listener = vi.fn();
      gc.onStateChange(listener);
      gc.startNight(1);
      expect(listener).toHaveBeenCalledWith('playing', 'idle');
    });

    it('notifies on gameOver when the shift ends short of the quota', () => {
      const listener = vi.fn();
      gc.startNight(1);
      gc.onStateChange(listener);
      gc.onUpdate(400);   // past 6 AM, nothing saved
      expect(gc.state).toBe('gameOver');
      expect(listener).toHaveBeenCalledWith('gameOver', 'playing');
    });

    it('notifies on morning and on finished', () => {
      const nights = new NightManager({ maxNight: 1 });
      gc.bindNights(nights);
      const states = [];
      gc.onStateChange((state, previous) => states.push(`${previous}->${state}`));
      meetQuota();
      gc.onUpdate(400);
      gc.sleep();
      expect(states).toEqual(['playing->morning', 'morning->finished']);
    });

    it('does not notify when the state does not change', () => {
      gc.startNight(1);
      const listener = vi.fn();
      gc.onStateChange(listener);
      gc.startNight(1);   // playing -> playing
      expect(listener).not.toHaveBeenCalled();
    });

    it('returns an unsubscribe function', () => {
      const listener = vi.fn();
      const off = gc.onStateChange(listener);
      off();
      gc.startNight(1);
      expect(listener).not.toHaveBeenCalled();
    });

    it('lets a listener unsubscribe while being notified', () => {
      const second = vi.fn();
      let off;
      off = gc.onStateChange(() => off());
      gc.onStateChange(second);
      gc.startNight(1);
      expect(second).toHaveBeenCalledOnce();
    });
  });

  // ── Threat hooks ──

  it('tells night-start listeners each night it starts, until unsubscribed', () => {
    const fn = vi.fn();
    const off = gc.onNightStart(fn);
    gc.startNight(2);
    expect(fn).toHaveBeenCalledWith(2, { retry: false });
    off();
    gc.startNight(3);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fail() ends a playing shift as a game over with its own prompt', () => {
    gc.startNight(1);
    gc.fail('You were taken. [E] to retry');
    expect(gc.state).toBe('gameOver');
    expect(hud.setPrompt).toHaveBeenLastCalledWith('You were taken. [E] to retry');
    gc.retryNight();
    expect(gc.state).toBe('playing');
  });

  it('fail() can hold the retry back: no prompt and no [E] until it is shown', () => {
    const engine = attachEngine();
    gc.startNight(1);
    gc.fail('You have been eaten. Press [E] to try again', { retryAfter: 2 });
    expect(gc.state).toBe('gameOver');
    expect(hud.setPrompt).not.toHaveBeenLastCalledWith('You have been eaten. Press [E] to try again');
    engine.input.pressed.KeyE = true;   // mashed straight away
    gc.onUpdate(0.5);
    expect(gc.state).toBe('gameOver');
    engine.input.pressed.KeyE = false;
    gc.onUpdate(1.6);
    expect(hud.setPrompt).toHaveBeenLastCalledWith('You have been eaten. Press [E] to try again');
    engine.input.pressed.KeyE = true;
    gc.onUpdate(0.016);
    expect(gc.state).toBe('playing');
  });

  it('fail() does nothing outside a playing shift', () => {
    gc.startNight(1);
    gc._morning();
    gc.fail('nope');
    expect(gc.state).toBe('morning');
  });

  it('tells night-start listeners whether the night is a retry', () => {
    const fn = vi.fn();
    gc.onNightStart(fn);
    gc.startNight(1);
    expect(fn).toHaveBeenLastCalledWith(1, { retry: false });
    gc.fail('taken');
    gc.retryNight();
    expect(fn).toHaveBeenLastCalledWith(1, { retry: true });
  });

  it('the E that retries is used up — nothing else acts on that press', () => {
    const engine = {
      keyBinds: { interact: 'KeyE' },
      input: { pressed: { KeyE: true } },
      consumeAction: vi.fn(),
    };
    gc.gameObject = { scene: { userData: { engine } } };
    gc.startNight(1);
    gc.fail('taken');
    gc.onUpdate(0.016);
    expect(gc.state).toBe('playing');
    expect(engine.consumeAction).toHaveBeenCalledWith('interact');
  });
});

// ─────────────────────────────────────────────
// One twelve-hour shift: 6 PM to 6 AM, no overtime
// ─────────────────────────────────────────────

describe('GameController — one twelve-hour shift', () => {
  let gc, clock, hud, quotaDock, nights;
  const perHour = NIGHT_SECONDS / (SHIFT.endHour - SHIFT.startHour);
  /** Run the clock on to `hour` (clock hours from midnight). */
  const runTo = (hour) => gc.onUpdate((hour - clock.currentTime) * perHour);

  beforeEach(() => {
    gc = new GameController();
    clock = new NightClock();                          // 6 PM → 6 AM
    hud = makeHUD();
    quotaDock = {
      requiredCount: 3,
      collectedCount: 0,
      isQuotaMet() { return this.collectedCount >= this.requiredCount; },
    };
    Object.assign(gc, { nightClock: clock, hud, quotaDock, satellite: makeSatellite(), autoStart: false });
    nights = new NightManager({ maxNight: 3 });
    gc.bindNights(nights);
  });

  it('a quota met early keeps the shift running all night — no bed before 6 AM', () => {
    quotaDock.collectedCount = 3;
    gc.onSignalSaved();
    expect(hud.setPrompt).toHaveBeenLastCalledWith(expect.stringMatching(/6:00 AM/));
    for (const hour of [0, 3, 5.9]) {
      runTo(hour);
      expect(gc.state, `at ${hour}`).toBe('playing');
      expect(gc.canSleep).toBe(false);
      expect(gc.sleep()).toBe(false);
    }
    expect(gc.overtime).toBeUndefined();
  });

  it('makes it morning at 6 AM with the quota met, and the bed takes the player to the next dusk', () => {
    quotaDock.collectedCount = 3;
    runTo(6);
    expect(gc.state).toBe('morning');
    expect(gc.canSleep).toBe(true);
    expect(gc.sleep()).toBe(true);
    expect(nights.currentNight).toBe(2);
    expect(clock.timeString).toBe('6:00 PM');
  });

  it('fails the night at 6 AM with the quota missed', () => {
    runTo(6);
    expect(gc.state).toBe('gameOver');
    expect(gc.canSleep).toBe(false);
  });
});

describe('GameController.refreshPrompt', () => {
  it('puts the shift prompt back up after something else wrote over it (a nap\'s wake-up line)', () => {
    const gc = new GameController();
    const hud = makeHUD();
    const quotaDock = { requiredCount: 1, collectedCount: 1, isQuotaMet() { return true; } };
    Object.assign(gc, { nightClock: new NightClock(), hud, quotaDock, satellite: makeSatellite(), autoStart: false });
    gc.startNight(1);
    gc.onUpdate(0.016);
    expect(hud.setPrompt).toHaveBeenLastCalledWith('Quota met — hold out until 6:00 AM');
    hud.setPrompt('The power went out.');
    gc.onUpdate(0.016);
    expect(hud.setPrompt).toHaveBeenLastCalledWith('The power went out.');   // set only on change
    gc.refreshPrompt();
    gc.onUpdate(0.016);
    expect(hud.setPrompt).toHaveBeenLastCalledWith('Quota met — hold out until 6:00 AM');
  });
});

