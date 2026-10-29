import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene, CHUNK_TRIANGLES } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { groundChunk, forEachInstanceSphere } from '../systems/Sightlines.js';
import { makeEngine } from '../test/fakeRapier.js';

// A full base build is slow under jsdom — see BaseScene.test.js.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// ─────────────────────────────────────────────
// The vegetation is a ring round the base. One InstancedMesh of it has one
// bounding sphere round the whole basin, which every view intersects, so
// all of it was drawn wherever the player looked. The occlusion sort cuts
// the heavy ones into wedges of ground (groundChunk) so three culls the
// wedges behind the camera (#175). The same instances, in the same places.
// ─────────────────────────────────────────────

let scene;
beforeAll(() => {
  const engine = makeEngine();
  engine.scene = new THREE.Scene();
  engine.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);
  engine.assets = { get: () => null };
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

const grassMeshes = () => {
  const out = [];
  scene._outside.object3d.traverse(o => { if (o.isInstancedMesh && o.name.startsWith('MarsGrass')) out.push(o); });
  return out;
};
const triangles = (mesh) => (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3;

describe('the heavy vegetation, cut into ground chunks (#175)', () => {
  it('the grass is heavy enough to be cut', () => {
    const blades = grassMeshes().reduce((sum, mesh) => sum + mesh.count, 0);
    expect(blades * triangles(grassMeshes()[0])).toBeGreaterThan(CHUNK_TRIANGLES);
  });

  it('every piece of the grass lies in one wedge of ground', () => {
    const spread = grassMeshes().filter((mesh) => {
      const chunks = new Set();
      forEachInstanceSphere(mesh, sphere => chunks.add(groundChunk(sphere.center)));
      return chunks.size > 1;
    });
    expect(spread.map(mesh => mesh.name)).toEqual([]);
  });

  it('each piece sways with its own blades\' phases', () => {
    for (const mesh of grassMeshes()) expect(mesh.geometry.attributes.aPhase.count).toBe(mesh.count);
  });
});
