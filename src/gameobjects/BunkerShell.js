import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// BunkerShell  –  the building's outside: a sloped concrete bunker
// ─────────────────────────────────────────────
// The rooms and corridors are plain boxes, built to be lived in, not looked
// at. From the yard this is what the base is: a low, battered mass of
// weathered concrete wrapped round the whole building — every wall sloping
// back from a wide toe at the ground to the roof, a flat roof capped by a
// rusted steel band, a vent stack and housings on top, louvre plates set
// into the slopes.
//
//        ┌───────────────────┐  ← cap: the roof, its edge a band of rust
//       ╱                     ╲
//      ╱   slopes (battered)   ╲
//     ╱_________________________╲ ← toe, `batter` out from the walls
//
// The outline is the building's footprint, walked round its outer wall
// faces. An edge marked `flat` gets no slope: the office's back wall stays
// a sheer face with the window in it, and the airlock's hatch end stays a
// sheer face with the hatch in it — each with a concrete brow over it, the
// roof run out by `cap.visor`. A slope beside a flat edge ends square,
// closed by a cap face; two slopes at a corner meet in a mitred hip
// (outside corner) or valley (inside corner).
//
// A window in a flat edge can be given an embrasure (`embrasures`): a
// thick concrete surround, its corners rounded, flaring out from the glass
// like a bunker's observation slit, with a steel collar round the opening
// and its rim bolted. The flare is wide enough that it never cuts into the
// view from inside the room.
//
// It stands wholly outside the rooms, so nothing indoors changes; the void
// between it and the corridors' outer walls is closed by the roof and never
// seen. Fog nowhere (like the rest of the building, see
// BaseScene._keepFogOutside), and solid to the player: a convex hull per
// slope — not the slope's own shape but a sheer face at its toe, standing
// `climbGuard` over the roof. Rapier's character controller counts any
// upward-facing contact as ground, however steep, so against a sloped hull
// every jump landed a little higher and the player walked up onto the roof.
// The slope recedes from the toe as it rises, so the player, stopped there,
// never reaches it: it is only seen.
//
// The concrete is baked at build into small DataTextures (no files): one
// laid out up the slope — dirt at the foot, rust and grime streaks hanging
// from the roof edge, panel seams — and one plain, tiling, for the roof,
// the caps and the band.
// ─────────────────────────────────────────────

export const BUNKER = {
  /** Metres out from the wall at the ground (the toe of the slope). */
  batter: 1.5,
  /** Metres out from the wall at the top of the slope, under the roof. */
  shoulder: 0.15,
  cap: {
    /** The roof slab's depth over the rooms' roof: the rusted band's height. */
    height: 0.3,
    /** How far the roof edge stands out past the top of the slope. */
    overhang: 0.12,
    /** How far it runs out over a flat edge: the brow over the window. */
    visor: 0.45,
  },
  /** Metres of wall one width of the slope texture covers. */
  textureMetres: 4,
  /** Pale, sun-bleached concrete; a dark rust; steel for the louvres. */
  colors: { concrete: 0xc9c3b6, roof: 0x8f8a80, rust: 0x7a4422, steel: 0x2b2a27 },
  seed: 7,
  /** Metres the slopes' colliders stand above the roof: out of reach of a
   *  jump from anything in the yard (the buggy's roof included). */
  climbGuard: 1.5,
};

/** A window's embrasure (metres). `splay` is how far the opening widens by
 *  the front, each side; `rim` the concrete face round that; `collar` the
 *  depth of the steel lining at the glass. The side splay is what keeps the
 *  view clear from the desk: wider than the sightline through the window's
 *  edge (1.7 m across for each metre out, from 2.5 m inside). The top rim
 *  tucks up under the brow. */
export const EMBRASURE = {
  radius: 0.45,
  depth: 0.4,
  splay: { side: 0.72, top: 0.35, bottom: 0.2 },
  rim:   { side: 0.3, top: 0.3, bottom: 0.15 },
  collar: 0.08,
  segments: 8,
  bolt: { radius: 0.035, length: 0.05, spacing: 0.42 },
};

const EPS = 1e-6;

// ──────────────────────────────────────────
// Geometry (pure)
// ──────────────────────────────────────────

/**
 * The shell's faces, from the building's outline.
 *
 * @param {object} o
 * @param {{x:number, z:number, flat?:boolean}[]} o.outline  The outer wall
 *        faces, corner to corner, either way round. Rectilinear. `flat` on
 *        a corner marks the edge from it to the next as bare wall.
 * @param {number} o.height     The slopes' height: the building's roof top.
 * @param {number} [o.batter]   Out at the ground.
 * @param {number} [o.shoulder] Out at the top.
 * @param {{height:number, overhang:number, visor:number}} [o.cap]
 * @returns {{
 *   slopes: {poly:number[][], normal:number[], edge:object}[],
 *   caps:   {poly:number[][]}[],
 *   roof:   number[][],
 *   hulls:  number[][][],
 *   edges:  object[],
 * }}  Polygons are [x, y, z] points, wound counter-clockwise seen from
 *     outside. `roof` is the cap's outline as [x, z]. `normal` is the
 *     wall's outward [x, z].
 */
export function shellFaces({
  outline, height,
  batter = BUNKER.batter, shoulder = BUNKER.shoulder, cap = BUNKER.cap,
}) {
  const edges = edgesOf(outline);
  const n = edges.length;
  const prev = i => edges[(i - 1 + n) % n];
  const next = i => edges[(i + 1) % n];
  const perp = (a, b) => Math.abs(a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1]) < 0.5;

  const offsets = {
    toe:      e => (e.flat ? 0 : batter),
    shoulder: e => (e.flat ? 0 : shoulder),
    roof:     e => (e.flat ? cap.visor : shoulder + cap.overhang),
  };
  /** Where edge `e`'s start (end = false) or end, pushed out by `off`, lies:
   *  on its own offset line and, round a corner, its neighbour's. */
  const endPoint = (e, end, off) => {
    const v = end ? e.b : e.a;
    const nb = end ? next(e.i) : prev(e.i);
    const d = off(e), dn = perp(e, nb) ? off(nb) : 0;
    return [v.x + e.normal[0] * d + nb.normal[0] * dn, v.z + e.normal[1] * d + nb.normal[1] * dn];
  };
  /** Does the slope end square at this end (no slope round the corner)? */
  const capped = (e, end) => {
    const nb = end ? next(e.i) : prev(e.i);
    return nb.flat || !perp(e, nb);
  };

  const slopes = [], caps = [], hulls = [];
  for (const e of edges) {
    if (e.flat) continue;
    const [a0, b0] = [false, true].map(end => endPoint(e, end, offsets.toe));
    const [a1, b1] = [false, true].map(end => endPoint(e, end, offsets.shoulder));
    const at = ([x, z], y) => [x, y, z];
    const outward = [e.normal[0], 0, e.normal[1]];
    slopes.push({
      poly: orient([at(a0, 0), at(b0, 0), at(b1, height), at(a1, height)], outward),
      normal: [...e.normal], edge: e,
    });

    // The hull: the ground the slope stands on, wall line to toe, stood up
    // sheer to `climbGuard` over the roof — never the slope itself, which a
    // jump would walk up (see the header).
    const back = ([x, z], d) => [x - e.normal[0] * d, z - e.normal[1] * d];
    const top = height + BUNKER.climbGuard;
    const foot = [a0, b0];
    hulls.push([0, top].flatMap(y => foot.flatMap(p => [at(p, y), at(back(p, batter), y)])));

    for (const end of [false, true]) {
      if (!capped(e, end)) continue;
      const v = end ? e.b : e.a;
      const sign = end ? 1 : -1;
      const toe = endPoint(e, end, offsets.toe), top = endPoint(e, end, offsets.shoulder);
      const poly = [[v.x, 0, v.z], at(toe, 0), at(top, height), [v.x, height, v.z]];
      caps.push({ poly: orient(poly, [e.dir[0] * sign, 0, e.dir[1] * sign]) });
    }
  }

  // The roof: every edge's offset line, end to end. Round a corner the two
  // ends meet; along a straight run with two offsets they step.
  const roof = [];
  for (const e of edges) {
    for (const end of [false, true]) {
      const p = endPoint(e, end, offsets.roof);
      const last = roof[roof.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > EPS) roof.push(p);
    }
  }
  const first = roof[0], last = roof[roof.length - 1];
  if (roof.length > 1 && Math.hypot(first[0] - last[0], first[1] - last[1]) < EPS) roof.pop();

  return { slopes, caps, roof, hulls, edges };
}

/** The outline's edges, each with its direction and outward normal. */
function edgesOf(outline) {
  const n = outline.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = outline[i], b = outline[(i + 1) % n];
    area += a.x * b.z - b.x * a.z;
  }
  const s = Math.sign(area) || 1;
  return outline.map((a, i) => {
    const b = outline[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const dir = [(b.x - a.x) / len, (b.z - a.z) / len];
    // Counter-clockwise in (x, z), the outside is on the right of travel.
    const normal = [dir[1] * s, -dir[0] * s];
    return { i, a, b, len, dir, normal, flat: !!a.flat };
  });
}

/** `poly` wound counter-clockwise seen from `outward`. */
function orient(poly, outward) {
  const n = faceNormalOf(poly);
  return n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0 ? poly.reverse() : poly;
}

function faceNormalOf(poly) {
  // Newell's method: robust for any planar polygon.
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay, az] = poly[i], [bx, by, bz] = poly[(i + 1) % poly.length];
    x += (ay - by) * (az + bz);
    y += (az - bz) * (ax + bx);
    z += (ax - bx) * (ay + by);
  }
  return [x, y, z];
}

/**
 * A rounded rectangle, as a closed counter-clockwise contour of [x, y]
 * points: `segments` + 1 on each quarter-circle corner, and always the same
 * number of points for the same `segments`, so two can be lofted point to
 * point.
 */
export function roundedRect({ x0, x1, y0, y1, r, segments = EMBRASURE.segments }) {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  const corners = [
    [x1 - r, y0 + r, -Math.PI / 2],
    [x1 - r, y1 - r, 0],
    [x0 + r, y1 - r, Math.PI / 2],
    [x0 + r, y0 + r, Math.PI],
  ];
  const points = [];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = start + (i / segments) * (Math.PI / 2);
      points.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return points;
}

// ──────────────────────────────────────────
// Building it
// ──────────────────────────────────────────

/**
 * The shell, built: a GameObject (fixed body, a hull per slope) under which
 * hang the skin, the roof, the band and the details.
 *
 * @param {object} o
 * @param {import('../core/Engine.js').Engine} o.engine
 * @param {{x:number, z:number, flat?:boolean}[]} o.outline  See shellFaces.
 * @param {number} o.height
 * @param {{x:number, z:number, rotationY?:number, kind:'vent'|'stack'}[]} [o.roofProps]
 * @param {{edge:number, at:number, y:number, width:number, height:number}[]} [o.louvres]
 *        Plates on the slope of outline edge `edge`, `at` metres along it
 *        from its start, centred `y` up.
 * @param {{edge:number, at:number, sill:number, width:number, height:number, radius?:number}[]} [o.embrasures]
 *        Windows in flat edges to frame: centred `at` metres along edge
 *        `edge` from its start, `sill` up, the opening's size.
 * @returns {GameObject & {
 *   fascia: {out:number, y:number, height:number, material:THREE.Material},
 *   faces: ReturnType<typeof shellFaces>,
 *   resources: {dispose():void}[], disposeResources():void,
 *   cutouts(): THREE.Box3[],
 * }}
 */
export function createBunkerShell({ engine, outline, height, roofProps = [], louvres = [], embrasures = [] }) {
  const faces = shellFaces({ outline, height });
  const go = new GameObject('BunkerShell');
  const resources = [];
  const own = r => { resources.push(r); return r; };

  const tex = concreteTextures(BUNKER.seed);
  own(tex.wall); own(tex.plain);
  const C = BUNKER.colors;
  const mat = (params) => own(new THREE.MeshStandardMaterial({ fog: false, ...params }));
  const materials = {
    skin:  mat({ color: C.concrete, map: tex.wall, bumpMap: tex.plain, bumpScale: 2, roughness: 0.95 }),
    roof:  mat({ color: C.roof, map: tex.plain, bumpMap: tex.plain, bumpScale: 2, roughness: 0.95 }),
    rust:  mat({ color: C.rust, map: tex.plain, roughness: 0.8, metalness: 0.35 }),
    steel: mat({ color: C.steel, roughness: 0.7, metalness: 0.5 }),
  };

  const add = (name, geometry, material) => {
    const mesh = new THREE.Mesh(own(geometry), material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    go.object3d.add(mesh);
    return mesh;
  };

  // The skin: every slope, and the caps where a slope ends square. Laid
  // out for the slope texture: u along the wall in metres, v up the slope.
  const skin = new PolyBuilder();
  for (const { poly, edge } of faces.slopes) {
    skin.add(poly, p => [(p[0] * edge.dir[0] + p[2] * edge.dir[1]) / BUNKER.textureMetres, p[1] / height]);
  }
  for (const { poly } of faces.caps) {
    const across = Math.abs(poly[0][0] - poly[1][0]) > Math.abs(poly[0][2] - poly[1][2]) ? 0 : 2;
    skin.add(poly, p => [p[across] / BUNKER.textureMetres, p[1] / height]);
  }
  add('BunkerSkin', skin.geometry(), materials.skin);

  // The roof: a slab over the whole outline, its top and underside, and its
  // edge — the band — all round.
  const top = height + BUNKER.cap.height;
  const roof = new PolyBuilder();
  const planUv = p => [p[0] / BUNKER.textureMetres, p[2] / BUNKER.textureMetres];
  roof.addPlan(faces.roof, top, true, planUv);
  roof.addPlan(faces.roof, height, false, planUv);
  add('BunkerRoof', roof.geometry(), materials.roof);

  const band = new PolyBuilder();
  const ccw = signedArea(faces.roof) > 0;
  for (let i = 0; i < faces.roof.length; i++) {
    const [ax, az] = faces.roof[i], [bx, bz] = faces.roof[(i + 1) % faces.roof.length];
    const len = Math.hypot(bx - ax, bz - az);
    const dir = [(bx - ax) / len, (bz - az) / len];
    const out = ccw ? [dir[1], 0, -dir[0]] : [-dir[1], 0, dir[0]];
    band.add(orient([[ax, height, az], [bx, height, bz], [bx, top, bz], [ax, top, az]], out),
      p => [(p[0] * dir[0] + p[2] * dir[1]) / BUNKER.textureMetres, p[1] / BUNKER.textureMetres]);
  }
  add('BunkerBand', band.geometry(), materials.rust);

  if (roofProps.length) add('BunkerRoofProps', roofPropsGeometry(roofProps, top), materials.rust);
  if (louvres.length) add('BunkerLouvres', louvreGeometry(louvres, faces, height), materials.steel);
  if (embrasures.length) {
    const built = embrasures.map(o => embrasureGeometry(o, faces.edges[o.edge], height));
    add('BunkerEmbrasure', mergeAll(built.flatMap(b => b.concrete)), materials.skin);
    add('BunkerEmbrasureSteel', mergeAll(built.flatMap(b => b.steel)), materials.steel);
  }

  // Solid: a fixed body, a hull per slope.
  const { world } = engine;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const colliders = [];
  for (const points of faces.hulls) {
    const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(points.flat()));
    if (desc) colliders.push(world.createCollider(desc, body));
  }
  go.rigidBody = body;
  go.colliders = colliders;
  go.collider = colliders[0] ?? null;
  engine._bodyToGO?.set(body.handle, go);

  /**
   * Anchor a fence into a slope: a concrete buttress filling the wedge
   * between the slope and a post standing at its toe, as tall as the fence
   * and as wide as `width` — so the wire runs into the bunker instead of
   * stopping short of it or vanishing into it, and leaves no gap between
   * its last post and the slope to squeeze into. `x, z` is any point over
   * the slope (the fence's line); the buttress sits on the slope found
   * there, its face at the toe. Solid: a hull on the shell's body.
   * @returns {{ mesh: THREE.Mesh, collider: object, toe: number, x: number, z: number }}
   *          `toe` is the face's coordinate along that slope's normal axis.
   */
  go.addAnchor = ({ x, z, height: h, width }) => {
    // Past either end by up to the batter: round an outside corner the slope
    // carries on, mitred, that far. Near a corner two slopes can claim the
    // point; it is the toe of the one it stands furthest out on.
    const out = ({ edge: e }) => (x - e.a.x) * e.normal[0] + (z - e.a.z) * e.normal[1];
    const slope = faces.slopes.filter(({ edge: e }) => {
      const t = (x - e.a.x) * e.dir[0] + (z - e.a.z) * e.dir[1];
      const n = out({ edge: e });
      return t >= -BUNKER.batter - EPS && t <= e.len + BUNKER.batter + EPS && n >= -EPS && n <= BUNKER.batter + EPS;
    }).sort((p, q) => out(q) - out(p))[0];
    if (!slope) throw new Error(`BunkerShell.addAnchor: no slope under (${x}, ${z})`);
    const e = slope.edge;
    const t = (x - e.a.x) * e.dir[0] + (z - e.a.z) * e.dir[1];
    const back = BUNKER.batter + (BUNKER.shoulder - BUNKER.batter) * (h / height);
    const at = (along, out, y) => [
      e.a.x + e.dir[0] * along + e.normal[0] * out, y, e.a.z + e.dir[1] * along + e.normal[1] * out,
    ];
    const ends = [t - width / 2, t + width / 2];
    // Each end a triangle: the toe, the top of the post above it, and the
    // slope at the fence's height.
    const tri = s => [at(s, BUNKER.batter, 0), at(s, BUNKER.batter, h), at(s, back, h)];
    const [l, r] = ends.map(tri);
    const outward = [e.normal[0], 0, e.normal[1]];
    const sideways = s => [e.dir[0] * s, 0, e.dir[1] * s];
    const builder = new PolyBuilder();
    const uv = p => [(p[0] * e.dir[0] + p[2] * e.dir[1]) / BUNKER.textureMetres, p[1] / height];
    builder.add(orient([l[0], r[0], r[1], l[1]], outward), uv);             // the face at the toe
    builder.add(orient([l[1], r[1], r[2], l[2]], [0, 1, 0]), uv);       // the top
    builder.add(orient([...l], sideways(-1)), p => [(p[0] * e.normal[0] + p[2] * e.normal[1]) / BUNKER.textureMetres, p[1] / height]);
    builder.add(orient([...r], sideways(1)), p => [(p[0] * e.normal[0] + p[2] * e.normal[1]) / BUNKER.textureMetres, p[1] / height]);
    const mesh = add('BunkerAnchor', builder.geometry(), materials.skin);

    const desc = RAPIER.ColliderDesc.convexHull(new Float32Array([...l, ...r].flat()));
    const collider = desc ? world.createCollider(desc, body) : null;
    if (collider) colliders.push(collider);
    const toe = (e.normal[0] !== 0 ? e.a.x : e.a.z) + (e.normal[0] || e.normal[1]) * BUNKER.batter;
    return { mesh, collider, toe, x, z };
  };

  go.faces = faces;
  go.fascia = {
    out: BUNKER.shoulder + BUNKER.cap.overhang,
    y: height + BUNKER.cap.height / 2,
    height: BUNKER.cap.height,
    material: materials.rust,
  };
  /** The slopes' weathered concrete, for walls left bare to wear: see clad(). */
  go.concrete = materials.skin;
  /** Dress `mesh` (a wall of the building left bare) in the slopes'
   *  concrete, its texture laid out as theirs is — along the wall in metres,
   *  up it by height over the slopes' height — so the dirt banked at the
   *  foot and the streaks under the roof run on across it. Rewrites the
   *  mesh's own uv in place: the geometry must be the mesh's alone. */
  go.clad = (mesh) => {
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      uv.setXY(i, (p.x + p.z) / BUNKER.textureMetres, p.y / height);
    }
    uv.needsUpdate = true;
    mesh.material = materials.skin;
  };
  go.resources = resources;
  go.disposeResources = () => { for (const r of resources) r.dispose(); resources.length = 0; };
  /** One box per slope — the ground it stands on, toe to wall, from the
   *  floor up past the roof — for the wind dust to keep out of. */
  go.cutouts = () => faces.hulls.map(points => new THREE.Box3().setFromPoints(points.map(p => new THREE.Vector3(...p))));
  return go;
}

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
    a += ax * bz - bx * az;
  }
  return a;
}

/** Collects planar polygons into one indexed BufferGeometry, flat-shaded
 *  (each face its own vertices and normal). */
class PolyBuilder {
  positions = []; normals = []; uvs = []; indices = [];

  /** A convex polygon, already wound CCW from its front. */
  add(poly, uv) {
    const [nx, ny, nz] = faceNormalOf(poly);
    const len = Math.hypot(nx, ny, nz) || 1;
    const base = this.positions.length / 3;
    for (const p of poly) {
      this.positions.push(...p);
      this.normals.push(nx / len, ny / len, nz / len);
      this.uvs.push(...uv(p));
    }
    for (let i = 1; i < poly.length - 1; i++) this.indices.push(base, base + i, base + i + 1);
  }

  /** A horizontal polygon (any shape, [x, z] points) at height `y`, facing
   *  up or down. */
  addPlan(plan, y, up, uv) {
    const contour = plan.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const base = this.positions.length / 3;
    for (const [x, z] of plan) {
      this.positions.push(x, y, z);
      this.normals.push(0, up ? 1 : -1, 0);
      this.uvs.push(...uv([x, y, z]));
    }
    for (const [a, b, c] of tris) {
      // Seen from above, CCW in (x, z) is clockwise: flip to face up.
      const [x0, z0] = plan[a], [x1, z1] = plan[b], [x2, z2] = plan[c];
      const cross = (x1 - x0) * (z2 - z0) - (z1 - z0) * (x2 - x0);
      const facesUp = cross < 0;
      if (facesUp === up) this.indices.push(base + a, base + b, base + c);
      else this.indices.push(base + a, base + c, base + b);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/**
 * One window's embrasure, as geometries to merge: `concrete` (the flare, its
 * face and the sleeve back to the wall) and `steel` (the collar at the glass
 * and the bolts round the face). Worked in the window's own frame — u along
 * the wall from the opening's centre, v up, d out from the wall face — and
 * placed by `edge`.
 */
function embrasureGeometry({ at, sill, width, height, radius = EMBRASURE.radius }, edge, shellHeight) {
  const E = EMBRASURE;
  const world = (u, v, d) => [
    edge.a.x + edge.dir[0] * (at + u) + edge.normal[0] * d, v,
    edge.a.z + edge.dir[1] * (at + u) + edge.normal[1] * d,
  ];
  /** The opening's contour grown by `e` ({side, top, bottom}), radius kept. */
  const ring = (e = { side: 0, top: 0, bottom: 0 }, r = radius) => roundedRect({
    x0: -width / 2 - e.side, x1: width / 2 + e.side, y0: sill - e.bottom, y1: sill + height + e.top, r,
  });
  const scale = (e, k) => ({ side: e.side * k, top: e.top * k, bottom: e.bottom * k });
  const add = (a, b) => ({ side: a.side + b.side, top: a.top + b.top, bottom: a.bottom + b.bottom });
  const axis = d => new THREE.Vector3(...world(0, sill + height / 2, d));
  const out = new THREE.Vector3(edge.normal[0], 0, edge.normal[1]);

  const glass = ring();
  const collar = ring(scale(E.splay, E.collar / E.depth));
  const front = ring(E.splay);
  const rim = ring(add(E.splay, E.rim), radius + 0.1);
  const bolts = ring(add(E.splay, scale(E.rim, 0.5)), radius + 0.05);

  const inward  = (p, d) => axis(d).sub(p);       // the flare faces the opening's axis
  const outward = (p, d) => p.clone().sub(axis(d));
  const concrete = [
    loft(collar, E.collar, front, E.depth, world, inward, shellHeight),
    loft(front, E.depth, rim, E.depth, world, () => out, shellHeight),
    loft(rim, E.depth, rim, 0, world, outward, shellHeight),
  ];
  const steel = [loft(glass, 0, collar, E.collar, world, inward, shellHeight)];

  // Bolts round the face, evenly by length.
  const { radius: br, length: bl, spacing } = E.bolt;
  const lengths = bolts.map((p, i) => Math.hypot(...[0, 1].map(k => bolts[(i + 1) % bolts.length][k] - p[k])));
  const total = lengths.reduce((a, b) => a + b, 0);
  const count = Math.round(total / spacing);
  const orient = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), out);
  for (let k = 0, i = 0, walked = 0; k < count; k++) {
    const target = (k * total) / count;
    while (walked + lengths[i] < target) walked += lengths[i++];
    const f = (target - walked) / lengths[i];
    const [u0, v0] = bolts[i], [u1, v1] = bolts[(i + 1) % bolts.length];
    const g = new THREE.CylinderGeometry(br, br * 1.2, bl, 6, 1);
    g.applyQuaternion(orient);
    const [x, y, z] = world(u0 + (u1 - u0) * f, v0 + (v1 - v0) * f, E.depth + bl / 2);
    g.translate(x, y, z);
    steel.push(g);
  }
  return { concrete, steel };
}

/** The surface between two contours of the same length, `ringA` at depth
 *  `dA` and `ringB` at `dB`, smooth-shaded round its curve, wound to face
 *  `facing(point, depth)`. Laid out for the slope texture: v is height
 *  over `vHeight`, so its dirt and streaks match the slopes beside it. */
function loft(ringA, dA, ringB, dB, world, facing, vHeight) {
  const n = ringA.length;
  const positions = [], uvs = [];
  for (const [ring, d] of [[ringA, dA], [ringB, dB]]) {
    for (const [u, v] of ring) {
      const p = world(u, v, d);
      positions.push(...p);
      uvs.push((p[0] + p[2]) / BUNKER.textureMetres, p[1] / vHeight);
    }
  }
  const build = (flip) => {
    const index = [];
    for (let i = 0; i < n; i++) {
      const a = i, b = (i + 1) % n, c = n + (i + 1) % n, d = n + i;
      if (flip) index.push(a, c, b, a, d, c);
      else index.push(a, b, c, a, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  };
  let g = build(false);
  const p0 = new THREE.Vector3(...positions.slice(0, 3));
  const n0 = new THREE.Vector3().fromBufferAttribute(g.getAttribute('normal'), 0);
  if (n0.dot(facing(p0, dA)) < 0) { g.dispose(); g = build(true); }
  return g;
}

/** Boxes and cylinders for the roof, merged into one geometry. */
function roofPropsGeometry(props, top) {
  const parts = [];
  const place = (geometry, x, y, z, rotationY = 0) => {
    geometry.rotateY(rotationY);
    geometry.translate(x, y, z);
    parts.push(geometry);
  };
  for (const { kind, x, z, rotationY = 0 } of props) {
    if (kind === 'stack') {
      place(new THREE.CylinderGeometry(0.2, 0.22, 1.4, 14, 1), x, top + 0.7, z);
      place(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 14, 1), x, top + 1.44, z);   // the rain cap
      place(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 6, 1), x + 0.18, top + 1.37, z);
      place(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 6, 1), x - 0.18, top + 1.37, z);
    } else {
      place(new THREE.BoxGeometry(1.4, 0.55, 0.9), x, top + 0.275, z, rotationY);
      // A sloped hood along the top, louvred on its face.
      const hood = new THREE.BoxGeometry(1.5, 0.12, 1.0);
      hood.rotateX(-0.25);
      place(hood, x, top + 0.6, z, rotationY);
    }
  }
  return mergeAll(parts);
}

/** Dark steel plates set into the slopes, each a thin box lying on its face. */
function louvreGeometry(louvres, faces, height) {
  const parts = [];
  const { batter, shoulder } = BUNKER;
  for (const { edge: index, at, y, width, height: h } of louvres) {
    const slope = faces.slopes.find(s => s.edge.i === index);
    if (!slope) continue;
    const e = slope.edge;
    const out = batter + (shoulder - batter) * (y / height);
    const centre = new THREE.Vector3(
      e.a.x + e.dir[0] * at + e.normal[0] * out, y, e.a.z + e.dir[1] * at + e.normal[1] * out,
    );
    const along = new THREE.Vector3(e.dir[0], 0, e.dir[1]);
    const normal = new THREE.Vector3(e.normal[0] * height, batter - shoulder, e.normal[1] * height).normalize();
    const up = new THREE.Vector3().crossVectors(normal, along).normalize();
    // Up the slope; turning it keeps the basis right-handed (along × up = normal).
    if (up.y < 0) { up.negate(); along.negate(); }
    const fix = (geometry, lift) => {
      const m = new THREE.Matrix4().makeBasis(along, up, normal);
      m.setPosition(centre.clone().addScaledVector(normal, lift));
      geometry.applyMatrix4(m);
      parts.push(geometry);
    };
    fix(new THREE.BoxGeometry(width, h, 0.08), 0.0);
    // Slats across it.
    const slats = Math.max(2, Math.round(h / 0.12));
    for (let i = 0; i < slats; i++) {
      const slat = new THREE.BoxGeometry(width - 0.08, 0.03, 0.05);
      slat.translate(0, -h / 2 + (i + 0.5) * (h / slats), 0);
      fix(slat, 0.05);
    }
  }
  return mergeAll(parts);
}

/** Non-indexed merge of plain geometries (position, normal, uv). */
function mergeAll(parts) {
  const out = { position: [], normal: [], uv: [] };
  for (const g of parts) {
    const flat = g.index ? g.toNonIndexed() : g;
    for (const key of Object.keys(out)) out[key].push(...flat.getAttribute(key).array);
    if (flat !== g) flat.dispose();
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  merged.computeBoundingSphere();
  return merged;
}

// ──────────────────────────────────────────
// The concrete, baked
// ──────────────────────────────────────────
const TEX_SIZE = 256;

/**
 * Two 256 px textures, seeded so every build is the same:
 *   wall   laid out up a slope (v 0 at the toe, 1 under the roof), tiling
 *          along it: concrete grain, panel seams, rust and grime streaks
 *          hanging from the roof edge, the dirt and red dust banked at the foot.
 *   plain  the grain alone, tiling both ways (roof, caps, band, bump).
 * Multiplied by each material's colour, so they hold value, not hue —
 * except the stains, which carry their own.
 */
export function concreteTextures(seed = BUNKER.seed) {
  const rand = mulberry32(seed);
  const grain = fbm(rand, 8, 4);
  const blotch = fbm(rand, 3, 3);
  const S = TEX_SIZE;

  // Streaks: where they hang, how wide, how far down, rust or grime.
  const streaks = Array.from({ length: 22 }, () => ({
    x: rand() * S, w: 1.5 + rand() * 6, len: 0.15 + rand() * 0.6,
    k: 0.25 + rand() * 0.45, rust: rand() < 0.55,
  }));

  const wall = new Uint8Array(S * S * 4);
  const plain = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) {
    const v = j / (S - 1);
    for (let i = 0; i < S; i++) {
      const u = i / S;
      const g = grain(u, v), b = blotch(u, v);
      let shade = 0.8 + 0.2 * g - 0.12 * Math.max(0, b - 0.55);
      // Pits.
      if (g > 0.86) shade *= 0.8;
      const p = (j * S + i) * 4;
      const grey = clamp01(shade);
      plain[p] = plain[p + 1] = plain[p + 2] = Math.round(grey * 255);
      plain[p + 3] = 255;

      let r = shade, gg = shade, bb = shade;
      // Panel seams: one joint down each width, one across halfway up.
      const seamX = Math.min(i, S - i);
      if (seamX < 1.5) { r *= 0.62; gg *= 0.62; bb *= 0.62; }
      if (Math.abs(v - 0.5) < 1.5 / S) { r *= 0.75; gg *= 0.75; bb *= 0.75; }
      // Streaks, heaviest under the roof, thinning as they run down.
      for (const s of streaks) {
        let dx = Math.abs(i - s.x);
        dx = Math.min(dx, S - dx);
        if (dx > s.w) continue;
        const down = 1 - v;
        if (down > s.len) continue;
        const k = s.k * (1 - down / s.len) * (1 - dx / s.w) * (0.6 + 0.4 * g);
        const [tr, tg, tb] = s.rust ? [0.55, 0.3, 0.15] : [0.42, 0.4, 0.37];
        r += (tr - r) * k; gg += (tg - gg) * k; bb += (tb - bb) * k;
      }
      // A rust line dripped along under the roof edge.
      if (v > 0.95) { const k = 0.35 * (v - 0.95) / 0.05; r += (0.5 - r) * k; gg += (0.28 - gg) * k; bb += (0.14 - bb) * k; }
      // Dirt and red dust banked up the foot.
      const foot = smoothstep(0.32, 0.0, v + 0.1 * (b - 0.5));
      r += (0.42 - r) * 0.7 * foot; gg += (0.27 - gg) * 0.7 * foot; bb += (0.18 - bb) * 0.7 * foot;

      wall[p] = Math.round(clamp01(r) * 255);
      wall[p + 1] = Math.round(clamp01(gg) * 255);
      wall[p + 2] = Math.round(clamp01(bb) * 255);
      wall[p + 3] = 255;
    }
  }
  const make = (data, wrapT) => {
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = wrapT;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  return { wall: make(wall, THREE.ClampToEdgeWrapping), plain: make(plain, THREE.RepeatWrapping) };
}

/** Tiling fractal value noise on [0, 1)², 0 … 1. */
function fbm(rand, period, octaves) {
  const layers = Array.from({ length: octaves }, (_, o) => {
    const p = period << o;
    const grid = Float32Array.from({ length: p * p }, () => rand());
    return { p, grid };
  });
  return (u, v) => {
    let sum = 0, amp = 0.5, norm = 0;
    for (const { p, grid } of layers) {
      const x = u * p, y = v * p;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = smooth(x - x0), fy = smooth(y - y0);
      const at = (a, b) => grid[((b % p + p) % p) * p + ((a % p + p) % p)];
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
      const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
      sum += amp * (top + (bot - top) * fy);
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = t => t * t * (3 - 2 * t);
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
