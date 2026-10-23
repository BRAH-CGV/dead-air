// ─────────────────────────────────────────────
// prep-coffee-machine  –  free3d.io's Ascaso Dream → public/assets/models/coffee-machine.glb
// ─────────────────────────────────────────────
// The bedroom's coffee machine. The download needs three fixes:
//
//   1. Every material was exported with KHR_materials_transmission at 1 and
//      KHR_materials_specular at 0: the whole machine drawn as clear glass,
//      with no highlights, and a transmission pass (the scene drawn again
//      into a target) every frame it is in view. Both are dropped; the
//      glass keeps its 30 % alpha blend.
//   2. Its finishes: the chrome was matte and not metal, the plastics fully
//      rough. The scene has no environment map, so the chrome is only part
//      metal (`FINISH`), or it would go black. The body's bright orange-red
//      is dulled to a worn rust (`BODY`), to sit in the base's dim steels
//      and woods.
//   3. Its gauge face (the Label texture) carries the maker's name and
//      "since 1992" under the needle: painted out with the face's white,
//      the dial and the needle kept.
//
// Usage: node scripts/prep-coffee-machine.mjs <coffee_machine.glb> [out.glb]
// ─────────────────────────────────────────────
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

/** [metalness, roughness] by material name. */
const FINISH = {
  Chrome: [0.6, 0.3],
  Plastic_Red: [0, 0.65],
  Plastic_white: [0, 0.5],
  Plastic_brown: [0, 0.6],
  Label: [0, 0.6],
};
/** The body's colour, sRGB (#8a4a32): a muted rust red. */
const BODY = [0x8a, 0x4a, 0x32];
/** The wording under the needle, on the 500 px gauge face: [x0, y0, x1, y1]. */
const WORDING = [[145, 358, 345, 500], [0, 405, 500, 500]];
const SIZE = 500;
const QUALITY = 92;

const [src, out = 'public/assets/models/coffee-machine.glb'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/prep-coffee-machine.mjs <coffee_machine.glb> [out.glb]');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();

// 1. No transmission, no specular override.
for (const material of root.listMaterials()) {
  material.setExtension('KHR_materials_transmission', null);
  material.setExtension('KHR_materials_specular', null);
}
for (const extension of root.listExtensionsUsed()) {
  if (['KHR_materials_transmission', 'KHR_materials_specular'].includes(extension.extensionName)) extension.dispose();
}

// 2. Finishes.
for (const material of root.listMaterials()) {
  const finish = FINISH[material.getName()];
  if (finish) material.setMetallicFactor(finish[0]).setRoughnessFactor(finish[1]);
}
// glTF colour factors are linear.
const linear = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
root.listMaterials().find(m => m.getName() === 'Plastic_Red')?.setBaseColorFactor([...BODY.map(linear), 1]);

// 3. The gauge face's wording.
for (const texture of root.listTextures()) {
  const { data, info } = await sharp(texture.getImage()).raw().toBuffer({ resolveWithObject: true });
  const { width, channels } = info;
  const k = width / SIZE;
  for (const [x0, y0, x1, y1] of WORDING) {
    for (let y = Math.round(y0 * k); y < Math.round(y1 * k); y++) {
      for (let x = Math.round(x0 * k); x < Math.round(x1 * k); x++) {
        data.fill(255, (y * width + x) * channels, (y * width + x + 1) * channels);
      }
    }
  }
  texture.setImage(await sharp(data, { raw: info }).jpeg({ quality: QUALITY }).toBuffer());
  texture.setMimeType('image/jpeg');
}

await io.write(out, doc);
console.log(`wrote ${out}`);
