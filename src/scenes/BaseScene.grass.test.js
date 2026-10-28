import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// The grass is kept off the generator (MarsVegetation's grassClearOf), by
// its footprint grown by a margin. _footprintOf reads nothing off the
// scene, so it is tested here without a build.
// ─────────────────────────────────────────────

const footprintOf = (go, margin) => BaseScene.prototype._footprintOf.call(null, go, margin);

describe('BaseScene._footprintOf (the grass kept off the generator)', () => {
  it("is the object's ground-plan rectangle, grown by the margin all round", () => {
    const go = new GameObject('Generator');
    go.object3d.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1)));
    go.object3d.position.set(10, 0, 5);
    const [box] = footprintOf(go, 1);
    expect(box.minX).toBeCloseTo(8);
    expect(box.maxX).toBeCloseTo(12);
    expect(box.minZ).toBeCloseTo(3.5);
    expect(box.maxZ).toBeCloseTo(6.5);
  });

  it('is nothing for an object with no mesh (a model not loaded), or none at all', () => {
    expect(footprintOf(new GameObject('Empty'), 1)).toEqual([]);
    expect(footprintOf(null, 1)).toEqual([]);
  });
});
