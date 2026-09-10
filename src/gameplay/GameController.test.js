import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameController } from './GameController.js';
import { NightClock } from './NightClock.js';
import { SignalManager } from './SignalManager.js';

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

  it('triggers nightComplete when quota is met before night ends', () => {
    gc.startNight(1);  // required = 3
    mgr.saveSignal(1);
    mgr.saveSignal(2);
    mgr.saveSignal(3);

    gc.onSignalSaved();  // third save triggers completion check
    expect(gc.state).toBe('nightComplete');
  });

  it('does not trigger nightComplete if quota not met', () => {
    gc.startNight(1);
    mgr.saveSignal(1);
    mgr.saveSignal(2);

    gc.onSignalSaved();
    expect(gc.state).toBe('playing');
  });

  it('retryNight restarts the same night from gameOver', () => {
    gc.startNight(2);
    gc.onUpdate(999);
    expect(gc.state).toBe('gameOver');

    gc.retryNight();
    expect(gc.state).toBe('playing');
    expect(gc.nightNumber).toBe(2);  // same night
    expect(clock.elapsed).toBe(0);
  });

  it('nextNight advances from nightComplete', () => {
    gc.startNight(1);
    gc.state = 'nightComplete';

    gc.nextNight();
    expect(gc.state).toBe('playing');
    expect(gc.nightNumber).toBe(2);
  });

  it('retryNight does nothing if not in gameOver', () => {
    gc.startNight(1);
    gc.retryNight();
    expect(gc.state).toBe('playing');  // unchanged
  });

  it('nextNight does nothing if not in nightComplete', () => {
    gc.startNight(1);
    gc.nextNight();
    expect(gc.state).toBe('playing');  // unchanged
  });

  it('updates HUD time and signals each frame', () => {
    gc.startNight(1);
    gc.onUpdate(50);

    expect(hud.setTime).toHaveBeenCalled();
    expect(hud.setSignals).toHaveBeenCalled();
  });

  it('shows scan progress when satellite is scanning', () => {
    gc.startNight(1);
    mgr.selectSignal(1);
    sat.isScanning = true;
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

  it('clock does not advance while in nightComplete', () => {
    gc.startNight(1);
    gc.state = 'nightComplete';
    clock.pause();

    const before = clock.elapsed;
    gc.onUpdate(10);
    expect(clock.elapsed).toBe(before);
  });
});
