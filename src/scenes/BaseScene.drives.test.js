import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { Drive } from '../gameobjects/Drive.js';
import { makeEngine } from '../test/fakeRapier.js';

// A full base build is slow under jsdom — see BaseScene.test.js.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// ─────────────────────────────────────────────
// The base draws its drives through a DriveInstancer (#175): the shelf's
// 32 drives were 64 draw calls.
// ─────────────────────────────────────────────

let scene, engine;
beforeAll(() => {
  engine = makeEngine();
  engine.scene = new THREE.Scene();
  engine.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);
  engine.assets = { get: () => null };
  engine.renderCullers = [];
  engine.beforeRender = [];
  engine.buildPlayer = ({ position = [0, 1, 5] } = {}) => {
    const player = new GameObject('Player');
    player.object3d.position.set(...position);
    engine.player = player;
    engine._rootObjects.push(player);
    return player;
  };
  scene = new BaseScene(engine);
  scene.build();
});

describe('BaseScene drives', () => {
  it('are drawn by one instancer, run by the engine before the main view', () => {
    expect(engine.beforeRender).toContain(scene.driveInstancer);
  });

  it('every drive in the base is an instance from the first frame, its own meshes hidden', () => {
    const drives = [...Drive.live].filter(d => {
      let o = d.object3d;
      while (o.parent) o = o.parent;
      return o === engine.scene;
    });
    expect(drives.length).toBeGreaterThanOrEqual(32);
    expect(scene.driveInstancer.body.count).toBe(drives.length);
    expect(drives.every(d => !d._mesh.visible && !d._led.visible)).toBe(true);
  });
});
