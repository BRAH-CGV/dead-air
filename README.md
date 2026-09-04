# Dead Air — CGV Group Project

A 3D browser game built with Three.js for the Wits Computer Graphics & Visualisation course (COMS3006A / COMS3025A).

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- A modern browser (Chrome recommended)

### Install

```bash
git clone <this-repo>
cd dead-air
npm install
```

### Run locally (dev mode)

```bash
npm run dev
```

This starts Vite's dev server. Open the URL it prints (usually `http://localhost:5173`) in your browser. Click the canvas to lock the pointer, then use WASD to move and the mouse to look around.

Hot-reload is enabled — edit files in `src/` and the browser updates instantly.

### Run locally (production build)

This is what the LAMP server will serve, so test this before uploading:

```bash
npm run build
npx serve dist
```

Open `http://localhost:3000` in your browser. If it works here, it will work on the server.

### Deploy to LAMP server

```bash
npm run build
```

Then zip the **contents** of `dist/` so that `index.html` is at the top level of the archive, and upload that zip to the Moodle submission.

> **Important:** The Vite config (`vite.config.js`) sets `base: './'` so all asset paths are relative. This is required because the LAMP server hosts each group's game in a subdirectory, not at the domain root.

## Project Structure

```
dead-air/
├── index.html              # Entry point + loading overlay markup
├── public/
│   └── assets/             # Models & textures, copied verbatim into dist/
├── src/
│   ├── main.js             # Boot — creates Engine and awaits init()
│   ├── core/
│   │   ├── Engine.js       # Scene, renderer, physics, input, game loop
│   │   ├── GameObject.js   # Scene-graph node (Object3D + RigidBody)
│   │   ├── Component.js    # Base class with lifecycle hooks
│   │   ├── AssetManager.js # Loads, caches and clones .glb models + textures
│   │   ├── ModelUtils.js   # Per-mesh normalisation, measurement, collision
│   │   ├── ColliderSpec.js # Manifest physics block → collider shapes
│   │   ├── Colliders.js    # Collider shapes → Rapier bodies
│   │   └── PhysicsDebug.js # Collider wireframe overlay
│   ├── components/
│   │   └── FirstPersonController.js  # WASD + mouse look
│   ├── assets/
│   │   └── manifest.js     # Every asset path, by key
│   └── ui/
│       └── LoadingScreen.js
├── vite.config.js          # Vite config (base: './' for LAMP)
├── package.json            # Dependencies & scripts
└── dist/                   # Production build output (gitignored)
```

## Adding an asset

1. Drop the file into `public/assets/`. Use **lowercase, hyphen-separated** names — the LAMP server is case-sensitive even though your laptop probably isn't. Models must be plain `.glb`.
2. Register it in `src/assets/manifest.js`. The `url` is relative to `public/`:

   ```js
   'model:radar': { type: 'model', url: 'assets/models/radar.glb' },
   ```

3. Place it in the scene:

   ```js
   engine.spawnModel('model:radar', { position: [2, 0, -4], rotationY: Math.PI / 2 });
   ```

Asset paths never appear outside the manifest, so there is one place to check before submitting. Anything listed in `PRELOAD` is fetched before the first frame, with progress shown on the loading screen.

Two things worth knowing:

- **Instances share their geometry.** `spawnModel` clones from a single cached copy, so placing the same model twenty times costs one GPU upload. The flip side: never `.dispose()` an instance's geometry or material — you'd blank out every other copy. Teardown goes through `engine.assets.release(key)`.
- **Compressed models won't load.** Draco / Meshopt / KTX2 files fail with an explicit error. Re-export uncompressed from Blender, or add the decoders (see the comment at the top of `src/core/AssetManager.js`).

Custom models should be authored in **metres**, +Y up, with the origin on the floor at the object's centre. The origin matters more than it looks — colliders are fitted to measured bounds, so an origin in the wrong place puts the collider in the wrong place too.

## Making an asset solid

Models are render-only until you say otherwise, so nothing decorative accidentally becomes a wall. One key turns collision on:

```js
'model:cabinet': { type: 'model', url: '…', physics: 'static' },   // a fitted box
'model:crate':   { type: 'model', url: '…', physics: { body: 'dynamic', mass: 12 } },
```

That fits a box to the model's bounds — cheap, and right for most props. When a box isn't good enough (anything the player reaches into, or crawls under), you have two ways to be precise:

- **In Blender:** model simplified collision beside the art and name those objects `UCX_something`. They're stripped from the render tree at load and become convex hulls. The manifest line above doesn't change.
- **In the manifest:** list primitives by hand, for a download you can't re-export. Sizes are **full metres**, the way you'd measure the real object:

  ```js
  physics: { body: 'static', shape: [
    { type: 'box',      size: [1.6, 0.05, 0.8], position: [0, 0.72, 0] },
    { type: 'cylinder', radius: 0.15, height: 0.9 },
  ]},
  ```

Press **`` ` ``** in game to see every collider drawn over the scene. Use it — a collider that's subtly wrong looks completely fine until you walk into it. Full details in [AGENTS.md](AGENTS.md#physics--colliders).

## Controls

| Input | Action |
|---|---|
| **W A S D** | Move forward / left / backward / right |
| **Space** | Jump |
| **C** | Crouch |
| **Mouse** | Look around (requires pointer lock — click the canvas) |
| **`** | Toggle the collider debug overlay |
| **Esc** | Release pointer lock |

## Team

*To be confirmed.*
