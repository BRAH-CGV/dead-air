import RAPIER from '@dimforge/rapier3d';

// ─────────────────────────────────────────────
// Colliders  –  resolved shape parts → real Rapier bodies and colliders
// ─────────────────────────────────────────────
// The thin Rapier-facing half of the collider pipeline. All the arithmetic
// happened in ColliderSpec.js; this file only translates vocabulary.
// ─────────────────────────────────────────────

const BODY_DESCS = {
  static:    () => RAPIER.RigidBodyDesc.fixed(),
  dynamic:   () => RAPIER.RigidBodyDesc.dynamic(),
  kinematic: () => RAPIER.RigidBodyDesc.kinematicPositionBased(),
};

/**
 * Create the rigid body for a resolved physics spec, positioned to match the
 * GameObject's transform.
 *
 * The transform matters more than it looks: `Engine._syncPhysicsToScene` copies
 * the body's transform onto the Object3D every fixed step, so a body left at
 * the origin would yank the model there on the first frame.
 *
 * @param {RAPIER.World} world
 * @param {{body:string}} resolved     From `resolvePhysics`.
 * @param {Object} [transform]
 * @param {[number,number,number]} [transform.position]
 * @param {number} [transform.rotationY]  Yaw in radians.
 * @returns {RAPIER.RigidBody}
 */
export function createBody(world, resolved, { position = [0, 0, 0], rotationY = 0 } = {}) {
  const makeDesc = BODY_DESCS[resolved.body];
  if (!makeDesc) throw new Error(`[physics] unknown body type '${resolved.body}'`);

  const desc = makeDesc().setTranslation(position[0], position[1], position[2]);

  // Yaw only — quaternion around +Y, written out rather than pulling in a
  // THREE.Quaternion for one axis.
  if (rotationY !== 0) {
    desc.setRotation({
      x: 0, y: Math.sin(rotationY / 2), z: 0, w: Math.cos(rotationY / 2),
    });
  }

  return world.createRigidBody(desc);
}

/**
 * Attach every part of a resolved spec to a body as a collider. Several parts
 * on one body is how compound shapes work — Rapier has no separate compound
 * type, a body simply owns more than one collider.
 *
 * @param {RAPIER.World} world
 * @param {RAPIER.RigidBody} body
 * @param {Object} resolved            From `resolvePhysics`.
 * @param {string} [label]             Asset key, for readable warnings.
 * @returns {RAPIER.Collider[]}
 */
export function attachColliders(world, body, resolved, label = 'collider') {
  const colliders = [];

  for (const part of resolved.parts) {
    const desc = describe(part, label);
    if (!desc) continue;

    desc.setTranslation(part.position[0], part.position[1], part.position[2]);
    desc.setRotation({
      x: part.rotation[0], y: part.rotation[1], z: part.rotation[2], w: part.rotation[3],
    });

    desc.setFriction(resolved.friction);
    desc.setRestitution(resolved.restitution);
    if (resolved.sensor) desc.setSensor(true);

    // Mass and density are per-collider in Rapier and sum over the body. Split
    // a requested mass across the parts so a two-box desk doesn't weigh double.
    if (resolved.mass !== undefined) desc.setMass(resolved.mass / resolved.parts.length);
    else if (resolved.density !== undefined) desc.setDensity(resolved.density);

    colliders.push(world.createCollider(desc, body));
  }

  return colliders;
}

/** One resolved part → one ColliderDesc, or null if Rapier rejected it. */
function describe(part, label) {
  switch (part.kind) {
    case 'cuboid':
      return RAPIER.ColliderDesc.cuboid(...part.halfExtents);

    case 'ball':
      return RAPIER.ColliderDesc.ball(part.radius);

    case 'capsule':
      return RAPIER.ColliderDesc.capsule(part.halfHeight, part.radius);

    case 'cylinder':
      return RAPIER.ColliderDesc.cylinder(part.halfHeight, part.radius);

    case 'cone':
      return RAPIER.ColliderDesc.cone(part.halfHeight, part.radius);

    case 'hull': {
      // convexHull returns null (rather than throwing) when the points are
      // degenerate — coplanar, or fewer than four. Unchecked, a mis-authored
      // UCX_ mesh would silently become no collision at all.
      const desc = RAPIER.ColliderDesc.convexHull(part.points);
      if (!desc) {
        console.warn(
          `[physics] '${label}': convex hull failed — the collider mesh is ` +
          'degenerate (flat or fewer than 4 points). Give it volume in Blender.',
        );
      }
      return desc;
    }

    case 'trimesh':
      return RAPIER.ColliderDesc.trimesh(part.vertices, part.indices);

    default:
      console.warn(`[physics] '${label}': unknown collider kind '${part.kind}'`);
      return null;
  }
}
