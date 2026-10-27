import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { makeEngine } from '../test/fakeRapier.js';

// A full base build is slow under jsdom — see BaseScene.test.js.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// ─────────────────────────────────────────────
// Leaving a game rebuilds the base (App.rebuild → engine.loadScene). Nothing
// frees GPU memory but an explicit dispose(), so anything the old base built
// and nobody owned stayed on the GPU for the rest of the session, once more
// per rebuild. Every geometry, material and texture in the scene graph must
// be freed with the scene, or be the very object the next build uses again
// (a shared, module-level resource).
// ─────────────────────────────────────────────

function makeSceneEngine() {
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
  return engine;
}

/** What Engine._teardownScene does between scenes, on the fake engine. */
function teardown(engine, scene) {
  scene.dispose();
  engine.world = new (engine.world.constructor)();
  for (const go of engine._rootObjects) {
    go.destroy();
    engine.scene.remove(go.object3d);
  }
  engine._rootObjects.length = 0;
  engine._bodyToGO.clear();
}

/** Every geometry, material and texture in the graph, with where it hangs. */
function resources(root) {
  const found = new Map();
  let at = '';
  const add = (r) => { if (r && !found.has(r)) found.set(r, at); };
  const texturesOf = (material) => {
    for (const value of Object.values(material)) if (value?.isTexture) add(value);
    for (const uniform of Object.values(material.uniforms ?? {})) {
      for (const value of [].concat(uniform?.value ?? [])) if (value?.isTexture) add(value);
    }
  };
  root.traverse((o) => {
    at = pathOf(o);
    add(o.geometry);
    for (const material of [].concat(o.material ?? [], o.customDepthMaterial ?? [], o.customDistanceMaterial ?? [])) {
      add(material);
      texturesOf(material);
    }
  });
  return found;
}

function pathOf(o) {
  const names = [];
  for (let p = o; p && p.parent; p = p.parent) names.push(p.name || p.type);
  return names.reverse().join('/');
}

describe('BaseScene teardown frees what it built', () => {
  it('leaves no geometry, material or texture of a torn-down base on the GPU', () => {
    const engine = makeSceneEngine();
    const first = new BaseScene(engine);
    first.build();

    const built = resources(engine.scene);
    const freed = new Set();
    for (const r of built.keys()) r.addEventListener('dispose', () => freed.add(r));

    teardown(engine, first);
    new BaseScene(engine).build();
    const reused = resources(engine.scene);

    const leaked = [...built]
      .filter(([r]) => !freed.has(r) && !reused.has(r))
      .map(([r, at]) => `${r.type ?? r.constructor.name} at ${at}`);
    expect(leaked).toEqual([]);
  });
});
