# AGENTS.md

This file provides guidance to Qoder (qoder.com) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server (hot-reload, usually localhost:5173)
npm run build        # Production build → dist/ (test this before any deploy)
npx serve dist       # Serve production build locally (usually localhost:3000)
npm run preview      # Vite's built-in preview of the production build
```

There is no test runner configured yet. When one is added, tests go in `src/__tests__/` and should be runnable with `npm test`.

## Test-Driven Development (MANDATORY)

**Write tests BEFORE writing the function.** This is non-negotiable. For every new function or module:

1. Write the test file first in `src/__tests__/` describing expected behaviour
2. Run the test — it must fail (red)
3. Write the minimum implementation to make it pass (green)
4. Refactor if needed while keeping tests green

Do not ship a function that has no test. Do not write the function first and "add tests later."

## Deployment Constraints (from the course brief — DO NOT VIOLATE)

This game is hosted on the Wits CSAG LAMP server in a **subdirectory**, not the domain root.

- **`vite.config.js` must have `base: './'`** — this makes all asset paths relative
- **Never use absolute paths starting with `/`** anywhere in code or HTML — they will 404 on the server
- **Asset filenames must be lowercase, hyphen-separated, no spaces** — the server runs Linux (case-sensitive)
- **All runtime dependencies must be bundled or loaded from an HTTPS CDN** — the server serves static files only, no Node/npm
- **Test production builds locally with `npx serve dist`** before any upload — never test via `file://`
- **The deploy zip must have `index.html` at the top level**, not nested inside a folder

## Architecture

This is a Three.js browser game with three levels. The codebase is structured as ES modules bundled by Vite.

### Current state
Single-file starter in `src/main.js` — scene, camera, renderer, lighting, a rotating cube, and a floor. This will be decomposed into modules as the game grows.

### Target module structure
As the game expands, code should be split into focused modules under `src/`:

- `main.js` — entry point, game loop orchestration, scene lifecycle
- `player.js` — player entity: position, velocity, state machine (alive/dead/stunned)
- `controls.js` — input abstraction: keyboard/mouse state, pointer lock, key bindings
- `camera.js` — camera modes (first-person, third-person, minimap orthographic), smooth follow
- `levels/level1.js`, `levels/level2.js`, `levels/level3.js` — per-level scene construction, objectives, win/lose conditions
- `interactions.js` — raycast-based interaction system (press E to interact with objects)
- `ui.js` — HUD overlay, menus, crosshair, objective tracker, credits screen
- `shaders/` — custom GLSL vertex/fragment shaders (at least one required by the rubric)
- `audio.js` — sound effects and music management
- `utils/` — shared helpers (dispose utilities, geometry merging, etc.)

### Key Three.js patterns
- **Create objects once, reuse every frame.** Never allocate `Vector3`, materials, or geometries inside the animation loop — causes GC stutter.
- **Call `.dispose()` on geometries, materials, and textures** when removing objects or tearing down a level — otherwise GPU memory leaks.
- **Reuse geometries and materials** across similar objects instead of creating new ones per mesh.
- **Shadow maps are expensive** — limit which lights cast shadows, keep shadow map resolution reasonable, constrain shadow camera frustum.
- **Textures dominate memory** — use the smallest size that looks right, prefer power-of-two dimensions, use JPEG over PNG where possible.

### Scene graph hierarchy
Think carefully about parent-child relationships. Objects that move together should be nested. For example: a player mesh is a child of the player group; a weapon is a child of the camera (for first-person) or the player (for third-person).

## Rubric Priorities (for deciding what to build first)

| Category | Weight | Notes |
|----------|--------|-------|
| Gameplay & Experience | 25% | Each level must be genuinely distinct |
| 3D Effects | 15% | Lighting, shadows, reflections, skybox, textures (bump/height maps) |
| Viewing | 10% | Camera controls, multiple view modes, animated avatars |
| Control & Playability | 10% | WASD + mouse, 3D movement, physics, win/lose states |
| Shaders | 10% | Custom vertex + fragment shaders, uniforms driven by time/state |
| Polish | 10% | No lag, restart without refresh, menus, colour scheme |
| Innovation | 10% | Original ideas, custom assets, multiplayer, novel effects |
| Trailer | 10% | Max 2 min video |

## Game Concept

**Setting:** Alien planet. Player trying to establish contact with Earth. An unexplained creature stalks them.

- **Level 1 — Fix & Barricade:** Repair building components, barricade the door, receive instructions via signal receiver.
- **Level 2 — Repair Under Threat:** Creature breaks the signal receiver. Go outside to repair it without getting caught. Can scare creature off temporarily.
- **Level 3 — Boss / Escape:** Ambushed by creature. Fight or be killed. Reinforcements arrive but must evade creature to reach them.

The creature is inspired by SCP-096 (passive until provoked/seen, then lethally aggressive) but must be an **original design** — no SCP assets.

## Credits Requirement

Every asset, library, tutorial, or code not created by the team must be credited in an in-game credits screen. Credit everything you'd feel awkward being asked about in the demo. Maintain a living credits/attribution list as development progresses.
