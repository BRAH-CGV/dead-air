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
├── index.html              # Entry point
├── src/
│   ├── main.js             # Boot — creates Engine and calls init()
│   ├── core/
│   │   ├── Engine.js       # Scene, renderer, physics, input, game loop
│   │   ├── GameObject.js   # Scene-graph node (Object3D + RigidBody)
│   │   └── Component.js    # Base class with lifecycle hooks
│   └── components/
│       └── FirstPersonController.js  # WASD + mouse look
├── vite.config.js          # Vite config (base: './' for LAMP)
├── package.json            # Dependencies & scripts
└── dist/                   # Production build output (gitignored)
```

## Controls

| Input | Action |
|---|---|
| **W A S D** | Move forward / left / backward / right |
| **Mouse** | Look around (requires pointer lock — click the canvas) |
| **Esc** | Release pointer lock |

## Team

*To be confirmed.*
