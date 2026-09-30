# Performance Plan

> Written after a playtest report: **low FPS on boot and while looking
> around the base for the first time.** Ordered by expected impact for that
> specific symptom. §2 is done, and §3 was replaced by a per-light version
> (in §2). §4 now holds the first measured readings. What's left needs lab
> hardware, because none of it should be tuned blind.

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

**Shadows drawn only when something moves** (`ShadowRefresh`, wired in
`BaseScene._addShadowRefresh`). This is §3 below, done per light rather than
globally. Each of the two shadow-casting lights (the office ceiling
PointLight, whose shadow is a six-pass cube map, and the moon) has
`shadow.autoUpdate = false`, and gets `shadow.needsUpdate = true` only when:

- a watched caster moves, turns, or shows or hides (the sleep demon, the
  window watchers, every door panel, the dish, and the security camera's
  head); or
- `Daylight` turns the moon light past `MOON_SHADOW_STEP`.

A held frame costs no shadow passes. The global switch §3 describes was
not used, because it would freeze the moon's shadow while the sky turns.
Tested in `ShadowRefresh.test.js`.

**The valley is hidden from rooms that can't see out** (`BaseScene
.farScenery`, `_showFarScenery`). The terrain, the rocks and the vegetation
belt are about 3.4 M triangles that can't be frustum-culled, because each
`InstancedMesh` spans the whole valley. They are now hidden while the player
is in a room with no window and no hatch: the server room and the living
quarters. The office (window), the airlock (hatch), the corridors and
outside still draw them. None of them carries a light or casts a shadow, so
hiding them doesn't change the light count and costs no shader recompile.
Tested in `BaseScene.test.js`, "BaseScene far scenery".

**Only what the game loads ships** (`manifest.test.js`, "what ships in
public/"). Five models nothing loaded moved to `source-assets/`, and an 11 MB
byte-identical copy of the switchboard was deleted. `public/` went from
129 MB to 99 MB. The texture audit found no embedded texture over 1024 px, so
nothing needed resizing.

## 3. Superseded: stop re-rendering static shadows

> Done as `ShadowRefresh`, per light (see §2). The global
> `renderer.shadowMap.autoUpdate` switch below was **not** used: the moon
> light turns with the sky all night, so its shadow can't be frozen for a
> whole night. The door-panel hook this section names is gone as well,
> because interior doors are open every night. Kept for the reasoning.

Two lights cast shadows — the moon (`BaseScene._addLighting`, 2048²) and
the office ceiling light (`MainOffice.buildLighting`, 1024²). Every frame,
the renderer re-renders all shadow-casting geometry from each of those
lights' point of view, **even though neither the lights nor the base ever
move.** That's two extra full geometry passes per frame, forever, for an
image that is identical every time.

The fix is to render each shadow map once and freeze it:

```js
renderer.shadowMap.autoUpdate = false;   // stop the per-frame re-render
renderer.shadowMap.needsUpdate = true;   // ...but do one pass now
```

Set `needsUpdate = true` again whenever shadow-casting geometry actually
changes. In this scene that's exactly one event: a night change, because
`Door.locked` toggles its panel's `visible`. `BaseScene._setupNights`
already has the hook (`this.nights.onChange(...)`).

**Why this isn't already done:** getting it wrong means *no shadows at
all*, and it can't be verified without a browser. It's a five-line change
and should be the first thing anyone with the game open tries.

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

Whichever number is actually out of budget picks the next item below. Do
not do all of them speculatively — several trade away code clarity.

### Readings, 30 Sept 2026

Taken with a throwaway probe page in headless Chrome. It renders with
SwiftShader, a CPU renderer, so **its FPS and timings mean nothing**. Draw
calls, triangles and body counts don't depend on the GPU, so those hold. The
probe stood at eye height in the middle of each room, looking both ways
along its long axis. The "held" figures are for a frame whose shadows are
held; "redrawn" figures are for a frame where both shadow maps are redrawn
(the office light's six cube faces plus the moon).

| Where | Draw calls, held / redrawn | Triangles, held |
|---|---|---|
| Main office, facing the window | 93 / 359 | 3.49 M |
| Main office, facing the door | 84 / 350 | 3.49 M |
| Server room | 59–66 / 325–332 | 45–72 k |
| Living quarters | 38–44 / 304–310 | 46–60 k |
| Corridors, airlock, outside | up to 185 / 451 | ~3.48 M |

- **Physics bodies:** 81, against a budget of 100. ✓
- **Draw calls:** 38–185 on a held frame. ✓ A redrawn frame adds about 266,
  which is why §2's refresh matters. It is rare: a threat or a door moving,
  or the moon turning a step.
- **Triangles:** ✗ Wherever the valley is in view, 3.5 M against a 500 k
  budget. Before far-scenery hiding it was 3.48 M everywhere, the server room
  included.
- **Frame rate and build time:** not measured, because SwiftShader timings
  mean nothing. They need the lab machines.

Where the triangles go (per mesh, instances counted):

| Mesh | Triangles |
|---|---|
| `MarsVegetation > MarsGrass` | 1.30 M |
| `MarsVegetation > MarsTree_tree-fantasy_*` (scrub, 7,596 each) | ~1.06 M |
| `MarsVegetation > MarsTree_tree-birch_*`, `tree-dead_*`, `tree-pine_*` | ~0.56 M |
| `MarsTerrain > MarsTerrainMesh` | 131 k |
| `MarsRocks > *` | ~0.26 M |

**Next, for whoever owns the vegetation (Ryan):**

- The grass's own comment says it stops reading past about 50 m, so give it
  a radius around the base.
- Split each instanced field into spatial chunks, so frustum culling can drop
  the ones behind the camera.
- Swap the 7,596-triangle scrub for a lighter model.

Then read the office window view on the lab hardware at render scale 1 and
0.75 before touching anything else.

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

**Model textures.** Audited (30 Sept 2026): the largest embedded texture in
any shipped `.glb` is 1024², so there is nothing to resize. The biggest
files, all 1024² PNG-textured, are switchboard 10.7 MB (spawned only by the
old `OfficeScene`), tree-fantasy 8.8 MB, barrel 5.4 MB, retro-computer
5.4 MB and fire-extinguisher 4.6 MB. The generator (3.2 MB) is now
preloaded, because the base places it outside.

**Load time and memory from audio.** The two ambience beds are MP3s. Web
Audio decodes each into a full PCM buffer at load: 2 min 15 s and 3 min of
48 kHz stereo come to about 115 MB of float samples, from 5.8 MB of files.
The loading screen stays up until the decode finishes. If the lab machines load slowly or run short of
memory, the first remedy is shorter loops (the beds loop anyway). The next
is streaming the beds through an `<audio>` element, which is not
preloaded.

## 6. Traps this project has already hit

- **`transmission > 0` on any material forces a second full scene render,
  every frame that material is visible.** This halved FPS once already
  (`retro_futuristic_computer.glb`, see BUG-TRACKER's Fixed section) and
  is switched off per-asset via the manifest's `material` block. **Check
  every new downloaded model for it.**
- **BUG-007** — the production bundle is over 500 kB because `LevelEditor`
  ships in the main chunk. That's first-load time, not frame rate, but
  it's on the same complaint from players. Fix is lazy `import()` on the
  first F2 press.
- **`KHR_materials_pbrSpecularGlossiness` isn't supported by three r185.**
  `tree-fantasy`, `tree-dead` and `chainlink-fence` list it as required,
  and keep every colour and texture inside it. So each load logs
  `Unknown extension`, and the materials fall back to glTF's defaults:
  white, fully metallic, no texture. `PerimeterFence` replaces the fence's
  materials outright. `dimmedMaterial` zeroes the trees' metalness, and
  their per-instance tint colours them, but their bark and leaf textures
  never load. Re-export them as metal/roughness if they should be
  textured.
