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

- **Renderer config:** Antialiasing on, PCF shadow maps (not PCFSoft — three r185 deprecates it and swapping recompiles every lit shader), ACES Filmic tone mapping, exponential fog.
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
│   ├── ModelUtils.js    # Per-mesh normalisation, measurement, collision, disposal
│   ├── ColliderSpec.js  # Manifest physics block → shape parts (pure, tested)
│   ├── Colliders.js     # Shape parts → Rapier bodies and colliders
│   ├── PhysicsDebug.js  # Collider wireframe overlay (` to toggle)
│   ├── DebugCamera.js   # Free-fly noclip camera (V to toggle)
│   ├── Fullbright.js    # Unlit debug lighting (B to toggle)
│   ├── ShadowScheduler.js # Shadow maps redrawn only when a light/caster moves, or on invalidate()
│   ├── WarmUp.js        # Boot: compile, upload, draw everything once behind the loading screen
│   ├── ShadowSides.js   # sealAgainst: make a building solid to one light's shadow map
│   └── FrameSettle.js   # Holds the loading screen until the first frames run smooth
├── components/
│   ├── FirstPersonController.js  # WASD + mouse look, Rapier character controller
│   ├── Flashlight.js    # F: weak, short-range spotlight on the camera
│   ├── SuitVisor.js     # EVA helmet glass shader overlay + mask breathing loop
│   ├── PlayerBody.js             # Player heights + eye heights, from the feet (pure, tested)
│   ├── GeneratorSound.js # Generator start-up / hum / wind-down; faint from indoors
│   ├── EVASuit.js       # On the player: worn or not, with change listeners
│   ├── Daylight.js      # dawnFactor(hour, state) → sky uDawn, lights, fog; turns the sky, aims the moonlight
│   ├── Bed.js           # Interactable: sleep in the morning → next night
│   └── AirlockPortal.js # Airlock state → which occlusion zone is drawn; holds the doors until ready
├── gameobjects/
│   ├── MarsSky.js       # Night/day sky dome shader, stars, moons; setHour turns it
│   ├── WallClock.js     # Analogue clock driven by the NightClock
│   └── Ufo.js           # Saucer model, beacon, shadow-casting searchlight, beam cone shader, teleport flash
├── gameplay/
│   ├── NightClock.js    # 12:00 → 6:00 AM over one shift
│   ├── GameController.js # playing → morning → sleep → next night; fail() for threats
│   ├── UfoThreat.js     # Once a night: radar blob → surge → arrival → judgement → teleport
│   └── BreakerPuzzle.js # Breakers to throw back + colour-coded leads to reconnect (pure)
├── scenes/
│   ├── BaseScene.js     # The whole base: rooms, corridors, airlock, outside
│   └── rooms/           # Room, Corridor, MainOffice, ServerRoom, LivingQuarters, Airlock
├── systems/
│   ├── NightManager.js  # Counts nights (1 … maxNight) and notifies on change
│   ├── OcclusionZones.js # Named object sets drawn/skipped together, with a readiness gate
│   ├── Sightlines.js    # Window half-spaces, instance splitting, hideable-part collection
│   └── PowerGrid.js     # Every lamp on the generator's switch; surge flicker; blown bulbs
├── assets/
│   └── manifest.js      # Every asset path, by key. Single source of truth.
├── ui/
│   ├── LoadingScreen.js # Preload progress overlay (markup lives in index.html)
│   ├── ScreenFade.js    # Fade to black and back (#fade in index.html)
│   ├── WhiteOut.js      # Fade to white and hold, for the UFO's catch (#whiteout)
│   └── BreakerPanel.js  # The generator's repair minigame (#breaker-panel)
└── main.js              # Entry point: creates Engine, awaits init()
```

### Key classes

**Engine** — Initializes Three.js scene, Rapier world, pointer-lock input, keyboard, resize. `init()` is **async**: it preloads the manifest before building the scene, so nothing pops in mid-render. Runs a fixed-timestep loop: `fixedUpdate → world.step → syncPhysicsToScene → update → lateUpdate → render`. Access via `scene.userData.engine`.

**AssetManager** — On the Engine as `engine.assets`. `load`/`loadAll` fetch and cache; `get(key)` reads the cache synchronously; `instantiate(key)` returns a clone. See the Assets section below.

**GameObject** — Wraps `THREE.Object3D` with optional `RAPIER.RigidBody` / `Collider`. Parent-child hierarchy (`addChild`/`removeChild`), component attachment (`addComponent`/`getComponent`), depth-first `find(name)`. Lifecycle propagates to children.

**Component** — Base class. Hooks: `onAwake` → `onStart` → `onUpdate(dt)` | `onFixedUpdate(dt)` | `onLateUpdate(dt)` → `onDestroy`. Getters: `transform`, `scene`, `world`. A component with `enabled = false` skips its per-frame hooks (but still gets its one-shot lifecycle) — the debug fly camera uses this to freeze the player in place.

**FirstPersonController** — Component on Player. Reads `Engine.input` for WASD + mouse. YXZ Euler camera rotation. Drives `KinematicCharacterController` with capsule collider. Handles gravity, jump (crouching included), ground detection, and Source-style movement — horizontal velocity integrates on the fixed step (`accel`/`airAccel`/`friction`/`stopSpeed` tunables) instead of snapping to wish speed. Crouch (`C` — toggle by default; `crouchMode: 'hold'` switches to hold-to-crouch): the player body carries two swapped capsules — standing 1.35 m (under the 2.2 m doorways) and crouch 0.65 m, the tallest that clears the desk's 0.72 m under-top gap. Both sizes live in `PlayerBody.js`, measured from the feet. The camera sits at eye height (1.24 m standing, 0.55 m crouched), not at the capsule centre. Each capsule carries an eye offset above its centre (`standEyeOffset` / `crouchEyeOffset`, which default to 0 = centre), and a swap compensates for both the centre shift and the change of offset so the view never pops. Grounded swaps anchor the feet (stand-up gated by a headroom check); mid-air swaps anchor the capsule's centre — crouching tucks the legs up (crouch-jump), standing sweeps them back down and pops the body up onto whatever is below, so only the ceiling can refuse a stand-up.

### Scene hierarchy

```
Player (kinematic rigidBody, capsule collider)
  └─ CameraPivot
      └─ PerspectiveCamera (YXZ Euler)
Ground (visual PlaneGeometry + static cuboid collider, textured)
Crates (dynamic rigidBodies, box colliders)
Desk (imported .glb, static auto-fitted box collider)
```

### Base layout and doors

`BaseScene` builds the whole base as one scene — nothing loads per night:

```
LivingQuarters ── corridor ── MainOffice ── corridor ── ServerRoom
                                  │ front door
                               Airlock (suit locker)
                                  │ hatch — EVA suit on
                               Outside (generator, dish)
```

Every interior door is open from night 1; nights bring threats, not keys, and `NightManager` only counts them. The one door that stays shut is the airlock hatch (`rooms.Airlock.hatch`). It opens for the `EVASuit` on the player: `Airlock.bindSuit(suit)` keeps the hatch lock, the suit locker's prompt and the hatch beacon in step with `suit.worn`, and `HUD.setSuit` shows it.

The airlock is an interlock — its two doors are never open together. `BaseScene` hands it the office's front door with `Airlock.bindInnerDoor(door)`, and `Airlock.state` runs `pressurised` (inner door open, hatch shut, red beacon) → `depressurising` (both shut, amber) → `depressurised` (hatch open, inner door shut, green) → `pressurising` → back. The door you are leaving shuts the moment the suit changes; the one ahead opens after `cycleTime` (2.5 s). Changing your mind mid-cycle runs back only the time already run. The cycle is ticked by a component on the airlock's own root, so nothing else has to call `Airlock.update`. The suit locker only works from inside the chamber, clear of both doorways by the player's radius — never from the office through the open inner door, and never where a door would shut on the player; elsewhere its label reads "Step into the airlock…".

An Interactable whose `promptLabel` changes while you look at it (the locker's Put on / Take off) is re-shown by `InteractionSystem` — update the label as a data field, since the base class field shadows a getter. `RoomTransitionSystem` does the same for a locked door whose `lockedPrompt` changes while you stand at it ("Sealed" → "Airlock cycling…").

`InteractionSystem`'s ray stops at the first solid collider it meets, so nothing can be used through a wall, a locked door or another prop. Sensors (open doorways) don't stop it. An Interactable is reached only through a collider on its own GameObject's body, so give it one that isn't buried inside another prop's.

Every prop has a job:

- **MainOffice** — the work. The computer desk faces the window, with its chair pulled out clear of the kneehole. A food-ration dispenser on the left wall (`VendingMachine`, procedural) has an `Interactable` stub waiting on the stamina system. There is also a bin, a shelf, an extinguisher by the airlock door and a poster.
- **LivingQuarters** — the bedroom. The bunk you sleep through the day in, with lockers, a desk and a chair. The furniture keeps to the left half so the metre inside the right wall stays clear, wherever `doorOffset` slides the doorway.

The airlock is a `Corridor` with `static kind = 'Room'`, so `RoomTransitionSystem` tracks it as a room. Corridor `ends` take one mode for both ends or a `[first, second]` pair along the axis (`[back, front]` on z); the airlock is `['open', 'doorway']` — open where it sits flush on the office's front wall face, a doorway for the hatch at the far end.

### Shift and day

A night is a shift: `NightClock` runs 12:00 → 6:00 AM, shown on the HUD and on the office's `WallClock`. `GameController` owns the state:

```
playing ──6 AM, quota met──▶ morning ──sleep()──▶ playing (next night)
   │                            └──sleep() on the last night──▶ finished
   └──6 AM, quota missed──▶ gameOver ──[E]──▶ playing (same night, reset)
```

Meeting the quota early does **not** end the shift — the core loop is "meet the quota, then survive until morning". The story reason there is no day shift: the Sun drowns the faint signals and heats up the dust storms.

- **One night number.** `gameController.bindNights(nights)` makes the controller follow the `NightManager`; sleeping calls `nights.advance()` and the listener starts the next night. Never call `startNight` beside it, or the HUD and the quota drift apart.
- **Sleep.** The `Bed` interactable sits on the LivingQuarters bunk (`rooms.LivingQuarters.bed`). It is live only in the morning, and it runs `controller.sleep()` behind a `ScreenFade`. Rooms build the bed and the clock; `BaseScene` hands them the controller, fade and clock, because rooms don't know about gameplay.
- **Dawn.** `dawnFactor(hour, state)` is 0 all night, smoothsteps to 1 over the last hour and holds at 1 all morning. `Daylight` (after the controller on `GameplaySystems`) applies it to:
  - `MarsSky`'s `uDawn` uniform, which is shared by the dome and the stars. This is the state-driven shader uniform: night gradient + Milky Way → butterscotch day, blue glow round the Sun, stars fading out.
  - the ambient and moon lights (the moon light is the morning sun).
  - the fog colour.

  Night values are captured when `Daylight` is built, so the scene's lighting code stays the one place that defines the night.
- **The sky turns.** `Daylight` also calls `sky.setHour(clock.currentTime)`.
  - **What turns.** The stars, Milky Way, both moons and the Sun turn together, 15° an hour, westward about a pole due north and 35° up (`latitude`, `hourRate`). Midnight is the sky as authored, so the moon angles in `DEFAULT_MOONS` are their midnight positions.
  - **The Sun.** The turn is what places it: it reaches the horizon at `sunAzimuth`, in the window, at 6 AM (`sunriseHour`). The moons ride ~125° away from it, across the sky, and stay up all night.
  - **How each part turns.**
    - The stars and moons get the turn as a quaternion.
    - The dome can't rotate, since its horizon haze belongs to the ground. It gets the same turn as the `uSkyRotation` mat3 uniform, and looks the Milky Way up at `dir * uSkyRotation`.
    - `sky.directions` holds the live world directions of `sun`, `phobos` and `deimos`.
  - **The moonlight.** It shines from wherever Phobos is. Through the dawn it swings to the Sun's bearing at `sunElevation` (30°), keeping the distance the scene set, so the shadow camera still fits.
  - **Cost.** Nothing is allocated. The sky and the light are rewritten each frame of the night, and not at all while the morning clock is stopped.

### Power and the UFO

The generator outside is the base's one power switch. `BaseScene._addPower` puts every light and glowing fitting in the rooms, the corridors and on the dish pad on a `PowerGrid`, which remembers what each was built at and rewrites it every frame from one level.

- **Three faults.**
  - `grid.on` is the generator's switch. Off kills every lamp *and* the vital functions; the computer terminal (`terminal.setPowered`) reads it.
  - `grid.broken` is blown bulbs: they stay dark with the power back on. `grid.lit` is the ordinary bulbs actually shining.
  - `grid.tripped` is breakers thrown by the UFO's surge. While tripped, `setOn(true)` is refused until `resetBreakers()`. Cutting the power by hand never trips them, and a new night's `repair()` resets them along with the bulbs.
- **The breaker panel.** With the breakers tripped, the generator's Interactable opens `BreakerPanel`, a DOM minigame over a `BreakerPuzzle`:
  - **Top:** a row of breaker switches, most of them thrown; click them all back on.
  - **Bottom:** colour-coded leads to drag (or click, then click) onto shuffled terminals of their own colour. Anywhere within `SNAP` of a lead or a terminal counts, not just its ring. A wrong colour sparks and won't go on.
  - **Each flick** plays `sfx:light-switch` (the panel's `onFlick`).
  - **Solving it** resets the breakers and starts the generator.
  - **Q or Esc** steps away and keeps the progress: there is one puzzle per blow-out.
  - **The cost:** the player stands outside, in the yard, while doing it. That is the punishment for not cutting the power in advance.
  - **The mouse:** `BaseScene._usePanel` releases the pointer lock while the panel is open and freezes the player.
- **Unbreakable lamps.** These follow the switch but survive a blow-out: the dish pad's floods (`collect(pad, { breakable: false })`) and the terminal screen's faint green `ScreenGlow` in the office (`userData.unbreakable`), which shows that the computer still works in a dark office.
- **Off the grid.** `collect()` skips any subtree whose object3d has `userData.offGrid`. The airlock beacon is on its own battery, so the interlock always works. `LEDStrip` and `SignalAlertLight` animate their own glow, so they mark their meshes `offGrid` and are added as consumers instead; the grid hands them `powerLevel` to scale by. A new self-animating light should do the same, or the grid and the component fight over one material.
- **Never hidden.** Lights are zeroed, never hidden (see Performance). The UFO's lights follow the same rule.
- **The generator's sound** (`GeneratorSound`, on the generator):
  - **Switching on** plays the start-up clip, which crossfades into a looping hum.
  - **Switching off** plays only the wind-down.
  - **The hum** follows the grid by itself. It is already running when a night starts, and it cuts dead when the UFO trips the generator.
  - **Volume.** Outdoors it falls off with distance from the generator; inside any room or corridor it is a whisper (`insideLevel`).
  - **The clips** are cut at MPEG frame boundaries from one 3-minute recording, so only about 22 s of audio is decoded.

`UfoThreat` (on `GameplaySystems`) brings the UFO on its nights only (`UFO.nights`: night 3, the last), once, at a random time (`scheduleApproach`). For testing, `summon()` (the **U** key, to go before release) brings it at once, on any night:

```
waiting ─▶ approaching ─▶ expanding ─▶ lethal ─▶ gone
                                          └──▶ caught ──▶ gameOver (controller.fail) ──[E]──▶ retry
```

- **Approach.**
  - For `radarLead` (20 s) it is only on the radar: a wobbling, glitching blob (`RadarOverlay.threat`, on the shared `_skyToCanvas` mapping) crawling toward the centre, which is overhead. The signal lamp goes `frantic`.
  - Parking the radar cursor on the blob (`RadarOverlay.threatAt`) flashes the red `ANOMALY_WARNING` line ("extreme electrical anomaly detected — turn off power…") above the radar's info line.
  - When the flight sound starts, the UFO bursts into the sky (`Ufo.appear`: its beacon flares to several times its size, plus a flash). It's ~700 m out along its path, with its searchlight already on as a thin shaft, and a beacon glow that holds its size on screen through the haze. It slows all the way in.
  - **Where it appears** is `spawnBearing`.
    - `inViewChance` (40 %) of the time it's in the open sky either side of the dish tower, which fills the window's view straight out (`inViewFrom`–`inViewTo` off the window's bearing), so you can watch it spawn.
    - Otherwise it appears somewhere round the valley the window can't see.
  - The path is a straight line from 800 m up down to the hover point. It never drops below the hover height, so it clears the dish, and from any bearing it stays ~45 m over the valley ridge and its masts (both pinned by tests).
  - It arrives on the flight clip's loudest moment: `loudestTime` measures it from the decoded buffer, about 22 s in. The threat's clock is pulled toward the audio clock (at most ±50 % speed), so the picture stays on the sound.
  - Over the last `surgeSeconds` the grid's `surge` drives every lamp far past normal, flickering.
- **Expanding.** It stops directly over the office (`UFO_HOVER_HEIGHT`, 35 m). Over `expandSeconds` its beam widens to cover the facility (`coverRadius`). Inside, the `UfoWindowFlood` spotlight comes up: it's in the office, under the window header, aimed steeply down so its cone never rises to the tops of the walls. It stands in for the beam spilling through the glass; its static shadow is only for looks.
  - The searchlight **casts shadows**: from overhead its cone covers every roof, and only a shadow map keeps that light out of the rooms. The ShadowScheduler redraws it as it flies; `Ufo.setBeam` redraws it when the cone changes. Only the body bobs and spins, so a hovering UFO costs no redraws.
  - **The building is sealed against it** (`sealAgainst`, `src/core/ShadowSides.js`). Every room and corridor mesh receives shadows: three defaults `receiveShadow` to off, and the server LEDs and light fittings were lit through the roof. For this one light those meshes also draw both faces into the shadow map, via `onBeforeShadow`. three's back-face default records a wall where light *leaves* it, and floors along the walls and the tops of walls under the ceiling came out lit. Anything new built into a room inherits both through the room's root, as long as it is built before `_addUfo` runs.
  - **The visible beam is cut out of the building** (`Ufo.setCutouts`, the rooms' and corridors' bounds): the shader discards fragments inside those boxes, so the beam ends on the roofs and never shows indoors.
  - **Mind its bias.** A shadow's depth bias is in non-linear depth, so in metres it grows with distance² / near. The shadow camera's near plane is 10 m and its bias −0.0001 (~1 cm at the roofs' 31 m). With near = 1 and bias −0.0005 it was ~0.5 m, more than the ceiling slab, and the tops of the walls lit up as if the light came through the roof. A test pins it.
- **Lethal.** Once the beam covers the base, exposure is judged first, then the bulbs:
  - It takes the player if they are outside, or if the grid is lit and they are exposed:
    - **Outside** (`_isOutside`) means not within any room's or corridor's whole shell (`bounds()`: outer wall faces, floor to roof). Neighbouring shells touch, so a doorway is indoors. `Room.containsPoint` stops at the walls' centre lines, which left every doorway a lethal sliver of "outside".
    - **Exposed** (`exposedToBeam`) means anywhere in the main office (the room the window looks into) or the airlock (only a hatch from the yard), again by whole shell. Furniture doesn't count, so there is no hiding under the desk: the rule can't drift when the props are replaced. Corridors and the other rooms are safe.
  - If the grid is lit, the bulbs blow and the generator trips.
  - So: cut the power in advance and the office and airlock are safe. Leave it on and get out of them (a corridor, another room), and you survive but lose the lights for the night. If the base was lit when the beam went lethal, the office and airlock stay deadly for the whole visit, blown bulbs or not: walking in from a corridor while it holds kills you. Cut the power in advance and they stay safe. The generator brings back the terminal, the dish floods and the screen glow — not the bulbs.
  - It holds for `hoverSeconds` (5 s); stepping outside now is fatal. Then it teleports away with a flash and a whoosh.
- **Caught.** `WhiteOut` burns the screen white (the beam still blazing), the ear ringing plays and the player is frozen. `controller.fail()` makes it a game over, and `[E]` retries.
  - **Back to the spawn.** A retry starts the night over from the beginning: the controller tells its night-start listeners `{ retry: true }`, and `BaseScene._respawn` takes the suit off and `FirstPersonController.teleport`s the player to the spawn, facing the window. A new night after sleeping doesn't move you.
  - **The E is used up.** The retry calls `engine.consumeAction('interact')`, so that press can't also reach whatever the player died looking at. Before this, dying at the generator meant the retry's E switched the freshly restored power straight back off.
- **Every night start** (`controller.onNightStart`) repairs the bulbs and breakers, switches the generator on, closes a breaker panel left open, clears the white-out and schedules the next visit.

### Input system

Centralized on `Engine.input`:
- `keys` — object keyed by `KeyboardEvent.code` (e.g. `KeyW`, `Space`)
- `mouse` — `{ dx, dy }` accumulated deltas, consumed each frame
- `locked` — boolean, pointer-lock active

`Engine.keyBinds` maps action names to codes (`flashlight` is `F`), including the debug keys (`debugFly`, `fullbright`). `engine.consumeAction(action)` uses up the current press: `isAction` reads it as up until the key is released. Toggle-style debug actions get their own edge-triggered `keydown` listener — `input.keys` is level-triggered and can't express "on the press".

## Debug tooling

Three toggles, all edge-triggered and free while off:

| Key | Tool | What it does |
|---|---|---|
| `` ` `` | `PhysicsDebug` | Rapier collider wireframes over the scene |
| `V` | `DebugCamera` | Free-fly noclip camera |
| `B` | `Fullbright` | Unlit lighting — everything at albedo brightness |
| `N` | `NightManager` (BaseScene) | Advance to the next night; wraps back to night 1 after the last. Interior doors are open every night — nights bring threats, not keys |
| `U` | `UfoThreat.summon` (BaseScene) | **Testing only — remove before release.** Start a UFO visit now instead of at the night's random time; ignored mid-visit or outside a shift |
| `I` | `PerfStats` | FPS (average and worst frame), draw calls and triangles (shadow passes included), loaded geometries/textures |

**DebugCamera (`engine.debugCamera`)** — detaches the camera from the player onto the scene root at its current world pose and sets `enabled = false` on every player component, so movement, look and interaction freeze mid-stride and the physics body stays put. WASD flies along the view direction (forward includes pitch — look down to descend), Space rises, C sinks, Shift boosts; the mouse steers the same YXZ rig as the player. No rigid body, collider or raycast is involved — that's what makes it noclip. Toggling back re-mounts the camera on the player with a zeroed local transform: the player never moved, so the view returns to their eyes. Two rules when extending it: never give it physics, and never write `camera.position` outside `update()`/`disable()` — the first-person controller owns that transform otherwise.

**Fullbright (`engine.fullbright`)** — three things have to die for a scene to stop being dark: every light is hidden (remembering which were already off), fog is nulled, and tone mapping is switched to `NoToneMapping`. Hiding lights alone isn't enough — a lit material with no light renders black, not bright — so every `MeshStandard/Physical/Phong/Lambert` material is swapped for a `MeshBasicMaterial` twin carrying the same map and colour. Twins are cached per original material (shared materials stay shared) and disposed the moment the mode is toggled off, so the asset-cache ownership rule holds and memory stays flat. Unlit materials (Basic, Shader) are left alone. Meshes spawned while the mode is on are picked up by `fullbright.refresh()` — `Engine.spawnModel` already calls it.

## Assets

### Adding one

1. Drop the file in `public/assets/` — lowercase, hyphen-separated, `.glb` for models.
2. Add a key to [`src/assets/manifest.js`](src/assets/manifest.js). The `url` is relative to `public/`, so `public/assets/models/desk.glb` → `'assets/models/desk.glb'`.
3. Use it: `engine.spawnModel('model:desk', { position: [0, 0, -3] })`, or `engine.assets.get('tex:foo')` for a texture.

Sounds go in `public/assets/audio/` as `type: 'audio'`, keyed `sfx:<name>`; `assets.load` decodes them to a shared `AudioBuffer`, played through a `THREE.Audio` on `engine.audioListener` (it rides on the camera, and resumes on the first click — Chrome blocks audio before a user gesture).

No path is ever hard-coded outside the manifest. `validateManifest()` runs in dev and warns about the two mistakes that only fail after upload: absolute paths and capital letters.

### How loading works

`GLTFLoader` returns a `Group` with geometry, materials and textures already wired up, including correct colour spaces. It does **not** set shadow flags, raise anisotropy, or fix bad units — `ModelUtils.prepareModel()` covers that on the way into the cache.

**Ownership rule.** The cache holds one copy of each model. `instantiate()` returns clones that *share* its geometry, materials and textures, so twenty crates cost one GPU upload. The consequence: never call `.dispose()` from an instance — drop it by removing it from the scene. `assets.release(key)` / `assets.dispose()` are the only places that free GPU memory, which is what keeps memory flat across levels.

Rigged models are cloned with `SkeletonUtils.clone()`; a plain `.clone()` leaves every copy bound to the original skeleton, so they animate in lockstep.

### Conventions for custom models

Author in **metres**, +Y up, origin on the floor at the object's centre. Export as `.glb` (single file — a `.gltf` with loose `.bin`/`.png` siblings is one more chance for a case-sensitive 404). `ModelUtils.normalize(root, targetSize)` is the escape hatch for a download authored in centimetres.

**Fixing a download in the manifest.** Two entry keys fix a model that wasn't authored this way, without editing the file. `scale` (a number) takes it to real size. `origin: 'floor'` moves its pivot to the floor under its centre, for a download modelled around its middle or placed off in space. Both are baked in at load, below the model's root, so every spawn, the measured bounds and the fitted collider see them. A spawn's own `scale` multiplies on top rather than replacing them. To pick `scale`, measure the download's native size first (in the level editor, or from the `.glb`'s accessor min/max), then divide the real-world size you want by it.

```js
'model:fire-extinguisher': { type: 'model', url: '…', scale: 0.012, origin: 'floor', physics: 'static' },
```

### Compression

The loader handles **plain `.glb` only**. Many Sketchfab / Poly Haven downloads are Draco- or Meshopt-packed and will fail with `No DRACOLoader instance provided`. Either re-export uncompressed from Blender, or wire the decoders in — see the header comment in [`src/core/AssetManager.js`](src/core/AssetManager.js).

### Placeholders

The desk and floor textures currently in `public/assets/` are stand-ins, not final art. Replacing one: drop the real file into `public/assets/` and point the manifest url at it.

## Physics & colliders

Collision comes from the asset pipeline, not from hand-written Rapier calls per object. One `physics` key in the manifest entry drives it.

**Collision is opt-in.** A model with no `physics` key is render-only, exactly as before — so skyboxes, posters and decals never quietly become solid. Adding the key is what turns it on.

### The three tiers

| | You write | You get | Use for |
|---|---|---|---|
| 1 | `physics: 'static'` | One box fitted to the model's measured bounds | Most props. Cabinets, crates, boxes on shelves |
| 2 | `UCX_*` meshes in the `.glb` | One convex hull per proxy mesh | Your own Blender models, anything with a hole or a gap |
| 3 | `shape: [ … ]` in the manifest | Hand-written compound primitives | Downloads you can't re-export |

Tiers 1 and 2 are **the same manifest line**. `shape` defaults to `'auto'`, which uses the `.glb`'s collider meshes if it shipped any and falls back to the bounding box if it didn't. So you can start every prop on tier 1 and upgrade it later by editing the model alone.

```js
'model:cabinet': { type: 'model', url: '…', physics: 'static' },
'model:crate':   { type: 'model', url: '…', physics: { body: 'dynamic', mass: 12 } },
'model:poster':  { type: 'model', url: '…' },                    // render-only
```

### Tier 2 — collider meshes in Blender

Model simplified collision next to the art, name those objects `UCX_something` or `collider_something`, export the `.glb` as normal. At load they are stripped from the render tree, their vertices baked into model space, their geometry freed, and each becomes a convex hull. Nothing in the manifest changes.

Each proxy must be **convex and have volume** — a flat or 3-point mesh can't be hulled and logs a warning. Model a concave shape as several convex pieces; that's what a compound collider is.

### Tier 3 — primitives in the manifest

```js
physics: {
  body: 'static',
  shape: [
    { type: 'box',      size: [1.6, 0.05, 0.8], position: [0, 0.72, 0] },
    { type: 'cylinder', radius: 0.15, height: 0.9, position: [0, 0.45, 0] },
  ],
},
```

**Sizes are full metres, measured the way you'd measure the real object** — a 1.6 m wide desk is `size: [1.6, …]`, not a 0.8 half-extent. `height` on a capsule/cylinder/cone is tip to tip. The halving Rapier wants happens in `ColliderSpec.js`, once.

Parts: `box` (`size`), `sphere` (`radius`), `capsule` / `cylinder` / `cone` (`radius` + `height`). All take an optional `position` and `rotation` (Euler XYZ radians) relative to the model origin.

Escape hatches: `shape: 'hull'` forces a convex hull over the render mesh, `shape: 'trimesh'` gives exact triangle-accurate collision (**static only** — a trimesh is hollow, so a dynamic body falls through it), `shape: 'none'` or `body: 'none'` opts back out.

### Seeing what you got

Press **`` ` ``** in game to overlay every collider Rapier knows about. Authoring a collider without it is guesswork — a `UCX_` mesh exported with a stray transform looks fine until you walk into thin air. The overlay is off by default and costs nothing while hidden.

### Conventions that make this work

- **Author origin on the floor**, at the object's centre. Bounds are measured, not assumed, so the fitted box is lifted to half the model's height. Get the origin wrong and the collider is wrong with it.
- Bounds and hulls are computed **once at load** and cached, so `spawnModel` stays cheap enough to call in a loop.
- Only `dynamic` and `kinematic` bodies enter `Engine.rigidBodyMap`. Static props never move, so they skip the per-step snapshot and interpolation entirely.
- `spawnModel(key, { physics })` overrides the manifest per spawn — one pushable crate among scenery.

### Worked example: the under-desk gap

`model:retro-computer` (the office's `ComputerDesk`) is a downloaded model with no `UCX_` proxies, so tier 1's auto box was a solid 1.6 × 1.1 × 0.8 m block covering its whole footprint, monitor included. That's fine for bumping into, but it meant **you could not crawl under it** — and hiding under the desk is a listed mechanic (window entities, night 2). `FirstPersonController`'s crouch height (0.65 m) was already sized to clear a 0.72 m gap in anticipation of this fix (see `PlayerBody.js`).

Fixed with tier 3, in the manifest (`src/assets/manifest.js`) — after two guesses from the raw mesh data got it wrong (first left 3 of the model's 4 sides open, since it isn't a table on legs; then a U-shaped compound with a full-footprint top slab, which still blocked *walking up to* the desk while standing, since the lid covered the opening too). Third time, measured instead of guessed: box primitives placed in the level editor (F2) against the rendered model, positions/sizes read off their transform panel. That gave three boxes — a solid back region and two solid side walls, all about 0.73 m tall, **no separate top lid** — with the front (the kneehole) having no ceiling at all, so a standing player can walk up to the opening and only needs to crouch further in, toward the back.

Real metres divided by the model's own 1.6 m worth of spawn scale — this model has no manifest-level `scale`, so its measured bounds (and any hand-written `shape`) are in its native ~100-unit-wide space, not metres; every spawn (`MainOffice`, `OfficeScene`) applies `scale: 0.016` on top to land at 1.6 m. The editor gave real-metre, world-space numbers; converting to the manifest's native units means subtracting the desk's spawn position `[0, 0, -2.55]`, undoing the 180° spawn rotation the desk carried **at the time this was measured** (`x` and `z` each negate), then dividing by 0.016:

```js
// real metres, desk-local                                    native units (÷ 0.016)
{ type: 'box', size: [1.489, 0.730, 0.340], position: [ 0.06, 0.37, -0.23] },  // → size: [93.0625, 45.625, 21.25], position: [3.75, 23.125, -14.375]   back region
{ type: 'box', size: [0.250, 0.730, 0.800], position: [ 0.67, 0.37,  0.00] },  // → size: [15.625, 45.625, 50],     position: [41.875, 23.125, 0]        right side wall
{ type: 'box', size: [0.250, 0.730, 0.800], position: [-0.67, 0.37,  0.00] },  // → size: [15.625, 45.625, 50],     position: [-41.875, 23.125, 0]       left side wall
// front (+Z, roughly z > -0.06 m): no part — the kneehole, floor to ceiling.
```

The `shape` above is model-local, so it rides the spawn rotation and the numbers still hold — but the desk no longer spawns at 180°. `MainOffice` seats it at `rotationY: 0` so the chair looks out of the back window at the dish tower, which is what the computer terminal aims; the kneehole (local +Z) therefore opens toward the front door, and that is the side you crouch in from. Re-measuring in the editor means undoing whatever rotation the spawn currently applies, not the 180° above.

+Z being the open side was actually right in the previous (second) attempt too — the bug that attempt had wasn't direction, it was the top slab. Worth remembering: a part that covers the *opening* footprint blocks standing approach even if every side wall around it is open.

A model authored in metres and spawned without an extra `scale` wouldn't need the native-units column — write `shape` sizes directly, as the general rule above says. It only shows up here because this particular download needed rescaling. When the real desk model lands (or `UCX_` proxies get added to this one), re-derive this from its actual geometry — it's fitted to the current stand-in's measured bounds, not to any future replacement.

## Commands

```bash
npm run dev        # Vite dev server with hot-reload
npm run build      # Production build → dist/
npm run preview    # Serve dist/ locally
npx serve dist     # Alternative: test production build over HTTP
npm run test       # Run Vitest
```

## Development Workflow — TDD (Mandatory)

This project uses **test-driven development**. For every new feature, bug fix, or refactor:

1. **RED** — Write a failing test first. The test must exercise the new behaviour (not the implementation). Run `npm run test` and confirm the test fails for the right reason.
2. **GREEN** — Write the minimum implementation to make the test pass. No more.
3. **REFACTOR** — Clean up while tests stay green. Remove duplication, improve naming, extract helpers.

**Rules:**
- Tests live beside source: `src/core/Foo.test.js` next to `src/core/Foo.js`.
- Use `vitest` with `jsdom` environment for DOM-touching code (editor, UI).
- Never commit code without its tests passing.
- Pre-existing WASM-related test failures in unrelated modules are acknowledged as background noise — do not block new feature tests on them. Filter to the affected module: `npx vitest run src/path/to/module.test.js`.
- When implementing from a plan document, follow the phase order — each phase lists the exact tests to write before the implementation.

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
- **Shadows are frozen** (`engine.shadows`). Something new that casts shadows
  and moves needs `engine.shadows.watch(object, [light])`; a one-off change
  (a panel shown, a prop placed) needs `engine.shadows.invalidate()`.
- **Never hide a light with `visible = false`** — the light count is compiled
  into every lit shader, so it recompiles the scene. Zero its intensity.
- **Occlusion zones** (`BaseScene._buildOcclusion`): room furnishings go
  undrawn while the player is outside, and outdoor things no window can see
  go undrawn while they're inside. Low scenery behind the building, which
  the roof hides from the whole yard, is drawn only from inside. New props
  are picked up automatically.
  When the office is redesigned, keep anything meant to be seen from the
  yard out of the rooms' furnishings, and don't add a window the fenced yard
  can see — see `docs/PERFORMANCE-PLAN.md` §3. In DevTools (dev builds),
  `__engine.activeScene.zones.revealAll(true)` turns the culling off.
