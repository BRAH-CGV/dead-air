# Room-Based Scene — Implementation Plan

> Branch: `dev/room-based-scene`
> Depends on: `src/core/Scene.js`, `src/core/Engine.js`, `src/core/GameObject.js`, `src/assets/manifest.js`
> Reference: `docs/GENERAL-VISION.md`, `docs/2026-09-09-CGV-meeting-3.md`

---

## 1. Architecture Overview

### 1.1 Design Principles

- **Extensible room registry** — adding a 4th or 5th room means writing one class and registering it. Zero changes to existing rooms.
- **One continuous scene** — all rooms exist in the same `Scene.build()`. Doors are GameObjects with sensor colliders that trigger room transitions. No scene loading.
- **Room isolation** — each room is a self-contained GameObject group. Its walls, floor, ceiling, lighting, props and colliders are children of that group. Teardown is one `removeChild`.
- **Shared ground plane** — one ground collider spans the entire base footprint. Rooms sit on top, not inside separate ground planes.

### 1.2 Scene Graph Structure

```
SceneRoot (GameObject, group)
├── Ground (shared ground plane + collider)
├── Room:MainOffice (GameObject, group)
│   ├── Walls, ceiling, floor
│   ├── Furniture (computer, radar, switchboard, etc.)
│   ├── Lighting (ceiling fixture, desk glow, etc.)
│   └── Door:ToServerRoom (sensor trigger)
├── Room:ServerRoom (GameObject, group)
│   ├── Walls, ceiling, floor
│   ├── Server racks, console
│   ├── Lighting (dim LEDs, flickering)
│   └── Door:ToMainOffice (sensor trigger)
├── Room:GeneratorBay (GameObject, group)
│   ├── Walls, ceiling, floor
│   ├── Generator, breaker panel
│   ├── Lighting (industrial, harsh)
│   └── Door:ToMainOffice (sensor trigger)
├── Outside (GameObject, group)
│   ├── Satellite dish, fence, terrain props
│   └── Lighting (moon, ambient)
├── Corridors (GameObject, group)
│   ├── Corridor:OfficeToServer (walls, floor, ceiling, light)
│   └── Corridor:OfficeToGenerator (walls, floor, ceiling, light)
├── Player (kinematic body, capsule collider)
└── Lighting (global ambient, moon directional)
```

### 1.3 Room Base Class

A new `Room` class (not a `Scene` subclass — a helper used *by* the scene):

```
src/scenes/rooms/
├── Room.js              ← base class: walls/floor/ceiling builder, door slot, lighting hook
├── MainOffice.js        ← extends Room
├── ServerRoom.js        ← extends Room
├── GeneratorBay.js      ← extends Room
└── Corridor.js          ← connects two rooms, has length/width/height
```

`Room` provides:
- `_buildShell(width, depth, height, wallThick, material)` — procedural box walls/floor/ceiling with colliders (reuses `_addStaticBox` pattern from OfficeScene).
- `_addDoorWall(name, wallSide, doorWidth, doorHeight, doorOffset)` — a wall segment with a doorway cut out (same technique as the front wall in OfficeScene).
- `addDoor(name, position, size, targetRoom)` — places a Door GameObject with a sensor collider at the doorway.
- `addLight(position, color, intensity, range)` — helper for PointLight + emissive fixture.
- `buildProps(engine)` — override in each room to spawn models.
- `buildLighting(engine)` — override in each room for room-specific lights.
- `dispose()` — removes all children, frees room-specific materials.

### 1.4 Door & Connectivity System

```
src/gameobjects/Door.js
```

A `Door` is a GameObject subclass with:
- A visual mesh (door panel, or empty frame for open doorways).
- A **sensor collider** (box, thin, at the doorway) — detects player overlap, no collision response.
- `targetRoom` — string name of the room this door leads to.
- `locked` — boolean, controlled by the night progression system.
- `onPlayerEnter()` — called by a `RoomTransitionSystem` component on the player when the sensor fires.

**Night progression** is managed by a `NightManager` component (or a simple state object on the scene):

```js
// Pseudocode
const nightConfig = {
  1: { openRooms: ['MainOffice'] },
  2: { openRooms: ['MainOffice', 'ServerRoom'] },
  3: { openRooms: ['MainOffice', 'ServerRoom', 'GeneratorBay'] },
};
```

Doors check `nightConfig[currentNight].openRooms.includes(targetRoom)` before allowing passage. Locked doors block the player (solid collider) and display a prompt.

### 1.5 Corridor System

Corridors are simple rectangular connectors between rooms. They are not full `Room` instances — just a `Corridor` helper that builds walls/floor/ceiling for a given length and width, with doorways at each end aligned to the rooms they connect.

```js
// Example
const corridor = new Corridor({
  length: 4, width: 2, height: 3, wallThick: 0.2,
  material: wallMaterial,
  doorways: ['both'],  // openings at each end
});
```

### 1.6 Layout Coordinates

All rooms placed in world space. The Main Office is centred at origin (preserving current layout). Rooms branch off via corridors:

```
                    Z+
                    ↑
                    |
    GeneratorBay ← Corridor ← MainOffice → Corridor → ServerRoom
    (-12, 0, 0)              (0, 0, 0)                (12, 0, 0)
                    |
                    Z-
              (Outside / Satellite)
```

Exact coordinates are tunable. The key constraint: corridors must be long enough for the player capsule (0.6 m diameter) to pass comfortably, with wall thickness accounted for.

---

## 2. Phased Implementation (TDD)

Each phase lists the tests to write **before** implementation, following the mandatory TDD workflow.

### Phase 1: Room Base Class & Shell Builder

**Goal:** A `Room` class that can build a walled enclosure with floor and ceiling from parameters.

**Tests to write first** → `src/scenes/rooms/Room.test.js`

| Test | What it verifies |
|---|---|
| `buildShell creates a group with correct child count` | Walls (4) + floor (1) + ceiling (1) = 6 children minimum |
| `buildShell walls have correct dimensions` | Each wall box matches width/depth/height params |
| `buildShell creates colliders for each surface` | Each wall/floor/ceiling GO has `rigidBody` and `colliders` |
| `buildShell with doorway cuts opening in correct wall` | Doorway wall produces 3 segments (left, right, header) instead of 1 |
| `addDoor places a Door GO at the specified position` | Door GameObject exists at correct coordinates |
| `dispose removes all children` | After dispose, group has 0 children |

**Implementation:**
- `src/scenes/rooms/Room.js` — constructor takes `{ width, depth, height, wallThick, material }`.
- `_buildShell()` — creates 4 walls + floor + ceiling as GameObjects with `_addStaticBox` pattern.
- `_addDoorWall(wallSide, doorWidth, doorHeight, doorOffset)` — splits one wall into 3 segments around a doorway.
- `addDoor(name, position, size, targetRoom)` — creates a Door GameObject.
- `dispose()` — removes children from parent.

---

### Phase 2: Corridor Builder

**Goal:** A `Corridor` helper that connects two rooms with a walled passage.

**Tests to write first** → `src/scenes/rooms/Corridor.test.js`

| Test | What it verifies |
|---|---|
| `Corridor creates walls, floor, ceiling` | Child count matches expected (2 walls + floor + ceiling) |
| `Corridor with doorways at both ends has openings` | Each end wall has 3 segments |
| `Corridor dimensions match parameters` | Length, width, height verified |
| `Corridor colliders are static` | All bodies are `fixed` type |

**Implementation:**
- `src/scenes/rooms/Corridor.js` — constructor takes `{ length, width, height, wallThick, material, doorways }`.
- Builds two long walls, floor, ceiling, and optional end walls with doorway cuts.

---

### Phase 3: Door GameObject & Transition System

**Goal:** Doors that detect player entry and can be locked/unlocked.

**Tests to write first** → `src/gameobjects/Door.test.js`

| Test | What it verifies |
|---|---|
| `Door starts unlocked by default` | `door.locked === false` |
| `Door.locked = true sets locked state` | State change works |
| `Door has sensor collider` | Collider desc has `sensor: true` |
| `Door fromObject3D wraps a cloned mesh` | Static factory works like other GameObjects |

**Tests to write first** → `src/components/RoomTransitionSystem.test.js`

| Test | What it verifies |
|---|---|
| `Detects overlap with unlocked door` | System calls `door.onPlayerEnter()` when sensor fires |
| `Blocks passage through locked door` | Locked door keeps solid collider, player can't pass |
| `Locked door shows prompt` | Crosshair/prompt text updates |

**Implementation:**
- `src/gameobjects/Door.js` — extends GameObject. Sensor collider, `locked` state, `targetRoom` reference.
- `src/components/RoomTransitionSystem.js` — Component on Player. Subscribes to door sensor events. On overlap with unlocked door, teleports player to the target room's entry point.

---

### Phase 4: Main Office Room (Refactor from OfficeScene)

**Goal:** Extract the existing OfficeScene room content into a `MainOffice` Room subclass.

**Tests to write first** → `src/scenes/rooms/MainOffice.test.js`

| Test | What it verifies |
|---|---|
| `MainOffice builds with correct room dimensions` | Shell matches 12×10×3 (or updated dimensions) |
| `MainOffice spawns computer, server, radar, switchboard` | Each model GO exists by name |
| `MainOffice has window opening in back wall` | Back wall has 4 segments around window |
| `MainOffice has door opening to server room` | Side wall has doorway cut |
| `MainOffice lighting matches original` | PointLight count and positions match |

**Implementation:**
- `src/scenes/rooms/MainOffice.js` — extends Room. Moves relevant `_add*` methods from OfficeScene.
- Refactor OfficeScene's `_addWalls`, `_addWindow`, `_addOfficeFurniture`, `_addLighting` into MainOffice.
- OfficeScene becomes a thin shell: creates rooms, corridors, connects them, spawns player.

---

### Phase 5: Server Room

**Goal:** A dark, atmospheric room with server racks and a console.

**Tests to write first** → `src/scenes/rooms/ServerRoom.test.js`

| Test | What it verifies |
|---|---|
| `ServerRoom builds shell with door opening` | Doorway exists on the correct wall |
| `ServerRoom spawns server racks` | At least 2 server rack models present |
| `ServerRoom has minimal lighting` | Low-intensity PointLights, no ambient |
| `ServerRoom colliders don't overlap MainOffice` | Bounding boxes are disjoint |

**Implementation:**
- `src/scenes/rooms/ServerRoom.js` — extends Room.
- Smaller room (~6×8×3m). Dark blue/red LED-style lighting.
- Spawns server racks, a console terminal.
- Very low ambient light (0.1 intensity). One or two dim PointLights.

---

### Phase 6: Generator Bay

**Goal:** An industrial room with the generator and breaker panel.

**Tests to write first** → `src/scenes/rooms/GeneratorBay.test.js`

| Test | What it verifies |
|---|---|
| `GeneratorBay builds shell with door opening` | Doorway on correct wall |
| `GeneratorBay spawns generator model` | Generator GO exists |
| `GeneratorBay spawns breaker panel` | Breaker panel GO exists |
| `GeneratorBay has industrial lighting` | Overhead light, harsh colour temperature |

**Implementation:**
- `src/scenes/rooms/GeneratorBay.js` — extends Room.
- Medium room (~6×6×3.5m). Industrial lighting (cool white, 5000K).
- Generator model (large, central), breaker panel on wall.

---

### Phase 7: BaseScene — Orchestrator

**Goal:** A new `BaseScene` extends `Scene` that composes all rooms, corridors, and the player.

**Tests to write first** → `src/scenes/BaseScene.test.js`

| Test | What it verifies |
|---|---|
| `BaseScene creates all three rooms` | MainOffice, ServerRoom, GeneratorBay exist as children of SceneRoot |
| `BaseScene creates corridors connecting rooms` | Corridor GameObjects exist between rooms |
| `BaseScene spawns player` | Player GO exists with rigidBody |
| `BaseScene dispose tears down all rooms` | After dispose, SceneRoot has 0 children, no orphan bodies |
| `BaseScene registers with Engine scene registry` | `engine.getRegisteredSceneNames()` includes 'BaseScene' |

**Integration test** → `src/scenes/BaseScene.integration.test.js`

| Test | What it verifies |
|---|---|
| `loadScene(BaseScene) then loadScene(OfficeScene) doesn't leak bodies` | `engine.world` body count returns to baseline |
| `loadScene(BaseScene) then loadScene(BaseScene) is clean` | No duplicate bodies, no memory climb |
| `Player can walk from MainOffice through door into corridor` | Player position changes room (requires physics step) |

**Implementation:**
- `src/scenes/BaseScene.js` — extends Scene.
- `build()`:
  1. Create SceneRoot group.
  2. Instantiate MainOffice at (0, 0, 0).
  3. Instantiate ServerRoom at (14, 0, 0).
  4. Instantiate GeneratorBay at (-14, 0, 0).
  5. Build corridors between them.
  6. Build shared ground plane.
  7. Add global lighting (ambient + moon).
  8. Build Outside area (satellite, fence).
  9. Spawn player.
- `dispose()`: dispose each room, corridors, ground, player.

---

### Phase 8: Night Progression & Progressive Unlock

**Goal:** Doors lock/unlock based on current night.

**Tests to write first** → `src/systems/NightManager.test.js`

| Test | What it verifies |
|---|---|
| `NightManager starts at night 1` | `currentNight === 1` |
| `NightManager.getOpenRooms(1) returns only MainOffice` | Correct room list |
| `NightManager.getOpenRooms(2) includes ServerRoom` | Correct room list |
| `NightManager.getOpenRooms(3) includes GeneratorBay` | All rooms open |
| `NightManager.advance() increments night` | Night goes up |
| `NightManager emits door state change` | Doors update locked state |

**Implementation:**
- `src/systems/NightManager.js` — simple state machine. Holds `currentNight`, config map, `getOpenRooms()`, `advance()`.
- Wire into BaseScene: after `advance()`, iterate all doors and set `locked` based on config.

---

### Phase 9: Lighting & Atmosphere Per Room

**Goal:** Each room has distinct lighting. Fog density varies. Fullbright works across all rooms.

**Tests to write first** → `src/scenes/rooms/Lighting.test.js`

| Test | What it verifies |
|---|---|
| `MainOffice has warm ceiling light and cool desk glow` | PointLight colours match |
| `ServerRoom has dim lighting only` | Total light intensity below threshold |
| `GeneratorBay has harsh overhead light` | High-intensity PointLight, cool colour |
| `Fullbright toggle swaps materials in all rooms` | No room is left with unswapped materials |

**Implementation:**
- Each room's `buildLighting()` method.
- Fog: `scene.fog` is global, but per-room atmosphere can be simulated with local fog density via light range/attenuation. For true per-room fog, use a `RoomTransitionSystem` hook that adjusts `scene.fog.density` when the player enters a room.
- Fullbright already handles all materials globally via `Fullbright.refresh()` — new rooms just need to be spawned before the refresh call (which `spawnModel` already triggers).

---

### Phase 10: Gameplay Hooks (Stubs)

**Goal:** Placeholder interaction points for future gameplay systems.

**Tests to write first** → `src/gameobjects/GameplayHooks.test.js`

| Test | What it verifies |
|---|---|
| `SignalTerminal has Interactable component` | Component exists on the GO |
| `SignalTerminal fires onInteract` | Callback fires on interaction |
| `BreakerPanel has Interactable component` | Component exists |
| `BreakerPanel toggle changes power state` | State changes on interact |
| `EvilSignal has Interactable + delete action` | Component exists with delete method |

**Implementation:**
- **Signal collection point** — the retro computer in MainOffice gets an `Interactable` component. `onInteract` logs "signal collected" (placeholder).
- **Camera entity sightlines** — a `SightlineZone` component (stub) on a GameObject in ServerRoom. Defines a cone/box volume. Future: checks if player is inside.
- **Evil signal deletion** — the server rack console in ServerRoom gets an `Interactable`. `onInteract` logs "signal deleted" (placeholder).
- **UFO power-cut trigger** — the breaker panel in GeneratorBay gets an `Interactable`. `onInteract` toggles a `powerOn` flag. Future: cuts all lights in all rooms.
- **Stamina corridor constraints** — the corridor between rooms is narrow enough that the player can't linger safely. No explicit mechanic yet, just physical design (2m wide, well-lit).

---

### Phase 11: Physics Collider Strategy

**Collider tier selection per asset type:**

| Asset | Tier | Rationale |
|---|---|---|
| Walls, floor, ceiling | Procedural cuboid | Already built with `_addStaticBox` — perfect fit, zero cost |
| Computer desk (retro-computer) | Tier 3 (manifest primitives) | Needs under-desk gap for hiding mechanic. Use compound boxes for top + legs. |
| Server racks | Tier 1 (`physics: 'static'`) | Simple box is fine. Tall, narrow, solid. |
| Generator | Tier 1 (`physics: 'static'`) | Large box is sufficient. |
| Breaker panel | Tier 1 (`physics: 'static'`) | Wall-mounted box. |
| Doors | Sensor collider (box) | No collision response, overlap detection only |
| Corridor walls | Procedural cuboid | Same as room walls |
| Fence (outside) | Tier 1 (`physics: 'static'`) | Simple box perimeter |
| Props (crates, barrels) | Tier 1 or Tier 2 | Box for simple shapes, UCX for complex |

**Static vs dynamic:**
- All room geometry: **static** (fixed bodies). Never moves.
- Props that are part of the scenery: **static**.
- Pushable crates / interactable objects: **dynamic** (enter `rigidBodyMap` for interpolation).
- Doors: **static** when locked (solid collider), **sensor** when unlocked (no collision response).

**New collision shapes required:**
- **Door sensor** — thin box at each doorway. `ColliderDesc.cuboid(width/2, height/2, 0.05)` with `sensor: true`.
- **Under-desk compound** — when the real desk model arrives, tier 3 primitives for the gap (documented in AGENTS.md already).

---

### Phase 12: Integration Tests & Performance

**Integration tests** → `src/scenes/BaseScene.integration.test.js`

| Test | What it verifies |
|---|---|
| `Full scene build/dispose cycle is clean` | No orphan Object3Ds in scene, no Rapier bodies |
| `Scene switch BaseScene → OfficeScene → BaseScene is stable` | Body count returns to baseline each time |
| `Player spawns inside MainOffice` | Player position is within room bounds |
| `All room colliders are non-overlapping` | No interpenetrating static bodies |
| `Door sensors don't overlap wall colliders` | Sensor is in the doorway gap, not inside a wall |

**Performance budgets:**

| Metric | Target | Rationale |
|---|---|---|
| Frame rate (lab hardware) | ≥ 30 FPS | Course requirement: "acceptable frame rate" |
| Frame rate (dev machine) | ≥ 60 FPS | Comfortable development |
| Draw calls | < 200 | Three rooms + corridors + props |
| Triangle count | < 500k | Browser renderer, integrated graphics |
| Physics bodies | < 100 | All static except player + a few props |
| Memory (GPU) | < 512 MB | Shared geometry/materials via asset cache |
| Scene build time | < 2 seconds | Loading screen should be brief |
| Scene dispose time | < 500 ms | No lag when switching scenes |

**Performance test approach:**
- Not a unit test — profile manually with Chrome DevTools.
- Add a `console.time('BaseScene.build')` / `console.timeEnd` around `build()` to catch regressions.
- Log body count after build: `engine._bodyToGO.size`.
- Log Object3D count: walk the scene graph.

---

## 3. File Structure (New Files)

```
src/
├── scenes/
│   ├── BaseScene.js                    ← new orchestrator scene
│   ├── BaseScene.test.js
│   ├── BaseScene.integration.test.js
│   ├── OfficeScene.js                  ← kept for backwards compat
│   └── rooms/
│       ├── Room.js                     ← base class
│       ├── Room.test.js
│       ├── Corridor.js                 ← corridor connector
│       ├── Corridor.test.js
│       ├── MainOffice.js               ← refactored from OfficeScene
│       ├── MainOffice.test.js
│       ├── ServerRoom.js
│       ├── ServerRoom.test.js
│       ├── GeneratorBay.js
│       └── GeneratorBay.test.js
├── gameobjects/
│   ├── Door.js
│   ├── Door.test.js
│   ├── Satellite.js                    ← existing
│   └── GameplayHooks.test.js
├── components/
│   ├── RoomTransitionSystem.js
│   ├── RoomTransitionSystem.test.js
│   └── ...existing
├── systems/
│   ├── NightManager.js
│   └── NightManager.test.js
└── ...existing
```

---

## 4. Phase Dependency Order

```
Phase 1: Room base class
    ↓
Phase 2: Corridor builder
    ↓
Phase 3: Door & transition system
    ↓
Phase 4: Main Office refactor (proves Room works with real content)
    ↓          ↓
Phase 5:      Phase 6:
Server Room   Generator Bay   (independent of each other)
    ↓          ↓
Phase 7: BaseScene orchestrator (composes all rooms)
    ↓
Phase 8: Night progression
    ↓
Phase 9: Lighting & atmosphere
    ↓
Phase 10: Gameplay hooks
    ↓
Phase 11: Physics collider tuning
    ↓
Phase 12: Integration tests & performance
```

Phases 5 and 6 can be done in parallel. All other phases are sequential.

---

## 5. Manifest Additions (Preview)

New models needed (see companion document for full list):

```js
// Placeholder keys — Bruno to source models
'model:door-interior':     { type: 'model', url: 'assets/models/door-interior.glb',     physics: 'static' },
'model:server-rack-v2':    { type: 'model', url: 'assets/models/server-rack-v2.glb',    physics: 'static' },
'model:server-console':    { type: 'model', url: 'assets/models/server-console.glb',     physics: 'static' },
'model:generator':         { type: 'model', url: 'assets/models/generator.glb',         physics: 'static' },
'model:breaker-panel':     { type: 'model', url: 'assets/models/breaker-panel.glb',     physics: 'static' },
'model:bed-bunk':          { type: 'model', url: 'assets/models/bed-bunk.glb',          physics: 'static' },
'model:vending-machine':   { type: 'model', url: 'assets/models/vending-machine.glb',   physics: 'static' },
'model:locker':            { type: 'model', url: 'assets/models/locker.glb',            physics: 'static' },
'model:pipe-set':          { type: 'model', url: 'assets/models/pipe-set.glb',          physics: 'static' },
'model:fence-section':     { type: 'model', url: 'assets/models/fence-section.glb',     physics: 'static' },
'model:crate-supply':      { type: 'model', url: 'assets/models/crate-supply.glb',      physics: 'dynamic', mass: 8 },
```
