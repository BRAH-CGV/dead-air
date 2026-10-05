import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { makeEngine } from '../test/fakeRapier.js';
import { COMM_TOWERS } from '../gameobjects/CommTowers.js';

// A full base build is slow under jsdom — see BaseScene.test.js.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// ─────────────────────────────────────────────
// The mast beacons, in the base as built. The occlusion sort splits
// instanced scenery by who can see each instance, replacing the mesh with
// copies. The beacons' flash writes a colour per instance every frame, into
// the mesh it was handed — so once that mesh had been swapped for copies,
// the lamps on screen kept the red they were copied with.
// ─────────────────────────────────────────────

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

describe('BaseScene mast beacons', () => {
  let towers, flash;

  beforeAll(() => {
    const engine = makeSceneEngine();
    new BaseScene(engine).build();
    towers = engine._rootObjects.find(go => go.name === 'SceneRoot').find('CommTowers');
    flash = towers.components.find(c => c.lamps);
  });

  /** Every lamp mesh actually in the scene, however the sort left them. */
  const drawnLamps = () => {
    const meshes = [];
    towers.object3d.traverse((o) => {
      if (o.isInstancedMesh && o.material.isMeshBasicMaterial) meshes.push(o);
    });
    return meshes;
  };

  /** Brightest channel of any drawn lamp instance. */
  const brightest = () => {
    const c = new THREE.Color();
    let max = 0;
    for (const mesh of drawnLamps()) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getColorAt(i, c);
        max = Math.max(max, c.r, c.g, c.b);
      }
    }
    return max;
  };

  /** A moment when no mast is mid-flash. */
  const darkMoment = () => {
    const { period, duty } = COMM_TOWERS.beacon;
    for (let t = 0; t < period; t += period / 400) {
      if (towers.sites.every(site => (t / period + site.phase) % 1 >= duty)) return t;
    }
    throw new Error('the masts are never all dark at once');
  };

  it('flashes the lamps that are drawn, not a mesh the occlusion sort replaced', () => {
    expect(drawnLamps()).toEqual([flash.lamps]);
    let count = 0;
    for (const mesh of drawnLamps()) count += mesh.count;
    expect(count).toBe(towers.sites.length);
  });

  it('is dark between flashes', () => {
    flash.time = darkMoment();
    flash.onUpdate(0);
    expect(brightest()).toBe(0);
  });

  it('is red at the top of a flash', () => {
    const { period, duty } = COMM_TOWERS.beacon;
    // Mid-flash for the first mast.
    flash.time = ((duty / 2 - towers.sites[0].phase) % 1 + 1) % 1 * period;
    flash.onUpdate(0);
    expect(brightest()).toBeGreaterThan(0.5);
  });
});
