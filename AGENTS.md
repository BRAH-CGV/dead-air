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
├── app/                 # The menus around the game (see "App flow and menus")
│   ├── App.js           # Glue: AppFlow ↔ Engine ↔ MenuView ↔ PointerLock ↔ SettingsStore
│   ├── AppFlow.js       # Pure state machine: states, screen stack, transitions
│   ├── PointerLock.js   # request() → Promise<boolean>, never throws
│   ├── MenuMusic.js     # The track under the main menu; fades on the audio clock
│   ├── SettingsStore.js # Settings schema, validation, localStorage
│   ├── applySettings.js # Settings → camera, renderer, player, shadows, debug gate
│   ├── keyNames.js      # keyName(code), reserved keys, rebind() with swap
│   └── controlsList.js  # The fixed keys listed on the CONTROLS tab
├── components/
│   ├── FirstPersonController.js  # WASD + mouse look, Rapier character controller
│   ├── Flashlight.js    # F: weak, short-range spotlight on the camera
│   ├── Ambience.js      # A loop per room, eased toward the AmbienceMix; tension music (setTension)
│   ├── AirlockSound.js  # The pressure release as the airlock seals and cycles
│   ├── SatelliteSound.js # The dish's drive while it slews, and the click as it settles
│   ├── WindowSand.js    # A storm's sand on the office window: louder the nearer the glass
│   ├── SuitVisor.js     # EVA helmet glass shader overlay + mask breathing loop
│   ├── PlayerBody.js             # Player heights + eye heights, from the feet (pure, tested)
│   ├── GeneratorSound.js # Generator start-up / hum / wind-down; faint from indoors
│   ├── EVASuit.js       # On the player: worn or not, with change listeners
│   ├── Daylight.js      # dawnFactor(hour, state) → sky uDawn, lights, fog (dusk and dawn); turns the sky, aims the moonlight
│   ├── Bed.js           # Interactable: sleep once clocked out (3 AM, quota met) → next night
│   └── AirlockPortal.js # Airlock state → which occlusion zone is drawn; holds the doors until ready
├── gameobjects/
│   ├── WindDust.js      # Low dust clouds on the wind, a wall of them in a sandstorm: one draw call, moved in the vertex shader
│   ├── MarsSky.js       # Night/day sky dome shader, stars, moons; setHour turns it
│   ├── WallClock.js     # Analogue clock driven by the NightClock
│   ├── WindowGlass.js   # The office window's dust film: baked smudge map, unlit shader lit by uLight
│   ├── DustEye.js       # A pair of storm eyes (glow shader) and the jaw that grows in when it turns
│   ├── DustStorm.js     # Sandstorm grit: one GPU-driven point cloud wrapped round the player
│   └── Ufo.js           # Saucer model, beacon, shadow-casting searchlight, beam cone shader, teleport flash
├── gameplay/
│   ├── NightClock.js    # 6:00 PM → 6:00 AM over one night: the shift to 3 AM, then overtime (SHIFT, NIGHT_SECONDS)
│   ├── GameController.js # playing → (3 AM, quota met) sleep → next night; overtime to 6 AM; fail() for threats
│   ├── DustEyes.js      # Eyes in the storm: spawn, stare, chase, escape through the airlock
│   ├── StormOutage.js   # A strong storm may choke the generator: lamps flicker, then the power cuts
│   ├── Growl.js         # The dust eyes' growl, synthesised (no file)
│   ├── Sandstorm.js     # Random dust storms from night 2: wind sound, fog, sky, dust
│   ├── UfoThreat.js     # Once a night: radar blob → surge → arrival → judgement → teleport
│   └── BreakerPuzzle.js # Breakers to throw back + colour-coded leads to reconnect (pure)
├── scenes/
│   ├── BaseScene.js     # The whole base: rooms, corridors, airlock, outside
│   └── rooms/           # Room, Corridor, MainOffice, ServerRoom, LivingQuarters, Airlock
├── systems/
│   ├── NightManager.js  # Counts nights (1 … maxNight) and notifies on change
│   ├── AmbienceMix.js   # Which room loops are heard where: rooms, corridor crossfades (pure)
│   ├── OcclusionZones.js # Named object sets drawn/skipped together, with a readiness gate
│   ├── Sightlines.js    # Window half-spaces, instance splitting, hideable-part collection
│   └── PowerGrid.js     # Every lamp on the generator's switch; surge flicker; blown bulbs
├── assets/
│   └── manifest.js      # Every asset path, by key. Single source of truth.
├── ui/
│   ├── LoadingScreen.js # Preload progress overlay (markup lives in index.html)
│   ├── ScreenFade.js    # Fade to black and back (#fade in index.html)
│   ├── WhiteOut.js      # Fade to white and hold, for the UFO's catch (#whiteout)
│   ├── BreakerPanel.js  # The generator's repair minigame (#breaker-panel)
│   ├── promptKeys.js    # '[E] …' prompts name the real interact key
│   └── menu/
│       ├── MenuView.js  # Draws every menu screen into #menu; emits intents
│       ├── credits.js   # ATTRIBUTIONS.md → credits blocks (pure)
│       └── text.js      # TAGLINE, TEAM and other copy — one-line edits
└── main.js              # Entry point: Engine (paused) → init() → App.start()
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

The airlock is an interlock — its two doors are never open together. `BaseScene` hands it the office's front door with `Airlock.bindInnerDoor(door)`, and `Airlock.state` runs `pressurised` (inner door open, hatch shut, red beacon) → `depressurising` (both shut, amber) → `depressurised` (hatch open, inner door shut, green) → `pressurising` → back. The door you are leaving shuts the moment the suit changes; the one ahead opens after `cycleTime` (3.1 s, as long as the pressure release that plays through it is audible). Changing your mind mid-cycle runs back only the time already run. The cycle is ticked by a component on the airlock's own root, so nothing else has to call `Airlock.update`. The suit locker does nothing while the airlock cycles ("Airlock cycling…") and answers again once a door has opened — one suit change per cycle, so mashing E while running in from something can't flip the suit back and forth. The suit locker only works from inside the chamber, clear of both doorways by the player's radius — never from the office through the open inner door, and never where a door would shut on the player; elsewhere its label reads "Step into the airlock…".

An Interactable whose `promptLabel` changes while you look at it (the locker's Put on / Take off) is re-shown by `InteractionSystem` — update the label as a data field, since the base class field shadows a getter. `RoomTransitionSystem` does the same for a locked door whose `lockedPrompt` changes while you stand at it ("Sealed" → "Airlock cycling…").

`InteractionSystem`'s ray stops at the first solid collider it meets, so nothing can be used through a wall, a locked door or another prop. Sensors (open doorways) don't stop it. An Interactable is reached only through a collider on its own GameObject's body, so give it one that isn't buried inside another prop's.

Every prop has a job:

- **MainOffice** — the work. The computer desk faces the window, with its chair pulled out clear of the kneehole. The window is glazed: `Room` fills every window opening (a `sill` above the floor) with a solid, undrawn pane (`BackWindow`), so nothing gets out over the sill. What is seen of the glass is `WindowGlass` (`rooms.MainOffice.windowGlass`): a faint film of dust and smears, so the pane reads as glass without reflections. It is unlit and baked — one texture read per pixel — and shows by the lights it is handed (`addLight`: the ceiling light, the scene's ambient light, the UFO's window flood), read live at each draw, so a power cut darkens it. `WINDOW_GLASS.opacity` is the one number for more or less dirt. It never writes depth; the desk's transparent materials do, so they stay in front of it. A food-ration dispenser on the left wall (`VendingMachine`, procedural) has an `Interactable` stub waiting on the stamina system. There is also a bin, a shelf, an extinguisher by the airlock door and a poster.
- **LivingQuarters** — the bedroom. The bunk you sleep through the day in, with lockers, a desk and a chair. The furniture keeps to the left half so the metre inside the right wall stays clear, wherever `doorOffset` slides the doorway.

The airlock is a `Corridor` with `static kind = 'Room'`, so `RoomTransitionSystem` tracks it as a room. Corridor `ends` take one mode for both ends or a `[first, second]` pair along the axis (`[back, front]` on z); the airlock is `['open', 'doorway']` — open where it sits flush on the office's front wall face, a doorway for the hatch at the far end.

### Ambience

`Ambience` (on the scene's `Ambience` group, as `scene.ambience`) plays two layers of looping sound. `BaseScene._addAmbience` builds it from the rooms and corridors.

- **Rooms.** Each room has a loop of its own (`AMBIENCE.rooms`, by room name), and the wind (`AMBIENCE.outside`) is everywhere that isn't the base. `AmbienceMix` says how loud each is at the camera:
  - **In a room** (its whole shell, `bounds()`): that room's loop, alone.
  - **In a corridor:** the two rooms it joins, crossfaded by how far along it you are. The fade is equal power (cos / sin), so the loudness holds level. The mix finds what a corridor joins by looking just past each end, so nobody lists which room is on which side.
  - **Outside** (the yard, the roof, the valley): the wind, alone. It is never heard in a room or a corridor.
  - **In the airlock:** whichever side's door stands open: the office through the inner door, the wind through the hatch. While it cycles with both doors shut it is silent, so a change of mind mid-cycle never lets the wind in. `_addAmbience` does this by setting the airlock zone's `track` (null while cycling) on `Airlock.onStateChange`. A zone with no track is silent, not "outside".
  - **The pressure release** (`AirlockSound`, beside the `Ambience`) fills that silence: `sfx:pressure-release`, once as the doors seal, on the way out and back in. Only for a player in the chamber, so a cycle they aren't in (a retry takes the suit off from the spawn) isn't heard. `Airlock.cycleTime` is `AIRLOCK_SOUND.audibleSeconds`, and a scene test keeps them equal: change the clip, change both. If a door opens with it still sounding it fades out.
  - The gains ease toward the mix (`blendRate`), so a teleport or a door opening is a quick fade, not a cut.
- **In a sandstorm** (`setStorm(level)`, called by `Sandstorm` every frame) the wind is the storm's sound. Outside it rises from its calm trim (0.5, in `AMBIENCE.volumes`) to `storm.gain` (3.3) times its file level, about what the storm recording it replaced played at. Indoors `storm.inside` (3 %) of that gets through the walls of every room and corridor, and a little more into the office behind its window (`storm.rooms.MainOffice`, 10 %): mixed in slightly, under the room's own loop, which isn't turned down. In `AmbienceMix` that is `seep` (how hard the outside presses, the storm level) times `leak` (how much a place lets in). The sealed airlock stays silent.
- **Sand on the window** (`WindowSand`, beside the `Ambience`). In a storm, `sfx:window-sand` loops in the office: its level is the storm's level times `sandLevel(distance to the glass)`, full within `near` (0.5 m) and silent from `far` (3 m), so the last steps up to the window fade it in. Only inside the office's shell; the level eases, and the loop stops at zero. The window is `_officeWindow()`'s rectangle, the same one the dust eyes use.
- **The dish** (`SatelliteSound`, on the Satellite). `sfx:dish-main-loop-distant` loops for as long as the dish is moving, fading in and out over 30 ms (`fade`) as a movement starts and ends; then `sfx:movement-ending` plays once, the dish settling. Moving is read off the dish's angular velocity on either axis, with separate start and stop speeds so a creeping dish doesn't chatter. The fades are gain ramps on the audio clock, since 30 ms is only two frames; between movements the loop runs on at zero rather than being stopped. Paused, it is muted: the game stops but the audio clock doesn't, so it listens to `engine.onPauseChange`, fades the loop out and cuts a click still sounding, and fades the loop back in on resume if the dish is still mid-movement. Levels are `SATELLITE_SOUND`.
- **Tension music.** One loop that follows a tension level, 0..1. A threat raises it under a name of its own: `scene.ambience.setTension(1, 'window-entity')`, and `setTension(0, 'window-entity')` when it has gone. The music follows the highest level anyone holds, and creeps in and out over `musicFadeIn` / `musicFadeOut` (4 s / 6 s). `clearTension()` drops every source. **Testing only — remove before release:** the `testKeys` in `_addAmbience` each swing a track fully in, and back out on the next press: `M` the spooky music, `,` the ambient music. Pressing the other key crossfades between them. The keys exist in dev builds only.
- **A second music track.** `AMBIENCE.ambientMusic` (`sfx:interior-base-ambient-music`) is a calmer track: the main menu's music (`MenuMusic`, see App flow). In game nothing raises it except its test key; `setTension` always drives `AMBIENCE.music`. Its file is much hotter than the rest, so it carries a 0.07 trim in `AMBIENCE.volumes`. It also fades out at its end, so it dips to silence where it loops.
- **Volumes are the clips' own**, each mixed to the loudest it should be. `AMBIENCE.volumes` is a per-track trim on top (a multiplier, by manifest key; left out is 1), for balancing one against the others: the office loop is at 1.2, about +1.6 dB, and the calm wind at 0.5, −6 dB. The spooky music has no trim — its file level is its ceiling.
- **A loop at zero is stopped**, and starts from its top the next time it is wanted.
- **Loading.** The six clips are in the manifest's `AMBIENT` group, not `PRELOAD`: `Ambience` fetches them as the scene is built (on awake, so they load behind the main menu) and each fades in once the game is playing, so 10 MB of mp3 never holds the loading screen.
- **Looping.** `blendLoopSeam` crossfades each clip's tail into its head **in place**, in the cached buffer, and the loop restarts one fade in (`setLoopStart`). SuitVisor's `seamlessLoop` copies instead, which is fine for a short clip; copies of these would cost another ~195 MB.
- **Memory.** Decoded audio is 32-bit float PCM, ~23 MB per stereo minute at 48 kHz, whatever the mp3 weighs. The three room loops are 60 s each (~23 MB apiece), the wind is 70 s (~27 MB), the spooky music is 135 s (~52 MB) and the ambient music is 117 s (~45 MB): ~195 MB in all. The room loops were first mixed at 3 minutes, which came to ~260 MB; they are steady room tone, so they were cut to their first 60 s. Keep a new loop short. The room loops are also nearly mono (L/R correlation 0.98–0.999), so a mono export would halve them again; the wind and the music are true stereo, and the music loops as a piece, so it can't be cut.

### Shift and day

A night: `NightClock` runs 6:00 PM → 6:00 AM, sunset to sunrise, over `NIGHT_SECONDS` (600 s, ten real minutes: 50 s an in-game hour, the pace the old midnight-to-6 night had), shown on the HUD and on the office's `WallClock`. Hours count from midnight, so the clock runs -6 → 6 (`SHIFT`: `startHour` -6, `darkHour` -5, `shiftEndHour` 3, `endHour` 6); `formatTime` wraps them for display. Nothing comes before dark (`SHIFT.darkHour`, 7 PM): the Sun drowns the faint signals, and the threats keep to the night too.

**The shift is 6 PM to 3 AM** (nine hours); **3 AM to 6 AM is overtime** (`clock.overtime`, `controller.overtime`). With the quota met the player may go to bed from 3 AM (`controller.canSleep`); without it they work on, and can still make it up before 6 AM — signals keep coming into overtime. `GameController` owns the state:

```
playing ──3 AM on, quota met: sleep()──▶ playing (next night)
   │                                └──on the last night──▶ finished
   ├──6 AM, quota met──▶ morning ──sleep()──▶ (the same)
   └──6 AM, quota missed──▶ gameOver ──[E]──▶ playing (same night, reset)
```

The HUD prompt follows where the shift stands, set on change: quota met before 3 AM ("hold out until the shift ends at 3:00 AM"), clocked out ("get some sleep, or keep working"), or overtime without it ("meet the quota before 6:00 AM").

**Rates, not counts.** Things happen as often per real minute as on the old five-minute night, so the longer night has more of them: `SIGNALS_PER_NIGHT` 10 (was 5) over the same share of the night, two storms (`SANDSTORM.perNight`, was one). The quota is 1.5× the old 3, 4, 5: 5, 6, 8 (`QUOTA_SCALE`); night 3's 8 fills a drive box. The UFO still comes once, on night 3.

Meeting the quota early does **not** end the shift — the core loop is "meet the quota, then survive until the shift ends". The story reason there is no day shift: the Sun drowns the faint signals and heats up the dust storms.

- **One night number.** `gameController.bindNights(nights)` makes the controller follow the `NightManager`; sleeping calls `nights.advance()` and the listener starts the next night. Never call `startNight` beside it, or the HUD and the quota drift apart.
- **Sleep.** The `Bed` interactable sits on the LivingQuarters bunk (`rooms.LivingQuarters.bed`). It is live whenever `controller.canSleep` (overtime with the quota met, or the morning), and it runs `controller.sleep()` behind a `ScreenFade`; otherwise its label says why not (the shift runs until 3 AM / overtime: meet the quota). Rooms build the bed and the clock; `BaseScene` hands them the controller, fade and clock, because rooms don't know about gameplay.
- **Dusk and dawn.** `dawnFactor(hour, state)` is 1 at 6 PM, the shift starting in the last of the daylight, smoothsteps to 0 over the first hour, is 0 all night, smoothsteps back to 1 over the last hour and holds at 1 all morning. `Daylight` (after the controller on `GameplaySystems`) applies it to the following — from `onAwake` too, so the main menu, over a scene that never ticks, shows the dusk:
  - `MarsSky`'s `uDawn` uniform, which is shared by the dome and the stars. This is the state-driven shader uniform: night gradient + Milky Way → butterscotch day, blue glow round the Sun, stars fading out.
  - the ambient and moon lights (the moon light is the morning sun).
  - the fog colour.

  Night values are captured when `Daylight` is built, so the scene's lighting code stays the one place that defines the night.
- **The sky turns.** `Daylight` also calls `sky.setHour(clock.currentTime)`.
  - **What turns.** The stars, Milky Way, both moons and the Sun turn together, 15° an hour, westward about a pole due north and 35° up (`latitude`, `hourRate`). Midnight is the sky as authored, so the moon angles in `DEFAULT_MOONS` are their midnight positions.
  - **The Sun.** The turn is what places it: it reaches the horizon at `sunAzimuth`, in the window, at 6 AM (`sunriseHour`). It is on the celestial equator, so it set twelve hours earlier, at 6 PM, behind the base. The moons ride ~125° away from it, across the sky: both are down at sunset and rise at about 10:30 PM (Phobos) and 11 PM (Deimos).
  - **How each part turns.**
    - The stars and moons get the turn as a quaternion.
    - The dome can't rotate, since its horizon haze belongs to the ground. It gets the same turn as the `uSkyRotation` mat3 uniform, and looks the Milky Way up at `dir * uSkyRotation`.
    - `sky.directions` holds the live world directions of `sun`, `phobos` and `deimos`.
  - **The moonlight.** It shines from wherever Phobos is. While Phobos is low or down it comes from Phobos's bearing but never lower than `MOONLIGHT.minElevation` (20°), never from under the ground, and dimmed to `MOONLIGHT.downLevel` (35 %) until Phobos rises: the early evening is the darkest part of the night. Through the dusk and the dawn it swings between that and the Sun's bearing at `sunElevation` (30°), keeping the distance the scene set, so the shadow camera still fits.
  - **Cost.** Nothing is allocated. The sky and the light are rewritten each frame of the night, and not at all while the morning clock is stopped.

### Power and the UFO

The generator outside is the base's one power switch. It stands in the far corner of the fenced yard, on the side away from the buggy (`GENERATOR_CORNER_INSET` in from the fence's corner, read off the fence's rect). `BaseScene._addPower` puts every light and glowing fitting in the rooms, the corridors and on the dish pad on a `PowerGrid`, which remembers what each was built at and rewrites it every frame from one level.

- **Three faults.**
  - `grid.on` is the generator's switch. Off kills every lamp *and* the vital functions; the computer terminal (`terminal.setPowered`) reads it.
  - `grid.broken` is blown bulbs: they stay dark with the power back on. `grid.lit` is the ordinary bulbs actually shining.
  - `grid.tripped` is breakers thrown by the UFO's surge. While tripped, `setOn(true)` is refused until `resetBreakers()`. Cutting the power by hand never trips them, and a new night's `repair()` resets them along with the bulbs.
- **Switching it normally** goes through the panel too, as an easy `BreakerPuzzle({ flick: 'on' | 'off' })`: every lead already home and every breaker the wrong way. Flick them all up to start the generator, or all down to shut it off.
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
  - **Volume.** Outdoors it falls off with distance from the generator; inside any room or corridor it is a whisper (`insideLevel`, 1 %).
  - **The clips** are cut at MPEG frame boundaries from one 3-minute recording, so only about 22 s of audio is decoded.

`UfoThreat` (on `GameplaySystems`) brings the UFO on its nights only (`UFO.nights`: night 3, the last), guaranteed and once. It spawns at a random time between 8:00 PM and 2:00 AM on the night clock (`UFO.spawnHours`, -4 … 2 — gone before the shift ends at 3 AM, so going to bed then never skips it; via `scheduleApproach`, which follows the clock's own length and start), with the radar warning `radarLead` seconds before. For testing, `summon()` (the **U** key, to go before release) brings it at once, on any night:

```
waiting ─▶ approaching ─▶ expanding ─▶ lethal ─▶ gone
                                          └──▶ caught ──▶ gameOver (controller.fail) ──[E]──▶ retry
```

- **Approach.**
  - For `radarLead` (20 s) it is only on the radar: a wobbling, glitching blob (`RadarOverlay.threat`, on the shared `_skyToCanvas` mapping) crawling toward the centre, which is overhead. The signal lamp goes `frantic`.
  - Parking the radar cursor on the blob (`RadarOverlay.threatAt`) flashes the red `ANOMALY_WARNING` line ("extreme electrical anomaly detected — turn off power…") above the radar's info line.
  - When the flight sound starts, the UFO bursts into the sky (`Ufo.appear`: its beacon flares to several times its size, plus a flash). It's ~700 m out along its path, with its searchlight already on as a thin shaft, and a beacon glow that holds its size on screen through the haze. It slows all the way in.
  - **Where it appears** (`spawnBearing`): always in view of the office window, far off, in the open sky either side of the dish tower (`inViewFrom`–`inViewTo` off the window's bearing). The tower fills the view straight out. So you can always watch it flash in.
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

### Sandstorms

`Sandstorm` (on `GameplaySystems`, after `Daylight`) brings two dust storms every night (`perNight`), night 1 included (the dust eyes stay away until night 2). They blow after dark, in `stormHours` (-4.5 … 5.9: 7:30 PM – 5:54 AM), split into equal parts with one storm wholly inside each, so one comes in the evening and one in the small hours and they never overlap. Each blows for about an hour and a half of clock time (`durationHours`, 1.3–1.7), building up and dying down over `rampSeconds` (`stormLevel`). The schedule follows the clock's own length and start (`scheduleStorms`); the next storm comes up when the last has blown over (a new `stormId`). For testing, `summon()` (the **K** key, to go before release) starts one at once, on any night, standing in for the next storm that hasn't started. `sandstorm.level` (0 … 1) is what the dust eyes read.

- **Never with the UFO.** On a UFO night (`UFO.nights`) nothing is scheduled at random; instead a storm always follows the UFO, `afterUfoDelay` (10–30 s) after it has gone. Neither a scheduled storm nor K starts one while a visit is under way (`_ufoBusy`); a storm due then waits.
- **Held.** While `sandstorm.held` is set (`DustEyes`, through a chase) the end keeps being pushed back past the die-down, so the storm stays at full until the player is away.

- **Sound.** None of its own. The wind outside is the `Ambience`'s loop; the storm passes it its level every frame (`Ambience.setStorm`), and the Ambience blows the wind harder and lets a hiss of it into the rooms (see Ambience).
- **Fog.** Thicker and dark rust-brown (`dustColor`, `fogTint`): `#4c2818` at full storm, within a shade of the wind dust's clouds *as the screen shows them*. The clouds are tone-mapped (ACES), which deepens `WIND_DUST.nightColor` `0x583427` to `0x4f2418`; three lays fog on after tone mapping, so the fog has to be given a result, not the same hex. The colour was found by eye from both sides: `dustColor` (`0x51280c`) is low in blue to cancel the clear night's blue that `fogTint` leaves in, which turned the valley mauve, and more green than this turns it yellow. Tests in `Sandstorm.test.js` pin the match and both limits. From indoors (`fogDensity` 0.065) the storm swallows the view out of the office window just before the radar dish, ~23 m from the desk (a test pins it); outside (`fogDensityOutside` 0.08) it closes in tighter. Eased with the player's place. It applies where the valley is in view (`valleyInView`): outside, the office and the airlock — the airlock counts because the office window shows through its inner door, and leaving it out made the window pop from clear to storm on the step into the office. Not the corridors (no window: the storm fog there only tinted the sealed rooms seen through their doorways), nor the sealed mood rooms (`ROOM_FOG_DENSITY`), which keep their own fog. **The building itself takes no fog**: the office's, the airlock's and the corridors' own surfaces have `fog: false` (`BaseScene._keepFogOutside`, copying any material shared with something outside first), so the storm fills the view through the glass but not the rooms — at a storm's density a wall 10 m off was a third dust-brown. On a clear night that fog is ~0.05 % at 10 m, so nothing indoors changes. The sealed rooms' mood fog shows **only from inside them**: their fogged surfaces carry a switch in their fog shader (`roomFog`, `BaseScene._switchSealedRoomFog`, set in `_applyRoomFog`), on only while the player is in that room — seen through a doorway from anywhere else they took the storm's brown. A uniform rather than `material.fog`, so crossing a doorway recompiles nothing. The fog is shared with `Daylight` (colour) and the room fog (density), so the storm keeps no copy of "the clear fog": each frame it adopts whatever someone else wrote since its own last write and lays itself on top, handing back exactly the night's values when it passes.
- **Clouds.** The wind dust (`scene.windDust`, see *Wind dust* below): `Sandstorm` is handed its `WindDustMotion` as `clouds` and calls `setStorm(level)` on it every frame, so one storm level runs the fog, the sky, the grit and the clouds. The grit blows along the clouds' own axis: `WIND_DIRECTION` is `WIND_DUST.direction`.
- **Sky.** `MarsSky.setStorm(k)` writes `uStorm`, shared by the dome and the stars like `uDawn`: the dome sinks to a dust-brown murk, the stars go, and the moons (bodies and halos) fade to 8 %. At its foot the dome also takes the scene's fog: its material has `fog: true`, so three hands it the same `fogColor` as the ground, and the shader lays it on after tone mapping, all of it at the horizon, half by about 20° and none from about 45° up (`STORM_HAZE_TOP`, 0.7), so it clears the trees and hills as seen from the ground. Without that the fogged land ended in a hard line against a darker sky; the top of the sky stays dark.
- **Dust.** `DustStorm` (on the scene root, like the UFO, so the occlusion sort never files it away) is one `Points` cloud moved entirely in its vertex shader: each grain drifts along `uWind` by `uTime` at its own speed, gusting, and is wrapped into a 36 m box on the player (`uCenter`). Every room and corridor is cut out of it (`setCutouts`, as for the UFO beam — a grain inside one is dropped in the vertex shader), so it shows from indoors too and blows past the office window without drifting through a room. Shown wherever the storm fog is (`valleyInView`), eased. Undrawn (`visible = false`) while calm — it's not a light, so that recompiles nothing.

### Dust eyes

`DustEyes` (on `GameplaySystems`, after `Sandstorm`) brings pairs of eyes out of a strong storm (`spawnLevel` 0.8) from night 2, in two places, each with its own roll, clock and cap: the yard rolls every `checkSeconds` (5 s), the window every `windowCheckSeconds` (5 s) half a beat out of step (`windowCheckOffset`), each with its own chance (`SPAWN_CHANCE`, `spawnChance(night, kind)`: 8 % night 2, 20 % from night 3, for both to start with), and caps of 5 in the yard and 3 at the window (`maxEyes`). They are a pool of `DustEye`s built with the scene (`DUST_EYE_POOL`, 10 — room for ones fading out as new ones replace them), hidden, on the scene root.

- **The yard** (`'fence'`, `fenceSpawnPoint`): just beyond the chain-link (`beyondFence` 6–9 m — the far run or either end, never inside, within `sightRange`), spread out — each new one at least `spreadDistance` (10 m) from the others where it can be, never beside the building (side-run spawns keep `sideStart`, 5 m, out from its front), never in the trees, nor with one — or the buggy, the generator, or the building itself (`occluders`) — between it and the player at any point of its sway; one hidden behind the building can't be stared at (`sightBlocked`, against `MarsVegetation`'s own `trees` list, each with canopy `TREE_REACH`, and the yard `obstacles`), with the eyes at `height` 1.9–2.6 m, above the tallest grass (1.45 m). It comes in front of the player (`inViewAngle` 35°, cast along their view to where it meets the fence) `inViewChance` (60 %) of the time — always for the J key; after `spawnTries` misses it settles right by the wire, inside the band kept clear of trees. The common ones — rolled, whether the player is in or out (they wait out there), up to 5. From night 3, stepping out into the storm always brings two (`stepOutEyes`) within `guaranteeDelay` (3 s).
- **The window** (`'window'`, `windowSpawnPoint`): out past the office glass, deep in the storm toward the dish (`windowDistance` 22–30 m), burning fainter (`windowIntensity` 0.5) and dimming faster with distance (`windowDim`) — there to be made out, not to jump out. The rare ones: rolled only while the player is indoors, at most 3, with `windowCooldown` (10 s) between them. One that is stared at snarls, backs off into the fog and comes round to the yard **agitated** — its watching eyes a darker orange (`DustEye.setAgitated`), quicker to turn (below), and staying until the storm ends — never sent away, even to make room. Neither kind leaves when the player goes in or out, nor with time — only with the storm, or to make room: a new one that would put its kind over the cap sends the oldest ordinary watching one away (never one that has turned, never an agitated one).
- **The midway check.** Halfway through every storm (`midwayAt`, read off `sandstorm.stormProgress` and once per `stormId`) one eye always comes to the yard — two from night 3 — and one to the window unless one is there already, past the caps and the window's cooldown. A chase holds it back until it is over.
- **Staying out.** From `graceSeconds` (6 s) after the airlock hatch opens, while the player is outside, every `aggroRollSeconds` (2 s) each watching yard eye rolls `aggroChance` (5 %; `agitatedAggroChance`, 25 %, if agitated) to turn on its own, growling `passiveGrowlSeconds` (2 s) before it leaps. Only one turns on its own at a time (no rolls while one is after the player), but staring at another during the chase turns that one too, and both come. The clock restarts each time the hatch shuts.
- **The generator draws them.** Finishing the generator's panel in a storm — switching it on or off, not opening the panel — has an even chance (`generatorChance`, `generatorNoise`) of setting a yard eye on the player: a watching one turns, or one comes already turned.
- **Passive.** Two yellow eyes (`DustEye`: large additive glow quads — core, glow and a wide halo, `fog: false`, dimmed by distance with `dimDensity` 0.02 so they burn from deep in the murk) in a round silhouette of denser dust — a circle round the face, its edge ragged and moving, drawn in its own fragment shader in the live fog colour × `silhouetteShade` (0.85): a light brown only just darker than the storm, so it blends in. The whole face turns to look straight at the player every frame (drawn double-sided, so never lost edge-on). They drift slowly side to side across the player's line of sight (`swayAmplitude`, `swayRate`) and stay until the storm drops under `leaveLevel`.
- **The stare.** It builds while an eye sits within `gazeAngle` (8°) of the middle of the view and can actually be seen — outside for fence eyes, through the window opening for window eyes (`throughWindow`; the wall beside the glass blocks it) — and drains when you look away.
  - Outside, `stareSeconds` (0.6 s) turns it. **Growling** (`growlSeconds`, 1.2 s): it holds still, eyes red and swollen, the jaws shut (`DustEye` mode `growl`, `uClosed`: the lower jaw up against the fangs and front teeth), and a low growl (`growlVolume` 0.35). **Leaping** (`leapSeconds`): the jaws gaping (mode `aggressive`, `uOpen`: a row of front teeth between two long canines along the top, jagged inward teeth down each side, each its own length, and a lower jaw across the bottom — a curve of upward teeth with its own canines; only teeth, no mouth or gums behind them, drawn entirely in its fragment shader), it hops along an arc toward the player — hard and fast, up to `leapDistance` (12 m) in `leapSeconds` (0.42 s) — but never nearer than `leapMinGap` (4 m) — never onto them, and with the chase slower than a sprint that is time to run. **Chasing**: at `chaseSpeed` (3.6 m/s; the player runs at 5), straight at the face — but round the solid things in the yard (`obstacles`: the buggy and the generator, measured off the objects by `BaseScene._yardObstacles`), corner to corner (`steerAround`); a leap that would cross one lands short of it. The airlock is one of them, with its hatch as a `door`: after a player inside it, a chase lines up on the hatch (`doorStep`) and comes in that way, never through the side walls. Other eyes melt away. The storm is held from the growl to the end of the chase, and `sfx:tiger-attack` loops from the leap — never above `attackVolume` (0.25), louder as it closes.
  - Through the window, `windowStareSeconds` (0.7 s) is enough: it growls, jaws shut, barely audible (`windowGrowlVolume` 0.05), and backs off into the fog (`retreatSpeed`) over `retreatSeconds`, fading — no chase.
- **The growl** is synthesised at load (`Growl.js`, `synthGrowl`: a wavering low pulse, chopped ~27 times a second for the rattle, over brown noise, low-passed and enveloped; seeded, so the same every time) — no file.
- **Escape** (from the turn or the chase). Indoors with the airlock hatch shut (`rooms.Airlock.hatch.locked` — taking the suit off in the chamber shuts it at once). It fades out and lets go of the storm. Inside with the hatch still open is not safe.
- **Caught** (`catchDistance`): the bite (`sfx:monster-bite`, started past its leading silence — `leadingSilence` — so it lands on the catch), `controller.fail`, the screen cuts to black at once and slowly turns red (`WhiteOut.play(msg, { tone: 'blood', fadeMs: 0, redMs: 2500, messageDelayMs: 2200 })`; the UFO's white-out keeps its slow burn). The prompt and the retry are held back until the message shows (`controller.fail(msg, { retryAfter })`): mashing E through the death does nothing with "You have been eaten. Press [E] to try again", and the player is frozen; `[E]` retries, and a night start clears the eyes and frees the player. The shift ending (6 AM) sends them away.
- For testing, `summon()` (the **J** key, to go before release) brings one to the yard and one to the window, wherever the player is — starting a storm first if none is blowing. `summon('fence')` / `summon('window')` bring just one. It works on night 1; nothing comes on its own before night 2.

**The fence's wire mesh discards its gaps** (`alphaTest` on the lattice material in `PerimeterFence`). A transparent card still writes depth over its whole face, so before this anything drawn after it from beyond the fence — the dust eyes, the grit — was hidden by the invisible gaps.

### Storm outages

`StormOutage` (on `GameplaySystems`) takes the power out once every storm (`sandstorm.stormId`), at a random point through it (`STORM_OUTAGE.at`, 25–75 % of the way, read off `sandstorm.stormProgress`). The lamps flicker for `flickerSeconds` (2.2 s) — `PowerGrid.brownout`, a flicker that only ever gutters and dims, never flares like the UFO's surge — with the flickering-light buzz, then `cutPower` (`GeneratorSound.switchOff`: the wind-down plays, `grid.setOn(false)`). It is an ordinary shut-down: nothing tripped or broken, so the generator's panel only needs its switches flicked back up, and the power stays on for the rest of that storm. A grid already off or tripped when the moment comes is waited for; the shift ending or a new night steadies the lamps.

### Input system

Centralized on `Engine.input`:
- `keys` — object keyed by `KeyboardEvent.code` (e.g. `KeyW`, `Space`)
- `mouse` — `{ dx, dy }` accumulated deltas, consumed each frame
- `locked` — boolean, pointer-lock active

`Engine.keyBinds` maps action names to codes (`flashlight` is `F`), including the debug keys (`debugFly`, `fullbright`). `engine.consumeAction(action)` uses up the current press: `isAction` reads it as up until the key is released. Toggle-style debug actions get their own edge-triggered `keydown` listener — `input.keys` is level-triggered and can't express "on the press".

### Wind dust

`createWindDust` (`src/gameobjects/WindDust.js`, as `scene.windDust`) is the wind made visible: low, ragged clouds of dust blowing across the ground outside and past the office window. Nothing reaches above 2.6 m, so the sky stays clear.

- **One draw call.** A quad per cloud (`WIND_DUST.count`, 24 when calm) in one buffer, written at build and never again. The vertex shader places each cloud, turns it to face the camera and moves it; the CPU sets a handful of uniforms a frame (`WindDustMotion`).
- **Around the camera, fixed in the world.** The clouds are scattered over an area that rides the camera. A cloud's place is its seed plus the wind's drift, wrapped into that area, so walking doesn't drag the dust along.
- **Movement.** `windDrift` carries them all downwind, gusting. Each cloud also surges ahead and falls back, meanders across the wind, sinks and rises, and thins and thickens, on phases from its own seed; the noise it is cut from rolls up through it.
- **Storm.** `WindDustMotion.setStorm(level)` takes it from calm (0) to a dust storm (1): ten times the clouds (`storm.count`, 240), much bigger and taller (`storm.size`, 7–12.5 m, so from 20 m off the tallest fill the top of the screen), thicker (`storm.opacity`, 0.65), and right up to the walls and the camera — from half a metre off the building and at full strength by two (`storm.clearance`, `storm.wallFade`), and at full strength 7 m from the camera (`storm.nearFade`), which from the desk is the dust just outside the glass — so the view from the window closes in, and blowing `storm.speed` times faster. The extra clouds are in the buffer from the start; a storm changes the draw range and a few uniforms. `Sandstorm` is the only caller: it is handed the component as `clouds` (`BaseScene._addSandstorm`) and passes its own level every frame, so the clouds build and die down with the fog, the sky and the grit. `storm.ramp` is short (0.6 s) for that reason — the level arrives already eased. There is no key of its own: `K` summons the whole storm (*Debug tooling*). A storm costs far more to draw than the calm: its clouds are many times the size on screen, stacked several deep (roughly five screens' worth of see-through pixels at worst, against a fraction of one when calm), on top of the storm's fog and grit. **Not yet measured on lab hardware** — check with `I` at full storm, standing in the yard; `storm.count` and `storm.opacity` are the two numbers to lower, and the fog already carries much of the density.
- **Tuning.** All in `WIND_DUST`. Calm is a rare few, faint (`count` 24, `opacity` 0.22); the storm is a wall of them. `count` and `area` are the density, `height` / `width` / `base` the size and how high the clouds reach, `opacity` and `nightColor` how much they show.
- **Overdraw is the cost, so it is what's limited:** few clouds, low on screen; none within `nearFade` of the camera; a faded cloud is collapsed in the vertex shader; two texture reads per pixel from a 64 px noise tile.
- **Not indoors.** Two things keep it out of the rooms and corridors (`cutouts`, their shells): the vertex shader drops any cloud whose middle is within `clearance` of one (thinning it over the `wallFade` metres before that, so a cloud blowing up to the window fades away instead of vanishing), and the fragment shader throws away any pixel inside one. The second is what lets a storm's clouds, far wider than their clearance, come right up to the walls. From the desk that leaves dust beyond the back wall, in the window.
- **Not under `Outside`.** It moves with the camera, so the occlusion sort has nothing to place it by. It is drawn in every zone.
- **Colour** goes from `nightColor` (dark rust) to `dayColor` (a lit orange-brown, `0xa05a2e`; a pale one disappears into the day's butterscotch sky and fog and reads as white wisps) with the dawn: `BaseScene` hands `WindDustMotion` the `Daylight` component as `daylight`, and it reads `factor`. Not the fog's brightness — a sandstorm turns the fog dust-brown, brighter than the night's blue, and the clouds paled as if the Sun were rising.
- Unlit, no shadows, no depth write, no fog: nothing added to the lit shaders or the frozen shadow maps. It keeps its own colour at any distance; the storm's fog is matched to it (`SANDSTORM.dustColor`), not the other way round.

#### Storm quality — waiting on the settings menu

A full storm is the most expensive thing the game draws: about three screens' worth of see-through cloud pixels in the worst spot (the yard, near the building), against none worth counting on a calm night. A laptop on mains power held 55–60 fps through a full storm (its 60 Hz cap, so that shows it fits the frame, not how much room is left); the same laptop on a low battery fell from 50–55 to 36–45. Lab hardware has not been measured. So the cost has a knob, as insurance, and **the settings menu (`feat/menus-navigation`) should put a slider on it**:

```js
scene.setStormQuality(q);   // 0 thinnest … 1 the storm as tuned (the default)
```

- **What it scales.** Only what costs: how many clouds a storm draws (`storm.low.count` 100 … `storm.count` 240) and how near the camera they come (`storm.low.nearFade` … `storm.nearFade`), since the nearest clouds cover the most screen. Size, thickness, colour and how close they stand to the walls stay — the same storm, thinner. A calm night is untouched. It takes effect on the next frame, mid-storm included.
- **Not the grit or the fog.** `DustStorm`'s points and the scene fog are as they were at any quality. If the grit turns out to cost, give `setStormQuality` its draw range too; the fog is free.
- **Wired to the settings.** Settings → VIDEO → Dust storm quality (`stormQuality` in `SCHEMA`, `src/app/SettingsStore.js`) is handed to it by `applySettings`, which runs at startup, on every change and after every scene build: a new scene starts at 1, so it is set again each time.
- **Trying it now**, in a dev build's console, at full storm (`K`) with the FPS readout on (`I`): `__engine.activeScene.setStormQuality(0)`, then `(1)`.

## App flow and menus

`main.js` boots the Engine **paused**, awaits `init()`, then hands it to `App` (`src/app/App.js`). `App` waits for `engine.revealed` (the loading screen gone) and shows the main menu.

**States** (`AppFlow`): `loading → mainMenu → playing ⇄ paused`, and `playing → ended` (Night failed / Run complete). Each menu state has a screen stack, so Settings, Credits and the confirm dialog always go Back to whichever screen opened them.

**Pausing** (`engine.setPaused`). The loop still renders, so settings preview live behind the menu, but nothing steps or updates. `engine.onPauseChange(listener)` tells whoever asks when it pauses and resumes — a sound that must stop with the game has no frame to notice in (the dish's drive uses it). The clock, the dish, the airlock and every enemy freeze without knowing why. Input is cleared on pause and on resume, so no key sticks. The rules (`App.js` header):

- **What pauses:** a lost pointer lock, Escape, a hidden tab or window blur. Only while playing, and never while the level editor is open (it drops the lock on purpose). While a DOM panel has the mouse (`engine.uiHasMouse`, set by `BaseScene._usePanel` for the breaker panel), a lost lock or Escape isn't a pause either, and Resume leaves the mouse with the panel.
- **A UFO catch** fails the shift and then plays the white-out. Night failed waits until "You were taken" has been up a moment, and is skipped if the player retries in place with E.
- **What resumes:** only a click on Resume, because `requestPointerLock` needs a user gesture and Esc isn't one. The game never goes back to playing before the lock is confirmed. A refused request (Chrome refuses for about a second after Esc) shows "Click RESUME again".
- **Esc inside a menu means Back.** On a root screen (main, pause, Night failed, Run complete) it does nothing.
- **Programmatic unlocks** (the end screens): the flow moves first, then the lock is released, so the unlock isn't read as a pause.
- **Keys behind the menu:** while a menu is open, a capture-phase `keydown` listener swallows every keydown (never keyup). The debug keys and the review panel's S / D can't fire behind it.
- **Gameplay overlays:** `body[data-app]` is `menu | playing | paused | ended`, and `index.html` hides the HUD, crosshair, prompt, radar and review panel unless it's `playing`. It uses `visibility`, so each owner's own display state survives.

**Menu music** (`MenuMusic`, `src/app/`). `sfx:interior-base-ambient-music` loops under the main menu and the Settings and Credits opened from it, and fades out when the game starts; the pause and end screens keep the game's own sound. It belongs to the app, not the scene: the scene is paused under the menu, so nothing there is updated, and the fades are gain ramps scheduled on the audio clock instead of per-frame. Once started it is never stopped, only faded to zero, so there is never a second copy. Chrome keeps audio suspended until a gesture, so App wakes it on the first click or key on the menu; if that first gesture is New game, the music isn't heard that time. Level and fade times are `MENU_MUSIC`.

**Main-menu invariant.** The main menu always sits over a freshly built scene that has never ticked, so New game is just "unpause". Leaving a game (Main menu, Retry, Restart night, the end of the run) goes through `App.rebuild()` under a fade. It turns off the fly camera and fullbright, unsubscribes the old controller, calls `engine.loadScene(...)`, and Restart / Retry then call `nights.setNight(n)` (the same path as the N key). That is the "restart without refresh" path. Anything that hangs listeners on page elements or the window must remove them in its scene's `dispose()` (see `SignalReviewPanel.dispose`, `RadarOverlay.dispose`), or restarts stack them.

**`engine.onSceneLoaded(listener)`** fires after every `loadScene`, App's or not (F4, the editor's switcher). App uses it to re-apply settings, because `buildPlayer` and `BaseScene` recreate the controller and the moon light with hard-coded values, and to follow the new `GameController` through `onStateChange(state, previous)`.

**Settings** (`SettingsStore`): one JSON blob under `dead-air.settings.v1`, validated on load.

| Tab | Keys |
|---|---|
| GAME | `crouchMode`, `showFps` |
| CONTROLS | `sensitivity` (× the 0.002 base), `invertY`, `smoothing`, `keyBinds` |
| VIDEO | `fov`, `brightness` (tone-mapping exposure), `renderDistance` (camera far, never below 450 m — the sky dome is 400 m), `shadows`, `stormQuality` (0–1 → `scene.setStormQuality`: how many dust clouds a storm draws and how near they come) |

`applySettings` is idempotent: it runs at startup, on every change and after every scene build. Rebinding writes into the live `engine.keyBinds` object, refuses reserved keys (Esc, `` ` ``, F-keys, Q, Enter, and the debug keys while dev tools are on) and swaps duplicates. Prompts written as `[E] …` show the bound key through `promptKeys.withKeys`.

**Adding a setting:** one `SCHEMA` entry in `SettingsStore.js` plus a line in `applySettings`. The settings screen draws itself from the schema.

**Note for the sound owner:**

- A volume slider is one `SCHEMA` entry, e.g. `volume: { tab: 'game', type: 'number', label: 'Volume', min: 0, max: 1, step: 0.05, default: 0.8, format }`, plus `engine.audioListener.setMasterVolume(s.volume)` in `applySettings`.
- To silence sound while paused, suspend and resume the `AudioContext` where App calls `engine.setPaused(true/false)`, or watch `app.flow.onChange`.

**Dev tools gate.** `engine.devTools` gates every debug key (`` ` `` F2 V B I N F4 U), and they are also off while paused. It isn't a setting, because the dev tools go before release: App sets it from the build, on in `npm run dev` and off in the production bundle, so graders never open the level editor by accident. Show FPS (Settings → GAME) works either way.

**Controls** live on one screen, Settings → CONTROLS: the rebind rows, then the keys that can't be rebound (Esc, mouse look, the computer terminal, from `controlsList`). Debug keys are never listed.

**Credits** are parsed from `ATTRIBUTIONS.md` (imported `?raw`, so they're inlined at build time):

- Each `### Heading` becomes an entry, and the first paragraph after it is the attribution shown.
- `⚠` licence notes are kept.
- `TODO` entries show as "Source being confirmed" in dev builds only, and dev builds also warn about them in the console.
- The team list lives in `src/ui/menu/text.js` (`TEAM`), shown by name. Roles are kept there and hidden until `SHOW_ROLES` is turned on.
- Only assets in the game are credited: an entry whose `Manifest key` row names keys, none of them in the manifest, is left out. Removing an asset from the manifest drops it from the credits.

**Continue and Select night** share `dead-air.progress.v1` = `{ night, highest }`. `night` is what Continue starts; it's cleared on New game and at the end of the run. `highest` is the furthest night ever reached, so Select night unlocks nights up to it, and finishing the run unlocks them all. It only ever grows. An old `{ night }` save still reads.

## Debug tooling

All edge-triggered and free while off. Every key here is gated by **dev tools** (on in `npm run dev`, off in the production build) and does nothing while a menu is open:

| Key | Tool | What it does |
|---|---|---|
| `` ` `` | `PhysicsDebug` | Rapier collider wireframes over the scene |
| `V` | `DebugCamera` | Free-fly noclip camera |
| `B` | `Fullbright` | Unlit lighting — everything at albedo brightness |
| `N` | `NightManager` (BaseScene) | Advance to the next night; wraps back to night 1 after the last. Interior doors are open every night — nights bring threats, not keys |
| `I` | `PerfStats` | FPS (average and worst frame), draw calls and triangles (shadow passes included), loaded geometries/textures. Also shown by Settings → GAME → Show FPS, in any build |
| `F2` | `LevelEditor` | Visual object placement. Opening it drops the pointer lock without pausing the game |
| `F4` | Engine | Model debug logging, and reload the scene |
| `U` | `UfoThreat.summon` (BaseScene) | **Testing only — remove before release.** Start a UFO visit now instead of at the night's random time; ignored mid-visit or outside a shift |
| `K` | `Sandstorm.summon` (BaseScene) | **Testing only — remove before release.** Start a sandstorm now, on any night; ignored while one is blowing or outside a shift |
| `J` | `DustEyes.summon` (BaseScene) | **Testing only — remove before release.** Bring a dust eye to the yard and one to the window now, wherever you are (with a storm, if none is blowing); ignored outside a shift or during a UFO visit |
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
- [x] Game restarts without page refresh (Main menu / Restart night / Retry rebuild through `App.rebuild()`; see "App flow and menus")
- [ ] Credits screen listing all non-original work (the screen exists and reads `ATTRIBUTIONS.md`; still unticked because some assets have no confirmed source yet: the three TODO entries, the "Downloaded but unattributed" list, the floor textures and the signal images)
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
  are picked up automatically. An InstancedMesh whose instances are
  rewritten every frame (the mast beacons' lamps) sets
  `userData.liveInstances`: the sort splits instanced scenery into copies,
  and a component still writing to the original would be writing to a mesh
  nobody draws.
  When the office is redesigned, keep anything meant to be seen from the
  yard out of the rooms' furnishings, and don't add a window the fenced yard
  can see — see `docs/PERFORMANCE-PLAN.md` §3. In DevTools (dev builds),
  `__engine.activeScene.zones.revealAll(true)` turns the culling off.
