import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ASSETS, validateManifest } from '../assets/manifest.js';
import { prepareModel, disposeObject3D } from './ModelUtils.js';

// ─────────────────────────────────────────────
// AssetManager  –  loads, caches and hands out meshes & textures
// ─────────────────────────────────────────────
// One instance lives on the Engine as `engine.assets`.
//
// ── Ownership model (read this before disposing anything) ──
//   `load()` puts ONE copy of each asset in the cache. `instantiate()` hands
//   out clones that SHARE that copy's geometries, materials and textures — so
//   twenty crates cost one geometry upload and one shader compile, not twenty.
//
//   The consequence: never dispose an instance's geometry or material. Drop an
//   instance by removing it from the scene. GPU memory is freed in exactly one
//   place — `release(key)` / `dispose()` — when a level is torn down.
//
// ── Compression ──
//   We handle plain .glb only. A Draco / Meshopt / KTX2-compressed file fails
//   with "No DRACOLoader instance provided" or similar. Either re-export it
//   uncompressed from Blender, or add the decoders here: copy
//   node_modules/three/examples/jsm/libs/draco/gltf/ into public/vendor/draco/
//   and call gltfLoader.setDRACOLoader(new DRACOLoader().setDecoderPath(...)).
// ─────────────────────────────────────────────

/** Vite rewrites this. Our config sets base:'./', so URLs resolve relative to
 *  the document — correct at a domain root and inside a LAMP subdirectory. */
const BASE_URL = import.meta.env?.BASE_URL ?? './';

/** Join the deploy base to a manifest path without ever producing '//'. */
export function resolveAssetUrl(relativePath, base = BASE_URL) {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return prefix + String(relativePath).replace(/^\/+/, '');
}

export class AssetManager {
  /** key → { scene, animations } for models, THREE.Texture for textures */
  _cache = new Map();
  /** key → in-flight promise, so two callers share one request */
  _pending = new Map();

  /**
   * @param {Object} opts
   * @param {THREE.WebGLRenderer} [opts.renderer]  Read for the anisotropy cap.
   * @param {Record<string, object>} [opts.manifest]
   */
  constructor({ renderer, manifest = ASSETS } = {}) {
    this.manifest = manifest;
    this.renderer = renderer;

    if (import.meta.env?.DEV) {
      const problems = validateManifest(manifest);
      if (problems.length) {
        console.warn('[assets] manifest problems:\n  ' + problems.join('\n  '));
      }
    }

    this.manager = new THREE.LoadingManager();
    this.gltfLoader = new GLTFLoader(this.manager);
    this.textureLoader = new THREE.TextureLoader(this.manager);

    /** Cheap sharpness on textures viewed at a glancing angle, like the floor. */
    this.maxAnisotropy = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
  }

  // ──────────────────────────────────────────
  // Loading
  // ──────────────────────────────────────────

  /**
   * Load one manifest key. Safe to call repeatedly — between the cache and the
   * in-flight map, each file is fetched exactly once.
   * @returns {Promise<any>}
   */
  load(key) {
    if (this._cache.has(key)) return Promise.resolve(this._cache.get(key));
    if (this._pending.has(key)) return this._pending.get(key);

    const entry = this.manifest[key];
    if (!entry) {
      return Promise.reject(
        new Error(`[assets] unknown key '${key}' — add it to src/assets/manifest.js`),
      );
    }

    const url = resolveAssetUrl(entry.url);
    const promise = (entry.type === 'model'
      ? this._loadModel(url, entry)
      : this._loadTexture(url, entry))
      .then((asset) => {
        this._cache.set(key, asset);
        this._pending.delete(key);
        return asset;
      })
      .catch((err) => {
        this._pending.delete(key);
        throw new Error(`[assets] could not load '${key}' from '${url}' — ${err.message}`);
      });

    this._pending.set(key, promise);
    return promise;
  }

  /**
   * Load many keys, reporting progress as a 0..1 fraction. Rejects on the first
   * failure, so a missing file is loud rather than a silent gap in the scene.
   * @param {string[]} keys
   * @param {(fraction: number, loaded: number, total: number) => void} [onProgress]
   */
  async loadAll(keys, onProgress) {
    const total = keys.length;
    let loaded = 0;

    onProgress?.(total === 0 ? 1 : 0, 0, total);

    await Promise.all(keys.map(async (key) => {
      await this.load(key);
      loaded += 1;
      onProgress?.(loaded / total, loaded, total);
    }));
  }

  _loadModel(url, entry) {
    return this.gltfLoader.loadAsync(url).then((gltf) => {
      prepareModel(gltf.scene, {
        scale: entry.scale,
        castShadow: entry.castShadow,
        receiveShadow: entry.receiveShadow,
        anisotropy: this.maxAnisotropy,
      });
      return { scene: gltf.scene, animations: gltf.animations ?? [] };
    });
  }

  _loadTexture(url, entry) {
    return this.textureLoader.loadAsync(url).then((tex) => {
      // The classic import bug: a base-colour map left in linear space renders
      // washed out, and a normal map tagged sRGB lights incorrectly.
      tex.colorSpace = entry.colorSpace === 'srgb'
        ? THREE.SRGBColorSpace
        : THREE.NoColorSpace;

      if (entry.repeat) {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(entry.repeat[0], entry.repeat[1]);
      }
      if (entry.flipY !== undefined) tex.flipY = entry.flipY;

      tex.anisotropy = this.maxAnisotropy;
      tex.needsUpdate = true;
      return tex;
    });
  }

  // ──────────────────────────────────────────
  // Access
  // ──────────────────────────────────────────

  /**
   * The cached asset, or throws. Deliberately synchronous so scene-building
   * code stays readable — call it after `loadAll()`.
   */
  get(key) {
    const asset = this._cache.get(key);
    if (!asset) {
      throw new Error(
        `[assets] '${key}' is not loaded — add it to PRELOAD, or await assets.load('${key}') first`,
      );
    }
    return asset;
  }

  /** True if `key` is cached and `get`/`instantiate` will succeed. */
  has(key) {
    return this._cache.has(key);
  }

  /**
   * A fresh Object3D for a model key, sharing geometry and materials with the
   * cached original (see the ownership note above). SkeletonUtils.clone keeps
   * rigged models working — a plain .clone() leaves every copy bound to the
   * original skeleton, so they'd all animate in lockstep.
   * @returns {THREE.Object3D}
   */
  instantiate(key) {
    const asset = this.get(key);
    if (!asset.scene) {
      throw new Error(`[assets] '${key}' is not a model — instantiate() needs type:'model'`);
    }
    return cloneSkeleton(asset.scene);
  }

  /** Animation clips shipped inside a model's glTF. */
  getAnimations(key) {
    return this.get(key).animations ?? [];
  }

  // ──────────────────────────────────────────
  // Teardown
  // ──────────────────────────────────────────

  /**
   * Free the GPU resources behind one key. Only safe once every instance of it
   * is out of the scene — level teardown, not individual despawns.
   */
  release(key) {
    const asset = this._cache.get(key);
    if (!asset) return;

    if (asset.isTexture) asset.dispose();
    else disposeObject3D(asset.scene, { disposeShared: true });

    this._cache.delete(key);
  }

  /** Release everything. Call on a full teardown so memory doesn't climb. */
  dispose() {
    for (const key of [...this._cache.keys()]) this.release(key);
  }
}
