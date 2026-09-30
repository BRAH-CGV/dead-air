# Handoff: what's next after the shift update

> Written 2026-09-30 for an AI coding agent picking up Dead Air.
> Covers everything left **except menus, pause, settings and credits**,
> which Sibonelo's agent is building from `docs/MENUS-NAVIGATION-PROMPT.md`.
> You're working for Adrian (drax9207).

---

## 0. How to use this document

1. **Read `AGENTS.md` in full before anything else.** It's the project map and its rules are binding. If this document disagrees with AGENTS.md, AGENTS.md wins. If either disagrees with the code, the code wins; say so in your PR.
2. **Pick work in the order of §4.** Each package in §5 lists:
   - why it matters for the grade;
   - where the hooks already are;
   - a default design;
   - the tests to write first;
   - when it counts as done.
3. **One package per branch and PR.** Stop after opening the PR and report (§8).
4. **Decisions.** The team-level ones are listed in §6, each with a default. Use the default unless Adrian has answered, and write down which one you used in the PR. Ask Adrian only when a decision blocks you and has no default.
5. **Update the status column in §4** in the same PR that finishes a package.

Line numbers below are as of commit `8906776`. Search by the function or field name if they have drifted.

---

## 1. Ground rules (on top of AGENTS.md)

- **TDD is mandatory:** red, green, refactor, with tests beside the source.
  - Run one file at a time: `npx vitest run src/path/to/file.test.js`.
  - The `BaseScene` full-build tests are slow; they have a 60 s budget.
- **BUG-003:** real Rapier often fails to load under vitest.
  - Mock it the way `src/components/FirstPersonController.eye.test.js` does, or use the recording fake in `src/test/fakeRapier.js`.
  - Better still, keep gameplay logic in **pure classes** that take injected functions (`canSee(point)`, `isOccluded(from, to)`, `rand()`), so tests need no physics, camera or DOM.
- **Everything that ticks runs inside Component hooks** (`onUpdate` / `onFixedUpdate`). Never use `setTimeout`, `setInterval` or a separate `requestAnimationFrame`.
  - The menus branch pauses the game by skipping the engine's update step. Anything outside the loop keeps running behind the pause menu: a monster that kills you while paused.
- **No module-level mutable state.** All state belongs to the scene instance and is torn down in `BaseScene.dispose()`.
  - The menus branch restarts the game by rebuilding `BaseScene` (`App.rebuild()`), and the course checklist says memory must not climb across restarts.
  - `loadScene` does not call `onDestroy` on components. Unsubscribe in the scene's `dispose()`.
- **No allocations per frame.** Reuse module-level temporaries (`const _v = new THREE.Vector3()`), as `SightlineZone.js` does.
- **New HUD elements go inside `#hud`** in `index.html` (around L241).
  - The menus CSS hides `#hud`, `#crosshair`, `#prompt`, `#radar-overlay` and `#signal-review` whenever the game isn't being played.
  - Anything outside those would float over the menus.
  - HUD classes follow the existing pattern: markup in `index.html`, and a thin JS wrapper that becomes a no-op with a null root in tests (see `src/ui/HUD.js`).
- **Assets:**
  - Every asset goes through `src/assets/manifest.js`, with a lowercase, hyphenated filename and a relative path.
  - Anything that spawns mid-night (monsters) goes in `PLACED` so it is preloaded. `LIBRARY` entries are not preloaded and would pop in.
- **Attribution:** every non-original file (models, **sounds**, textures) needs an `ATTRIBUTIONS.md` entry in the existing format: a `###` heading, the attribution paragraph, then the table. The credits screen parses that file.
- **Wiring in `BaseScene`:** put new wiring in its own private method (`_addThreats()`, `_addAudio()`) called from `build()`, rather than growing `_addGameplaySystems()`. Several people edit that method, and separate methods keep merges clean.
- **Rooms don't know about gameplay.**
  - A room builds a prop and exposes it as a field (as `MainOffice.wallClock` and `LivingQuarters.bed` do).
  - `BaseScene` hands the prop its gameplay objects.
  - Follow that pattern.
- **Git:**
  - Branch per package: `feat/<name>`.
  - Conventional commits (`feat:`, `fix:`, `test:`, `docs:`), one per test + implementation pair.
  - Never push to `main` or `integration/*`. Never force-push.
  - Don't change git config.
  - Don't add or upgrade dependencies without asking Adrian.
- **In the same PR, update:**
  - `AGENTS.md` (architecture tree plus a short section for anything new);
  - any doc you made stale.

---

## 2. Where the project stands

### Branches

- **`main`** is behind.
- **PR #31, `integration/shift-update` → `main`,** is open and unmerged. It holds five features:
  - F1: 1.35 m player, eye at 1.24 m;
  - F2: faster signal minigame;
  - F3: airlock and EVA suit, doors always open;
  - F4: shift → morning → sleep → next night, dawn and a turning sky;
  - F5: office and bedroom redesign.

  It also holds the review fixes:
  - dish slew rate;
  - the interact ray stops at walls;
  - the airlock interlock;
  - the sky turns with the night.
- **Pick your base branch the way the menus task does:**
  ```
  git fetch origin
  git grep -q "_aimSun" origin/main -- src/components/Daylight.js && echo MERGED || echo NOT_MERGED
  ```
  - MERGED: branch from `origin/main` and open the PR against `main`.
  - NOT_MERGED: branch from `origin/integration/shift-update` and open the PR against it.
- **Stale remote branches:** `feet/new-models`, `dev/model-heirarchy`, `functionality/game-loop` and `dev/integration`. Ignore them; don't delete them.

### What works

- **The base:** one continuous `BaseScene`.
  - Rooms: MainOffice, ServerRoom, LivingQuarters and the Airlock, joined by corridors.
  - Outside: generator stand-in, dish tower, terrain, rocks, vegetation, fence.
- **The shift:** `NightClock` runs 12:00 → 6:00 AM in 300 s, and `GameController` runs `playing → morning / gameOver → …` (see AGENTS.md, "Shift and day").
  - `NightManager.maxNight` is 3.
  - The `N` debug key advances the night and wraps.
- **Signal work:** radar, aim the dish, scan, then save or delete in the review panel. The quota is `3 + (night − 1)`, clamped to 5 signals per night.
- **The player:** crouch at 0.65 m, which fits under the desk's 0.72 m kneehole; the EVA suit gates the hatch.
- **Shaders:** `MarsSky` (custom dome and stars, driven by `uDawn` and `uSkyRotation`) and `MarsVegetation` (wind sway through `onBeforeCompile`).
- **Debug tools:** `` ` `` colliders, `V` fly camera, `B` fullbright, `N` next night, `I` perf stats, `F2` level editor.

### In flight elsewhere: don't duplicate or collide

**Menus (Sibonelo)** are on branch `feat/menus-navigation`, specced in `docs/MENUS-NAVIGATION-PROMPT.md`. They add:

- in `Engine`: `paused` / `setPaused()`, `onSceneLoaded()` and a `devTools` flag;
- the `src/app/*` modules (`App`, `AppFlow`, `PointerLock`, `SettingsStore`, `applySettings`), plus `src/ui/menu/*` and `#menu` in `index.html`;
- in `GameController`: `onStateChange(listener)` and a private `_setState()`;
- `SignalReviewPanel.dispose()`;
- `invertY` on `FirstPersonController`;
- `PerfStats.show()` / `hide()`;
- a settings schema that makes a `volume` setting a one-line addition.

Touch those files only where a package below says so, and keep the diff small. If the menus branch has merged into your base, build on its APIs. If it hasn't, build against the interface described here and note it in the PR.

**Stamina (Hayden)** is his system. See package B before touching it.

---

## 3. What the grade still needs

| Grading area | Weight | State | Package |
|---|---|---|---|
| Gameplay & Experience | 25% | Signal loop and day cycle work. **No threats, no sound.** | A–E |
| 3 genuinely distinct levels | checklist | **Missing.** The nights differ only in quota. | A–D |
| 3D Effects | 15% | Lighting, shadows, sky, textures are in. | F, I |
| Shaders | 10% | Sky and vegetation. A second, gameplay-driven one is easy to explain in the demo. | G |
| Polish | 10% | Menus/restart in flight (Sibonelo). Frame rate unmeasured on lab hardware. | I |
| Innovation | 10% | Custom sky, procedural terrain. Sound would help. | E |
| Control & Playability | 10% | Good. Needs clear objectives per night (HUD hints). | A |
| Trailer | 10% | Not started. Human task. | L |

The course requires every level to answer **"what does this level add?"** The plan below gives each night its own mechanic:

| Night | Threat | New mechanic | Where |
|---|---|---|---|
| 1 | Sleep Demon | Resource management: stamina drains, eat rations or it closes in | Whole base; rations in the MainOffice |
| 2 | Window Watchers | Timing and hiding: hear or see it coming, crouch under the desk | MainOffice window and desk |
| 3 | Camera Entity | Stealth: cross the server room outside a sweeping camera's view | ServerRoom |

---

## 4. Work packages, in order

| ID | Package | Size | Depends on | Status |
|---|---|---|---|---|
| A | Threat framework and the fail path | S | — | done |
| C | Night 2: Window Watchers, hide under the desk | M | A | done, with D4's dark-office hiding |
| D | Night 3: Camera Entity in the server room | M | A | done |
| B | Night 1: stamina (minimal) and the Sleep Demon | M | A, Hayden | done: the minimal stamina seed; the full system stays Hayden's |
| E | Sound | L | A (for threat cues) | done |
| F | Power: generator cut, base lights, model swap | M | — | done |
| G | CRT/signal shader on the terminal monitor | S–M | — | done |
| H | Oxygen outside | S | F (gives a reason to go out) | done |
| I | Performance pass | M | — | done, except the lab-hardware FPS reading (a human) |
| J | Asset hygiene and attributions | S | — | done; three provenance questions open (see the PR) |
| K | Bug sweep | S | — | done, except BUG-003 (Adrian's call), R1 (needs a browser), R2, R5, BUG-004 and BUG-007 |
| L | Submission support | S | everything | build, path check, two checklist items and the trailer shot list done; a full night on `npx serve dist`, the zip and the trailer are human work |

All twelve went in on one branch, `feat/threats-nights-and-polish`, as one PR against `main`, as Adrian asked, rather than a branch per package (§1 Git). They share `BaseScene`, the HUD and the manifest, and the later packages build on the earlier ones.

- C and D come before B because their hooks are already built (crouch height, desk collider, `SightlineZone`) and they don't wait on anyone.
- B waits on a conversation with Hayden (§5 B).
- E, F, G, I and J touch different files from the threats and can run in parallel on separate branches.

---

## 5. Packages

### A. Threat framework and the fail path

**Why.** Every threat needs two things: a way to end the night, and a per-night on/off switch. Build them once.

**Hooks.**
- `src/gameplay/GameController.js`:
  - `_gameOver()` (~L199) exists but is only reached when the quota is missed at 6 AM;
  - `retryNight()` (~L107) restarts from `gameOver`;
  - `PROMPT.failed` (~L28).
- `BaseScene._addGameplaySystems()` (~L253) builds the `GameplaySystems` GameObject that `GameController` and `Daylight` live on.

**Build.**

1. **`GameController.fail(reason)`**, test-first in `GameController.test.js`:
   - From `playing` it moves to `gameOver`: pauses the clock, stores `this.failReason = reason`, and sets the HUD prompt to `` `${reason} [E] to retry` ``.
   - It is a no-op in any other state. Morning is safe, and a threat that fires after 6 AM must not kill.
   - `startNight()` clears `failReason`.
   - If the menus branch is in your base, go through its `_setState()` so `onStateChange` fires, and test that a listener gets `('gameOver', 'playing')`. The Night failed screen can then show `controller.failReason`; mention that to Sibonelo in the PR.
2. **`src/gameplay/threats/Threat.js`**, a plain base class (not a Component):
   - methods `start(ctx)`, `stop()`, `update(dt)`, and an `active` flag;
   - `ctx` = `{ engine, scene, controller, player, rooms, transitions, stamina, audio }`, with unused fields left `null`;
   - it kills with `ctx.controller.fail(reason)`.
3. **`src/gameplay/ThreatDirector.js`**, a Component added to `GameplaySystems` right after `GameController`, for the same reason `Daylight` is: it reads the state the controller just moved to.
   - `THREATS_BY_NIGHT = { 1: ['sleepDemon'], 2: ['windowWatchers'], 3: ['cameraEntity'] }` (decision D1), with `register(key, threat)`.
   - Each `onUpdate` compares `controller.state` and `controller.nightNumber` with what it saw last frame:
     - It **becomes** `playing`, or the night number changes while playing: stop everything, then `start()` that night's threats fresh. This one rule covers sleeping, `retryNight()`, the `N` key and a rebuild.
     - Any state other than `playing`: stop everything. The day is safe, and a failed night freezes.
     - While `playing`: `update(dt)` each active threat.
   - Polling instead of subscribing means it works with or without the menus branch's `onStateChange`, and it allocates nothing.
   - Hold all threats while `engine.debugCamera?.active` is true: the player's components are disabled then, so they can't react.
   - `dispose()` stops everything. `BaseScene.dispose()` calls it.
4. **Threat visuals.**
   - Each is a GameObject under a `Threats` group under the scene root, spawned at build time with `visible = false` and **no collider** (`physics: 'none'`). Monsters that aren't bodies can't push the player through walls.
   - Spawn with `engine.spawnModel` and then adopt it the way `BaseScene._adopt` does (~L660). Otherwise it stays in `engine._rootObjects` and updates twice a frame; that's BUG-001, which OfficeScene still has.
5. **A HUD objective line** (`HUD.setObjective(text)` inside `#hud`) that says what tonight's threat asks of you in one sentence, for example "Something walks past the window. Don't let it see you." It's cheap, and it covers the "clear objectives" grade.

**Tests first.**
- `GameController.test.js`: `fail()` from `playing` gives `gameOver` with the reason; it's a no-op from `morning`, `gameOver` and `idle`; `startNight` clears `failReason`; after `fail()`, `retryNight()` works.
- `ThreatDirector.test.js`, with a fake controller and fake threats:
  - it starts night N's threats when the state becomes `playing`;
  - it stops them on `morning` and on `gameOver`;
  - a retry (same night number, `gameOver → playing`) restarts them fresh;
  - a night change while playing swaps them;
  - nothing updates while not playing;
  - nothing updates while the fly camera is active;
  - `dispose()` stops them all.

**Done when.**
- Pressing `N` through the nights logs the right threat starting and stopping.
- A temporary test threat that calls `fail('test')` shows the failed prompt, and `[E]` retries with fresh threat state. Remove that temporary threat before the PR.

---

### C. Night 2: Window Watchers

**Vision.** "Visible through the office window. Must hide / avoid looking." AGENTS.md lists "Window entities — hide under desk", and the crouch height and the desk's collider were built for exactly this (AGENTS.md, "Worked example: the under-desk gap").

**Hooks.**
- `MainOffice`: the back window is an 8.5 m wide opening in the back wall at room-local z ≈ −4.84, sill 0.475 m (`_buildWindowFrame`). The desk sits at `[0, 0, -2.55]` facing the window, so the player at the terminal looks straight out.
- The kneehole spans x ±0.545 and opens toward +Z (the door side).
- `FirstPersonController.crouched` (a boolean).
- `RoomTransitionSystem.currentRoom`: a `{ name, containsPoint }` object, or `null` in corridors and outside.
  - It sits on the player, but `BaseScene._spawnPlayer()` (~L603) only holds it in a local `transitions`. Store it as `this.transitions` so threats can read it.
  - Its `onRoomChange` is already assigned to `_applyRoomFog`. Chain onto it; don't reassign it, or the per-room fog stops working. The same goes for audio in package E.
- `SightlineZone` (`src/gameobjects/SightlineZone.js`): a box volume with `containsPoint(worldPoint)`. Reuse it for the hiding spot.

**Default design.**
- **The cycle, per watcher:**
  1. `idle`: a random 25–45 s, from the seeded RNG in `src/core/Random.js`.
  2. `approach`: a figure appears 15–20 m out beyond the window and walks to the glass over about 8 s.
  3. `peer`: it stands at the glass for 5 s, looking in.
  4. `leave`, then back to `idle`.

  That's about six visits in a 300 s night. Use one figure at first, and add a second from 3 AM if it plays too easy.
- **Seen:** during `peer`, the player dies (`fail('Something saw you through the window.')`) if the player is in `MainOffice` and **not hidden**.
- **Hidden** = `controller.crouched` and the player's eye position is inside the `UnderDesk` zone.
- **Leaving the office** is safe too, but the terminal is in there, so hiding in the corridor costs quota time.
- **Optional "don't look at it":**
  - During `approach`, staring at it (within 10° of the view centre for 1.5 s) skips it straight to `peer`.
  - Test the angle as a pure function.
- **The `UnderDesk` zone:**
  - A `SightlineZone` built by `MainOffice` and exposed as `mainOffice.underDesk`.
  - Start at room-local position `[0, 0.35, -2.45]`, size `[1.0, 0.7, 0.9]`.
  - **Then measure it in the level editor (F2)** against the rendered desk, the way the desk collider was measured. Two guesses from mesh data were wrong last time.
- **Figures walk on the terrain outside the back wall.** Their path must stay clear of the base. Put their feet at `terrainHeightAt(x, z)` from `src/gameobjects/MarsTerrain.js` (~L163), with the same options `BaseScene` builds the terrain with, so they don't float or sink.
- **Figure model:** decision D3. The default is a procedural placeholder: a tall, thin dark capsule with two small emissive eyes, built the way `BaseScene._addStandIn` builds stand-ins, with `placeholderFor` set. A model can then swap in later with one manifest line.

**Tests first.** A pure `WindowWatcherLogic`, with injected `rand`, `isSeen()` and `lookAngle()`:
- the phase sequence and its durations;
- a kill only during `peer`, only when seen;
- no kill when hidden or out of the office;
- the optional look rule;
- `start()` resets the phases;
- `stop()` hides the figures.

Also `MainOffice.test.js`: `underDesk` exists, and contains a crouched eye point at the kneehole centre but not a standing player at the chair.

**Done when.** On night 2 (press `N` once), working at the desk, a figure comes to the glass. Crouching into the kneehole in time survives it; staying standing ends the night.

---

### D. Night 3: Camera Entity

**Vision.** "Watches from the server room. Must avoid its line of sight."

**Hooks.**
- The `ServerRoom` has a `SightlineZone` over the rack aisle (`ServerRoom.buildProps`, ~L88): room-local `[0, 1.5, -0.5]`, size `[4, 2, 5]`. Its comment says "stub for phase 10".
- Four racks with `physics: 'static'` colliders give the player cover.
- The console (`model:radar-terminal`, ~L80) has a stub Interactable, `[E] Delete signal`, that only logs.
- `model:security-camera` is in `PLACED`. It's only spawned in the old `OfficeScene` and `TestScene`, so it's free to use.
- The interact ray in `src/components/InteractionSystem.js` (~L83) shows the `castRay` call with `EXCLUDE_SENSORS`. Reuse the same filter for the line-of-sight ray, so open doorways don't block it.

**The problem to solve first.** Nothing makes the player enter the server room, so a camera there is skippable. Night 3 needs a reason to go in (decision D2).

- **Default: storage offload.**
  - From night 3, the terminal holds at most 2 saved signals.
  - Saved signals only count toward the quota once they are **stored** at the server console. Its prompt becomes `[E] Store signals (n)`, replacing the delete stub.
  - The HUD shows how many are waiting.
- **In `SignalManager`:**
  - add `pending` and `stored` counts and a `storageLimit`, where `null` means off, as on nights 1–2;
  - when a limit is set, `isComplete()` uses `stored`.
- Everything that touches this goes test-first in `SignalManager.test.js` and `GameController.test.js`, and nights 1–2 must behave exactly as before.

**Default camera design.**
- It hangs high in a ServerRoom corner and looks down the aisle.
- It sweeps its yaw between two limits over about 8 s, pausing 1.5 s at each end.
- View cone: half-angle 25°, range 7 m.
- **Exposure**, checked each frame:
  - the player's eye is inside the `SightlineZone`;
  - and inside the cone;
  - and the ray from the lens to the eye isn't blocked.

  If so, `exposure += dt × 1.2`; otherwise it decays at `dt × 0.5`. At 1 → `fail('The camera found you.')`.
- **Tell:**
  - a red tally light whose intensity follows exposure;
  - a faint additive cone mesh showing where it looks (a good 3D-effects moment in the trailer);
  - when exposure passes 0.6, it stops sweeping and locks on to the player until exposure decays. That's the "entity" part.
- Crouching behind a rack blocks the ray; that's the counterplay.

**Tests first.** Pure `CameraSweep` and `CameraExposure`, with an injected `isOccluded(from, to)`:
- the yaw over time, pauses included;
- `inCone()` at the edges;
- exposure rises, decays and fails at 1;
- lock-on above 0.6;
- a reset on `start()`.

Also: `SignalManager` storage rules, and night 1 unaffected.

**Done when.** On night 3 you have to cross the server room several times, timing each crossing to the sweep or using the racks for cover. Standing in the aisle in view ends the night.

---

### B. Night 1: stamina and the Sleep Demon

**Coordinate first.**
- Stamina is **Hayden's** system (GENERAL-VISION.md, "Team Roles").
- Before you start, run `git branch -r` and look for his work, and ask Adrian whether Hayden has started.
- If nothing exists, build the **minimal** version below, and say in the PR that it's the seed for Hayden to extend, not a replacement.

**Vision.**
- **Stamina** drains over the night; eating restores it; low stamina darkens the lights and brings the Sleep Demon closer.
- **The Sleep Demon** "teleports progressively closer as fatigue increases".
- **Story:** the protagonist is an insomniac on night shift, so the demon should feel ambiguous, real or imagined (`docs/NEXT-FEATURES-PLAN.md` §1).

**Hooks.**
- `MainOffice._buildRationDispenser()` (~L126): its `onInteract` is a stub with `// TODO: coordinate with Hayden's stamina system.`
- The bed (`src/components/Bed.js`) is live only in the morning; a mid-shift nap is a later idea, not part of this package.

**Minimal stamina.**
- **`src/gameplay/Stamina.js`**, pure:
  - `value` runs 1 → 0;
  - `drainPerSecond` defaults to reaching 0 around 4 AM with no food: 0.005/s over the 300 s night;
  - `restore(amount)`, `reset()`, and `level` = `'ok'` (≥ 0.5) | `'tired'` (≥ 0.2) | `'critical'`.
- **Ticking:** a small Component on `GameplaySystems` ticks it only while `controller.state === 'playing'`, and resets it when a night starts (the same polling trick as `ThreatDirector`).
- **The dispenser:**
  - `MainOffice` exposes it as `rationDispenser`, and `BaseScene` sets `.stamina` on it.
  - Eating restores 0.35, then runs a cooldown of about 40 s.
  - During the cooldown the label reads `Dispenser refilling…`. Update `promptLabel` as a data field; AGENTS.md explains why.
- **HUD:** `HUD.setStamina(value)`, a bar inside `#hud`.
- **Dimming the lights at low stamina** is optional. Do it only through package F's `BaseLights` `fatigue` factor. Don't write a second system that sets light intensities.

**Default Sleep Demon design.**
- **Anchors:** five points, from far to near. Rooms expose them as room-local positions (e.g. `room.threatAnchors`), so nothing hardcodes world coordinates.
  1. Outside, beyond the office window.
  2. The far end of the LivingQuarters corridor.
  3. The office's left doorway.
  4. The office corner behind the desk.
  5. "Behind you": about 1.5 m behind the player, computed live.
- **Target stage** = `floor((1 − stamina) × 5)`, with hysteresis so it doesn't jitter at a boundary.
- **Movement:** it moves one stage at a time, at most once every 8 s, and **only when neither its current spot nor the next one is in view**. In view = inside the camera's frustum plus a margin, within range. That's the FNAF "it moves when you're not looking" rule, and it hides the teleport.
- **Retreat:** eating steps it back the same way.
- **Kill:** it stays at stage 5 for 6 s, or stamina hits 0 → `fail('You fell asleep. It was waiting.')`.
- **Visibility:** hidden at stage 0. An occasional flicker of lights near it is a nice touch if F has landed.
- **Tuning:** a player who eats 2–3 rations a night survives. Put every number in one exported `SLEEP_DEMON` constant.

**Tests first.**
- `Stamina.test.js`: drain, clamping, restore, levels, reset.
- A pure `SleepDemonLogic` with an injected `canSee(point)`:
  - the stage from stamina;
  - one step per 8 s at most;
  - no move while either point is visible;
  - retreat on restore;
  - the kill after the grace period at stage 5, and at 0 stamina;
  - a reset on `start()`.
- The dispenser: its cooldown and label.

**Done when.**
- On night 1, if you ignore the dispenser, the demon creeps closer and ends the night around 4–5 AM.
- Eating keeps it back.
- At 6 AM it's gone.

---

### E. Sound

**Why.**
- There is **no audio in the repo at all**.
- Sound is named under Gameplay & Experience (25%) and Innovation (10%).
- It's what makes the horror land in the trailer.

**Build.**

1. **Loading:**
   - Add `type: 'audio'` to the manifest and teach `AssetManager` to load it with `THREE.AudioLoader`, caching the decoded `AudioBuffer`. Test-first with a mocked loader, like the existing `AssetManager` tests.
   - Preload audio in `PLACED`. Keep total audio under about 10 MB.
   - Use `.ogg` or `.mp3`, mono for anything positional.
2. **`src/audio/AudioSystem.js`**, owned by the scene:
   - one `THREE.AudioListener` on `engine.camera`;
   - master volume;
   - `play(key)` for one-shots, `positional(key, object3d)` for looping emitters, `setAmbience(key)` with a 1 s crossfade.
3. **Browser rules:**
   - Chrome only starts audio after a user gesture. Resume the context on the first click that locks the pointer, and play nothing before it.
   - Suspend it on pause and resume it after. The menus branch exposes pause and resume through `App` / `Engine.paused`; if it hasn't merged, leave a clearly marked hook.
4. **Volume:**
   - If `SettingsStore` exists in your base, add `volume` (0–1, default 0.8) to its schema; the menus spec leaves room for it.
   - Otherwise, expose `audio.setVolume()` and note it for Sibonelo.
5. **Minimum content set:**
   - **Ambience:** room tone per room, switched on `RoomTransitionSystem.onRoomChange` (chained after `_applyRoomFog`; see package C's hooks); server-rack hum (positional); outside wind.
   - **Machines:**
     - the dish motor while it slews (gain follows `Satellite.velYaw` / `velPitch`);
     - the scan tick and lock;
     - save and delete blips;
     - the airlock hiss and cycle;
     - the door;
     - the generator hum and power cut;
     - the 6 AM chime.
   - **Threats:**
     - Sleep Demon breathing (positional, louder by stage);
     - a tap on the glass when a Window Watcher arrives (this is its warning, so it matters for fairness);
     - the camera's servo whir and a rising tone with exposure;
     - one death sting.
6. **Sources:**
   - Prefer CC0 (freesound.org with the CC0 filter, Kenney audio packs, Sonniss GDC bundles).
   - **Every file gets an `ATTRIBUTIONS.md` entry**, and the credits screen picks it up automatically.
   - Nothing ripped from other games, Voices of the Void included.

**Tests first.** `AudioSystem` with a fake listener and context:
- volume clamps;
- suspend and resume on pause;
- the ambience switches on a room change;
- the dish-motor gain follows the fake satellite's velocity;
- `dispose()` stops and disconnects everything.

**Done when.**
- Every room sounds different.
- Every threat has an audible warning before it can kill.
- Pausing silences everything.
- Restarting five times doesn't stack sounds.

---

### F. Power: generator cut and base lights

**Hooks.**
- `BaseScene` builds a generator **stand-in** (~L520–530). Its `[E] Cut power` toggles `generator.powerOn` and carries `// TODO: cut every room's lights when powerOn is false (breaker panel).`
- `model:generator` exists but sits in `LIBRARY` (manifest ~L345), so it isn't preloaded.

**Build.**

1. **Swap the stand-in for the real model.**
   - Move `model:generator` into `PLACED`.
   - Measure its native size, then set `scale` / `origin: 'floor'` in the manifest (AGENTS.md, "Fixing a download in the manifest").
   - Keep the GameObject named `Generator` and keep its Interactable.
2. **`src/gameplay/BaseLights.js`:** one registry for **interior** lights.
   - Each room registers its lights and emissive fixtures. It captures their base intensities once, the same way `Daylight` captures night values.
   - `setFactor(key, value)`; the final intensity = base × the product of all factors.
   - Keys:
     - `power` (0 or 1, with a short flicker ramp);
     - `fatigue` (package B);
     - `threat` (optional flicker near a monster).
   - `Daylight` owns only the ambient light, the moon light and the fog. Keep it that way so the two never fight.
3. **What power-off means (default, decision D4):**
   - Interior lights drop to about 8% (an emergency glow).
   - The terminal refuses to open ("No power") and the dish stops.
   - **The airlock keeps working** (on battery), so the player can never trap themselves outside.
   - The generator's label flips between `Cut power` and `Restore power`.
4. **Optional link to night 2:** a Watcher can't see into a dark office unless the player is within 2 m of the glass. Cutting power becomes a second way to hide, at the cost of a suit-up trip and lost terminal time.

**Tests first.**
- `BaseLights`: factors multiply, and base values are restored exactly.
- The generator toggles the power factor.
- The terminal refuses while power is off.
- The airlock still cycles with power off.

---

### G. CRT/signal shader on the terminal monitor

**Why.** Shaders are 10%, and the checklist wants "at least one custom shader the whole team can explain". `MarsSky` already counts. A second shader, small and clearly driven by gameplay state, is the easiest one to explain in the demo and the trailer.

**Build.**
- **Where it goes:**
  - Find the screen in `model:retro-computer`: list its mesh and material names in the editor or with a one-off script.
  - If the screen is its own mesh, give it the new material.
  - If it isn't, add a thin plane just in front of the glass, in desk-local coordinates. Remember the desk spawns at `scale: 0.016`.
- **`src/shaders/CrtScreen.js`:** `createCrtMaterial()` returns a `THREE.ShaderMaterial`.
  - **Vertex shader:** passes UVs through, with a slight bulge.
  - **Fragment shader:** scanlines, barrel distortion, vignette, animated static, and a radar sweep or waveform that tightens as the scan progresses.
  - **Uniforms:**
    - `uTime`;
    - `uSignal`: scan progress, 0–1;
    - `uNoise`: static amount; high when idle, during a power cut, or while a Watcher peers in;
    - `uPower`.
- **Driver:** a small `CrtScreen` Component on the desk sets the uniforms from `satellite.scanProgress / scanTarget.scanTime`, from the power state (F) and from threats (C).
- **Explainability:** comment the GLSL line by line, in plain words.
- **Rendering details:**
  - Set `fog: false`, or include three's fog chunks.
  - Fullbright leaves `ShaderMaterial`s alone, which is fine.
  - The material is owned by the scene and disposed with it.

**Tests first.**
- The material has the four uniforms.
- The component maps a fake satellite's progress to `uSignal`, and power off to `uPower = 0`.
- `update` creates no new objects: assert the uniform objects are the same references across calls.

---

### H. Oxygen outside

**Why.** It gives the EVA trip a cost (plan item 5). It's only worth doing once there's a reason to go outside (F, or D4's hiding option).

**Build.**
- **`src/gameplay/Oxygen.js`**, pure: a 90 s tank.
  - It drains only while the suit is worn **and** the player is outside.
  - It refills in the airlock once it's pressurised.
  - At 0 → `fail('You ran out of air.')`.
- **Detecting "outside":** `RoomTransitionSystem.currentRoom` is `null` both in corridors and outside, so it can't tell them apart. Add an explicit test instead, for example a volume over the base's footprint (outside = not in it).
- **HUD:** `HUD.setOxygen(value)`, shown only while the suit is worn. Warning beeps (E) at 25%.

**Tests first.**
- Drain only when worn and outside.
- A refill in a pressurised airlock.
- The fail at 0.
- A reset on night start.

---

### I. Performance pass

**Measure first.** Press `I` in each room, in a corridor, and outside. Compare against the budgets in `docs/PERFORMANCE-PLAN.md` §4: ≥ 30 FPS on lab hardware, < 200 draw calls, < 500k triangles, < 100 bodies, < 2 s build. Record the readings in that file.

**`PERFORMANCE-PLAN.md` §3 is stale; don't apply it as written.**
- It sets `renderer.shadowMap.autoUpdate = false` globally, on the grounds that "neither the lights nor the base ever move". Since the sky fix, the moon light's direction changes every frame of the night (`Daylight._aimSun`, ~L146), so a global freeze would pin its shadow at the wrong angle.
- Doors no longer change on a night change either; the airlock doors are what move now.

**Do this instead, per light,** with three r0.185's `light.shadow.autoUpdate` / `needsUpdate`:

- **The office ceiling light** (`MainOffice.buildLighting`, ~L60–63) is a **PointLight**, so its shadow is a cube map: six extra geometry passes every frame.
  - Set `shadow.autoUpdate = false` with one `needsUpdate = true` after the build.
  - Flag it again whenever a shadow caster within its range moves: the office front door (the airlock's inner door, while it animates; give `Door` an "is moving" check or a callback) and any threat inside the office.
- **The moon:** only request a shadow render when `_aimSun` has turned the light more than about 0.25° since the last one. The sky turns roughly 0.3°/s in real time, so that's about one shadow render a second instead of sixty.
  - Test the pure helper `shouldRefreshShadow(prevDir, dir, thresholdRad)`.
  - Morning holds still, so the shadow freezes naturally.
- **The menus shadow setting** disposes the moon's shadow map when its size changes. Set `needsUpdate = true` after that, or the map stays empty.

**Then, only if the numbers say so:**
- **BUG-007:** lazy-load `LevelEditor` with `import()` on the first F2 press. The bundle is about 913 kB.
- **Shared geometries:** give `Room._addStaticBox` geometries shared by size; it allocates a `BoxGeometry` per wall piece.
- **Rack glows:** cut the four ServerRoom rack glows (`PointLight`s) to two.

**Lab hardware.** Test the production build (`npm run build && npx serve dist`) on the weakest machine the team has, at the menus render scale of 1 and of 0.75.

---

### J. Asset hygiene and attributions

**Everything under `public/` ships in the Moodle zip.**
- `public/assets/models` is **113 MB**.
- **Not in the manifest at all** (dead weight):

  | File | Size |
  |---|---|
  | `retro_command_console_aged.glb` | 6.4 MB |
  | `office-scene.glb` | 5.4 MB |
  | `ragno_monster.glb` | 4.0 MB |
  | `the_boiled_one_horror_game_-_boiled_one.glb` | 1.9 MB |
  | `server_v2_console.glb` | 1.3 MB |

- **Duplicates:** `break-panel.glb` and `switchboard.glb` are byte-identical, 11 MB each.

**Build.**
- **Unused files (D5):** move them to a `source-assets/` folder at the repo root. They stay in git but are no longer shipped. Don't delete them: the monster models may become enemies.
- **The duplicates:** keep one file and point both manifest keys at it, or drop the unused key. Grep for spawns first.
- **Oversized textures:** list each `.glb`'s embedded texture sizes. If props carry 4K textures, downscale them with `npx @gltf-transform/cli resize` while keeping plain `.glb`.
  - The loader has **no** Draco/Meshopt decoders; see AGENTS.md, "Compression".
  - Ask before adding anything to `package.json`.
- **`ATTRIBUTIONS.md` TODOs:**
  - Radar terminal, desk with computer and security camera have candidate links; fill in title, author and licence. If you can't browse the web, leave them for a human.
  - Switchboard, bush and break-panel have no source on record; ask Bruno (thotslayer666).
  - The floor textures and the eight `signal-*.png` images have no attribution either.
  - The two NonCommercial licences (soap dispenser, poster) are already resolved in the file: keep them, and never modify the poster.

**Done when.**
- The zip is as small as it can reasonably be.
- Every shipped non-original file has a complete entry.
- `validateManifest()` reports no warnings.

---

### K. Bug sweep

Details are in `docs/BUG-TRACKER.md`.

- **BUG-001, BUG-002, BUG-005** only affect the old `OfficeScene` and `TestScene`. Fix them only if those scenes stay reachable in the shipped game (the editor's scene switcher, F4). Otherwise raise with Adrian whether to drop them from the production build.
- **BUG-003:** Rapier under vitest. The idea is `@dimforge/rapier3d-compat`, but that changes a **production** dependency. Ask first.
- **Unverified, needs a browser:**
  - **R1:** server-rack flicker. It's more visible now, with four racks.
  - **R3:** the free camera after a scene switch. This matters more now that the menus rebuild the scene on every restart.
  - **R4:** cone colliders.

  Reproduce each, then fix it or close it.
- Write a failing test for each bug before fixing it, and move it to "Fixed" in the tracker.

---

### L. Submission support

- **The mandatory checklist** is in AGENTS.md; every item is still unticked. Tick an item only when it's verifiably true, and say how you verified it.
- **The production build:**
  1. `npm run build`.
  2. `grep -rn 'src="/\|href="/' dist/index.html` must print nothing.
  3. `npx serve dist` and play a full night.
  4. Zip the **contents** of `dist/`.
- **The trailer** (≤ 2 min, YouTube) is human work. Help by writing a shot list in `docs/TRAILER-SHOTS.md` that maps each shot to a grading area:
  - the dawn over the dish (shaders, sky);
  - the camera cone sweeping the aisle (3D effects);
  - the Watcher at the glass while the player hides (gameplay);
  - the sleep demon creeping closer (tension);
  - the airlock cycle (mechanics).

  The fly camera (`V`) is the trailer camera.

---

## 6. Decisions for the team (defaults until someone answers)

| # | Question | Default |
|---|---|---|
| D1 | One threat per night, or cumulative (night 3 also runs nights 1–2's threats)? | One per night. The table in `ThreatDirector` makes cumulative a one-line change. |
| D2 | Night 3's reason to enter the server room: storing signals, or AGENTS.md's "evil signal" that must be deleted there? | Storing signals (the smaller change). |
| D3 | Monster models: the unattributed `ragno_monster` / `the_boiled_one`, the Sketchfab candidates in ATTRIBUTIONS.md, or procedural placeholders? | Procedural placeholders, so mechanics don't wait on art. Swap in later by manifest. |
| D4 | What cutting power is for | Emergency lights, terminal and dish off, airlock on battery. Optional: a dark office hides you from Watchers. |
| D5 | Unused models in `public/` | Move them to `source-assets/`, don't delete. |
| D6 | More than 3 nights (AGENTS.md also lists "evil signal" and "UFO")? | No. `maxNight` stays 3; those two are out of scope unless the team asks. |
| D7 | Stamina: Hayden's or ours? | Hayden's. Build only the minimal seed in B, and only if he hasn't started. |

---

## 7. Don't

- Don't build menus, pause, settings or credits; they're Sibonelo's.
- Don't reorder the Engine loop, and don't add a second loop.
- Don't make monsters physics bodies.
- Don't put a timer outside the Component hooks (§1).
- Don't hardcode asset paths or world coordinates for room features; rooms expose them.
- Don't write light intensities from more than one system (`BaseLights` for interiors, `Daylight` for the sky, moon and ambient light).
- Don't add dependencies, change git config, force-push or push to `main` / `integration/*`.
- Don't tick checklist items that aren't verified.

---

## 8. Reporting back

For each package, open a PR against the base from §2. If `gh` is available, use:

```
gh pr create --base <base> --head <branch> --title "<conventional title>" --body-file <tmp>
```

Otherwise, print the compare link: `https://github.com/BRAH-CGV/dead-air/compare/<base>...<branch>?expand=1`.

The PR description has these sections:

- **What changed.**
- **How to test in the browser:** keys, which night (`N` to skip), and what to look for.
- **Tests:** the files added, and the per-file vitest result.
- **Decisions:** which §6 defaults you used, and any code-vs-doc mismatch you found.
- **Needs a human:** anything you couldn't verify, such as a browser-only check, a lab-hardware FPS reading, or a missing attribution.

End the session with a short message to Adrian: the PR link, which package is done, and what's next in §4.
