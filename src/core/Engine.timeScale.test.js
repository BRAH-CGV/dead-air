import { describe, it, expect, vi, beforeEach } from 'vitest';

// As in Engine.pause.test.js: the loop only touches Rapier through
// world.step() and the body-type enum, so a stub module is enough.
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
  engine.camera = {};
  engine.shadows = { update: vi.fn(), invalidate: vi.fn() };
  engine.physicsDebug = { update: vi.fn() };
  engine.levelEditor = { update: vi.fn(), enabled: false };
  const root = { _fixedUpdate: vi.fn(), _update: vi.fn(), _lateUpdate: vi.fn() };
  engine._rootObjects.push(root);
  return { engine, root };
}

/** Two frames 50 ms apart (the first only primes the clock). */
function tick(engine, start = 1000) {
  engine._loop(start);
  engine._loop(start + 50);
}

describe('Engine time scale (a nap fast-forwards the night)', () => {
  let engine, root;
  beforeEach(() => ({ engine, root } = makeEngine()));

  it('runs at real time by default', () => {
    expect(engine.timeScale).toBe(1);
    tick(engine);
    expect(root._update.mock.calls[0][0]).toBeCloseTo(0.05);
  });

  it('hands the updates scaled time, so everything the night runs on goes faster', () => {
    engine.timeScale = 15;
    tick(engine);
    expect(root._update.mock.calls[0][0]).toBeCloseTo(0.75);
    expect(root._lateUpdate.mock.calls[0][0]).toBeCloseTo(0.75);
  });

  it('keeps physics at real time — fifteen times the steps would only cost frames', () => {
    tick(engine);
    const steps = engine.world.step.mock.calls.length;
    const { engine: fast } = makeEngine();
    fast.timeScale = 15;
    tick(fast);
    expect(fast.world.step.mock.calls.length).toBe(steps);
  });
});
