import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ─────────────────────────────────────────────
// ShelfClutter  –  the base's odds and ends on its shelves
// ─────────────────────────────────────────────
// What a crew that has lived here a while keeps on its racks: taped
// cardboard boxes, lidded storage bins, olive equipment cases, gas bottles,
// coiled cable, ration packs, folded blankets, water jugs, a toolbox, spare
// filter cartridges. All built here, no files.
//
//   const items = layoutShelf(RACK_SHELF, seed);          // pure: what goes where
//   buildClutter(group, [{ items, matrix }], { own });     // one InstancedMesh a kind
//
// layoutShelf packs each board along the shelf's length from a seed: a
// gap here and there, the heavy things low, what stacks stacked, all of it
// inside the uprights and under the next board. Positions are the middle of
// each thing's foot, in the shelf's frame: x along it, z across it, y up
// from the floor, the origin under its middle.
//
// buildClutter draws every thing of a kind as one InstancedMesh, whatever
// shelf it is on: a few draw calls for a room full. Each kind is a unit box
// (x and z −0.5 … 0.5, y 0 … 1) of merged parts, its details (tape, lids,
// latches, valves) shaded in its vertex colours; an instance is scaled to
// its size and tinted its own colour, weathered (`WEATHER`: duller and
// darker, so a room lit by one lamp doesn't light up with it). No
// colliders: it is set dressing.
// ─────────────────────────────────────────────

/** A shelf: its length and depth, the uprights' and the edge's margins, and
 *  each board's height with the room above it. Metres. */
export const RACK_SHELF = Object.freeze({
  // bigger-shelf.glb, Poly Haven's worn metal rack: boards at 0.43, 0.92,
  // 1.41 and its top, 1.90; the floor under the lowest.
  length: 0.915, depth: 0.6, margin: 0.05, depthMargin: 0.03,
  levels: [
    { y: 0, clearance: 0.4 }, { y: 0.43, clearance: 0.46 }, { y: 0.92, clearance: 0.46 },
    { y: 1.41, clearance: 0.46 }, { y: 1.9, clearance: 0.42 },
  ],
});

export const SMALL_SHELF = Object.freeze({
  // shelf.glb at its manifest scale: boards at 0.219, 0.644, 1.069, 1.495
  // and its top, 1.915. Its length runs along the model's z.
  length: 1.026, depth: 0.364, margin: 0.04, depthMargin: 0.02,
  levels: [
    { y: 0.219, clearance: 0.39 }, { y: 0.644, clearance: 0.39 }, { y: 1.069, clearance: 0.39 },
    { y: 1.495, clearance: 0.39 }, { y: 1.915, clearance: 0.3 },
  ],
});

/**
 * The catalogue. Sizes are [min, max] metres along the shelf (w), up (h) and
 * across (d); `round` things are as deep as they are wide; `flat` coils are
 * `flat` of their width high. `group` is how many stand side by side, `stack`
 * how many high. `heavy` things are far likelier on the low boards.
 */
export const CLUTTER = Object.freeze({
  box: { weight: 5, w: [0.22, 0.42], h: [0.16, 0.32], d: [0.22, 0.4], stack: [1, 2], material: 'matte',
    colors: [0xb08a5a, 0xa47c4c, 0xc29a66, 0x94744e, 0x8a6a44] },
  bin: { weight: 3, w: [0.34, 0.5], h: [0.18, 0.28], d: [0.3, 0.42], stack: [1, 2], material: 'matte',
    colors: [0x5d6670, 0x4a5a6a, 0x606a4a, 0x3e4448, 0x7a7f84] },
  case: { weight: 3, w: [0.34, 0.5], h: [0.1, 0.16], d: [0.24, 0.34], stack: [1, 3], material: 'satin',
    colors: [0x3b4232, 0x2c2f31, 0x4a4f3a, 0xb0581e] },
  canister: { weight: 2, heavy: true, round: true, w: [0.13, 0.2], h: [0.3, 0.38], group: [1, 3], material: 'satin',
    colors: [0xd8dcd8, 0x3f7a4a, 0xc8662a, 0x2e5d8a] },
  coil: { weight: 2, round: true, flat: 0.22, w: [0.22, 0.34], stack: [1, 3], material: 'satin',
    colors: [0x1c1c1c, 0xc8641e, 0xc9a227, 0x2b4f7a] },
  pack: { weight: 3, w: [0.18, 0.26], h: [0.06, 0.1], d: [0.14, 0.2], group: [1, 2], stack: [2, 5], material: 'matte',
    colors: [0x5a5a3a, 0x7a6e4a, 0x8a8f90] },
  blanket: { weight: 2, w: [0.36, 0.46], h: [0.06, 0.09], d: [0.26, 0.34], stack: [2, 4], material: 'matte',
    colors: [0x6b6e6a, 0x5b5440, 0x3a4250, 0x7a5a48] },
  jug: { weight: 1.5, heavy: true, w: [0.2, 0.26], h: [0.3, 0.36], d: [0.16, 0.2], group: [1, 2], material: 'satin',
    colors: [0x8fb6cf, 0xd9dde0, 0x6f9fbf] },
  toolbox: { weight: 1, heavy: true, w: [0.4, 0.5], h: [0.18, 0.22], d: [0.18, 0.22], material: 'satin',
    colors: [0xa8322a, 0x2e5a9a, 0xc8a032] },
  filter: { weight: 1.5, round: true, w: [0.1, 0.14], h: [0.16, 0.24], group: [2, 4], material: 'matte',
    colors: [0xe6e6e0, 0xc9ccc4] },
});

/** How far every catalogue colour is worn down: its saturation and its
 *  lightness (HSL, in the working colour space) scaled by these. The one
 *  knob for how loud the clutter is. */
export const WEATHER = Object.freeze({ saturation: 0.6, lightness: 0.5 });

/** A catalogue colour as it is drawn: weathered. */
export function weathered(hex) {
  const colour = new THREE.Color(hex);
  const { h, s, l } = colour.getHSL({ h: 0, s: 0, l: 0 });
  return colour.setHSL(h, s * WEATHER.saturation, l * WEATHER.lightness);
}

/** Packing: the gap between things, how often a stretch is left bare (and
 *  how long), how far a thing turns off square, and the room kept under a
 *  board. A heavy thing's weight on a high board is scaled by `highHeavy`;
 *  a board is high from `highFrom` up. */
const PACK = {
  gap: [0.02, 0.08], bare: 0.14, bareGap: [0.12, 0.3], turn: 0.05, headroom: 0.02,
  highHeavy: 0.12, highFrom: 0.5, sideGap: 0.012,
};

/** Mulberry32: small, seedable, the same clutter every build. */
function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * What goes on a shelf, and where.
 * @param {typeof RACK_SHELF} spec
 * @param {number} seed
 * @returns {{ kind: string, size: number[], position: number[], rotationY: number, color: number }[]}
 */
export function layoutShelf(spec, seed) {
  const random = rng(seed);
  const between = ([lo, hi]) => lo + random() * (hi - lo);
  const count = ([lo, hi]) => lo + Math.floor(random() * (hi - lo + 1));
  const items = [];
  const end = spec.length / 2 - spec.margin;
  const across = spec.depth / 2 - spec.depthMargin;

  for (const level of spec.levels) {
    const room = level.clearance - PACK.headroom;
    let x = -end + between([0, 0.04]);
    for (let tries = 0; tries < 30 && x < end - 0.08; tries++) {
      if (random() < PACK.bare) { x += between(PACK.bareGap); continue; }

      const kind = pick(level, room, end - x, spec, random);
      if (!kind) break;
      const def = CLUTTER[kind];
      const w = between(def.w);
      const d = def.round ? w : between(def.d);
      const h = Math.min(def.flat ? w * def.flat : between(def.h), room);
      const n = def.group ? count(def.group) : 1;
      // Fit as many of the group as there is room for along the board.
      const fits = Math.max(1, Math.min(n, Math.floor((end - x + PACK.sideGap) / (w + PACK.sideGap + 0.01))));
      const turn = def.round ? 0 : (random() * 2 - 1) * PACK.turn;
      const c = Math.cos(turn), s = Math.abs(Math.sin(turn));
      const halfX = (c * w + s * d) / 2, halfZ = (s * w + c * d) / 2;
      if (x + 2 * halfX > end || halfZ > across) continue;
      const z = (random() * 2 - 1) * (across - halfZ) * 0.6;
      const color = def.colors[Math.floor(random() * def.colors.length)];

      for (let g = 0; g < fits; g++) {
        const cx = x + halfX;
        if (cx + halfX > end) break;
        let y = level.y;
        let size = [w, h, d];
        const high = def.stack ? count(def.stack) : 1;
        for (let k = 0; k < high && y + size[1] <= level.y + room; k++) {
          items.push({ kind, size, position: [cx, y, z], rotationY: turn, color });
          y += size[1];
          // The next one up a touch smaller, so it sits on this one.
          const shrink = 0.92 + random() * 0.06;
          size = [size[0] * shrink, size[1], size[2] * shrink];
        }
        x = cx + halfX + PACK.sideGap;
      }
      x += between(PACK.gap);
    }
  }
  return items;
}

/** A kind for a board, by weight, among those that fit what is left of it. */
function pick(level, room, left, spec, random) {
  const across = spec.depth - 2 * spec.depthMargin;
  const fits = Object.entries(CLUTTER).filter(([, def]) => {
    const h = def.flat ? def.w[0] * def.flat : def.h[0];
    const d = def.round ? def.w[0] : def.d[0];
    return h <= room && d <= across && def.w[0] <= left;
  });
  const weight = ([, def]) => def.weight * (def.heavy && level.y >= PACK.highFrom ? PACK.highHeavy : 1);
  const total = fits.reduce((sum, entry) => sum + weight(entry), 0);
  let roll = random() * total;
  for (const entry of fits) if ((roll -= weight(entry)) <= 0) return entry[0];
  return fits.at(-1)?.[0] ?? null;
}

/**
 * Every thing on every shelf, one InstancedMesh a kind, into `target`.
 * @param {THREE.Object3D} target
 * @param {{ items: ReturnType<typeof layoutShelf>, matrix: THREE.Matrix4 }[]} shelves  Each shelf's frame in target's space.
 * @param {{ own: (resource: any) => any }} opts  Takes what is built, to be freed with its owner.
 * @returns {Record<string, THREE.InstancedMesh>}
 */
export function buildClutter(target, shelves, { own }) {
  const materials = {
    matte: own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 })),
    satin: own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 })),
  };
  const byKind = {};
  for (const { items, matrix } of shelves) {
    for (const item of items) (byKind[item.kind] ??= []).push({ item, matrix });
  }

  const meshes = {};
  const local = new THREE.Matrix4(), turn = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const at = new THREE.Vector3(), scale = new THREE.Vector3(), colour = new THREE.Color();
  for (const [kind, placed] of Object.entries(byKind)) {
    const mesh = new THREE.InstancedMesh(own(SHAPES[kind]()), materials[CLUTTER[kind].material], placed.length);
    mesh.name = `Clutter_${kind}`;
    mesh.castShadow = mesh.receiveShadow = true;
    placed.forEach(({ item, matrix }, i) => {
      local.compose(at.fromArray(item.position), turn.setFromAxisAngle(up, item.rotationY), scale.fromArray(item.size));
      mesh.setMatrixAt(i, local.premultiply(matrix));
      mesh.setColorAt(i, colour.copy(weathered(item.color)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    target.add(mesh);
    meshes[kind] = mesh;
  }
  return meshes;
}

// ── The shapes ──
// Each a unit box of parts, each part shaded by a vertex colour the
// instance's own colour multiplies: 1 is the thing's colour, less is a
// darker detail, more a paler one (a label).

/** A part with every vertex `shade`, moved to `[x, y, z]`. */
function part(geometry, shade, [x, y, z] = [0, 0, 0]) {
  geometry.translate(x, y, z);
  const n = geometry.getAttribute('position').count;
  const [r, g, b] = Array.isArray(shade) ? shade : [shade, shade, shade];
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [r, g, b]).flat(), 3));
  return geometry;
}
const box = (w, h, d, shade, at) => part(new THREE.BoxGeometry(w, h, d), shade, at);
const cylinder = (rt, rb, h, shade, at, segments = 16) => part(new THREE.CylinderGeometry(rt, rb, h, segments), shade, at);
/** A square frustum: four sides, turned square to the axes, flat-shaded. */
function frustum(top, bottom, h, shade, at) {
  const g = new THREE.CylinderGeometry(top * Math.SQRT1_2, bottom * Math.SQRT1_2, h, 4, 1).rotateY(Math.PI / 4).toNonIndexed();
  g.computeVertexNormals();
  g.setIndex([...Array(g.getAttribute('position').count).keys()]);
  return part(g, shade, at);
}
const merged = parts => mergeGeometries(parts);

const SHAPES = {
  // Taped shut along the top and down both ends.
  box: () => merged([
    box(1, 0.99, 1, 1, [0, 0.495, 0]),
    box(1.004, 0.01, 0.09, [0.82, 0.74, 0.6], [0, 0.995, 0]),
    box(0.01, 0.3, 0.09, [0.82, 0.74, 0.6], [0.497, 0.84, 0]),
    box(0.01, 0.3, 0.09, [0.82, 0.74, 0.6], [-0.497, 0.84, 0]),
  ]),
  // A tub, wider at the top, under a darker lid.
  bin: () => merged([
    frustum(0.96, 0.86, 0.86, 1, [0, 0.43, 0]),
    box(1, 0.14, 1, 0.72, [0, 0.93, 0]),
  ]),
  // Lid seam, two latches front and back, a handle on top.
  case: () => merged([
    box(1, 0.86, 1, 1, [0, 0.43, 0]),
    box(1.006, 0.05, 1.006, 0.45, [0, 0.62, 0]),
    ...[-0.3, 0.3].flatMap(x => [-1, 1].map(s => box(0.08, 0.18, 0.012, 0.25, [x, 0.6, s * 0.5]))),
    box(0.36, 0.05, 0.1, 0.22, [0, 0.975, 0]),
    box(0.05, 0.12, 0.1, 0.22, [-0.16, 0.92, 0]),
    box(0.05, 0.12, 0.1, 0.22, [0.16, 0.92, 0]),
  ]),
  // A bottle: body, rounded shoulder, a band, the valve.
  canister: () => merged([
    cylinder(0.5, 0.5, 0.72, 1, [0, 0.36, 0]),
    part(new THREE.SphereGeometry(0.5, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.36, 1), 1, [0, 0.72, 0]),
    cylinder(0.505, 0.505, 0.05, 0.6, [0, 0.62, 0]),
    cylinder(0.13, 0.15, 0.1, [0.5, 0.5, 0.52], [0, 0.95, 0], 10),
  ]),
  // Cable wound flat. Its tube is a hexagon, so its bounds are measured, not
  // assumed, before it is stretched to fill the unit height.
  coil: () => {
    const torus = new THREE.TorusGeometry(0.36, 0.14, 6, 16).rotateX(Math.PI / 2);
    torus.computeBoundingBox();
    const { min, max } = torus.boundingBox;
    torus.translate(0, -min.y, 0).scale(1, 1 / (max.y - min.y), 1);
    return merged([part(torus, 1)]);
  },
  // A ration pack under a pale label.
  pack: () => merged([
    box(1, 0.98, 1, 1, [0, 0.49, 0]),
    box(0.62, 0.02, 0.6, [1.25, 1.25, 1.2], [0, 0.99, 0]),
  ]),
  // Folded: a fold line round its middle.
  blanket: () => merged([
    box(1, 1, 1, 1, [0, 0.5, 0]),
    box(1.004, 0.1, 1.004, 0.78, [0, 0.5, 0]),
  ]),
  // A water jug: body, shoulders, a cap at one corner.
  jug: () => merged([
    box(1, 0.78, 1, 1, [0, 0.39, 0]),
    frustum(0.7, 1, 0.14, 1, [0, 0.85, 0]),
    cylinder(0.14, 0.14, 0.08, [0.45, 0.45, 0.48], [0.22, 0.96, 0], 10),
  ]),
  // Lid seam and a carry handle.
  toolbox: () => merged([
    box(1, 0.74, 1, 1, [0, 0.37, 0]),
    box(1.006, 0.04, 1.006, 0.5, [0, 0.58, 0]),
    box(0.5, 0.06, 0.14, 0.2, [0, 0.97, 0]),
    box(0.05, 0.2, 0.12, 0.2, [-0.24, 0.84, 0]),
    box(0.05, 0.2, 0.12, 0.2, [0.24, 0.84, 0]),
  ]),
  // A cartridge: end caps and the dark core.
  filter: () => merged([
    cylinder(0.48, 0.48, 0.84, 1, [0, 0.5, 0], 10),
    cylinder(0.5, 0.5, 0.08, 0.42, [0, 0.04, 0], 10),
    cylinder(0.5, 0.5, 0.08, 0.42, [0, 0.96, 0], 10),
    cylinder(0.17, 0.17, 0.01, 0.08, [0, 1.0, 0], 8),
  ]),
};
