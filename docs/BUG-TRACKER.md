# Bug Tracker

> Known bugs that are **not fixed yet**. When you fix one, move it to the
> "Fixed" section at the bottom with the commit hash. Add new bugs with the
> next free ID.
>
> Severity: **High** blocks gameplay or testing · **Medium** visibly wrong ·
> **Low** cosmetic or dev-only.

---

## Open

### BUG-001 — OfficeScene props are updated twice per frame
- **Severity:** Medium
- **Where:** `src/scenes/OfficeScene.js` (every `spawnModel` call followed by `addChild`)
- **What happens:** `Engine.spawnModel` pushes each model onto `engine._rootObjects`. OfficeScene then parents it under the `Office` or `Outside` group, which is itself under `SceneRoot`, also a root object. The engine loop updates the model once as a root object and once as a child. In OfficeScene the Satellite slews at **double speed**, and any component on a spawned prop runs twice.
- **Fix:** after `addChild`, remove the model from `engine._rootObjects`. `Room._spawnProp` and `BaseScene._adopt` already do this, so BaseScene isn't affected. A cleaner fix would give `spawnModel` a `parent` option so it never registers the model as a root object.

### BUG-002 — OfficeScene and TestScene spawn the player in the office's front wall
- **Severity:** Medium
- **Where:** default `position = [0, 1, 5]` in `Engine.buildPlayer`
- **What happens:** z = 5 is the office's front wall line, and the doorway is at x = 2, not x = 0, so the capsule starts inside the wall. BaseScene passes its own spawn point and isn't affected.
- **Fix:** pass a spawn position from each scene, e.g. `buildPlayer({ position: [0, 1, 2] })` in OfficeScene. Check TestScene's layout first.

### BUG-003 — Rapier WASM doesn't load under vitest
- **Severity:** High (for testing)
- **Where:** any test that imports the real `@dimforge/rapier3d`: `Colliders.test.js`, `FirstPersonController.test.js`
- **What happens:** the whole file fails before any test runs, with
  `TypeError: The argument 'filename' must be a file URL object … Received 'file:///__vite-plugin-wasm-helper'`.
  It fails the same way under the default pool and under `--pool=threads`. AGENTS.md already calls this "background noise", but it means the character controller and the collider builders currently have no running tests. That includes the `EXCLUDE_SENSORS` change that lets the player walk through unlocked doorways.
- **Workaround:** new tests use the recording fake in `src/test/fakeRapier.js`.
- **Fix:** investigate `vite-plugin-wasm` together with the `vitest.config.js` alias and `deps.inline`. Possibly switch to `@dimforge/rapier3d-compat`, which inlines the WASM as base64 and needs no plugin.

### BUG-004 — Vitest worker timeout on the first LevelEditor test run
- **Severity:** Low (intermittent)
- **Where:** `npx vitest run src/editor/LevelEditor.test.js`
- **What happens:** the default (forks) pool sometimes fails with `Timeout waiting for worker to respond` (or `Failed to start forks worker`) before any test runs. Seen twice so far: on `LevelEditor.test.js` and `PerfStats.test.js`. `--pool=threads` passes, and later default-pool runs often pass too. It's probably a cold start on Windows.
- **Fix:** if it happens again, raise `test.poolOptions` timeouts or switch `vitest.config.js` to `pool: 'threads'`.

### BUG-005 — OfficeScene ceiling-light fixture stands on edge
- **Severity:** Low
- **Where:** `OfficeScene._addLighting`, `fixture.rotation.x = Math.PI / 2`
- **What happens:** the cylinder is already a flat disc along Y. Rotating it 90° stands it upright like a wall plate instead of lying flush with the ceiling.
- **Fix:** delete the rotation line. MainOffice already has the corrected fixture.

### BUG-007 — Production bundle over 500 kB
- **Severity:** Low
- **Where:** `npm run build` warns `Some chunks are larger than 500 kB after minification` (`index-*.js` is about 913 kB, 217 kB gzipped).
- **What happens:** it's only a warning, but it slows first load on lab machines. The level editor ships in the main bundle.
- **Fix:** lazy-load `LevelEditor` with `import()` on the first F2 press.

---

## Reported, not yet reproduced

From the meeting notes (`docs/2026-09-09-CGV-meeting-3.md`). These haven't been checked since.

| ID | Bug | Reported by | Notes |
|---|---|---|---|
| BUG-R1 | Server rack texture flickers (overlapping surfaces); not visible in Fullbright | mortalnumbnut | Possibly overlapping meshes or normals in `server.glb`. The ServerRoom now has 4 of these racks, so it will be more noticeable. |
| BUG-R2 | Z-fighting in some areas | — | The new rooms are built so that walls don't overlap. Re-check OfficeScene. |
| BUG-R3 | Free cam breaks when switching scenes in the editor | — | `DebugCamera` may still hold the old player or scene after `loadScene`. |
| BUG-R4 | Cone collider shape doesn't work correctly | — | `ColliderSpec` / `Colliders` cone path. |
| BUG-R5 | Editor JSON Load round-trip glitches (Fullbright/emissive, small shifts) | Adrian | Load button disabled. Full analysis in `docs/JSON-LOAD-DEBUG.md`. |

---

## Fixed

| ID | Bug | Fix |
|---|---|---|
| BUG-006 | Room walls/props and outside stand-ins weren't in `engine._bodyToGO`, so raycasts (`InteractionSystem`) couldn't find them | `Room._addStaticBox` and `BaseScene._addStandIn` now register their body handle (phase 10, room-based scene). `Door.attachCollider` still doesn't — nothing needs a door to be raycastable yet, so that part is still open. |
| — | BaseScene player spawned inside a wall: the physics body ignored the spawn position and stayed at (0, 1, 5) | `buildPlayer` now creates the body at `position` (uncommitted as of writing) |
| — | FPS halved (60 → 30) whenever the office computer desk was on screen. Its `retro_futuristic_computer.glb` material uses glass transmission, which makes three.js render the whole scene a second time. Diagnosed with the `I` readout and Fullbright. | New manifest material option `transmission: 0`, applied in `ModelUtils.prepareModel` and set on `model:retro-computer` (uncommitted as of writing) |
