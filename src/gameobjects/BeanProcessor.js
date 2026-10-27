import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ─────────────────────────────────────────────
// BeanProcessor  –  the office's coffee bean processor (#168)
// ─────────────────────────────────────────────
// Where the grow rack's coffee beans become ground coffee. A hopper on its
// side, toward the bin, takes the beans in (its lid stood up against the
// cabinet, a COFFEE BEANS IN plate and a caution for the burrs, a throat
// into the cabinet under it, its mouth at chest height so a pile is easily
// dropped in). A feed pipe comes in from the grow beds on the other side
// with a red valve wheel, a porthole shows the process chamber lit amber
// with the burrs' paddles across it, a small status screen and three lamps
// tell how it is doing, and a lit bay at waist height, under a GROUND
// COFFEE plate, is where a bag of coffee drops out of its chute for each
// batch ground (a CoffeeBag, placed by the scene at BAG_SPOTS). A
// coffee-brown band across the front under its top; a conduit up to the
// ceiling; an access panel with vents and a dark plinth finish the cabinet.
//
//   const parts = buildBeanProcessor(go.object3d, { own, labels, ceiling });
//
// It is drawn into the collider's GameObject, whose origin is the box's
// middle (MainOffice): x is out of the front, z along the wall (−z toward
// the grow beds), y up. Parts are built from the floor up and baked into
// their geometry, then merged by material: a handful of draw calls. The
// glows (window, screen, lamps, button, bay light) are emissive, so the
// PowerGrid dims them with the room's.
//
// Three parts are left apart for the CoffeeProcessor to move, none of them
// casting a shadow (the shadow maps are frozen): `paddles`, on a pivot in
// the porthole's middle, turned about x while it grinds; `lid`, the
// hopper's, on its hinge by the cabinet (rotation.x 0 shut over the mouth,
// LID_OPEN stood up); and `load`, beans down in the funnel, hidden until
// there are some.
//
// What is solid is PROCESSOR_SOLIDS, boxes round the bay (not one box over
// the whole machine), so a bag stands in the bay and the ray reaches it.
// NEAR_PROCESSOR is the box round the machine a pile of beans let go in is
// taken from.
//
// The plates read from one atlas (`tex:processor-labels`, drawn by
// scripts/make-processor-labels.mjs), a strip each (PROCESSOR_LABELS).
// It owns its geometries and materials, never the atlas.
// ─────────────────────────────────────────────

/** Metres. The box it fills (the cabinet; the hopper juts out of its +z
 *  side); the cabinet's top;
 *  the bay's floor and ceiling; how far back the bay goes (its back
 *  wall's face, x); the hopper's middle, its foot and mouth, its height
 *  and the height of its foot off the floor. */
export const PROCESSOR = Object.freeze({
  size: [0.7, 1.7, 0.9],
  cabinetTop: 1.45,
  bay: [0.72, 1.0],
  bayBack: 0.01,
  bayHalfWidth: 0.32,
  hopper: Object.freeze({ x: 0.02, z: 0.67, foot: 0.22, mouth: 0.4, height: 0.24, base: 1.06 }),
});

/** Where the bags of ground coffee stand in the bay: their feet, in the
 *  collider's space (origin at the box's middle). */
export const BAG_SPOTS = Object.freeze([-0.085, 0.085].map(z => Object.freeze([0.16, PROCESSOR.bay[0] + 0.015 - PROCESSOR.size[1] / 2, z])));

/** What is solid, as boxes in the collider's space: the cabinet under the
 *  bay, the back and cheeks round it and the cabinet over it, up to the
 *  top, and the hopper as a box it catches beans on top of (the ray finds
 *  it too). The bay is left open. @type {{ size: number[], at: number[] }[]} */
export const PROCESSOR_SOLIDS = (() => {
  const [w, h, d] = PROCESSOR.size, front = w / 2;
  const [b0, b1] = PROCESSOR.bay, back = PROCESSOR.bayBack, half = PROCESSOR.bayHalfWidth;
  const top = PROCESSOR.cabinetTop, cheek = d / 2 - half, y = v => v - h / 2;
  return Object.freeze([
    { size: [w, b0, d], at: [0, y(b0 / 2), 0] },
    { size: [front + back, b1 - b0, d], at: [(back - front) / 2, y((b0 + b1) / 2), 0] },
    ...[-1, 1].map(s => ({ size: [front - back, b1 - b0, cheek], at: [(back + front) / 2, y((b0 + b1) / 2), s * (half + cheek / 2)] })),
    { size: [w, top - b1, d], at: [0, y((b1 + top) / 2), 0] },
    (({ x, z, mouth, height, base }) => ({ size: [mouth, height, mouth], at: [x, y(base + height / 2), z] }))(PROCESSOR.hopper),
  ]);
})();

/** Round the machine, in the collider's space: a pile of beans let go in
 *  here (on the floor in front of it or by the hopper, on the hopper, on
 *  top) is taken in. Not behind it (the wall) nor toward the grow beds,
 *  where a pile picked with full hands is left. */
export const NEAR_PROCESSOR = (() => {
  const [w, h, d] = PROCESSOR.size, { z, mouth } = PROCESSOR.hopper;
  return Object.freeze({ min: [-w / 2, -h / 2 - 0.05, -d / 2], max: [w / 2 + 0.9, h / 2 + 0.4, z + mouth / 2 + 0.45] });
})();

/** The hopper lid's rotation.x, open: stood up against the cabinet. */
export const LID_OPEN = -Math.PI / 2;

/** The label atlas's strips, top to bottom. */
export const PROCESSOR_LABELS = Object.freeze({ name: 0, bay: 1, hopper: 2, caution: 3 });

const PALETTE = {
  steel:  { color: 0x3a4148, roughness: 0.6, metalness: 0.4 },
  dark:   { color: 0x15181b, roughness: 0.9 },
  trim:   { color: 0x5a646c, roughness: 0.5, metalness: 0.5 },
  pipe:   { color: 0x8e9aa3, roughness: 0.4, metalness: 0.2 },
  valve:  { color: 0xa02828, roughness: 0.5 },
  accent: { color: 0x5c3a22, roughness: 0.6, metalness: 0.2 },
  load:   { color: 0x4e2a20, roughness: 0.5 },
  window: { color: 0x1a1208, emissive: 0xffa040, emissiveIntensity: 0.5, roughness: 0.2 },
  screen: { color: 0x0a140e, emissive: 0x6dff9c, emissiveIntensity: 0.7, roughness: 0.3 },
  lampGo:   { color: 0x08140c, emissive: 0x6dff9c, emissiveIntensity: 0.8 },
  lampWait: { color: 0x14100a, emissive: 0xffb347, emissiveIntensity: 0.5 },
  lampStop: { color: 0x140808, emissive: 0xff4a3c, emissiveIntensity: 0.25 },
  button:   { color: 0x200808, emissive: 0xff5a3c, emissiveIntensity: 0.9 },
  bayLight: { color: 0x302820, emissive: 0xffe2b0, emissiveIntensity: 1 },
  labels:   { color: 0xcfd6dc, roughness: 0.7 },
};

const FRONT = PROCESSOR.size[0] / 2;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1);

/**
 * Build the processor into `target`.
 * @param {THREE.Object3D} target  The collider's object, origin at the box's middle.
 * @param {{ own: (r: any) => any, labels?: THREE.Texture|null, ceiling?: number }} opts
 *   `ceiling`: the room's height, for the conduit.
 * @returns {Record<string, THREE.Mesh> & { lamps: THREE.Mesh[] }}
 *   The meshes, by part; `lamps` go, wait, stop.
 */
export function buildBeanProcessor(target, { own, labels = null, ceiling = 3 }) {
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

  const [w, , d] = PROCESSOR.size;
  const [bay0, bay1] = PROCESSOR.bay;
  const bayH = bay1 - bay0, bayMid = (bay0 + bay1) / 2, half = PROCESSOR.bayHalfWidth;
  const top = PROCESSOR.cabinetTop;

  // ── Cabinet ──
  box('dark', [w - 0.08, 0.08, d - 0.08], [-0.02, 0.04, 0]);                       // plinth
  box('steel', [w, bay0 - 0.08, d], [0, (0.08 + bay0) / 2, 0]);                     // lower
  const backDepth = PROCESSOR.bayBack + FRONT;
  box('steel', [backDepth, bayH, d], [-FRONT + backDepth / 2, bayMid, 0]);          // behind the bay
  const cheek = d / 2 - half;
  for (const s of [-1, 1]) {
    box('steel', [FRONT - PROCESSOR.bayBack, bayH, cheek], [(PROCESSOR.bayBack + FRONT) / 2, bayMid, s * (half + cheek / 2)]);
  }
  box('steel', [w, top - 0.03 - bay1, d], [0, (bay1 + top - 0.03) / 2, 0]);         // upper
  box('trim', [w + 0.015, 0.03, d], [0.0075, top - 0.015, 0]);                     // top cap, proud at the front
  box('accent', [0.004, 0.09, d - 0.02], [FRONT + 0.002, top - 0.075, 0]);         // the brown band the name plate sits on

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
  box('dark', [0.004, bayH, 2 * half], [PROCESSOR.bayBack + 0.002, bayMid, 0]);     // its back, in shadow
  box('trim', [FRONT - PROCESSOR.bayBack, 0.012, 2 * half], [(PROCESSOR.bayBack + FRONT) / 2, bay0 + 0.006, 0]);   // grille floor
  box('trim', [0.05, 0.03, 2 * half + 0.04], [FRONT + 0.01, bay0 + 0.015, 0]);      // the lip
  box('trim', [0.012, 0.03, 2 * half + 0.04], [FRONT + 0.006, bay1 + 0.015, 0]);    // the frame
  for (const s of [-1, 1]) box('trim', [0.012, bayH + 0.06, 0.03], [FRONT + 0.006, bayMid, s * (half + 0.015)]);
  box('bayLight', [0.25, 0.01, 2 * half - 0.12], [0.16, bay1 - 0.006, 0]);
  // The chute the coffee drops down, out of the bay's ceiling.
  add('chute', new THREE.CylinderGeometry(0.05, 0.03, 0.07, 12, 1, true), [0.14, bay1 - 0.035, 0]);
  // The dispense button on the bay's right cheek, in a collar.
  disc('trim', 0.045, 0.012, [FRONT + 0.006, bayMid, half + cheek / 2]);
  disc('button', 0.034, 0.03, [FRONT + 0.015, bayMid, half + cheek / 2]);

  // ── The process window, the screen and the lamps ──
  const port = { y: 1.22, z: -0.17, r: 0.095 };
  add('trim', new THREE.TorusGeometry(port.r, 0.02, 8, 24), [FRONT + 0.006, port.y, port.z], [0, Math.PI / 2, 0]);
  disc('window', port.r, 0.01, [FRONT + 0.002, port.y, port.z], 24);
  box('dark', [0.008, 0.12, 0.22], [FRONT + 0.004, 1.28, 0.2]);                     // the screen's bezel
  box('screen', [0.01, 0.1, 0.2], [FRONT + 0.006, 1.28, 0.2]);
  const lampKeys = ['lampGo', 'lampWait', 'lampStop'];
  lampKeys.forEach((key, i) => disc(key, 0.016, 0.012, [FRONT + 0.006, 1.17, 0.13 + i * 0.07], 12));

  // ── The hopper ──
  const hop = PROCESSOR.hopper;
  const hopBase = hop.base, hopTop = hopBase + hop.height;
  const funnel = new THREE.CylinderGeometry(hop.mouth * Math.SQRT1_2, hop.foot * Math.SQRT1_2, hop.height, 4, 1, true)
    .rotateY(Math.PI / 4).toNonIndexed();
  funnel.computeVertexNormals();
  const hopper = funnel;
  add('hopper', hopper, [hop.x, hopBase + hop.height / 2, hop.z]);
  // Its throat into the cabinet's side, and a strut under it: from low on
  // the cabinet's side up and out to the hopper's foot.
  const wallZ = d / 2, footZ = hop.z - hop.foot / 2;
  box('steel', [hop.foot, 0.08, footZ - wallZ + 0.02], [hop.x, hopBase + 0.03, (wallZ + footZ) / 2]);
  const rise = 0.32, out = hop.z - wallZ;
  box('trim', [0.03, Math.hypot(rise, out), 0.03], [hop.x, hopBase - rise / 2, wallZ + out / 2], [Math.atan2(out, rise), 0, 0]);
  box('dark', [hop.mouth - 0.04, 0.004, hop.mouth - 0.04], [hop.x, hopTop - 0.03, hop.z]);   // its mouth, dark
  for (const s of [-1, 1]) {
    box('accent', [hop.mouth + 0.02, 0.025, 0.02], [hop.x, hopTop, hop.z + s * hop.mouth / 2]);
    box('accent', [0.02, 0.025, hop.mouth], [hop.x + s * hop.mouth / 2, hopTop, hop.z]);
  }

  // ── Pipes ──
  // Out of its side toward the grow beds, its flange stopping just short of
  // the rack's end (0.145 m off in the office), so the two never touch.
  const pipeAt = { x: -0.2, y: 1.15 }, pipeFrom = -d / 2, pipeTo = -d / 2 - 0.13;
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
    const rows = Object.keys(PROCESSOR_LABELS).length;
    const g = new THREE.PlaneGeometry(width, width / 8).rotateY(Math.PI / 2);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (row + 1 - uv.getY(i)) / rows);
    g.applyMatrix4(_m.compose(new THREE.Vector3(...at), _q.setFromEuler(_e.set(...turn)), _s));
    plates.push(g);
  };
  plate(PROCESSOR_LABELS.name, 0.48, [FRONT + 0.003, top - 0.075, 0]);
  plate(PROCESSOR_LABELS.bay, 0.32, [FRONT + 0.003, bay1 + 0.05, 0]);
  // On the hopper's front, which leans out as it rises: the plates face a
  // little down, toward a standing eye.
  const lean = Math.atan2((hop.mouth - hop.foot) / 2, hop.height);
  const onHopper = y => [hop.x + hop.foot / 2 + (hop.mouth - hop.foot) / 2 * ((y - hopBase) / hop.height) + 0.003, y, hop.z];
  plate(PROCESSOR_LABELS.hopper, 0.28, onHopper(hopBase + 0.17), [0, 0, -lean]);
  plate(PROCESSOR_LABELS.caution, 0.22, onHopper(hopBase + 0.08), [0, 0, -lean]);
  buckets.labels = plates;

  // ── Merge by material ──
  const body = new THREE.Group();
  body.name = 'ProcessorBody';
  body.position.y = -PROCESSOR.size[1] / 2;
  target.add(body);
  const materialFor = key => {
    if (key === 'hopper') return { ...PALETTE.steel, side: THREE.DoubleSide };   // an open funnel, seen inside
    if (key === 'pipes') return PALETTE.pipe;
    if (key === 'chute') return PALETTE.trim;
    if (key === 'labels') return { ...PALETTE.labels, color: labels ? 0xffffff : PALETTE.labels.color, map: labels };
    return PALETTE[key];
  };
  const parts = { lamps: [] };
  for (const [key, list] of Object.entries(buckets)) {
    const geometry = own(mergeGeometries(list.map(g => (g.index ? g.toNonIndexed() : g))));
    const mesh = new THREE.Mesh(geometry, own(new THREE.MeshStandardMaterial(materialFor(key))));
    mesh.name = `Processor_${key}`;
    mesh.castShadow = !PALETTE[key]?.emissive && key !== 'labels';
    mesh.receiveShadow = true;
    body.add(mesh);
    if (lampKeys.includes(key)) parts.lamps.push(mesh);
    else parts[key] = mesh;
  }

  // ── The moving parts, apart from the merge ──
  /** A mesh of its own in the body, shadowless (it moves under frozen maps). */
  const loose = (name, geometry, key, at, visible = true) => {
    const mesh = new THREE.Mesh(own(geometry), own(new THREE.MeshStandardMaterial(PALETTE[key])));
    mesh.name = `Processor_${name}`;
    mesh.position.set(...at);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.visible = visible;
    body.add(mesh);
    return mesh;
  };

  // The burrs' paddles across the porthole: two bars and a hub, about x.
  const paddle = [Math.PI / 4, -Math.PI / 4].map(a => new THREE.BoxGeometry(0.004, 2 * port.r - 0.02, 0.022).rotateX(a));
  paddle.push(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 10).rotateZ(Math.PI / 2).translate(0.001, 0, 0));
  parts.paddles = loose('paddles', mergeGeometries(paddle.map(g => g.toNonIndexed())), 'dark', [FRONT + 0.009, port.y, port.z]);
  paddle.forEach(g => g.dispose());

  // The hopper's lid, on its hinge by the cabinet: open, stood up.
  parts.lid = loose('lid', new THREE.BoxGeometry(hop.mouth + 0.02, 0.015, hop.mouth + 0.02).translate(0, 0, hop.mouth / 2 + 0.01),
    'steel', [hop.x, hopTop + 0.02, hop.z - hop.mouth / 2]);
  parts.lid.rotation.x = LID_OPEN;

  // Beans down in the funnel, a heap of small beads.
  const heap = [];
  const inside = (hop.foot + (hop.mouth - hop.foot) * 0.55) / 2 - 0.03;
  for (let i = 0; i < 18; i++) {
    const a = i * 2.39996, r = inside * Math.sqrt((i + 0.5) / 18);
    heap.push(new THREE.IcosahedronGeometry(0.022, 0).translate(Math.cos(a) * r, 0.012 * Math.cos(i * 1.7), Math.sin(a) * r));
  }
  parts.load = loose('load', mergeGeometries(heap), 'load', [hop.x, hopBase + hop.height * 0.5, hop.z], false);
  heap.forEach(g => g.dispose());

  return parts;
}
