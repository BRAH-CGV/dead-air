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

/** The coffee bag: its body (front label, back, gussets) and the rolled top
 *  with its tin tie, two boxes, a set of faces each. */
export const BAG_ATLAS = Object.freeze({
  size: [512, 1024],
  body: {
    pz: [0, 0, 256, 416],
    nz: [256, 0, 256, 416],
    px: [0, 416, 256, 320],
    nx: [0, 416, 256, 320],
    py: [256, 416, 256, 320],
    ny: [256, 416, 256, 320],
  },
  roll: {
    pz: [0, 736, 512, 120],
    nz: [0, 736, 512, 120],
    px: [0, 856, 256, 56],
    nx: [0, 856, 256, 56],
    py: [256, 856, 256, 168],
    ny: [256, 856, 256, 168],
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

/** A texture from the scene's asset cache, or null when it isn't loaded
 *  (a scene test's stub assets). */
export function cachedTexture(scene, key) {
  const assets = scene?.userData?.engine?.assets;
  return assets?.has?.(key) ? assets.get(key) : null;
}
