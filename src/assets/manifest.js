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
//   • Prefix keys by type ('model:', 'tex:', 'sfx:') so a typo'd key is obvious in
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
 * @property {'floor'} [origin]        'floor' re-centres a download whose pivot is off
 *           in space or sunk into its ground plane, so `position` is where
 *           the middle of its base stands. Also at load time.
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
 *
 * @typedef {Object} AudioEntry
 * @property {'audio'} type
 * @property {string}  url      Decoded once into a shared AudioBuffer; play it
 *                              through a THREE.Audio on `engine.audioListener`.
 */

// NOTE: the desk and floor textures are stand-ins, not final art. Swapping in
// the real thing means dropping the file into public/assets/ and changing the
// `url` below — nothing else moves.

/**
 * What the game puts on screen today. These are fetched up front, so the
 * loading bar is only ever as long as this object.
 * @type {Record<string, ModelEntry | TextureEntry | AudioEntry>}
 */
const PLACED = {
  // ── Models ──────────────────────────────────
  'model:colony-rover': {
    type: 'model',
    url: 'assets/models/colony-rover.glb',
    physics: 'static',
  },
  'model:chainlink-fence': {
    type: 'model',
    url: 'assets/models/chainlink-fence.glb',
    physics: 'static',
    // Raw model measures 17 m tall — an FBX/Sketchfab export in the wrong
    // units, not an actual 5-storey fence. Scaled to read as a real 2.4 m
    // chain-link run: scale = 2.4 / 17.
    scale: 2.4 / 17,
  },
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
  // The airlock's suit locker, and the bedroom's lockers.
  'model:locker': {
    type: 'model',
    url: 'assets/models/locker.glb',
    physics: 'static',
  },
  // The bedroom's bunk: the bed you sleep through the day in. Modelled
  // around its centre, so `origin: 'floor'` stands it on the floor.
  'model:bunk-bed': {
    type: 'model',
    url: 'assets/models/bunk-bed.glb',
    origin: 'floor',
    physics: 'static',
  },
  // Office furniture; the chair is in the bedroom too. Scales take each
  // download to real size: a 0.9 m chair, 0.5 m bin, 1.9 m shelf, 0.57 m
  // extinguisher, 0.74 × 1 m poster.
  'model:metal-chair': {
    type: 'model',
    url: 'assets/models/metal-chair.glb',
    scale: 0.365,
    physics: 'static',
  },
  'model:trash-bin': {
    type: 'model',
    url: 'assets/models/trash-bin.glb',
    scale: 0.25,
    physics: 'static',
  },
  'model:shelf': {
    type: 'model',
    url: 'assets/models/shelf.glb',
    scale: 0.9,
    physics: {
      body: 'static',
      // SHELF layer: player walks through, items rest on the boards.
      // Member of SHELF only, interacts with DEFAULT (ground, props) only.
      groups: { membership: ['SHELF'], filter: ['DEFAULT'] },
      shape: [
        // 5 shelf levels, evenly spaced from the top of the model down to
        // 8/9 of the way to the bottom. Each board is 0.35 deep, 0.025 thick,
        // 1 wide. Top board sits at the top of the bounding box (y ≈ 1.9 m).
        { type: 'box', size: [0.35, 0.025, 1], position: [0, 1.9,    0] },
        { type: 'box', size: [0.35, 0.025, 1], position: [0, 1.4778, 0] },
        { type: 'box', size: [0.35, 0.025, 1], position: [0, 1.0556, 0] },
        { type: 'box', size: [0.35, 0.025, 1], position: [0, 0.6333, 0] },
        { type: 'box', size: [0.35, 0.025, 1], position: [0, 0.2111, 0] },
        // 4 corner supports, full height, sticking out 0.01 m beyond the
        // shelf edges in x and z.
        { type: 'box', size: [0.035, 1.9, 0.035], position: [ 0.1675, 0.95,  0.4925] },
        { type: 'box', size: [0.035, 1.9, 0.035], position: [ 0.1675, 0.95, -0.4925] },
        { type: 'box', size: [0.035, 1.9, 0.035], position: [-0.1675, 0.95,  0.4925] },
        { type: 'box', size: [0.035, 1.9, 0.035], position: [-0.1675, 0.95, -0.4925] },
        // Player-only bounding box: a square box around the whole shelf that
        // only the player collides with (items pass through). This prevents
        // the player from walking through the shelf visually while allowing
        // items to rest on the individual shelf boards above.
        {
          type: 'box', size: [0.36, 1.9, 1.03], position: [0, 0.95, 0],
          groups: { membership: ['DEFAULT'], filter: ['PLAYER'] },
        },
      ],
    },
  },
  'model:fire-extinguisher': {
    type: 'model',
    url: 'assets/models/fire-extinguisher.glb',
    scale: 0.012,
    origin: 'floor',
    physics: 'static',
  },
  'model:poster': {
    type: 'model',
    url: 'assets/models/poster.glb',
    scale: 0.008,
  },
  // The UFO threat (UfoThreat, Ufo). 2 × 0.66 × 2 as downloaded, centred on
  // its middle — it flies, so no floor origin. Five times up makes a 10 m
  // saucer that fills the office window from the yard behind it. No shadow:
  // it moves, and shadow maps are frozen between changes.
  'model:ufo': {
    type: 'model',
    url: 'assets/models/ufo.glb',
    scale: 5,
    castShadow: false,
    receiveShadow: false,
  },
  'model:crate': {
    type: 'model',
    url: 'assets/models/crate.glb',
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

  // ── Audio ───────────────────────────────────
  'sfx:mask-breathing': {
    type: 'audio',
    url: 'assets/audio/mask-breathing.mp3',
  },

  // The UFO's visit (UfoThreat). Preloaded: night 1 brings it within the
  // first minute. The flight clip sets the UFO's timing — it arrives on the
  // clip's loudest moment, measured at runtime.
  'sfx:ufo-flight': {
    type: 'audio',
    url: 'assets/audio/ufo-flight.mp3',
  },
  'sfx:flickering-light': {
    type: 'audio',
    url: 'assets/audio/flickering-light.mp3',
  },
  'sfx:lightbulb-break': {
    type: 'audio',
    url: 'assets/audio/lightbulb-break.mp3',
  },
  'sfx:power-down': {
    type: 'audio',
    url: 'assets/audio/power-down.mp3',
  },
  'sfx:teleport-whoosh': {
    type: 'audio',
    url: 'assets/audio/teleport-whoosh.mp3',
  },
  'sfx:ear-ringing': {
    type: 'audio',
    url: 'assets/audio/ear-ringing.mp3',
  },
  // The generator outside (GeneratorSound): three clips cut, at MPEG frame
  // boundaries, from one 3-minute recording — decoding all of it would hold
  // ~34 MB of samples for 12 s of use. Start-up = 0–5 s, running = 40–50 s
  // (looped), stop = 171.5 s to the end. See ATTRIBUTIONS.md.
  'sfx:generator-start': {
    type: 'audio',
    url: 'assets/audio/generator-start.mp3',
  },
  'sfx:generator-running': {
    type: 'audio',
    url: 'assets/audio/generator-running.mp3',
  },
  'sfx:generator-stop': {
    type: 'audio',
    url: 'assets/audio/generator-stop.mp3',
  },
  // A breaker flicked on the generator's repair panel (BreakerPanel).
  'sfx:light-switch': {
    type: 'audio',
    url: 'assets/audio/light-switch.mp3',
  },
  // The sandstorm's wind (Sandstorm), looped seamlessly at load. ~31 s.
  'sfx:sandstorm': {
    type: 'audio',
    url: 'assets/audio/sandstorm.mp3',
  },
  // The dust eyes (DustEyes): the roar looped through a chase, kept quiet,
  // and the bite when one catches you.
  'sfx:tiger-attack': {
    type: 'audio',
    url: 'assets/audio/tiger-attack.mp3',
  },
  'sfx:monster-bite': {
    type: 'audio',
    url: 'assets/audio/monster-bite.mp3',
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
  'model:couch': {
    type: 'model',
    url: 'assets/models/couch.glb',
    physics: 'static',
  },
  'model:barrel': {
    type: 'model',
    url: 'assets/models/barrel.glb',
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
  'model:bush': {
    type: 'model',
    url: 'assets/models/bush.glb',
  },
  'model:break-panel': {
    type: 'model',
    url: 'assets/models/break-panel.glb',
    physics: 'static',
  },
  'model:door-interior': {
    type: 'model',
    url: 'assets/models/door-interior.glb',
    physics: 'static',
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
  'model:simple-desk': {
    type: 'model',
    url: 'assets/models/simple-desk.glb',
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
 * Heard every game, but fetched after the scene is up instead of behind the
 * loading screen: ~10 MB of mp3 that nothing has to wait for. `Ambience`
 * loads these and fades each in as it arrives.
 * @type {Record<string, AudioEntry>}
 */
const AMBIENT = {
  'sfx:interior-base-ambience-centre-room': {
    type: 'audio',
    url: 'assets/audio/interior-base-ambience-centre-room.mp3',
  },
  'sfx:interior-base-ambience-server-room': {
    type: 'audio',
    url: 'assets/audio/interior-base-ambience-server-room.mp3',
  },
  'sfx:interior-base-ambience-bed-room': {
    type: 'audio',
    url: 'assets/audio/interior-base-ambience-bed-room.mp3',
  },
  // Everywhere that isn't the base: the yard, the roof, the valley.
  'sfx:exterior-base-ambience-wind': {
    type: 'audio',
    url: 'assets/audio/exterior-base-ambience-wind.mp3',
  },
  // Not rooms: the music that creeps in under a scare (Ambience.setTension),
  // and a second, calmer track.
  'sfx:interior-base-ambient-music': {
    type: 'audio',
    url: 'assets/audio/interior-base-ambient-music.mp3',
  },
  'sfx:interior-base-spooky-music': {
    type: 'audio',
    url: 'assets/audio/interior-base-spooky-music.mp3',
  },
};

/**
 * Every asset the game knows how to load, placed or not. `assets.load(key)`
 * and `validateManifest()` both walk this, so a library model is a first-class
 * manifest entry — it just isn't fetched until something asks for it.
 * @type {Record<string, ModelEntry | TextureEntry | AudioEntry>}
 */
export const ASSETS = { ...PLACED, ...LIBRARY, ...AMBIENT };

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
    if (!['model', 'texture', 'audio'].includes(entry.type)) {
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
