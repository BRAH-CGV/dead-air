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
