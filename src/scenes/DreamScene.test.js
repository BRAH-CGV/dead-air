// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { DreamScene } from './DreamScene.js';
import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { DreamWalk } from '../components/DreamWalk.js';
import { DreamFilter } from '../core/DreamFilter.js';
import { makeEngine } from '../test/fakeRapier.js';

// Imports and builds against the whole base scene module: as slow as
// BaseScene.test.js under a parallel run, so it gets the same budget.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

function makeDreamEngine() {
  const engine = makeEngine();
  engine.renderer = {
    setRenderTarget: vi.fn(),
    render: vi.fn(),
  };
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
    await scene.wake();
    expect(loaded).toBe(BaseScene);
    expect(engine.activeScene.nights.setNight).toHaveBeenCalledWith(2);
  });

  describe('waking holds the black until the base is ready (playtest: a long black screen)', () => {
    let fade, compiled;
    beforeEach(() => {
      fade = { caption: vi.fn(), uncover: vi.fn() };
      engine.screenFade = fade;
      engine.loadScene = vi.fn(() => { engine.activeScene = { nights: { setNight: vi.fn() } }; });
      let finish;
      compiled = new Promise((r) => { finish = r; });
      compiled.finish = finish;
      engine.compileScene = vi.fn(() => compiled);
    });

    it('says which night it is waking into, on the black', async () => {
      const waking = scene.wake();
      expect(fade.caption).toHaveBeenCalledWith('NIGHT 2');
      compiled.finish();
      await waking;
    });

    it('builds the base without the background compile, then waits for the compile', async () => {
      const waking = scene.wake();
      await Promise.resolve();
      await Promise.resolve();
      expect(engine.loadScene).toHaveBeenCalledWith(BaseScene, { compile: false });
      expect(engine.compileScene).toHaveBeenCalled();
      expect(fade.uncover).not.toHaveBeenCalled();
      compiled.finish();
      await waking;
      expect(fade.uncover).toHaveBeenCalledOnce();
    });

    it('a failed compile still uncovers — never stuck on black', async () => {
      engine.compileScene = vi.fn(() => Promise.reject(new Error('lost context')));
      await scene.wake();
      expect(fade.uncover).toHaveBeenCalledOnce();
    });
  });

  it('opens the eyes: the bunk\'s eyelids can be left shut by the sleep that led here', () => {
    document.body.innerHTML = '<div id="fatigue"><div id="fatigue-tunnel"></div><div id="fatigue-lids"></div></div>';
    const lids = document.getElementById('fatigue-lids');
    lids.style.setProperty('--lid', '1');
    new DreamScene(makeDreamEngine()).build();
    expect(lids.style.getPropertyValue('--lid')).toBe('0');
  });

  describe('the light on the ridge (Ryan\'s idea: something to walk towards)', () => {
    it('stands far ahead of the player, straight down their view', () => {
      const p = engine.player.object3d.position;
      const b = scene.beacon.object3d.position;
      const yaw = engine.playerController.yaw;
      const forward = new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw));
      const to = new THREE.Vector2(b.x - p.x, b.z - p.z);
      expect(to.clone().normalize().dot(forward)).toBeGreaterThan(0.99);
      expect(to.length()).toBeGreaterThan(200);
    });

    it('is out of reach: far past where the base pulls you back, at every level', () => {
      const b = scene.beacon.object3d.position;
      expect(Math.hypot(b.x, b.z)).toBeGreaterThan(80 * 2);
    });

    it('glows through the dream fog', () => {
      const glows = [];
      scene.beacon.object3d.traverse(o => { if (o.isMesh && o.material.fog === false) glows.push(o); });
      expect(glows.length).toBeGreaterThan(0);
    });

    it('turns from warm to red as the dreams get worse', () => {
      const colour = (level) => {
        const s = new DreamScene(makeDreamEngine(), { level });
        s.build();
        return s.beaconColor.clone();
      };
      const warm = colour(1), red = colour(3);
      expect(red.r).toBeGreaterThan(red.g * 2);
      expect(warm.g).toBeGreaterThan(red.g);
    });
  });

  it('hands the fog back on dispose', () => {
    scene.dispose();
    expect(engine.scene.fog.density).toBeCloseTo(0.02);
    expect(engine.scene.fog.color.getHex()).toBe(0x1a1a2e);
  });

  it('attaches a DreamFilter as the post-process on build, clears it on dispose', () => {
    expect(engine.postProcess).toBeInstanceOf(DreamFilter);
    expect(engine.postProcess.active).toBe(true);
    scene.dispose();
    expect(engine.postProcess).toBeNull();
  });

  it('scatters rocks over the valley, so walking (and slowing) can be seen (playtest)', () => {
    expect(scene.rocks).toBeTruthy();
    let instances = 0;
    scene.rocks.object3d.traverse(o => { if (o.isInstancedMesh) instances += o.count; });
    expect(instances).toBeGreaterThan(50);
  });

  it('lights the valley floor enough to see (the first playtest was pitch black)', () => {
    expect(scene.moonLight.intensity).toBeGreaterThanOrEqual(1.2);
  });
});
