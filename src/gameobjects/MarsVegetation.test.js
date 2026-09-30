import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

import { createMarsVegetation, VEGETATION, TREE_SPECIES, GrassField } from './MarsVegetation.js';
import { makeYard, yardDistance, makeYardRadiusLookup, BASE_FOOTPRINT } from './BaseYard.js';
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

/** A stand-in AssetManager whose trees cost what the real ones do: the
 *  triangle counts of the shipped .glb files, one mesh each. */
function realisticAssets() {
  const triangles = { 'model:tree-birch': 1752, 'model:tree-pine': 876, 'model:tree-dead': 1928 };
  const models = {};
  for (const [key, count] of Object.entries(triangles)) {
    // 16 sides x rows x 2, plus 32 for the caps.
    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 4, 16, Math.round((count - 32) / 32));
    geometry.translate(0, 2, 0);
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
    models[key] = { scene };
  }
  return {
    get: (key) => models[key],
    getCollision: () => ({ bounds: { size: [1, 4, 1], center: [0, 2, 0] } }),
  };
}

/** The grass cells at full detail. Each also has a flat twin for distance
 *  (`MarsGrassFar_`) over the same instances, so counting both would count
 *  every tuft twice. */
const grassOf = (veg) => veg.object3d.children.filter(m => m.name.startsWith('MarsGrass_'));
const treesOf = (veg) => veg.object3d.children.filter(m => m.name.startsWith('MarsTree_'));
const scrubOf = (veg) => veg.object3d.children.filter(m => m.name.startsWith('MarsScrub_'));

const trianglesOf = (geometry) =>
  (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;

/** Decompose every instance of one mesh, or of every mesh in a list. */
function instances(meshes) {
  const out = [];
  const matrix = new THREE.Matrix4();
  for (const mesh of [meshes].flat()) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      matrix.decompose(position, quaternion, scale);
      out.push({ position, quaternion, scale });
    }
  }
  return out;
}

/**
 * What the renderer would draw of `root` from `camera`: the triangles and
 * draw calls of every visible InstancedMesh whose bounding sphere meets the
 * view frustum. That is the same test three.js culls with, so a field that
 * is one mesh counts in full from anywhere.
 */
function drawnFrom(root, camera) {
  camera.updateMatrixWorld(true);
  root.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const sphere = new THREE.Sphere();
  let triangles = 0;
  let calls = 0;

  root.traverse((mesh) => {
    if (!mesh.isInstancedMesh || !mesh.visible || mesh.count === 0) return;
    if (mesh.boundingSphere === null) mesh.computeBoundingSphere();
    if (!frustum.intersectsSphere(sphere.copy(mesh.boundingSphere).applyMatrix4(mesh.matrixWorld))) return;
    triangles += trianglesOf(mesh.geometry) * mesh.count;
    calls += 1;
  });
  return { triangles, calls };
}

// Growing the whole belt is the point of most tests here, and it takes
// seconds (5–8 s for the clearings sweep and the two-seed determinism check
// when the suite runs in parallel), past vitest's 5 s default.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

describe('vegetation structure', () => {
  it('is a group holding instanced meshes, invisible to the editor outliner', () => {
    const veg = createMarsVegetation({ assets: mockAssets() });

    expect(veg.isGroup).toBe(true);
    expect(veg.children).toHaveLength(0);
    for (const mesh of veg.object3d.children) expect(mesh.isInstancedMesh).toBe(true);
  });

  it('cuts the grass into cells the camera can cull, not one mesh for the lot', () => {
    // As one InstancedMesh, the grass's bounding sphere held the whole basin,
    // so every blade was drawn from anywhere, walls and all.
    const cells = grassOf(createMarsVegetation());

    expect(cells.length).toBeGreaterThan(8);
    // A draw call each, so not so many that the calls cost more than the
    // triangles they save.
    expect(cells.length).toBeLessThan(60);
    expect(cells.reduce((n, cell) => n + cell.count, 0)).toBeGreaterThan(3000);
    for (const cell of cells) {
      // A cell's sphere spans its own square, not the belt.
      expect(cell.boundingSphere.radius).toBeLessThan(VEGETATION.grassCell);
    }
  });

  it('shares one material and one set of blade vertices across every cell', () => {
    const [a, b] = grassOf(createMarsVegetation());

    expect(a.material).toBe(b.material);
    expect(a.geometry.getAttribute('position')).toBe(b.geometry.getAttribute('position'));
  });

  it('grows the grass and the scrub without any models loaded', () => {
    // The trees come from the manifest; grass must not depend on it, and the
    // scrub is built rather than loaded.
    const veg = createMarsVegetation();
    expect(instances(grassOf(veg)).length).toBeGreaterThan(0);
    expect(scrubOf(veg).length).toBeGreaterThan(0);
    expect(treesOf(veg)).toHaveLength(0);
  });
});

describe('the belt', () => {
  /** Counts by compass sector of the `placements` between `nearest` and
   *  `furthest` metres past the yard's edge, along their own bearing.
   *
   *  Measured from the yard's edge, not the base's centre: the yard reaches
   *  out toward the dish, and the belt is laid out along each bearing from
   *  wherever the yard ends on it, so a ring round the centre would cut that
   *  side short. Measured away from the edge on purpose too: a lane is a
   *  constant width in metres, so close in it eats a large share of a
   *  sector's arc and thins it legitimately. */
  const sectorCounts = (placements, nearest, furthest) => {
    const yardAt = makeYardRadiusLookup(makeYard({ margin: VEGETATION.yardMargin }), VEGETATION.outerRadius);
    const sectors = new Array(8).fill(0);
    for (const { position } of placements) {
      const bearing = Math.atan2(position.z, position.x);
      const distance = Math.hypot(position.x, position.z) - yardAt(bearing);
      if (distance < nearest || distance > furthest) continue;
      const angle = (Math.atan2(position.z, position.x) + Math.PI * 2) % (Math.PI * 2);
      sectors[Math.floor(angle / (Math.PI * 2) * 8) % 8] += 1;
    }
    return sectors;
  };

  it('closes the horizon in every direction', () => {
    // This is the regression the belt exists for. Growth used to be scattered
    // patches gated by a coarse noise field whose lowest octave spanned the
    // whole map, so one side came out thick and the opposite side nearly bare.
    //
    // The grass only runs grassReach past the yard now, and in a band that
    // shallow each clearing and lane takes a real share of a sector, so the
    // sectors differ by up to about 2 to 1 (2.0 here, and 2.0 for the belt
    // before the grass was cut back, measured the same way). A side the old
    // noise emptied came out several times thinner than its opposite.
    const sectors = sectorCounts(instances(grassOf(createMarsVegetation())), 20, 45);

    expect(Math.min(...sectors)).toBeGreaterThan(500);
    expect(Math.max(...sectors) / Math.min(...sectors)).toBeLessThan(2.5);
  });

  it('closes the horizon past the grass with trees, in every direction', () => {
    // Past grassReach the trees are all there is between the base and the
    // valley, so every sector needs some. The stand-ins are one mesh each, so
    // every tree is counted once.
    const veg = createMarsVegetation({ assets: realisticAssets() });
    const sectors = sectorCounts(instances(treesOf(veg)), VEGETATION.grassReach, Infinity);

    expect(Math.min(...sectors)).toBeGreaterThanOrEqual(8);
  });

  it('crowds the base and gives out further off', () => {
    const near = [];
    const far = [];
    for (const { position } of instances(grassOf(createMarsVegetation()))) {
      (Math.hypot(position.x, position.z) < 40 ? near : far).push(position);
    }

    // Per square metre, not per count: the outer ring covers far more ground.
    // The yard is not a circle, so its area is approximated by the radius that
    // encloses it — close enough for a ratio this coarse.
    const yardRadius = BASE_FOOTPRINT.halfX + VEGETATION.yardMargin;
    const reach = yardRadius + VEGETATION.grassReach;
    const nearArea = Math.PI * (40 ** 2 - yardRadius ** 2);
    const farArea  = Math.PI * (reach ** 2 - 40 ** 2);
    expect(near.length / nearArea).toBeGreaterThan((far.length / farArea) * 3);
  });

  it('stops the grass within grassReach of the yard, and lets the trees run on', () => {
    // Grass stops reading as anything much past fifty metres, and all the way
    // out to outerRadius it was 1.3 M triangles, the scene's biggest single
    // cost. The trees are what close the horizon, so they keep the full belt.
    const veg = createMarsVegetation({ assets: mockAssets() });
    const zones = makeYard({ margin: VEGETATION.yardMargin });

    let furthest = 0;
    for (const { position } of instances(grassOf(veg))) {
      furthest = Math.max(furthest, yardDistance(position.x, position.z, zones));
    }
    expect(furthest).toBeLessThanOrEqual(VEGETATION.grassReach + 1e-3);
    expect(furthest).toBeGreaterThan(VEGETATION.grassReach * 0.8);

    const treeReach = Math.max(...instances(treesOf(veg))
      .map(({ position }) => yardDistance(position.x, position.z, zones)));
    expect(treeReach).toBeGreaterThan(VEGETATION.grassReach * 1.5);
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

    const trees = instances(treesOf(veg)).map(i => i.position);
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
    const check = (meshes, slack) => {
      for (const { position } of instances(meshes)) {
        expect(yardDistance(position.x, position.z, zones))
          .toBeGreaterThanOrEqual(-slack - 1e-3);
      }
    };

    // Grass is planted where it stands, so it is exact.
    check(grassOf(veg), 0);
    // A tree's parts are not: the trunk is planted outside the line, and a
    // leaning tree's canopy hangs a little way over it, which is what a tree
    // does. The trunk is what has to stay out.
    check(treesOf(veg), 1);
    check(scrubOf(veg), 1);
  });
});

describe('grass', () => {
  it('stands on the ground, tall enough to hide something', () => {
    for (const { position, scale } of instances(grassOf(createMarsVegetation()))) {
      expect(position.y).toBeCloseTo(terrainHeightAt(position.x, position.z) - 0.04, 1);
      expect(scale.y).toBeGreaterThanOrEqual(VEGETATION.bladeHeight[0] - 0.01);
      expect(scale.y).toBeLessThanOrEqual(VEGETATION.bladeHeight[1] + 0.01);
    }
  });

  it('is not Earth grass: dark violet, not green', () => {
    const colors = grassOf(createMarsVegetation())[0].geometry.getAttribute('color');

    for (let i = 0; i < colors.count; i++) {
      // Green never leads. Blue does, which is what makes it read as alien.
      expect(colors.getY(i)).toBeLessThan(colors.getZ(i));
    }
  });

  it('carries a per-blade phase so the patch shimmers instead of pulsing', () => {
    for (const cell of grassOf(createMarsVegetation())) {
      const phases = cell.geometry.getAttribute('aPhase');
      expect(phases.count).toBe(cell.count);
    }
    const phases = grassOf(createMarsVegetation())[0].geometry.getAttribute('aPhase');
    expect(new Set([phases.getX(0), phases.getX(1), phases.getX(2)]).size).toBe(3);
  });

  it('advances its own sway clock', () => {
    const veg = createMarsVegetation();
    veg.components.forEach(c => c.onUpdate(0.5));

    expect(veg.vegetationUniforms.uTime.value).toBeCloseTo(0.5);
  });

  it('draws cells near the camera in full and far ones flat', () => {
    // Out past the detail distance a blade is a pixel or two wide, so three
    // curved segments cost five times what one flat triangle does for nothing
    // anyone can see. Each cell has both; one shows at a time.
    const veg = createMarsVegetation();
    const field = veg.getComponent(GrassField);
    const near = grassOf(veg);
    const far = veg.object3d.children.filter(m => m.name.startsWith('MarsGrassFar_'));
    expect(far).toHaveLength(near.length);

    field.showDetailNear(new THREE.Vector3(0, 1.2, 12));
    const shown = near.filter(m => m.visible);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(near.length / 2);
    near.forEach((cell, i) => expect(far[i].visible).toBe(!cell.visible));

    // The flat twin draws the same tufts from the same matrices, a fraction
    // of the cost.
    expect(far[0].instanceMatrix).toBe(near[0].instanceMatrix);
    expect(far[0].count).toBe(near[0].count);
    expect(trianglesOf(far[0].geometry) * 4).toBeLessThan(trianglesOf(near[0].geometry));
  });

  it('follows the camera through the engine each frame', () => {
    const veg = createMarsVegetation();
    const camera = new THREE.PerspectiveCamera();
    veg.scene = { userData: { engine: { camera } } };
    const near = grassOf(veg);

    camera.position.set(0, 1.2, 12);
    veg.components.forEach(c => c.onUpdate(0.016));
    const shownAtDoor = near.filter(m => m.visible).length;

    camera.position.set(400, 1.2, 400);
    veg.components.forEach(c => c.onUpdate(0.016));
    expect(shownAtDoor).toBeGreaterThan(0);
    expect(near.filter(m => m.visible)).toHaveLength(0);
  });
});

describe('trees', () => {
  it('instances every mesh of the model, with its own transform baked in', () => {
    // A .glb is a scene graph: the canopy sits 3 m above the trunk's origin,
    // and losing that offset would stack every part at the root.
    const veg = createMarsVegetation({ assets: mockAssets() });
    expect(treesOf(veg).length).toBeGreaterThanOrEqual(2);
  });

  it('cuts the trees into cells too, sharing one material per model part', () => {
    const veg = createMarsVegetation({ assets: realisticAssets() });
    const trees = treesOf(veg);

    for (const mesh of trees) expect(mesh.boundingSphere.radius).toBeLessThan(VEGETATION.treeCell);
    const birch = trees.filter(m => m.name.startsWith('MarsTree_tree-birch_'));
    expect(birch.length).toBeGreaterThan(1);
    expect(new Set(birch.map(m => m.material)).size).toBe(1);
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
    const scales = instances(treesOf(veg)).map(i => i.scale.y);
    const trees = TREE_SPECIES.filter(s => s.key !== 'scrub');
    const shortest = Math.min(...trees.map(s => s.height[0]));
    const tallest  = Math.max(...trees.map(s => s.height[1]));

    // The mock model is 4 m tall, so scales land around height / 4.
    for (const scale of scales) {
      expect(scale).toBeGreaterThan(shortest / 4 - 0.2);
      expect(scale).toBeLessThan(tallest / 4 + 0.2);
    }
  });

  it('keeps the scrub at bush height and the rest as trees', () => {
    const scrub = TREE_SPECIES.find(s => s.key === 'scrub');
    const trees = TREE_SPECIES.filter(s => s.key !== 'scrub');

    expect(scrub.height[1]).toBeLessThan(3);
    for (const species of trees) expect(species.height[0]).toBeGreaterThan(scrub.height[1]);
  });

  it('builds the scrub rather than loading it: a metre-tall knot of stalks, a few hundred triangles', () => {
    // The model it replaced (tree-fantasy) was 7,596 triangles a bush, a
    // million across the belt, for something knee-high in the dark.
    expect(TREE_SPECIES.map(s => s.key)).not.toContain('model:tree-fantasy');

    const scrub = scrubOf(createMarsVegetation());
    const geometry = scrub[0].geometry;
    geometry.computeBoundingBox();
    expect(trianglesOf(geometry)).toBeLessThan(300);
    expect(geometry.boundingBox.max.y).toBeCloseTo(1, 5);
    expect(geometry.boundingBox.min.y).toBeCloseTo(0, 5);
    for (const mesh of scrub) expect(mesh.geometry).toBe(geometry);

    const [low, high] = TREE_SPECIES.find(s => s.key === 'scrub').height;
    for (const { scale } of instances(scrub)) {
      expect(scale.y).toBeGreaterThanOrEqual(low - 0.01);
      expect(scale.y).toBeLessThanOrEqual(high + 0.01);
    }
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

describe('what the camera has to draw', () => {
  // The belt was 2.8 M triangles in 5 calls from anywhere, because each field
  // was one mesh spanning the valley (docs/PERFORMANCE-PLAN.md). Cut into
  // cells, it measures 300-610 k in 29-54 calls from these views, and these
  // budgets pin that with a little headroom, so anything that uncuts the belt
  // fails here. They are over the belt's fair share of the frame's 500 k:
  // the trees are most of what is left, since the models are 900-1,900
  // triangles each whatever the distance, and giving the far cells lighter
  // stand-ins is the next step.
  const TRIANGLE_BUDGET = 700_000;
  const CALL_BUDGET = 60;

  it('keeps the belt under budget from the office window and all round the yard', () => {
    // The dish lane, as BaseScene asks for it.
    const veg = createMarsVegetation({ assets: realisticAssets(), lanes: [Math.atan2(-25, 0)] });
    const field = veg.getComponent(GrassField);
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);

    const views = [
      // At the office window, looking out at the dish.
      { at: [0, 1.24, -4.5], yaws: [0] },
      // Out of the hatch, and at the dish itself, looking every way.
      { at: [2, 1.24, 12], yaws: [0, Math.PI / 2, Math.PI, -Math.PI / 2] },
      { at: [0, 1.24, -22], yaws: [0, Math.PI / 2, Math.PI, -Math.PI / 2] },
    ];
    for (const { at, yaws } of views) {
      camera.position.set(...at);
      field.showDetailNear(camera.position);
      for (const yaw of yaws) {
        camera.rotation.set(0, yaw, 0, 'YXZ');
        const drawn = drawnFrom(veg.object3d, camera);
        expect(drawn.triangles, `at ${at}, yaw ${yaw.toFixed(2)}`).toBeLessThan(TRIANGLE_BUDGET);
        expect(drawn.calls, `at ${at}, yaw ${yaw.toFixed(2)}`).toBeLessThan(CALL_BUDGET);
      }
    }
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
