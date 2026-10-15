import { describe, it, expect, vi } from 'vitest';

// Same stubbing as Engine.pause.test.js: no WebGL, no WASM.
vi.mock('@dimforge/rapier3d', () => ({
  default: { RigidBodyType: { Dynamic: 0, Fixed: 1, KinematicPositionBased: 2 } },
}));

const { Engine } = await import('./Engine.js');

globalThis.requestAnimationFrame = vi.fn();

function makeEngine() {
  const engine = new Engine();
  engine.renderer = { render: vi.fn(), info: { render: {}, memory: {} } };
  engine.world = { step: vi.fn() };
  engine.scene = {};
  engine.camera = { name: 'player' };
  engine.shadows = { update: vi.fn(), invalidate: vi.fn() };
  engine.debugCamera = { active: false, update: vi.fn() };
  engine.physicsDebug = { update: vi.fn() };
  engine.levelEditor = { update: vi.fn(), enabled: false };
  return engine;
}

function frame(engine) {
  engine._loop(1000);
  engine._loop(1100);
}

// ─────────────────────────────────────────────
// Engine.viewCamera  –  the frame drawn through another camera (CCTV)
// ─────────────────────────────────────────────
describe('Engine view camera', () => {
  it('draws through the player’s camera by default', () => {
    const engine = makeEngine();
    expect(engine.renderCamera).toBe(engine.camera);
    frame(engine);
    expect(engine.renderer.render).toHaveBeenLastCalledWith(engine.scene, engine.camera);
  });

  it('draws through viewCamera while one is set', () => {
    const engine = makeEngine();
    const cctv = { name: 'cctv' };
    engine.viewCamera = cctv;
    expect(engine.renderCamera).toBe(cctv);
    frame(engine);
    expect(engine.renderer.render).toHaveBeenLastCalledWith(engine.scene, cctv);
  });

  it('the debug fly camera wins over a view camera', () => {
    const engine = makeEngine();
    engine.viewCamera = { name: 'cctv' };
    engine.debugCamera.active = true;
    expect(engine.renderCamera).toBe(engine.camera);
  });
});

// ─────────────────────────────────────────────
// Engine.screenPasses  –  drawn over the finished frame (the CCTV switch)
// ─────────────────────────────────────────────
describe('Engine screen passes', () => {
  it('render each pass after the frame, in order, after any post-process composite', () => {
    const engine = makeEngine();
    const order = [];
    engine.renderer.render = vi.fn(() => order.push('frame'));
    engine.postProcess = { preRender: vi.fn(), postRender: vi.fn(() => order.push('post')) };
    engine.screenPasses.push({ render: () => order.push('a') }, { render: () => order.push('b') });
    frame(engine);
    expect(order.slice(-4)).toEqual(['frame', 'post', 'a', 'b']);
  });

  it('starts empty and is emptied on every scene load (a pass belongs to its scene)', () => {
    const engine = makeEngine();
    expect(engine.screenPasses).toEqual([]);
    engine.screenPasses.push({ render: vi.fn() });
    engine.shadows.release = vi.fn();
    engine._teardownScene = vi.fn();
    class Empty { constructor() {} build() {} }
    try { engine.loadScene(Empty); } catch (_) { /* the rest of loading needs a real scene */ }
    expect(engine.screenPasses).toEqual([]);
  });
});
