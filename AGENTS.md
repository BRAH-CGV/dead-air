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

  Nights 1–3 are built, as the Sleep Demon, the Window Watchers and the Camera Entity (see "Threats" below). The evil signal and the UFO are out of scope while `maxNight` is 3.
- **Requirement:** 3 genuinely distinct levels/stages, each introducing a new mechanic, environment, story element, or challenge type.

## Tech Stack

| Layer | Library | Version |
|---|---|---|
| 3D rendering | `three` | ^0.185.1 |
| Physics | `@dimforge/rapier3d` | ^0.20.0 |
| Build | `vite` | ^8.2.2 |
| WASM support | `vite-plugin-wasm` | ^3.6.0 |
| Tests | `vitest` | (dev) |

- **Renderer config:** Antialiasing on, PCFSoft shadow maps, ACES Filmic tone mapping, exponential fog.
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
│   └── Fullbright.js    # Unlit debug lighting (B to toggle)
├── audio/
│   ├── AudioSystem.js   # Every sound: one-shots, positional loops, two ambience channels
│   ├── Ambience.js      # The bed (the base's hum or the wind) and the room's own tone
│   ├── SoundCues.js     # One-shots off state edges: scan ticks, lock, 6 AM, death, airlock
│   ├── sounds.js        # The recipe for every synthesised .wav
│   └── synth.js         # Offline DSP kit the recipes use (never runs in the game)
├── shaders/
│   └── CrtScreen.js     # Terminal monitor: green radar on a curved tube (vertex + fragment)
├── components/
│   ├── FirstPersonController.js  # WASD + mouse look, Rapier character controller
│   ├── PlayerBody.js             # Player heights + eye heights, from the feet (pure, tested)
│   ├── EVASuit.js       # On the player: worn or not, with change listeners
│   ├── Daylight.js      # dawnFactor(hour, state) → sky uDawn, lights, fog; turns the sky, aims the moonlight
│   ├── Bed.js           # Interactable: sleep in the morning → next night
│   ├── ComputerTerminal.js # The radar minigame at the desk; setPowered(false) throws you off
│   ├── CrtScreen.js     # Writes the CRT shader's uniforms from the scan, power and threats
│   ├── GeneratorSwitch.js # The generator's lever: toggles Power
│   ├── StaminaDrain.js  # Ticks Stamina through the shift; a tired player sees the base dim
│   ├── OxygenSupply.js  # Suit air: drains outside, refills in the pressurised airlock
│   └── ShadowRefresh.js # Redraws a light's shadow only when a watched caster moves
├── gameobjects/
│   ├── MarsSky.js       # Night/day sky dome shader, stars, moons; setHour turns it
│   ├── WallClock.js     # Analogue clock driven by the NightClock
│   ├── MonsterFigure.js # Procedural monster stand-in: hidden, no body, eyes that glow
│   ├── SecurityCameraRig.js # Night 3's ceiling camera: pans, tilts, shows its view cone
│   └── SightlineZone.js # Box volume a threat can query (the kneehole, the server aisle)
├── gameplay/
│   ├── NightClock.js    # 12:00 → 6:00 AM over one shift
│   ├── GameController.js # playing → morning → sleep → next night; fail(reason) → gameOver
│   ├── SignalManager.js # A night's signals: save / delete, and night 3's storage
│   ├── ThreatDirector.js # Which monsters run tonight (THREATS_BY_NIGHT)
│   ├── threats/         # Threat base; SleepDemon, WindowWatchers, CameraEntity + pure *Logic rules
│   ├── Stamina.js       # How awake the player is, 1 → 0 (pure)
│   ├── BaseLights.js    # The one writer of interior light levels: base × named factors
│   ├── Power.js         # The generator's output: on, or the emergency glow
│   └── Oxygen.js        # The suit's air tank (pure)
├── scenes/
│   ├── BaseScene.js     # The whole base: rooms, corridors, airlock, outside
│   └── rooms/           # Room, Corridor, MainOffice, ServerRoom, LivingQuarters, Airlock
├── systems/
│   └── NightManager.js  # Counts nights (1 … maxNight) and notifies on change
├── assets/
│   └── manifest.js      # Every asset path, by key. Single source of truth.
├── ui/
│   ├── HUD.js           # Clock, quota, stamina and oxygen bars, objective (markup in index.html)
│   ├── LoadingScreen.js # Preload progress overlay (markup lives in index.html)
│   └── ScreenFade.js    # Fade to black and back (#fade in index.html)
├── test/                # Test doubles: fakeRapier and fakeAudio record what the code asks of them
└── main.js              # Entry point: creates Engine, awaits init()
```

Outside `src/`, `scripts/make-sounds.mjs` renders every synthesised sound into `public/assets/audio/`. `source-assets/` keeps downloads the game doesn't use (the unused monster and console models). It sits outside `public/`, so none of it ships in the build.

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

### Threats

One monster a night, run by `ThreatDirector`, which sits on `GameplaySystems` after `GameController`:

| Night | Threat | You survive by | Where |
|---|---|---|---|
| 1 | Sleep Demon | Eating. Stamina drains all shift, and a ration from the office dispenser tops it up | The whole base |
| 2 | Window Watchers | Hiding. When the glass taps, crouch under the desk, or cut the power and keep away from the glass | The office window |
| 3 | Camera Entity | Stealth. Saved signals must be stored at the server-room console, across the camera's aisle | ServerRoom |

- **The table.** `THREATS_BY_NIGHT` maps a night to its threat keys. There is one threat a night (decision D1). To make them cumulative, list the earlier nights' keys too.
- **The director polls.** Each frame it compares the controller's state and night with the last frame's:
  - a night starting (sleep, a retry, `N`, a scene rebuild) stops everything and starts that night's threats fresh;
  - any state but `playing` stops them;
  - `playing` updates them.
- **Threats are plain classes, not Components.** Only the director ticks them. So they never run in the morning, behind the failed-night prompt, or while the fly camera has frozen the player.
- **The rules are pure.** Each threat keeps its rules in a `*Logic` class that takes injected functions (`canSee`, `isSeen`, `lookAngle`, `rand`), so they are tested without physics, a camera or a DOM. The `Threat` subclass maps them onto the scene through its `ctx`: the engine, player, rooms, transitions, HUD, stamina, audio and lights.
- **The fail path.** A threat calls `kill(reason)`, which runs `GameController.fail(reason)`. The state goes to `gameOver`, the HUD shows the reason and "[E] to retry", and `retryNight()` replays the same night.
- **Monsters are not physics.** Each figure is a hidden, body-less `GameObject` under the scene's `Threats` group. The figures are procedural placeholders (`MonsterFigure`, decision D3). To use a real model, replace what `createMonsterFigure` returns.
- **Rooms expose places, not rules.** The places are:
  - `MainOffice.underDesk`: the kneehole, as a `SightlineZone`;
  - `MainOffice.threatAnchors`: `windowGlass`, and the Sleep Demon's spots;
  - `LivingQuarters.threatAnchors.corridorEnd`;
  - `ServerRoom.sightline` (the aisle), `ServerRoom.securityCamera` and `ServerRoom.storageConsole`.

  Coordinates are room-local, read through the room's transform.

How each one plays:

- **Sleep Demon.** Six bands of stamina map to six stages: 0 (nowhere), then outside the office window, the quarters' corridor end, the office's left doorway, the corner behind the desk, and 1.5 m behind the player.
  - It moves one stage at a time, and only while neither its spot nor the next is in view.
  - Eating backs it off the same way.
  - The night ends when stamina runs out, or after a grace at stage 5.
  - **Stamina** is a minimal seed; the full system is Hayden's.
    - `StaminaDrain` drains it through the shift and fills it each night.
    - The `RationDispenser` (`MainOffice.rationDispenser`) restores 0.35 with a 40 s cooldown.
    - Below 0.5 the base's lights dim, through BaseLights' `fatigue` factor.
- **Window Watchers.** About six visits a night.
  - A glass tap marks its arrival, followed by a short grace.
  - While it peers in, a player in the office whose eye isn't in `underDesk` is seen, and the night ends.
  - Staring at it on the way in (within 10° for 1.5 s) brings it straight to the glass.
  - With the power cut (`BaseLights.dark`), it only sees a player within 2 m of the glass (decision D4).
- **Camera Entity.** The rig sweeps between its yaw limits.
  - Exposure rises while your eye is in the aisle, inside the view cone and not behind a rack (a ray from the lens), and decays otherwise.
  - At 0.6 exposure it stops sweeping and follows you; at 1 the night fails.
  - Night 3 also turns on signal storage (decision D2). The terminal holds saved signals as `pending` until they are stored at the console, and only stored signals count toward the quota.

### Power and lights

- **`BaseLights` is the only writer of interior light levels.**
  - Rooms build their lights at full brightness and list them, with their glowing fixtures, in `room.lights`.
  - `BaseScene._addPower` registers every room's and corridor's lights.
  - Each system that dims the base owns one named factor (`power`, `fatigue`). Every light shows its base intensity × all the factors, so a power cut and a tired player compose instead of fighting over one number.
  - `dark` means the level is below 0.25.
- **What BaseLights does not touch.** `Daylight` owns the ambient light, the moon and the fog. `LEDStrip` owns the rack LEDs. The airlock beacon runs on its own battery. None of those are registered.
- **`Power`.** The generator's lever outside (`GeneratorSwitch`) toggles it. A cut:
  - stutters the lights down to an 8% emergency glow over 0.6 s;
  - throws the player off the terminal (`setPowered(false)`);
  - parks the dish (`satellite.powered`);
  - plays `sfx:power-cut`.

  The airlock keeps cycling, so a cut can never shut you outside. A new night, and a retry, turn the power back on.

### The CRT shader

`src/shaders/CrtScreen.js` draws the terminal monitor's picture: a green radar on a curved tube. With the sky's `uDawn`, it is the custom shader to walk through.

- **The mesh.** A `ShaderMaterial` on a thin plane over the retro computer's glass. `BaseScene._addCrtScreen` places it with `RETRO_COMPUTER_SCREEN`, which was measured from the `.glb`'s vertices.
- **The vertex shader** bows the plane's middle out like curved glass. The `bulge` is compiled in.
- **The fragment shader** draws the sweep and its afterglow, the scanlines, the static and a lock ring.
- **Four state-driven uniforms:**
  - `uTime` turns the sweep and reshuffles the static.
  - `uSignal` is the dish's scan progress. As it rises the afterglow shortens and the lock ring closes.
  - `uNoise` is the static: some while idle, almost none mid-scan, and all of it while the power stutters or a Watcher peers in.
  - `uPower` is the tube's supply. As it drops, the picture squashes to a line and goes black.
- **The `CrtScreen` component** writes them each frame into the material's existing uniform objects. Nothing is allocated.
- **Lighting.** It is unlit on purpose and skips the fog, but keeps three's tone mapping and colour space, like the sky.

### Oxygen

- **`Oxygen` is pure state.** The tank goes from 1 to 0 over 90 s spent outside, and refills in 3 s in the pressurised airlock.
- **`OxygenSupply`** runs on `GameplaySystems`:
  - with the suit on and outside, the tank drains;
  - below 25%, the helmet beeps every 2 s;
  - an empty tank ends the night.

  The HUD gauge shows while the suit is worn. Outside the shift it holds still, and each night it starts full.
- **What "outside" means.** `RoomTransitionSystem` reports `null` for a corridor and for outside alike, so "outside" is its own test: the player is inside no room's or corridor's `bounds()`. Those boxes are measured once, at build.

### Sound

`AudioSystem` is on `GameplaySystems`, before the threats. It is `scene.audio`, and `ctx.audio` for threats.

- **Calls:**
  - `play(key, { volume, at, rate })` for a one-shot;
  - `positional(key, object3d)` for a looping emitter that rides an object (silent at level 0, so an idle machine costs nothing);
  - `follow(emitter, { level, rate })` to drive an emitter from the game each frame;
  - `setAmbience(key, channel)` for a looping bed;
  - `setPaused` and `setVolume` for the menus.
- **The browser's rule.** Nothing sounds until the first click or key press. Ambience and emitters asked for before then start at that point; one-shots are dropped.
- **Without Web Audio** (tests, jsdom), every call is a no-op. Tests that check what plays install `src/test/fakeAudio.js`, a recording `AudioContext`, and run the real three.js audio classes on it.
- **What plays:**
  - **Ambience.** A bed channel (`amb:base-interior` indoors, `amb:outside-wind` outside) with the room's own tone over it. The airlock counts as indoors until its hatch opens.
  - **Cues.** `SoundCues` watches state the game already keeps: scan ticks that quicken toward the lock, the lock chirp, the 6 AM chime, the death sting, and the airlock's hiss and clunk.
  - **Machines.** The server racks, the generator (only while powered) and the dish drive (as loud as it is slewing).
  - **Threats.** The demon's breathing, the Watcher's glass tap, and the camera's servo and exposure tone.
- **The files.**
  - The two ambience beds are recordings (`.mp3`).
  - Every `.wav` is synthesised from its recipe in `src/audio/sounds.js` by `node scripts/make-sounds.mjs`. The randomness is seeded, so a rebuild is byte-identical. To change a sound, edit its recipe and re-run the script.
  - Every file peaks at 0.9; the game sets how loud each one plays.
- **The manifest.** Audio entries are `type: 'audio'`, with `amb:` for loops and `sfx:` for one-shots. They are decoded at preload.

### Input system

Centralized on `Engine.input`:
- `keys` — object keyed by `KeyboardEvent.code` (e.g. `KeyW`, `Space`)
- `mouse` — `{ dx, dy }` accumulated deltas, consumed each frame
- `locked` — boolean, pointer-lock active

`Engine.keyBinds` maps action names to codes, including the debug keys (`debugFly`, `fullbright`). Toggle-style debug actions get their own edge-triggered `keydown` listener — `input.keys` is level-triggered and can't express "on the press".

## Debug tooling

Three toggles, all edge-triggered and free while off:

| Key | Tool | What it does |
|---|---|---|
| `` ` `` | `PhysicsDebug` | Rapier collider wireframes over the scene |
| `V` | `DebugCamera` | Free-fly noclip camera |
| `B` | `Fullbright` | Unlit lighting — everything at albedo brightness |
| `N` | `NightManager` (BaseScene) | Advance to the next night; wraps back to night 1 after the last. Interior doors are open every night — nights bring threats, not keys |
| `I` | `PerfStats` | FPS (average and worst frame), draw calls and triangles (shadow passes included), loaded geometries/textures |

**DebugCamera (`engine.debugCamera`)** — detaches the camera from the player onto the scene root at its current world pose and sets `enabled = false` on every player component, so movement, look and interaction freeze mid-stride and the physics body stays put. `ThreatDirector` holds the threats while it's on, so nothing hunts a frozen player; the clock, sky, dish, lights and sound keep running. `Engine.loadScene` lands it before switching scenes, so a new scene always starts in first person. WASD flies along the view direction (forward includes pitch — look down to descend), Space rises, C sinks, Shift boosts; the mouse steers the same YXZ rig as the player. No rigid body, collider or raycast is involved — that's what makes it noclip. Toggling back re-mounts the camera on the player with a zeroed local transform: the player never moved, so the view returns to their eyes. Two rules when extending it: never give it physics, and never write `camera.position` outside `update()`/`disable()` — the first-person controller owns that transform otherwise.

**Fullbright (`engine.fullbright`)** — three things have to die for a scene to stop being dark: every light is hidden (remembering which were already off), fog is nulled, and tone mapping is switched to `NoToneMapping`. Hiding lights alone isn't enough — a lit material with no light renders black, not bright — so every `MeshStandard/Physical/Phong/Lambert` material is swapped for a `MeshBasicMaterial` twin carrying the same map and colour. Twins are cached per original material (shared materials stay shared) and disposed the moment the mode is toggled off, so the asset-cache ownership rule holds and memory stays flat. Unlit materials (Basic, Shader) are left alone. Meshes spawned while the mode is on are picked up by `fullbright.refresh()` — `Engine.spawnModel` already calls it.

## Assets

### Adding one

1. Drop the file in `public/assets/` — lowercase, hyphen-separated, `.glb` for models.
2. Add a key to [`src/assets/manifest.js`](src/assets/manifest.js). The `url` is relative to `public/`, so `public/assets/models/desk.glb` → `'assets/models/desk.glb'`.
3. Use it: `engine.spawnModel('model:desk', { position: [0, 0, -3] })`, or `engine.assets.get('tex:foo')` for a texture.

No path is ever hard-coded outside the manifest. The one exception is the eight signal images (`assets/signals/signal-N.png`): the review panel sets them as an `<img>` source, so the scenes build their paths rather than preloading them. `validateManifest()` runs in dev and warns about the two mistakes that only fail after upload: absolute paths and capital letters.

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
- [x] No absolute paths (`/…`) in code. Verified 2026-09-30 on `feat/threats-nights-and-polish`: after `npm run build`, `grep -rn 'src="/\|href="/' dist/index.html` prints nothing, neither the source (outside tests) nor the bundle has a `'/assets/…'` string, and `validateManifest()` reports no absolute urls
- [x] Asset filenames match case exactly. Verified the same day: `manifest.test.js` compares the manifest urls with the real listing of `public/`, both ways ("every file is a manifest url", "a file for every manifest url, spelt with the same case"), and all 71 paths (manifest + signal images) were found in the built `dist/` with the same case
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

### What the base already does

Readings and the remaining plan are in `docs/PERFORMANCE-PLAN.md`.

- **Shadows are drawn on demand.**
  - Two lights cast shadows: the office ceiling light and the moon. The ceiling light is a PointLight, so its shadow is a six-face cube map.
  - `ShadowRefresh` turns their `shadow.autoUpdate` off. It redraws a shadow only when a watched caster moves, turns, or shows or hides: the monsters, the door panels, the dish and the security camera.
  - The moon's own turning is flagged by `Daylight`.
  - This is per light, not the renderer's global `shadowMap.autoUpdate`.
  - Anything new that moves and casts a shadow goes in `BaseScene._addShadowRefresh`. A prop added at run time calls `shadowRefresh.flag()`.
- **Far scenery hides indoors.**
  - The terrain, the rock field and the vegetation belt are listed in `BaseScene.farScenery`.
  - The belt is instanced across the whole valley, so frustum culling never drops it, and from anywhere in the base about 3 M triangles were drawn behind the walls.
  - `_showFarScenery` hides the whole list in a room that can't see out: no window and no hatch, which means the server room and the quarters.
  - Nothing in the list casts a shadow or gives light, so hiding it redraws no shadow map and recompiles no shader.
