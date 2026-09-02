// ─────────────────────────────────────────────
// Asset manifest  –  the single source of truth for every file we load
// ─────────────────────────────────────────────
// Nothing outside this file should hard-code an asset path. Ask the
// AssetManager for a key instead:
//
//     engine.assets.instantiate('model:desk')
//     engine.assets.get('tex:floor-basecolor')
//
// ── Rules (these come straight from the deployment constraints) ──
//   • Paths are relative to the site root and must NOT start with '/'.
//     Files live in `public/`, so `public/assets/models/desk.glb` is written
//     here as 'assets/models/desk.glb'.
//   • Filenames must be lowercase and hyphen-separated — the LAMP server is
//     case-sensitive, our dev machines usually are not. `validateManifest()`
//     shouts in dev if you slip up.
//   • Prefix keys by type ('model:', 'tex:') so a typo'd key is obvious in
//     the console.
//   • Models must be plain `.glb`. Draco / Meshopt / KTX2-compressed files
//     will fail to load — re-export them uncompressed from Blender, or wire
//     the decoders into AssetManager (see its header comment).
// ─────────────────────────────────────────────

/**
 * @typedef {Object} ModelEntry
 * @property {'model'} type
 * @property {string}  url             Relative path under `public/`.
 * @property {number}  [scale]         Uniform scale baked in once, at load time.
 * @property {boolean} [castShadow]    Default true.
 * @property {boolean} [receiveShadow] Default true.
 *
 * @typedef {Object} TextureEntry
 * @property {'texture'} type
 * @property {string}   url
 * @property {'srgb'|'linear'} [colorSpace]  'srgb' for colour maps, 'linear'
 *                                           for normal / roughness / metalness.
 * @property {[number, number]} [repeat]     Enables wrapping and sets repeat.
 * @property {boolean}  [flipY]
 */

// NOTE: the desk and floor textures are stand-ins, not final art. Swapping in
// the real thing means dropping the file into public/assets/ and changing the
// `url` below — nothing else moves.

/** @type {Record<string, ModelEntry | TextureEntry>} */
export const ASSETS = {
  // ── Models ──────────────────────────────────
  'model:desk': {
    type: 'model',
    url: 'assets/models/desk.glb',
  },

  // ── Textures ────────────────────────────────
  'tex:floor-basecolor': {
    type: 'texture',
    url: 'assets/textures/floor-basecolor.png',
    colorSpace: 'srgb',
    repeat: [24, 24],
  },
  'tex:floor-normal': {
    type: 'texture',
    url: 'assets/textures/floor-normal.png',
    colorSpace: 'linear',
    repeat: [24, 24],
  },
};

/**
 * Assets fetched before the first frame is drawn. Everything else can be
 * pulled in on demand with `assets.load(key)` — keep this list to what the
 * player sees immediately, or the loading screen drags on.
 * @type {string[]}
 */
export const PRELOAD = Object.keys(ASSETS);

/**
 * Dev-time sanity check. Catches the mistakes that build fine locally and then
 * 404 on the marker's server: absolute paths and capital letters.
 * @param {Record<string, object>} [assets]
 * @returns {string[]} human-readable problems, empty if the manifest is clean
 */
export function validateManifest(assets = ASSETS) {
  const problems = [];

  for (const [key, entry] of Object.entries(assets)) {
    if (!entry.url) {
      problems.push(`${key}: missing 'url'`);
      continue;
    }
    if (entry.url.startsWith('/') || /^[a-z]+:\/\//i.test(entry.url)) {
      problems.push(`${key}: url must be relative to public/ — got '${entry.url}'`);
    }
    if (entry.url !== entry.url.toLowerCase()) {
      problems.push(`${key}: url has capitals, and the LAMP server is case-sensitive — '${entry.url}'`);
    }
    if (entry.type !== 'model' && entry.type !== 'texture') {
      problems.push(`${key}: unknown type '${entry.type}'`);
    }
  }

  return problems;
}
