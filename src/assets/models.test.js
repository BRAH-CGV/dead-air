import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { ASSETS } from './manifest.js';
import { LEAVE, TEXTURE_BUDGET, TRIANGLE_BUDGET } from '../../scripts/slim-models.mjs';

// ─────────────────────────────────────────────
// What is inside the .glb files the game ships (#175)
// ─────────────────────────────────────────────
// The files themselves, read the way scripts/slim-models.mjs reads them.
// Every byte here is downloaded on a cold start, and every texture on a
// material is uploaded to the GPU by WarmUp (collectTextures takes every
// texture-valued key, used or not).
// ─────────────────────────────────────────────

const ROOT = resolve(__dirname, '../..');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const MODELS = Object.entries(ASSETS).filter(([key, entry]) => entry.type === 'model' && !LEAVE.includes(key));

/** @type {Map<string, import('@gltf-transform/core').Document>} */
const docs = new Map();
beforeAll(async () => {
  for (const [key, entry] of MODELS) docs.set(key, await io.read(resolve(ROOT, 'public', entry.url)));
}, 60_000);

const extensionsOf = (doc) => doc.getRoot().listExtensionsUsed().map(ext => ext.extensionName);
const triangles = (doc) => doc.getRoot().listMeshes()
  .flatMap(mesh => mesh.listPrimitives())
  .reduce((sum, prim) => sum + (prim.getIndices() ?? prim.getAttribute('POSITION')).getCount() / 3, 0);

describe('the shipped models (#175)', () => {
  it("carry no specular-glossiness materials: three's loader drops them, images and all", () => {
    const offenders = [...docs].filter(([, doc]) => extensionsOf(doc).includes('KHR_materials_pbrSpecularGlossiness'));
    expect(offenders.map(([key]) => key)).toEqual([]);
  });

  it('carry no transmission map: the desk has transmission off in the manifest, and WarmUp would upload it anyway', () => {
    const offenders = [...docs].filter(([, doc]) => doc.getRoot().listMaterials()
      .some(material => material.getExtension('KHR_materials_transmission')?.getTransmissionTexture()));
    expect(offenders.map(([key]) => key)).toEqual([]);
  });

  it('carry no image that no material uses', () => {
    const offenders = [];
    for (const [key, doc] of docs) {
      const used = new Set();
      for (const material of doc.getRoot().listMaterials()) {
        for (const tex of doc.getGraph().listChildren(material)) used.add(tex);
        for (const ext of material.listExtensions()) for (const tex of doc.getGraph().listChildren(ext)) used.add(tex);
      }
      for (const tex of doc.getRoot().listTextures()) if (!used.has(tex)) offenders.push(key);
    }
    expect(offenders).toEqual([]);
  });

  it('carry no PNG: each is lossless WebP, the same pixels in fewer bytes', () => {
    const offenders = [];
    for (const [key, doc] of docs) {
      for (const tex of doc.getRoot().listTextures()) if (tex.getMimeType() === 'image/png') offenders.push(key);
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it('keep every texture within its budget', () => {
    const over = [];
    for (const [key, side] of Object.entries(TEXTURE_BUDGET)) {
      for (const tex of docs.get(key).getRoot().listTextures()) {
        const [w, h] = tex.getSize();
        if (Math.max(w, h) > side) over.push(`${key} ${w}x${h} > ${side}`);
      }
    }
    expect(over).toEqual([]);
  });

  it('keep every simplified model within its triangle budget', () => {
    const over = Object.entries(TRIANGLE_BUDGET)
      .map(([key, budget]) => [key, triangles(docs.get(key)), budget])
      .filter(([, count, budget]) => count > budget)
      .map(([key, count, budget]) => `${key} ${count} > ${budget}`);
    expect(over).toEqual([]);
  });

  it('budget only models the manifest has', () => {
    for (const key of [...Object.keys(TEXTURE_BUDGET), ...Object.keys(TRIANGLE_BUDGET)]) expect(docs.has(key), key).toBe(true);
  });
});
