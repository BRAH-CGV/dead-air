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
│   │   └── ModelUtils.js   # Per-mesh normalisation, measurement, disposal
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

Custom models should be authored in **metres**, +Y up, with the origin on the floor at the object's centre.

## Controls

| Input | Action |
|---|---|
| **W A S D** | Move forward / left / backward / right |
| **Mouse** | Look around (requires pointer lock — click the canvas) |
| **Esc** | Release pointer lock |

## Team

*To be confirmed.*
