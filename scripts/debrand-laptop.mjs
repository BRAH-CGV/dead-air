// ─────────────────────────────────────────────
// debrand-laptop  –  Poly Haven's classic laptop → public/assets/models/laptop.glb
// ─────────────────────────────────────────────
// The download carries a blue maker's badge in two places: on the lid's
// front, under the screen, and on its back. This paints both out with the
// plain plastic beside them, in every map (the colour, the normal map has
// the plate's raised edge, the roughness/metal map its lettering), so no
// outline of it is left in the lighting. Every map shares the one UV
// layout, so one list of patches does them all.
//
// Each patch copies a clean stretch of the same face over the badge, with a
// soft edge (`FEATHER`) so no seam shows. Pixel coordinates are for the
// 1k maps and scale with the image, so a larger download works too.
//
// Usage: node scripts/debrand-laptop.mjs <classic_laptop.glb> [out.glb]
// Running it on its own output changes nothing more than a JPEG re-save.
// ─────────────────────────────────────────────
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const SIZE = 1024;
const FEATHER = 3;
/** [x, y, w, h] of a badge, and the top left of the clean plastic copied over it. */
const PATCHES = [
  { rect: [459, 488, 45, 25], from: [459, 514] },   // the lid's front, under the screen
  { rect: [570, 772, 28, 55], from: [530, 772] },   // the lid's back
];
const QUALITY = 92;

const [src, out = 'public/assets/models/laptop.glb'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/debrand-laptop.mjs <classic_laptop.glb> [out.glb]');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);

for (const texture of doc.getRoot().listTextures()) {
  const { data, info } = await sharp(texture.getImage()).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const k = width / SIZE;
  const copy = Buffer.from(data);
  for (const { rect: [x, y, w, h], from: [fx, fy] } of PATCHES) {
    const f = FEATHER * k;
    const [x0, y0, x1, y1] = [x * k - f, y * k - f, (x + w) * k + f, (y + h) * k + f].map(Math.round);
    const [dx, dy] = [Math.round((fx - x) * k), Math.round((fy - y) * k)];
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        // 1 inside the badge's rectangle, falling to 0 over the feather.
        const out = Math.max(x * k - px, px - (x + w) * k, y * k - py, py - (y + h) * k, 0);
        const a = Math.max(0, 1 - out / f);
        const i = (py * width + px) * channels, j = ((py + dy) * width + px + dx) * channels;
        for (let c = 0; c < channels; c++) data[i + c] = Math.round(copy[i + c] * (1 - a) + copy[j + c] * a);
      }
    }
  }
  texture.setImage(await sharp(data, { raw: { width, height, channels } }).jpeg({ quality: QUALITY }).toBuffer());
  texture.setMimeType('image/jpeg');
  console.log(`${texture.getName() || '(texture)'}: ${PATCHES.length} badges painted out`);
}

await io.write(out, doc);
console.log(`wrote ${out}`);
