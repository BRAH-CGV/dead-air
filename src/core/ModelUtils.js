import * as THREE from 'three';

// ─────────────────────────────────────────────
// ModelUtils  –  the chores every imported mesh needs
// ─────────────────────────────────────────────
// GLTFLoader hands back a Group full of Meshes with geometry, materials and
// textures already wired up — including correct colour spaces. What it does
// NOT do is set shadow flags, raise texture anisotropy, or fix a model that
// was authored in centimetres. These helpers cover that gap so scene code can
// treat every import the same.
// ─────────────────────────────────────────────

/**
 * One-time cleanup applied to a freshly loaded model, before it is cached.
 * @param {THREE.Object3D} root
 * @param {Object} [opts]
 * @param {number}  [opts.scale]            Uniform scale baked into the root.
 * @param {boolean} [opts.castShadow=true]
 * @param {boolean} [opts.receiveShadow=true]
 * @param {number}  [opts.anisotropy=1]     Usually renderer.capabilities.getMaxAnisotropy().
 */
export function prepareModel(root, opts = {}) {
  const {
    scale,
    castShadow = true,
    receiveShadow = true,
    anisotropy = 1,
  } = opts;

  if (scale !== undefined) root.scale.setScalar(scale);

  root.traverse((child) => {
    if (!child.isMesh) return;

    child.castShadow = castShadow;
    child.receiveShadow = receiveShadow;

    for (const material of materialsOf(child)) {
      for (const tex of texturesOf(material)) {
        tex.anisotropy = Math.max(tex.anisotropy, anisotropy);
      }
    }
  });

  root.updateMatrixWorld(true);
  return root;
}

/** Materials on a mesh, normalised to an array — a mesh may carry several. */
export function materialsOf(mesh) {
  if (!mesh.material) return [];
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** Every texture currently assigned to a material, whatever the slot. */
export function texturesOf(material) {
  const out = [];
  for (const value of Object.values(material)) {
    if (value && value.isTexture) out.push(value);
  }
  return out;
}

/**
 * Axis-aligned bounds of a model in its own local space. Use it to check what
 * a download's real-world size actually is before wondering why it filled the
 * whole room.
 * @returns {{ box: THREE.Box3, size: THREE.Vector3, center: THREE.Vector3 }}
 */
export function measure(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) box.set(new THREE.Vector3(), new THREE.Vector3());

  return {
    box,
    size: box.getSize(new THREE.Vector3()),
    center: box.getCenter(new THREE.Vector3()),
  };
}

/**
 * Rescale a model so its largest axis measures `targetSize` metres, then drop
 * it so its base sits on y=0. The escape hatch for an asset authored in the
 * wrong units or with its origin somewhere unhelpful.
 */
export function normalize(root, targetSize) {
  const { size } = measure(root);
  const largest = Math.max(size.x, size.y, size.z);

  if (targetSize && largest > 0) {
    root.scale.multiplyScalar(targetSize / largest);
  }

  const { box } = measure(root);
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
  return root;
}

// ─────────────────────────────────────────────
// Collision geometry
// ─────────────────────────────────────────────
// Both helpers below run once, at load time, on the cached model root — and
// they rely on that. A cached root has no parent, so a child mesh's
// `matrixWorld` is expressed in exactly the space the spawned GameObject's
// Object3D will provide. Baking it into the points means nested node
// transforms and the manifest's `scale` (already applied by `prepareModel`)
// come along for free, and the collider lands where the geometry is.
// ─────────────────────────────────────────────

/** A mesh whose name marks it as collision, not art. `UCX_` is the convention
 *  Unreal popularised and Blender exporters preserve; `collider_` reads better
 *  if you've never met it. Matching is case-insensitive. */
const COLLIDER_NAME = /^(ucx|collider)[_.]|[_.]collider$/i;

/**
 * Pull the collision proxy meshes out of a freshly loaded model.
 *
 * They are removed from the render tree (so clones never draw them), their
 * vertices baked into root space, and their geometry disposed immediately —
 * once detached, `AssetManager.release()` can no longer reach it.
 *
 * @param {THREE.Object3D} root
 * @returns {Float32Array[]} one point cloud per proxy mesh, each a convex hull
 */
export function extractColliderMeshes(root) {
  root.updateMatrixWorld(true);

  const found = [];
  root.traverse((child) => {
    if (child.isMesh && COLLIDER_NAME.test(child.name)) found.push(child);
  });

  const hulls = [];
  for (const mesh of found) {
    const position = mesh.geometry?.getAttribute('position');
    if (position) hulls.push(bakePoints(position, mesh.matrixWorld));

    mesh.removeFromParent();
    mesh.geometry?.dispose();
  }

  return hulls;
}

/**
 * Merge every render mesh into one vertex/index buffer in root space — the
 * input for a `trimesh` collider, or a convex hull over a model that shipped
 * no proxy meshes.
 *
 * Expensive on a detailed model, so `AssetManager` only calls it on demand.
 *
 * @param {THREE.Object3D} root
 * @returns {{ vertices: Float32Array, indices: Uint32Array } | null}
 */
export function collectGeometry(root) {
  root.updateMatrixWorld(true);

  const chunks = [];
  let vertexCount = 0;
  let indexCount = 0;

  root.traverse((child) => {
    const position = child.isMesh ? child.geometry?.getAttribute('position') : null;
    if (!position) return;

    const index = child.geometry.getIndex();
    // A non-indexed geometry is already triangle soup: vertices 0,1,2 form the
    // first triangle, and so on.
    const count = index ? index.count : position.count;

    chunks.push({ position, index, matrix: child.matrixWorld, offset: vertexCount });
    vertexCount += position.count;
    indexCount += count;
  });

  if (!vertexCount) return null;

  const vertices = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  let v = 0;
  let i = 0;

  for (const chunk of chunks) {
    vertices.set(bakePoints(chunk.position, chunk.matrix), v);
    v += chunk.position.count * 3;

    // Indices are per-geometry; shift them into the merged buffer's numbering.
    if (chunk.index) {
      for (let k = 0; k < chunk.index.count; k++) indices[i++] = chunk.index.getX(k) + chunk.offset;
    } else {
      for (let k = 0; k < chunk.position.count; k++) indices[i++] = k + chunk.offset;
    }
  }

  return { vertices, indices };
}

/** Copy a position attribute into a flat array, transformed by `matrix`. */
function bakePoints(position, matrix) {
  const out = new Float32Array(position.count * 3);
  const p = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(matrix);
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = p.z;
  }

  return out;
}

/**
 * Detach `root` from its parent, and optionally free its GPU resources.
 *
 * ── Ownership rule ──
 * The AssetManager cache owns each model's geometries, materials and textures;
 * clones handed out by `instantiate()` share them by reference. So dropping a
 * clone means removing it from the scene and nothing more — calling `.dispose()`
 * would blank out every other instance of that model.
 *
 * Pass `disposeShared: true` ONLY from `AssetManager.release()`, which owns
 * the originals.
 *
 * @param {THREE.Object3D} root
 * @param {{ disposeShared?: boolean }} [opts]
 */
export function disposeObject3D(root, { disposeShared = false } = {}) {
  root.parent?.remove(root);
  if (!disposeShared) return;

  root.traverse((child) => {
    child.geometry?.dispose();
    for (const material of materialsOf(child)) {
      for (const tex of texturesOf(material)) tex.dispose();
      material.dispose();
    }
  });
}
