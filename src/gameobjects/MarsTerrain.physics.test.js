import { describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d';
import { createMarsTerrain, terrainHeightAt } from './MarsTerrain.js';

// These run against the REAL Rapier, deliberately. MarsTerrain.test.js mocks it
// to stay fast, and that mock happily accepted two heightfield bugs that the
// engine would not have: nrows/ncols are subdivisions rather than vertex counts
// (the WASM traps on an unreachable), and rows are indexed by Z while columns
// are indexed by X (the terrain loads, looks perfect, and the ground you stand
// on is the map mirrored about its diagonal). A mock cannot catch either.

describe('MarsTerrain against real Rapier', () => {
  it('builds a heightfield collider Rapier accepts, and steps', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const terrain = createMarsTerrain(world);

    expect(terrain.collider).toBeDefined();
    expect(() => world.step()).not.toThrow();
  });

  it('puts the collision surface where the visible surface is', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    createMarsTerrain(world);
    world.step();   // the query pipeline is empty until the first step

    // Off-diagonal samples matter most: a transposed grid agrees everywhere
    // along x = z, so symmetric probes would pass on mirrored terrain.
    const probes = [
      [0, 0], [0, -25], [7, -7],          // the office pad
      [120, 60], [200, 0], [-330, 120],   // the slope and the ridge
      [0, 400], [-460, 90], [380, -250],  // the crest
    ];

    for (const [x, z] of probes) {
      const ray = new RAPIER.Ray({ x, y: 300, z }, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(ray, 1000, true);
      expect(hit, `no ground under (${x}, ${z})`).not.toBeNull();

      // The heightfield interpolates linearly across its 4 m cells while
      // terrainHeightAt is the exact curve, so allow a cell's worth of sag.
      expect(300 - hit.timeOfImpact).toBeCloseTo(terrainHeightAt(x, z), 0);
    }
  });

  it('covers the whole square, with no hole to fall through', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    createMarsTerrain(world);
    world.step();

    for (const [x, z] of [[-511, -511], [511, 511], [-511, 511], [511, -511], [0, 511]]) {
      const ray = new RAPIER.Ray({ x, y: 300, z }, { x: 0, y: -1, z: 0 });
      expect(world.castRay(ray, 1000, true), `hole at (${x}, ${z})`).not.toBeNull();
    }
  });
});
