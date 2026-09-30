import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { AssetManager } from './AssetManager.js';

/** A 1 × 2 × 1 m box, modelled in centimetres 3 m off to the side and sunk
 *  half a metre below its ground plane. */
function offCentreScene() {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(100, 200, 100));
  mesh.position.set(300, 50, -120);
  scene.add(mesh);
  return scene;
}

function managerFor(entry) {
  const assets = new AssetManager({ manifest: { 'model:thing': { type: 'model', url: 'assets/models/thing.glb', ...entry } } });
  assets.gltfLoader.loadAsync = vi.fn(async () => ({ scene: offCentreScene() }));
  return assets;
}

describe('AssetManager model loading', () => {
  it("applies the manifest's origin and scale before measuring, so colliders fit the moved model", async () => {
    const assets = managerFor({ scale: 0.01, origin: 'floor' });
    await assets.load('model:thing');

    const { bounds } = assets.getCollision('model:thing');
    bounds.size.forEach((v, i) => expect(v).toBeCloseTo([1, 2, 1][i]));
    bounds.center.forEach((v, i) => expect(v).toBeCloseTo([0, 1, 0][i]));   // standing on its origin
  });

  it('leaves the pivot alone for an entry without origin', async () => {
    const assets = managerFor({ scale: 0.01 });
    await assets.load('model:thing');
    expect(assets.getCollision('model:thing').bounds.center[0]).toBeCloseTo(3);
  });
});

describe('AssetManager audio loading', () => {
  function audioManager() {
    const assets = new AssetManager({ manifest: {
      'sfx:beep': { type: 'audio', url: 'assets/audio/beep.wav' },
    } });
    const buffer = { duration: 0.4, numberOfChannels: 1 };   // stands in for a decoded AudioBuffer
    assets.audioLoader.loadAsync = vi.fn(async () => buffer);
    return { assets, buffer };
  }

  it('decodes an audio entry once and caches the AudioBuffer', async () => {
    const { assets, buffer } = audioManager();
    await Promise.all([assets.load('sfx:beep'), assets.load('sfx:beep')]);
    expect(assets.audioLoader.loadAsync).toHaveBeenCalledTimes(1);
    expect(assets.audioLoader.loadAsync.mock.calls[0][0]).toMatch(/assets\/audio\/beep\.wav$/);
    expect(assets.get('sfx:beep')).toBe(buffer);
  });

  it('is not a model: instantiate refuses it, release just drops it', async () => {
    const { assets } = audioManager();
    await assets.load('sfx:beep');
    expect(() => assets.instantiate('sfx:beep')).toThrow(/not a model/);
    expect(() => assets.release('sfx:beep')).not.toThrow();
    expect(assets.has('sfx:beep')).toBe(false);
  });
});
