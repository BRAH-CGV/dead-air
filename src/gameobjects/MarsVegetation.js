import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Component } from '../core/Component.js';
import { makeNoise2D, fbm } from '../core/Noise.js';
import { makeRandom, randRange, randPower, randPick } from '../core/Random.js';
import { terrainHeightAt } from './MarsTerrain.js';
import { flattenModelParts, dimmedMaterial } from '../core/ModelUtils.js';
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
// tree on Earth does, so they stay wrong at a glance. The knee-high scrub
// among them is built here, not loaded (makeScrubGeometry).
//
// ── Cells ──
// Every field is cut into square cells, one InstancedMesh each, so the camera
// culls whatever is behind it. As one mesh a field's bounding sphere held the
// whole basin, and the belt drew 2.8 M triangles from anywhere, walls and all
// (docs/PERFORMANCE-PLAN.md). A grass cell also has a flat twin that
// GrassField shows in its place once the camera is far enough off.
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
   *  see BaseYard. Five is deliberately claustrophobic: the treeline stands
   *  just beyond arm's reach of the walls, so stepping away from the base
   *  means stepping into it. That is the point — it should cost something to
   *  leave. It also gives up the room an extra wing would have needed, so
   *  widen this before building outward rather than felling trees by hand.
   *  Rocks clear a wider yard: someone living here would get stone off the
   *  ground by the door long before they stopped planting in it. */
  yardMargin: 5,
  /** Nothing was planted far from the base. Someone terraforming a site this
   *  small works outward from the door and stops where the walk gets long. */
  outerRadius: 150,
  /** Grass stops this many metres past the yard's edge; only the trees run
   *  on to outerRadius, since they are what closes the horizon. Past about
   *  fifty metres grass stops reading as anything but texture, and running
   *  out to outerRadius it was 1.3 M triangles, the scene's biggest cost. */
  grassReach: 50,
  /** Tufts attempted within grassReach. Rejections — lanes, clearings, slope,
   *  thinning — take about half, and each tuft is three blades. Sized with
   *  the reach so the ground by the base is as thick as when 150,000 were
   *  spread out to outerRadius: about two thirds of those fell inside it. */
  tuftCount: 102000,
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
  /** Metres on a side of the square cells each field is cut into. Every cell
   *  is a draw call per mesh, so the trees, with a mesh per species and part,
   *  get cells wide enough that the belt stays a few dozen calls. Smaller
   *  cells cull closer and cost more calls: at 64 m the trees took 64 calls
   *  from the hatch, at 80 m 54, and 20 k more triangles on average. */
  grassCell: 24,
  treeCell: 80,
  /** A grass cell whose nearest edge is further than this from the camera
   *  draws each blade as one flat triangle instead of three curved segments.
   *  That is a fifth of the cost, and out there a blade is a pixel or two
   *  wide. */
  grassDetailDistance: 16,
};

/** Root to tip. Near-black at the base, dusty violet where the light catches
 *  it — the one colour on the planet that is not an oxide. */
const BLADE_ROOT = new THREE.Color(0x140d18);
const BLADE_TIP  = new THREE.Color(0x6b4f7a);

/** Tints multiplied over the tree models, pulling them toward the ground they
 *  stand in and away from anything that reads as foliage. */
const TREE_TINTS = [0x6b4436, 0x7a4a52, 0x5c3a46, 0x84543f];

/** The species key of the built scrub. */
const SCRUB = 'scrub';

/** Sized per species, since the models are nothing like each other in scale or
 *  build. The manifest keys are misleading: tree-birch and tree-pine are
 *  red-tree1 and red-tree2. The scrub has no model; it is built by
 *  makeScrubGeometry. It stands where the tree-fantasy model stood, fourth,
 *  so the belt's random stream picks every species where it always did. */
const TREE_SPECIES = [
  { key: 'model:tree-birch',   height: [3.5, 7.0] },   // red-tree1
  { key: 'model:tree-pine',    height: [6.0, 13.0] },  // red-tree2
  { key: 'model:tree-dead',    height: [5.0, 11.0] },  // dead_tree1
  { key: SCRUB,                height: [1.2, 2.6] },   // built, kept scrubby
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
 * @returns {GameObject} a group carrying the grass, scrub and tree cells
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
  const grass = buildGrass(blades, time);
  for (const cell of grass) vegetation.object3d.add(cell.near, cell.far);
  if (grass.length > 0) {
    // The sway is a shader clock and the detail follows the camera, so
    // something has to run them. Keeping the component here means the scene
    // only has to add the group.
    vegetation.addComponent(new GrassField(time, grass));
  }
  for (const mesh of buildTrees(trees, assets, rand)) vegetation.object3d.add(mesh);

  vegetation.vegetationUniforms = { uTime: time };
  vegetation.lanes = lanes;
  vegetation.clearings = clearings;
  vegetation.groves = groves;
  return vegetation;
}

/**
 * Runs the grass: advances the sway clock every blade shares, and shows each
 * cell in full near the camera and flat further off.
 */
export class GrassField extends Component {
  /** Reused every frame. */
  _eye = new THREE.Vector3();

  /**
   * @param {{value: number}} time  the sway shader's uTime
   * @param {Array<{near: THREE.InstancedMesh, far: THREE.InstancedMesh,
   *         bounds: {minX: number, maxX: number, minZ: number, maxZ: number}}>} cells
   */
  constructor(time, cells) {
    super();
    this.time = time;
    this.cells = cells;
  }

  onUpdate(dt) {
    this.time.value += dt;

    const camera = this.scene?.userData?.engine?.camera;
    if (!camera) return;
    // World position, since the camera rides the player (or the fly camera),
    // then into the belt's own space, which is the cells'.
    camera.getWorldPosition(this._eye);
    this.transform.worldToLocal(this._eye);
    this.showDetailNear(this._eye);
  }

  /** Show every cell whose footprint comes within grassDetailDistance of
   *  `point` in full, and every other one flat. `point` is in the belt's own
   *  space. Measured to the cell's nearest edge, so the ground you stand on
   *  is always drawn in full, however big the cells are. */
  showDetailNear(point) {
    const reach = VEGETATION.grassDetailDistance ** 2;
    for (const { near, far, bounds } of this.cells) {
      const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX);
      const dz = Math.max(bounds.minZ - point.z, 0, point.z - bounds.maxZ);
      const close = dx * dx + dz * dz <= reach;
      near.visible = close;
      far.visible = !close;
    }
  }
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

/** Pick a point in the belt, crowded toward the base and no more than
 *  `reach` metres past the yard's edge. */
function samplePoint(rand, yardAt, bias = VEGETATION.inwardBias, reach = Infinity) {
  // The bearing comes first, because the yard's edge depends on it: the belt
  // starts fifteen metres off the back wall and twenty-six off the wings. With
  // a single inner radius for every bearing, inwardBias would crowd growth
  // against a circle that is not there, and a third of the samples along the
  // wings would land in the yard and be thrown away.
  const angle = rand() * Math.PI * 2;
  const inner = yardAt(angle);
  const outer = Math.min(VEGETATION.outerRadius, inner + reach);
  const radius = inner + (outer - inner) * Math.pow(rand(), bias);
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, radius };
}

/** Fill the belt with grass. */
function plantGrass(site, rand) {
  const blades = [];

  for (let i = 0; i < VEGETATION.tuftCount; i++) {
    const { x, z } = samplePoint(rand, site.yardAt, VEGETATION.inwardBias, VEGETATION.grassReach);
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
 *  thickness.
 *
 *  Three segments up close, not four: a blade a few pixels wide reads the
 *  same either way, and the saving is a quarter. One segment far off, which
 *  is a single triangle from the root to the tip. The top segment tapers to a
 *  point, so it is one triangle too, not a quad with a second one of no
 *  area. */
function makeBladeGeometry(segments = 3) {
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
      const tip = i === segments - 1;
      const corners = [
        [-w0, t0, t0 * t0 * 0.18 + t0 * blade.lean],
        [ w0, t0, t0 * t0 * 0.18 + t0 * blade.lean],
        [ w1, t1, t1 * t1 * 0.18 + t1 * blade.lean],
        ...(tip ? [] : [
          [-w0, t0, t0 * t0 * 0.18 + t0 * blade.lean],
          [ w1, t1, t1 * t1 * 0.18 + t1 * blade.lean],
          [-w1, t1, t1 * t1 * 0.18 + t1 * blade.lean],
        ]),
      ];

      for (const [cx, cy, cz] of corners) {
        positions.push(
          cx * cos - cz * sin + blade.offset[0],
          cy * blade.height,
          cx * sin + cz * cos + blade.offset[1],
        );
      }
      for (const t of (tip ? [t0, t0, t1] : [t0, t0, t1, t0, t1, t1])) {
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

/**
 * The grass, cell by cell. Each cell is two InstancedMeshes over the same
 * tufts: `near` with curved blades and `far` with flat ones, sharing one
 * instance buffer, so a cell uploads its matrices once and draws one of the
 * two. Every cell shares the material and the blade vertices; only the phase
 * attribute is a cell's own.
 */
function buildGrass(blades, time) {
  const detailed = makeBladeGeometry(3);
  const flat = makeBladeGeometry(1);
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  addSway(material, time);

  const matrix = new THREE.Matrix4();
  const cells = [];
  for (const { items, bounds } of cellsOf(blades, VEGETATION.grassCell)) {
    const phases = new Float32Array(items.length);
    items.forEach((b, i) => { phases[i] = b.phase; });
    const phase = new THREE.InstancedBufferAttribute(phases, 1);

    const near = new THREE.InstancedMesh(withPhase(detailed, phase), material, items.length);
    items.forEach((b, i) => near.setMatrixAt(i, matrix.compose(b.position, b.quaternion, b.scale)));
    near.instanceMatrix.needsUpdate = true;

    const far = new THREE.InstancedMesh(withPhase(flat, phase), material, items.length);
    far.instanceMatrix = near.instanceMatrix;
    far.visible = false;

    near.name = `MarsGrass_${cells.length}`;
    far.name = `MarsGrassFar_${cells.length}`;
    for (const mesh of [near, far]) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.computeBoundingSphere();
    }
    cells.push({ near, far, bounds });
  }
  return cells;
}

/** A cell's own geometry over the shared blade: the blade's attributes, which
 *  upload once however many cells use them, plus the cell's phases. */
function withPhase(blade, phase) {
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    geometry.setAttribute(name, blade.getAttribute(name));
  }
  geometry.setAttribute('aPhase', phase);
  return geometry;
}

/** Sort placements into square cells `size` metres on a side, keeping each
 *  cell's placements in planting order, with the cell's footprint. */
function cellsOf(placements, size) {
  const cells = new Map();
  for (const placement of placements) {
    const i = Math.floor(placement.position.x / size);
    const j = Math.floor(placement.position.z / size);
    const key = `${i},${j}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        items: [],
        bounds: { minX: i * size, maxX: (i + 1) * size, minZ: j * size, maxZ: (j + 1) * size },
      };
      cells.set(key, cell);
    }
    cell.items.push(placement);
  }
  return [...cells.values()];
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
 * Instance the trees and the scrub, cell by cell. A .glb is a little scene
 * graph, so each mesh in it becomes its own InstancedMesh per cell, carrying
 * that mesh's own transform baked in. Materials are cloned before tinting,
 * once per part and shared by every cell: the AssetManager hands out shared
 * materials, and colouring one in place would repaint every copy in the level.
 */
function buildTrees(trees, assets, rand) {
  // One shade per tree, rolled in planting order before the cells reorder
  // them, so a tree's parts match and the colours don't depend on the cells.
  for (const tree of trees) tree.shade = randRange(rand, 0.8, 1.15);

  const byKey = new Map();
  for (const tree of trees) {
    if (!byKey.has(tree.key)) byKey.set(tree.key, []);
    byKey.get(tree.key).push(tree);
  }

  const meshes = [];
  const local = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();

  for (const [key, placements] of byKey) {
    const model = key === SCRUB ? scrubModel() : loadedModel(key, assets);
    if (!model) continue;

    for (const { items } of cellsOf(placements, VEGETATION.treeCell)) {
      for (const part of model.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length);
        mesh.name = `${model.name}_${meshes.length}`;
        mesh.castShadow = false;
        mesh.receiveShadow = true;

        items.forEach((tree, i) => {
          const size = tree.height / model.height;
          world.compose(tree.position, tree.quaternion,
            scale.set(size * tree.pinch, size, size * tree.pinch));
          mesh.setMatrixAt(i, local.multiplyMatrices(world, part.matrix));
          mesh.setColorAt(i, tint.setHex(tree.tint).multiplyScalar(tree.shade));
        });

        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        meshes.push(mesh);
      }
    }
  }

  return meshes;
}

/** A loaded tree model's parts, each with its own dimmed material, and its
 *  height; null if it isn't loaded. */
function loadedModel(key, assets) {
  if (!assets) return null;
  const parts = flattenModelParts(key, assets);
  if (parts.length === 0) return null;

  // Normalise by the model's own height, so mixing models of wildly
  // different export scales still gives trees of the size we asked for.
  const bounds = assets.getCollision?.(key)?.bounds;
  return {
    name: `MarsTree_${key.replace('model:', '')}`,
    height: (bounds ? bounds.size[1] : 1) || 1,
    parts: parts.map(part => ({ ...part, material: dimmedMaterial(part.material) })),
  };
}

/** The built scrub, as a one-part model a metre tall. */
function scrubModel() {
  return {
    name: 'MarsScrub',
    height: 1,
    parts: [{
      geometry: makeScrubGeometry(),
      // Matches dimmedMaterial's dimming of the models around it. The tint
      // comes per plant, through the instance colour.
      material: new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xcccccc }),
      matrix: new THREE.Matrix4(),
    }],
  };
}

/**
 * The scrub: a knot of bare stalks forked out of one root, a metre tall, which
 * the planting scales and tints like any tree. It is built rather than loaded.
 * The model it replaced (tree-fantasy) was 7,596 triangles a bush, a million
 * across the belt, for something knee-high in the dark; this is 120.
 *
 * Each stalk and fork is a three-sided spike, and the shape comes from its own
 * seed, so it is the same every build and leaves the belt's stream alone.
 */
function makeScrubGeometry() {
  const rand = makeRandom(0x5c7b);
  const positions = [];

  /** A three-sided spike from `base`, `radius` thick, tapering in `segments`
   *  lengths to a point at `tip`. Wound so its faces point out. */
  const spike = (base, tip, radius, segments) => {
    const axis = new THREE.Vector3().subVectors(tip, base);
    const dir = axis.clone().normalize();
    const u = new THREE.Vector3(0, 1, 0);
    if (Math.abs(dir.y) > 0.9) u.set(1, 0, 0);
    u.cross(dir).normalize();
    const v = new THREE.Vector3().crossVectors(dir, u);

    const rings = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const centre = base.clone().addScaledVector(axis, t);
      rings.push([0, 1, 2].map(k => {
        const a = (k / 3) * Math.PI * 2;
        return centre.clone()
          .addScaledVector(u, Math.cos(a) * radius * (1 - t))
          .addScaledVector(v, Math.sin(a) * radius * (1 - t));
      }));
    }

    const push = (...points) => { for (const p of points) positions.push(p.x, p.y, p.z); };
    for (let i = 0; i < segments; i++) {
      for (let k = 0; k < 3; k++) {
        const a = rings[i][k];
        const b = rings[i][(k + 1) % 3];
        const c = rings[i + 1][(k + 1) % 3];
        const d = rings[i + 1][k];
        // The top ring is a single point, so the last length is triangles.
        if (i === segments - 1) push(a, b, c);
        else push(a, b, c, a, c, d);
      }
    }
  };

  const stalks = 8;
  const thickness = 0.028;
  for (let s = 0; s < stalks; s++) {
    // The first stands up the middle; the rest splay out round it.
    const yaw = (s + rand() * 0.6) * (Math.PI * 2 / stalks);
    const lean = s === 0 ? 0.08 : randRange(rand, 0.25, 0.75);
    const length = s === 0 ? 1 : randRange(rand, 0.55, 0.95);
    const direction = new THREE.Vector3(
      Math.sin(lean) * Math.cos(yaw), Math.cos(lean), Math.sin(lean) * Math.sin(yaw));
    const base = new THREE.Vector3(Math.cos(yaw) * 0.03, 0, Math.sin(yaw) * 0.03);
    const tip = base.clone().addScaledVector(direction, length);
    spike(base, tip, thickness, 2);

    // Two forks off each, bent further out than the stalk they grow from.
    for (let f = 0; f < 2; f++) {
      const t = randRange(rand, 0.3, 0.7);
      const from = base.clone().lerp(tip, t);
      const turn = yaw + randRange(rand, -1.2, 1.2);
      const bend = Math.min(1.35, lean + randRange(rand, 0.35, 0.8));
      const twig = new THREE.Vector3(
        Math.sin(bend) * Math.cos(turn), Math.cos(bend), Math.sin(bend) * Math.sin(turn));
      spike(from, from.clone().addScaledVector(twig, length * randRange(rand, 0.25, 0.45)),
        thickness * (1 - t) * 0.7, 1);
    }
  }

  // Stood on the ground and scaled to exactly a metre, so a plant's height is
  // its scale. The leaning stalks' bottom rings tip a little below their
  // bases, so the lowest point is lifted to zero first.
  let bottom = Infinity;
  let top = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    bottom = Math.min(bottom, positions[i]);
    top = Math.max(top, positions[i]);
  }
  for (let i = 1; i < positions.length; i += 3) positions[i] -= bottom;
  for (let i = 0; i < positions.length; i++) positions[i] /= top - bottom;

  // Dark at the root and pale at the tips; the instance colour tints it.
  const colors = [];
  for (let i = 1; i < positions.length; i += 3) {
    const shade = 0.45 + 0.55 * positions[i];
    colors.push(shade, shade, shade);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Ground normal by finite differences. No seed is passed: the height
 *  function owns the valley's seed. */
function groundNormal(x, z, heightAt) {
  const step = 1.2;
  const dx = heightAt(x + step, z) - heightAt(x - step, z);
  const dz = heightAt(x, z + step) - heightAt(x, z - step);
  return new THREE.Vector3(-dx, 2 * step, -dz).normalize();
}
