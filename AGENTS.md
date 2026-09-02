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
│   └── ModelUtils.js    # Per-mesh normalisation, measurement, disposal
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

**FirstPersonController** — Component on Player. Reads `Engine.input` for WASD + mouse. YXZ Euler camera rotation. Drives `KinematicCharacterController` with capsule collider. Handles gravity, jump, ground detection.

### Scene hierarchy

```
Player (kinematic rigidBody, capsule collider)
  └─ CameraPivot
      └─ PerspectiveCamera (YXZ Euler)
Ground (visual PlaneGeometry + static cuboid collider, textured)
Crates (dynamic rigidBodies, box colliders)
Desk (imported .glb, no collider yet)
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
