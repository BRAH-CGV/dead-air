import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

import { createMarsVegetation, VEGETATION, TREE_SPECIES } from './MarsVegetation.js';
import { makeYard, yardDistance, BASE_FOOTPRINT } from './BaseYard.js';
import { terrainHeightAt } from './MarsTerrain.js';

/** A stand-in AssetManager holding one two-part tree model. */
function mockAssets() {
  const model = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 4), new THREE.MeshStandardMaterial());
  const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5), new THREE.MeshStandardMaterial());
  canopy.position.y = 3;
  model.add(trunk, canopy);

  return {
    get: vi.fn(() => ({ scene: model })),
    getCollision: vi.fn(() => ({ bounds: { size: [3, 4, 3], center: [0, 2, 0] } })),
  };
}

const grassOf = (veg) => veg.object3d.children.find(m => m.name === 'MarsGrass');
const treesOf = (veg) => veg.object3d.children.filter(m => m.name.startsWith('MarsTree_'));

/** Decompose every instance of one mesh. */
function instances(mesh) {
  const out = [];
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, quaternion, scale);
    out.push({ position, quaternion, scale });
  }
  return out;
}

describe('vegetation structure', () => {
  it('is a group holding instanced meshes, invisible to the editor outliner', () => {
    const veg = createMarsVegetation({ assets: mockAssets() });

    expect(veg.isGroup).toBe(true);
    expect(veg.children).toHaveLength(0);
    for (const mesh of veg.object3d.children) expect(mesh.isInstancedMesh).toBe(true);
  });

  it('draws all the grass in a single call', () => {
    // Tens of thousands of blades; one per patch would be 26 draw calls for
    // nothing, and one per blade would be unusable.
    const grass = grassOf(createMarsVegetation());
    expect(grass.count).toBeGreaterThan(3000);
  });

  it('grows grass without any models loaded', () => {
    // The trees come from the manifest; grass must not depend on it.
    const veg = createMarsVegetation();
    expect(grassOf(veg).count).toBeGreaterThan(0);
    expect(treesOf(veg)).toHaveLength(0);
  });
});

describe('the belt', () => {
  /** Grass tuft counts by compass sector, past `minRadius`.
   *
   *  Measured away from the base on purpose: a lane is a constant width in
   *  metres, so close in it eats a large share of a sector's arc and thins it
   *  legitimately. Out here it takes a slice too small to hide a real bias. */
  const sectorCounts = (veg, minRadius = 55) => {
    const sectors = new Array(8).fill(0);
    for (const { position } of instances(grassOf(veg))) {
      if (Math.hypot(position.x, position.z) < minRadius) continue;
      const angle = (Math.atan2(position.z, position.x) + Math.PI * 2) % (Math.PI * 2);
      sectors[Math.floor(angle / (Math.PI * 2) * 8) % 8] += 1;
    }
    return sectors;
  };

  it('closes the horizon in every direction', () => {
    // This is the regression the belt exists for. Growth used to be scattered
    // patches gated by a coarse noise field whose lowest octave spanned the
    // whole map, so one side came out thick and the opposite side nearly bare.
    const sectors = sectorCounts(createMarsVegetation());

    expect(Math.min(...sectors)).toBeGreaterThan(500);
    expect(Math.max(...sectors) / Math.min(...sectors)).toBeLessThan(1.8);
  });

  it('crowds the base and gives out further off', () => {
    const near = [];
    const far = [];
    for (const { position } of instances(grassOf(createMarsVegetation()))) {
      (Math.hypot(position.x, position.z) < 60 ? near : far).push(position);
    }

    // Per square metre, not per count: the outer ring covers far more ground.
    // The yard is not a circle, so its area is approximated by the radius that
    // encloses it — close enough for a ratio this coarse.
    const yardRadius = BASE_FOOTPRINT.halfX + VEGETATION.yardMargin;
    const nearArea = Math.PI * (60 ** 2 - yardRadius ** 2);
    const farArea  = Math.PI * (VEGETATION.outerRadius ** 2 - 60 ** 2);
    expect(near.length / nearArea).toBeGreaterThan((far.length / farArea) * 3);
  });

  it('leaves lanes open to drive down and see the valley through', () => {
    const veg = createMarsVegetation();
    expect(veg.lanes.length).toBeGreaterThan(2);

    for (const { position } of instances(grassOf(veg))) {
      const radius = Math.hypot(position.x, position.z);
      const angle = Math.atan2(position.z, position.x);
      for (const lane of veg.lanes) {
        const bearing = lane.bearing + Math.sin(radius * 0.035 + lane.wander) * 0.09;
        let delta = angle - bearing;
        while (delta >  Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        if (Math.abs(delta) >= Math.PI / 2) continue;
        expect(Math.abs(radius * Math.sin(delta))).toBeGreaterThanOrEqual(lane.halfWidth);
      }
    }
  });

  it('keeps a lane on any bearing the scene insists on', () => {
    // The scene owns the dish, so it says which way has to stay drivable.
    const veg = createMarsVegetation({ lanes: [-Math.PI / 2] });
    expect(veg.lanes.some(l => Math.abs(l.bearing + Math.PI / 2) < 1e-9)).toBe(true);
  });

  it('leaves bare clearings that lead nowhere', () => {
    // Unlike the lanes these go nowhere and nothing explains them, which is
    // the detail meant to sit wrong. If they ever silently drop to zero the
    // belt is just landscaping.
    const veg = createMarsVegetation();
    expect(veg.clearings.length).toBeGreaterThan(0);

    for (const { position } of instances(grassOf(veg))) {
      for (const clearing of veg.clearings) {
        expect(Math.hypot(position.x - clearing.x, position.z - clearing.z))
          .toBeGreaterThanOrEqual(clearing.radius);
      }
    }
  });

  it('fades growth in at an opening rather than cutting it off', () => {
    // Every opening used to be a hard in-or-out test, which left lanes and
    // clearings with edges you could see the ruler behind. Growth should thin
    // approaching a lane, so the band nearest it is sparser than the next one.
    const veg = createMarsVegetation();
    const near = [];
    const beyond = [];

    for (const { position } of instances(grassOf(veg))) {
      const radius = Math.hypot(position.x, position.z);
      const angle = Math.atan2(position.z, position.x);
      let closest = Infinity;

      for (const lane of veg.lanes) {
        const bearing = lane.bearing + Math.sin(radius * 0.035 + lane.wander) * 0.09;
        let delta = angle - bearing;
        while (delta >  Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        if (Math.abs(delta) >= Math.PI / 2) continue;
        closest = Math.min(closest, Math.abs(radius * Math.sin(delta)) - lane.halfWidth);
      }

      if (closest < 0 || closest === Infinity) continue;
      if (closest < VEGETATION.softEdge) near.push(closest);
      else if (closest < VEGETATION.softEdge * 2) beyond.push(closest);
    }

    // Equal-width bands, so the counts compare directly.
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(beyond.length * 0.8);
  });

  it('gathers trees into loose groves rather than spreading them evenly', () => {
    const veg = createMarsVegetation({ assets: mockAssets() });
    expect(veg.groves.length).toBeGreaterThan(5);

    const trees = treesOf(veg).flatMap(mesh => instances(mesh).map(i => i.position));
    const grouped = trees.filter(position =>
      veg.groves.some(g => Math.hypot(position.x - g.x, position.z - g.z) <= g.radius));

    // Most belong to a grove; the rest are strays, so the groves do not read
    // as circles someone laid out.
    expect(grouped.length).toBeGreaterThan(trees.length * 0.5);
    expect(grouped.length).toBeLessThan(trees.length);
  });

  it('crowds the treeline right up against the walls', () => {
    // The other half of the contract, and the one that carries the mood: the
    // belt has to CLOSE on the base, not just stay out of the yard. Widen the
    // margin and you get a lawn, which is the opposite of the intent — the
    // treeline standing just past arm's reach is what makes leaving cost
    // something.
    const veg = createMarsVegetation({ assets: mockAssets() });
    const zones = makeYard({ margin: VEGETATION.yardMargin });

    let closest = Infinity;
    for (const { position } of instances(grassOf(veg))) {
      closest = Math.min(closest, yardDistance(position.x, position.z, zones));
    }
    // Growth starts within a metre of where it is allowed to.
    expect(closest).toBeLessThan(1);
    expect(VEGETATION.yardMargin).toBeLessThanOrEqual(6);
  });

  it('keeps every plant out of the yard and anything else asked for', () => {
    // The yard is a promise to the branch extending the building: the margin
    // off every wall, the parking apron and the dish track all stay bare.
    const keepClear = [{ x: 0, z: -40, radius: 9 }];
    const veg = createMarsVegetation({ keepClear, assets: mockAssets() });
    const zones = makeYard({ margin: VEGETATION.yardMargin, extra: keepClear });

    // A hair of slack even for grass: the belt starts exactly on the yard's
    // edge, and a point there round-trips through cos/sin a float short.
    const check = (mesh, slack) => {
      for (const { position } of instances(mesh)) {
        expect(yardDistance(position.x, position.z, zones))
          .toBeGreaterThanOrEqual(-slack - 1e-3);
      }
    };

    // Grass is planted where it stands, so it is exact.
    check(grassOf(veg), 0);
    // A tree's parts are not: the trunk is planted outside the line, and a
    // leaning tree's canopy hangs a little way over it, which is what a tree
    // does. The trunk is what has to stay out.
    for (const mesh of treesOf(veg)) check(mesh, 1);
  });
});

describe('grass', () => {
  it('stands on the ground, tall enough to hide something', () => {
    const grass = grassOf(createMarsVegetation());

    for (const { position, scale } of instances(grass)) {
      expect(position.y).toBeCloseTo(terrainHeightAt(position.x, position.z) - 0.04, 1);
      expect(scale.y).toBeGreaterThanOrEqual(VEGETATION.bladeHeight[0] - 0.01);
      expect(scale.y).toBeLessThanOrEqual(VEGETATION.bladeHeight[1] + 0.01);
    }
  });

  it('is not Earth grass: dark violet, not green', () => {
    const colors = grassOf(createMarsVegetation()).geometry.getAttribute('color');

    for (let i = 0; i < colors.count; i++) {
      // Green never leads. Blue does, which is what makes it read as alien.
      expect(colors.getY(i)).toBeLessThan(colors.getZ(i));
    }
  });

  it('carries a per-blade phase so the patch shimmers instead of pulsing', () => {
    const grass = grassOf(createMarsVegetation());
    const phases = grass.geometry.getAttribute('aPhase');

    expect(phases.count).toBe(grass.count);
    expect(new Set([phases.getX(0), phases.getX(1), phases.getX(2)]).size).toBe(3);
  });

  it('advances its own sway clock', () => {
    const veg = createMarsVegetation();
    veg.components.forEach(c => c.onUpdate(0.5));

    expect(veg.vegetationUniforms.uTime.value).toBeCloseTo(0.5);
  });
});

describe('trees', () => {
  it('instances every mesh of the model, with its own transform baked in', () => {
    // A .glb is a scene graph: the canopy sits 3 m above the trunk's origin,
    // and losing that offset would stack every part at the root.
    const veg = createMarsVegetation({ assets: mockAssets() });
    expect(treesOf(veg).length).toBeGreaterThanOrEqual(2);
  });

  it('clones the material before tinting it', () => {
    // AssetManager hands out shared materials. Tinting one in place would
    // repaint every other copy of that model in the level.
    const assets = mockAssets();
    const original = assets.get().scene.children[0].material;
    const veg = createMarsVegetation({ assets });

    for (const mesh of treesOf(veg)) expect(mesh.material).not.toBe(original);
    expect(original.color.getHex()).toBe(0xffffff);
  });

  it('normalises to a target height, whatever scale the model was exported at', () => {
    const veg = createMarsVegetation({ assets: mockAssets() });
    const scales = treesOf(veg).flatMap(m => instances(m).map(i => i.scale.y));
    const shortest = Math.min(...TREE_SPECIES.map(s => s.height[0]));
    const tallest  = Math.max(...TREE_SPECIES.map(s => s.height[1]));

    // The mock model is 4 m tall, so scales land around height / 4.
    for (const scale of scales) {
      expect(scale).toBeGreaterThan(shortest / 4 - 0.2);
      expect(scale).toBeLessThan(tallest / 4 + 0.2);
    }
  });

  it('keeps the scrubby model at bush height and the rest as trees', () => {
    // tree-fantasy is dead-tree1, a tangled thing that reads as scrub rather
    // than as a tree, so it is planted low on purpose.
    const scrub = TREE_SPECIES.find(s => s.key === 'model:tree-fantasy');
    const trees = TREE_SPECIES.filter(s => s.key !== 'model:tree-fantasy');

    expect(scrub.height[1]).toBeLessThan(3);
    for (const species of trees) expect(species.height[0]).toBeGreaterThan(scrub.height[1]);
  });

  it('stretches trees narrower than they were modelled', () => {
    const veg = createMarsVegetation({ assets: mockAssets() });
    for (const { scale } of instances(treesOf(veg)[0])) {
      expect(scale.x).toBeLessThan(scale.y);
    }
  });

  it('survives a model that failed to load', () => {
    const assets = { get: () => { throw new Error('not loaded'); } };
    expect(() => createMarsVegetation({ assets })).not.toThrow();
  });
});

describe('determinism', () => {
  it('grows the same belt for the same seed, different for another', () => {
    const bladeX = (veg) => instances(grassOf(veg)).slice(0, 50).map(i => i.position.x);

    expect(bladeX(createMarsVegetation()))
      .toEqual(bladeX(createMarsVegetation()));
    expect(bladeX(createMarsVegetation()))
      .not.toEqual(bladeX(createMarsVegetation({ seed: 99 })));
  });
});
