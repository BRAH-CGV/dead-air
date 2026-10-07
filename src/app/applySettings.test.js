import { describe, it, expect, vi } from 'vitest';
import { applySettings, BASE_SENSITIVITY, MIN_FAR } from './applySettings.js';

const binds = () => ({
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', crouch: 'KeyC', interact: 'KeyE', flashlight: 'KeyF',
});

const settings = (over = {}) => ({
  crouchMode: 'toggle', showFps: false, sensitivity: 1, invertY: false, smoothing: 0.2,
  keyBinds: binds(), fov: 75, brightness: 1, renderDistance: 1000,
  shadows: 'high', ...over,
});

/** A scene graph stand-in: traverse() visits meshes with materials. */
function makeScene(materials) {
  const meshes = materials.map(m => ({ material: m }));
  return { traverse: (fn) => meshes.forEach(fn) };
}

function makeEngine() {
  const shared = { needsUpdate: false };
  const other = { needsUpdate: false };
  const shadowMap = { dispose: vi.fn() };
  return {
    camera: { fov: 75, far: 1000, updateProjectionMatrix: vi.fn() },
    renderer: { toneMappingExposure: 1, shadowMap: { enabled: true }, setPixelRatio: vi.fn() },
    scene: makeScene([shared, shared, [other, shared]]),
    playerController: { sensitivity: 0, invertY: false, cameraSmoothing: 0, crouchMode: 'toggle' },
    perfStats: { show: vi.fn(), hide: vi.fn() },
    keyBinds: { ...binds(), debugFly: 'KeyV' },
    activeScene: { moonLight: { shadow: { mapSize: { x: 2048, y: 2048, set(x, y) { this.x = x; this.y = y; } }, map: shadowMap } } },
    shadows: { invalidate: vi.fn() },
    levelEditor: { enabled: false, toggle: vi.fn() },
    devTools: true,
    _materials: { shared, other },
    _shadowMap: shadowMap,
  };
}

describe('applySettings', () => {
  it('multiplies the 0.002 base sensitivity', () => {
    const engine = makeEngine();
    applySettings(engine, settings({ sensitivity: 1.5 }), { devicePixelRatio: 1 });
    expect(BASE_SENSITIVITY).toBe(0.002);
    expect(engine.playerController.sensitivity).toBeCloseTo(0.003);
  });

  it('writes invert Y, smoothing and crouch mode onto the controller', () => {
    const engine = makeEngine();
    applySettings(engine, settings({ invertY: true, smoothing: 0.5, crouchMode: 'hold' }), { devicePixelRatio: 1 });
    expect(engine.playerController).toMatchObject({ invertY: true, cameraSmoothing: 0.5, crouchMode: 'hold' });
  });

  it('sets FOV and far, and updates the projection matrix', () => {
    const engine = makeEngine();
    applySettings(engine, settings({ fov: 90, renderDistance: 600 }), { devicePixelRatio: 1 });
    expect(engine.camera.fov).toBe(90);
    expect(engine.camera.far).toBe(600);
    expect(engine.camera.updateProjectionMatrix).toHaveBeenCalled();
  });

  it('never puts the far plane inside the sky dome', () => {
    const engine = makeEngine();
    applySettings(engine, settings({ renderDistance: 100 }), { devicePixelRatio: 1 });
    expect(MIN_FAR).toBe(450);
    expect(engine.camera.far).toBe(450);
  });

  it('leaves the pixel ratio alone (render scale was removed)', () => {
    const engine = makeEngine();
    applySettings(engine, settings(), { devicePixelRatio: 1 });
    expect(engine.renderer.setPixelRatio).not.toHaveBeenCalled();
  });

  it('brightness sets the tone-mapping exposure', () => {
    const engine = makeEngine();
    applySettings(engine, settings({ brightness: 1.4 }), { devicePixelRatio: 1 });
    expect(engine.renderer.toneMappingExposure).toBe(1.4);
  });

  it('shadows off disables the map and flags each material for a recompile once', () => {
    const engine = makeEngine();
    const { shared, other } = engine._materials;
    let sharedFlags = 0;
    Object.defineProperty(shared, 'needsUpdate', { set: () => { sharedFlags++; }, get: () => false });
    applySettings(engine, settings({ shadows: 'off' }), { devicePixelRatio: 1 });
    expect(engine.renderer.shadowMap.enabled).toBe(false);
    expect(sharedFlags).toBe(1);
    expect(other.needsUpdate).toBe(true);
  });

  it('does not touch materials when the shadow map stays on', () => {
    const engine = makeEngine();
    applySettings(engine, settings({ shadows: 'high' }), { devicePixelRatio: 1 });
    expect(engine._materials.other.needsUpdate).toBe(false);
  });

  it('shadows low disposes the old map and sets 1024', () => {
    const engine = makeEngine();
    applySettings(engine, settings({ shadows: 'low' }), { devicePixelRatio: 1 });
    const { shadow } = engine.activeScene.moonLight;
    expect(engine._shadowMap.dispose).toHaveBeenCalled();
    expect(shadow.map).toBe(null);
    expect(shadow.mapSize.x).toBe(1024);
    expect(engine.shadows.invalidate).toHaveBeenCalled();
  });

  it('leaves the shadow map alone when its size is already right', () => {
    const engine = makeEngine();
    applySettings(engine, settings({ shadows: 'high' }), { devicePixelRatio: 1 });
    expect(engine._shadowMap.dispose).not.toHaveBeenCalled();
  });

  it('writes key binds into the same object', () => {
    const engine = makeEngine();
    const before = engine.keyBinds;
    applySettings(engine, settings({ keyBinds: { ...binds(), jump: 'KeyJ' } }), { devicePixelRatio: 1 });
    expect(engine.keyBinds).toBe(before);
    expect(engine.keyBinds.jump).toBe('KeyJ');
    expect(engine.keyBinds.debugFly).toBe('KeyV');
  });

  it('hands the dust storm quality to the scene', () => {
    const engine = makeEngine();
    engine.activeScene.setStormQuality = vi.fn();
    applySettings(engine, settings({ stormQuality: 0.4 }), { devicePixelRatio: 1 });
    expect(engine.activeScene.setStormQuality).toHaveBeenLastCalledWith(0.4);
    // Every scene build starts at full, so it is handed over again each time.
    applySettings(engine, settings({ stormQuality: 0.4 }), { devicePixelRatio: 1 });
    expect(engine.activeScene.setStormQuality).toHaveBeenCalledTimes(2);
  });

  it('skips the storm quality on a scene with no storm', () => {
    const engine = makeEngine();
    expect(engine.activeScene.setStormQuality).toBeUndefined();
    expect(() => applySettings(engine, settings({ stormQuality: 0.4 }), { devicePixelRatio: 1 })).not.toThrow();
  });

  it('shows or hides the FPS readout', () => {
    const engine = makeEngine();
    applySettings(engine, settings({ showFps: true }), { devicePixelRatio: 1 });
    expect(engine.perfStats.show).toHaveBeenCalled();
    applySettings(engine, settings({ showFps: false }), { devicePixelRatio: 1 });
    expect(engine.perfStats.hide).toHaveBeenCalled();
  });

  it('does not touch the dev-tools flag (it follows the build)', () => {
    const engine = makeEngine();
    applySettings(engine, settings(), { devicePixelRatio: 1 });
    expect(engine.devTools).toBe(true);
  });

  it('is idempotent', () => {
    const engine = makeEngine();
    const s = settings({ fov: 80, shadows: 'low', sensitivity: 2 });
    applySettings(engine, s, { devicePixelRatio: 1 });
    const snapshot = JSON.stringify({ c: engine.camera, p: engine.playerController, k: engine.keyBinds, size: engine.activeScene.moonLight.shadow.mapSize });
    applySettings(engine, s, { devicePixelRatio: 1 });
    expect(JSON.stringify({ c: engine.camera, p: engine.playerController, k: engine.keyBinds, size: engine.activeScene.moonLight.shadow.mapSize })).toBe(snapshot);
    expect(engine._shadowMap.dispose).toHaveBeenCalledOnce();
  });

  it('does not throw with no player, scene, moon light or perf stats', () => {
    const engine = makeEngine();
    engine.playerController = null;
    engine.activeScene = null;
    engine.perfStats = null;
    engine.levelEditor = null;
    expect(() => applySettings(engine, settings({ shadows: 'off' }), { devicePixelRatio: 1 })).not.toThrow();
    expect(() => applySettings({}, settings(), { devicePixelRatio: 1 })).not.toThrow();
  });
});
