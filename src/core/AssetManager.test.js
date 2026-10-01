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
    const assets = new AssetManager({ manifest: { 'sfx:hum': { type: 'audio', url: 'assets/audio/hum.mp3' } } });
    const buffer = { duration: 2, numberOfChannels: 1, sampleRate: 8000 };
    assets.audioLoader.loadAsync = vi.fn(async () => buffer);
    return { assets, buffer };
  }

  it('decodes an audio entry through the audio loader and caches the buffer', async () => {
    const { assets, buffer } = audioManager();
    await assets.load('sfx:hum');
    expect(assets.audioLoader.loadAsync).toHaveBeenCalledWith(expect.stringContaining('assets/audio/hum.mp3'));
    expect(assets.get('sfx:hum')).toBe(buffer);
  });

  it('releases an audio buffer without treating it as a model', async () => {
    const { assets } = audioManager();
    await assets.load('sfx:hum');
    expect(() => assets.release('sfx:hum')).not.toThrow();
    expect(assets.has('sfx:hum')).toBe(false);
  });
});
