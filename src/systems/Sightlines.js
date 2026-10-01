import * as THREE from 'three';

// ─────────────────────────────────────────────
// Sightlines  –  what can be seen from indoors, and splitting off the rest
// ─────────────────────────────────────────────
// The base is a closed box with one way to see out of it: its windows. (The
// airlock hatch is the other opening, but the interlock never has it open
// while the inner door is — see Airlock.) So from anywhere inside, an
// outdoor object can only be on screen if it lies beyond the wall of some
// window. Everything else outdoors can stop being drawn while the player is
// indoors.
//
// The windows are read off the rooms' own `openings` (a sill above the floor
// is a window, per Room's opening schema), so redesigning the office — moving
// the window, adding one — re-derives all of this. Nothing here knows which
// room has the window.
//
// Helpers, all pure:
//   windowHalfSpaces(rooms)         one half-space per window
//   sphereSeenThroughWindows(...)   could this be on screen from inside?
//   boxSeenThroughWindows(...)
//   partitionInstances(mesh, keep)  split one InstancedMesh in two by that test
//   collectHideable(root, isFixed)  the parts of a room that can be hidden
// ─────────────────────────────────────────────

/**
 * @typedef {{ axis: 'x'|'z', sign: 1|-1, limit: number }} HalfSpace
 *   Points with `sign * p[axis] > sign * limit` are beyond the window's wall.
 */

/**
 * One half-space per window: everything beyond the wall the window is in,
 * measured from the wall's inner face (a ray from inside the room can only
 * reach past that plane through the opening).
 *
 * @param {Array<{position:number[], width:number, depth:number, wallThick:number,
 *                openings?: Array<{side:string, sill?:number}>}>} rooms
 * @returns {HalfSpace[]}
 */
export function windowHalfSpaces(rooms) {
  const spaces = [];
  for (const room of rooms) {
    const [ox, , oz] = room.position;
    const t = room.wallThick ?? 0;
    for (const opening of room.openings ?? []) {
      if (!((opening.sill ?? 0) > 0)) continue;
      switch (opening.side) {
        case 'back':  spaces.push({ axis: 'z', sign: -1, limit: round(oz - room.depth / 2 + t / 2) }); break;
        case 'front': spaces.push({ axis: 'z', sign:  1, limit: round(oz + room.depth / 2 - t / 2) }); break;
        case 'left':  spaces.push({ axis: 'x', sign: -1, limit: round(ox - room.width / 2 + t / 2) }); break;
        case 'right': spaces.push({ axis: 'x', sign:  1, limit: round(ox + room.width / 2 - t / 2) }); break;
      }
    }
  }
  return spaces;
}

/** Could any part of `sphere` be seen through one of the windows?
 *  @param {THREE.Sphere} sphere  World space
 *  @param {HalfSpace[]} spaces */
export function sphereSeenThroughWindows(sphere, spaces) {
  for (const { axis, sign, limit } of spaces) {
    const reach = sign * sphere.center[axis] + sphere.radius;
    if (reach > sign * limit) return true;
  }
  return false;
}

/** Could any part of `box` be seen through one of the windows?
 *  @param {THREE.Box3} box  World space
 *  @param {HalfSpace[]} spaces */
export function boxSeenThroughWindows(box, spaces) {
  for (const { axis, sign, limit } of spaces) {
    const reach = sign > 0 ? box.max[axis] : -box.min[axis];
    if (reach > sign * limit) return true;
  }
  return false;
}

const _instance = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _color = new THREE.Color();

/**
 * Split an InstancedMesh into the instances `keep` accepts and the rest, as
 * two meshes sharing the original's geometry and material — one more draw
 * call at most, and nothing uploaded twice. Each instance is judged by its
 * world-space bounding sphere, so a tree whose canopy leans over the line
 * counts as over it.
 *
 * The halves replace the original under its parent (the original is
 * detached); if every instance lands on one side, the mesh is left alone.
 * Call before the first render, so the original's instance buffer was never
 * uploaded.
 *
 * @param {THREE.InstancedMesh} mesh
 * @param {(sphere: THREE.Sphere) => boolean} keep
 * @returns {{ kept: THREE.InstancedMesh|null, moved: THREE.InstancedMesh|null }}
 */
export function partitionInstances(mesh, keep) {
  mesh.updateWorldMatrix(true, false);
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  const local = mesh.geometry.boundingSphere;

  const kept = [];
  const moved = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, _instance);
    _world.multiplyMatrices(mesh.matrixWorld, _instance);
    _sphere.copy(local).applyMatrix4(_world);
    (keep(_sphere) ? kept : moved).push(i);
  }

  if (moved.length === 0) return { kept: mesh, moved: null };
  if (kept.length === 0) return { kept: null, moved: mesh };

  const parent = mesh.parent;
  const keptMesh = copyInstances(mesh, kept, mesh.name);
  const movedMesh = copyInstances(mesh, moved, `${mesh.name}:moved`);
  if (parent) {
    const at = parent.children.indexOf(mesh);
    parent.remove(mesh);
    parent.add(keptMesh, movedMesh);
    // add() appends; put the halves where the original was, so sibling
    // order (and anything relying on it) is unchanged.
    parent.children.splice(parent.children.length - 2, 2);
    parent.children.splice(at, 0, keptMesh, movedMesh);
  }
  return { kept: keptMesh, moved: movedMesh };
}

function copyInstances(source, indices, name) {
  const mesh = new THREE.InstancedMesh(source.geometry, source.material, indices.length);
  mesh.name = name;
  mesh.position.copy(source.position);
  mesh.quaternion.copy(source.quaternion);
  mesh.scale.copy(source.scale);
  mesh.castShadow = source.castShadow;
  mesh.receiveShadow = source.receiveShadow;
  mesh.frustumCulled = source.frustumCulled;
  mesh.renderOrder = source.renderOrder;
  mesh.visible = source.visible;
  mesh.layers.mask = source.layers.mask;
  mesh.userData = { ...source.userData };

  indices.forEach((from, to) => {
    source.getMatrixAt(from, _instance);
    mesh.setMatrixAt(to, _instance);
    if (source.instanceColor) {
      source.getColorAt(from, _color);
      mesh.setColorAt(to, _color);
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // The bounds frustum culling uses — for this half only, which is the
  // point: the far half of a ring of trees can now be culled on its own.
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  return mesh;
}

/**
 * The parts of `root` that can be hidden: every child except those `isFixed`
 * keeps, taken whole — unless it holds a light somewhere inside. Hiding a
 * light changes the scene's light count, and three.js compiles that count
 * into every lit material's shader: one hidden lamp would recompile the
 * whole scene, which is exactly the hitch this is meant to avoid. Those
 * children are opened up instead and their light-free parts taken.
 *
 * @param {THREE.Object3D} root
 * @param {(child: THREE.Object3D) => boolean} isFixed
 * @returns {THREE.Object3D[]}
 */
export function collectHideable(root, isFixed) {
  const out = [];
  for (const child of root.children) {
    if (child.isLight || isFixed(child)) continue;
    if (containsLight(child)) out.push(...collectHideable(child, isFixed));
    else out.push(child);
  }
  return out;
}

function containsLight(object) {
  let found = false;
  object.traverse((o) => { if (o.isLight) found = true; });
  return found;
}

/** Walls are positioned by sums of halves; keep -4.9 from printing as -4.8999…. */
function round(n) {
  return Math.round(n * 1e6) / 1e6;
}
