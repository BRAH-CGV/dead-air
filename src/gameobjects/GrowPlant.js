import * as THREE from 'three';

// A cherry-tomato plant for the grow rack, built in code: a main stem, side
// shoots each carrying a compound leaf of leaflets, a tuft at the top, and
// trusses of fruit hanging under the shoots, mostly ripe red, a few still
// orange or green. Bushy enough to read as a crop from across the office.
//
// Three geometries, one per material (stems, leaves, fruit), all coloured by
// vertex so a single material each covers every shade. The rack instances
// them, so twelve plants are three draw calls. Metres, feet at the origin.

export const GROW_PLANT = {
  height: 0.45,
  seed: 1,
};

const STEM_COLOUR = new THREE.Color(0x4f6e2c);
const FRUIT = [
  { colour: new THREE.Color(0xa83a30), share: 0.65 },  // ripe
  { colour: new THREE.Color(0xb8743c), share: 0.2 },   // turning
  { colour: new THREE.Color(0x7a9a4a), share: 0.15 },  // green
];

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
const SEGMENTS = 3;   // per leaflet, tip to base: 12 triangles

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
  const stem = (a, b, r0, r1) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const length = dir.length();
    q.setFromUnitVectors(UP, dir.normalize());
    m4.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    stems.addGeometry(new THREE.CylinderGeometry(r1, r0, length, 5, 1, true), m4, STEM_COLOUR);
  };

  /** One leaflet: a pointed oval along `dir`, creased down its midrib, its
   *  tip drooping. `face` is roughly the way its upper side looks. */
  const leaflet = (base, dir, face, length, width) => {
    const side = new THREE.Vector3().crossVectors(dir, face).normalize();
    const lift = new THREE.Vector3().crossVectors(side, dir).normalize();
    const hsl = { h: range(0.25, 0.32), s: range(0.55, 0.75), l: range(0.09, 0.17) };
    const edge = new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l);
    const rib = new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l + 0.05);
    const droop = range(0.15, 0.4) * length;
    const rows = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const c = base.clone().addScaledVector(dir, length * t).addScaledVector(UP, -droop * t * t);
      const w = width * Math.pow(Math.sin(Math.PI * t), 0.8);
      rows.push([
        c.clone().addScaledVector(side, -w),
        c.clone().addScaledVector(lift, w * 0.25),
        c.clone().addScaledVector(side, w),
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

  /** A compound leaf along a shoot from `a` to `b`: leaflets in pairs and
   *  one at the tip. */
  const compoundLeaf = (a, b, pairs, size) => {
    const along = new THREE.Vector3().subVectors(b, a).normalize();
    const across = new THREE.Vector3().crossVectors(along, UP);
    if (across.lengthSq() < 1e-6) across.set(1, 0, 0);
    across.normalize();
    for (let i = 0; i < pairs; i++) {
      const t = 0.3 + (0.7 * i) / pairs;
      const at = a.clone().lerp(b, t);
      for (const s of [-1, 1]) {
        const dir = across.clone().multiplyScalar(s).addScaledVector(along, 0.6).addScaledVector(UP, range(0.05, 0.35)).normalize();
        leaflet(at, dir, UP, size * range(0.8, 1.15), size * range(0.38, 0.5));
      }
    }
    leaflet(b, along.clone().addScaledVector(UP, 0.2).normalize(), UP, size * 1.1, size * 0.4);
  };

  /** A truss: a short stalk, then a cluster of fruit hanging under it. */
  const fruitColour = forceGreen => {
    if (forceGreen) return FRUIT[2].colour;
    let r = rand();
    for (const f of FRUIT) { if ((r -= f.share) <= 0) return f.colour; }
    return FRUIT[0].colour;
  };
  const truss = (from, count, forceGreen) => {
    const hang = from.clone().add(new THREE.Vector3(range(-0.01, 0.01), -0.03, range(-0.01, 0.01)));
    stem(from, hang, 0.0025, 0.002);
    for (let i = 0; i < count; i++) {
      const r = range(0.014, 0.019);
      const at = hang.clone().add(new THREE.Vector3(range(-0.03, 0.03), -r - range(0, 0.03), range(-0.03, 0.03)));
      const tint = fruitColour(forceGreen && i === 0).clone().offsetHSL(range(-0.01, 0.01), 0, range(-0.04, 0.04));
      m4.compose(at, q.identity(), new THREE.Vector3(1, range(0.9, 1), 1));
      fruit.addGeometry(new THREE.IcosahedronGeometry(r, 1), m4, tint);
    }
  };

  // The main stem, leaning a little.
  const lean = new THREE.Vector3(range(-0.03, 0.03), 0, range(-0.03, 0.03));
  const stemPoint = h => new THREE.Vector3(lean.x * h / height, h, lean.z * h / height);
  const stemTop = height * 0.9;
  for (let i = 0; i < 4; i++) {
    const h0 = (stemTop * i) / 4, h1 = (stemTop * (i + 1)) / 4;
    stem(stemPoint(h0), stemPoint(h1), 0.009 - i * 0.0015, 0.0075 - i * 0.0015);
  }

  // Side shoots, spiralling up, each a compound leaf; the lower ones longer.
  const shoots = 15;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const trussFrom = [];
  for (let i = 0; i < shoots; i++) {
    const h = 0.07 + ((stemTop - 0.1) * i) / (shoots - 1) + range(-0.01, 0.01);
    const angle = i * golden + range(-0.3, 0.3);
    const rise = range(0.35, 0.8);
    const reach = (0.17 - 0.08 * (i / shoots)) * range(0.85, 1.1);
    const base = stemPoint(h);
    const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const mid = base.clone().addScaledVector(out, reach * 0.5).addScaledVector(UP, reach * rise * 0.6);
    const tip = base.clone().addScaledVector(out, reach).addScaledVector(UP, reach * rise * 0.5);
    stem(base, mid, 0.004, 0.0032);
    stem(mid, tip, 0.0032, 0.002);
    compoundLeaf(base, tip, 6, range(0.06, 0.075));
    if (h > 0.16 && h < stemTop - 0.08 && i % 2 === 1) trussFrom.push(base.clone().lerp(tip, 0.55));   // every other shoot, out along it
  }

  // The tuft at the top: young shoots with smaller leaves.
  const top = stemPoint(stemTop);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + range(-0.4, 0.4);
    const tip = top.clone().add(new THREE.Vector3(Math.cos(angle) * 0.05, range(0.02, 0.04), Math.sin(angle) * 0.05));
    stem(top, tip, 0.003, 0.0018);
    compoundLeaf(top, tip, 3, range(0.035, 0.045));
  }

  // Trusses of fruit under the middle shoots; the last one keeps a green one.
  trussFrom.forEach((at, i) => truss(at, 2 + Math.floor(rand() * 2), i === trussFrom.length - 1));

  return { stems: stems.build(), leaves: leaves.build(), fruit: fruit.build() };
}
