import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { DreamCraterScene, DREAM_CRATER } from './DreamCraterScene.js';
import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { DreamDustEyes, DREAM_EYES } from '../gameplay/DreamDustEyes.js';
import { makeEngine } from '../test/fakeRapier.js';

vi.setConfig({ testTimeout: 30_000 });

function makeDreamEngine() {
  const engine = makeEngine();
  engine.scene = new THREE.Scene();
  engine.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);
  engine.camera = new THREE.PerspectiveCamera(75);
  engine.camera.getWorldDirection = vi.fn((out) => out.set(0, 0, -1));
  engine.assets = { get: vi.fn(() => null) };
  engine.audioListener = null;
  engine.screenFade = { play: vi.fn((cb) => { cb?.(); return true; }) };
  engine.loadScene = vi.fn(() => { engine.activeScene = { nights: { setNight: vi.fn() } }; });
  engine.buildPlayer = vi.fn(({ position = [0, 1, 0] } = {}) => {
    const player = new GameObject('Player');
    player.object3d.position.set(...position);
    engine.player = player;
    engine.playerController = {
      speedScale: 1, inputLocked: false, yaw: 0, pitch: 0, gameObject: player,
      teleport: vi.fn(([x, y, z], { yaw = 0, pitch = 0 } = {}) => {
        player.object3d.position.set(x, y, z);
        engine.playerController.yaw = yaw;
        engine.playerController.pitch = pitch;
      }),
    };
    engine._rootObjects.push(player);
    return player;
  });
  return engine;
}

describe('DreamCraterScene', () => {
  let engine, scene;
  beforeEach(() => {
    engine = makeDreamEngine();
    scene = new DreamCraterScene(engine, { night: 2 });
    scene.build();
  });

  it('wakes back into the base scene', () => {
    expect(DreamCraterScene.returnTo).toBe(BaseScene);
  });

  it('takes the night it came from, defaulting to 1', () => {
    expect(scene.night).toBe(2);
    const plain = new DreamCraterScene(makeDreamEngine());
    expect(plain.night).toBe(1);
  });

  it('builds the crater: sky, terrain, rocks, lighting, dust — but no base', () => {
    expect(scene.sky).toBeTruthy();
    expect(scene.terrain).toBeTruthy();
    expect(scene.rocks).toBeTruthy();
    expect(scene.moonLight?.isDirectionalLight).toBe(true);
    expect(scene.dust).toBeTruthy();
    // No base structure.
    let foundBase = false;
    for (const go of engine._rootObjects) {
      if (go.object3d.name === 'DreamBase' || go.object3d.name === 'DreamCraterBase') foundBase = true;
    }
    expect(foundBase).toBe(false);
  });

  it('sets the fog to storm density and colour', () => {
    expect(engine.scene.fog.density).toBeCloseTo(0.065);
    expect(engine.scene.fog.color.getHex()).toBe(0x4c2818);
  });

  it('stands the player at the crater centre', () => {
    const p = engine.player.object3d.position;
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(0);
  });

  it('creates a dust-eye pool with at least 12 members', () => {
    expect(scene.dustEyes).toBeInstanceOf(DreamDustEyes);
    expect(scene.dustEyes.slots.length).toBeGreaterThanOrEqual(12);
  });

  it('starts in watching state with the timer at zero', () => {
    expect(scene._state).toBe('watching');
    expect(scene._elapsed).toBe(0);
  });

  it('surviving surviveSeconds triggers wake', () => {
    // Tick the timer past the survival threshold.
    scene._tickSurvival(DREAM_CRATER.surviveSeconds + 0.1);
    expect(scene._state).toBe('waking');
  });

  it('waking loads the base scene and returns to the night it came from', async () => {
    let loaded;
    engine.loadScene = vi.fn((SceneClass) => {
      loaded = SceneClass;
      engine.activeScene = { nights: { setNight: vi.fn() } };
    });
    scene.wake();
    await Promise.resolve();
    expect(loaded).toBe(BaseScene);
    expect(engine.activeScene.nights.setNight).toHaveBeenCalledWith(2);
  });

  it('waking does NOT set the death penalty flag', async () => {
    scene.wake();
    await Promise.resolve();
    expect(engine._dreamCraterDeath).toBeUndefined();
  });

  it('catch triggers the death flow and sets the stamina penalty flag', async () => {
    vi.useFakeTimers();
    scene._catch();
    expect(scene._state).toBe('caught');
    // Advance past the catch delay (redMs + 800 = ~3000 ms).
    vi.advanceTimersByTime(3500);
    await Promise.resolve();
    expect(engine._dreamCraterDeath).toBe(true);
    vi.useRealTimers();
  });

  it('hands the fog back on dispose', () => {
    scene.dispose();
    expect(engine.scene.fog.density).toBeCloseTo(0.02);
    expect(engine.scene.fog.color.getHex()).toBe(0x1a1a2e);
  });
});
