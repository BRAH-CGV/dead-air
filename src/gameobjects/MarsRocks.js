import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { makeNoise2D, fbm } from '../core/Noise.js';
import { makeRandom, randRange, randPower, randPick } from '../core/Random.js';
import { TERRAIN, terrainHeightAt } from './MarsTerrain.js';
import { makeYard, yardDistance, makeYardRadiusLookup } from './BaseYard.js';

// ─────────────────────────────────────────────
// MarsRocks  –  the rock field scattered across the valley
// ─────────────────────────────────────────────
// Rocks are generated, not modelled: a few noise-lumped shapes drawn thousands
// of times with their own size, tilt and dust tint. That costs no download on a
// build already preloading 113 MB of models, and it matches a valley that is
// itself procedural and vertex-coloured.
//
//   this._outside.addChild(createMarsRocks({ keepClear: [...] }));
//
// ── Why instanced, and not spawnModel ──
// spawnModel builds a GameObject per node and the engine walks every one of
// them three times a frame, it can only rotate around Y (so nothing could lean
// with the slope), and hundreds of them would bury the level editor's outliner.
// Instead each shape is one InstancedMesh hung straight on this group's
// Object3D. The editor only walks GameObject children, so — exactly as with the
// terrain and the sky dome — it never sees these, and the frame loop never
// touches them.
//
// ── Keeping clear of the base ──
// Nothing is placed inside the yard — the cleared ground shaped to the
// building's own footprint, see BaseYard. `yardMargin` is the one number to
// widen if the base grows again. It is also why no rock casts a shadow: the
// moonlight's shadow camera only covers ±12 m of the office, well inside the
// empty middle.
// ─────────────────────────────────────────────

export const ROCK_FIELD = {
  seed: 20260920,
  /** Metres of clear ground off every wall of the base — see BaseYard, which
   *  shapes the yard to the building rather than to a circle. Wider than the
   *  vegetation's ten: someone living here would get stone off the ground they
   *  walk and park on long before they stopped planting in it. */
  yardMargin: 14,
  /** Rocks stop just past the ridge line, where the ground falls out of view.
   *  Tied to the terrain's own crest so the two move together. */
  outerRadius: TERRAIN.CREST_RADIUS + 30,
  /** Rocks attempted. About a quarter are rejected by the clumping field and
   *  the keep-clear circles, so the field ends up smaller than this. */
  count: 5200,
  /** Distinct shapes. Each is one draw call per size band. */
  variants: 6,
  /** Landmark piles of big rock, and how many boulders each drops. */
  formations: 14,
  formationRocks: [4, 9],
};

/** Size bands. Splitting by size keeps each InstancedMesh's bounding sphere
 *  meaningful and lets the small stuff thin out with distance on its own. */
const BANDS = [
  { name: 'Gravel',   size: [0.12, 0.45], power: 2.2, share: 0.50, maxRadius: 260 },
  { name: 'Cobble',   size: [0.45, 1.30], power: 2.0, share: 0.35, maxRadius: 430 },
  { name: 'Boulder',  size: [1.30, 4.00], power: 2.6, share: 0.15, maxRadius: 430 },
];

/** Dust tints, near the terrain's own palette so rocks read as the same stone
 *  the ground is made of. Rocks skew toward its paler, drier end. */
const TINTS = [0x8a4326, 0xa8613c, 0x7a3b23, 0x9c5836, 0xb0714a];

/**
 * Build the rock field.
 *
 * @param {Object} [opts]
 * @param {number} [opts.seed]
 * @param {number} [opts.yardMargin]   metres of clear ground off every wall
 * @param {number} [opts.count]        scattered rocks, before formations
 * @param {{halfX: number, halfZ: number}} [opts.footprint]
 *        the base's outer half extents — BaseScene should pass its live bounds
 * @param {Array<{x: number, z: number, radius: number}>} [opts.keepClear]
 *        extra circles to leave empty — the satellite, a landing pad, and so on
 * @param {(x: number, z: number) => number} [opts.heightAt]
 *        ground height; pass the crater-aware one so rocks sit in the craters
 * @returns {GameObject} a group carrying one InstancedMesh per shape and band
 */
export function createMarsRocks(opts = {}) {
  const {
    seed        = ROCK_FIELD.seed,
    yardMargin  = ROCK_FIELD.yardMargin,
    count       = ROCK_FIELD.count,
    footprint,
    keepClear   = [],
    heightAt    = terrainHeightAt,
  } = opts;

  const rand  = makeRandom(seed);
  const noise = makeNoise2D(seed ^ 0x5f3a);

  const rocks = new GameObject('MarsRocks');
  // A group for the same reason the terrain is one: the editor measures a
  // bounding box for every non-group object, and this one spans the valley.
  rocks.makeGroup();

  const shapes = [];
  for (let i = 0; i < ROCK_FIELD.variants; i++) shapes.push(makeRockGeometry(rand));

  // Collected per shape and band, then flushed into one InstancedMesh each —
  // the instance count has to be known up front.
  const buckets = BANDS.map(() => shapes.map(() => []));
  const zones  = makeYard({ margin: yardMargin, footprint, extra: keepClear });
  const yardAt = makeYardRadiusLookup(zones, ROCK_FIELD.outerRadius);

  scatterRocks({ rand, noise, count, zones, yardAt, heightAt, buckets, shapes });
  scatterFormations({ rand, noise, zones, yardAt, heightAt, buckets, shapes });

  const matrix = new THREE.Matrix4();
  const tint   = new THREE.Color();

  for (let b = 0; b < BANDS.length; b++) {
    for (let s = 0; s < shapes.length; s++) {
      const placements = buckets[b][s];
      if (placements.length === 0) continue;

      const mesh = new THREE.InstancedMesh(
        shapes[s],
        new THREE.MeshLambertMaterial({ color: 0xffffff }),
        placements.length,
      );
      mesh.name = `MarsRocks_${BANDS[b].name}_${s}`;
      // Nothing out here is inside the moonlight's shadow camera, so casting is
      // pure cost. Receiving still matters for anything that lands near it.
      mesh.castShadow = false;
      mesh.receiveShadow = true;

      placements.forEach((p, i) => {
        matrix.compose(p.position, p.quaternion, p.scale);
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, tint.setHex(p.tint).multiplyScalar(p.shade));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      rocks.object3d.add(mesh);
    }
  }

  return rocks;
}

/** One lumpy rock. Displacement depends only on the vertex direction, so the
 *  icosahedron's duplicated edge vertices all move together and the surface
 *  stays closed. The geometry is non-indexed, which leaves the normals faceted
 *  — the chipped look that suits stone. */
function makeRockGeometry(rand) {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const position = geometry.getAttribute('position');

  // A few broad lobes rather than fine noise: from more than a few metres away
  // only the silhouette reads, and lobes are what bend a silhouette.
  const lobes = [];
  for (let i = 0; i < 3; i++) {
    lobes.push({
      axis:  new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize(),
      freq:  randRange(rand, 1.5, 4.0),
      amp:   randRange(rand, 0.12, 0.30),
      phase: rand() * Math.PI * 2,
    });
  }

  const squash = randRange(rand, 0.55, 0.9);
  const v = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).normalize();

    let radius = 1;
    for (const lobe of lobes) {
      radius += lobe.amp * Math.sin(v.dot(lobe.axis) * lobe.freq * Math.PI + lobe.phase);
    }

    v.multiplyScalar(radius);
    v.y *= squash;
    // Compress the underside. A rock is part buried, and a flattish base lets
    // the silhouette meet the ground instead of balancing on a curve.
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.15;

    position.setXYZ(i, v.x, v.y, v.z);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** The general scatter: rocks everywhere, clumped by a noise field so the
 *  ground has drifts and bare patches instead of an even sprinkle. */
function scatterRocks({ rand, noise, count, zones, yardAt, heightAt, buckets, shapes }) {
  const { outerRadius } = ROCK_FIELD;

  for (let i = 0; i < count; i++) {
    // The bearing first, since the yard's edge depends on it — the field
    // starts further out along the wings than off the back wall.
    const angle = rand() * Math.PI * 2;
    const inner = yardAt(angle);

    // Spreading rocks evenly by AREA (radius ∝ √u) would be the physical
    // default, but it buries most of the field out past 300 m where it is a
    // few pixels tall. An exponent just under 1 thins with distance instead,
    // so the ground you actually walk on carries the detail.
    const radius = inner + (outerRadius - inner) * Math.pow(rand(), 0.85);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    if (yardDistance(x, z, zones) < 0) continue;

    // Clumping, so the ground has drifts and bare patches instead of an even
    // sprinkle. Two things here are easy to get wrong and both read as "one
    // side of the map is empty":
    //
    // The frequency has to give features much smaller than the valley. At
    // 0.012 the whole 860 m field spanned about 10 noise cells, so its lowest
    // octave WAS the map — a single blob covering half of it.
    //
    // And the density swing has to be modest. Taking the field as the
    // probability outright varied density about fourfold between regions;
    // compressed to roughly ±40% it reads as drifts rather than as a bias.
    const clump = fbm(noise, x * 0.03, z * 0.03, { octaves: 4 }) * 0.5 + 0.5;
    if (rand() > 0.6 + 0.8 * clump) continue;

    const band = pickBand(rand, radius);
    if (band < 0) continue;

    place({ x, z, band, rand, heightAt, buckets, shapes });
  }
}

/** Landmarks: a handful of piles of big rock, the silhouettes you notice from
 *  the window. Same shapes as everything else, just larger and stacked. */
function scatterFormations({ rand, noise, zones, yardAt, heightAt, buckets, shapes }) {
  const { formations, formationRocks, outerRadius } = ROCK_FIELD;
  const [minRocks, maxRocks] = formationRocks;

  for (let i = 0; i < formations; i++) {
    // Kept well off the near ground so they read as distant landmarks rather
    // than as something dumped outside the window.
    const angle  = rand() * Math.PI * 2;
    const radius = randRange(rand, yardAt(angle) + 45, outerRadius * 0.85);
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;

    if (yardDistance(cx, cz, zones) < 0) continue;

    const spread = randRange(rand, 3, 9);
    const pile   = Math.floor(randRange(rand, minRocks, maxRocks + 1));

    for (let j = 0; j < pile; j++) {
      const t  = j / pile;
      const dx = randRange(rand, -spread, spread);
      const dz = randRange(rand, -spread, spread);
      // Later rocks are smaller and ride higher, so the pile tapers rather
      // than reading as boulders dropped in a ring.
      const size = randRange(rand, 2.2, 6.5) * (1 - t * 0.55);
      const lift = t * size * 0.5;

      place({
        x: cx + dx, z: cz + dz, band: 2, size, lift,
        rand, heightAt, buckets, shapes,
      });
    }
  }
}

/** Work out one rock's transform and file it under its shape and band. */
function place({ x, z, band, rand, heightAt, buckets, shapes, size, lift = 0 }) {
  const spec  = BANDS[band];
  const scale = size ?? randPower(rand, spec.size[0], spec.size[1], spec.power);

  const normal = terrainNormal(x, z, heightAt);
  const quaternion = new THREE.Quaternion()
    // Sit the rock on the slope rather than bolt upright, then spin it so
    // repeated shapes don't line up.
    .setFromUnitVectors(UP, normal)
    .multiply(new THREE.Quaternion().setFromAxisAngle(UP, rand() * Math.PI * 2))
    // A little lean, since a rock that settled is never level.
    .multiply(new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(rand() * 2 - 1, 0, rand() * 2 - 1).normalize(),
      randRange(rand, -0.22, 0.22),
    ));

  // Sink it. The mesh only agrees with heightAt at the corners of its 4 m
  // cell, so a rock sitting exactly on the sampled height can hang in the air
  // mid-cell. Burying the base hides that, and buried is how rocks sit anyway.
  const sink = scale * randRange(rand, 0.18, 0.34);
  const y = heightAt(x, z) - sink + lift;

  const shape = Math.min(shapes.length - 1, Math.floor(rand() * shapes.length));
  buckets[band][shape].push({
    position: new THREE.Vector3(x, y, z),
    quaternion,
    scale: new THREE.Vector3(scale, scale * randRange(rand, 0.75, 1.0), scale),
    tint: randPick(rand, TINTS),
    shade: randRange(rand, 0.75, 1.15),
  });
}

const UP = new THREE.Vector3(0, 1, 0);

/** Ground normal from finite differences. Cheaper and smoother than reading
 *  the mesh's own normals, and it works for any height function.
 *
 *  Note it passes no seed: the height function owns the valley's seed, and
 *  handing it the rock field's would place rocks on a different landscape. */
function terrainNormal(x, z, heightAt) {
  const step = 1.5;
  const dx = heightAt(x + step, z) - heightAt(x - step, z);
  const dz = heightAt(x, z + step) - heightAt(x, z - step);
  return new THREE.Vector3(-dx, 2 * step, -dz).normalize();
}

/** Choose a size band, respecting how far out each one bothers to appear. */
function pickBand(rand, radius) {
  let roll = rand();
  for (let i = 0; i < BANDS.length; i++) {
    roll -= BANDS[i].share;
    if (roll <= 0) return radius <= BANDS[i].maxRadius ? i : -1;
  }
  return BANDS.length - 1;
}

