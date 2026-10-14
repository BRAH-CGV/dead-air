import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { flattenModelParts } from '../core/ModelUtils.js';
import { buildGrowPlant } from './GrowPlant.js';

// The food corner's grow rack: a two-tier steel rack of soil trays, each tier
// under a row of UV grow lights, two plants to a tray.
//
//   • Frame, boards, lips, braces, pipes: plain boxes and cylinders, merged
//     by material, so the whole frame is a handful of draw calls.
//   • The grow lights are the ceiling light model (`model:light-ceiling`),
//     flipped to hang face-down, one over each tray, with its glow coloured UV.
//     One InstancedMesh.
//   • The plants are our own cherry-tomato plants (GrowPlant.js), built once
//     and instanced: three InstancedMeshes (stems, leaves, fruit) for all twelve.
//   • No real lights: the light count is compiled into every lit shader. The
//     fixtures glow and the plants carry a faint UV wash of emissive, both
//     found by the PowerGrid, so a power cut darkens them.
//
// Everything is built relative to the rack's middle, the way MainOffice's
// GrowBeds body sits. The light model comes from the AssetManager's cache and
// is shared with every other copy: its geometry is never freed here, and its
// material is cloned before it is tinted.

/** Metres. `size` is the rack's footprint and height; `tiers` the heights of
 *  the two shelf boards from the floor; `trayZ` the three trays along it. */
export const GROW_RACK = {
  size: [0.7, 1.75, 3.75],
  tiers: [0.28, 1.02],
  trayZ: [-1.25, 0, 1.25],
  plantsPerTray: 2,
  seed: 7,
};

/** The grow lights' glow, and the faint wash they leave on the plants. */
export const UV_LIGHT = { color: 0x8a2eff, intensity: 1.4 };
const PLANT_WASH = { color: 0x4b1a8a, intensity: 0.12 };

/** Each plant grows to between these multiples of GROW_PLANT.height. */
const PLANT_SCALE = [0.9, 1.1];

const BOARD = 0.04;        // shelf board thickness
const TRAY_RISE = 0.07;    // tray centre above its board
const SOIL_TOP = 0.125;    // the soil's surface above the board
const ROOT_SINK = 0.05;    // the plants' roots go this far into it

/** Mulberry32: small, seedable, the same plants every build. */
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

/**
 * Build the rack into `target`.
 * @param {THREE.Object3D} target  Where it goes: origin at the rack's middle.
 * @param {object} opts
 * @param {import('../core/AssetManager.js').AssetManager} [opts.assets]
 * @param {(resource: { dispose(): void }) => any} opts.own  Registers what it
 *   made to be freed with the room.
 * @returns {{ fixtures: THREE.InstancedMesh | null, plants: THREE.InstancedMesh[] }}
 */
export function populateGrowRack(target, { assets, own }) {
  const { size, tiers, trayZ, plantsPerTray, seed } = GROW_RACK;
  const [W, H, D] = size;
  const half = H / 2;

  // ── The plain parts: collected, then merged one mesh per material. ──
  const material = {
    steel:  own(new THREE.MeshStandardMaterial({ color: 0x4a545c, roughness: 0.55, metalness: 0.5 })),
    sheet:  own(new THREE.MeshStandardMaterial({ color: 0x2f363c, roughness: 0.6, metalness: 0.4 })),
    tray:   own(new THREE.MeshStandardMaterial({ color: 0x1f2a26, roughness: 0.5 })),
    soil:   own(new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 1 })),
    pipe:   own(new THREE.MeshStandardMaterial({ color: 0x8e9aa3, roughness: 0.4, metalness: 0.2 })),
    band:   own(new THREE.MeshStandardMaterial({ color: 0x2a6fb0, roughness: 0.5 })),
    valve:  own(new THREE.MeshStandardMaterial({ color: 0xa02828, roughness: 0.5 })),
    label:  own(new THREE.MeshStandardMaterial({ color: 0xcfd6dc, roughness: 0.7 })),
  };
  const merged = Object.fromEntries(Object.keys(material).map(k => [k, []]));
  const m4 = new THREE.Matrix4();
  const euler = new THREE.Euler();

  /** Add `geometry` to `kind`'s mesh, centred at (x, y-from-floor, z), turned by `rot`. */
  const put = (kind, geometry, x, y, z, rot = [0, 0, 0]) => {
    m4.makeRotationFromEuler(euler.set(...rot)).setPosition(x, y - half, z);
    merged[kind].push(geometry.applyMatrix4(m4));
  };
  const box = (kind, w, h, d, x, y, z, rot) => put(kind, new THREE.BoxGeometry(w, h, d), x, y, z, rot);
  /** A cylinder along `axis` ('x' | 'y' | 'z'). */
  const pipe = (kind, radius, length, axis, x, y, z) => {
    const rot = axis === 'z' ? [Math.PI / 2, 0, 0] : axis === 'x' ? [0, 0, Math.PI / 2] : [0, 0, 0];
    put(kind, new THREE.CylinderGeometry(radius, radius, length, 10), x, y, z, rot);
  };

  const xs = W / 2 - 0.04;                       // post and rail line, either side
  const postZ = [-(D / 2 - 0.025), -0.625, 0.625, D / 2 - 0.025];   // ends, and in the gaps between trays

  for (const x of [-xs, xs]) {
    for (const z of postZ) {
      box('steel', 0.05, H, 0.05, x, H / 2, z);                  // upright
      box('steel', 0.07, 0.02, 0.05, x, 0.01, z);                // foot plate
    }
  }

  // Back bracing, between the middle posts: an X of flat bar, wall side.
  const bay = postZ[2] - postZ[1];
  const bracing = H - 0.3;
  const lean = Math.atan2(bay, bracing);
  for (const sign of [1, -1]) {
    box('steel', 0.02, Math.hypot(bay, bracing) - 0.06, 0.02, -xs, 0.3 + bracing / 2, 0, [sign * lean, 0, 0]);
  }

  const trays = [];
  tiers.forEach((shelf, tier) => {
    box('sheet', W, BOARD, D, 0, shelf, 0);                      // the board
    for (const x of [-(W / 2 - 0.01), W / 2 - 0.01]) box('sheet', 0.02, 0.05, D, x, shelf + 0.045, 0);          // side lips
    for (const z of [-(D / 2 - 0.01), D / 2 - 0.01]) box('sheet', W - 0.04, 0.05, 0.02, 0, shelf + 0.045, z);   // end lips
    pipe('pipe', 0.018, D - 0.2, 'z', xs - 0.01, shelf + 0.06, 0);                                              // the feed pipe
    trayZ.forEach((z, i) => {
      const tray = new THREE.Mesh(own(new THREE.BoxGeometry(0.52, 0.1, 1.05)), material.tray);
      tray.name = `GrowBed_${tier * 3 + i + 1}`;
      tray.position.set(0, shelf + TRAY_RISE - half, z);
      tray.castShadow = tray.receiveShadow = true;
      trays.push(tray);
      box('soil', 0.46, 0.02, 0.99, 0, shelf + 0.115, z);
      box('label', 0.1, 0.03, 0.005, xs - 0.04, shelf + 0.04, z + 0.4);   // a name plate on the lip
      pipe('pipe', 0.008, 0.05, 'x', 0.28, shelf + 0.1, z);               // the dripper off the feed pipe
    });
  });

  // The hood the top tier's lights hang from.
  box('sheet', W, BOARD, D, 0, H - BOARD / 2, 0);

  // The water riser at one end, with its valve and a blue band.
  const riserZ = D / 2 - 0.075;
  pipe('pipe', 0.022, H - 0.1, 'y', xs, (H - 0.1) / 2, riserZ);
  pipe('band', 0.0235, 0.06, 'y', xs, 1.3, riserZ);
  pipe('valve', 0.03, 0.04, 'y', xs, 0.62, riserZ);
  box('valve', 0.06, 0.015, 0.02, xs, 0.66, riserZ);

  for (const kind of Object.keys(merged)) {
    if (merged[kind].length === 0) continue;
    const geometry = own(mergeGeometries(merged[kind]));
    merged[kind].forEach(g => g.dispose());
    const mesh = new THREE.Mesh(geometry, material[kind]);
    mesh.name = `Grow_${kind}`;
    mesh.castShadow = mesh.receiveShadow = true;
    target.add(mesh);
  }
  for (const tray of trays) target.add(tray);

  // ── The grow lights: the ceiling light, flipped, one over each tray. ──
  const lightParts = flattenModelParts('model:light-ceiling', assets);
  const hangY = [tiers[1] - BOARD / 2, H - BOARD];               // the underside it hangs from, per tier
  const fixtureMatrices = [];
  hangY.forEach(y => {
    for (const z of trayZ) {
      fixtureMatrices.push(new THREE.Matrix4()
        .makeRotationX(Math.PI)                                  // glow side down
        .setPosition(0, y - half, z));
    }
  });
  const fixtures = instance('GrowLights', lightParts, fixtureMatrices, part => {
    const m = own((Array.isArray(part.material) ? part.material[0] : part.material).clone());
    m.emissive.setHex(UV_LIGHT.color);
    m.emissiveIntensity = UV_LIGHT.intensity;
    return m;
  }, { castShadow: false });

  if (!fixtures) {
    // No model: one glowing strip along each tier.
    const strip = own(new THREE.BoxGeometry(0.06, 0.04, D - 0.2));
    const lamp = own(new THREE.MeshStandardMaterial({
      color: 0x1a0a30, emissive: UV_LIGHT.color, emissiveIntensity: UV_LIGHT.intensity,
    }));
    hangY.forEach((y, tier) => {
      const mesh = new THREE.Mesh(strip, lamp);
      mesh.name = `GrowLight_${tier + 1}`;
      mesh.position.set(0, y - 0.03 - half, 0);
      target.add(mesh);
    });
  }

  // ── The plants: two to a tray, each its own height and way round. ──
  const plant = buildGrowPlant({ seed });
  const plantMaterial = {
    stems:  { roughness: 0.8 },
    leaves: { roughness: 0.65, side: THREE.DoubleSide },
    fruit:  { roughness: 0.3 },
  };
  const plantParts = Object.keys(plantMaterial).map(name => ({
    kind: name, geometry: own(plant[name]), matrix: new THREE.Matrix4(),
  }));
  const rand = rng(seed);
  const plantMatrices = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3();
  for (const shelf of tiers) {
    for (const z of trayZ) {
      for (let i = 0; i < plantsPerTray; i++) {
        const along = (i - (plantsPerTray - 1) / 2) * 0.5 + (rand() - 0.5) * 0.08;
        const s = PLANT_SCALE[0] + rand() * (PLANT_SCALE[1] - PLANT_SCALE[0]);
        plantMatrices.push(new THREE.Matrix4().compose(
          new THREE.Vector3((rand() - 0.5) * 0.03, shelf + SOIL_TOP - ROOT_SINK - half, z + along),
          q.setFromAxisAngle(up, rand() * Math.PI * 2),
          scale.setScalar(s),
        ));
      }
    }
  }
  const plants = instancedAll('GrowPlants', plantParts, plantMatrices, part => own(new THREE.MeshStandardMaterial({
    vertexColors: true,
    emissive: PLANT_WASH.color,
    emissiveIntensity: PLANT_WASH.intensity,
    ...plantMaterial[part.kind],
  })), { castShadow: false });

  return { fixtures: fixtures ?? null, plants };

  // ── Instancing helpers, closed over target and own. ──
  /** The first part of a model, instanced at `matrices`. */
  function instance(name, parts, matrices, makeMaterial, opts) {
    return instancedAll(name, parts.slice(0, 1), matrices, makeMaterial, opts)[0] ?? null;
  }

  /** Every part of a model, each its own InstancedMesh over the same placements. */
  function instancedAll(name, parts, matrices, makeMaterial, { castShadow }) {
    const out = [];
    const composed = new THREE.Matrix4();
    parts.forEach((part, p) => {
      const mesh = own(new THREE.InstancedMesh(part.geometry, makeMaterial(part), matrices.length));
      mesh.name = part.kind ? `${name}_${part.kind}` : p === 0 ? name : `${name}_${p}`;
      matrices.forEach((m, i) => mesh.setMatrixAt(i, composed.multiplyMatrices(m, part.matrix)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;     // the bounding sphere of one instance would cull the rest
      target.add(mesh);
      out.push(mesh);
    });
    return out;
  }
}
