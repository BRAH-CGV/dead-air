import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameController } from './GameController.js';
import { NightClock } from './NightClock.js';
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
  let gc, clock, mgr, hud, sat;

  beforeEach(() => {
    gc   = new GameController();
    clock = new NightClock({ nightDuration: 300 });
    mgr  = new SignalManager({ signalsPerNight: 5, payloadPool: POOL });
    hud  = makeHUD();
    sat  = makeSatellite();

    gc.nightClock    = clock;
    gc.signalManager = mgr;
    gc.hud           = hud;
    gc.satellite     = sat;
    gc.autoStart     = false;  // manual control for tests
  });

  /** Save the current night's whole quota through the controller. */
  function meetQuota() {
    for (let id = 1; id <= mgr.required; id++) mgr.saveSignal(id);
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
    expect(mgr.signals).toHaveLength(5);
    expect(hud.show).toHaveBeenCalled();
    expect(hud.setNight).toHaveBeenCalledWith(1);
    expect(hud.setSignals).toHaveBeenCalledWith(0, 3);
  });

  it('startNight scales required count with night number', () => {
    gc.startNight(1);
    expect(hud.setSignals).toHaveBeenCalledWith(0, 3);

    gc.startNight(2);
    expect(hud.setSignals).toHaveBeenCalledWith(0, 4);
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
    mgr.saveSignal(1);
    mgr.saveSignal(2);

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
    expect(mgr.getProgress().saved).toBe(0);
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

      expect(gc.sleep()).toBe(true);
      expect(nights.currentNight).toBe(2);
      expect(gc.nightNumber).toBe(2);
      expect(gc.state).toBe('playing');
      expect(clock.currentTime).toBe(0);
      expect(clock.timeString).toBe('12:00 AM');
      expect(hud.setSignals).toHaveBeenLastCalledWith(0, 4);  // night 2's quota
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

  describe('fail(reason) — a threat ends the night', () => {
    it('from playing: gameOver, the clock stops, the reason is kept and shown with the retry key', () => {
      gc.startNight(2);
      gc.onUpdate(50);
      gc.fail('Something saw you through the window.');

      expect(gc.state).toBe('gameOver');
      expect(gc.failReason).toBe('Something saw you through the window.');
      expect(clock.paused).toBe(true);
      expect(hud.setPrompt).toHaveBeenLastCalledWith('Something saw you through the window. [E] to retry');

      const before = clock.elapsed;
      gc.onUpdate(10);
      expect(clock.elapsed).toBe(before);
    });

    it('is a no-op in the morning — a threat that fires after 6 AM must not kill', () => {
      gc.startNight(1);
      meetQuota();
      gc.onUpdate(999);
      expect(gc.state).toBe('morning');

      gc.fail('too late');
      expect(gc.state).toBe('morning');
      expect(gc.failReason).toBeNull();
    });

    it('is a no-op once the night has already failed, or before any night', () => {
      gc.fail('idle');
      expect(gc.state).toBe('idle');
      expect(gc.failReason).toBeNull();

      gc.startNight(1);
      gc.fail('first');
      gc.fail('second');
      expect(gc.failReason).toBe('first');
    });

    it('startNight clears the reason, and a failed night retries like a missed quota', () => {
      const engine = attachEngine();
      gc.startNight(3);
      gc.onUpdate(100);
      gc.fail('The camera found you.');

      engine.input.pressed.KeyE = true;
      gc.onUpdate(0.016);
      expect(gc.state).toBe('playing');
      expect(gc.nightNumber).toBe(3);
      expect(gc.failReason).toBeNull();
      expect(clock.elapsed).toBe(0);
      expect(clock.paused).toBe(false);
    });

    it('a missed quota at 6 AM still reads as the plain failure, with no reason', () => {
      gc.startNight(1);
      gc.onUpdate(999);
      expect(gc.state).toBe('gameOver');
      expect(gc.failReason).toBeNull();
    });
  });

  describe('night 3 storage', () => {
    // Storage from night 3: the terminal holds two saved signals, and only
    // those stored at the server console count. Night 3 needs 5.
    beforeEach(() => {
      mgr = new SignalManager({ signalsPerNight: 5, payloadPool: POOL, storageFromNight: 3, storageCapacity: 2 });
      gc.signalManager = mgr;
      gc.startNight(3);
    });

    /** Save and store signals in pairs, through the controller. */
    function saveAndStore(ids) {
      for (const id of ids) {
        mgr.saveSignal(id);
        gc.onSignalSaved();
      }
      mgr.storeSignals();
      gc.onSignalsStored();
    }

    it('shows stored signals as the count, and saved-but-unstored ones as waiting', () => {
      mgr.saveSignal(1);
      gc.onSignalSaved();
      expect(hud.setSignals).toHaveBeenLastCalledWith(0, 5, 1);

      mgr.storeSignals();
      gc.onSignalsStored();
      expect(hud.setSignals).toHaveBeenLastCalledWith(1, 5, 0);
    });

    it('saving the last signals is not the quota — storing them is', () => {
      saveAndStore([1, 2]);
      saveAndStore([3, 4]);
      mgr.saveSignal(5);
      gc.onSignalSaved();
      expect(hud.setPrompt).not.toHaveBeenCalledWith(expect.stringMatching(/Quota met/));

      mgr.storeSignals();
      gc.onSignalsStored();
      expect(hud.setPrompt).toHaveBeenLastCalledWith('Quota met — hold out until 6:00 AM');
    });

    it('a full terminal tells the player to store', () => {
      mgr.saveSignal(1);
      mgr.saveSignal(2);
      gc.onSignalSaved();
      expect(hud.setPrompt).toHaveBeenLastCalledWith('Terminal full — store signals at the server console');
    });

    it('storing clears the full-terminal prompt', () => {
      mgr.saveSignal(1);
      mgr.saveSignal(2);
      gc.onSignalSaved();
      mgr.storeSignals();
      gc.onSignalsStored();
      expect(hud.setPrompt).toHaveBeenLastCalledWith('');
    });

    it('signals still waiting at 6 AM do not count', () => {
      saveAndStore([1, 2]);
      saveAndStore([3, 4]);
      mgr.saveSignal(5);
      gc.onSignalSaved();
      gc.onUpdate(999);
      expect(gc.state).toBe('gameOver');
    });

    it('every signal stored by 6 AM is a morning', () => {
      saveAndStore([1, 2]);
      saveAndStore([3, 4]);
      saveAndStore([5]);
      gc.onUpdate(999);
      expect(gc.state).toBe('morning');
    });

    it('storing does nothing once the shift is over', () => {
      gc.onUpdate(999);
      gc.onSignalsStored();
      expect(hud.setPrompt).toHaveBeenLastCalledWith('Night failed. [E] to retry');
    });
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
});
