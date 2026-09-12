import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from '../core/GameObject.js';
import { makeNoise2D, fbm, ridgedFbm } from '../core/Noise.js';

// ─────────────────────────────────────────────
// MarsTerrain  –  the valley the office sits in
// ─────────────────────────────────────────────
// A square kilometre of ground: dead flat under the office, rising through
// worked red basin soil into a ring of Mars-red ridges that closes the horizon in
// every direction, then falling away behind them. Nothing here loads a file —
// the whole valley falls out of a seeded noise field, so every dimension is a
// tunable rather than a mesh that has to be re-authored.
//
//   const terrain = createMarsTerrain(engine.world);
//   outside.addChild(terrain);
//
// ── Why a ridge, and why the edge stays hidden ──
// What has to be true is that the mesh boundary is never VISIBLE from the
// basin — and visibility is about angle, not height. A point is hidden when
// something nearer subtends a greater elevation angle from the eye.
//
// That is a much weaker condition than "the ground never stops rising", and
// the difference is the whole look of the place. Force the ground to keep
// climbing to the boundary and the tallest thing in every direction is the
// same smooth outer ramp, so the horizon comes out as a dead-level circle at
// 7.4° the whole way round — a wall, not a landscape.
//
// So instead the ground climbs to a ridge at CREST_RADIUS and then falls away
// behind it. The boundary is lower AND further, and it is hidden for both
// reasons at once. Dropping FALL_HEIGHT over the tail makes this automatic:
// for a crest height h at CREST_RADIUS, the boundary subtends
// (h − FALL_HEIGHT)/(SIZE/2) which is less than h/CREST_RADIUS for any
// positive drop. Nothing is balanced on a knife edge, and the crest is now
// free to vary — it runs between about 4° and 9°, which is a skyline.
//
// There is a test for this, and it checks the angle from several points
// around the pad, not just the origin.
//
// ── Why the ridge is so low ──
// Relief is budgeted in DEGREES, not metres, because the job is to ring the
// office without eating the sky. The office window spans −13°..+14°
// vertically and the moons hang at 12° and 16° elevation, so the skyline is
// shaped to top out under 9° from eye height — currently 8.8°, which leaves
// better than 3° of clear sky under Phobos.
//
// That is why HILL_AMPLITUDE is scaled by the radial profile rather than
// applied flat: a 30 m hill at 400 m is scenery, but the same hill at 80 m
// would be a wall across the window. There is a test for this too, and it is
// the one to watch during any tuning pass.
// ─────────────────────────────────────────────

/** Square mesh, metres. Its corners land at r ≈ 724 m, inside the camera's
 *  1000 m far plane. */
const SIZE = 1024;

/** 257 × 257 vertices — 4 m cells. Fine enough to walk a slope without
 *  stair-stepping, coarse enough that the whole valley is one cheap draw. */
const SEGMENTS = 256;

/** Radius of the flat building pad, metres. Exactly y = 0 inside it, so the
 *  office walls, furniture and colliders all keep their existing baseline.
 *  Comfortably clears the crates at z ≈ −7.8 and the satellite at z = −25. */
const FLAT_RADIUS = 40;

/** Radius of the ridge line that closes the horizon. */
const CREST_RADIUS = 400;

/** Height of the base slope where it meets the crest, metres. */
const CREST_HEIGHT = 30;

/** Ridged relief stacked on the base slope, metres at full profile. This is
 *  what varies the skyline, so it is deliberately as large as the base. */
const HILL_AMPLITUDE = 30;

/** How far the ground falls away behind the crest, out to the boundary. Any
 *  positive drop hides the edge — see the note above — but a real one also
 *  keeps the far side from reading as a plateau. */
const FALL_HEIGHT = 20;

/** Ridges thin out down the back slope without vanishing: the far side is
 *  mostly hidden, but the bits that show through gaps should still be hills. */
const TAPER_FLOOR = 0.5;

/** Gentle undulation so the mid slope is not a cone. */
const MICRO_AMPLITUDE = 0.6;

/** Feature sizes, as noise-space frequencies (1 / metres). */
const HILL_FREQUENCY   = 0.009;   // ~110 m ridgelines
const MICRO_FREQUENCY  = 0.02;    // ~50 m swells
const BORDER_FREQUENCY = 0.005;   // wobble on the terraform boundary
const GRAIN_FREQUENCY  = 0.045;   // ~22 m clumps, for normal and albedo grain

/** How far the baked normals are tilted off the true surface, roughly in
 *  radians at this magnitude. This has to stay WELL under sin(12°) ≈ 0.208,
 *  the moon's elevation: the light rakes so low that a tilt approaching that
 *  drives NdotL to zero over whole patches and stamps hard black blotches
 *  across the valley. 0.16 did exactly that. At 0.06 the same grain reads as
 *  a gentle ±25% variation in the falloff — texture, not damage. */
const GRAIN_TILT = 0.06;

/** Albedo variation from the same grain, as a fraction. Dirt is never one
 *  flat tone under a raking light, and the eye reads the variation as texture
 *  long before it reads it as noise. */
const GRAIN_VALUE = 0.09;

/** The valley is generated, not authored, so it must be the same valley on
 *  every reload. Change this to roll a different landscape. */
const DEFAULT_SEED = 20260912;

/** Exported so scenes and tests can reason about the valley without copying
 *  its numbers — see OfficeScene, which places nothing outside FLAT_RADIUS. */
export const TERRAIN = {
  SIZE, SEGMENTS, FLAT_RADIUS, CREST_RADIUS, CREST_HEIGHT,
  HILL_AMPLITUDE, FALL_HEIGHT, TAPER_FLOOR, DEFAULT_SEED,
};

// ── Palette ──
// Red the whole way out — this has to read as Mars at a glance, not as a park
// someone dropped on it. The terraforming shows only as VALUE: the worked,
// watered basin is a deeper, damper oxide, and the ground brightens and dusts
// over as it climbs away from it. One hue, four steps of brightness.
//
// Whatever grows here later is red too, so the basin swatches are the ground
// those plants sit in rather than the plants themselves.
const BASIN      = 0x67301f;   // damp worked oxide — the terraformed floor
const DAMP       = 0x5c3230;   // slightly cooler, pooled into the hollows
const MIDSLOPE   = 0x7a3b23;   // drying out as the ground rises
const HILL       = 0x8a4326;   // Mars red
const ROCK       = 0xa8613c;   // pale dust on steep faces and crests

/** Noise fields are cached per seed: terrainHeightAt is called ~130 000 times
 *  per build, and rebuilding the hash closure on each call would dominate. */
const _noiseCache = new Map();

function noiseFor(seed) {
  let n = _noiseCache.get(seed);
  if (!n) {
    n = makeNoise2D(seed);
    _noiseCache.set(seed, n);
  }
  return n;
}

/** GLSL's smoothstep — 0 below `edge0`, 1 above `edge1`, with zero slope at
 *  both ends. The flat ends are what let the pad meet the slope without a
 *  visible crease. */
function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Ground height at a world position, in metres. Pure and cheap — other systems
 * should use this to sit things on the terrain rather than raycasting.
 *
 * @param {number} x
 * @param {number} z
 * @param {Object} [opts]
 * @param {number} [opts.seed]
 * @returns {number} height in metres; exactly 0 inside FLAT_RADIUS
 */
export function terrainHeightAt(x, z, opts = {}) {
  const { seed = DEFAULT_SEED } = opts;
  const n = noiseFor(seed);
  const r = Math.hypot(x, z);

  // The radial profile. Doubles as the amplitude envelope for the ridges,
  // which is what keeps near hills small and therefore angularly harmless —
  // a 20 m hill at 400 m is scenery, the same hill at 80 m is a wall.
  const profile = smoothstep(FLAT_RADIUS, CREST_RADIUS, r);

  // The back slope. t² so it leaves the crest flat and steepens on the way
  // down, which reads as a ridge rather than a dome.
  const t     = Math.min(1, Math.max(0, (r - CREST_RADIUS) / (SIZE / 2 - CREST_RADIUS)));
  const tail  = t * t;
  const taper = 1 - (1 - TAPER_FLOOR) * tail;

  const base  = CREST_HEIGHT * profile;
  const fall  = FALL_HEIGHT * tail;
  const hills = ridgedFbm(n, x * HILL_FREQUENCY, z * HILL_FREQUENCY)
    * HILL_AMPLITUDE * profile * taper;
  const micro = fbm(n, x * MICRO_FREQUENCY, z * MICRO_FREQUENCY, { octaves: 3 })
    * MICRO_AMPLITUDE * profile * taper;

  return base + hills + micro - fall;
}

/**
 * Pick the ground colour for one vertex.
 *
 * @param {number} r        distance from the centre
 * @param {number} slope    1 for flat ground, 0 for a vertical face
 * @param {number} wobble   noise in [-1, 1], breaks up the zone boundaries
 * @param {number} mottle   noise in [-1, 1], pools the damp tone into hollows
 * @param {number} grain    noise in [-1, 1], fine variation in value
 * @param {THREE.Color} out
 */
function groundColor(r, slope, wobble, mottle, grain, out) {
  // Perturb the radius the zones are measured against, so the edge of the
  // worked ground is a ragged front rather than a drawn circle. It matters
  // more now than it did with a colour change to hide behind: a soft tonal
  // gradient on a perfect circle reads as a vignette — a drop shadow under the
  // office — rather than as ground. The amplitude is deliberately large enough
  // that the front is lobed, not merely wavy.
  const rz = r + wobble * 80;

  // Basin floor, with the damper tone pooling wherever the ground dips.
  out.copy(_BASIN).lerp(_DAMP, smoothstep(-0.2, 0.6, mottle) * 0.55);

  // Wide, overlapping bands. A short ramp puts a visible ring on the ground.
  out.lerp(_MIDSLOPE, smoothstep(70, 230, rz));
  out.lerp(_HILL, smoothstep(200, 340, rz));

  // Wind strips the dust off anything steep, and off the crests.
  const exposure = Math.max(
    smoothstep(0.88, 0.62, slope),
    smoothstep(CREST_RADIUS * 0.8, SIZE / 2, r) * 0.45,
  );
  out.lerp(_ROCK, exposure * 0.7);

  // Finally, vary the value so no two neighbouring patches are the same tone.
  const v = 1 + grain * GRAIN_VALUE;
  out.setRGB(out.r * v, out.g * v, out.b * v);
}

// Swatches are built once. `new THREE.Color(hex)` converts sRGB → linear,
// which matters: vertex-colour buffers are read as linear and are NOT colour
// managed by Three, so feeding raw sRGB bytes washes the whole valley out.
const _BASIN      = new THREE.Color(BASIN);
const _DAMP       = new THREE.Color(DAMP);
const _MIDSLOPE   = new THREE.Color(MIDSLOPE);
const _HILL       = new THREE.Color(HILL);
const _ROCK       = new THREE.Color(ROCK);

/**
 * Build the valley: one displaced, vertex-coloured mesh and one Rapier
 * heightfield collider.
 *
 * @param {RAPIER.World} world
 * @param {Object} [opts]
 * @param {number} [opts.seed]
 * @returns {GameObject} a group carrying the mesh, with collider refs attached
 */
export function createMarsTerrain(world, opts = {}) {
  const { seed = DEFAULT_SEED } = opts;
  const n = noiseFor(seed);

  const terrain = new GameObject('MarsTerrain');
  // Marked a group for the same reason MarsSky is: the level editor measures a
  // bounding box for every non-group object, and a 1 km box round-trips
  // through save/load as a giant grey placeholder.
  terrain.makeGroup();

  // ── Geometry ──
  const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
  // Bake the rotation into the attribute BEFORE displacing. The positions are
  // then already world-aligned, so the loop below reads real x/z and writes
  // real height — no plane-local to world axis mapping to get backwards.
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    position.setY(i, terrainHeightAt(position.getX(i), position.getZ(i), { seed }));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();

  // ── Break up the normals ──
  // A 4 m grid gives a surface smooth enough that the moonlight lands on it as
  // one clean gradient, which reads as polished stone. Tilting each normal by a
  // few degrees of noise scatters the falloff into patches the size of dirt
  // clumps. It costs nothing at runtime — the normals are baked here, once.
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < normal.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const nx = normal.getX(i) + n(x * GRAIN_FREQUENCY, z * GRAIN_FREQUENCY) * GRAIN_TILT;
    const ny = normal.getY(i);
    const nz = normal.getZ(i) + n(x * GRAIN_FREQUENCY + 71.3, z * GRAIN_FREQUENCY - 24.7) * GRAIN_TILT;
    const len = Math.hypot(nx, ny, nz);
    normal.setXYZ(i, nx / len, ny / len, nz / len);
  }
  normal.needsUpdate = true;

  // ── Vertex colours ──
  const colors = new Float32Array(position.count * 3);
  const scratch = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    groundColor(
      Math.hypot(x, z),
      normal.getY(i),
      n(x * BORDER_FREQUENCY, z * BORDER_FREQUENCY),
      fbm(n, x * MICRO_FREQUENCY, z * MICRO_FREQUENCY, { octaves: 3 }),
      fbm(n, x * GRAIN_FREQUENCY, z * GRAIN_FREQUENCY, { octaves: 2 }),
      scratch,
    );
    colors[i * 3]     = scratch.r;
    colors[i * 3 + 1] = scratch.g;
    colors[i * 3 + 2] = scratch.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Lambert, not Standard, and this is the fix for the white sheen rather than
  // a saving. Phobos sits 12° above the horizon straight out the window, so the
  // office looks TOWARD the light across a near-flat plain — backlit, with the
  // view almost along the ground. In that geometry Schlick's Fresnel climbs to
  // ~0.52 even at roughness 0.96, and Standard lays a pure white specular over
  // the ground worth 91% of its blue channel: the red washes out to grey
  // exactly where the player is looking. Lambert has no specular term at all,
  // which is also what dirt actually looks like — and it is cheaper to shade,
  // so this costs nothing.
  //
  // If a hint of sheen is ever wanted, MeshPhongMaterial with a dark specular
  // is the knob; do not go back to Standard without re-checking this angle.
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  mesh.name = 'MarsTerrainMesh';
  mesh.receiveShadow = true;
  // Not castShadow: the moon's shadow camera is a ±12 m box around the office,
  // so a 1 km caster would only blow the shadow map's budget for nothing.
  terrain.object3d.add(mesh);

  // ── Collider ──
  // Sampled from the same pure terrainHeightAt as the mesh, so the surface the
  // player stands on is the surface they see — no floating, no sinking.
  //
  // Two things about this array are easy to get wrong and neither announces
  // itself, so they are spelled out:
  //
  //  1. nrows/ncols are SUBDIVISIONS, not vertex counts — Rapier reads a
  //     (nrows+1) x (ncols+1) matrix. Pass SEGMENTS+1 and the WASM traps on an
  //     unreachable instead of saying the array is the wrong length.
  //  2. Rows are indexed by Z and columns by X — the transpose of what the
  //     names suggest. Storage is column-major, so the value for a point is at
  //     heights[colFromX * (nrows+1) + rowFromZ]. Get this backwards and the
  //     terrain still loads, still looks right, and the ground you walk on is
  //     silently the map mirrored about its diagonal.
  const points  = SEGMENTS + 1;
  const heights = new Float32Array(points * points);
  for (let col = 0; col < points; col++) {
    const x = (col / (points - 1) - 0.5) * SIZE;
    for (let row = 0; row < points; row++) {
      const z = (row / (points - 1) - 0.5) * SIZE;
      heights[col * points + row] = terrainHeightAt(x, z, { seed });
    }
  }

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0),
  );
  // Scale is the heightfield's full extent on x/z; y is 1 because the values
  // above are already in metres.
  const collider = world.createCollider(
    RAPIER.ColliderDesc.heightfield(SEGMENTS, SEGMENTS, heights, { x: SIZE, y: 1, z: SIZE }),
    body,
  );

  // Same contract the old flat ground had: scene teardown and the level
  // editor's collider sync both reach for these fields by name.
  terrain.rigidBody = body;
  terrain.colliders = [collider];
  terrain.collider  = collider;
  terrain._originalSize = [SIZE, 1, SIZE];

  return terrain;
}
