import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BuggySendOff } from './BuggySendOff.js';
import { BuggyDeparture, BUGGY_DEPARTURE } from './BuggyDeparture.js';

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
      moonLight: null,
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
      moonLight: null,
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
      moonLight: null,
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
