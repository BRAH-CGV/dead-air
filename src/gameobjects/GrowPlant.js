import * as THREE from 'three';

// A coffee bush for the grow rack (#168), built in code: a woody main stem,
// branches in opposite pairs, each pair turned a quarter from the one below,
// reaching out nearly level and drooping at the tips; glossy, wavy-edged
// leaves in opposite pairs along every branch; and clusters of beans
// hugging the branches at the leaf nodes, as Coffea arabica carries them.
// A tuft of young leaves at the top.
//
// Three geometries, one per material (stems, leaves, fruit), all coloured by
// vertex so a single material each covers every shade. The beans are a
// pale neutral: the rack tints them per bush (instanceColor) ripe or
// unripe, and hides them once picked. The rack instances them, so
// twelve bushes are three draw calls. Metres, feet at the origin.

export const GROW_PLANT = {
  height: 0.45,
  seed: 1,
};

const STEM_COLOUR = new THREE.Color(0x5a4a2c);   // woody, grey-brown
const SHOOT_COLOUR = new THREE.Color(0x4f6e2c);  // the green young growth
/** Beans are pale and nearly grey: the rack's instance colour is their colour. */
const BEAN_LIGHTNESS = [0.72, 0.92];

/** Mulberry32: small and seedable. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Triangles accumulated as flat arrays, turned into a geometry at the end. */
class Builder {
  position = [];
  normal = [];
  color = [];

  /** Every triangle of `geometry`, moved by `matrix`, in `colour`. */
  addGeometry(geometry, matrix, colour) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.applyMatrix4(matrix);
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      this.position.push(p.getX(i), p.getY(i), p.getZ(i));
      this.normal.push(n.getX(i), n.getY(i), n.getZ(i));
      this.color.push(colour.r, colour.g, colour.b);
    }
    if (g !== geometry) g.dispose();
    geometry.dispose();
  }

  /** One triangle with its own face normal and a colour per corner. */
  addTriangle(a, b, c, ca, cb, cc) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const [v, col] of [[a, ca], [b, cb], [c, cc]]) {
      this.position.push(v.x, v.y, v.z);
      this.normal.push(n.x, n.y, n.z);
      this.color.push(col.r, col.g, col.b);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const SEGMENTS = 4;   // per leaf, tip to base: 16 triangles

/**
 * @param {{ seed?: number, height?: number }} [opts]
 * @returns {{ stems: THREE.BufferGeometry, leaves: THREE.BufferGeometry, fruit: THREE.BufferGeometry }}
 */
export function buildGrowPlant({ seed = GROW_PLANT.seed, height = GROW_PLANT.height } = {}) {
  const rand = rng(seed);
  const range = (a, b) => a + rand() * (b - a);
  const stems = new Builder(), leaves = new Builder(), fruit = new Builder();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();

  /** A tapered stem from `a` to `b`. */
  const stem = (a, b, r0, r1, colour = STEM_COLOUR) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const length = dir.length();
    q.setFromUnitVectors(UP, dir.normalize());
    m4.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    stems.addGeometry(new THREE.CylinderGeometry(r1, r0, length, 5, 1, true), m4, colour);
  };

  /** One leaf: a pointed ellipse along `dir`, creased down its midrib, its
   *  edge rippling (coffee leaves are wavy) and its tip drooping. `face` is
   *  roughly the way its upper side looks. */
  const leaf = (base, dir, face, length, width) => {
    const side = new THREE.Vector3().crossVectors(dir, face).normalize();
    const lift = new THREE.Vector3().crossVectors(side, dir).normalize();
    const hsl = { h: range(0.27, 0.34), s: range(0.5, 0.7), l: range(0.06, 0.12) };
    const edge = new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l);
    const rib = new THREE.Color().setHSL(hsl.h - 0.02, hsl.s, hsl.l + 0.06);
    const droop = range(0.2, 0.45) * length;
    const ripple = width * 0.18, phase = range(0, Math.PI * 2);
    const rows = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const c = base.clone().addScaledVector(dir, length * t).addScaledVector(UP, -droop * t * t);
      const w = width * Math.pow(Math.sin(Math.PI * t), 0.7);
      const wave = ripple * Math.sin(phase + t * 9) * Math.sin(Math.PI * t);
      rows.push([
        c.clone().addScaledVector(side, -w).addScaledVector(lift, wave),
        c.clone().addScaledVector(lift, w * 0.2),
        c.clone().addScaledVector(side, w).addScaledVector(lift, -wave),
      ]);
    }
    for (let i = 0; i < SEGMENTS; i++) {
      const [l0, m0, r0] = rows[i], [l1, m1, r1] = rows[i + 1];
      leaves.addTriangle(l0, m0, m1, edge, rib, rib);
      leaves.addTriangle(l0, m1, l1, edge, rib, edge);
      leaves.addTriangle(m0, r0, r1, rib, edge, edge);
      leaves.addTriangle(m0, r1, m1, rib, edge, rib);
    }
  };

  /** A cluster of beans round the branch at `at`: small ovals, each a
   *  touch lighter or darker, packed tight against the wood. */
  const cluster = (at, along, count) => {
    const across = new THREE.Vector3().crossVectors(along, UP).normalize();
    for (let i = 0; i < count; i++) {
      const r = range(0.0075, 0.0095);
      const angle = (i / count) * Math.PI * 2 + range(-0.4, 0.4);
      const offset = across.clone().multiplyScalar(Math.cos(angle) * r * 1.3)
        .addScaledVector(UP, Math.sin(angle) * r * 1.1 - r * 0.6)
        .addScaledVector(along, range(-0.006, 0.006));
      const l = range(...BEAN_LIGHTNESS);
      m4.compose(at.clone().add(offset), q.setFromUnitVectors(UP, along), new THREE.Vector3(1, 1.25, 1));
      fruit.addGeometry(new THREE.IcosahedronGeometry(r, 0), m4, new THREE.Color(l, l, l * 0.97));
    }
  };

  // The main stem, leaning a little, woody.
  const lean = new THREE.Vector3(range(-0.02, 0.02), 0, range(-0.02, 0.02));
  const stemPoint = h => new THREE.Vector3(lean.x * h / height, h, lean.z * h / height);
  const stemTop = height * 0.92;
  for (let i = 0; i < 4; i++) {
    const h0 = (stemTop * i) / 4, h1 = (stemTop * (i + 1)) / 4;
    stem(stemPoint(h0), stemPoint(h1), 0.009 - i * 0.0015, 0.0075 - i * 0.0015);
  }

  // Branches in opposite pairs, each pair a quarter turn from the last;
  // the lower ones longer, so the bush is a cone.
  const pairs = 6;
  const turn = range(0, Math.PI);
  for (let p = 0; p < pairs; p++) {
    const h = 0.08 + ((stemTop - 0.12) * p) / (pairs - 1) + range(-0.008, 0.008);
    const reach = (0.17 - 0.09 * (p / (pairs - 1))) * range(0.88, 1.08);
    for (const s of [0, Math.PI]) {
      const angle = turn + p * Math.PI / 2 + s + range(-0.25, 0.25);
      const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const base = stemPoint(h);
      // Three points out along it: up a little, then level, then drooping.
      const points = [base];
      for (let k = 1; k <= 3; k++) {
        const t = k / 3;
        points.push(base.clone().addScaledVector(out, reach * t).addScaledVector(UP, reach * (0.18 * t - 0.22 * t * t)));
      }
      for (let k = 0; k < 3; k++) stem(points[k], points[k + 1], 0.0042 - k * 0.0009, 0.0033 - k * 0.0009, k < 2 ? STEM_COLOUR : SHOOT_COLOUR);

      // Leaf pairs at four nodes along it, opposite across it, and the
      // beans at the inner nodes, where the wood is older.
      for (let n = 0; n < 4; n++) {
        const t = 0.3 + 0.7 * (n / 3);
        const seg = Math.min(2, Math.floor(t * 3));
        const at = points[seg].clone().lerp(points[seg + 1], t * 3 - seg);
        const along = new THREE.Vector3().subVectors(points[seg + 1], points[seg]).normalize();
        const across = new THREE.Vector3().crossVectors(along, UP).normalize();
        const size = range(0.055, 0.075) * (n === 3 ? 0.8 : 1);
        for (const side of [-1, 1]) {
          const dir = across.clone().multiplyScalar(side).addScaledVector(along, 0.55).addScaledVector(UP, range(0.0, 0.25)).normalize();
          leaf(at, dir, UP, size, size * range(0.36, 0.44));
        }
        if (n > 0 && n < 3) cluster(at, along, 3 + Math.floor(rand() * 2));
      }
      // A leaf at the very tip.
      leaf(points[3], new THREE.Vector3().subVectors(points[3], points[2]).normalize(), UP, range(0.04, 0.05), 0.016);
    }
  }

  // The tuft at the top: young shoots with small leaves.
  const top = stemPoint(stemTop);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + range(-0.3, 0.3);
    const tip = top.clone().add(new THREE.Vector3(Math.cos(angle) * 0.03, range(0.02, 0.035), Math.sin(angle) * 0.03));
    stem(top, tip, 0.0028, 0.0018, SHOOT_COLOUR);
    const dir = new THREE.Vector3().subVectors(tip, top).normalize();
    leaf(tip, dir.clone().addScaledVector(UP, 0.4).normalize(), UP, range(0.035, 0.045), 0.014);
  }

  return { stems: stems.build(), leaves: leaves.build(), fruit: fruit.build() };
}
