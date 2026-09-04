import * as THREE from 'three';

// ─────────────────────────────────────────────
// ColliderSpec  –  manifest physics block → concrete shape parts
// ─────────────────────────────────────────────
// Pure arithmetic, no Rapier. Turning a human-written `physics: { … }` block
// into shapes with half-extents and offsets is where the fiddly maths lives
// (half vs. full sizes, origin-on-floor offsets, spawn scale), so it sits on
// its own and is unit-tested. `Colliders.js` takes the output and asks Rapier
// for the real thing.
//
// ── The three tiers ──
//   1. `physics: 'static'`         → auto bounding box. One line, no authoring.
//   2. Collider meshes in the .glb → convex hulls. Name them `UCX_*` or
//      `collider_*` in Blender; they are stripped from the render tree at load
//      and picked up automatically by the default shape:'auto'.
//   3. `shape: [ … ]` in the manifest → hand-written compound primitives, for
//      when re-exporting the .glb is more trouble than typing three boxes.
//
// ── Units ──
// Everything a human writes is a FULL size in metres, measured the way you'd
// measure the real object: a 1.6 m wide desk is `size: [1.6, …]`. Rapier wants
// half-extents; that conversion happens here, once, so it can't be forgotten
// at a call site.
// ─────────────────────────────────────────────

/**
 * @typedef {Object} PhysicsSpec  What a manifest entry or spawnModel() carries.
 * @property {'none'|'static'|'dynamic'|'kinematic'} [body='static']
 * @property {ShapeSpec} [shape='auto']
 * @property {number}  [friction=0.8]
 * @property {number}  [restitution=0]
 * @property {number}  [mass]         Dynamic bodies only. Overrides density.
 * @property {number}  [density]      Dynamic bodies only. Default 1000 (water).
 * @property {boolean} [sensor=false] Overlap events, no collision response.
 *
 * @typedef {'auto'|'box'|'hull'|'trimesh'|'none'|ShapePart|ShapePart[]} ShapeSpec
 *
 * @typedef {Object} ShapePart  One primitive in a hand-written compound shape.
 * @property {'box'|'sphere'|'capsule'|'cylinder'|'cone'} type
 * @property {[number,number,number]} [size]     box only — full width/height/depth.
 * @property {number} [radius]                   sphere / capsule / cylinder / cone.
 * @property {number} [height]                   capsule / cylinder / cone — full, tip to tip.
 * @property {[number,number,number]} [position] Offset from the model origin.
 * @property {[number,number,number]} [rotation] Euler XYZ in radians.
 */

export const BODY_TYPES = ['none', 'static', 'dynamic', 'kinematic'];
export const AUTO_SHAPES = ['auto', 'box', 'hull', 'trimesh', 'none'];
export const PART_TYPES  = ['box', 'sphere', 'capsule', 'cylinder', 'cone'];

/** Rapier misbehaves on zero-thickness shapes; floor planes and posters hit it. */
const MIN_HALF_EXTENT = 0.005;

/** Water. A crate at this density weighs what a solid block of it would —
 *  override with `mass` for anything that should feel hollow. */
const DEFAULT_DENSITY = 1000;

const IDENTITY_QUAT = [0, 0, 0, 1];

const _euler = new THREE.Euler();
const _quat  = new THREE.Quaternion();

/**
 * Fold a manifest `physics` block together with any per-spawn override into one
 * fully-populated spec. `physics: 'dynamic'` is shorthand for `{body:'dynamic'}`
 * — a body type and nothing else is the common case.
 *
 * Returns **null** when neither side asked for physics at all. That's what
 * makes collision opt-in: the defaults below only apply once someone has said
 * the word, so adding a decorative model to the manifest can't quietly drop an
 * invisible wall into the level. `body: 'static'` is the default for anything
 * that opts in, not for everything.
 *
 * @param {PhysicsSpec|string} [base]      From the manifest entry.
 * @param {PhysicsSpec|string} [override]  From spawnModel() opts.
 * @returns {PhysicsSpec|null}
 */
export function mergePhysics(base, override) {
  if (base == null && override == null) return null;

  const expand = (v) => (typeof v === 'string' ? { body: v } : v ?? {});
  return {
    body: 'static',
    shape: 'auto',
    friction: 0.8,
    restitution: 0,
    sensor: false,
    ...expand(base),
    ...expand(override),
  };
}

/**
 * Resolve a merged spec into shapes Rapier can be handed directly.
 *
 * @param {PhysicsSpec} spec       Already through `mergePhysics`.
 * @param {Object} [collision]     Load-time geometry, from `AssetManager.getCollision`.
 * @param {{size:number[], center:number[]}} [collision.bounds]
 * @param {Float32Array[]} [collision.hulls]  Point clouds from the `UCX_*` meshes.
 * @param {{vertices:Float32Array, indices:Uint32Array}} [collision.mesh]
 * @param {number} [scale=1]       Extra uniform scale applied at spawn time.
 * @returns {{body:string, parts:Object[], friction:number, restitution:number,
 *            sensor:boolean, mass?:number, density?:number} | null}
 *          null when this asset takes no part in physics.
 */
export function resolvePhysics(spec, collision, scale = 1) {
  if (spec.body === 'none') return null;

  const parts = resolveShape(spec.shape, collision, scale);
  if (!parts.length) return null;

  const resolved = {
    body: spec.body,
    parts,
    friction: spec.friction,
    restitution: spec.restitution,
    sensor: spec.sensor === true,
  };

  // Mass wins when both are given — it's the more direct knob, and silently
  // honouring both would make one of them a no-op mystery.
  if (spec.mass !== undefined) resolved.mass = spec.mass;
  else resolved.density = spec.density ?? DEFAULT_DENSITY;

  return resolved;
}

/**
 * The shape half of `resolvePhysics`, exported for tests and for anything that
 * wants shapes without a body (query volumes, triggers).
 * @returns {Object[]} parts, possibly empty
 */
export function resolveShape(shape, collision, scale = 1) {
  const { bounds, hulls = [], mesh } = collision ?? {};

  // 'auto' is the whole point of the tiering: if the artist modelled collision
  // into the .glb, use it; otherwise fall back to the bounding box, which costs
  // the author nothing. Either way the manifest line is the same.
  if (shape === 'auto') shape = hulls.length ? 'hull' : 'box';

  if (shape === 'none' || !shape) return [];

  if (shape === 'box') {
    return bounds ? [boxFromBounds(bounds, scale)] : [];
  }

  if (shape === 'hull') {
    // Authored hulls first. Only fall back to hulling the render mesh — which
    // can be tens of thousands of points — when the .glb shipped none.
    const clouds = hulls.length ? hulls : (mesh ? [mesh.vertices] : []);
    return clouds
      .filter(points => points.length >= 12)   // 4 points minimum for a 3D hull
      .map(points => ({ kind: 'hull', points: scalePoints(points, scale), ...atOrigin() }));
  }

  if (shape === 'trimesh') {
    if (!mesh) return [];
    return [{
      kind: 'trimesh',
      vertices: scalePoints(mesh.vertices, scale),
      indices: mesh.indices,
      ...atOrigin(),
    }];
  }

  const list = Array.isArray(shape) ? shape : [shape];
  return list.map(part => resolvePart(part, scale)).filter(Boolean);
}

/** Axis-aligned box around the model's measured extents. The offset is the part
 *  that's easy to forget: models are authored origin-on-floor, so the box centre
 *  sits at half the model's height, not at the origin. */
function boxFromBounds(bounds, scale) {
  const [sx, sy, sz] = bounds.size;
  const [cx, cy, cz] = bounds.center;
  return {
    kind: 'cuboid',
    halfExtents: halfExtentsOf(sx, sy, sz, scale),
    position: [cx * scale, cy * scale, cz * scale],
    rotation: IDENTITY_QUAT,
  };
}

/** One hand-written primitive → one Rapier-shaped part. */
function resolvePart(part, scale) {
  const position = (part.position ?? [0, 0, 0]).map(v => v * scale);
  const rotation = part.rotation ? eulerToQuat(part.rotation) : IDENTITY_QUAT;
  const radius   = (part.radius ?? 0.5) * scale;

  // Rapier measures capsules, cylinders and cones by the half-height of the
  // middle segment. For a capsule the two round caps add `radius` on top of
  // that at each end, so the full height the author wrote has to lose them.
  const halfHeight = ((part.height ?? 1) * scale) / 2;

  switch (part.type) {
    case 'box': {
      const [sx = 1, sy = 1, sz = 1] = part.size ?? [];
      return {
        kind: 'cuboid',
        halfExtents: halfExtentsOf(sx, sy, sz, scale),
        position, rotation,
      };
    }

    case 'sphere':
      return { kind: 'ball', radius, position, rotation };

    case 'capsule':
      return {
        kind: 'capsule',
        radius,
        halfHeight: Math.max(halfHeight - radius, MIN_HALF_EXTENT),
        position, rotation,
      };

    case 'cylinder':
      return { kind: 'cylinder', radius, halfHeight, position, rotation };

    case 'cone':
      return { kind: 'cone', radius, halfHeight, position, rotation };

    default:
      console.warn(`[physics] unknown collider shape '${part.type}' — skipped`);
      return null;
  }
}

function halfExtentsOf(sx, sy, sz, scale) {
  return [
    Math.max((sx / 2) * scale, MIN_HALF_EXTENT),
    Math.max((sy / 2) * scale, MIN_HALF_EXTENT),
    Math.max((sz / 2) * scale, MIN_HALF_EXTENT),
  ];
}

function atOrigin() {
  return { position: [0, 0, 0], rotation: IDENTITY_QUAT };
}

function eulerToQuat([x, y, z]) {
  _euler.set(x, y, z, 'XYZ');
  _quat.setFromEuler(_euler);
  return [_quat.x, _quat.y, _quat.z, _quat.w];
}

/** Spawn scale for point clouds. Returns the original array when scale is 1 —
 *  the common case shouldn't pay for a copy of every vertex. */
function scalePoints(points, scale) {
  if (scale === 1) return points;
  const out = new Float32Array(points.length);
  for (let i = 0; i < points.length; i++) out[i] = points[i] * scale;
  return out;
}
