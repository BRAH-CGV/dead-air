// ─────────────────────────────────────────────
// slim-models  –  the shipped .glb files, lighter, looking the same (#175)
// ─────────────────────────────────────────────
// Every byte under public/ is downloaded on a cold start, and WarmUp uploads
// every texture a material carries, sampled or not. This takes out what
// nobody sees and re-packs what they do:
//
//   1. Specular-glossiness materials lose the extension. three's loader
//      dropped it long ago and builds the material from the core values, so
//      its images (the trees' and the fence's) were downloaded and never
//      decoded. The core values are kept: three draws exactly what it drew.
//   2. The desk's transmission map goes. The manifest turns transmission off,
//      so three never samples it; WarmUp still uploaded it. The extension
//      stays, so the material is still the MeshPhysicalMaterial it was.
//   3. Identical images and accessors are merged, and anything left unused
//      is pruned; a texture of one flat colour is folded into its material's
//      factor, which samples the same. Nodes, materials and meshes are never
//      merged or pruned: code finds them by name (the dish's head, the
//      demon's eye markers).
//   4. TEXTURE_BUDGET: a model never seen up close gets smaller textures.
//   5. TRIANGLE_BUDGET: a model is welded and simplified (meshoptimizer) as
//      far as an error bound of a fraction of a millimetre on these props.
//   6. Every PNG becomes lossless WebP, checked pixel for pixel against the
//      PNG first; one that doesn't match exactly stays a PNG.
//
// It is idempotent: a file already within its budgets, with nothing left to
// strip, is not written. Run it after adding or replacing a model. Models in
// LEAVE are never touched.
//
// Usage: node scripts/slim-models.mjs [file.glb …]   (default: every model)
// ─────────────────────────────────────────────

/** Longest texture side, by manifest key, for models never seen up close. */
export const TEXTURE_BUDGET = {
  'model:ufo': 512,          // hovers 35 m up at its nearest; ~250 px across
};

/**
 * Most triangles, by manifest key: what meshoptimizer reaches within
 * SIMPLIFY_ERROR of the model's size, rounded up. The script says if not.
 */
export const TRIANGLE_BUDGET = {
  'model:radar-terminal': 5200,   // 12,638 as downloaded, drawn twice
  'model:dish-tower': 9500,       // 14,304
  'model:bigger-shelf': 3300,     // 6,372, four in the bedroom
};

/** meshoptimizer's error bound, as a fraction of each mesh's size. */
const SIMPLIFY_ERROR = 0.0002;
/** Quality a resized JPEG is written at. */
const JPEG_QUALITY = 92;
/** Left as they are (#175: not part of this pass). */
export const LEAVE = ['model:cj', 'model:security-camera'];

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));

async function main(files) {
  const { writeFileSync, statSync } = await import('node:fs');
  const { NodeIO, PropertyType } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS, EXTTextureWebP } = await import('@gltf-transform/extensions');
  const { dedup, prune, weld, simplify } = await import('@gltf-transform/functions');
  const { MeshoptSimplifier } = await import('meshoptimizer');
  const { default: sharp } = await import('sharp');
  const { ASSETS } = await import('../src/assets/manifest.js');

  const models = Object.entries(ASSETS)
    .filter(([key, entry]) => entry.type === 'model' && !LEAVE.includes(key))
    .map(([key, entry]) => ({ key, file: `public/${entry.url}` }))
    .filter(({ file }) => files.length === 0 || files.some(f => f.endsWith(file) || file.endsWith(f)));

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const triangles = (doc) => doc.getRoot().listMeshes().flatMap(m => m.listPrimitives())
    .reduce((sum, p) => sum + (p.getIndices() ?? p.getAttribute('POSITION')).getCount() / 3, 0);
  const rawPixels = (buffer) => sharp(buffer).ensureAlpha().raw().toBuffer();

  for (const { key, file } of models) {
    const doc = await io.read(file);
    const root = doc.getRoot();
    const done = [];

    // 1. Specular-glossiness: the extension and its images.
    const specGloss = root.listExtensionsUsed().find(e => e.extensionName === 'KHR_materials_pbrSpecularGlossiness');
    if (specGloss) {
      for (const material of root.listMaterials()) material.setExtension(specGloss.extensionName, null);
      specGloss.dispose();
      done.push('dropped specular-glossiness');
    }

    // 2. Transmission maps, where the manifest turns transmission off.
    if (ASSETS[key].material?.transmission === 0) {
      for (const material of root.listMaterials()) {
        const transmission = material.getExtension('KHR_materials_transmission');
        if (transmission?.getTransmissionTexture()) {
          transmission.setTransmissionTexture(null);
          done.push('dropped a transmission map');
        }
      }
    }

    // 3. Merge and prune, textures and accessors only.
    const textureCount = root.listTextures().length;
    await doc.transform(
      dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.TEXTURE] }),
      prune({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.TEXTURE] }),
    );
    if (root.listTextures().length < textureCount) done.push(`${textureCount - root.listTextures().length} images pruned or merged`);

    // 4. Texture budgets.
    const side = TEXTURE_BUDGET[key] ?? Infinity;
    for (const texture of root.listTextures()) {
      const image = Buffer.from(texture.getImage());
      const { width, height } = await sharp(image).metadata();
      if (Math.max(width, height) <= side) continue;
      const k = side / Math.max(width, height);
      const resized = sharp(image).resize(Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k)), { kernel: 'lanczos3' });
      const jpeg = texture.getMimeType() === 'image/jpeg';
      texture.setImage(new Uint8Array(await (jpeg ? resized.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }) : resized.png()).toBuffer()));
      done.push(`${width}x${height} -> ${side}`);
    }

    // 5. Simplify, as far as the error bound.
    const triangleBudget = TRIANGLE_BUDGET[key];
    if (triangleBudget && triangles(doc) > triangleBudget) {
      const before = triangles(doc);
      await doc.transform(
        weld(),
        simplify({ simplifier: MeshoptSimplifier, ratio: 0, error: SIMPLIFY_ERROR, lockBorder: true }),
        prune({ propertyTypes: [PropertyType.ACCESSOR] }),
      );
      const after = triangles(doc);
      done.push(`${before} -> ${after} triangles`);
      if (after > triangleBudget) console.warn(`${key}: ${after} triangles, over its budget of ${triangleBudget} at error ${SIMPLIFY_ERROR}`);
    }

    // 6. PNG -> lossless WebP, only where every pixel survives.
    let webp = false;
    for (const texture of root.listTextures()) {
      if (texture.getMimeType() !== 'image/png') continue;
      const png = Buffer.from(texture.getImage());
      const lossless = await sharp(png).webp({ lossless: true, exact: true, effort: 6 }).toBuffer();
      if (!(await rawPixels(png)).equals(await rawPixels(lossless))) {
        console.warn(`${key}: a PNG did not survive WebP pixel for pixel; kept as PNG`);
        continue;
      }
      texture.setImage(new Uint8Array(lossless)).setMimeType('image/webp');
      if (texture.getURI()) texture.setURI(texture.getURI().replace(/\.png$/i, '.webp'));
      webp = true;
    }
    if (webp) {
      doc.createExtension(EXTTextureWebP).setRequired(true);
      done.push('PNG -> lossless WebP');
    }

    if (done.length === 0) continue;
    const before = statSync(file).size;
    writeFileSync(file, await io.writeBinary(doc));
    console.log(`${key}: ${(before / 1024).toFixed(0)} K -> ${(statSync(file).size / 1024).toFixed(0)} K  (${done.join('; ')})`);
  }
}
