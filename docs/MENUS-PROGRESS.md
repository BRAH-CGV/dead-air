# Menus progress log

Task: `docs/MENUS-NAVIGATION-PROMPT.md` (pasted into the session; not on the branch).
Branch: `feat/menus-navigation` · **Base: `main`** (`_aimSun` found on `origin/main`, so PR #31 is merged).

## Phases

- [x] Phase 0: set up and orient
- [x] Phase 1: pause core
- [ ] Phase 2: pure navigation (AppFlow, PointerLock, keyNames)
- [ ] Phase 3: menus on screen
- [ ] Phase 4: restart and memory
- [ ] Phase 5: settings
- [ ] Phase 6: credits and end states
- [ ] Phase 7 (optional): continue, camera drift, layout-aware key names
- [ ] Phase 8: docs and production build
- [ ] Phase 9: ship

## Baseline (Phase 0, `npm run test` on `origin/main`)

58 of 64 files pass (1107 tests). The six that fail are all BUG-003, failing at import with
`The argument 'filename' must be a file URL object … 'file:///__vite-plugin-wasm-helper'`:

- `src/components/FirstPersonController.test.js`
- `src/core/Colliders.test.js`
- `src/gameobjects/BaseYard.test.js`
- `src/gameobjects/CommTowers.test.js`
- `src/gameobjects/MarsRocks.test.js`
- `src/gameobjects/MarsTerrain.physics.test.js`

## Decisions

- **The code moved on since the task doc was written.** `Engine.init()` now warms up shaders and holds the loading screen until the frames settle (`FrameSettle`), and then `_reveal()` fades the game in through `engine.screenFade.fadeIn`. While paused the loop still runs `_renderFrame`, so the settle and the reveal work unchanged behind the main menu.
- **The loop is split into `_simulate(dt)` and `_renderFrame(dt)`.** `_loop` keeps the timing and calls `_simulate` only while unpaused. That makes the pause gate one line, and the frame stays the same order as before.
- **`engine.devTools` defaults to `true` on the Engine itself.** That way a bare Engine (tests, or code without the app layer) keeps its debug keys. `App` sets it from the setting, which defaults to `import.meta.env.DEV`. The gate is `engine.debugKeysActive` (dev tools on and not paused).
- **`setPaused` clears `input.keys` and `input.pressed` in place, without replacing the objects.** Components hold references to them.
- **The second `_init` loop in `Engine.init()` is left alone.** No component overrides `onAwake` in a way that breaks on a second call, and removing it isn't needed for this task.
- **`GameController._setState` fires after `_endShift` has stopped the clock and set the prompt.** A listener therefore sees a fully ended shift.

## Needs a human

_(none yet)_

## QA results

_(Phase 8)_
