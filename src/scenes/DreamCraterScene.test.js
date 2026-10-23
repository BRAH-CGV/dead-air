// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { DreamCraterScene, DREAM_CRATER } from './DreamCraterScene.js';
import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { DreamDustEyes, DREAM_EYES } from '../gameplay/DreamDustEyes.js';
import { DreamFilter } from '../core/DreamFilter.js';
import { makeEngine } from '../test/fakeRapier.js';
import { DreamMusic } from '../components/DreamMusic.js';
import { Footsteps, STEP_SOUNDS, DREAM_FOOTSTEPS } from '../components/Footsteps.js';
import { AMBIENCE } from '../components/Ambience.js';

// Builds against the whole base scene module: as slow as BaseScene.test.js
// under a parallel run, so it gets the same budget.
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

  it('plays the spooky music under the dream, and the wind outside throughout, a little quieter than the base\'s', () => {
    const all = go => [go, ...(go.children ?? []).flatMap(all)];
    const loops = [];
    for (const go of engine._rootObjects) for (const g of all(go)) for (const c of g.components ?? []) if (c instanceof DreamMusic) loops.push(c);
    expect(loops.map(l => l.key).sort()).toEqual([AMBIENCE.music, AMBIENCE.outside].sort());
    const wind = loops.find(l => l.key === AMBIENCE.outside);
    expect(wind.volume).toBeLessThan(AMBIENCE.volumes[AMBIENCE.outside]);
    expect(wind.volume).toBeGreaterThan(0);
  });

  it('footsteps outside, the sand\'s crunch, never muffled (no suit in a dream)', () => {
    const feet = engine.player.getComponent(Footsteps);
    expect(feet).toBeTruthy();
    expect(feet.isOutside()).toBe(true);
    expect(feet.cutoff('exterior')).toBe(STEP_SOUNDS.thumpLowpass);
    expect(feet.cutoff('interior')).toBe(STEP_SOUNDS.lowpass);
    expect(feet.level).toBe(DREAM_FOOTSTEPS);              // quieter than at the base
    expect(DREAM_FOOTSTEPS).toBeLessThan(1);
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

  it('attaches a DreamFilter as the post-process on build, clears it on dispose', () => {
    expect(engine.postProcess).toBeInstanceOf(DreamFilter);
    expect(engine.postProcess.active).toBe(true);
    scene.dispose();
    expect(engine.postProcess).toBeNull();
  });

  describe('the shared wake (no long black screen)', () => {
    let fade;
    beforeEach(() => {
      fade = {
        cover: vi.fn((cb) => { cb?.(); return true; }),
        play: vi.fn(),
        caption: vi.fn(),
        uncover: vi.fn(),
      };
      engine.screenFade = fade;
      engine.compileScene = vi.fn(() => Promise.resolve());
    });

    it('surviving covers the screen (and holds it) instead of a timed fade, captioned with the night', async () => {
      scene.wake();
      expect(fade.cover).toHaveBeenCalledOnce();
      expect(fade.play).not.toHaveBeenCalled();
      expect(fade.caption).toHaveBeenCalledWith('NIGHT 2');
      await vi.waitFor(() => expect(fade.uncover).toHaveBeenCalledOnce());
      expect(engine.loadScene).toHaveBeenCalledWith(BaseScene, { compile: false });
    });

    it('caught: the red screen, then covered before the base is built, with the stamina penalty', async () => {
      vi.useFakeTimers();
      scene._catch();
      expect(fade.cover).not.toHaveBeenCalled();
      vi.advanceTimersByTime(3500);
      expect(fade.cover).toHaveBeenCalledOnce();
      vi.useRealTimers();
      await vi.waitFor(() => expect(engine.loadScene).toHaveBeenCalled());
      expect(engine._dreamCraterDeath).toBe(true);
    });
  });

  it('opens the eyes the bunk may have shut', () => {
    document.body.innerHTML = '<div id="fatigue"><div id="fatigue-tunnel"></div><div id="fatigue-lids"></div></div>';
    const lids = document.getElementById('fatigue-lids');
    lids.style.setProperty('--lid', '1');
    new DreamCraterScene(makeDreamEngine()).build();
    expect(lids.style.getPropertyValue('--lid')).toBe('0');
  });
});
