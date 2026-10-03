# Menus progress log

Task: `docs/MENUS-NAVIGATION-PROMPT.md` (pasted into the session; not on the branch).
Branch: `feat/menus-navigation` · **Base: `main`** (`_aimSun` found on `origin/main`, so PR #31 is merged).

## Phases

- [x] Phase 0: set up and orient
- [x] Phase 1: pause core
- [x] Phase 2: pure navigation (AppFlow, PointerLock, keyNames)
- [x] Phase 3: menus on screen (App also carries Phase 4's rebuild / restart / quit paths)
- [x] Phase 4: restart and memory
- [x] Phase 5: settings (§6.8 terminal-key rebinding skipped; the Controls screen lists Q / Enter / S / D as fixed)
- [x] Phase 6: credits and end states
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

- **The flashlight (`F`) is rebindable too.** It landed after the task doc was written and is a gameplay key, so `REBINDABLE` has eight actions, not seven.
- **`AppFlow.restartPaused()`.** If the pointer lock is refused after Restart or Retry, the rebuilt night waits on the pause screen with the "click RESUME again" hint. It doesn't fall back to the screen it came from.
- **Credits are reachable only from the main menu** (per §3.1). `openCredits()` is a no-op on other screens.
- **The task doc isn't committed.** It was pasted into the session and isn't on any branch. This log records everything a resume needs.

- **`engine.revealed` (a Promise resolved in `_reveal()`).** `init()` now resolves *before* the loading screen goes, because the frame-settle wait comes after it. `App.start()` awaits `revealed` before the main menu appears, so the menu never covers "Almost there…".
- **`#fade` moved from z-index 101 to 200, above the menu (150).** Each rebuild fade then covers the screen swap, the reveal fades the menu in with the scene, and Run complete appears as the bed's sleep fade clears.
- **Restart and Main menu landed in Phase 3, not Phase 4.** The pause menu's buttons need somewhere to go. `App.rebuild()` turns off the fly camera and fullbright, unsubscribes the old controller, calls `loadScene(activeScene.constructor)` and marks the flow clean.
- **Rebuild without a fade if one is already running** (`ScreenFade.play` returns false, e.g. the bed's). Rebuilding without a fade beats not rebuilding at all.
- **The fade is `engine.screenFade`**, the same instance the reveal uses. Its `playing` flag then guards both.
- **No browser tool was available in this session**, so §10 is left for a human (see QA results).

- **`RadarOverlay.dispose()` is fixed too, not only `SignalReviewPanel`.** Each overlay added a window `resize` listener per build and never removed it, which kept every old overlay and that scene's sky (through the backdrop) alive. Both scenes now call `dispose()` on both overlays. Those were the only per-scene listeners in `src/` (grepped).

- **`engine.playerController`.** `buildPlayer` stores the controller there, so `applySettings` can reach it without importing Rapier (`FirstPersonController` imports it).
- **`[E]` substitution goes through a tiny shared module, `src/ui/promptKeys.js`.** `PromptLabel` and `HUD` take a `keyLabel` option that defaults to its `withKeys`, and App calls `setInteractKey()` whenever settings apply. `PromptLabel` is constructed deep inside `InteractionSystem` and `RoomTransitionSystem`, so threading a function through would have touched more files. A prompt already on screen updates the next time it's shown.
- **Sliders apply live but aren't redrawn while dragged.** Redrawing would replace the `<input>` mid-drag. Choices, rebinds, tab switches and resets redraw, and focus comes back to the same control.
- **Selects are rows of choice buttons (`OFF LOW [HIGH]`), and toggles are `OFF / ON` pairs.** That fits VotV's plain text rows better than native `<select>`, which can't be styled in the dark theme. Left / Right step through them.
- **`setPixelRatio` is called only when the ratio changes.** It reallocates the canvas, and every slider tick re-applies all settings.
- **Saved key binds are validated as a set.** Any bad, reserved or duplicate code makes the whole set fall back to the defaults, because half a broken layout is worse than the defaults. A bind missing from an older save takes its default.

- **Credit titles keep an ordinary dash.** A heading is split only when its tail is a `⚠` note or a `TODO`, so "Blast door — closed" and "Blast door — open" keep their full titles.
- **The dev console warning also lists the "Downloaded but unattributed — TODO" section.** It names switchboard, bush and break-panel (all in the manifest) plus four unused files, next to the TODO entries and the floor and signal images. The doc's rule is not to drop TODOs silently.
- **The credits are inlined with `import … from '../../ATTRIBUTIONS.md?raw'`.** The production build contains them, and nothing is fetched at runtime.

## Needs a human

- **Memory counters across restarts (§6.5).** `renderer.info.memory.geometries` / `.textures` can't be reached without WebGL, which the tests don't have. The listener leaks are covered by tests (`src/ui/HUD.dispose.test.js`, plus the BaseScene and OfficeScene dispose tests). Still needed: in the browser, press I, then do Main menu → New game five times and check that the Geometries and Textures numbers come back to the same values.

- **Asset sources to confirm (they are not in the credits until they have an entry).** In code: `src/ui/menu/credits.js` (`UNATTRIBUTED_FILES`) and the dev console warning at startup.
  - Confirm the source of the floor textures (`public/assets/textures/floor-*.png`) and the signal images (`public/assets/signals/signal-*.png`). Add them to `ATTRIBUTIONS.md` if they're not original.
  - Resolve the three TODO entries in `ATTRIBUTIONS.md` (radar terminal, desk with computer, security camera). They show as "Source being confirmed" in dev builds and are hidden in the production build.
  - Add sources for `switchboard.glb`, `bush.glb` and `break-panel.glb` (all used through the manifest), listed under "Downloaded but unattributed — TODO".

## QA results

_(Phase 8)_
