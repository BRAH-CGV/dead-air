import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';

import { AssetManager } from './AssetManager.js';
import { SpecularGlossinessExtension, SpecGlossMaterial } from './SpecularGlossiness.js';
import { dimmedMaterial } from './ModelUtils.js';

// ─────────────────────────────────────────────
// KHR_materials_pbrSpecularGlossiness  (BUG-008)
// ─────────────────────────────────────────────
// three dropped this extension in r147, and two of our shipped downloads keep
// every colour and texture inside it: tree-dead and the chain-link fence.
// Without it they loaded white, fully metallic and bare.

const EXT = 'KHR_materials_pbrSpecularGlossiness';

/** A glTF with no geometry, only the materials under test. */
function gltfWith(...materials) {
  return JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [] }],
    materials,
    extensionsUsed: [EXT],
    extensionsRequired: [EXT],
  });
}

const specGloss = (ext, extra = {}) => ({ name: 'm', extensions: { [EXT]: ext }, ...extra });

/** Load material 0 through the game's own loader. */
async function loadMaterial(json) {
  const assets = new AssetManager({ manifest: {} });
  const gltf = await assets.gltfLoader.parseAsync(json, '');
  return gltf.parser.getDependency('material', 0);
}

afterEach(() => vi.restoreAllMocks());

describe('the game loader reads spec-gloss materials', () => {
  it('as a non-metal with the diffuse colour and opacity', async () => {
    const material = await loadMaterial(gltfWith(specGloss({
      diffuseFactor: [0.5, 0.25, 0.125, 0.75], glossinessFactor: 0.2, specularFactor: [0.3, 0.3, 0.3],
    })));

    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(material.metalness).toBe(0);
    const linear = material.color.clone();
    expect([linear.r, linear.g, linear.b]).toEqual([0.5, 0.25, 0.125]);
    expect(material.opacity).toBe(0.75);
  });

  it('turns glossiness into roughness', async () => {
    const material = await loadMaterial(gltfWith(specGloss({ glossinessFactor: 0.74, specularFactor: [0.3, 0.3, 0.3] })));
    expect(material.roughness).toBeCloseTo(0.26, 6);
  });

  it('makes a material with no specular at all as rough as a standard material gets', async () => {
    // The fantasy tree's leaves and wood debris: specularFactor 0, so no
    // highlight whatever the gloss says.
    const material = await loadMaterial(gltfWith(specGloss({ glossinessFactor: 0.4, specularFactor: [0, 0, 0] })));
    expect(material.roughness).toBe(1);
  });

  it('keeps glTF defaults for anything the extension leaves out', async () => {
    const material = await loadMaterial(gltfWith(specGloss({})));
    expect(material.roughness).toBe(0);   // glossinessFactor defaults to 1
    expect(material.color.getHex()).toBe(0xffffff);
    expect(material.opacity).toBe(1);
  });

  it('no longer warns that the extension is unknown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await loadMaterial(gltfWith(specGloss({ glossinessFactor: 0.5 })));
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/Unknown extension/);
  });

  it('leaves an ordinary metal/rough material alone', async () => {
    const material = await loadMaterial(gltfWith({
      name: 'plain', pbrMetallicRoughness: { metallicFactor: 0.3, roughnessFactor: 0.6 },
    }));
    expect(material).not.toBeInstanceOf(SpecGlossMaterial);
    expect(material.metalness).toBe(0.3);
    expect(material.roughness).toBe(0.6);
  });
});

describe('spec-gloss textures', () => {
  /** A parser stand-in: records which texture lands in which slot. */
  function parserFor(ext) {
    return {
      json: { materials: [specGloss(ext)] },
      assignTexture: vi.fn(async (params, slot, def, colorSpace) => {
        params[slot] = { index: def.index, colorSpace };
      }),
    };
  }

  it('uses the diffuse texture as the sRGB colour map', async () => {
    const plugin = new SpecularGlossinessExtension(parserFor({ diffuseTexture: { index: 3 } }));
    const params = {};
    await plugin.extendMaterialParams(0, params);
    expect(params.map).toEqual({ index: 3, colorSpace: THREE.SRGBColorSpace });
  });

  it('hands the gloss map to the shader, in the roughness slot', async () => {
    const plugin = new SpecularGlossinessExtension(parserFor({ specularGlossinessTexture: { index: 8 } }));
    const params = {};
    await plugin.extendMaterialParams(0, params);
    expect(params.roughnessMap).toEqual({ index: 8, colorSpace: undefined });
  });

  it('asks for the spec-gloss material type only for materials that use the extension', () => {
    const plugin = new SpecularGlossinessExtension({
      json: { materials: [specGloss({}), { name: 'plain' }] },
    });
    expect(plugin.getMaterialType(0)).toBe(SpecGlossMaterial);
    expect(plugin.getMaterialType(1)).toBeNull();
  });
});

describe('SpecGlossMaterial', () => {
  /** The shader three hands onBeforeCompile, trimmed to the line it patches. */
  const shader = () => ({
    uniforms: {},
    vertexShader: '',
    fragmentShader: 'void main() {\n#include <roughnessmap_fragment>\n}',
  });

  it("reads roughness as one minus gloss × the gloss map's alpha", () => {
    const s = shader();
    new SpecGlossMaterial().onBeforeCompile(s);
    expect(s.fragmentShader).not.toContain('#include <roughnessmap_fragment>');
    expect(s.fragmentShader).toContain('texelRoughness.a');
    expect(s.fragmentShader).not.toContain('texelRoughness.g');
  });

  it('keeps reading it through a clone, and through the vegetation dimming one', () => {
    const material = new SpecGlossMaterial({ roughness: 0.5 });
    for (const copy of [material.clone(), dimmedMaterial(material)]) {
      expect(copy).toBeInstanceOf(SpecGlossMaterial);
      const s = shader();
      copy.onBeforeCompile(s);
      expect(s.fragmentShader).toContain('texelRoughness.a');
    }
  });

  it('compiles to its own shader program, not the standard one', () => {
    expect(new SpecGlossMaterial().customProgramCacheKey())
      .not.toBe(new THREE.MeshStandardMaterial().customProgramCacheKey());
  });
});
