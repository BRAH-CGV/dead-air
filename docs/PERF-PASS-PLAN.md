# Performance pass (#175)

> The goal: the game runs as well as it can on lab hardware, and **nothing
> changes in game**. Every phase below is either lossless (the same pixels,
> the same sounds) or near-lossless and gated on someone looking at it.
> Ordered by payoff per hour. Each phase lists its tests first, as AGENTS.md
> asks.

## Done on this branch

- **Unused assets deleted.** Every file in `public/` is copied into the
  build, used or not. Gone: `switchboard.glb` (preloaded, 11 MB) and its
  byte-identical twin `break-panel.glb`, `fire-extinguisher.glb` and
  `desk.glb` (both preloaded), `bush`, `barrel`, `server-console`,
  `server-rack-tall`, `door-interior`, `wall-light`, `wall-screen`, and the
  Boiled One source the Sleep Demon was baked from.
- **Credits.** The retro computer, the industrial terminal and the security
  camera now have full entries; the TODO and "unattributed" lists are gone.
- **Guard.** `manifest.test.js` fails on any file under `public/assets`
  the manifest doesn't name, and on any entry whose file is missing.
- **Phase 1, 2 and 3: `scripts/slim-models.mjs`** (budgets and checks in
  `src/assets/models.test.js`), over every model but `cj` and the
  security camera:
  - specular-glossiness materials dropped: the trees' and the fence's
    images, ~5 MB three never decoded;
  - the desk's transmission map dropped (transmission is off in the
    manifest; WarmUp still uploaded it: ~5.6 MB of GPU memory);
  - flat-colour textures folded into their factors (the globe's stand);
  - every PNG to lossless WebP, each checked pixel for pixel first;
  - the UFO's textures to 512 (it is never nearer than 35 m);
  - radar terminal 12.6 k → 5.1 k triangles, dish tower 14.3 k → 9.3 k,
    storage rack 6.4 k → 3.2 k, within 0.02 % of each one's size. The
    coffee machine (every vertex a seam) and the scrub tree (all open
    pieces) don't simplify at that bound, so they were left alone.
- **Phase 4: the vegetation in wedges.** `CHUNK_TRIANGLES` in BaseScene,
  `groundChunk` in Sightlines. Measured on the belt (stand-in trees of the
  real triangle counts, three's own sphere-in-frustum test, five views
  from the desk and the yard): from 2.8 M triangles submitted to about
  1.45 M, for about 30 more draw calls.
- **Found on the way:** every split of the grass (the occlusion sort's,
  long before this) handed each part the first blades' sway phases. Split
  parts now carry their own per-instance values.

- **Draw calls.** Measured in game (`drawcalls`): 449 from the quarters'
  corridor looking into the office, all main pass, the server room and the
  airlock drawn through the walls. Now:
  - portal culling: another room is drawn only where a doorway shows it;
  - static pieces baked into one mesh each: the wall clock's marks (12 → 1),
    each drive box's slot markers (8 → 1), each vent hood (14 → 3) and
    grille (10 → 3), each camera pole (4 → 1), each rack's trim (4 → 1).
  - the drives instanced: 64 draw calls for the shelf's 32 drives → 2.
- **Measured in game** (`drawcalls`, before the drives): the corridor view
  449 → 378 with the merges → 315 with portal culling; the worst spot
  standing still 341 → 287.
- **Tools.** `perf` counts the whole frame (it showed whichever render came
  last, often the security feed's), and `drawcalls` breaks one down.

`public/assets` went from 116 MB to 59 MB.

### For Ryan to look at

Nothing above should look different; these are the places to check, at
the Phase 0 spots:

- The UFO up close in its beam (512 textures).
- The two server-room consoles leaned in, the dish from the desk, the
  bedroom's storage racks (simplified).
- The grass sways as before, with each blade on its own phase (it was
  sharing phases between split parts before).
- Draw calls in `perf` rise by about 30 outside; triangles should fall
  by about half. If a lab machine is CPU bound and gets slower, raise
  `CHUNK_TRIANGLES` or use fewer sectors in `groundChunk`.

## Still open

- **`cj.glb` and the security-camera model** are left as they are (decided:
  not part of this pass; `LEAVE` in the script).
- **The bed's designer** is still not recorded (CGTrader page).
- **Not done, by choice:** smaller textures on anything the player can walk
  up to (the Phase 2 table below beyond the UFO), and the anisotropy cap.
  Both would change what is on screen up close; only after Phase 0.

## Phase 0 — Baseline (no code)

Nothing is tuned blind. Before any phase lands, and again after it, take
the same numbers on lab hardware (or the weakest laptop the team has), on
mains power, at 1920 × 1080, `devicePixelRatio` 1.

| Where | Numbers |
|---|---|
| Cold start | Time from load to the main menu, DevTools Network, cache off |
| Main menu shot | FPS avg / worst, draw calls, triangles (`perf`) |
| At the desk, looking out the window | same |
| Leaned in to the security monitor | same |
| Server room, bedroom | same |
| The yard, calm and at full storm (`storm`) | same |
| The office under the UFO's beam (`ufo`) | same |
| Night 1 → 2 → 3 by sleeping, then Main menu → New game twice | JS heap and GPU memory (Chrome Task Manager): must not climb |

Keep the table in this file, one column per phase, so every change is
judged against the same spots.

## Phase 1 — Lossless asset slimming

Same pixels, fewer bytes. Lower cold start; no runtime cost change.

**Tests first** (`src/assets/models.test.js`, reading each `.glb` with
`@gltf-transform/core`, already a dev dependency):

- No model in the manifest declares `KHR_materials_pbrSpecularGlossiness`
  (three's loader drops it, so anything inside it is dead bytes).
- No model carries a texture that no material slot three reads.
- `retro-computer.glb` carries no transmission textures.

**Work** (one script, `scripts/slim-models.mjs`, run once and committed):

1. **Strip dead textures.** The tree and fence downloads keep their colour
   maps inside the specular-glossiness extension, which three's
   GLTFLoader never parses: `tree-fantasy` 3.9 MB, `tree-dead` 1.0 MB,
   `chainlink-fence` 74 KB of images nobody decodes. Drop the extension
   and `prune()`. The trees keep their normal maps and look exactly as
   they do now (they already render without those colour maps).
2. **Strip the computer's transmission maps.** The manifest sets
   `transmission: 0` on `retro-computer`, so three never binds them. Its
   nine 1024² maps are 5.5 MB for a 350-triangle model; drop the
   transmission extension and its maps from the file, and keep the
   manifest flag as a belt.
3. **`dedup()` + `prune()` everywhere**, which removes repeated images and
   accessors at no visual cost.
4. **PNG → lossless WebP** for every embedded image
   (`EXT_texture_webp`, which three's loader and Chrome both support).
   Lossless WebP is typically 25–35 % smaller than PNG, pixel-identical.

Check: re-run `npm run build`, compare `dist/` size; screenshots before and
after must be identical, which Ryan checks by eye at the Phase 0 spots.

## Phase 2 — Texture memory (near-lossless)

The biggest runtime lever on integrated GPUs. Every 1024² texture costs
about 5.6 MB of GPU memory once uploaded (RGBA8 with mipmaps), however
small its file is. There are about 65 live 1024² textures across the
placed models, about 360 MB if every one is uploaded. A texture larger
than the screen can ever show is memory and bandwidth for nothing.

**Rule:** size each texture to the most texels the screen can show of that
prop at the nearest the player can stand to it. A 0.5 m bin seen from no
nearer than 1 m covers at most ~500 px on a 1080p screen, so 512² is
already over what it can show.

**Candidates** (largest waste first; each is a judgement call for Ryan):

| Model | Now | Proposed | Why |
|---|---|---|---|
| `light-ceiling` | 4 × 1024² | 256² | Hung at the ceiling as UV fixtures, never closer than ~1.5 m |
| `crate` | 2 × 1024² PNG, 4.2 MB | 512² | 218 triangles; one small prop |
| `trash-bin` | 2 × 1024² | 512² | 0.5 m tall |
| `laptop` | 3 × 1024² | 512² | 0.33 m; the screen is our own canvas, not its texture |
| `ragno` | 9 × 1024² | 512² | Mostly seen through a camera feed or in the dark |
| `ufo` | 3 × 1024² | 512² | Seen 35 m up and further |
| `generator`, `colony-rover` | 4 × 1024² each | keep, or 512² for the AO / roughness maps only | Walked right up to |
| `radar-terminal`, `retro-computer` | 1024² | keep | Leaned in to; the screen fills the view |

**Tests first:** a per-model texture budget in `models.test.js`
(`TEXTURE_BUDGET = { 'model:crate': 512, … }`), failing until the files
are resized.

**Optional knob, measured not assumed:** `AssetManager` raises every
texture to the GPU's maximum anisotropy (usually 16×). Capping it at 8×
is invisible on most surfaces and can help integrated GPUs; try it only
if Phase 0 shows texture sampling bound frames.

## Phase 3 — Geometry (near-lossless)

Simplify with meshoptimizer (`meshoptimizer`, already a dev dependency,
through `@gltf-transform/functions`' `simplify`), with an error bound so
small the silhouette doesn't move. Weld first.

| Model | Triangles | Note |
|---|---|---|
| `coffee-machine` | 41,074 (75,671 vertices) | A 0.5 m prop on a table; target ~10 k |
| `laptop` | 14,450 | 0.33 m; target ~5 k |
| `radar-terminal` | 12,638, drawn twice | target ~6 k |
| `tree-fantasy` | 7,596 per scrub | Instanced across the valley, so every triangle saved is multiplied by the count; the biggest win here |
| `dish-tower` | 14,304 | Seen from the desk; keep unless Phase 0 says otherwise |

**Tests first:** a triangle budget per model beside the texture budget.
**Check:** Ryan compares at the Phase 0 spots; the coffee machine and the
laptop are seen leaned in close, so their error bound is the tightest.

## Phase 4 — Draw cost (measure first)

The frame at the desk was 111 draw calls and 1.69 M triangles, and ~1.35 M
of those are the vegetation. Changes here must not change what is drawn,
only what is skipped.

1. **Chunk the instanced vegetation.** An `InstancedMesh` is culled as one
   bounding sphere, so if any tree of a kind is in view, every tree of that
   kind is drawn. Splitting each kind into a grid of chunks lets three cull
   the chunks behind the camera. Same trees, same places; a few more draw
   calls for far fewer triangles. Test: each chunk's instances lie inside
   its bounding sphere, and the union of chunks is the original placement
   list.
2. **The grass** is the biggest single mesh by its own comment. The same
   chunking applies.
3. **Shadows** are frozen already; seven shadowed lights. Nothing to do
   unless Phase 0 shows shadow passes in the frame.
4. **Pixel ratio** is capped at 2 (`Engine`). On a HiDPI laptop that is
   four times the pixels of a lab monitor. A *Resolution scale* setting
   would be a player's choice, not a change in game; only if Phase 0 shows
   fill-rate bound frames.

## Phase 5 — CPU and memory (profile first)

A scan of every per-frame hook (`onUpdate`, `onLateUpdate`,
`onFixedUpdate`, `update`, `_tick*`) found no allocations: the math
objects are made once, in constructors. So this phase is profile-led.
Record a Chrome Performance trace at the Phase 0 spots, and only fix what
shows. The usual suspects in this code:

- **Rapier rays**: the Sleep Demon's sight rays and Ragno's walkability
  rays, several a frame each. Count them per frame in a trace.
- **`ScreenCanvas` DOM reads**: a re-read every frame means some overlay
  writes its DOM every frame (see "On the screen" in AGENTS.md).
- **Lazy-load `cj.glb`** (1.9 MB, 17 animations) the first time `fly`
  turns on, since nothing else ever shows it. Test: `cj` is not in
  `PRELOAD`, and `fly on` loads it.
- **Decoded audio** is about 250 MB of float PCM, 200 MB of it the six
  ambience and music loops. Ryan owns audio; two options for him, neither
  needed unless memory is short: the three room loops as mono (they
  correlate 0.98–0.999 L/R, so 33 MB saved and barely audible), and
  releasing the menu track once the shift starts.

## Order

Phase 0, then 1 (pure win), then 2 and 3 together (one visual check),
then 4 and 5 only where the numbers point.
