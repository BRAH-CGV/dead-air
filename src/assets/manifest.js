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
//   • The filename IS the key with that prefix dropped, so 'model:trash-bin'
//     lives at 'assets/models/trash-bin.glb'. Either one gives you the other
//     without opening this file; `validateManifest()` enforces it.
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
 * @property {{ side?: 'front'|'back'|'double', depthWrite?: boolean, transmission?: number,
 *              emissive?: number, emissiveIntensity?: number }} [material]
 *           Optional per-model cleanup for GLB material flags. `transmission: 0`
 *           turns off glass transmission, which otherwise costs a whole extra
 *           scene render every frame the model is on screen. `emissive`/
 *           `emissiveIntensity` tint the whole model self-luminous — for a
 *           model that should read as glowing without a separate lit prop.
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

/**
 * What the game puts on screen today. These are fetched up front, so the
 * loading bar is only ever as long as this object.
 * @type {Record<string, ModelEntry | TextureEntry>}
 */
const PLACED = {
  // ── Models ──────────────────────────────────
  // The vegetation belt instances these across the valley on every load, so
  // they are drawn, not optional — see MarsVegetation. It copies the meshes
  // directly rather than spawning them, so `physics` here only applies to a
  // tree placed by hand from the level editor.
  'model:tree-birch': {
    type: 'model',
    url: 'assets/models/tree-birch.glb',
    physics: 'static',
  },
  'model:tree-pine': {
    type: 'model',
    url: 'assets/models/tree-pine.glb',
    physics: 'static',
  },
  'model:tree-fantasy': {
    type: 'model',
    url: 'assets/models/tree-fantasy.glb',
    physics: 'static',
  },
  'model:tree-dead': {
    type: 'model',
    url: 'assets/models/tree-dead.glb',
    physics: 'static',
  },
  'model:desk': {
    type: 'model',
    url: 'assets/models/desk.glb',
    physics: 'static',
  },
  'model:retro-computer': {
    type: 'model',
    url: 'assets/models/retro-computer.glb',
    // This download marks some surfaces double-sided, which makes the front
    // keyboard/monitor faces visible from behind. Treat it like solid plastic.
    // Its main material also uses glass transmission, which makes three.js
    // render the whole scene a second time whenever the desk is on screen
    // (60 → 30 FPS looking into the office). Not needed — switched off.
    material: { side: 'front', depthWrite: true, transmission: 0 },
    // Tier 3 compound: a solid auto box blocks the under-desk hiding
    // mechanic. The model is a solid cabinet (not a table on 4 open legs),
    // indented on one face only.
    //
    // Measured directly in the level editor (F2, box primitives placed
    // against the rendered model, positions/sizes read off their transform
    // and handed back) rather than guessed — two guesses in a row from the
    // raw mesh data got the shape wrong (open on 3 sides, then a top slab
    // that still blocked walking up to it while standing). No separate top
    // lid: the back part is tall enough on its own, and the kneehole (+Z,
    // roughly the front half of the depth) has no ceiling at all, so a
    // standing player can walk up to it before needing to crouch further
    // toward the back/sides.
    //
    // This model has no manifest-level `scale`, so its measured bounds are
    // in its native ~100-wide space, not metres — every spawn (MainOffice,
    // OfficeScene) applies 0.016 on top to land at the real 1.6 m width.
    // The editor gave real-metre, world-space numbers; converted here by
    // subtracting the desk's spawn position [0,0,-2.55], undoing its 180°
    // spawn rotation (x,z each negate), then dividing by 0.016.
    physics: {
      body: 'static',
      shape: [
        { type: 'box', size: [93.0625, 45.625, 21.25], position: [3.75, 23.125, -14.375] },  // back region, 1.489×0.730×0.340 m @ local (0.06, 0.37, -0.23)
        { type: 'box', size: [15.625, 45.625, 50],     position: [41.875, 23.125, 0] },      // right side wall, 0.250×0.730×0.800 m @ local (0.67, 0.37, 0)
        { type: 'box', size: [15.625, 45.625, 50],     position: [-41.875, 23.125, 0] },     // left side wall, 0.250×0.730×0.800 m @ local (-0.67, 0.37, 0)
        // Front (+Z, roughly z > -0.06 m) is deliberately open — no part — for the kneehole.
      ],
    },
  },
  'model:server-rack': {
    type: 'model',
    url: 'assets/models/server-rack.glb',
    // No material tint — an emissive tint recolours the model itself
    // (tried it; even at low intensity it reads as "the rack is blue",
    // not "the rack is glowing"). The rack casting light like a source is
    // a light, not a material — see ServerRoom.buildProps, one PointLight
    // per rack, no geometry of its own.
    physics: 'static',
  },
  'model:radar-terminal': {
    type: 'model',
    url: 'assets/models/radar-terminal.glb',
    physics: 'static',
  },
  'model:security-camera': {
    type: 'model',
    url: 'assets/models/security-camera.glb',
    physics: 'static',
  },
  'model:switchboard': {
    type: 'model',
    url: 'assets/models/switchboard.glb',
    physics: 'static',
  },
  'model:dish-tower': {
    type: 'model',
    url: 'assets/models/dish-tower.glb',
    physics: 'kinematic',
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
 * Sourced, attributed and ready, but not placed in a scene yet. These are
 * fetched on demand — `await assets.load(key)` or spawn them from the level
 * editor, which loads them for you. Preloading the lot would add ~73 MB to a
 * cold start for models nobody sees.
 *
 * Moving one into a scene means moving its entry up into PLACED, so the two
 * lists never drift from what the game actually draws.
 * @type {Record<string, ModelEntry>}
 */
const LIBRARY = {
  'model:blast-door-closed': {
    type: 'model',
    url: 'assets/models/blast-door-closed.glb',
    physics: 'static',
  },
  'model:blast-door-open': {
    type: 'model',
    url: 'assets/models/blast-door-open.glb',
    physics: 'static',
  },
  'model:server-console': {
    type: 'model',
    url: 'assets/models/server-console.glb',
    physics: 'static',
  },
  'model:server-rack-tall': {
    type: 'model',
    url: 'assets/models/server-rack-tall.glb',
    physics: 'static',
  },
  'model:bunk-bed': {
    type: 'model',
    url: 'assets/models/bunk-bed.glb',
    physics: 'static',
  },
  'model:couch': {
    type: 'model',
    url: 'assets/models/couch.glb',
    physics: 'static',
  },
  'model:locker': {
    type: 'model',
    url: 'assets/models/locker.glb',
    physics: 'static',
  },
  'model:barrel': {
    type: 'model',
    url: 'assets/models/barrel.glb',
    physics: 'static',
  },
  'model:shelf': {
    type: 'model',
    url: 'assets/models/shelf.glb',
    physics: 'static',
  },
  'model:soap-dispenser': {
    type: 'model',
    url: 'assets/models/soap-dispenser.glb',
  },
  'model:vending-machine': {
    type: 'model',
    url: 'assets/models/vending-machine.glb',
    physics: 'static',
  },
  'model:colony-rover': {
    type: 'model',
    url: 'assets/models/colony-rover.glb',
    physics: 'static',
  },
  'model:poster': {
    type: 'model',
    url: 'assets/models/poster.glb',
  },
  'model:bush': {
    type: 'model',
    url: 'assets/models/bush.glb',
  },
  'model:break-panel': {
    type: 'model',
    url: 'assets/models/break-panel.glb',
    physics: 'static',
  },
  'model:chainlink-fence': {
    type: 'model',
    url: 'assets/models/chainlink-fence.glb',
    physics: 'static',
  },
  'model:crate': {
    type: 'model',
    url: 'assets/models/crate.glb',
    physics: 'static',
  },
  'model:door-interior': {
    type: 'model',
    url: 'assets/models/door-interior.glb',
    physics: 'static',
  },
  'model:fire-extinguisher': {
    type: 'model',
    url: 'assets/models/fire-extinguisher.glb',
  },
  'model:generator': {
    type: 'model',
    url: 'assets/models/generator.glb',
    physics: 'static',
  },
  'model:light-ceiling': {
    type: 'model',
    url: 'assets/models/light-ceiling.glb',
  },
  'model:metal-chair': {
    type: 'model',
    url: 'assets/models/metal-chair.glb',
    physics: 'static',
  },
  'model:simple-desk': {
    type: 'model',
    url: 'assets/models/simple-desk.glb',
    physics: 'static',
  },
  'model:trash-bin': {
    type: 'model',
    url: 'assets/models/trash-bin.glb',
    physics: 'static',
  },
  'model:wall-light': {
    type: 'model',
    url: 'assets/models/wall-light.glb',
  },
  'model:wall-screen': {
    type: 'model',
    url: 'assets/models/wall-screen.glb',
  },
};

/**
 * Every asset the game knows how to load, placed or not. `assets.load(key)`
 * and `validateManifest()` both walk this, so a library model is a first-class
 * manifest entry — it just isn't fetched until something asks for it.
 * @type {Record<string, ModelEntry | TextureEntry>}
 */
export const ASSETS = { ...PLACED, ...LIBRARY };

/**
 * Assets fetched before the first frame is drawn. Everything else can be
 * pulled in on demand with `assets.load(key)` — keep this list to what the
 * player sees immediately, or the loading screen drags on.
 * @type {string[]}
 */
export const PRELOAD = Object.keys(PLACED);

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

    // The filename is the key with its prefix dropped. Holding to that means
    // you can go from either one to the other without opening this file, and
    // it rules out the near-misses that cost us an afternoon once already:
    // dead-tree1.glb vs dead_tree1.glb holding two different trees.
    const base = entry.url.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
    const stem = key.slice(key.indexOf(':') + 1);
    if (base !== stem) {
      problems.push(`${key}: filename should match the key — expected '${stem}', got '${base}'`);
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(stem)) {
      problems.push(`${key}: name must be lowercase and hyphen-separated — '${stem}'`);
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
