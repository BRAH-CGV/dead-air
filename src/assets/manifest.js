import { BODY_TYPES, AUTO_SHAPES, PART_TYPES } from '../core/ColliderSpec.js';

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

// ── Collision ──
// A model is render-only until its entry carries a `physics` block, so nothing
// decorative silently becomes solid. Three tiers, cheapest first:
//
//   1. `physics: 'static'`   A box fitted to the model's measured bounds. One
//                            line, no authoring, one cheap Rapier shape. This
//                            is right for most props.
//
//   2. Collider meshes in the .glb. Model simplified collision next to the art
//      in Blender, name those objects `UCX_something` or `collider_something`,
//      and export as usual. They are stripped from the render tree at load and
//      become convex hulls. The manifest line stays `physics: 'static'`.
//
//   3. `shape: [ … ]`        Hand-written primitives, for a downloaded model
//                            you can't re-export. Sizes are FULL metres — a
//                            1.6 m wide desk is `size: [1.6, …]`.
//
// Press ` in-game to see what you actually got. See src/core/ColliderSpec.js.

/**
 * @typedef {Object} ModelEntry
 * @property {'model'} type
 * @property {string}  url             Relative path under `public/`.
 * @property {number}  [scale]         Uniform scale baked in once, at load time.
 * @property {boolean} [castShadow]    Default true.
 * @property {boolean} [receiveShadow] Default true.
 * @property {PhysicsBlock|'static'|'dynamic'|'kinematic'} [physics]
 *           Absent means render-only. The bare string is shorthand for
 *           `{ body: … }`, which is all most entries need.
 *
 * @typedef {Object} PhysicsBlock
 * @property {'none'|'static'|'dynamic'|'kinematic'} [body='static']
 *           static = scenery, dynamic = pushable, kinematic = script-driven.
 * @property {'auto'|'box'|'hull'|'trimesh'|'none'|Object[]} [shape='auto']
 *           'auto' uses the .glb's collider meshes if it has any, else a box.
 *           'trimesh' is exact but hollow — static geometry only.
 * @property {number}  [friction=0.8]
 * @property {number}  [restitution=0]  Bounciness.
 * @property {number}  [mass]           kg. Dynamic only; overrides density.
 * @property {number}  [density=1000]   kg/m³. Dynamic only.
 * @property {boolean} [sensor=false]   Reports overlaps, blocks nothing.
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
    // Tier 1: a box fitted to the desk's bounds. When the real desk model
    // arrives with UCX_ meshes for the leg gap, this line doesn't change —
    // shape:'auto' picks them up on its own.
    physics: 'static',
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
 * 404 on the marker's server: absolute paths and capital letters. Also checks
 * the physics vocabulary, where a typo'd body type would otherwise show up as
 * a prop you walk straight through.
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

    problems.push(...validatePhysics(key, entry));
  }

  return problems;
}

/** @returns {string[]} */
function validatePhysics(key, entry) {
  if (entry.physics === undefined) return [];
  if (entry.type !== 'model') {
    return [`${key}: only models can have 'physics' — a texture has no geometry to fit`];
  }

  const spec = typeof entry.physics === 'string' ? { body: entry.physics } : entry.physics;
  const problems = [];

  if (spec.body !== undefined && !BODY_TYPES.includes(spec.body)) {
    problems.push(`${key}: unknown physics body '${spec.body}' — one of ${BODY_TYPES.join(', ')}`);
  }

  const { shape } = spec;
  if (shape !== undefined && !Array.isArray(shape)) {
    if (typeof shape === 'string' && !AUTO_SHAPES.includes(shape)) {
      problems.push(`${key}: unknown physics shape '${shape}' — one of ${AUTO_SHAPES.join(', ')}, or a list of parts`);
    }
  }

  for (const part of [shape].flat()) {
    if (!part || typeof part !== 'object') continue;
    if (!PART_TYPES.includes(part.type)) {
      problems.push(`${key}: unknown collider part type '${part.type}' — one of ${PART_TYPES.join(', ')}`);
    }
    if (part.type === 'box' && !Array.isArray(part.size)) {
      problems.push(`${key}: box collider needs 'size: [w, h, d]' in full metres`);
    }
  }

  return problems;
}
