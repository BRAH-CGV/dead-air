import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { DreamScene } from './DreamScene.js';
import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { DreamWalk } from '../components/DreamWalk.js';
import { makeEngine } from '../test/fakeRapier.js';

vi.setConfig({ testTimeout: 30_000 });

function makeDreamEngine() {
  const engine = makeEngine();
  engine.scene = new THREE.Scene();
  engine.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);
  engine.camera = new THREE.PerspectiveCamera(75);
  engine.assets = { get: vi.fn(() => null) };
  engine.buildPlayer = vi.fn(({ position = [0, 1, 5] } = {}) => {
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

describe('DreamScene (#101)', () => {
  let engine, scene;
  beforeEach(() => {
    engine = makeDreamEngine();
    scene = new DreamScene(engine, { level: 2, night: 2 });
    scene.build();
  });

  it('wakes back into the base scene', () => {
    expect(DreamScene.returnTo).toBe(BaseScene);
  });

  it('takes its level and the night it came from, defaulting to 1', () => {
    expect(scene.level).toBe(2);
    expect(scene.night).toBe(2);
    const plain = new DreamScene(makeDreamEngine());
    expect(plain.level).toBe(1);
    expect(plain.night).toBe(1);
  });

  it('builds the valley: a sky that follows the camera, the terrain, and a moon light', () => {
    expect(scene.sky).toBeTruthy();
    expect(scene.terrain).toBeTruthy();
    expect(scene.moonLight?.isDirectionalLight).toBe(true);
  });

  it('builds the base as a dark block with a lit window, and a collider', () => {
    const base = scene.base;
    expect(base.collider).toBeTruthy();
    const glows = [];
    base.object3d.traverse(o => { if (o.isMesh && o.material.emissive?.getHex()) glows.push(o); });
    expect(glows.length).toBe(1);
  });

  it('stands the player outside the base, facing away from it', () => {
    const p = engine.player.object3d.position;
    expect(Math.hypot(p.x, p.z)).toBeGreaterThan(5);
    const yaw = engine.playerController.yaw;
    const forward = new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw));
    const away = new THREE.Vector2(p.x, p.z).normalize();
    expect(forward.dot(away)).toBeGreaterThan(0.95);
  });

  it('runs a DreamWalk at its level, round the base, on the scene fog and sky', () => {
    const walk = scene.walk;
    expect(walk).toBeInstanceOf(DreamWalk);
    expect(walk.level).toBe(2);
    expect(walk.fog).toBe(engine.scene.fog);
    expect(walk.sky).toBe(scene.sky);
    expect(walk.controller).toBe(engine.playerController);
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

  it('hands the fog back on dispose', () => {
    scene.dispose();
    expect(engine.scene.fog.density).toBeCloseTo(0.02);
    expect(engine.scene.fog.color.getHex()).toBe(0x1a1a2e);
  });
});
