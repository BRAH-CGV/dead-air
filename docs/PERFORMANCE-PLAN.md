# Performance Plan

> Written after a playtest report: **low FPS on boot and while looking
> around the base for the first time.** Ordered by expected impact for that
> specific symptom. Items 1–3 are done; the rest need someone at a keyboard
> with DevTools, because none of it should be tuned blind.

---

## 1. Read the symptom first

Two very different problems get reported as "low FPS", and the fix for one
does nothing for the other:

| What you see | Almost always means |
|---|---|
| Hitches/stutter the **first** time you look at something, smooth afterwards | Shader compilation — WebGL compiles a material's program the first frame it's visible |
| Sustained low frame rate everywhere, no better on a second pass | Draw calls, shadow passes, light count, overdraw |

The report was the first kind ("when I boot up and look around for the
first time"), so that's what §2 targets. If it still feels heavy *after*
the first pass around the base, it's the second kind — go to §4 and
measure before changing anything.

## 2. Done

**Shader pre-compilation** (`Engine.init`). `renderer.compile(scene, camera)`
now runs after the scene is built but before `loadingScreen.hide()`. Every
material's program is compiled while the loading screen still covers the
view, instead of being paid one hitch at a time as each new material first
comes into frame. This is the direct fix for the reported symptom.

**Fewer unique geometries and materials** (`ServerRoom._addRackGlow`). The
rack trim and LED dots were allocating a fresh `BoxGeometry` *and*
`MeshBasicMaterial` per instance — 16 identical slats and 12 identical
dots, so 28 geometries and 28 shader-program variants for what is visually
four copies of the same strip. Trim now shares one geometry and one
material across all four racks; LEDs share geometry. LED *materials* stay
per-instance deliberately: `LEDStrip` writes `emissiveIntensity` per dot,
so sharing would blink every dot on every rack in lockstep.

## 3. Done: static shadows frozen, boot warm-up, airlock occlusion

**Shadows render only when they change** (`ShadowScheduler`, on the Engine
as `engine.shadows`). Per light, not the renderer-wide switch this section
first proposed, because the moon is *not* static: `Daylight` swings it
across the sky all night. Each shadow light gets `shadow.autoUpdate = false`
and is redrawn only when:

- the light has turned more than 0.25° (the moon) or moved (a point light)
  since its map was last drawn;
- a watched caster moved (`shadows.watch(dish, [moon])` — the dish slews);
- something calls `shadows.invalidate()`: an airlock state change (door
  panels), an occlusion zone swap, and every frame while the level editor
  is open (it moves casters nobody is watching).

The office ceiling light is a point light — six passes over the office per
frame — and now renders once.

**The warm-up** (`WarmUp.js`, called from `Engine.init`). Section 2's
`renderer.compile` covered only part of what WebGL does lazily. The loading
screen now stays up through `compileAsync` (parallel compile), an upload of
every texture, and one render with frustum culling off and hidden objects
shown — every geometry buffer and shadow map is on the GPU before the
player sees a frame. Then the game loop runs *under* the loading screen
until 20 frames in a row come in under 50 ms (`FrameSettle`, 5 s cap), and
the game fades in from black (`ScreenFade.fadeIn`).

Measuring the warm-up found the biggest single hitch in the game: **a
20-second freeze on the first frame**, from `PCFSoftShadowMap`. three r185
deprecates it and silently swaps in `PCFShadowMap` on the first shadow
render — after every lit shader had been compiled for PCFSoft — so ~30
programs were re-keyed and recompiled synchronously (ANGLE/D3D11 takes up
to 1.2 s each). The engine now asks for `PCFShadowMap` directly; it is what
was being drawn anyway. Boot to first frame: 28 s → 8 s on the same machine.

**Occlusion through the airlock** (`OcclusionZones`, `Sightlines`,
`AirlockPortal`; built in `BaseScene._buildOcclusion`). Two zones that are
never on screen together:

- `interior` — every room's furnishings except the airlock's. Never the
  shell, the doors, or a light (hiding a light changes the light count
  every lit shader is compiled for — a full recompile).
- `yard` — every outdoor object no window can see. Windows are read off the
  rooms' `openings`; instanced scenery is split along that line.

The building also hides things *from the yard*: low grass and short trees
behind it, below the roof line from every eye position inside the fence
(`hiddenFromRegion`, one occluder box per room and corridor — see
`BaseScene._yardView`). Those join `interior` (drawn only from inside, where
the window sees them); anything neither side can see goes in an `unseen`
zone that is never drawn. A group under 8k triangles stays in the
always-drawn part rather than costing its own draw call. This one is small
— tall trees still show over a 3 m roof — about 120k triangles off the view
of the building from outside, for 3 extra draw calls indoors.

Indoors the only view out is the back window, so the yard is skipped. The
fence now encloses a block in front of the building (the airlock side) and
keeps the player there, where the window can't be seen, so outside the
interior is skipped. The airlock swaps zones the moment a cycle starts —
both doors are shut — and `Airlock.readyFor` holds the door ahead until the
new side is compiled, loaded and drawn for a few frames.

Measured at 1280 × 720 (D3D11):

| View | Everything drawn | Culled |
|---|---|---|
| Inside, facing the front wall | 104 calls, 3.47M tris | 59 calls, 1.68M tris |
| Inside, facing the window | 123 calls, 3.48M tris | 88 calls, 1.69M tris |
| Outside, facing the building | 216 calls, 3.50M tris | 133 calls, 3.36M tris |
| Airlock cycle, worst frame | — | 16.1 ms; hatch opened 45 ms after the 2.5 s cycle |

**When the office is redesigned:** the zones re-derive themselves from the
rooms' openings and contents, but check two things. Anything that should
stay visible from the yard must not be a room furnishing. And a new window
in a wall the yard can see breaks the "outside can't see in" assumption —
the fence block would have to move with it.

## 4. Then measure, before touching anything else

The tools already exist:

- **`I`** — `PerfStats`: FPS (average and worst frame), draw calls,
  triangles (shadow passes included), loaded geometries/textures.
- **`` ` ``** — collider overlay.
- `BaseScene.build()` logs build time plus body and Object3D counts on
  every scene build.

Take readings standing in each room, in a corridor, and outside, and
compare against the budgets from `ROOM-BASED-SCENE-PLAN.md` §3:

| Metric | Target |
|---|---|
| Frame rate (lab hardware) | ≥ 30 FPS |
| Draw calls | < 200 |
| Triangles | < 500k |
| Physics bodies | < 100 |
| Scene build time | < 2 s |

**First readings (after §3):** draw calls are in budget everywhere;
**triangles are not** — 1.7M indoors (looking out of the window) and 3.5M
outside, against 500k. That is the next thing to chase, and the vegetation
belt's tree models are the first suspect (`MarsVegetation` also owns 8 of
the 10 largest textures).

Whichever number is actually out of budget picks the next item below. Do
not do all of them speculatively — several trade away code clarity.

## 5. Candidates, if measurement points at them

**Light count (suspect if FPS is low everywhere).** The scene now has
roughly 13 dynamic lights: ambient, moon, moon glow, 2 office, 1 server
status, 4 rack glows, 1 quarters lamp, 2 corridor. Forward rendering costs
every light against every lit fragment. The four rack glows are the newest
and the easiest to cut to two without anyone noticing.

**Draw calls (suspect if the draw-call count is over budget).**
`Room._addStaticBox` allocates a new `BoxGeometry` per wall segment, floor
and ceiling — dozens of separate geometries, many identical in size. Two
options, cheap first:
- share geometries between same-sized boxes (a small cache keyed by size);
- merge each room's static shell with `BufferGeometryUtils.mergeGeometries`.

Merging is the bigger win and the bigger cost: it breaks per-piece disposal
and makes individual walls unselectable in the level editor. Only worth it
if the draw-call number says so.

**Shadow map resolution (cheap fallback if §3 isn't enough).** Moon
2048² → 1024², office ceiling 1024² → 512². Softer edges, a quarter of the
pixels.

**Model textures.** Downloaded `.glb`s routinely ship 4K textures for
props that are 60 cm tall on screen. Worth auditing the asset sizes in
`public/assets/models/` — this affects load time and VRAM more than frame
rate, but it's cheap to check.

## 6. Traps this project has already hit

- **Anything that changes a shader's cache key after the warm-up recompiles
  it, synchronously, on the next frame.** `PCFSoftShadowMap` did it to every
  lit material at once (§3). The same goes for changing the number of
  lights — so hide a light by zeroing its intensity, never `visible = false`
  — and for `shadowMap.type`, `toneMapping`, or a material's `side` /
  `transparent` at runtime.

- **`transmission > 0` on any material forces a second full scene render,
  every frame that material is visible.** This halved FPS once already
  (`retro_futuristic_computer.glb`, see BUG-TRACKER's Fixed section) and
  is switched off per-asset via the manifest's `material` block. **Check
  every new downloaded model for it.**
- **BUG-007** — the production bundle is over 500 kB because `LevelEditor`
  ships in the main chunk. That's first-load time, not frame rate, but
  it's on the same complaint from players. Fix is lazy `import()` on the
  first F2 press.
