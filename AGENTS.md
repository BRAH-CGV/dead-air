# AGENTS.md — Dead Air

## Project Overview

Dead Air is a 3D browser-based survival horror game built for the Wits Computer Graphics & Visualisation course (COMS3006A / COMS3025A). Inspired by FNAF and Voices of the Void. The player is trapped in an office, surviving nights by collecting signals on a computer while fending off escalating threats.

- **Platform:** Web browser (Chrome on Ubuntu)
- **Framework:** Three.js (3D) + Rapier3D (physics)
- **Build tool:** Vite
- **Language:** JavaScript (ES Modules)

## Game Concept

- **Setting:** Office with desk, computer, huge window, server rack, radar terminal, power box, drive wiper...
- **Core loop:** Collect signals at night → meet minimum quota → survive until morning → upgrade → repeat.
- **Enemy concepts/ideas (introduced one per night):**
  1. Sleep Demon — punishes fatigue
  2. Window entities — hide under desk
  3. Camera entity
  4. Evil signal — must be deleted
  5. UFO — must cut power to hide
- **Requirement:** 3 genuinely distinct levels/stages, each introducing a new mechanic, environment, story element, or challenge type.

## Tech Stack

| Layer | Library | Version |
|---|---|---|
| 3D rendering | `three` | ^0.185.1 |
| Physics | `@dimforge/rapier3d` | ^0.20.0 |
| Build | `vite` | ^8.2.2 |
| WASM support | `vite-plugin-wasm` | ^3.6.0 |
| Tests | `vitest` | (dev) |

- **Renderer config:** Antialiasing on, PCFSoft shadow maps, ACES Filmic tone mapping, exponential fog.
- **Physics:** Rapier world with gravity `{x:0, y:-9.81, z:0}`, fixed timestep 1/60 s.

## Architecture

Custom ECS-like framework (Unity MonoBehaviour-inspired) in `src/core/`.

```
src/
├── core/
│   ├── Engine.js        # Singleton: scene, renderer, physics, input, game loop
│   ├── GameObject.js    # Scene-graph node: Object3D + RigidBody + Components
│   ├── Component.js     # Base class with lifecycle hooks
│   ├── AssetManager.js  # Loads, caches and clones .glb models + textures
│   ├── ModelUtils.js    # Per-mesh normalisation, measurement, collision, disposal
│   ├── ColliderSpec.js  # Manifest physics block → shape parts (pure, tested)
│   ├── Colliders.js     # Shape parts → Rapier bodies and colliders
│   └── PhysicsDebug.js  # Collider wireframe overlay (` to toggle)
├── components/
│   └── FirstPersonController.js  # WASD + mouse look, Rapier character controller
├── assets/
│   └── manifest.js      # Every asset path, by key. Single source of truth.
├── ui/
│   └── LoadingScreen.js # Preload progress overlay (markup lives in index.html)
└── main.js              # Entry point: creates Engine, awaits init()
```

### Key classes

**Engine** — Initializes Three.js scene, Rapier world, pointer-lock input, keyboard, resize. `init()` is **async**: it preloads the manifest before building the scene, so nothing pops in mid-render. Runs a fixed-timestep loop: `fixedUpdate → world.step → syncPhysicsToScene → update → lateUpdate → render`. Access via `scene.userData.engine`.

**AssetManager** — On the Engine as `engine.assets`. `load`/`loadAll` fetch and cache; `get(key)` reads the cache synchronously; `instantiate(key)` returns a clone. See the Assets section below.

**GameObject** — Wraps `THREE.Object3D` with optional `RAPIER.RigidBody` / `Collider`. Parent-child hierarchy (`addChild`/`removeChild`), component attachment (`addComponent`/`getComponent`), depth-first `find(name)`. Lifecycle propagates to children.

**Component** — Base class. Hooks: `onAwake` → `onStart` → `onUpdate(dt)` | `onFixedUpdate(dt)` | `onLateUpdate(dt)` → `onDestroy`. Getters: `transform`, `scene`, `world`.

**FirstPersonController** — Component on Player. Reads `Engine.input` for WASD + mouse. YXZ Euler camera rotation. Drives `KinematicCharacterController` with capsule collider. Handles gravity, jump (crouching included), ground detection, and Source-style movement — horizontal velocity integrates on the fixed step (`accel`/`airAccel`/`friction`/`stopSpeed` tunables) instead of snapping to wish speed. Crouch (`C` — toggle by default; `crouchMode: 'hold'` switches to hold-to-crouch): the player body carries two swapped capsules — standing 1.6 m and crouch 0.65 m, the tallest that clears the desk's 0.72 m under-top gap. Grounded swaps anchor the feet (stand-up gated by a headroom check); mid-air swaps anchor the capsule's centre — crouching tucks the legs up (crouch-jump), standing sweeps them back down and pops the body up onto whatever is below, so only the ceiling can refuse a stand-up.

### Scene hierarchy

```
Player (kinematic rigidBody, capsule collider)
  └─ CameraPivot
      └─ PerspectiveCamera (YXZ Euler)
Ground (visual PlaneGeometry + static cuboid collider, textured)
Crates (dynamic rigidBodies, box colliders)
Desk (imported .glb, static auto-fitted box collider)
```

### Input system

Centralized on `Engine.input`:
- `keys` — object keyed by `KeyboardEvent.code` (e.g. `KeyW`, `Space`)
- `mouse` — `{ dx, dy }` accumulated deltas, consumed each frame
- `locked` — boolean, pointer-lock active

## Assets

### Adding one

1. Drop the file in `public/assets/` — lowercase, hyphen-separated, `.glb` for models.
2. Add a key to [`src/assets/manifest.js`](src/assets/manifest.js). The `url` is relative to `public/`, so `public/assets/models/desk.glb` → `'assets/models/desk.glb'`.
3. Use it: `engine.spawnModel('model:desk', { position: [0, 0, -3] })`, or `engine.assets.get('tex:foo')` for a texture.

No path is ever hard-coded outside the manifest. `validateManifest()` runs in dev and warns about the two mistakes that only fail after upload: absolute paths and capital letters.

### How loading works

`GLTFLoader` returns a `Group` with geometry, materials and textures already wired up, including correct colour spaces. It does **not** set shadow flags, raise anisotropy, or fix bad units — `ModelUtils.prepareModel()` covers that on the way into the cache.

**Ownership rule.** The cache holds one copy of each model. `instantiate()` returns clones that *share* its geometry, materials and textures, so twenty crates cost one GPU upload. The consequence: never call `.dispose()` from an instance — drop it by removing it from the scene. `assets.release(key)` / `assets.dispose()` are the only places that free GPU memory, which is what keeps memory flat across levels.

Rigged models are cloned with `SkeletonUtils.clone()`; a plain `.clone()` leaves every copy bound to the original skeleton, so they animate in lockstep.

### Conventions for custom models

Author in **metres**, +Y up, origin on the floor at the object's centre. Export as `.glb` (single file — a `.gltf` with loose `.bin`/`.png` siblings is one more chance for a case-sensitive 404). `ModelUtils.normalize(root, targetSize)` is the escape hatch for a download authored in centimetres.

### Compression

The loader handles **plain `.glb` only**. Many Sketchfab / Poly Haven downloads are Draco- or Meshopt-packed and will fail with `No DRACOLoader instance provided`. Either re-export uncompressed from Blender, or wire the decoders in — see the header comment in [`src/core/AssetManager.js`](src/core/AssetManager.js).

### Placeholders

The desk and floor textures currently in `public/assets/` are stand-ins, not final art. Replacing one: drop the real file into `public/assets/` and point the manifest url at it.

## Physics & colliders

Collision comes from the asset pipeline, not from hand-written Rapier calls per object. One `physics` key in the manifest entry drives it.

**Collision is opt-in.** A model with no `physics` key is render-only, exactly as before — so skyboxes, posters and decals never quietly become solid. Adding the key is what turns it on.

### The three tiers

| | You write | You get | Use for |
|---|---|---|---|
| 1 | `physics: 'static'` | One box fitted to the model's measured bounds | Most props. Cabinets, crates, boxes on shelves |
| 2 | `UCX_*` meshes in the `.glb` | One convex hull per proxy mesh | Your own Blender models, anything with a hole or a gap |
| 3 | `shape: [ … ]` in the manifest | Hand-written compound primitives | Downloads you can't re-export |

Tiers 1 and 2 are **the same manifest line**. `shape` defaults to `'auto'`, which uses the `.glb`'s collider meshes if it shipped any and falls back to the bounding box if it didn't. So you can start every prop on tier 1 and upgrade it later by editing the model alone.

```js
'model:cabinet': { type: 'model', url: '…', physics: 'static' },
'model:crate':   { type: 'model', url: '…', physics: { body: 'dynamic', mass: 12 } },
'model:poster':  { type: 'model', url: '…' },                    // render-only
```

### Tier 2 — collider meshes in Blender

Model simplified collision next to the art, name those objects `UCX_something` or `collider_something`, export the `.glb` as normal. At load they are stripped from the render tree, their vertices baked into model space, their geometry freed, and each becomes a convex hull. Nothing in the manifest changes.

Each proxy must be **convex and have volume** — a flat or 3-point mesh can't be hulled and logs a warning. Model a concave shape as several convex pieces; that's what a compound collider is.

### Tier 3 — primitives in the manifest

```js
physics: {
  body: 'static',
  shape: [
    { type: 'box',      size: [1.6, 0.05, 0.8], position: [0, 0.72, 0] },
    { type: 'cylinder', radius: 0.15, height: 0.9, position: [0, 0.45, 0] },
  ],
},
```

**Sizes are full metres, measured the way you'd measure the real object** — a 1.6 m wide desk is `size: [1.6, …]`, not a 0.8 half-extent. `height` on a capsule/cylinder/cone is tip to tip. The halving Rapier wants happens in `ColliderSpec.js`, once.

Parts: `box` (`size`), `sphere` (`radius`), `capsule` / `cylinder` / `cone` (`radius` + `height`). All take an optional `position` and `rotation` (Euler XYZ radians) relative to the model origin.

Escape hatches: `shape: 'hull'` forces a convex hull over the render mesh, `shape: 'trimesh'` gives exact triangle-accurate collision (**static only** — a trimesh is hollow, so a dynamic body falls through it), `shape: 'none'` or `body: 'none'` opts back out.

### Seeing what you got

Press **`` ` ``** in game to overlay every collider Rapier knows about. Authoring a collider without it is guesswork — a `UCX_` mesh exported with a stray transform looks fine until you walk into thin air. The overlay is off by default and costs nothing while hidden.

### Conventions that make this work

- **Author origin on the floor**, at the object's centre. Bounds are measured, not assumed, so the fitted box is lifted to half the model's height. Get the origin wrong and the collider is wrong with it.
- Bounds and hulls are computed **once at load** and cached, so `spawnModel` stays cheap enough to call in a loop.
- Only `dynamic` and `kinematic` bodies enter `Engine.rigidBodyMap`. Static props never move, so they skip the per-step snapshot and interpolation entirely.
- `spawnModel(key, { physics })` overrides the manifest per spawn — one pushable crate among scenery.

### Worked example: the under-desk gap

The stand-in desk is on tier 1, so its collider is a solid 1.6 × 0.745 × 0.8 m block. That's fine for bumping into, but it means **you cannot crawl under it** — and hiding under the desk is a listed mechanic (window entities, night 2).

The fix when the real desk lands is tier 2: add `UCX_` proxies for the top and legs in Blender and the manifest line doesn't change. Or tier 3, using the stand-in's actual measurements:

```js
shape: [
  { type: 'box', size: [1.60, 0.05, 0.80], position: [ 0.00, 0.720,  0.00 ] },  // top
  { type: 'box', size: [0.06, 0.72, 0.06], position: [-0.74, 0.360, -0.34 ] },  // legs
  { type: 'box', size: [0.06, 0.72, 0.06], position: [-0.74, 0.360,  0.34 ] },
  { type: 'box', size: [0.06, 0.72, 0.06], position: [ 0.74, 0.360, -0.34 ] },
  { type: 'box', size: [0.06, 0.72, 0.06], position: [ 0.74, 0.360,  0.34 ] },
  { type: 'box', size: [1.40, 0.35, 0.03], position: [ 0.00, 0.440, -0.34 ] },  // modesty panel
],
```

Left on tier 1 deliberately: the desk is a placeholder, and hardcoded numbers would silently mismatch the model that replaces it, whereas the auto box re-fits itself.

## Commands

```bash
npm run dev        # Vite dev server with hot-reload
npm run build      # Production build → dist/
npm run preview    # Serve dist/ locally
npx serve dist     # Alternative: test production build over HTTP
npm run test       # Run Vitest
```

## Deployment

- Build with `npm run build`, zip the **contents** of `dist/` (not the folder) so `index.html` is at the archive root.
- Upload via Moodle — no SSH access to the LAMP server.
- **All paths must be relative** (no leading `/`). Vite config sets `base: './'`.
- Filenames are **case-sensitive** on the Linux server — keep asset names lowercase, hyphen-separated.
- Any external resource must use **HTTPS** (mixed content is blocked).
- The server serves **static files only** — no Node, no npm, no build tools.
- Test the production build locally over HTTP (`npx serve dist`) before uploading.

## Course Requirements (Grading)

| Category | Weight | Key expectations |
|---|---|---|
| Viewing | 10% | 3D scene, animation, camera control, multiple views |
| Control & Playability | 10% | Keyboard + mouse, clear objectives, 3D gameplay, physics |
| 3D Effects | 15% | Lighting, shadows, skybox, textures (bump/height maps), reflections |
| Shaders | 10% | Custom vertex + fragment shaders, time/state-driven uniforms, explainable code |
| Gameplay & Experience | 25% | Coherent theme, smooth controls, balanced gameplay, sound, replay value |
| Polish | 10% | No lag, restart without refresh, menus, colour scheme, QoL features |
| Innovation | 10% | Original mechanics, custom assets, novel effects, multiplayer, sound |
| Game Trailer | 10% | Max 2 min, cinematic, showcases gameplay, uploaded to YouTube |

### Mandatory checklist items
- [ ] 3 genuinely distinct levels (answer "what does this level add?")
- [ ] At least one custom shader the whole team can explain
- [ ] Game restarts without page refresh
- [ ] Credits screen listing all non-original work
- [ ] Production build (not source tree) uploaded
- [ ] No absolute paths (`/…`) in code
- [ ] Asset filenames match case exactly
- [ ] Acceptable frame rate on lab hardware (not gaming laptops)
- [ ] Memory doesn't climb across levels (dispose removed resources)

## Performance Guidelines

- Create nothing per frame (no allocations in the render loop).
- Reuse geometries and materials across objects.
- Dispose geometries, materials, and textures when tearing down a level.
- Limit shadow-casting lights; keep shadow map resolution sensible.
- Prefer `.glb` over `.gltf` with loose files; consider Draco compression.
- Scale textures to smallest acceptable size; prefer power-of-two dimensions.
- Profile with Chrome DevTools before optimizing.
