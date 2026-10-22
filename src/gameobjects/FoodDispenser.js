import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ─────────────────────────────────────────────
// FoodDispenser  –  the office's nutrient processor (#109)
// ─────────────────────────────────────────────
// Where the grow beds' crop becomes a crew's daily meal, read top to
// bottom: a hopper on top takes the raw crop in (its lid propped open, a
// RAW CROP IN plate and a caution for the blades), a feed pipe comes in
// from the grow beds beside it with a red valve wheel, a porthole shows the
// process chamber lit amber with the mixer's paddles across it, a small
// status screen and three lamps tell how it is doing, and a lit bay at
// waist height holds an empty compartment tray under a DAILY RATION plate,
// a dispense button on its cheek. A conduit runs up to the ceiling; an
// access panel with vents and a dark plinth finish the cabinet.
//
//   buildFoodDispenser(go.object3d, { own, labels, ceiling });
//
// It is drawn into the collider's GameObject, whose origin is the box's
// middle (MainOffice): x is out of the front, z along the wall (−z toward
// the grow beds), y up. Parts are built from the floor up and baked into
// their geometry, then merged by material: a handful of draw calls. The
// glows (window, screen, lamps, button, bay light) are emissive, so the
// PowerGrid dims them with the room's. Nothing here moves or is used yet;
// the interaction comes later.
//
// The plates read from one atlas (`tex:dispenser-labels`, drawn by
// scripts/make-dispenser-labels.mjs), a strip each (DISPENSER_LABELS).
// It owns its geometries and materials, never the atlas.
// ─────────────────────────────────────────────

/** Metres. The box it fills; the cabinet's top (the hopper stands on it);
 *  the meal bay's floor and ceiling; how far back the bay goes (its back
 *  wall's face, x); the hopper's place, its foot and mouth and height. */
export const DISPENSER = Object.freeze({
  size: [0.7, 1.9, 0.9],
  cabinetTop: 1.65,
  bay: [0.8, 1.18],
  bayBack: 0.01,
  bayHalfWidth: 0.32,
  hopper: Object.freeze({ x: -0.06, z: -0.08, foot: 0.34, mouth: 0.5, height: 0.21 }),
});

/** The label atlas's strips, top to bottom. */
export const DISPENSER_LABELS = Object.freeze({ name: 0, ration: 1, crop: 2, caution: 3 });

const PALETTE = {
  steel:  { color: 0x3a4148, roughness: 0.6, metalness: 0.4 },
  dark:   { color: 0x15181b, roughness: 0.9 },
  trim:   { color: 0x5a646c, roughness: 0.5, metalness: 0.5 },
  pipe:   { color: 0x8e9aa3, roughness: 0.4, metalness: 0.2 },
  valve:  { color: 0xa02828, roughness: 0.5 },
  tray:   { color: 0x8c959a, roughness: 0.45, metalness: 0.3 },
  window: { color: 0x1a1208, emissive: 0xffa040, emissiveIntensity: 0.5, roughness: 0.2 },
  screen: { color: 0x0a140e, emissive: 0x6dff9c, emissiveIntensity: 0.7, roughness: 0.3 },
  lampGo:   { color: 0x08140c, emissive: 0x6dff9c, emissiveIntensity: 0.8 },
  lampWait: { color: 0x14100a, emissive: 0xffb347, emissiveIntensity: 0.5 },
  lampStop: { color: 0x140808, emissive: 0xff4a3c, emissiveIntensity: 0.25 },
  button:   { color: 0x200808, emissive: 0xff5a3c, emissiveIntensity: 0.9 },
  bayLight: { color: 0x302820, emissive: 0xffe2b0, emissiveIntensity: 1 },
  labels:   { color: 0xcfd6dc, roughness: 0.7 },
};

const FRONT = DISPENSER.size[0] / 2;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1);

/**
 * Build the dispenser into `target`.
 * @param {THREE.Object3D} target  The collider's object, origin at the box's middle.
 * @param {{ own: (r: any) => any, labels?: THREE.Texture|null, ceiling?: number }} opts
 *   `ceiling`: the room's height, for the conduit.
 * @returns {Record<string, THREE.Mesh> & { lamps: THREE.Mesh[] }}  The meshes, by part.
 */
export function buildFoodDispenser(target, { own, labels = null, ceiling = 3 }) {
  const buckets = {};
  /** Bake a part into its material's bucket: at `at`, turned by `turn` (Euler XYZ). */
  const add = (key, geometry, at, turn = [0, 0, 0]) => {
    geometry.applyMatrix4(_m.compose(new THREE.Vector3(...at), _q.setFromEuler(_e.set(...turn)), _s));
    (buckets[key] ??= []).push(geometry);
  };
  const box = (key, size, at, turn) => add(key, new THREE.BoxGeometry(...size), at, turn);
  /** A cylinder lying along x, facing out of the front. */
  const disc = (key, radius, depth, at, segments = 20) =>
    add(key, new THREE.CylinderGeometry(radius, radius, depth, segments), at, [0, 0, Math.PI / 2]);

  const [w, , d] = DISPENSER.size;
  const [bay0, bay1] = DISPENSER.bay;
  const bayH = bay1 - bay0, bayMid = (bay0 + bay1) / 2, half = DISPENSER.bayHalfWidth;
  const top = DISPENSER.cabinetTop;

  // ── Cabinet ──
  box('dark', [w - 0.08, 0.08, d - 0.08], [-0.02, 0.04, 0]);                       // plinth
  box('steel', [w, bay0 - 0.08, d], [0, (0.08 + bay0) / 2, 0]);                     // lower
  const backDepth = DISPENSER.bayBack + FRONT;
  box('steel', [backDepth, bayH, d], [-FRONT + backDepth / 2, bayMid, 0]);          // behind the bay
  const cheek = d / 2 - half;
  for (const s of [-1, 1]) {
    box('steel', [FRONT - DISPENSER.bayBack, bayH, cheek], [(DISPENSER.bayBack + FRONT) / 2, bayMid, s * (half + cheek / 2)]);
  }
  box('steel', [w, top - 0.03 - bay1, d], [0, (bay1 + top - 0.03) / 2, 0]);         // upper
  box('trim', [w + 0.015, 0.03, d], [0.0075, top - 0.015, 0]);                     // top cap, proud at the front

  // Access panel on the lower front: a seam round it, vents low down.
  const lower = { y0: 0.16, y1: bay0 - 0.06, z: 0.35 };
  for (const y of [lower.y0, lower.y1]) box('dark', [0.006, 0.012, 2 * lower.z], [FRONT + 0.003, y, 0]);
  for (const s of [-1, 1]) box('dark', [0.006, lower.y1 - lower.y0, 0.012], [FRONT + 0.003, (lower.y0 + lower.y1) / 2, s * lower.z]);
  for (let k = 0; k < 5; k++) box('dark', [0.008, 0.012, 0.42], [FRONT + 0.004, 0.22 + k * 0.03, 0]);
  // Bolts at the panels' corners.
  for (const y of [0.11, bay0 - 0.03, bay1 + 0.04, top - 0.07]) {
    for (const s of [-1, 1]) disc('dark', 0.008, 0.008, [FRONT + 0.004, y, s * 0.42], 8);
  }

  // ── The meal bay ──
  box('dark', [0.004, bayH, 2 * half], [DISPENSER.bayBack + 0.002, bayMid, 0]);     // its back, in shadow
  box('trim', [FRONT - DISPENSER.bayBack, 0.012, 2 * half], [(DISPENSER.bayBack + FRONT) / 2, bay0 + 0.006, 0]);   // grille floor
  box('trim', [0.05, 0.03, 2 * half + 0.04], [FRONT + 0.01, bay0 + 0.015, 0]);      // the lip
  box('trim', [0.012, 0.03, 2 * half + 0.04], [FRONT + 0.006, bay1 + 0.015, 0]);    // the frame
  for (const s of [-1, 1]) box('trim', [0.012, bayH + 0.06, 0.03], [FRONT + 0.006, bayMid, s * (half + 0.015)]);
  box('bayLight', [0.25, 0.01, 2 * half - 0.12], [0.16, bay1 - 0.006, 0]);
  // An empty meal tray: a dish and two sides, waiting.
  const trayAt = [0.19, bay0 + 0.012, 0];
  box('tray', [0.24, 0.022, 0.34], [trayAt[0], trayAt[1] + 0.011, 0]);
  box('dark', [0.2, 0.004, 0.15], [trayAt[0], trayAt[1] + 0.022, -0.08]);
  for (const x of [-0.055, 0.055]) box('dark', [0.09, 0.004, 0.13], [trayAt[0] + x, trayAt[1] + 0.022, 0.085]);
  // The dispense button on the bay's right cheek, in a collar.
  disc('trim', 0.045, 0.012, [FRONT + 0.006, bayMid, half + cheek / 2]);
  disc('button', 0.034, 0.03, [FRONT + 0.015, bayMid, half + cheek / 2]);

  // ── The process window, the screen and the lamps ──
  const port = { y: 1.4, z: -0.17, r: 0.11 };
  add('trim', new THREE.TorusGeometry(port.r, 0.02, 8, 24), [FRONT + 0.006, port.y, port.z], [0, Math.PI / 2, 0]);
  disc('window', port.r, 0.01, [FRONT + 0.002, port.y, port.z], 24);
  for (const a of [Math.PI / 4, -Math.PI / 4]) box('dark', [0.004, 2 * port.r - 0.02, 0.022], [FRONT + 0.009, port.y, port.z], [a, 0, 0]);
  disc('dark', 0.022, 0.012, [FRONT + 0.01, port.y, port.z], 10);
  box('dark', [0.008, 0.12, 0.22], [FRONT + 0.004, 1.49, 0.2]);                     // the screen's bezel
  box('screen', [0.01, 0.1, 0.2], [FRONT + 0.006, 1.49, 0.2]);
  const lampKeys = ['lampGo', 'lampWait', 'lampStop'];
  lampKeys.forEach((key, i) => disc(key, 0.016, 0.012, [FRONT + 0.006, 1.36, 0.13 + i * 0.07], 12));

  // ── The hopper ──
  const hop = DISPENSER.hopper;
  const hopTop = top + hop.height;
  const funnel = new THREE.CylinderGeometry(hop.mouth * Math.SQRT1_2, hop.foot * Math.SQRT1_2, hop.height, 4, 1, true)
    .rotateY(Math.PI / 4).toNonIndexed();
  funnel.computeVertexNormals();
  const hopper = funnel;
  add('hopper', hopper, [hop.x, top + hop.height / 2, hop.z]);
  box('dark', [hop.mouth - 0.04, 0.004, hop.mouth - 0.04], [hop.x, hopTop - 0.03, hop.z]);   // its mouth, dark
  for (const s of [-1, 1]) {
    box('trim', [hop.mouth + 0.02, 0.025, 0.02], [hop.x, hopTop, hop.z + s * hop.mouth / 2]);
    box('trim', [0.02, 0.025, hop.mouth], [hop.x + s * hop.mouth / 2, hopTop, hop.z]);
  }
  // Its lid, hinged at the back edge and propped open.
  const lid = new THREE.BoxGeometry(hop.mouth, 0.015, hop.mouth).translate(hop.mouth / 2, 0, 0);
  add('hopper', lid, [hop.x - hop.mouth / 2, hopTop + 0.01, hop.z], [0, 0, THREE.MathUtils.degToRad(58)]);

  // ── Pipes ──
  // Out of its side toward the grow beds, its flange stopping just short of
  // the rack's end (0.145 m off in the office), so the two never touch.
  const pipeAt = { x: -0.2, y: 1.3 }, pipeFrom = -d / 2, pipeTo = -d / 2 - 0.13;
  add('pipes', new THREE.CylinderGeometry(0.028, 0.028, pipeFrom - pipeTo, 12), [pipeAt.x, pipeAt.y, (pipeFrom + pipeTo) / 2], [Math.PI / 2, 0, 0]);
  for (const z of [pipeFrom - 0.008, pipeTo + 0.02]) {
    add('pipes', new THREE.CylinderGeometry(0.04, 0.04, 0.015, 12), [pipeAt.x, pipeAt.y, z], [Math.PI / 2, 0, 0]);
  }
  const valveZ = (pipeFrom + pipeTo) / 2;
  add('valve', new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6), [pipeAt.x, pipeAt.y + 0.05, valveZ]);
  add('valve', new THREE.TorusGeometry(0.045, 0.007, 6, 16), [pipeAt.x, pipeAt.y + 0.075, valveZ], [Math.PI / 2, 0, 0]);
  add('pipes', new THREE.CylinderGeometry(0.025, 0.025, ceiling - top, 10), [-0.28, (top + ceiling) / 2, d / 2 - 0.09]);
  add('pipes', new THREE.BoxGeometry(0.08, 0.02, 0.08), [-0.28, ceiling - 0.01, d / 2 - 0.09]);

  // ── Plates ──
  const plates = [];
  const plate = (row, width, at, turn = [0, 0, 0]) => {
    const rows = Object.keys(DISPENSER_LABELS).length;
    const g = new THREE.PlaneGeometry(width, width / 8).rotateY(Math.PI / 2);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (row + 1 - uv.getY(i)) / rows);
    g.applyMatrix4(_m.compose(new THREE.Vector3(...at), _q.setFromEuler(_e.set(...turn)), _s));
    plates.push(g);
  };
  plate(DISPENSER_LABELS.name, 0.48, [FRONT + 0.003, top - 0.075, 0]);
  plate(DISPENSER_LABELS.ration, 0.32, [FRONT + 0.003, bay1 + 0.05, 0]);
  // On the hopper's front, which leans out as it rises: the plates face a
  // little down, toward a standing eye.
  const lean = Math.atan2((hop.mouth - hop.foot) / 2, hop.height);
  const onHopper = y => [hop.x + hop.foot / 2 + (hop.mouth - hop.foot) / 2 * ((y - top) / hop.height) + 0.003, y, hop.z];
  plate(DISPENSER_LABELS.crop, 0.3, onHopper(top + 0.14), [0, 0, -lean]);
  plate(DISPENSER_LABELS.caution, 0.24, onHopper(top + 0.06), [0, 0, -lean]);
  buckets.labels = plates;

  // ── Merge by material ──
  const body = new THREE.Group();
  body.name = 'DispenserBody';
  body.position.y = -DISPENSER.size[1] / 2;
  target.add(body);
  const materialFor = key => {
    if (key === 'hopper') return { ...PALETTE.steel, side: THREE.DoubleSide };   // an open funnel, seen inside
    if (key === 'pipes') return PALETTE.pipe;
    if (key === 'labels') return { ...PALETTE.labels, color: labels ? 0xffffff : PALETTE.labels.color, map: labels };
    return PALETTE[key];
  };
  const parts = { lamps: [] };
  for (const [key, list] of Object.entries(buckets)) {
    const geometry = own(mergeGeometries(list.map(g => (g.index ? g.toNonIndexed() : g))));
    const mesh = new THREE.Mesh(geometry, own(new THREE.MeshStandardMaterial(materialFor(key))));
    mesh.name = `Dispenser_${key}`;
    mesh.castShadow = !PALETTE[key]?.emissive && key !== 'labels';
    mesh.receiveShadow = true;
    body.add(mesh);
    if (lampKeys.includes(key)) parts.lamps.push(mesh);
    else parts[key] = mesh;
  }
  return parts;
}
