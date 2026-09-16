# Room-Based Scene — Implementation Plan

> Branch: `dev/rooms-phase-1` (branched from `dev/room-based-scene`)
> Reference: `docs/GENERAL-VISION.md`, `docs/2026-09-09-CGV-meeting-3.md`
> Status: **All 12 phases done.** Frame-rate/draw-call/triangle budgets (§3, Phase 12) are unverified — no browser/profiling tooling was available in the environment that implemented phases 9–12; check them with Chrome DevTools next time someone's at the keyboard.
> This document describes what was actually built. Where it differs from the
> original plan, the reason is noted.

---

## 1. Architecture

### 1.1 Design principles

- **One continuous scene.** `BaseScene` builds every room at once. Nights don't load anything; they lock and unlock doors.
- **Rooms are self-contained.** Each room's walls, floor, ceiling, doors, lights and props hang under one group GameObject (`room.root`). Adding a room means writing one `Room` subclass.
- **Layout is derived, not hard-coded.** Side-room positions and corridor positions are computed from the rooms' sizes and the office's doorway offsets, so resizing a room or moving a doorway re-flows the layout.
- **One shared ground.** A single ground plane and collider cover the whole base.

### 1.2 Scene graph (as built)

```
SceneRoot (group)
├── Outside (group)
│   ├── Ground            shared plane + collider (mesh 1 cm below y = 0)
│   ├── Satellite         steerable dish tower
│   └── Generator         placeholder box, waiting for generator.glb
├── Corridors (group)
│   ├── Corridor:OfficeToServer
│   └── Corridor:OfficeToQuarters
├── Lighting (group)      ambient, moon (shadows cover the whole base), visible moon
├── Room:MainOffice
│   ├── walls / floor / ceiling (segmented around openings), WindowFrame_*
│   ├── Door:ToOutside, Door:ToServerRoom, Door:ToLivingQuarters
│   ├── CeilingLight, DeskGlow
│   └── ComputerDesk, ServerRack, RadarTerminal, Switchboard, SecurityCamera_*
├── Room:ServerRoom
│   ├── shell, Door:ToMainOffice
│   ├── StatusLEDs (blue), WarningLED (red)
│   └── ServerRack_1..4, ServerConsole
└── Room:LivingQuarters
    ├── shell, Door:ToMainOffice
    ├── CeilingLamp (warm, no shadows)
    └── Bunk, VendingMachine, Locker_1..3 (placeholders), Desk
Player (root object)      FirstPersonController, InteractionSystem, RoomTransitionSystem
```

### 1.3 The three rooms

The original plan's third room was a Generator Bay. We went with **Living Quarters** instead, to match GENERAL-VISION and the meeting notes. The generator lives in the outside area.

| Room | Size (m) | Opens | Contents |
|---|---|---|---|
| MainOffice | 12 × 10 × 3 | Night 1 | Carried over from OfficeScene: back window, computer desk, server rack, radar, switchboard, cameras |
| ServerRoom | 6 × 8 × 3 | Night 2 | Dark walls, 4 racks, console, two dim LED lights only |
| LivingQuarters | 6 × 8 × 3 | Night 3 | Bunk, vending machine (future coffee / stamina), lockers, desk |
| Outside | — | Night 3 | Generator (future power cut), satellite |

### 1.4 Layout (world coordinates)

```
 LivingQuarters ── corridor ── MainOffice ── corridor ── ServerRoom
 (-13.2, 0, 1)     4 m, z=3.5   (0, 0, 0)    4 m, z=3.5  (13.2, 0, 1)
                                   │ front door (x = 2)
                                Outside
```

- The office's side doorways are at z = 3.5, toward the front, so they clear the furniture along the side walls.
- Each corridor runs exactly from the office's outer wall face (x = ±6.1) to the side room's outer wall face.
- Side rooms sit at z = 1 and use `doorOffset: 2.5` so their doorway lands on the corridor line.
- The player spawns at the office floor centre: capsule centre (0, 1, 0), settling onto the floor.

### 1.5 Files

```
src/
├── scenes/
│   ├── BaseScene.js               composes everything; the default scene
│   ├── OfficeScene.js             untouched: the editor depends on its layout
│   └── rooms/
│       ├── Room.js                base class
│       ├── Corridor.js            Room subclass with a passage-shaped shell
│       ├── MainOffice.js
│       ├── ServerRoom.js
│       └── LivingQuarters.js
├── gameobjects/Door.js
├── components/RoomTransitionSystem.js
├── systems/NightManager.js
├── ui/PromptLabel.js              HUD line under the crosshair
└── test/fakeRapier.js             shared test helper (see §4)
```

Every source file has a `.test.js` beside it.

---

## 2. Key APIs

### 2.1 Room

```js
new Room(engine, {
  name, width, depth, height, wallThick = 0.2,
  position = [0, 0, 0],            // world position of the floor centre
  material,                        // caller-owned; omit for a default the room frees
  openings: [{ side: 'back'|'front'|'left'|'right', width, height, offset = 0, sill = 0 }],
});
room.build();                      // returns room.root
```

- **Coordinates** are local to the room: the origin is the floor centre, back is −Z, front is +Z, left is −X, right is +X. `width` and `depth` are measured wall centre to wall centre. Rooms are axis-aligned (no rotation).
- **Openings:** one per wall. A doorway (`sill = 0`) splits the wall into `_A`, `_B` and `_Header` segments; a window (`sill > 0`) adds `_Sill`. An opening that doesn't fit throws.
- **Walls:** front and back walls span the full outer width; side walls fit between them, so no two walls overlap (overlap causes z-fighting). The floor top is flush at y = 0 because the character controller has no autostep.
- **Subclass hooks**, called in this order after the shell is built: `buildDoors()`, `buildLighting()`, `buildProps()`.
- **Helpers for subclasses:**
  - `addDoor(name, side, targetRoom, { locked })` places a `Door` in a doorway.
  - `_spawnProp(key, opts)` spawns a manifest model at room-local `position`. The physics body gets the room offset; the prop is re-parented under the room and removed from `engine._rootObjects`, so it isn't updated twice per frame. Static props only.
  - `_addStaticBox(name, position, size, material)` makes a box with a matching fixed collider.
  - `_addGroup(name)` makes an empty holder, for lights for example.
  - `_own(resource)` registers a geometry or material to free on dispose.
- **Queries:** `containsPoint(p)` (is the point inside the footprint, floor to ceiling) and `bounds()` (outer world box, as a `THREE.Box3`).
- **`dispose({ removeBodies = true })`** frees owned GPU resources and detaches the room. Scene teardown passes `removeBodies: false`, because the Engine drops the whole physics world straight afterwards and removing bodies one by one there is fragile.

### 2.2 Corridor

`new Corridor(engine, { name, length, width = 2, height = 3, axis: 'x'|'z', ends = 'open', position })`

- Ends are **open** by default. A corridor butts against a room's outer wall face and uses the room's doorway, so it needs no end walls of its own (they would z-fight with the room wall).
- The floor and ceiling run exactly `length`.
- `ends: 'doorway'` adds end walls with a centred doorway, for a corridor that doesn't sit flush against a room.

### 2.3 Door and RoomTransitionSystem

- A **Door** has one doorway-sized collider. While unlocked it is a **sensor**, so the player walks through. While locked it is **solid** and a door panel is shown.
- **Change from the plan: doors do not teleport the player.** The base is one continuous scene, so the player walks through the doorway.
- Overlap is tested geometrically with `door.containsPoint()`, not with Rapier events. Rapier doesn't report fixed-vs-kinematic pairs by default, and a point-in-box test can be unit-tested without WASM.
- **`RoomTransitionSystem`** is a component on the Player. It:
  - fires `door.onPlayerEnter` / `onPlayerExit`;
  - shows a locked door's `lockedPrompt` when the player comes within 0.75 m of it;
  - tracks `currentRoom` (null in corridors and outside) and calls `onRoomChange(room, previous)`. Phase 9 hooks into this.
- **`FirstPersonController`** passes `EXCLUDE_SENSORS` to its movement query and both stand-up queries, so sensors never block walking or standing up.

### 2.4 NightManager

```js
DEFAULT_NIGHTS = {
  1: ['MainOffice'],
  2: ['MainOffice', 'ServerRoom'],
  3: ['MainOffice', 'ServerRoom', 'LivingQuarters', 'Outside'],
};
```

- A door is open only when **both** its own room and its target room are open. That locks a corridor at both ends.
- Locked doors get the prompt "Locked — opens night N".
- `advance()` moves to the next night and stops at the last one. `setNight(n)` jumps to a night. `onChange(fn)` notifies with `(night, previous)`.
- `BaseScene` applies the locks on build and again on every night change.
- Until gameplay drives the nights, press **N** (debug key, `keyBinds.nextNight`) to advance. It wraps back to night 1 after night 3.

---

## 3. Phases

| # | Phase | Status | Notes |
|---|---|---|---|
| 1 | Room base class | ✅ Done | Openings are declared up front rather than cut afterwards; windows are supported |
| 2 | Corridor | ✅ Done | Open ends by default |
| 3 | Door + RoomTransitionSystem | ✅ Done | No teleport; geometric overlap; `PromptLabel` HUD; controller excludes sensors |
| 4 | MainOffice | ✅ Done | New room; OfficeScene left untouched rather than hollowed out |
| 5 | ServerRoom | ✅ Done | |
| 6 | ~~Generator Bay~~ LivingQuarters | ✅ Done | Placeholders for bunk, vending machine and lockers |
| 7 | BaseScene | ✅ Done | The default scene; OfficeScene and TestScene stay in the switcher |
| 8 | Night progression | ✅ Done | |
| 9 | Lighting and atmosphere | ✅ Done | Fog only; door trims deferred (see below) |
| 10 | Gameplay hooks | ✅ Done | See below |
| 11 | Collider tuning | ✅ Done | See below |
| 12 | Integration and performance | ✅ Done | Budgets themselves unverified — see below |

### Phase 9: Lighting and atmosphere per room

- Done: `RoomTransitionSystem.onRoomChange` is hooked in `BaseScene._spawnPlayer` and calls `_applyRoomFog`, which sets `scene.fog.density` from a per-room table (`ROOM_FOG_DENSITY`) — dense in ServerRoom (0.05), light in LivingQuarters (0.008), the office/corridor/outside default (0.02) everywhere else, including `room === null`.
- Tests added in `BaseScene.test.js`:
  - fog density changes on entering ServerRoom and LivingQuarters, and returns to the base value back in MainOffice or in a corridor/outside;
  - Fullbright hides every light and swaps every `MeshStandardMaterial` mesh across all three rooms, and restores both on disable.
- Each room's light character (office warm plus cool, server dim, quarters warm) already had tests from phases 4–6; not duplicated here.
- Deferred: door trims for the new doorways. OfficeScene has trims on its front door (`DoorTrim_*`, `OfficeScene.js`); MainOffice/ServerRoom/LivingQuarters doorways have none yet. Purely cosmetic — pick up whenever, not blocking phase 10.
- **Playtest fix:** ServerRoom's 0.05 fog density, combined with its dim lighting, made the room borderline unreadable — indoor fog only needs to be a light depth cue at these room sizes (6-12 m), not the outdoor "can't see the far wall" effect it's normally for. Went 0.028 → 0.035 → settled at 0.03.
- **Playtest addition:** the corridors had no lighting of their own at all — `Corridor` (like `Room`) has a no-op `buildLighting()` by default, and neither `BaseScene` nor `Corridor` overrode it. Added one: a ceiling `PointLight` at the midpoint plus a visible cylinder fixture mesh (same disc-on-the-ceiling look as the room ceiling lights), in `Corridor.buildLighting()`. Bumped from an initial dim pass (3.0 intensity, no fixture) to 6.0 with the fixture after "scarily dark" / "brighter" feedback.

### Phase 10: Gameplay hooks (stubs)

Each hook has an `Interactable` stub, an anonymous subclass instance attached
in the room's `buildProps()` (same pattern as `OfficeScene`'s crates):

| Hook | Where | Stub behaviour |
|---|---|---|
| Signal collection | MainOffice `ComputerDesk` | `onInteract` logs "signal collected" |
| Evil-signal delete | ServerRoom `ServerConsole` | `onInteract` logs "signal deleted" |
| Camera-entity sightline | ServerRoom | `SightlineZone` (`src/gameobjects/SightlineZone.js`) — a box volume with `containsPoint()`, over the rack aisle; not wired to an AI yet |
| Coffee (stamina) | LivingQuarters `VendingMachine` | `onInteract` logs a stub message; `TODO: coordinate with Hayden's stamina system` |
| UFO power cut | Outside `Generator` | `onInteract` toggles `generator.powerOn`; `TODO: cut every room's lights` once the breaker panel moves here |

Along the way, fixed **BUG-006** for room-built statics: `Room._addStaticBox`
and `BaseScene._addStandIn` now register their bodies in `engine._bodyToGO`,
so `InteractionSystem`'s raycast can find `VendingMachine` and `Generator`
(both built as static boxes, not spawned models). Door colliders still
aren't registered — nothing needs them to be yet, so that part of BUG-006
stays open.

**Playtest fix:** the crosshair changed state on hover, but no text ever
appeared — `InteractionSystem` toggled the crosshair's `active` class but
never read `Interactable.promptLabel`. It now shows/hides it on the same
`#prompt` HUD element `RoomTransitionSystem` uses for locked doors (test in
`InteractionSystem.test.js`). They share the DOM element by design (one
`PromptLabel` per id) rather than by coordination — a player standing at a
locked door while also sighting a prop elsewhere would have one system's
prompt clobber the other's. Not expected to come up in the current room
layout, but worth knowing if a room design puts a locked door near an
interactable prop.

### Phase 11: Collider tuning

| Asset | Tier | Why |
|---|---|---|
| Walls, floor, ceiling, corridors | Procedural boxes | Already done |
| Computer desk (`model:retro-computer`) | Tier 3 compound | Done — `src/assets/manifest.js`, AGENTS.md worked example. Carves the kneehole the hiding mechanic needs; `FirstPersonController`'s 0.65 m crouch height already assumed this gap existed |
| Server racks, console, generator, breaker panel | Tier 1 | Already the manifest default (`physics: 'static'`, no `shape`) — nothing to change |
| Placeholders | Procedural boxes | Already true — `Room._addStaticBox` / `BaseScene._addStandIn` |
| Doors | One box, sensor ↔ solid | Already done |

Tests added in `src/assets/manifest.test.js`: `validateManifest(ASSETS)` stays clean, the desk's `shape` resolves to more than one part, a crouch-height point at the desk's centre clears every part (the kneehole), and the desktop surface itself still blocks. Not verified in-browser — no headless-browser tooling available in this environment; worth a look with the physics-debug overlay (`` ` ``) next time someone's at the keyboard.

**Playtest fixes (three rounds):**
1. First cut used a generic table-desk shape (4 corner legs + one back
   panel), copied from a generic worked example without checking it
   against this specific model. Playtesting found you could crawl in from
   the sides and the back, not just the front — because this model isn't a
   table on legs, it's a solid cabinet with an indentation on one face
   only.
2. Replaced with a U-shaped compound (solid back + left + right walls,
   open front) lidded by a full-footprint top slab. Still wrong: the slab
   covered the opening too, so a standing player hit it on approach and
   could only ever crouch-in from right at the edge, not walk up first.
3. Guessing twice from raw mesh data was the actual problem, so the third
   attempt used measurement instead: box primitives placed in the level
   editor (F2) against the rendered model, transform values read off and
   converted into the manifest. Three boxes, no separate lid — see
   AGENTS.md's updated worked example for the exact numbers and the
   metres → native-units conversion. +Z being the open "front" turned out
   to be correct all along; the bug in round 2 was the lid, not direction.

**Playtest addition (ServerRoom, not originally scoped to a phase), five
rounds:**
1. The room read as too dark after the phase-9 lighting pass. First fix:
   each rack got its own faint point light plus a small column of
   independently-blinking LED dots and thin glow-in-the-dark trim rods
   (`ServerRoom.buildProps` → `_addRackGlow`, a reusable `LEDStrip`
   component for the blink timing).
2. Playtesting found the trim rods (2cm thick) were invisible and only the
   LED dots read as "a small glowing dot," not a rack-wide glow. Widened
   the trim into flat slats.
3. Still read as a dot next to a dark rack, not the rack glowing, and the
   room lighting overall was reworked (fog, corridor lights added) to the
   point the racks no longer needed to cast light either. Tried replacing
   the whole per-rack prop approach with a manifest-level material tint
   (`model:server-rack`'s `material: { emissive, emissiveIntensity }`,
   a new option added to `ModelUtils.applyMaterialOptions`/`prepareModel`
   for this) — `_addRackGlow` and `LEDStrip` removed as unused.
4. Wrong call: even at low intensity, tinting the whole model's material
   reads as "the rack is blue," not "the rack is glowing" — emissive is
   additive on the model's own surface, and in a dark room there's nothing
   else to compete with it, so it overpowers the base texture regardless
   of the number chosen. The material option in `ModelUtils.js` is still
   there (tested, reusable for a model where a uniform tint genuinely is
   the goal) — just not applied to this asset.
5. Reverted to a light: `model:server-rack` carries no `material` override
   again — the rack casting light like a source, not its surface being
   recoloured.
6. Final shape: the trim slats and blinking `LEDStrip` from round 1 are
   back too (only the redundant, embedded-in-the-rack point light from
   round 5 was wrong, not the decoration), and the `PointLight` now sits
   right at the LED cluster instead of at the rack's own centre — the
   light source is the visible blinking dots, not a separate invisible
   point elsewhere. Tested in `ServerRoom.test.js` (every rack has a
   light, trim, and a blinking strip, and the light sits within half a
   metre of the first LED).

### Phase 12: Integration and performance

- Done, in `BaseScene.test.js`:
  - **Leak check**, scoped to what's actually testable under BUG-003 (the real Rapier WASM build doesn't load under vitest, so `Engine.js` itself — which imports it directly — can't be exercised end to end here): build → dispose → drop the world and root-object bookkeeping exactly as `Engine._teardownScene` does → build again, and assert the second build ends up with the same body count and root-object count as the first, not more. This is the part of "BaseScene → OfficeScene → BaseScene leaves no leaked bodies or Object3Ds" that's actually at risk — `Engine._teardownScene` unconditionally drops the whole physics world and removes every root Object3D regardless of which Scene subclass was active, so it structurally can't leak Rapier bodies or Object3Ds across a scene swap; what it doesn't cover is a Scene's own GPU resources (geometries/materials it created), which is exactly what `BaseScene`/`Room`'s `_owned` bookkeeping (tested since phase 1–7) is for. `OfficeScene.dispose()` is still a no-op (`// Future: dispose level-specific GPU resources`) — a pre-existing gap, out of scope here since the plan leaves `OfficeScene` untouched.
  - **Door sensors sit in doorway gaps, not inside walls**: for every door in every room, its world-space collider box (rotation-aware — side-wall doors are rotated 90°) doesn't overlap any wall-segment mesh box in that room.
- Done, in `BaseScene.build()`: wraps the whole build in `console.time('BaseScene.build')` / `console.timeEnd`, and logs the physics-body and Object3D counts afterward (`_logBuildStats`). Covered by a `BaseScene.test.js` spy on `console.time`/`log`.
- **Not done: the budgets themselves.** Profiling needs Chrome DevTools against the running game; no headless-browser or profiling tool was available in the environment that did phases 9–12 (same limitation noted in phase 11). The dev server (`npm run dev`) and the in-game `` ` ``/`I` overlays are ready for whoever picks this up next — `I` shows FPS, draw calls and triangles live; the new `console.time`/body-count log fires on every `BaseScene` build.

| Metric | Target | Verified? |
|---|---|---|
| Frame rate, lab hardware | ≥ 30 FPS | Not checked |
| Draw calls | < 200 | Not checked |
| Triangles | < 500k | Not checked |
| Physics bodies | < 100 | Not checked — `console.log` now reports this on every build |
| Scene build time | < 2 s | Not checked — `console.time` now reports this on every build |

---

## 4. Testing notes

- **TDD per AGENTS.md:** write a failing test, confirm it fails for the right reason, then implement.
- The real Rapier WASM build doesn't load under vitest in this repo (a pre-existing issue). New tests use `src/test/fakeRapier.js`:

  ```js
  vi.mock('@dimforge/rapier3d', async () => (await import('../../test/fakeRapier.js')).rapierModule());
  import { makeEngine } from '../../test/fakeRapier.js';
  ```

  It records each body's type and pose and each collider's half-extents and sensor flag, so tests can check that colliders match the geometry. `makeEngine()` stubs `spawnModel` the way the real Engine behaves: the body goes where `position` says, and the object is registered as a root object.
- `FirstPersonController` can't be unit-tested for the same reason. Check door walk-through and crouching inside a doorway by hand.

---

## 5. Open items

- [ ] **Browser check of BaseScene** (it loads by default). Check prop placement, the locked-door prompt, and, after pressing N, walking through a doorway and crouching then standing inside one.
- [x] Make BaseScene the default scene.
- [x] Debug night control: **N** advances the night.
- [ ] Wire nights to gameplay (end of night).
- [ ] Replace placeholders when Bruno's models land: bunk, vending machine, lockers, generator. Each placeholder records its file in `placeholderFor`.
- [ ] Known bugs are tracked in [`docs/BUG-TRACKER.md`](BUG-TRACKER.md).

---

## 6. Models still needed

See `docs/MODEL-ASSET-LIST.md`. For the rooms, the priority models are:
- `door-interior.glb` (currently a procedural panel);
- `generator.glb` and `breaker-panel.glb` (outside);
- `bed-bunk.glb`, `vending-machine.glb` and `locker.glb` (LivingQuarters);
- `server-console.glb` (the ServerRoom currently uses the radar terminal).

The Generator Bay-only items are no longer needed as a separate room, but the generator and breaker panel still are.
