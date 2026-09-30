# Bug Tracker

> Known bugs that are **not fixed yet**. When you fix one, move it to the
> "Fixed" section at the bottom with the commit hash. Add new bugs with the
> next free ID.
>
> Severity: **High** blocks gameplay or testing · **Medium** visibly wrong ·
> **Low** cosmetic or dev-only.

---

## Open

### BUG-003 — Rapier WASM doesn't load under vitest
- **Severity:** High (for testing)
- **Where:** any test that imports the real `@dimforge/rapier3d`: `Colliders.test.js`, `FirstPersonController.test.js`
- **What happens:** the whole file fails before any test runs, with
  `TypeError: The argument 'filename' must be a file URL object … Received 'file:///__vite-plugin-wasm-helper'`.
  It fails the same way under the default pool and under `--pool=threads`. AGENTS.md already calls this "background noise", but it means the character controller and the collider builders currently have no running tests. That includes the `EXCLUDE_SENSORS` change that lets the player walk through unlocked doorways.
- **Workaround:** new tests use the recording fake in `src/test/fakeRapier.js`.
- **Fix:** investigate `vite-plugin-wasm` together with the `vitest.config.js` alias and `deps.inline`. Possibly switch to `@dimforge/rapier3d-compat`, which inlines the WASM as base64 and needs no plugin.
- **Waiting on Adrian:** `rapier3d-compat` swaps a **production** dependency, so it needs his yes first. Until then, the 8 files that import Rapier for real fail to load. The count is the same on `main`.

### BUG-004 — Vitest worker timeout on the first LevelEditor test run
- **Severity:** Low (intermittent)
- **Where:** `npx vitest run src/editor/LevelEditor.test.js`
- **What happens:** the default (forks) pool sometimes fails with `Timeout waiting for worker to respond` (or `Failed to start forks worker`) before any test runs. Seen twice so far: on `LevelEditor.test.js` and `PerfStats.test.js`. `--pool=threads` passes, and later default-pool runs often pass too. It's probably a cold start on Windows.
- **Fix:** if it happens again, raise `test.poolOptions` timeouts or switch `vitest.config.js` to `pool: 'threads'`.

### BUG-007 — Production bundle over 500 kB
- **Severity:** Low
- **Where:** `npm run build` warns `Some chunks are larger than 500 kB after minification` (`index-*.js` is about 913 kB, 217 kB gzipped).
- **What happens:** it's only a warning, but it slows first load on lab machines. The level editor ships in the main bundle.
- **Fix:** lazy-load `LevelEditor` with `import()` on the first F2 press.

### BUG-008 — Three downloaded models lose their textures
- **Severity:** Low
- **Where:** `tree-fantasy.glb`, `tree-dead.glb`, `chainlink-fence.glb`
- **What happens:** all three need `KHR_materials_pbrSpecularGlossiness`, which three r185 doesn't support, and keep every colour and texture inside it. Each load logs `Unknown extension`, and the materials fall back to glTF's defaults: white, fully metallic, no texture. `PerimeterFence` replaces the fence's materials outright. `dimmedMaterial` zeroes the trees' metalness and their per-instance tint colours them, but their bark and leaf textures never load.
- **Fix:** re-export the two trees as metal/roughness (Blender imports spec-gloss and exports metal/roughness). For whoever owns the vegetation.

---

## Reported, not yet reproduced

From the meeting notes (`docs/2026-09-09-CGV-meeting-3.md`). These haven't been checked since.

| ID | Bug | Reported by | Notes |
|---|---|---|---|
| BUG-R1 | Server rack texture flickers (overlapping surfaces); not visible in Fullbright | mortalnumbnut | **Narrowed, not reproduced (needs a browser).** Not overlapping surfaces: `server-rack.glb` is a 12-triangle box, and a scan found no coplanar faces; the trim on each rack stands 1.7 cm proud of it. Its one texture is a mipmapped 1024² colour map, which Fullbright keeps, so it isn't texture shimmer either. What Fullbright removes is lighting and shadows. The rack's material is double-sided, the office ceiling light (24 m range, shadow-casting) reaches the server room through the doorways, and neither shadow-casting light sets `shadow.bias` or `shadow.normalBias`. Suspect shadow acne. Try `normalBias` about 0.02 on the moon and the ceiling light, and look at the racks from the aisle. |
| BUG-R2 | Z-fighting in some areas | — | The new rooms are built so that walls don't overlap. Re-check OfficeScene. |
| BUG-R5 | Editor JSON Load round-trip glitches (Fullbright/emissive, small shifts) | Adrian | Load button disabled. Full analysis in `docs/JSON-LOAD-DEBUG.md`. |

---

## Fixed

| ID | Bug | Fix |
|---|---|---|
| BUG-001 | OfficeScene and TestScene props were updated twice per frame: once as root objects and once as children, so the dish slewed at double speed | Both scenes adopt their props like `BaseScene._adopt`: parent them and take them off the root list. `1dbc2d9` |
| BUG-002 | OfficeScene spawned the player in its front wall | OfficeScene passes its own spawn, `[0, 1, 2]`, inside the office. TestScene's corridor has no front wall, so its default was already clear; a test now checks both. `1dbc2d9` |
| BUG-005 | OfficeScene's ceiling-light fixture stood on edge | The 90° turn is gone. A cylinder is already a flat disc along Y. `1dbc2d9` |
| BUG-R3 | The fly camera broke after a scene switch. It kept the old player, so the next `V` mounted the camera on a player no longer in the scene: the view froze, and the new player never froze | `Engine.loadScene` lands the fly camera before tearing the scene down. The first `Engine.test.js`. `4bea943` |
| BUG-R4 | The level editor's cone primitive collided like a box. So did its cylinder and sphere: every primitive got a box fitted to its bounds | `LevelEditor._shapeColliderDesc` picks a cone, cylinder or ball, sized from the same measured box, for the first collider and the rebuild after a scale change. `c6dbd85` |
| — | `ComputerTerminal.test.js` "hover ignores resolved signals" failed about one run in twelve: a randomly placed signal landed under the cursor and was rightly hovered | The test places every signal it depends on, and a new test covers a resolved signal on top of a live one. The hover code was right. `665be40` |
| BUG-006 | Room walls/props and outside stand-ins weren't in `engine._bodyToGO`, so raycasts (`InteractionSystem`) couldn't find them | `Room._addStaticBox` and `BaseScene._addStandIn` now register their body handle (phase 10, room-based scene). `Door.attachCollider` still doesn't — nothing needs a door to be raycastable yet, so that part is still open. |
| — | BaseScene player spawned inside a wall: the physics body ignored the spawn position and stayed at (0, 1, 5) | `buildPlayer` now creates the body at `position` (uncommitted as of writing) |
| — | FPS halved (60 → 30) whenever the office computer desk was on screen. Its `retro_futuristic_computer.glb` material uses glass transmission, which makes three.js render the whole scene a second time. Diagnosed with the `I` readout and Fullbright. | New manifest material option `transmission: 0`, applied in `ModelUtils.prepareModel` and set on `model:retro-computer` (uncommitted as of writing) |
