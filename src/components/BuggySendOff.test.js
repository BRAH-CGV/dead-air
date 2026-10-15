import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuggySendOff } from './BuggySendOff.js';
import { BuggyDeparture, BUGGY_DEPARTURE } from '../gameplay/BuggyDeparture.js';

// ─────────────────────────────────────────────
// BuggySendOff — the cutscene that sends the buggy off (#98)
// ─────────────────────────────────────────────

/** Minimal stubs for the scene objects BuggySendOff depends on. */
function makeStubs() {
  const engine = {
    camera: new THREE.PerspectiveCamera(75, 1, 0.1, 1000),
    viewCamera: null,
    realDt: 0,
    input: { keys: {}, pressed: {} },
    keyBinds: { interact: 'KeyE' },
    isAction: () => false,
    consumeAction: () => {},
    crosshair: { hide() {}, show() {} },
    shadows: { watch() {}, invalidate() {} },
    debugCamera: null,
    player: { getComponent: () => ({ enabled: true, inputLocked: false }) },
  };
  const buggy = {
    object3d: new THREE.Group(),
    rigidBody: null,
  };
  buggy.object3d.name = 'Buggy';
  buggy.object3d.position.set(-7.79, 1.237, 10.01);
  buggy.object3d.rotation.y = THREE.MathUtils.degToRad(95.7);
  const boot = {
    object3d: new THREE.Group(),
    rigidBody: null,
  };
  boot.object3d.name = 'BuggyBoot';
  buggy.object3d.add(boot.object3d);
  const lidPivot = new THREE.Group();
  lidPivot.name = 'BootLidPivot';
  boot.object3d.add(lidPivot);
  const socket = { syncAttached() {} };
  const gate = { setOpen() {} };
  const controller = { state: 'morning', dispatched: false, dispatch() { this.dispatched = true; } };
  const fade = { playing: false, play(onDark) { onDark?.(); return true; } };
  const player = { enabled: true };
  const interaction = { enabled: true, resetPrompt() {} };

  return { engine, buggy, boot, lidPivot, socket, gate, controller, fade, player, interaction };
}

describe('BuggySendOff — construction', () => {
  it('exposes active, driving, logic and curve', () => {
    const stubs = makeStubs();
    const off = new BuggySendOff({
      ...stubs,
      setPlayerLocked() {},
      isFrozen: () => false,
      curve: null,
      length: 50,
      gateAt: 20,
    });
    expect(off.active).toBe(false);
    expect(off.driving).toBe(false);
    expect(off.logic).toBeInstanceOf(BuggyDeparture);
    expect(off.curve).toBeNull();
  });
});

describe('BuggySendOff — start', () => {
  it('locks the player and sets the view camera', () => {
    const stubs = makeStubs();
    let locked = false;
    const off = new BuggySendOff({
      ...stubs,
      setPlayerLocked: (v) => { locked = v; },
      isFrozen: () => false,
      curve: null,
      length: 50,
      gateAt: 20,
    });
    off.start();
    expect(off.active).toBe(true);
    expect(locked).toBe(true);
    expect(stubs.engine.viewCamera).not.toBeNull();
  });
});

describe('BuggySendOff — night reset', () => {
  it('resetForNight restores the buggy state and shuts the lid and gate', () => {
    const stubs = makeStubs();
    let gateOpen = -1;
    const off = new BuggySendOff({
      ...stubs,
      setPlayerLocked() {},
      isFrozen: () => false,
      curve: null,
      length: 50,
      gateAt: 20,
      gate: { setOpen(t) { gateOpen = t; } },
    });
    off.start();
    off.resetForNight();
    expect(off.active).toBe(false);
    expect(off.logic.phase).toBe('idle');
    expect(gateOpen).toBe(0);
    expect(stubs.engine.viewCamera).toBeNull();
  });
});

describe('BuggySendOff — the tidy-up', () => {
  const make = (over = {}) => {
    const stubs = makeStubs();
    const off = new BuggySendOff({
      ...stubs,
      setPlayerLocked() {},
      isFrozen: () => false,
      curve: null,
      length: 50,
      gateAt: 20,
      ...over,
    });
    return { stubs, off };
  };

  it('the view turns out of the eyes: it starts looking where the player looked', () => {
    const { stubs, off } = make();
    stubs.engine.camera.position.set(-5, 1.6, 8);
    stubs.engine.camera.rotation.set(0, 1.2, 0);
    off.start();
    stubs.engine.realDt = 1 / 120;
    off.onUpdate(1 / 120);
    const view = stubs.engine.viewCamera;
    expect(view.quaternion.angleTo(stubs.engine.camera.quaternion)).toBeLessThan(0.01);
    expect(view.position.distanceTo(stubs.engine.camera.position)).toBeLessThan(0.05);
  });

  it('a fade already running is tried again next frame, and the buggy goes once', () => {
    let calls = 0;
    let busy = true;
    const fade = { play(onDark) { calls++; if (busy) return false; onDark(); return true; } };
    let dispatched = 0;
    const { stubs, off } = make({ fade, controller: { state: 'morning', dispatch() { dispatched++; } } });
    off.start();
    stubs.engine.realDt = 1;
    off.logic.skipped = true;
    off.onUpdate(1);
    expect(calls).toBe(1);
    expect(dispatched).toBe(0);
    busy = false;
    off.onUpdate(1);
    off.onUpdate(1);
    expect(calls).toBe(2);
    expect(dispatched).toBe(1);
    expect(off.logic.phase).toBe('gone');
  });

  it('once dark, the buggy is under the ground and the boot still rides on it', () => {
    const { stubs, off } = make();
    stubs.boot.object3d.position.set(0, 0.3, -2);
    off.start();
    off._onDark();
    expect(stubs.buggy.object3d.position.y).toBe(-50);
    expect(stubs.boot.object3d.position.toArray()).toEqual([0, 0.3, -2]);
    off.resetForNight();
    expect(stubs.buggy.object3d.position.y).toBeCloseTo(1.237);
  });

  it('with the fly camera out, the player is left to it', () => {
    const player = { enabled: true };
    const { off } = make({ player, isFrozen: () => true });
    off.start();
    off._onDark();
    expect(player.enabled).toBe(false);
  });

  it('the idle lid opens in the morning at the same pace at any frame rate', () => {
    const lidAt = (fps) => {
      const { stubs, off } = make();
      stubs.lidPivot.rotation.x = 0;
      stubs.engine.realDt = 1 / fps;
      for (let i = 0; i < fps / 2; i++) off.onUpdate(1 / fps);
      return stubs.lidPivot.rotation.x;
    };
    expect(lidAt(30)).toBeGreaterThan(0);
    expect(lidAt(30)).toBeCloseTo(lidAt(144), 6);
  });
});

describe('BuggySendOff — facing the way it drives', () => {
  // A route that leaves the way the buggy faces (95.7°, past 90°: three
  // reads that heading back out of a quaternion as x and z flipped by π)
  // and turns round to the north.
  const route = () => new THREE.CatmullRomCurve3([
    new THREE.Vector3(-7.79, 1.237, 10.01),
    new THREE.Vector3(0, 1.237, 9.2),
    new THREE.Vector3(7, 1.237, 12),
    new THREE.Vector3(8.2, 1.237, 20),
    new THREE.Vector3(14, 1.237, 32),
  ], false, 'centripetal');

  /** Drive the whole send-off, checking every frame that the buggy's nose
   *  (+z) points along the route, and the camera follows that heading. */
  function driveAndCheck(off, stubs, curve) {
    const nose = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    off.start();
    for (let i = 0; i < 2000 && off.active; i++) {
      stubs.engine.realDt = 1 / 30;
      off.onUpdate(1 / 30);
      if (!off.driving) continue;
      const t = Math.min(off.logic.distance / off.length, 1);
      curve.getTangentAt(t, tangent);
      tangent.y = 0;
      tangent.normalize();
      nose.set(0, 0, 1).transformDirection(stubs.buggy.object3d.matrixWorld);
      expect(nose.dot(tangent), `at ${off.logic.distance.toFixed(1)} m`).toBeGreaterThan(0.999);
      expect(stubs.buggy.object3d.up.y).toBe(1);
      expect(nose.y).toBeCloseTo(0, 6);
    }
    expect(off.active).toBe(false);
  }

  it('faces along the route the first time, and again after the night start puts it back', () => {
    const stubs = makeStubs();
    const curve = route();
    const off = new BuggySendOff({
      ...stubs,
      setPlayerLocked() {},
      isFrozen: () => false,
      curve,
      length: curve.getLength(),
      gateAt: 20,
    });
    driveAndCheck(off, stubs, curve);
    off.resetForNight();
    // Parked just as it was: the same heading, upright.
    const parked = new THREE.Vector3(0, 0, 1).applyQuaternion(stubs.buggy.object3d.quaternion);
    expect(Math.atan2(parked.x, parked.z)).toBeCloseTo(THREE.MathUtils.degToRad(95.7), 6);
    driveAndCheck(off, stubs, curve);
    off.resetForNight();
    driveAndCheck(off, stubs, curve);
  });
});
