// ─────────────────────────────────────────────
// settle-bin-trash  –  the office bin's trash, down to its floor
// ─────────────────────────────────────────────
// trash-bin.glb came with its trash (the Trash material's mesh, a lumpy
// layer) filled to the rim. This lays it on the bin's floor instead, a thin
// layer just inside the wall: a little trash at the bottom. It also came
// unlit (KHR_materials_unlit), drawn at full brightness whatever the light,
// so at the bottom of a dark bin it glowed: it is made lit, and dulled
// (`SHADE`, rough), like the bin round it.
//
// In the bin's own frame (z up, the bin 0 … 2 high, its inside wall 1.0
// round its axis, its floor `FLOOR` thick): the layer is centred on the
// axis, sized to `RADIUS` and squashed between `FLOOR` and `FLOOR + DEPTH`.
// Its normals follow the squash. It sets the layer where it should be from
// wherever it is, so running it again leaves it where it is (the normals
// only re-rounded).
//
// Usage: node scripts/settle-bin-trash.mjs [in.glb] [out.glb]   (both default to the bin)
// ─────────────────────────────────────────────
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const FLOOR = 0.055;
const DEPTH = 0.1;
const RADIUS = 0.95;
/** The trash's colour factor, linear, on its texture: dulled. */
const SHADE = 0.55;

const [src = 'public/assets/models/trash-bin.glb', out = src] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);

const prim = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives()).find(p => p.getMaterial()?.getName() === 'Trash');
if (!prim) throw new Error('no Trash mesh in ' + src);
const position = prim.getAttribute('POSITION');
const p = position.getArray();
const n = position.getCount();

// Where it is now: its middle across, its widest reach from it, its height.
let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
for (let i = 0; i < n; i++) {
  x0 = Math.min(x0, p[3 * i]); x1 = Math.max(x1, p[3 * i]);
  y0 = Math.min(y0, p[3 * i + 1]); y1 = Math.max(y1, p[3 * i + 1]);
  z0 = Math.min(z0, p[3 * i + 2]); z1 = Math.max(z1, p[3 * i + 2]);
}
const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
let reach = 0;
for (let i = 0; i < n; i++) reach = Math.max(reach, Math.hypot(p[3 * i] - cx, p[3 * i + 1] - cy));
const across = RADIUS / reach, up = DEPTH / (z1 - z0);

for (let i = 0; i < n; i++) {
  p[3 * i] = (p[3 * i] - cx) * across;
  p[3 * i + 1] = (p[3 * i + 1] - cy) * across;
  p[3 * i + 2] = FLOOR + (p[3 * i + 2] - z0) * up;
}
position.setArray(p);

// A squash turns the normals the other way: scale them by its inverse.
const normal = prim.getAttribute('NORMAL');
if (normal) {
  const q = normal.getArray();
  for (let i = 0; i < normal.getCount(); i++) {
    const nx = q[3 * i] / across, ny = q[3 * i + 1] / across, nz = q[3 * i + 2] / up;
    const len = Math.hypot(nx, ny, nz) || 1;
    q[3 * i] = nx / len; q[3 * i + 1] = ny / len; q[3 * i + 2] = nz / len;
  }
  normal.setArray(q);
}

// Lit and dull.
const material = prim.getMaterial();
material.setExtension('KHR_materials_unlit', null);
material.setBaseColorFactor([SHADE, SHADE, SHADE, 1]).setRoughnessFactor(0.95).setMetallicFactor(0);
for (const extension of doc.getRoot().listExtensionsUsed()) {
  if (extension.extensionName === 'KHR_materials_unlit') extension.dispose();
}

await io.write(out, doc);
console.log(`wrote ${out}: trash ${FLOOR} … ${FLOOR + DEPTH} high, ${RADIUS} round`);
