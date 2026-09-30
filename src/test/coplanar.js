import * as THREE from 'three';

// ─────────────────────────────────────────────
// coplanarOverlaps  –  find z-fighting before anyone has to see it
// ─────────────────────────────────────────────
// Two surfaces z-fight when they lie in the same plane, overlap, and face
// the same way (or either is double-sided): the depth buffer can't tell
// them apart, so which one wins flickers from pixel to pixel as the camera
// moves. This walks every triangle of every mesh under a root, in world
// space, and reports each pair of meshes that do that, with the area they
// share. Instanced meshes are skipped (the vegetation belt is organic
// clutter, and far too many triangles).
// ─────────────────────────────────────────────

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _ab = new THREE.Vector3(), _ac = new THREE.Vector3();

/** A mesh's triangles in world space: [{ n, d, points }], each a plane n·p = d. */
function trianglesOf(mesh) {
  const pos = mesh.geometry.getAttribute('position');
  if (!pos) return [];
  const index = mesh.geometry.getIndex();
  const count = index ? index.count : pos.count;
  const out = [];
  for (let i = 0; i + 2 < count; i += 3) {
    const [ia, ib, ic] = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
    _a.fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld);
    _b.fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld);
    _c.fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld);
    const n = _ab.subVectors(_b, _a).cross(_ac.subVectors(_c, _a));
    const doubleArea = n.length();
    if (doubleArea < 1e-9) continue;
    n.divideScalar(doubleArea);
    out.push({ n: n.clone(), d: n.dot(_a), points: [_a.clone(), _b.clone(), _c.clone()] });
  }
  return out;
}

/** Drop the normal's largest axis, leaving the 2D shape seen along it. */
function project(points, n) {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (ax >= ay && ax >= az) return points.map(p => [p.y, p.z]);
  if (ay >= az) return points.map(p => [p.x, p.z]);
  return points.map(p => [p.x, p.y]);
}

const cross2 = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const area2 = poly => Math.abs(poly.reduce((s, p, i) => {
  const q = poly[(i + 1) % poly.length];
  return s + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;

/** Area shared by two convex polygons (Sutherland–Hodgman clipping). */
function sharedArea(subject, clip) {
  // Clip against edges wound anticlockwise.
  if (cross2(clip[0], clip[1], clip[2]) < 0) clip = [...clip].reverse();
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const pin = cross2(a, b, p) >= 0, qin = cross2(a, b, q) >= 0;
      if (pin) out.push(p);
      if (pin !== qin) {
        const t = cross2(a, b, p) / (cross2(a, b, p) - cross2(a, b, q));
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
  }
  return out.length >= 3 ? area2(out) : 0;
}

/**
 * @param {THREE.Object3D} root
 * @param {{ skip?: (mesh: THREE.Mesh) => boolean, tolerance?: number, minArea?: number }} [options]
 *   `tolerance` is how close (m) two planes must be to fight; `minArea` (m²)
 *   ignores slivers where two faces merely touch along an edge.
 * @returns {{ a: string, b: string, area: number }[]} largest overlap first
 */
export function coplanarOverlaps(root, { skip = () => false, tolerance = 5e-4, minArea = 1e-4 } = {}) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  let id = 0;
  root.traverse(mesh => {
    if (!mesh.isMesh || mesh.isInstancedMesh || skip(mesh)) return;
    const materials = [mesh.material].flat();
    const doubleSided = materials.some(m => m?.side === THREE.DoubleSide);
    const owner = { id: id++, name: mesh.name || mesh.parent?.name || '(unnamed)', doubleSided };
    for (const tri of trianglesOf(mesh)) {
      // One key per plane, whichever way it faces; facing is compared later.
      const flip = (Math.abs(tri.n.x) > 1e-6 ? tri.n.x : Math.abs(tri.n.y) > 1e-6 ? tri.n.y : tri.n.z) < 0;
      const n = flip ? tri.n.clone().negate() : tri.n;
      const d = flip ? -tri.d : tri.d;
      const key = `${n.x.toFixed(3)},${n.y.toFixed(3)},${n.z.toFixed(3)}`;
      const slot = Math.round(d / tolerance);
      const entry = { owner, facing: flip ? -1 : 1, d, shape: project(tri.points, n) };
      const list = buckets.get(`${key}|${slot}`) ?? [];
      list.push(entry);
      buckets.set(`${key}|${slot}`, list);
      entry.neighbours = [`${key}|${slot - 1}`, `${key}|${slot}`, `${key}|${slot + 1}`];
    }
  });

  const shared = new Map();
  for (const list of buckets.values()) {
    for (const t of list) {
      for (const key of t.neighbours) {
        for (const u of buckets.get(key) ?? []) {
          if (u.owner.id <= t.owner.id) continue;
          if (Math.abs(u.d - t.d) > tolerance) continue;
          if (u.facing !== t.facing && !u.owner.doubleSided && !t.owner.doubleSided) continue;
          const area = sharedArea(t.shape, u.shape);
          if (area <= 0) continue;
          const pair = `${t.owner.id}:${u.owner.id}`;
          const hit = shared.get(pair) ?? { a: t.owner.name, b: u.owner.name, area: 0 };
          hit.area += area;
          shared.set(pair, hit);
        }
      }
    }
  }
  return [...shared.values()].filter(h => h.area >= minArea).sort((x, y) => y.area - x.area);
}
