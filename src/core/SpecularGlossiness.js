import * as THREE from 'three';

// ─────────────────────────────────────────────
// KHR_materials_pbrSpecularGlossiness  –  a GLTFLoader plugin  (BUG-008)
// ─────────────────────────────────────────────
// The older glTF material model: a diffuse colour, a specular colour and a
// glossiness, instead of base colour, metalness and roughness. three.js
// dropped it in r147, but some downloads still keep every colour and texture
// inside it (tree-fantasy, tree-dead, the chain-link fence). Unread, they
// fall back to glTF's defaults: white, fully metallic, no texture.
//
// This reads it as a MeshStandardMaterial, which is as close as a
// metal/rough material gets:
//   diffuse colour, texture and alpha → color, map, opacity
//   glossiness                        → roughness = 1 − glossiness
//   gloss map (the texture's alpha)   → roughness per texel (SpecGlossMaterial)
//   specular colour                   → not kept. Everything is a dielectric
//                                       (metalness 0), and a material with no
//                                       specular at all is made fully rough,
//                                       the nearest a standard material has
//                                       to "no highlight".
// ─────────────────────────────────────────────

const NAME = 'KHR_materials_pbrSpecularGlossiness';

/** The extension block on material `index`, or null. */
function specGlossOf(parser, index) {
  return parser.json.materials?.[index]?.extensions?.[NAME] ?? null;
}

/**
 * A MeshStandardMaterial whose roughness map is a spec-gloss map: roughness
 * is one minus gloss × the map's alpha, where three's own shader reads the
 * green channel as roughness directly. Only the gloss map needs a patched
 * shader; everything else about the material is standard.
 *
 * A class rather than an onBeforeCompile set on one material, because
 * Material.copy doesn't carry that callback, and the vegetation clones its
 * materials. A clone keeps its class, and the class keeps the patch.
 */
export class SpecGlossMaterial extends THREE.MeshStandardMaterial {
  onBeforeCompile(shader) {
    // `roughness` holds 1 − glossinessFactor, so 1 − roughness is the factor.
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', /* glsl */ `
      float roughnessFactor = roughness;
      #ifdef USE_ROUGHNESSMAP
        vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
        roughnessFactor = 1.0 - ( 1.0 - roughness ) * texelRoughness.a;
      #endif
    `);
  }

  customProgramCacheKey() {
    return 'spec-gloss';
  }
}

/** Register with `gltfLoader.register(parser => new SpecularGlossinessExtension(parser))`. */
export class SpecularGlossinessExtension {
  constructor(parser) {
    this.parser = parser;
    this.name = NAME;
  }

  getMaterialType(materialIndex) {
    return specGlossOf(this.parser, materialIndex) ? SpecGlossMaterial : null;
  }

  /** Runs after the loader has filled in glTF's metal/rough defaults, which
   *  for a material with no pbrMetallicRoughness block means fully metallic. */
  extendMaterialParams(materialIndex, params) {
    const ext = specGlossOf(this.parser, materialIndex);
    if (!ext) return Promise.resolve();

    const [r, g, b, a] = ext.diffuseFactor ?? [1, 1, 1, 1];
    params.color = new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
    params.opacity = a;
    params.metalness = 0;

    const specular = ext.specularFactor ?? [1, 1, 1];
    params.roughness = specular.every(c => c === 0) ? 1 : 1 - (ext.glossinessFactor ?? 1);

    const pending = [];
    if (ext.diffuseTexture) {
      pending.push(this.parser.assignTexture(params, 'map', ext.diffuseTexture, THREE.SRGBColorSpace));
    }
    if (ext.specularGlossinessTexture && params.roughness < 1) {
      pending.push(this.parser.assignTexture(params, 'roughnessMap', ext.specularGlossinessTexture));
    }
    return Promise.all(pending);
  }
}
