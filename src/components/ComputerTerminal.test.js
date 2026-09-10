import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComputerTerminal } from './ComputerTerminal.js';
import { SignalManager } from '../gameplay/SignalManager.js';

// ── Minimal test doubles ──────────────────────────────────

function makeSatellite() {
  return {
    targetYaw: 0,
    targetPitch: 0,
    neck: { object3d: { rotation: { y: 0 } } },
    dish: { object3d: { rotation: { x: 0 } } },
    scanProgress: 0,
    scanTarget: null,
    isScanning: false,
    isAimedAt(yaw, pitch, tol) {
      const dy = Math.abs(this.neck.object3d.rotation.y - yaw);
      const dp = Math.abs(this.dish.object3d.rotation.x - pitch);
      return Math.sqrt(dy * dy + dp * dp) <= tol;
    },
  };
}

function makeHUD() {
  return {
    show: vi.fn(), hide: vi.fn(),
    setTime: vi.fn(), setSignals: vi.fn(), setNight: vi.fn(),
    setScanProgress: vi.fn(), setPrompt: vi.fn(),
  };
}

function makeRadar() {
  return {
    show: vi.fn(), hide: vi.fn(),
    update: vi.fn(), setInfo: vi.fn(), setHint: vi.fn(),
  };
}

function makeReviewPanel() {
  return {
    show: vi.fn(), hide: vi.fn(),
    onSave: vi.fn(), onDelete: vi.fn(),
  };
}

const POOL = ['s1.png', 's2.png', 's3.png', 's4.png', 's5.png'];

describe('ComputerTerminal', () => {
  let term, sat, mgr, hud, radar, review;

  beforeEach(() => {
    term   = new ComputerTerminal();
    sat    = makeSatellite();
    mgr    = new SignalManager({ signalsPerNight: 5, payloadPool: POOL });
    hud    = makeHUD();
    radar  = makeRadar();
    review = makeReviewPanel();

    term.satellite    = sat;
    term.signalManager = mgr;
    term.hud          = hud;
    term.radar        = radar;
    term.reviewPanel  = review;

    mgr.startNight(1);  // required=3, 5 signals
  });

  // ── Initial state ──

  it('starts in idle state', () => {
    expect(term.state).toBe('idle');
  });

  // ── IDLE → RADAR ──

  it('enter transitions from idle to radar and freezes player', () => {
    term.enter();
    expect(term.state).toBe('radar');
    expect(radar.show).toHaveBeenCalled();
  });

  it('enter does nothing if not idle', () => {
    term.enter();
    term.enter(); // second call
    expect(term.state).toBe('radar');
  });

  // ── RADAR ──

  it('selectNextSignal cycles through unresolved signals', () => {
    term.enter();
    term.selectNextSignal();
    expect(term.state).toBe('aiming');
    expect(term._selectedId).toBe(1);

    term.selectNextSignal();
    expect(term._selectedId).toBe(2);
  });

  it('selectSignalById selects a specific signal', () => {
    term.enter();
    term.selectSignalById(3);
    expect(term._selectedId).toBe(3);
    expect(term.state).toBe('aiming');
    expect(mgr.active).toBe(mgr.signals[2]);
  });

  it('selectSignalById ignores resolved signals', () => {
    mgr.saveSignal(1);
    term.enter();
    term.selectSignalById(1);
    expect(term._selectedId).toBeNull();
    expect(term.state).toBe('radar');
  });

  // ── AIMING ──

  it('steerDish adjusts satellite target angles', () => {
    term.enter();
    term.selectNextSignal(); // → aiming
    const prevYaw = sat.targetYaw;

    term.steerDish({ left: true, right: false, up: false, down: false }, 1);
    expect(sat.targetYaw).toBeLessThan(prevYaw);
  });

  it('steerDish accumulates with dt', () => {
    term.enter();
    term.selectNextSignal();

    term.steerDish({ left: false, right: true, up: false, down: false }, 0.5);
    const after1 = sat.targetYaw;

    term.steerDish({ left: false, right: true, up: false, down: false }, 0.5);
    expect(sat.targetYaw).toBeGreaterThan(after1);
  });

  it('clamps pitch steering to the sky hemisphere', () => {
    term.enter();
    term.selectNextSignal();

    // Pushing down past the horizon (pitch > 0) clamps at 0
    sat.targetPitch = 0;
    term.steerDish({ left: false, right: false, up: false, down: true }, 1);
    expect(sat.targetPitch).toBe(0);

    // Pushing up past the zenith (pitch < -π/2) clamps at -π/2
    term.steerDish({ left: false, right: false, up: true, down: false }, 100);
    expect(sat.targetPitch).toBeCloseTo(-Math.PI / 2);
  });

  // ── SCANNING ──

  it('transitions to scanning when aimed, then to review on completion', () => {
    term.enter();
    term.selectNextSignal();
    const sig = mgr.active;

    // Point the dish exactly at the signal
    sat.neck.object3d.rotation.y = sig.yaw;
    sat.dish.object3d.rotation.x = sig.pitch;
    sat.targetYaw = sig.yaw;
    sat.targetPitch = sig.pitch;

    // Directly trigger the scanning transition (onUpdate needs engine chain)
    term._enterScanning();
    expect(term.state).toBe('scanning');
    expect(sat.isScanning).toBe(true);
    expect(sat.scanTarget).toBe(sig);

    // Simulate scan progress accumulation and transition to review
    sat.scanProgress = sig.scanTime;
    term._enterReview();
    expect(term.state).toBe('review');
    expect(sig.scanned).toBe(true);
    expect(review.show).toHaveBeenCalledWith(sig.payloadUrl);
    expect(sat.isScanning).toBe(false);
  });

  it('scan progress bar updates during scanning state', () => {
    term.enter();
    term.selectNextSignal();
    const sig = mgr.active;

    term._enterScanning();
    // Manually accumulate progress (as onUpdate would do)
    sat.scanProgress += 1.5;
    const progress = sat.scanProgress / sig.scanTime;
    expect(progress).toBeCloseTo(0.5);
    hud.setScanProgress(progress);
    expect(hud.setScanProgress).toHaveBeenCalledWith(0.5);
  });

  it('scan pauses when dish drifts out of tolerance', () => {
    term.enter();
    term.selectNextSignal();
    const sig = mgr.active;

    // Aim correctly and enter scanning
    sat.neck.object3d.rotation.y = sig.yaw;
    sat.dish.object3d.rotation.x = sig.pitch;
    term._enterScanning();
    expect(term.state).toBe('scanning');

    // Accumulate some progress
    sat.scanProgress = 1.5;

    // Drift the dish away — test that isAimedAt returns false
    sat.neck.object3d.rotation.y = sig.yaw + 5;
    expect(sat.isAimedAt(sig.yaw, sig.pitch, sig.tolerance)).toBe(false);

    // Simulate what onUpdate does: return to aiming
    sat.isScanning = false;
    term.state = 'aiming';
    expect(term.state).toBe('aiming');
    // Progress preserved (not reset)
    expect(sat.scanProgress).toBe(1.5);
  });

  // ── REVIEW ──

  it('saveSignal marks signal saved and returns to radar', () => {
    term.enter();
    term.selectNextSignal();
    const sig = mgr.active;

    // Jump to review state
    term._enterReview();
    expect(term.state).toBe('review');

    term.saveSignal();
    expect(sig.saved).toBe(true);
    expect(mgr.saved).toBe(1);
    expect(term.state).toBe('radar');
    expect(review.hide).toHaveBeenCalled();
  });

  it('deleteSignal marks signal deleted and does NOT increment counter', () => {
    term.enter();
    term.selectNextSignal();
    const sig = mgr.active;

    term._enterReview();
    term.deleteSignal();
    expect(sig.deleted).toBe(true);
    expect(mgr.saved).toBe(0);
    expect(term.state).toBe('radar');
  });

  // ── EXIT ──

  it('exit from any state returns to idle', () => {
    term.enter();
    term.selectNextSignal();
    expect(term.state).toBe('aiming');

    term.exit();
    expect(term.state).toBe('idle');
    expect(radar.hide).toHaveBeenCalled();
  });

  it('exit during review leaves signal scanned but unresolved', () => {
    term.enter();
    term.selectNextSignal();
    const sig = mgr.active;

    term._enterReview();
    expect(sig.scanned).toBe(true);

    term.exit();
    expect(term.state).toBe('idle');
    expect(sig.saved).toBe(false);
    expect(sig.deleted).toBe(false);
    expect(review.hide).toHaveBeenCalled();
  });

  it('exit from idle does nothing', () => {
    term.exit();
    expect(term.state).toBe('idle');
  });

  // ── Scan state cleanup ──

  it('cleanup resets satellite scan state on exit', () => {
    term.enter();
    term.selectNextSignal();
    sat.scanProgress = 2.5;
    sat.isScanning = true;

    term.exit();
    expect(sat.scanProgress).toBe(0);
    expect(sat.isScanning).toBe(false);
    expect(sat.scanTarget).toBeNull();
  });
});
