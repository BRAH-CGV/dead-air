// ─────────────────────────────────────────────
// propAtlases  –  where each face of the carried props reads its texture (#188)
// ─────────────────────────────────────────────
// The drive, the drive box and the coffee bag are boxes, and each wears one
// small atlas (drawn by scripts/make-prop-textures.mjs): a rectangle of it
// per face, sized to the face's shape so nothing is stretched much. These
// are the rectangles, in the atlas's pixels from its top left, shared by the
// script that draws the atlases and mapBoxFaces, which lays them onto a
// BoxGeometry. No three import, so the node script can read it.
//
// Faces are named as BoxGeometry builds them: px, nx, py, ny, pz, nz
// (+x, −x, +y, −y, +z, −z). On a side face v runs up the box; on py, the
// top of the picture is the −z edge.
// ─────────────────────────────────────────────

/** The drive (0.08 × 0.02 × 0.12 m). Its top carries the label, the −z end
 *  its vents and the LED, the +z end the connector that goes in the reader. */
export const DRIVE_ATLAS = Object.freeze({
  size: [256, 256],
  faces: {
    py: [0, 0, 128, 192],
    ny: [128, 0, 128, 192],
    px: [0, 192, 256, 32],
    nx: [0, 192, 256, 32],
    nz: [0, 224, 128, 32],
    pz: [128, 224, 128, 32],
  },
});

/** The drive box (0.32 × 0.12 × 0.28 m). Drawn in greys: the box's own
 *  colour tints it, so each box keeps its colour. */
export const BOX_ATLAS = Object.freeze({
  size: [512, 1024],
  faces: {
    py: [0, 0, 512, 448],
    pz: [0, 448, 512, 192],
    nz: [0, 448, 512, 192],
    px: [0, 640, 448, 192],
    nx: [0, 640, 448, 192],
    ny: [0, 832, 512, 192],
  },
});

/** The coffee bag (0.125 × 0.17 × 0.1 m): its body (the label on its wide
 *  front, the back, the gussets) and the sealed seam along its top with its
 *  tin tie, two boxes, a set of faces each. */
export const BAG_ATLAS = Object.freeze({
  size: [512, 1024],
  body: {
    pz: [0, 0, 256, 310],
    nz: [256, 0, 256, 310],
    px: [0, 310, 206, 310],
    nx: [0, 310, 206, 310],
    py: [206, 310, 306, 245],
    ny: [206, 310, 306, 245],
  },
  roll: {
    pz: [0, 620, 512, 86],
    nz: [0, 620, 512, 86],
    px: [0, 706, 128, 86],
    nx: [0, 706, 128, 86],
    py: [128, 706, 384, 86],
    ny: [128, 706, 384, 86],
  },
});

/** The drive readers (0.12 × 0.03 × 0.15 m: the office computer's and the
 *  server room's two consoles'). A drive slides into the slot on its front
 *  (+z) connector first and stands half out of it; the top carries a cover
 *  plate over the drive's channel, a grille and screws, the back a cable
 *  gland. A normal map (`tex:drive-reader-normal`) shares the layout. */
export const READER_ATLAS = Object.freeze({
  size: [256, 512],
  faces: {
    py: [0, 0, 205, 256],
    ny: [205, 0, 51, 64],
    px: [0, 256, 256, 52],
    nx: [0, 256, 256, 52],
    pz: [0, 320, 256, 64],
    nz: [0, 384, 256, 64],
  },
});

/** The airlock's drive-box dock (0.42 × 0.12 × 0.36 m): a ribbed pad for
 *  the box on top, guide blocks at its corners, bolted steel round it. */
export const DOCK_ATLAS = Object.freeze({
  size: [512, 512],
  faces: {
    py: [0, 0, 512, 439],
    ny: [0, 0, 512, 439],
    pz: [0, 439, 256, 73],
    nz: [0, 439, 256, 73],
    px: [256, 439, 219, 73],
    nx: [256, 439, 219, 73],
  },
});

/** The table under the airlock's dock (0.5 × 0.75 × 1.95 m, its back to
 *  the wall at +x): a steel cabinet, drawers and a louvred door on its front
 *  (−x), a worn worktop. */
export const TABLE_ATLAS = Object.freeze({
  size: [1024, 1024],
  faces: {
    nx: [0, 0, 1024, 394],
    px: [0, 0, 1024, 394],
    py: [0, 394, 131, 512],
    ny: [0, 394, 131, 512],
    pz: [131, 394, 341, 512],
    nz: [131, 394, 341, 512],
  },
});

const FACE_ORDER = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

/**
 * Lay each face of an indexed BoxGeometry (one segment a side) onto its
 * rectangle of an atlas: its 0..1 uvs squeezed into the rectangle. A face
 * with no rectangle keeps its uvs. Returns the geometry.
 *
 * @param {{ groups: { start: number, count: number }[], index: { array: ArrayLike<number> },
 *           attributes: { uv: { array: Float32Array, needsUpdate?: boolean } } }} geometry
 * @param {Record<string, number[]>} faces  [x, y, w, h] in pixels, from the top left.
 * @param {number[]} size  The atlas's [width, height] in pixels.
 */
export function mapBoxFaces(geometry, faces, [W, H]) {
  const uv = geometry.attributes.uv.array;
  const index = geometry.index.array;
  geometry.groups.forEach((group, g) => {
    const rect = faces[FACE_ORDER[g]];
    if (!rect) return;
    const [x, y, w, h] = rect;
    const u0 = x / W, du = w / W;
    const v0 = 1 - (y + h) / H, dv = h / H;
    const seen = new Set();
    for (let i = group.start; i < group.start + group.count; i++) {
      const vtx = index[i];
      if (seen.has(vtx)) continue;
      seen.add(vtx);
      uv[vtx * 2] = u0 + uv[vtx * 2] * du;
      uv[vtx * 2 + 1] = v0 + uv[vtx * 2 + 1] * dv;
    }
  });
  geometry.attributes.uv.needsUpdate = true;
  return geometry;
}

/**
 * Lay an atlas onto a box mesh built square (Room._addStaticBox) and, when
 * the texture is loaded, put it on the mesh's material over a white base:
 * the picture carries the colour. The cache owns the texture.
 *
 * @param {import('three').Mesh} mesh
 * @param {import('three').Texture|null} texture
 * @param {{ size: number[], faces: Record<string, number[]> }} atlas
 */
export function skinBox(mesh, texture, { faces, size }) {
  mapBoxFaces(mesh.geometry, faces, size);
  if (!texture) return mesh;
  mesh.material.map = texture;
  mesh.material.color.setHex(0xffffff);
  mesh.material.needsUpdate = true;
  return mesh;
}

/** A texture from an asset manager, or null when it isn't loaded. */
export function assetTexture(assets, key) {
  return assets?.has?.(key) ? assets.get(key) : null;
}

/** A texture from the scene's asset cache, or null when it isn't loaded
 *  (a scene test's stub assets). */
export function cachedTexture(scene, key) {
  return assetTexture(scene?.userData?.engine?.assets, key);
}
