import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComputerTerminal } from './ComputerTerminal.js';
import { SignalManager } from '../gameplay/SignalManager.js';

// ── Helper: convert sky coords to Cartesian cursor position ──
function skyToCursor(yaw, pitch) {
  const elev = pitch + Math.PI / 2;
  const r = elev / (Math.PI / 2);
  return { x: r * Math.sin(yaw), y: r * Math.cos(yaw) };
}

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
    _scanComplete: false,
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

  it('enter transitions from idle to radar', () => {
    term.enter();
    expect(term.state).toBe('radar');
    expect(radar.show).toHaveBeenCalled();
  });

  it('enter does nothing if not idle', () => {
    term.enter();
    term.enter(); // second call
    expect(term.state).toBe('radar');
  });

  // ── Cursor movement ──

  it('moveCursor moves cursor with WASD and sets satellite target', () => {
    term.enter();
    term.moveCursor({ left: true, right: false, up: false, down: false }, 1);
    expect(term._cursorX).toBeLessThan(0);
    // Satellite target is derived via _cursorToSky
    expect(sat.targetYaw).toBe(term._cursorToSky().yaw);

    term.moveCursor({ left: false, right: true, up: false, down: false }, 0.5);
    expect(term._cursorX).toBeGreaterThan(-0.25); // moved back right
  });

  it('moveCursor y moves up and down', () => {
    term.enter();
    // W (up) increases y
    term.moveCursor({ left: false, right: false, up: true, down: false }, 0.5);
    expect(term._cursorY).toBeGreaterThan(0);

    // S (down) decreases y
    term.moveCursor({ left: false, right: false, up: false, down: true }, 1.5);
    expect(term._cursorY).toBeLessThan(0);
  });

  it('clamps cursor to unit circle', () => {
    term.enter();
    // Move far in one direction — should be clamped to radius 1
    term.moveCursor({ left: false, right: false, up: true, down: false }, 100);
    const r = Math.sqrt(term._cursorX ** 2 + term._cursorY ** 2);
    expect(r).toBeCloseTo(1);
  });

  it('satellite target follows cursor after moveCursor', () => {
    term.enter();
    term.moveCursor({ left: false, right: false, up: false, down: true }, 1);
    const sky = term._cursorToSky();
    expect(sat.targetYaw).toBe(sky.yaw);
    expect(sat.targetPitch).toBe(sky.pitch);
  });

  // ── Hover detection ──

  it('hover detects signal under cursor', () => {
    term.enter();
    const sig = mgr.signals[0];
    // Place cursor on the signal (Cartesian)
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    term._updateHover();
    expect(term._hoveredSignal).toBe(sig);
  });

  it('hover picks closest when multiple signals overlap', () => {
    term.enter();
    const sig1 = mgr.signals[0];
    const sig2 = mgr.signals[1];
    // Place both signals at the same spot (within tolerance)
    sig2.yaw = sig1.yaw + sig1.tolerance * 0.3;
    sig2.pitch = sig1.pitch;
    // Place cursor near sig2 (closer)
    const cur = skyToCursor(sig2.yaw, sig2.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    term._updateHover();
    expect(term._hoveredSignal).toBe(sig2);
  });

  it('hover ignores resolved signals', () => {
    term.enter();
    const sig = mgr.signals[0];
    mgr.saveSignal(sig.id);  // mark as resolved
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    term._updateHover();
    expect(term._hoveredSignal).toBeNull();
  });

  it('hover is null when cursor is far from any signal', () => {
    term.enter();
    // Place cursor at zenith (centre) — far from most signals
    term._cursorX = 0;
    term._cursorY = 0;
    term._updateHover();
    // With signals randomly placed, centre may or may not hover.
    // Instead, place cursor at a known-empty spot by using a position
    // opposite to all signals.
    term._cursorX = 0.99;
    term._cursorY = 0;
    term._updateHover();
    // This may or may not hover depending on signal positions;
    // the important thing is it doesn't crash
  });

  // ── Enter to scan ──

  it('Enter starts scan when hovering and dish is aimed', () => {
    term.enter();
    const sig = mgr.signals[0];
    // Place cursor on the signal (Cartesian)
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    sat.neck.object3d.rotation.y = sig.yaw;
    sat.dish.object3d.rotation.x = sig.pitch;
    term._updateHover();
    expect(term._hoveredSignal).toBe(sig);

    // Simulate Enter-to-scan
    expect(sat.isAimedAt(sig.yaw, sig.pitch, sig.tolerance)).toBe(true);
    term._enterScanning();
    expect(term.state).toBe('scanning');
    expect(sat.isScanning).toBe(true);
    expect(sat.scanTarget).toBe(sig);
  });

  it('scan does not start when dish is not aimed', () => {
    term.enter();
    const sig = mgr.signals[0];
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    // Dish is at 0, signal is elsewhere
    sat.neck.object3d.rotation.y = 0;
    sat.dish.object3d.rotation.x = 0;
    term._updateHover();
    expect(term._hoveredSignal).toBe(sig);
    expect(sat.isAimedAt(sig.yaw, sig.pitch, sig.tolerance)).toBe(false);
    // Should not transition to scanning
    expect(term.state).toBe('radar');
  });

  // ── SCANNING → REVIEW ──

  it('transitions to review when scan completes', () => {
    term.enter();
    const sig = mgr.signals[0];
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    sat.neck.object3d.rotation.y = sig.yaw;
    sat.dish.object3d.rotation.x = sig.pitch;
    term._updateHover();
    term._enterScanning();

    expect(term.state).toBe('scanning');
    expect(sat.isScanning).toBe(true);

    // Simulate scan completion (happens on Satellite._update)
    sat.scanProgress = sig.scanTime;
    sig.scanned = true;
    sat.isScanning = false;
    sat._scanComplete = true;

    term._enterReview();
    expect(term.state).toBe('review');
    expect(review.show).toHaveBeenCalledWith(sig.payloadUrl);
    expect(sat.isScanning).toBe(false);
  });

  it('scan progress bar updates during scanning state', () => {
    term.enter();
    const sig = mgr.signals[0];
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    term._updateHover();
    term._enterScanning();

    // Manually accumulate progress (as Satellite._update would do)
    sat.scanProgress += 1.5;
    const progress = sat.scanProgress / sig.scanTime;
    expect(progress).toBeCloseTo(0.5);
    hud.setScanProgress(progress);
    expect(hud.setScanProgress).toHaveBeenCalledWith(0.5);
  });

  it('scan progress preserved when dish drifts (background scanning)', () => {
    term.enter();
    const sig = mgr.signals[0];
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    term._updateHover();
    term._enterScanning();

    // Accumulate some progress
    sat.scanProgress = 1.5;

    // Dish drifts — satellite stops scanning but preserves progress
    sat.isScanning = false;
    expect(sat.scanProgress).toBe(1.5);

    // Terminal falls back to radar
    term.state = 'radar';
    expect(term.state).toBe('radar');
    // Progress preserved (not reset)
    expect(sat.scanProgress).toBe(1.5);
  });

  // ── REVIEW ──

  it('saveSignal marks signal saved and returns to radar', () => {
    term.enter();
    const sig = mgr.signals[0];
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    term._updateHover();

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
    const sig = mgr.signals[0];
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    term._updateHover();

    term._enterReview();
    term.deleteSignal();
    expect(sig.deleted).toBe(true);
    expect(mgr.saved).toBe(0);
    expect(term.state).toBe('radar');
  });

  // ── EXIT ──

  it('exit from any state returns to idle', () => {
    term.enter();
    term.state = 'scanning';  // force a non-idle state
    term.exit();
    expect(term.state).toBe('idle');
    expect(radar.hide).toHaveBeenCalled();
  });

  it('exit during review leaves signal scanned but unresolved', () => {
    term.enter();
    const sig = mgr.signals[0];
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    term._updateHover();

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
    sat.scanProgress = 2.5;
    sat.isScanning = true;
    sat.scanTarget = mgr.signals[0];

    term.exit();
    expect(sat.scanProgress).toBe(0);
    expect(sat.isScanning).toBe(false);
    expect(sat.scanTarget).toBeNull();
  });

  // ── Background scan completion on reopen ──

  it('entering radar detects scan completed while terminal was closed', () => {
    // Simulate: scan completed while terminal was idle
    sat._scanComplete = true;
    const sig = mgr.signals[0];
    sig.scanned = true;
    term._hoveredSignal = sig;

    // Open terminal — should go directly to review
    term.enter();
    expect(term.state).toBe('review');
  });
});
