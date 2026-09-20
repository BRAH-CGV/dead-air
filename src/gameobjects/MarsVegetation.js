import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Component } from '../core/Component.js';
import { makeNoise2D, fbm } from '../core/Noise.js';
import { makeRandom, randRange, randPower, randPick } from '../core/Random.js';
import { terrainHeightAt } from './MarsTerrain.js';
import { makeYard, yardDistance, makeYardRadiusLookup } from './BaseYard.js';

// ─────────────────────────────────────────────
// MarsVegetation  –  whatever the terraforming took
// ─────────────────────────────────────────────
// Growth is a BELT around the base, not a scatter of islands. It closes the
// horizon in every direction, thick near the door and giving out with the walk
// from it, and the only way to see the valley past it is through the lanes cut
// through it — wide enough to drive down, and the one bit of the landscape that
// is obviously deliberate. Standing inside a ring of growth you cannot see out
// of is the effect; the lanes are what make it feel kept rather than overgrown.
//
//   this._outside.addChild(createMarsVegetation({ assets, keepClear }));
//
// ── Not Earth grass ──
// The blades are stiff, near-black at the root and dusty violet at the tip,
// splayed from the ground in tufts rather than combed one way. They are tall
// enough to hide something and they move, which is what makes the belt read as
// worth watching rather than as scenery.
//
// ── The trees ──
// These are the existing .glb models, instanced rather than spawned: the
// manifest's tree-birch and tree-pine are really red-tree1 and red-tree2, so
// they are closer to the part than their keys suggest. They are stretched
// taller and thinner than they were modelled, tinted toward the ground they
// stand in, and leaned a few degrees off vertical — all of it away from what a
// tree on Earth does, so they stay wrong at a glance.
//
// ── Clearings ──
// A handful of circles inside the belt where nothing grows at all. Unlike the
// lanes they lead nowhere and nothing explains them, which is the detail meant
// to sit wrong without being nameable.
// ─────────────────────────────────────────────

export const VEGETATION = {
  /** Picked, not arbitrary. The lanes and clearings are angular cuts, so some
   *  seeds leave one twelfth of the horizon noticeably barer than the rest;
   *  this one spreads them evenly (1.50x between the fullest and emptiest
   *  sector past 55 m, against 1.8x for the average seed). */
  seed: 20260957,
  /** Metres of clear ground off every wall of the base. Measured off the
   *  walls, not from the origin, so the belt follows the building's shape —
   *  see BaseYard. Ten leaves room for another room off any wall and still
   *  brings the planting to within about fifteen metres of the window. Rocks
   *  clear a wider yard: someone living here would get stone off the ground by
   *  the door long before they stopped planting in it. */
  yardMargin: 10,
  /** Nothing was planted far from the base. Someone terraforming a site this
   *  small works outward from the door and stops where the walk gets long. */
  outerRadius: 150,
  /** Tufts attempted across the belt. Rejections — lanes, clearings, slope,
   *  thinning — take roughly a third, and each tuft is three blades. */
  tuftCount: 150000,
  /** How hard growth crowds the base. Higher packs more of the belt into the
   *  first thirty metres and leaves the outer edge sparse. */
  inwardBias: 2.5,
  bladeHeight: [0.6, 1.45],
  /** Trees attempted. Spacing rejects most of these — roughly six in seven —
   *  so this is far higher than the number that ends up standing. Trees are
   *  what close the horizon from a distance, since grass stops reading as
   *  anything much past fifty metres. */
  treeCount: 5200,
  /** Minimum gap between trunks, in metres: tight at the yard's edge, opening
   *  out across `spacingReach` metres beyond it. A single spacing was what
   *  kept the near ground open however many trees were attempted — the first
   *  ring filled and every later candidate was rejected. Varying it packs a
   *  thicket against the yard, which is what closes the view from the
   *  windows, and leaves the far belt airy enough to see the valley through. */
  treeSpacing: [2.9, 6.8],
  spacingReach: 90,
  /** Trees crowd the yard harder than the grass does. Separate from
   *  inwardBias, because raising that one to pull the trees in thins the
   *  grass across the whole belt as a side effect. */
  treeInwardBias: 3.6,
  /** Lanes cut through the belt, and their half-width in metres. Few and
   *  narrow: they are gaps to glimpse the valley through, not avenues. */
  lanes: 5,
  laneHalfWidth: [3.5, 6.0],
  /** Bare circles inside the belt, and how big they get. */
  clearings: 6,
  clearingRadius: [7, 16],
  /** Metres over which growth fades in at the edge of any opening. Without
   *  this every lane and clearing ends on a drawn line, which is the one thing
   *  nothing in a landscape does. */
  softEdge: 5,
  /** Trees come in loose groves rather than an even spread, plus a share
   *  planted anywhere so the groves do not read as a pattern. */
  groves: 30,
  groveRadius: [9, 24],
  strayTreeShare: 0.22,
  /** Blades stop where the ground gets too steep to hold soil. */
  maxSlope: 0.82,
};

/** Root to tip. Near-black at the base, dusty violet where the light catches
 *  it — the one colour on the planet that is not an oxide. */
const BLADE_ROOT = new THREE.Color(0x140d18);
const BLADE_TIP  = new THREE.Color(0x6b4f7a);

/** Tints multiplied over the tree models, pulling them toward the ground they
 *  stand in and away from anything that reads as foliage. */
const TREE_TINTS = [0x6b4436, 0x7a4a52, 0x5c3a46, 0x84543f];

/** Sized per species, since the models are nothing like each other in scale or
 *  build. The manifest keys are misleading: tree-birch and tree-pine are
 *  red-tree1 and red-tree2, and tree-fantasy is dead-tree1 — a tangled thing
 *  that reads as scrub, so it is planted at bush height rather than as a tree. */
const TREE_SPECIES = [
  { key: 'model:tree-birch',   height: [3.5, 7.0] },   // red-tree1
  { key: 'model:tree-pine',    height: [6.0, 13.0] },  // red-tree2
  { key: 'model:tree-dead',    height: [5.0, 11.0] },  // dead_tree1
  { key: 'model:tree-fantasy', height: [1.2, 2.6] },   // dead-tree1, kept scrubby
];

export { TREE_SPECIES };

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Build the vegetation belt.
 *
 * @param {Object} [opts]
 * @param {import('../core/AssetManager.js').AssetManager} [opts.assets]
 *        omit to get grass only — the trees come from the manifest
 * @param {number} [opts.seed]
 * @param {number} [opts.yardMargin]  metres of clear ground off every wall
 * @param {{halfX: number, halfZ: number}} [opts.footprint]
 *        the base's outer half extents — BaseScene should pass its live bounds
 * @param {Array<{x: number, z: number, radius: number}>} [opts.keepClear]
 * @param {number[]} [opts.lanes]  extra lane bearings in radians, on top of the
 *        seeded ones — pass the direction of anything that must stay drivable
 * @param {(x: number, z: number) => number} [opts.heightAt]
 * @returns {GameObject} a group carrying the grass and one mesh per tree part
 */
export function createMarsVegetation(opts = {}) {
  const {
    assets,
    seed        = VEGETATION.seed,
    yardMargin  = VEGETATION.yardMargin,
    footprint,
    keepClear   = [],
    lanes: extraLanes = [],
    heightAt    = terrainHeightAt,
  } = opts;

  const rand  = makeRandom(seed);
  const noise = makeNoise2D(seed ^ 0x2b91);

  const vegetation = new GameObject('MarsVegetation');
  // A group, so the editor neither lists thousands of blades nor measures a
  // bounding box the size of the basin.
  vegetation.makeGroup();

  // The yard is a shape, not a radius, so everything that used to start at
  // `clearRadius` now starts at the yard's edge along its own bearing.
  const zones     = makeYard({ margin: yardMargin, footprint, extra: keepClear });
  const yardAt    = makeYardRadiusLookup(zones, VEGETATION.outerRadius);
  const lanes     = layOutLanes(rand, extraLanes);
  const clearings = layOutClearings(rand, yardAt);
  const groves    = layOutGroves(rand, yardAt);
  const site      = { zones, yardAt, lanes, clearings, groves, noise, heightAt };

  const blades = plantGrass(site, rand);
  const trees  = plantTrees(site, rand);

  const time = { value: 0 };
  if (blades.length > 0) {
    vegetation.object3d.add(buildGrass(blades, time));
    // The sway is a shader clock, so something has to advance it. Keeping the
    // component here means the scene only has to add the group.
    vegetation.addComponent(new SwayClock(time));
  }
  for (const mesh of buildTrees(trees, assets, rand)) vegetation.object3d.add(mesh);

  vegetation.vegetationUniforms = { uTime: time };
  vegetation.lanes = lanes;
  vegetation.clearings = clearings;
  vegetation.groves = groves;
  return vegetation;
}

/** Advances the grass sway. One uniform shared by every blade. */
class SwayClock extends Component {
  constructor(time) { super(); this.time = time; }
  onUpdate(dt) { this.time.value += dt; }
}

/** The lanes cut through the belt. Each is a bearing out from the base plus a
 *  half-width; `extra` bearings are guaranteed, so a scene can keep the way to
 *  something it owns drivable. */
function layOutLanes(rand, extra) {
  const { lanes, laneHalfWidth } = VEGETATION;
  const bearings = [...extra];

  // Spread the seeded ones around the remaining arc rather than rolling them
  // free: five random bearings will happily land as one wide gap and four
  // together, which is the lopsided look this replaced.
  const slots = Math.max(0, lanes - extra.length);
  for (let i = 0; i < slots; i++) {
    bearings.push((i + rand() * 0.7) * (Math.PI * 2 / slots));
  }

  return bearings.map(bearing => ({
    bearing,
    halfWidth: randRange(rand, laneHalfWidth[0], laneHalfWidth[1]),
    // Lanes wander, because nothing anyone drove made a straight edge.
    wander: rand() * Math.PI * 2,
  }));
}

/** Bare circles inside the belt. They lead nowhere, which is the point.
 *
 *  Spread by angle like the lanes and groves. Rolled free, three of six could
 *  land in the same eighth of the belt and gut it, which is indistinguishable
 *  from the one-sided bias this whole layout exists to avoid. */
function layOutClearings(rand, yardAt) {
  const { clearings, clearingRadius, outerRadius } = VEGETATION;
  const sites = [];

  for (let i = 0; i < clearings; i++) {
    const angle  = (i + rand() * 0.8) * (Math.PI * 2 / clearings);
    const radius = randRange(rand, yardAt(angle) + 10, outerRadius * 0.75);
    sites.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      radius: randRange(rand, clearingRadius[0], clearingRadius[1]),
    });
  }

  return sites;
}

/** 0 fully inside the edge, 1 clear of it, smooth between. */
function ramp(distance, edge) {
  const t = Math.min(1, Math.max(0, (distance - edge) / VEGETATION.softEdge));
  return t * t * (3 - 2 * t);
}

/**
 * How much of the ground here is open to growth, 0 to 1.
 *
 * Every opening — the office envelope, the lanes, the clearings, anything the
 * scene asked to keep clear — fades out over `softEdge` metres rather than
 * stopping dead. Treating these as hard in-or-out tests gave the belt cut
 * edges you could see the ruler behind; the taper is what makes a lane look
 * worn through the growth instead of mown into it.
 */
function openness(x, z, site) {
  const radius = Math.hypot(x, z);

  // The yard already measures distance to its own edge, so it grades from
  // zero rather than from a circle's radius.
  let factor = ramp(yardDistance(x, z, site.zones), 0);
  for (const clearing of site.clearings) {
    factor = Math.min(factor, ramp(Math.hypot(x - clearing.x, z - clearing.z), clearing.radius));
  }
  if (factor <= 0) return 0;

  const angle = Math.atan2(z, x);
  for (const lane of site.lanes) {
    // Wander the lane's bearing along its length, so its edges are ragged
    // rather than drawn with a ruler.
    const bearing = lane.bearing + Math.sin(radius * 0.035 + lane.wander) * 0.09;
    let delta = angle - bearing;
    while (delta >  Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) >= Math.PI / 2) continue;

    // Perpendicular distance from the lane's centre line. A constant width in
    // metres, not in angle, or the lane would fan out into a wedge.
    factor = Math.min(factor, ramp(Math.abs(radius * Math.sin(delta)), lane.halfWidth));
  }

  return factor;
}

/**
 * How thick the growth is at a point, 0 to 1.
 *
 * Local variation only — the noise frequency is deliberately high. Sampled too
 * coarsely, its lowest octave spans the whole belt and becomes a bias that
 * empties one side of the map, which is the bug this replaced.
 */
/** The gap trees keep from each other at a point: tightest against the yard,
 *  easing to the far value over `spacingReach` metres. */
function spacingAt(x, z, site) {
  const [near, far] = VEGETATION.treeSpacing;
  const t = Math.min(1, Math.max(0, yardDistance(x, z, site.zones) / VEGETATION.spacingReach));
  return near + (far - near) * (t * t * (3 - 2 * t));
}

function thickness(x, z, site) {
  const clump = fbm(site.noise, x * 0.12, z * 0.12, { octaves: 3 }) * 0.5 + 0.5;
  // A narrow range on purpose. Even at this frequency the field averages a
  // little heavier on one side than the other, and anything wider turns that
  // into a visible lean across the whole belt.
  return 0.7 + 0.3 * clump;
}

/** Pick a point in the belt, crowded toward the base. */
function samplePoint(rand, yardAt, bias = VEGETATION.inwardBias) {
  // The bearing comes first, because the yard's edge depends on it: the belt
  // starts fifteen metres off the back wall and twenty-six off the wings. With
  // a single inner radius for every bearing, inwardBias would crowd growth
  // against a circle that is not there, and a third of the samples along the
  // wings would land in the yard and be thrown away.
  const angle = rand() * Math.PI * 2;
  const inner = yardAt(angle);
  const radius = inner + (VEGETATION.outerRadius - inner) * Math.pow(rand(), bias);
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, radius };
}

/** Fill the belt with grass. */
function plantGrass(site, rand) {
  const blades = [];

  for (let i = 0; i < VEGETATION.tuftCount; i++) {
    const { x, z } = samplePoint(rand, site.yardAt);
    if (rand() > openness(x, z, site) * thickness(x, z, site)) continue;

    const normal = groundNormal(x, z, site.heightAt);
    if (normal.y < VEGETATION.maxSlope) continue;

    const height = randPower(rand, VEGETATION.bladeHeight[0], VEGETATION.bladeHeight[1], 0.8);
    blades.push({
      position: new THREE.Vector3(x, site.heightAt(x, z) - 0.04, z),
      quaternion: bladeRotation(rand, normal),
      scale: new THREE.Vector3(randRange(rand, 0.7, 1.3), height, 1),
      phase: rand() * Math.PI * 2,
    });
  }

  return blades;
}

/** Blades splay out of the ground rather than combing one way. */
function bladeRotation(rand, normal) {
  return new THREE.Quaternion()
    .setFromUnitVectors(UP, normal)
    .multiply(new THREE.Quaternion().setFromAxisAngle(UP, rand() * Math.PI * 2))
    .multiply(new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(rand() * 2 - 1, 0, rand() * 2 - 1).normalize(),
      randRange(rand, -0.5, 0.5),
    ));
}

/** Loose groves for the trees to gather in. Spread by angle rather than rolled
 *  free, so the groves cover the belt instead of clumping to one side — the
 *  same trap the old patch layout fell into. */
function layOutGroves(rand, yardAt) {
  const { groves, groveRadius, outerRadius, treeInwardBias } = VEGETATION;
  const sites = [];

  for (let i = 0; i < groves; i++) {
    const angle  = (i + rand() * 0.85) * (Math.PI * 2 / groves);
    const inner  = yardAt(angle);
    const radius = inner + (outerRadius - inner) * Math.pow(rand(), treeInwardBias);
    sites.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      radius: randRange(rand, groveRadius[0], groveRadius[1]),
    });
  }

  return sites;
}

/** Stand trees through the belt, out of each other's way. */
function plantTrees(site, rand) {
  const trees = [];

  for (let i = 0; i < VEGETATION.treeCount; i++) {
    // Most trees belong to a grove; the rest are planted anywhere, so the
    // groves read as thickets rather than as circles someone laid out.
    let x;
    let z;
    if (site.groves.length === 0 || rand() < VEGETATION.strayTreeShare) {
      ({ x, z } = samplePoint(rand, site.yardAt, VEGETATION.treeInwardBias));
    } else {
      const grove = randPick(rand, site.groves);
      const angle = rand() * Math.PI * 2;
      const reach = Math.pow(rand(), 0.6) * grove.radius;
      x = grove.x + Math.cos(angle) * reach;
      z = grove.z + Math.sin(angle) * reach;
    }

    if (rand() > openness(x, z, site) * thickness(x, z, site)) continue;

    // Trees growing into each other read as a model dropped twice, so canopies
    // need roughly their own width between trunks — but only roughly, and less
    // of it where the planting is meant to be a thicket.
    const gap = spacingAt(x, z, site);
    const crowded = trees.some(t =>
      Math.hypot(x - t.position.x, z - t.position.z) < gap);
    if (crowded) continue;

    const normal = groundNormal(x, z, site.heightAt);
    if (normal.y < VEGETATION.maxSlope) continue;

    const species = randPick(rand, TREE_SPECIES);
    const lean = rand() * Math.PI * 2;
    trees.push({
      key: species.key,
      position: new THREE.Vector3(x, site.heightAt(x, z) - 0.12, z),
      // Leaned off vertical by more than wind would explain.
      quaternion: new THREE.Quaternion()
        .setFromAxisAngle(UP, rand() * Math.PI * 2)
        .multiply(new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(Math.cos(lean), 0, Math.sin(lean)),
          randRange(rand, 0.04, 0.16),
        )),
      height: randRange(rand, species.height[0], species.height[1]),
      // Taller and narrower than the model was built, which is most of why
      // they stop reading as Earth trees.
      pinch: randRange(rand, 0.5, 0.78),
      tint: randPick(rand, TREE_TINTS),
    });
  }

  return trees;
}

/** A tuft: three tapering blades splayed out of one root, curled forward so a
 *  clump has depth. Tufts rather than single blades because that is how grass
 *  actually grows, and because it triples what you see per instance — a matrix
 *  and a bounding-sphere entry per blade would cost far more for the same
 *  thickness. Four segments is enough to read as a curve at this size. */
function makeBladeGeometry() {
  // Three segments, not four. At this density the grass is the scene's biggest
  // triangle cost by far, and a blade a few pixels wide reads the same either
  // way — the saving is a quarter of it.
  const segments = 3;
  const width = 0.035;
  const positions = [];
  const colors = [];
  const color = new THREE.Color();

  // Fixed rather than random: the geometry is shared by every instance, and
  // the per-instance rotation is what stops the field looking stamped.
  const blades = [
    { yaw: 0.0,  lean: 0.00, offset: [0.000, 0.000], height: 1.00 },
    { yaw: 2.1,  lean: 0.22, offset: [0.035, 0.015], height: 0.82 },
    { yaw: 4.3,  lean: 0.30, offset: [-0.03, 0.028], height: 0.67 },
  ];

  for (const blade of blades) {
    const cos = Math.cos(blade.yaw);
    const sin = Math.sin(blade.yaw);

    for (let i = 0; i < segments; i++) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      // Taper to a point, and lean further out the higher it goes.
      const w0 = width * (1 - t0) ** 0.7;
      const w1 = width * (1 - t1) ** 0.7;
      const corners = [
        [-w0, t0, t0 * t0 * 0.18 + t0 * blade.lean],
        [ w0, t0, t0 * t0 * 0.18 + t0 * blade.lean],
        [ w1, t1, t1 * t1 * 0.18 + t1 * blade.lean],
        [-w0, t0, t0 * t0 * 0.18 + t0 * blade.lean],
        [ w1, t1, t1 * t1 * 0.18 + t1 * blade.lean],
        [-w1, t1, t1 * t1 * 0.18 + t1 * blade.lean],
      ];

      for (const [cx, cy, cz] of corners) {
        positions.push(
          cx * cos - cz * sin + blade.offset[0],
          cy * blade.height,
          cx * sin + cz * cos + blade.offset[1],
        );
      }
      for (const t of [t0, t0, t1, t0, t1, t1]) {
        color.copy(BLADE_ROOT).lerp(BLADE_TIP, t);
        colors.push(color.r, color.g, color.b);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Every blade in one InstancedMesh — one draw call for the lot. */
function buildGrass(blades, time) {
  const geometry = makeBladeGeometry();
  const phases = new Float32Array(blades.length);
  blades.forEach((b, i) => { phases[i] = b.phase; });
  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  addSway(material, time);

  const mesh = new THREE.InstancedMesh(geometry, material, blades.length);
  mesh.name = 'MarsGrass';
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const matrix = new THREE.Matrix4();
  blades.forEach((b, i) => {
    matrix.compose(b.position, b.quaternion, b.scale);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Bend each blade by its own phase, hardest at the tip. Injected rather than
 *  hand-written so the grass keeps ordinary lighting and fog. */
function addSway(material, time) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        attribute float aPhase;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float bend = pow(max(transformed.y, 0.0), 1.6);
        // Blades within one tuft differ in x, so this decorrelates them without
        // an attribute: a tuft ripples rather than moving as a solid lump.
        float phase = aPhase + transformed.x * 7.0;
        float wave = sin(uTime * 0.8 + phase) + 0.4 * sin(uTime * 1.9 + phase * 1.7);
        transformed.x += wave * bend * 0.09;
        transformed.z += wave * bend * 0.05;`);
  };
}

/**
 * Instance the tree models. A .glb is a little scene graph, so each mesh in it
 * becomes its own InstancedMesh carrying that mesh's own transform baked in.
 * Materials are cloned before tinting: the AssetManager hands out shared
 * materials, and colouring one in place would repaint every copy in the level.
 */
function buildTrees(trees, assets, rand) {
  if (!assets || trees.length === 0) return [];

  const byKey = new Map();
  for (const tree of trees) {
    if (!byKey.has(tree.key)) byKey.set(tree.key, []);
    byKey.get(tree.key).push(tree);
  }

  const meshes = [];
  const local = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  const tint = new THREE.Color();

  for (const [key, placements] of byKey) {
    const parts = modelParts(key, assets);
    if (parts.length === 0) continue;

    // Normalise by the model's own height, so mixing models of wildly
    // different export scales still gives trees of the size we asked for.
    const bounds = assets.getCollision?.(key)?.bounds;
    const modelHeight = bounds ? bounds.size[1] : 1;

    for (const part of parts) {
      const mesh = new THREE.InstancedMesh(
        part.geometry,
        tintedMaterial(part.material),
        placements.length,
      );
      mesh.name = `MarsTree_${key.replace('model:', '')}_${meshes.length}`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;

      placements.forEach((tree, i) => {
        const scale = tree.height / (modelHeight || 1);
        world.compose(
          tree.position,
          tree.quaternion,
          new THREE.Vector3(scale * tree.pinch, scale, scale * tree.pinch),
        );
        mesh.setMatrixAt(i, local.multiplyMatrices(world, part.matrix));
        mesh.setColorAt(i, tint.setHex(tree.tint).multiplyScalar(randRange(rand, 0.8, 1.15)));
      });

      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      meshes.push(mesh);
    }
  }

  return meshes;
}

/** Every mesh inside a cached model, with its transform relative to the root. */
function modelParts(key, assets) {
  let scene;
  try {
    scene = assets.get(key)?.scene;
  } catch {
    // Not loaded — the vegetation is worth having without this species.
    return [];
  }
  if (!scene) return [];

  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse((node) => {
    if (node.isMesh) parts.push({ geometry: node.geometry, material: node.material, matrix: node.matrixWorld.clone() });
  });
  return parts;
}

function tintedMaterial(source) {
  const material = Array.isArray(source) ? source[0].clone() : source.clone();
  // Trees are lit by a moon, so nothing about them should be bright. The
  // per-instance colour does the actual tinting on top of this.
  material.color?.multiplyScalar(0.8);
  if ('roughness' in material) material.roughness = Math.min(1, (material.roughness ?? 1) + 0.2);
  if ('metalness' in material) material.metalness = 0;
  return material;
}

/** Ground normal by finite differences. No seed is passed: the height
 *  function owns the valley's seed. */
function groundNormal(x, z, heightAt) {
  const step = 1.2;
  const dx = heightAt(x + step, z) - heightAt(x - step, z);
  const dz = heightAt(x, z + step) - heightAt(x, z - step);
  return new THREE.Vector3(-dx, 2 * step, -dz).normalize();
}
