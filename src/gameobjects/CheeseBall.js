import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRandom, randRange } from '../core/Random.js';

// ─────────────────────────────────────────────
// CheeseBall  –  what the desk globe turns into when it is spun too hard (#169)
// ─────────────────────────────────────────────
// A ball of cheese the globe's size, built here: an icosphere with round
// holes sunk into it, as a Swiss cheese's bubbles are where it was cut,
// coloured by vertex (pale yellow rind, darker and warmer down in the
// holes). A little toon: MeshToonMaterial over a ramp that is plain Lambert
// in five steps (dark where the light doesn't reach, as the room is), and
// a thin dark outline (the surface pushed out along its normals and drawn
// back faces only), so it reads as a cartoon prop without leaving the room's
// look behind.
//
//   const ball = createCheeseBall({ radius: 0.143 });
//   globe.object3d.add(ball);              // spins with the globe
//   ball.dispose();                        // frees what it built
//
// The origin is the ball's middle. Holes are seeded, so it is the same
// cheese every time. It takes no fog (it lives indoors) and casts a shadow;
// the outline doesn't.
// ─────────────────────────────────────────────

/** The cheese's numbers. Hole sizes are shares of the ball's radius. */
export const CHEESE = Object.freeze({
  holes: 22,
  /** A hole's radius on the surface, as a share of the ball's. */
  holeRadius: [0.12, 0.32],
  /** How deep a hole is, as a share of its own radius. */
  depth: 0.75,
  /** Holes no nearer each other than this share of their two radii. */
  spacing: 0.8,
  /** Icosphere subdivisions: each face cut into (detail + 1)² triangles,
   *  so 40 is 33 620 — enough that the smallest hole's rim is a smooth ring. */
  detail: 40,
  /** The rind's slight lumpiness, a share of the radius, only ever inward. */
  lumps: 0.008,
  rind: 0xd9a838,
  hole: 0x9a6210,
  outline: 0x5a3810,
  /** The outline's width, a share of the radius. */
  outlineWidth: 0.012,
  /** Steps of light on the lit side: few enough to band a little. */
  bands: 5,
  seed: 169,
});

/**
 * Where the holes go: `{ dir: [x, y, z] (unit), radius }`, radius a share of
 * the ball's. Bigger holes are placed first, and a hole that would sit
 * almost on top of another is tried again elsewhere.
 * @param {number} [seed]
 */
export function cheeseHoles(seed = CHEESE.seed) {
  const rand = makeRandom(seed);
  const [lo, hi] = CHEESE.holeRadius;
  const sizes = Array.from({ length: CHEESE.holes }, () => randRange(rand, lo, hi)).sort((a, b) => b - a);
  const holes = [];
  for (const radius of sizes) {
    let dir;
    for (let tries = 0; tries < 30; tries++) {
      // A uniform point on the sphere.
      const z = randRange(rand, -1, 1), a = randRange(rand, 0, Math.PI * 2), s = Math.sqrt(1 - z * z);
      dir = [s * Math.cos(a), s * Math.sin(a), z];
      const clear = holes.every((h) => chord(h.dir, dir) > (h.radius + radius) * CHEESE.spacing);
      if (clear) break;
    }
    holes.push({ dir, radius });
  }
  return holes;
}

function chord(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Build the ball. A THREE.Group named `CheeseBall`, with `cheese` and
 * `outline` meshes and a `dispose()`.
 * @param {object} [opts]
 * @param {number} [opts.radius=0.143]  Metres: the globe's.
 * @param {number} [opts.seed]
 */
export function createCheeseBall({ radius = 0.143, seed = CHEESE.seed } = {}) {
  const geometry = cheeseGeometry(radius, cheeseHoles(seed));

  const gradientMap = new THREE.DataTexture(toonRamp(CHEESE.bands), CHEESE.bands * 2, 1, THREE.RedFormat);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;

  const cheese = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({
    vertexColors: true, gradientMap, fog: false,
  }));
  cheese.name = 'Cheese';
  cheese.castShadow = true;
  cheese.receiveShadow = true;

  const outline = new THREE.Mesh(outlineGeometry(geometry, radius * CHEESE.outlineWidth), new THREE.MeshBasicMaterial({
    color: CHEESE.outline, side: THREE.BackSide, fog: false,
  }));
  outline.name = 'CheeseOutline';
  outline.castShadow = false;
  outline.receiveShadow = false;

  const ball = new THREE.Group();
  ball.name = 'CheeseBall';
  ball.add(cheese, outline);
  ball.cheese = cheese;
  ball.outline = outline;
  ball.dispose = () => {
    for (const mesh of [cheese, outline]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    gradientMap.dispose();
  };
  return ball;
}

/**
 * The toon ramp, looked up at dotNL * 0.5 + 0.5: nothing on the half facing
 * away (the default ramp lights that too, which made the cheese glow from
 * every side), and on the lit half Lambert's dotNL at the middle of each of
 * `bands` steps — the same light on average as the room's own materials.
 */
function toonRamp(bands) {
  const n = bands * 2;
  const ramp = new Uint8Array(n);
  for (let i = bands; i < n; i++) ramp[i] = Math.round((((i + 0.5) / n) * 2 - 1) * 255);
  return ramp;
}

/** The icosphere with its holes sunk in and its colours laid on. */
function cheeseGeometry(radius, holes) {
  let g = new THREE.IcosahedronGeometry(1, CHEESE.detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);

  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const rind = new THREE.Color(CHEESE.rind), hole = new THREE.Color(CHEESE.hole), c = new THREE.Color();
  const n = new THREE.Vector3();
  const deepest = CHEESE.holeRadius[1] * CHEESE.depth * 0.5;
  // Half an edge of the icosphere, as a chord on the unit ball.
  const snap = 0.5 * 1.1071 / (CHEESE.detail + 1);
  const dirs = holes.map((h) => new THREE.Vector3(...h.dir));
  const t = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).normalize();

    // A point within half an edge of a rim is moved onto it, so each rim is
    // a ring of vertices on the circle rather than a zigzag through them.
    let near = null, gap = snap;
    for (let k = 0; k < holes.length; k++) {
      const off = Math.abs(n.distanceTo(dirs[k]) - holes[k].radius);
      if (off < gap) { gap = off; near = k; }
    }
    if (near !== null) {
      const dir = dirs[near];
      const angle = 2 * Math.asin(holes[near].radius / 2);      // chord → angle
      t.copy(n).addScaledVector(dir, -n.dot(dir));
      if (t.lengthSq() > 1e-12) {
        t.normalize();
        n.copy(dir).multiplyScalar(Math.cos(angle)).addScaledVector(t, Math.sin(angle));
      }
    }

    // The deepest of the holes this point is in: a round bowl, steep at its rim.
    let sink = 0;
    for (const h of holes) {
      const d = Math.hypot(n.x - h.dir[0], n.y - h.dir[1], n.z - h.dir[2]);
      if (d >= h.radius) continue;
      sink = Math.max(sink, CHEESE.depth * h.radius * Math.sqrt(1 - (d / h.radius) ** 2));
    }
    // Lumps in the rind: a few slow waves, never outward.
    const lump = CHEESE.lumps * (0.5 + 0.5 * Math.sin(n.x * 5.1 + n.y * 3.7) * Math.cos(n.z * 4.3 - n.x * 2.2));
    const r = radius * (1 - lump - sink);
    pos.setXYZ(i, n.x * r, n.y * r, n.z * r);

    // Darker and warmer down a hole, with a faint mottling over all of it.
    const deep = Math.min(1, sink / deepest);
    const mottle = 1 - 0.05 * (0.5 + 0.5 * Math.sin(n.x * 23 + n.y * 17 + n.z * 29));
    c.copy(rind).lerp(hole, deep).multiplyScalar(mottle);
    colors.set([c.r, c.g, c.b], i * 3);
  }

  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** The surface pushed out `width` along its normals, sharing its triangles. */
function outlineGeometry(source, width) {
  const g = new THREE.BufferGeometry();
  const pos = source.getAttribute('position'), nrm = source.getAttribute('normal');
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    out[i * 3] = pos.getX(i) + nrm.getX(i) * width;
    out[i * 3 + 1] = pos.getY(i) + nrm.getY(i) * width;
    out[i * 3 + 2] = pos.getZ(i) + nrm.getZ(i) * width;
  }
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.setIndex(source.getIndex().clone());
  g.computeBoundingSphere();
  return g;
}
