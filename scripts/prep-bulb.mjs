// ─────────────────────────────────────────────
// prep-bulb  –  Poly Haven's Lightbulb 01 → public/assets/models/bulb.glb
// ─────────────────────────────────────────────
// The office's signal lamp (SignalAlertLight). The download needs three
// fixes, and is made lighter:
//
//   1. Its glass is KHR_materials_transmission: a transmission pass (the
//      scene drawn again into a target) every frame it is in view. Dropped,
//      with its IOR; the lamp sets the glass's opacity itself, since the
//      colour map has no alpha.
//   2. The glass and the base wear the same atlas, once as a PNG and once
//      as a JPEG: the glass takes the JPEG and the PNG goes.
//   3. The atlas carries a maker's stamp on the glass ("Lumen", its watts
//      and volts): painted out with the clean glass below it, softly edged.
//   4. Lighter: welded and simplified (meshoptimizer) to about `RATIO` of its
//      triangles, and every texture down to `TEXTURE` px. A bulb on a desk
//      is a few dozen pixels across even from the chair.
//
// Usage: node scripts/prep-bulb.mjs <lightbulb_01.glb> [out.glb]
// Run it on the download, not on its own output: it would simplify again.
// ─────────────────────────────────────────────
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, weld, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const SIZE = 1024;
const FEATHER = 4;
/** The stamp on the 1k atlas, [x, y, w, h], and where the clean glass copied over it starts. */
const STAMP = { rect: [105, 108, 100, 80], from: [105, 198] };
const QUALITY = 92;
const RATIO = 0.5;
const ERROR = 0.01;   // of the bulb's size: about a millimetre
const TEXTURE = 512;

const [src, out = 'public/assets/models/bulb.glb'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/prep-bulb.mjs <lightbulb_01.glb> [out.glb]');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();

// 1. No transmission, no IOR.
for (const material of root.listMaterials()) {
  material.setExtension('KHR_materials_transmission', null);
  material.setExtension('KHR_materials_ior', null);
}
for (const extension of root.listExtensionsUsed()) {
  if (['KHR_materials_transmission', 'KHR_materials_ior'].includes(extension.extensionName)) extension.dispose();
}

// 2. One atlas for both.
const glass = root.listMaterials().find(m => /glass/.test(m.getName()));
const base = root.listMaterials().find(m => /base/.test(m.getName()));
const atlas = base.getBaseColorTexture();
glass.setBaseColorTexture(atlas);
await doc.transform(prune());

// 3. The stamp.
const { data, info } = await sharp(atlas.getImage()).raw().toBuffer({ resolveWithObject: true });
const { width, channels } = info;
const k = width / SIZE;
const copy = Buffer.from(data);
const { rect: [x, y, w, h], from: [fx, fy] } = STAMP;
const f = FEATHER * k;
const [x0, y0, x1, y1] = [x * k - f, y * k - f, (x + w) * k + f, (y + h) * k + f].map(Math.round);
const [dx, dy] = [Math.round((fx - x) * k), Math.round((fy - y) * k)];
for (let py = y0; py < y1; py++) {
  for (let px = x0; px < x1; px++) {
    // 1 inside the stamp's rectangle, falling to 0 over the feather.
    const outside = Math.max(x * k - px, px - (x + w) * k, y * k - py, py - (y + h) * k, 0);
    const a = Math.max(0, 1 - outside / f);
    const i = (py * width + px) * channels, j = ((py + dy) * width + px + dx) * channels;
    for (let c = 0; c < channels; c++) data[i + c] = Math.round(copy[i + c] * (1 - a) + copy[j + c] * a);
  }
}
atlas.setImage(await sharp(data, { raw: info }).jpeg({ quality: QUALITY }).toBuffer());
atlas.setMimeType('image/jpeg');

// 4. Lighter.
await MeshoptSimplifier.ready;
await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: ERROR }));
for (const texture of root.listTextures()) {
  const image = sharp(texture.getImage());
  const { width } = await image.metadata();
  if (width <= TEXTURE) continue;
  texture.setImage(await image.resize(TEXTURE, TEXTURE).jpeg({ quality: QUALITY }).toBuffer());
  texture.setMimeType('image/jpeg');
}

await io.write(out, doc);
console.log(`wrote ${out}`);
