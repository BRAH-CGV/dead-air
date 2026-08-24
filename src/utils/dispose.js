/**
 * Dispose manager — tracks Three.js resources (geometries, materials, textures)
 * and disposes them all at once to prevent GPU memory leaks.
 */

export function createDisposeManager() {
  return {
    geometries: [],
    materials: [],
    textures: [],
  };
}

export function trackObject(manager, mesh) {
  if (mesh.geometry) {
    manager.geometries.push(mesh.geometry);
  }

  if (Array.isArray(mesh.material)) {
    for (const mat of mesh.material) {
      manager.materials.push(mat);
      collectTextures(manager, mat);
    }
  } else if (mesh.material) {
    manager.materials.push(mesh.material);
    collectTextures(manager, mesh.material);
  }
}

function collectTextures(manager, material) {
  const textureKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'bumpMap', 'heightMap'];
  for (const key of textureKeys) {
    if (material[key]) {
      manager.textures.push(material[key]);
    }
  }
}

export function disposeAll(manager) {
  for (const geo of manager.geometries) geo.dispose();
  for (const mat of manager.materials) mat.dispose();
  for (const tex of manager.textures) tex.dispose();

  manager.geometries.length = 0;
  manager.materials.length = 0;
  manager.textures.length = 0;
}
