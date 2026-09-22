import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from '../core/GameObject.js';
import { flattenModelParts } from '../core/ModelUtils.js';
import { BASE_FOOTPRINT, YARD } from './BaseYard.js';
import { terrainHeightAt } from './MarsTerrain.js';

// ─────────────────────────────────────────────
// PerimeterFence  –  chain-link around the compound
// ─────────────────────────────────────────────
// A single rectangle drawn around the base and its parking apron, tiled edge
// to edge with the chain-link panel, with a gate cut wherever a lane in the
// vegetation belt crosses it. It follows BaseYard's own footprint and parking
// constants, so it grows or shrinks with the same numbers the scenery already
// answers to — it is not a second, independent guess at where the property
// line is.
//
//   const belt = createMarsVegetation({ ... });
//   this._outside.addChild(createPerimeterFence({ lanes: belt.lanes, assets }));
//
// ── Why one rectangle, not the yard's true outline ──
// BaseYard's cleared ground is a union of rounded shapes — the building shell,
// the parking apron, the dish track — because scenery wants soft edges. A
// fence wants straight runs and square corners, and the parking apron sits
// entirely within the building shell's own width, so the union of the two is
// already a plain rectangle in every dimension that matters here. Simpler to
// build, simpler to gate, and there is nothing about a property fence that
// benefits from following a rounded corner.
//
// ── Why the panel's own materials are replaced outright ──
// The download's two materials both lean entirely on
// KHR_materials_pbrSpecularGlossiness — every colour and every texture is
// inside that extension, nothing sits in the plain glTF material as a
// fallback. Three's GLTFLoader does not implement that extension (it was
// deprecated well before this three version; grep the loader source and it
// is not there), so it silently drops the whole block and the spec's own
// defaults take over: white, fully metallic, fully rough, no texture at all.
// That is "white walls with weird visual things going on" exactly — the
// panel becomes a flat white, alpha-blended card with nothing cutting the
// diamond pattern out of it. There's nothing to patch in the loaded material
// because the data it would need was never parsed in the first place, so
// both parts get a plain material of our own instead: dark galvanised steel
// for the posts and rail, and a small procedural lattice standing in for the
// diamond mesh.
//
// ── Gates ──
// Each lane is a bearing out from the origin. The rectangle's edge in that
// direction is found by the standard ray-vs-box slab test — the smallest
// positive distance at which the ray crosses one of the four half-planes —
// which works for any bearing and does not assume which side of the rectangle
// it lands on. A gate is cut on whichever side that turns out to be, centred
// on the crossing and at least COMM wide enough for the lane itself, or the
// buggy, whichever asks for more.
// ─────────────────────────────────────────────

/** How many times the diamond pattern repeats across one panel's width and
 *  height. Lower reads as bigger diamonds. */
const LATTICE_REPEAT = [5, 3];

export const FENCE = {
  /** Clear walkway kept between the building and the wire, on the three sides
   *  that are not the parking apron. */
  buffer: 6,
  /** Clearance beyond the parking apron's own far edge, on the front side. */
  frontBuffer: 3,
  /** Metres. At least this wide regardless of the lane it sits on — enough
   *  for the buggy and someone walking beside it. */
  minGateWidth: 6,
  /** Panels are tiled to fit a run exactly, but not stretched or squeezed
   *  past this much or the chain-link pattern visibly distorts. A run this
   *  far from a whole number of panels is vanishingly unlikely at these
   *  lengths, so the clamp is a guard rail, not a expected case. */
  maxPanelStretch: 0.15,
  /** Real metres, matching the manifest's scale correction — see
   *  chainlink-fence's entry there. Kept here too because the collider needs
   *  a height and has no geometry of its own to measure it from. */
  height: 2.4,
  /** How thick a run's collider is, front to back. Thin: a fence is a line
   *  you cannot cross, not a wall with depth worth colliding into the side
   *  of. */
  colliderThickness: 0.15,
};

/**
 * The rectangle the fence runs around: the building shell plus its buffer,
 * unioned with the parking apron plus its own front buffer. The parking apron
 * is narrower than the building, so this union is already a plain rectangle —
 * see the header.
 */
export function perimeterRect() {
  const { buffer, frontBuffer } = FENCE;
  const { halfX, halfZ } = BASE_FOOTPRINT;
  const p = YARD.parking;

  const minX = Math.min(-halfX - buffer, p.x - p.halfX);
  const maxX = Math.max(halfX + buffer, p.x + p.halfX);
  const minZ = Math.min(-halfZ - buffer, p.z - p.halfZ);
  const maxZ = Math.max(halfZ + buffer, p.z + p.halfZ + frontBuffer);

  return {
    minX, maxX, minZ, maxZ,
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    halfX: (maxX - minX) / 2,
    halfZ: (maxZ - minZ) / 2,
  };
}

/**
 * Build the fence.
 *
 * @param {Object} [opts]
 * @param {Array<{bearing: number, halfWidth: number}>} [opts.lanes]
 *        gates are cut where these cross the rectangle — pass the belt's own
 *        `lanes`, so the fence opens exactly where the vegetation does
 * @param {import('../core/AssetManager.js').AssetManager} [opts.assets]
 *        omit to get the rectangle and its gates with no geometry — useful
 *        headless, and for anything that wants to know where the gaps are
 * @param {(x: number, z: number) => number} [opts.heightAt]
 * @returns {GameObject} a group carrying the fence panels
 */
export function createPerimeterFence(opts = {}) {
  const { lanes = [], assets, world, heightAt = terrainHeightAt } = opts;

  const fence = new GameObject('PerimeterFence');
  // A group, so the editor neither lists every panel nor measures a bounding
  // box the width of the compound.
  fence.makeGroup();

  const rect = perimeterRect();
  fence.rect = rect;

  const gates = lanes.map(lane => gateFor(lane, rect)).filter(Boolean);
  fence.gates = gates;

  // The panel's own local +X is the axis it repeats along. A plain
  // makeRotationY(theta) sends local +X to world (cos theta, 0, -sin theta),
  // so lining that up with the world axis each side actually runs along needs
  // theta = 0 for the two sides that run along world X, and theta = -PI/2 for
  // the two that run along world Z. Which of the pair (N vs S, W vs E) makes
  // no difference to that alignment, only to which face of the panel ends up
  // outward, and the geometry is symmetric enough that it does not matter.
  const sides = [
    { name: 'S', fixed: rect.minZ, from: rect.minX, to: rect.maxX, along: 'x', facing: 0 },
    { name: 'N', fixed: rect.maxZ, from: rect.minX, to: rect.maxX, along: 'x', facing: 0 },
    { name: 'W', fixed: rect.minX, from: rect.minZ, to: rect.maxZ, along: 'z', facing: -Math.PI / 2 },
    { name: 'E', fixed: rect.maxX, from: rect.minZ, to: rect.maxZ, along: 'z', facing: -Math.PI / 2 },
  ];

  // The same open runs answer both what to draw and what to collide with, so
  // a gate can never end up solid in one and not the other.
  const runsBySide = sides.map(side => {
    const sideGates = mergeGates(
      gates.filter(g => g.side === side.name).map(g => [g.at - g.halfWidth, g.at + g.halfWidth]),
      FENCE.minGateWidth,
    );
    return { side, runs: openRuns(side.from, side.to, sideGates, FENCE.minGateWidth) };
  });

  attachColliders(world, fence, runsBySide, heightAt);

  if (assets) {
    const parts = flattenModelParts('model:chainlink-fence', assets);
    const panelWidth = parts.length > 0 ? partsSpan(parts) : 0;

    if (panelWidth > 0) {
      const placements = [];
      for (const { side, runs } of runsBySide) {
        for (const [start, end] of runs) tileRun(side, start, end, panelWidth, heightAt, placements);
      }
      buildInstancedParts(fence, parts, placements);
    }
  }

  return fence;
}

/**
 * One thin static box per open run, so the fence actually stops the player —
 * a property line is the one piece of this scenery whose entire purpose is to
 * be an obstacle, unlike the rocks or the belt.
 *
 * A run rather than a panel: the visual tiling can slice a run into a dozen
 * pieces to fit the model's width, but the collider does not care about that
 * and one box per run is a fraction of the cost.
 */
function attachColliders(world, fence, runsBySide, heightAt) {
  if (!world?.createRigidBody) return;

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
  const colliders = [];
  const halfHeight = FENCE.height / 2;
  const halfThickness = FENCE.colliderThickness / 2;

  for (const { side, runs } of runsBySide) {
    for (const [start, end] of runs) {
      const centre = (start + end) / 2;
      const halfLength = (end - start) / 2;
      const x = side.along === 'x' ? centre : side.fixed;
      const z = side.along === 'x' ? side.fixed : centre;
      const halfExtents = side.along === 'x'
        ? [halfLength, halfHeight, halfThickness]
        : [halfThickness, halfHeight, halfLength];

      colliders.push(world.createCollider(
        RAPIER.ColliderDesc.cuboid(...halfExtents)
          .setTranslation(x, heightAt(x, z) + halfHeight, z),
        body,
      ));
    }
  }

  fence.rigidBody = body;
  fence.colliders = colliders;
  fence.collider  = colliders[0] ?? null;
}

/**
 * Where a lane crosses the rectangle, and how wide the gate there should be.
 * Returns null for a lane that — for whatever reason — never leaves the
 * rectangle, so a scene passed a lane that does not reach this far.
 *
 * `lane.gateOffset` slides the gate along the side it lands on without
 * touching the lane's own bearing — for the dish road, whose actual driven
 * path sits off to one side of the wide clearing the belt cuts for it, so the
 * wire should not open across the whole clearing, only the part something
 * drives through.
 */
function gateFor(lane, rect) {
  const dx = Math.cos(lane.bearing);
  const dz = Math.sin(lane.bearing);

  // Standard ray-vs-box slab test. The origin is always inside this
  // rectangle — it contains the building the lanes are measured from — so the
  // smaller of the two positive crossings is the one exit point, and which
  // axis produced it says which side it is on.
  const tx = (dx === 0 ? Infinity : (dx > 0 ? rect.maxX : rect.minX) / dx);
  const tz = (dz === 0 ? Infinity : (dz > 0 ? rect.maxZ : rect.minZ) / dz);
  if (!isFinite(Math.min(tx, tz))) return null;

  const halfWidth = Math.max(FENCE.minGateWidth / 2, lane.halfWidth ?? 0);
  const offset = lane.gateOffset ?? 0;

  if (tx <= tz) {
    return { side: dx > 0 ? 'E' : 'W', at: dz * tx + offset, halfWidth };
  }
  return { side: dz > 0 ? 'N' : 'S', at: dx * tz + offset, halfWidth };
}

/**
 * Fold overlapping gates together, and close any sliver between two of them
 * too narrow to stand a panel in.
 *
 * Lanes are laid out independently of this rectangle, so two of them can
 * surface a few centimetres apart on the same side. Left alone that leaves a
 * run far shorter than one panel, which the tiler would then fill with a
 * squeezed panel sticking out into both gates.
 */
function mergeGates(intervals, panelWidth) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged = [];

  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    // Treat a gap narrower than half a panel as no gap at all.
    if (last && start - last[1] < panelWidth * 0.5) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  return merged;
}

/** A side's run from `from` to `to`, with each gate's interval removed. Runs
 *  too short to stand a panel in are dropped — a wider gate reads as a gate,
 *  where a lone squeezed panel reads as a mistake. */
function openRuns(from, to, gates, panelWidth) {
  const runs = [];
  let cursor = from;

  for (const [gateStart, gateEnd] of gates) {
    if (gateStart > cursor) runs.push([cursor, Math.min(gateStart, to)]);
    cursor = Math.max(cursor, gateEnd);
    if (cursor >= to) break;
  }
  if (cursor < to) runs.push([cursor, to]);

  return runs.filter(([start, end]) => end - start >= panelWidth * 0.5);
}

/** Panels along one straight run, uniformly scaled to fit it exactly rather
 *  than left short or overlapping. */
function tileRun(side, start, end, panelWidth, heightAt, out) {
  const length = end - start;
  const count = Math.max(1, Math.round(length / panelWidth));
  const stretch = length / (count * panelWidth);

  // A run this far from a whole number of panel widths would visibly distort
  // the chain-link pattern; clamping is a guard rail against a future change
  // to the rectangle's numbers, not an expected case at today's sizes.
  const scale = THREE.MathUtils.clamp(
    stretch, 1 - FENCE.maxPanelStretch, 1 + FENCE.maxPanelStretch,
  );

  for (let i = 0; i < count; i++) {
    const centre = start + (i + 0.5) * (length / count);
    const x = side.along === 'x' ? centre : side.fixed;
    const z = side.along === 'x' ? side.fixed : centre;
    out.push({ x, z, y: heightAt(x, z), rotationY: side.facing, scale });
  }
}

/** How wide one instance of the model reads along its own local X — the axis
 *  the panel repeats along. */
function partsSpan(parts) {
  const box = new THREE.Box3();
  const partBox = new THREE.Box3();
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    partBox.copy(part.geometry.boundingBox).applyMatrix4(part.matrix);
    box.union(partBox);
  }
  return box.max.x - box.min.x;
}

/** One InstancedMesh per model part, placed at every tiled position. */
function buildInstancedParts(fence, parts, placements) {
  if (placements.length === 0) return;

  const local = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  const lattice = latticeMaterial();
  const steel = steelMaterial();

  parts.forEach((part, p) => {
    // pPlane* is the wire mesh, pCube* the posts and top rail — see the
    // header for why neither uses the material the download shipped with.
    const material = /Plane/.test(part.name ?? '') ? lattice : steel;
    const mesh = new THREE.InstancedMesh(part.geometry, material, placements.length);
    mesh.name = `FencePanel_${p}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    placements.forEach((placement, i) => {
      world.makeRotationY(placement.rotationY);
      // Only the tiling axis (the panel's local X) stretches to fit — the
      // thickness (local Z) stays true, or the wire mesh reads as thicker
      // than it is.
      world.scale(new THREE.Vector3(placement.scale, 1, 1));
      world.setPosition(placement.x, placement.y, placement.z);
      mesh.setMatrixAt(i, local.multiplyMatrices(world, part.matrix));
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    fence.object3d.add(mesh);
  });
}

/** Dark galvanised steel for the posts and top rail — the same look
 *  `CommTowers` gives its masts, so the site's steelwork reads as one kind of
 *  material rather than a different grey for every structure. */
function steelMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.85, metalness: 0.6 });
}

/**
 * A small diamond lattice, tiled over the wire mesh as both colour and alpha.
 *
 * Built as raw pixels rather than drawn on a canvas — the same reason
 * `CommTowers`' beacon glow is a DataTexture: it costs nothing at load and
 * works with no 2D context, which a headless test environment does not have.
 *
 * One instance is shared by every panel; the lattice looks the same on all of
 * them, so there's nothing to gain from building it twice.
 */
let _latticeMaterial = null;
function latticeMaterial() {
  if (_latticeMaterial) return _latticeMaterial;

  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // A diamond grid: the classic chain-link cell is two crossed diagonals,
      // so distance to the nearer of the two diagonals decides wire or gap.
      const u = x / size - 0.5;
      const v = y / size - 0.5;
      const d = Math.min(Math.abs(u + v), Math.abs(u - v));
      const wire = d < 0.06 ? 255 : 0;

      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = wire ? 60 : 0;
      data[i + 3] = wire;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Coarser again than a real chain-link cell: this is meant to read as a
  // fence from the distance the player actually sees it at, not survive
  // walking up and inspecting the wire. LATTICE_REPEAT is the one number to
  // retune if it still looks wrong — lower is coarser.
  texture.repeat.set(LATTICE_REPEAT[0], LATTICE_REPEAT[1]);
  texture.needsUpdate = true;

  _latticeMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    alphaMap: texture,
    transparent: true,
    side: THREE.DoubleSide,
    roughness: 0.8,
    metalness: 0.4,
    color: 0x8a8a86,
  });
  return _latticeMaterial;
}
