import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { makeEngine } from '../test/fakeRapier.js';
import { WindDustMotion, WIND_DUST } from '../gameobjects/WindDust.js';

// A full base build is slow under jsdom — see BaseScene.test.js.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

function makeSceneEngine() {
  const engine = makeEngine();
  engine.scene = new THREE.Scene();
  engine.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);
  engine.assets = { get: vi.fn(() => null) };
  engine.buildPlayer = vi.fn(({ position = [0, 1, 5] } = {}) => {
    const player = new GameObject('Player');
    player.object3d.position.set(...position);
    engine.player = player;
    engine._rootObjects.push(player);
    return player;
  });
  return engine;
}

describe('BaseScene wind dust', () => {
  let scene;

  beforeAll(() => {
    scene = new BaseScene(makeSceneEngine());
    scene.build();
  });

  it('blows dust through the scene', () => {
    expect(scene.windDust).toBeDefined();
    expect(scene.windDust.getComponent(WindDustMotion)).not.toBeNull();
  });

  it('keeps the dust out of every room, corridor and the airlock', () => {
    const parts = [...Object.values(scene.rooms), ...Object.values(scene.corridors)];
    const { uBoxMin, uBoxMax } = scene.windDust.dustUniforms;
    expect(uBoxMin.value).toHaveLength(parts.length);
    for (const part of parts) {
      const b = part.bounds();
      // Each shell, whole: the shader keeps the dust out of it.
      const i = uBoxMin.value.findIndex(min => min.distanceTo(b.min) < 1e-6);
      expect(i, part.name).not.toBe(-1);
      expect(uBoxMax.value[i].distanceTo(b.max), part.name).toBeLessThan(1e-6);
    }
    expect(scene.windDust.dustUniforms.uClearance.value).toBe(WIND_DUST.clearance);
  });

  it('hangs on the scene root', () => {
    expect(scene.windDust.parent).toBe(scene._sceneRoot);
  });

  it('is the sandstorm\'s clouds: one storm level drives the fog, the grit and them', () => {
    const motion = scene.windDust.getComponent(WindDustMotion);
    expect(scene.sandstorm.clouds).toBe(motion);
    // No second cloud system beside it, and no key of its own (K summons
    // the whole storm, in Engine).
    expect(scene.dustClouds).toBeUndefined();
    expect(motion.testKey).toBeUndefined();
  });

  it('is lit by the dawn, not by the fog a storm turns brown', () => {
    expect(scene.windDust.getComponent(WindDustMotion).daylight).toBe(scene.daylight);
  });

  it('frees the cloud texture with the scene', () => {
    expect(scene._owned).toContain(scene.windDust.dustTexture);
  });

  it('is drawn from indoors too, so it blows past the office window', () => {
    // Things under Outside are sorted into occlusion zones by where they
    // stand. The dust follows the camera, so it stays out of that sort and
    // is cut out of the building in its shader instead.
    const dust = scene.windDust.object3d;
    let node = dust, underOutside = false;
    while (node) { if (node.name === 'Outside') underOutside = true; node = node.parent; }
    expect(underOutside).toBe(false);

    scene.zones.hide('yard');
    expect(dust.visible).toBe(true);
    let hidden = false;
    dust.traverse((o) => { if (!o.visible) hidden = true; });
    expect(hidden).toBe(false);
    scene.zones.show('yard');
  });
});
