import { describe, it, expect, vi } from 'vitest';

// Same stubbing as Engine.pause.test.js: no WebGL, no WASM.
vi.mock('@dimforge/rapier3d', () => ({
  default: { RigidBodyType: { Dynamic: 0, Fixed: 1, KinematicPositionBased: 2 } },
}));

const { Engine } = await import('./Engine.js');

// ─────────────────────────────────────────────
// loadScene compiles the scene it builds. Every rebuild after boot (Retry,
// Restart night, Main menu, F4) used to leave that to the frames: the
// visible things compiled behind the fade, but the hidden ones (the Sleep
// Demon, the dust eyes, the UFO) only on the frame each first showed.
// ─────────────────────────────────────────────

class FakeScene { constructor(engine) { this.engine = engine; } build() {} }

function makeEngine() {
  const engine = new Engine();
  const order = [];
  engine.renderer = {
    render: vi.fn(),
    compileAsync: vi.fn(async () => { order.push('compile'); }),
  };
  engine.scene = { name: 'scene' };
  engine.camera = { name: 'camera' };
  engine._teardownScene = vi.fn();
  engine.shadows = { release: vi.fn(), adopt: vi.fn() };
  engine._rootObjects.length = 0;
  engine.onSceneLoaded(() => order.push('loaded'));
  return { engine, order };
}

describe('Engine loadScene', () => {
  it('compiles the new scene in the background, after the listeners have applied the settings', () => {
    const { engine, order } = makeEngine();
    engine.loadScene(FakeScene);
    expect(engine.renderer.compileAsync).toHaveBeenCalledOnce();
    expect(engine.renderer.compileAsync).toHaveBeenCalledWith(engine.scene, engine.camera);
    expect(order).toEqual(['loaded', 'compile']);
    expect(engine.renderer.render).not.toHaveBeenCalled();
  });

  it('leaves the compile to warmUp when asked — the boot, behind the loading screen', () => {
    const { engine } = makeEngine();
    engine.loadScene(FakeScene, { compile: false });
    expect(engine.renderer.compileAsync).not.toHaveBeenCalled();
  });

  it('compileScene() compiles the active scene again, for whoever re-keys its materials', async () => {
    const { engine } = makeEngine();
    await engine.compileScene();
    expect(engine.renderer.compileAsync).toHaveBeenCalledWith(engine.scene, engine.camera);
  });

  it('compileScene() also compiles the red pass render-target variants, so a red death never freezes after a rebuild', async () => {
    const { engine, order } = makeEngine();
    engine.postProcess = { preCompile: vi.fn(async () => { order.push('red'); }) };
    await engine.compileScene();
    expect(engine.postProcess.preCompile).toHaveBeenCalledWith(engine.scene, engine.camera);
    expect(order.slice(-2)).toEqual(['compile', 'red']);
  });
});
