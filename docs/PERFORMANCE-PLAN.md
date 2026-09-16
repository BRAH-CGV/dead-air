# Performance Plan

> Written after a playtest report: **low FPS on boot and while looking
> around the base for the first time.** Ordered by expected impact for that
> specific symptom. Items 1–2 are done; the rest need someone at a keyboard
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

## 3. Next, highest impact: stop re-rendering static shadows

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

- **`transmission > 0` on any material forces a second full scene render,
  every frame that material is visible.** This halved FPS once already
  (`retro_futuristic_computer.glb`, see BUG-TRACKER's Fixed section) and
  is switched off per-asset via the manifest's `material` block. **Check
  every new downloaded model for it.**
- **BUG-007** — the production bundle is over 500 kB because `LevelEditor`
  ships in the main chunk. That's first-load time, not frame rate, but
  it's on the same complaint from players. Fix is lazy `import()` on the
  first F2 press.
