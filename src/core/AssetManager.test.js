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
