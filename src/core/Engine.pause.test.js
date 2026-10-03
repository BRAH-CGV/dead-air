import { describe, it, expect, vi, beforeEach } from 'vitest';

// The real Rapier WASM build doesn't load under vitest (BUG-003). The loop
// only touches Rapier through `world.step()` and the body-type enum, and
// init() is never called here, so a stub module is enough.
vi.mock('@dimforge/rapier3d', () => ({
  default: { RigidBodyType: { Dynamic: 0, Fixed: 1, KinematicPositionBased: 2 } },
}));

const { Engine } = await import('./Engine.js');

/** A root object that records every lifecycle call the loop makes. */
function makeRoot() {
  return { _fixedUpdate: vi.fn(), _update: vi.fn(), _lateUpdate: vi.fn() };
}

/** An Engine with the loop's collaborators stubbed — no WebGL, no WASM. */
function makeEngine() {
  const engine = new Engine();
  engine.renderer = { render: vi.fn(), info: { render: {}, memory: {} } };
  engine.world = { step: vi.fn() };
  engine.scene = {};
  engine.camera = {};
  engine.shadows = { update: vi.fn(), invalidate: vi.fn() };
  engine.debugCamera = { active: true, update: vi.fn() };
  engine.physicsDebug = { update: vi.fn() };
  engine.levelEditor = { update: vi.fn(), enabled: false };
  const root = makeRoot();
  engine._rootObjects.push(root);
  return { engine, root };
}

// The loop schedules itself; keep that from piling up real frames.
globalThis.requestAnimationFrame = vi.fn();

/** Run two frames 100 ms apart (the first frame only primes the clock). */
function tick(engine, start = 1000) {
  engine._loop(start);
  engine._loop(start + 100);
}

describe('Engine pause', () => {
  let engine, root;
  beforeEach(() => ({ engine, root } = makeEngine()));

  it('starts unpaused, and updates everything on a frame', () => {
    expect(engine.paused).toBe(false);
    tick(engine);
    expect(root._fixedUpdate).toHaveBeenCalled();
    expect(engine.world.step).toHaveBeenCalled();
    expect(root._update).toHaveBeenCalled();
    expect(root._lateUpdate).toHaveBeenCalled();
    expect(engine.renderer.render).toHaveBeenCalled();
  });

  it('while paused, nothing steps or updates — but the frame still renders', () => {
    engine.setPaused(true);
    tick(engine);
    expect(root._fixedUpdate).not.toHaveBeenCalled();
    expect(engine.world.step).not.toHaveBeenCalled();
    expect(root._update).not.toHaveBeenCalled();
    expect(root._lateUpdate).not.toHaveBeenCalled();
    expect(engine.debugCamera.update).not.toHaveBeenCalled();
    expect(engine.renderer.render).toHaveBeenCalledOnce();   // frame one only primes the clock
    expect(engine.levelEditor.update).toHaveBeenCalled();
  });

  it('keeps the clock moving while paused, so resuming is no time spike', () => {
    engine.setPaused(true);
    engine._loop(1000);
    engine._loop(60_000);           // a minute in the menu
    engine.setPaused(false);
    const update = root._update;
    engine._loop(60_016);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toBeCloseTo(0.016, 3);
  });

  it('setPaused clears held keys, presses, mouse deltas and the accumulator', () => {
    engine.input.keys.KeyW = true;
    engine.input.pressed.KeyE = true;
    engine.input.mouse.dx = 5;
    engine.input.mouse.dy = -3;
    engine._accumulator = 0.01;
    engine.setPaused(true);
    expect(engine.input.keys).toEqual({});
    expect(engine.input.pressed).toEqual({});
    expect(engine.input.mouse).toEqual({ dx: 0, dy: 0 });
    expect(engine._accumulator).toBe(0);
  });

  it('clears input again on resume (a keyup missed while blurred cannot stick)', () => {
    engine.setPaused(true);
    engine.input.keys.KeyW = true;
    engine.setPaused(false);
    expect(engine.input.keys.KeyW).toBeUndefined();
  });

  it('keeps the same input objects (components hold references to them)', () => {
    const { keys, mouse } = engine.input;
    engine.setPaused(true);
    expect(engine.input.keys).toBe(keys);
    expect(engine.input.mouse).toBe(mouse);
  });

  it('clears one-frame input at the end of a paused frame too', () => {
    engine.setPaused(true);
    engine._loop(1000);
    engine.input.pressed.KeyE = true;
    engine.input.mouse.dx = 4;
    engine._loop(1100);
    expect(engine.input.pressed).toEqual({});
    expect(engine.input.mouse.dx).toBe(0);
  });
});

describe('Engine onSceneLoaded', () => {
  it('calls listeners after loadScene, and unsubscribes', () => {
    const { engine } = makeEngine();
    engine._teardownScene = vi.fn();
    engine.shadows = { release: vi.fn(), adopt: vi.fn() };
    class FakeScene { constructor(e) { this.engine = e; } build() {} }

    const listener = vi.fn();
    const off = engine.onSceneLoaded(listener);
    engine._rootObjects.length = 0;
    engine.loadScene(FakeScene);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0]).toBeInstanceOf(FakeScene);

    off();
    engine.loadScene(FakeScene);
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe('Engine devTools gate', () => {
  it('defaults on, so code without an app layer keeps its debug keys', () => {
    expect(new Engine().devTools).toBe(true);
  });

  it('debugKeysActive is false when dev tools are off or the game is paused', () => {
    const engine = new Engine();
    expect(engine.debugKeysActive).toBe(true);
    engine.devTools = false;
    expect(engine.debugKeysActive).toBe(false);
    engine.devTools = true;
    engine.setPaused(true);
    expect(engine.debugKeysActive).toBe(false);
  });
});
