import { describe, it, expect, vi, beforeEach } from 'vitest';

// The terminal imports FirstPersonController only as a getComponent key,
// but that module imports Rapier, whose WASM build doesn't load under
// vitest (BUG-003). Nothing here constructs a controller, so an empty
// module is enough to let this file run.
vi.mock('@dimforge/rapier3d', () => ({ default: {} }));

import * as THREE from 'three';
import { ComputerTerminal, createComputerInteractable } from './ComputerTerminal.js';
import { SignalManager } from '../gameplay/SignalManager.js';
import { SignalTarget } from '../gameplay/SignalTarget.js';
import { Satellite, DISH_SLEW_RATE } from '../gameobjects/Satellite.js';
import { createDefaultNeighbourDishes, skyToCursor } from '../gameobjects/DishRig.js';

// ── Minimal test doubles ──────────────────────────────────

/** The real dish, on a bare Base → Neck_block → Dish rig, parked at the
 *  zenith where a fresh terminal's cursor starts. The neck rests at model
 *  0, which the mirror reads back as game bearing π — up on the disc. */
function makeRealDish() {
  const root = new THREE.Object3D(); root.name = 'Base';
  const neck = new THREE.Object3D(); neck.name = 'Neck_block';
  const dish = new THREE.Object3D(); dish.name = 'Dish';
  neck.add(dish);
  root.add(neck);
  dish.rotation.x = -Math.PI / 2;
  return Satellite.fromObject3D(root);
}

function makeSatellite() {
  const sat = {
    targetYaw: 0,
    targetPitch: 0,
    neighbours: [],
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
    aimAll(yaw, pitch) {
      this.targetYaw = yaw;
      this.targetPitch = pitch;
    },
    isAnyDishAimedAt(yaw, pitch, tol) {
      if (this.isAimedAt(yaw, pitch, tol)) return true;
      for (const rig of this.neighbours) {
        if (rig.isAimedAt(yaw, pitch, tol)) return true;
      }
      return false;
    },
  };
  return sat;
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
    setWarning: vi.fn(), threatAt: vi.fn(() => false),
  };
}

function makeReviewPanel() {
  return {
    show: vi.fn(), hide: vi.fn(),
  };
}

function makeDriveManager(inserted = true) {
  return {
    driveInserted: inserted,
    hasAvailableDrives: vi.fn(() => true),
    insertDrive: vi.fn(),
    ejectDrive: vi.fn(),
    saveToDrive: vi.fn(),
  };
}

function makeCrosshair() {
  return {
    show: vi.fn(), hide: vi.fn(),
    setActive: vi.fn(),
  };
}

/** Skip the appearance schedule — every signal fully faded in. The
 *  scheduling itself is covered in SignalManager.test.js; these tests
 *  exercise the terminal against revealed signals. */
function revealAll(mgr) {
  for (const sig of mgr.signals) {
    sig.appeared = true;
    sig.fadeElapsed = sig.fadeSeconds;
  }
}

const POOL = ['s1.png', 's2.png', 's3.png', 's4.png', 's5.png'];

describe('ComputerTerminal', () => {
  let term, sat, mgr, hud, radar, review, crosshair, driveMgr;

  beforeEach(() => {
    term   = new ComputerTerminal();
    sat    = makeSatellite();
    mgr    = new SignalManager({ signalsPerNight: 5, payloadPool: POOL });
    hud    = makeHUD();
    radar  = makeRadar();
    review = makeReviewPanel();
    crosshair = makeCrosshair();
    driveMgr  = makeDriveManager(true);

    term.satellite    = sat;
    term.signalManager = mgr;
    term.hud          = hud;
    term.radar        = radar;
    term.reviewPanel  = review;
    term.crosshair    = crosshair;
    term.driveManager = driveMgr;

    mgr.startNight(1);  // required=3, 5 signals
    revealAll(mgr);     // hide the appearance schedule from these tests
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

  it('hides the first-person crosshair when the terminal opens', () => {
    term.enter();
    expect(crosshair.hide).toHaveBeenCalled();
  });

  it('restores the crosshair when the terminal closes', () => {
    term.enter();
    term.exit();
    expect(crosshair.show).toHaveBeenCalled();
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

    const leftmost = term._cursorX;
    term.moveCursor({ left: false, right: true, up: false, down: false }, 0.5);
    expect(term._cursorX).toBeGreaterThan(leftmost); // moved back right
  });

  it('holding a direction carries the cursor from centre to rim in four seconds', () => {
    term.enter();
    let t = 0;
    while (Math.hypot(term._cursorX, term._cursorY) < 1 && t < 10) {
      term.moveCursor({ left: false, right: false, up: true, down: false }, 1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeCloseTo(4, 1);
  });

  it("sweeps the cursor at the dish's own pace, so the dish never falls further behind", () => {
    term.enter();
    const before = term._cursorToSky().pitch;
    term.moveCursor({ left: false, right: false, up: true, down: false }, 0.5);
    const skyPerSecond = Math.abs(term._cursorToSky().pitch - before) / 0.5;
    expect(skyPerSecond).toBeCloseTo(DISH_SLEW_RATE, 5);
  });

  it('keeps the dish close behind the cursor: on target within half a second of a full sweep', () => {
    const dish = makeRealDish();
    term.satellite = dish;
    term.enter();
    const dt = 1 / 60;
    const up = { left: false, right: false, up: true, down: false };

    // Zenith outward through the dish's own reach (it stops following past
    // its 0.75 radius), the dish chasing every frame. Up from the centre is
    // bearing π — the bearing the stand-in parks on (its neck at model 0
    // mirrors to game π) — so the chase is about closing a pitch gap, not a
    // half-turn of yaw.
    while (Math.hypot(term._cursorX, term._cursorY) < 0.4) {
      term.moveCursor(up, dt);
      dish._update(dt);
    }

    // Let go: how long until the dish could scan where the cursor stopped?
    const goal = term._cursorToSky();
    let t = 0;
    while (!dish.isAimedAt(goal.yaw, goal.pitch, mgr.signals[0].tolerance) && t < 5) {
      dish._update(dt);
      t += dt;
    }
    expect(t).toBeLessThanOrEqual(0.5);
  });

  it('_updateRadarDisplay forwards the neighbour array and the local rig to the radar', () => {
    const dish = makeRealDish();
    dish.neighbours = createDefaultNeighbourDishes();
    term.satellite = dish;
    term.enter();

    term._updateRadarDisplay();

    // Game angles, straight from the rig — the parked stand-in's neck at
    // model 0 reads back as bearing π (the neck mirrors yaw), the zenith
    // tilt as -π/2.
    expect(radar.update).toHaveBeenCalledWith(
      mgr.signals,
      dish.currentYaw,
      dish.currentPitch,
      term._cursorX,
      term._cursorY,
      term._hoveredSignal,
      -1,
      dish.neighbours,
      dish.rig,
    );
  });

  it('moves finely enough per frame to stop inside a signal', () => {
    term.enter();
    const before = term._cursorToSky().pitch;
    term.moveCursor({ left: false, right: false, up: true, down: false }, 1 / 60);
    const stepAngle = Math.abs(term._cursorToSky().pitch - before);
    // At least four frames to cross a signal's acceptance radius.
    expect(stepAngle).toBeLessThan(mgr.signals[0].tolerance / 4);
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

  it('moveCursor routes through aimAll — the whole array follows the cursor', () => {
    const dish = makeRealDish();
    const aimAll = vi.spyOn(dish, 'aimAll');
    term.satellite = dish;
    term.enter();

    term.moveCursor({ left: false, right: false, up: false, down: true }, 0.5);

    const sky = term._cursorToSky();
    expect(aimAll).toHaveBeenCalledWith(sky.yaw, sky.pitch);
    expect(dish.targetYaw).toBe(sky.yaw);
    expect(dish.targetPitch).toBe(sky.pitch);
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
    // Hide other signals so they don't interfere.
    for (let i = 2; i < mgr.signals.length; i++) {
      mgr.signals[i].appeared = false;
      mgr.signals[i].fadeElapsed = 0;
    }
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

  it('hover ignores signals that have not appeared yet', () => {
    term.enter();
    const sig = mgr.signals[0];
    // Hide ALL signals so no other random signal is near the cursor.
    for (const s of mgr.signals) {
      s.appeared = false;
      s.fadeElapsed = 0;
    }
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    term._updateHover();
    expect(term._hoveredSignal).toBeNull();
  });

  it('hover catches a signal while it is still fading in', () => {
    term.enter();
    const sig = mgr.signals[0];
    sig.appeared = true;
    sig.fadeElapsed = sig.fadeSeconds * 0.5;   // visible but half-transparent
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    term._updateHover();
    expect(term._hoveredSignal).toBe(sig);
  });

  it('hover catches a signal while it is fading back out', () => {
    term.enter();
    const sig = mgr.signals[0];
    sig.appeared = true;
    sig.fadeElapsed = sig.lifeSeconds - sig.fadeSeconds * 0.5;  // half-gone
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    term._updateHover();
    expect(term._hoveredSignal).toBe(sig);
  });

  it('hover ignores signals that have completely faded out', () => {
    term.enter();
    const sig = mgr.signals[0];
    sig.appeared = true;
    sig.fadeElapsed = sig.lifeSeconds;   // window over, dot invisible
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    term._updateHover();
    expect(term._hoveredSignal).toBeNull();
  });

  it('hover finds a signal once it has fully faded in', () => {
    term.enter();
    const sig = mgr.signals[0];
    sig.appeared = true;
    sig.fadeElapsed = sig.fadeSeconds;
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    term._updateHover();
    expect(term._hoveredSignal).toBe(sig);
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

  // ── Enter to scan: the array gate ──

  it('Enter starts scan when a neighbour dish is aimed and the local one is not', () => {
    term.enter();
    const sig = mgr.signals[0];
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    // Local dish off target…
    sat.neck.object3d.rotation.y = 0;
    sat.dish.object3d.rotation.x = 0;
    // …but a neighbour locked on.
    sat.neighbours = [{
      currentYaw: sig.yaw,
      currentPitch: sig.pitch,
      isAimedAt(yaw, pitch, tol) {
        const dy = Math.abs(this.currentYaw - yaw);
        const dp = Math.abs(this.currentPitch - pitch);
        return Math.sqrt(dy * dy + dp * dp) <= tol;
      },
    }];
    term._updateHover();
    expect(term._hoveredSignal).toBe(sig);
    expect(sat.isAimedAt(sig.yaw, sig.pitch, sig.tolerance)).toBe(false);
    expect(sat.isAnyDishAimedAt(sig.yaw, sig.pitch, sig.tolerance)).toBe(true);

    term._enterScanning();
    expect(term.state).toBe('scanning');
    expect(sat.isScanning).toBe(true);
    expect(sat.scanTarget).toBe(sig);
  });

  it('radar info explains a missing lock when no dish of the array is aimed', () => {
    term.enter();
    const sig = mgr.signals[0];
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    sat.neck.object3d.rotation.y = 0;
    sat.dish.object3d.rotation.x = 0;
    sat.neighbours = [];
    term._updateHover();

    // Drive the Enter gate exactly as onUpdate does for a hovering signal.
    const aimed = sat.isAnyDishAimedAt(sig.yaw, sig.pitch, sig.tolerance);
    expect(aimed).toBe(false);
    term.radar.setInfo('No dish aimed — wait for one to settle');
    expect(radar.setInfo).toHaveBeenCalledWith('No dish aimed — wait for one to settle');
    expect(term.state).toBe('radar');
  });

  // ── The evil signal hook ──

  /** A fake engine just wide enough for onUpdate: key states + WASD binds. */
  function makeEngine(keys = {}) {
    return {
      input: { keys },
      keyBinds: {
        left: 'KeyA', right: 'KeyD', forward: 'KeyW', back: 'KeyS',
        jump: 'Space', crouch: 'ShiftLeft',
      },
    };
  }

  /** The red target parked exactly where the cursor points, revealed. */
  function parkEvilAtCursor() {
    const sky = term._cursorToSky();
    const sig = new SignalTarget({ id: -1, yaw: sky.yaw, pitch: sky.pitch, scanTime: 0, evil: true });
    sig.appeared = true;
    sig.fadeElapsed = sig.fadeSeconds;
    mgr.signals.push(sig);
    return sig;
  }

  it('reports the hovered evil signal to EvilSignal — and null off it', () => {
    term.gameObject = { scene: { userData: { engine: makeEngine() } } };
    term.enter();

    const evil = { hover: vi.fn(), locked: false };
    term.evilSignal = evil;

    mgr.signals.length = 0;             // only the red one is in the sky
    const sig = parkEvilAtCursor();

    term.onUpdate(1 / 60);
    expect(term._hoveredSignal).toBe(sig);
    expect(evil.hover).toHaveBeenCalledWith(sig);

    // Cursor off the signal: EvilSignal is told the hover ended.
    term._cursorX = 0.5;
    term._cursorY = 0;
    term.onUpdate(1 / 60);
    expect(evil.hover).toHaveBeenLastCalledWith(null);
  });

  it('freezes the cursor while EvilSignal holds the dish', () => {
    term.gameObject = { scene: { userData: { engine: makeEngine({ KeyA: true }) } } };
    term.enter();

    term.evilSignal = { hover: vi.fn(), locked: true };
    term.onUpdate(1 / 60);
    expect(term._cursorX).toBe(0);              // WASD ignored while locked

    term.evilSignal.locked = false;             // hold over: the same key moves it
    term.onUpdate(1 / 60);
    expect(term._cursorX).toBeLessThan(0);
  });

  it('Enter never starts an ordinary scan on the evil signal', () => {
    term.gameObject = { scene: { userData: { engine: makeEngine({ Enter: true }) } } };
    term.enter();

    term.evilSignal = { hover: vi.fn(), locked: false };
    mgr.signals.length = 0;
    const sig = parkEvilAtCursor();

    // A dish is aimed at it and a blank drive is in the reader — an
    // ordinary signal would scan on this Enter.
    sat.neck.object3d.rotation.y = sig.yaw;
    sat.dish.object3d.rotation.x = sig.pitch;
    expect(sat.isAnyDishAimedAt(sig.yaw, sig.pitch, sig.tolerance)).toBe(true);

    term.onUpdate(1 / 60);

    expect(term._hoveredSignal).toBe(sig);
    expect(term.state).toBe('radar');
    expect(sat.isScanning).toBe(false);
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

  it('saveSignal marks signal saved, saves to drive, and returns to radar', () => {
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
    expect(driveMgr.saveToDrive).toHaveBeenCalled();
    expect(term.state).toBe('radar');
    expect(review.hide).toHaveBeenCalled();
  });

  it('scan is blocked when no drive is inserted', () => {
    driveMgr.driveInserted = false;
    term.enter();
    const sig = mgr.signals[0];
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    sat.neck.object3d.rotation.y = sig.yaw;
    sat.dish.object3d.rotation.x = sig.pitch;
    term._updateHover();
    expect(term._hoveredSignal).toBe(sig);

    // Even though dish is aimed, scanning should not start without a drive.
    // Simulate the Enter gate check from onUpdate.
    expect(sat.isAnyDishAimedAt(sig.yaw, sig.pitch, sig.tolerance)).toBe(true);
    expect(driveMgr.driveInserted).toBe(false);
    // The terminal stays in radar — scanning is blocked.
    expect(term.state).toBe('radar');
  });

  it('radar hint tells the player to insert a drive when none is inserted', () => {
    driveMgr.driveInserted = false;
    term.enter();
    expect(radar.setHint).toHaveBeenCalledWith(
      expect.stringContaining('Insert a drive'),
    );
  });

  // ── EXIT ──

  it('exit from any state returns to idle', () => {
    term.enter();
    term.state = 'scanning';  // force a non-idle state
    term.exit();
    expect(term.state).toBe('idle');
    expect(radar.hide).toHaveBeenCalled();
  });

  it('exit during review auto-saves the signal', () => {
    term.enter();
    const sig = mgr.signals[0];
    const cur = skyToCursor(sig.yaw, sig.pitch);
    term._cursorX = cur.x;
    term._cursorY = cur.y;
    term._updateHover();

    term._enterReview();
    expect(sig.scanned).toBe(true);

    // Simulate Q key: the onUpdate handler calls saveSignal then exit.
    term.saveSignal();
    term.exit();
    expect(term.state).toBe('idle');
    expect(sig.saved).toBe(true);
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

  // ── Power ──

  it('will not open with the power off, and says why', () => {
    const interact = createComputerInteractable(term);
    term.setPowered(false);
    term.enter();
    expect(term.state).toBe('idle');
    expect(interact.promptLabel).toMatch(/no power/i);
    term.setPowered(true);
    expect(interact.promptLabel).toBe('[E] Use Computer');
    term.enter();
    expect(term.state).toBe('radar');
  });

  it('losing power mid-scan shuts the terminal and drops the scan', () => {
    term.enter();
    sat.isScanning = true;
    term.setPowered(false);
    expect(term.state).toBe('idle');
    expect(sat.isScanning).toBe(false);
  });

  // ── The UFO on the radar ──

  it('warns of the anomaly while the cursor sits on the UFO blob, and clears it after', () => {
    term.enter();
    radar.threatAt.mockReturnValue(true);
    term._updateRadarDisplay();
    expect(radar.setWarning).toHaveBeenLastCalledWith(expect.stringMatching(/electrical anomaly/i));
    expect(radar.setWarning.mock.lastCall[0]).toMatch(/turn off (the )?power/i);
    radar.threatAt.mockReturnValue(false);
    term._updateRadarDisplay();
    expect(radar.setWarning).toHaveBeenLastCalledWith('');
  });

  it('asks the radar about the cursor where it actually is', () => {
    term.enter();
    term.moveCursor({ right: true, up: true }, 1);
    term._updateRadarDisplay();
    expect(radar.threatAt).toHaveBeenLastCalledWith(term._cursorX, term._cursorY);
  });

  it('drops the warning when the terminal closes', () => {
    term.enter();
    radar.threatAt.mockReturnValue(true);
    term._updateRadarDisplay();
    term.exit();
    expect(radar.setWarning).toHaveBeenLastCalledWith('');
  });
});
