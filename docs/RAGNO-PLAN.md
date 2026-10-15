# Ragno — implementation plan

Ragno is a spider-like monster that gets into the base through a side room's
air vent. The security cameras are the main way to deal with it. This plan
covers the model, the walk (procedural, with three's `CCDIKSolver`), the
behaviour, the new cameras and vents, and the order to build it in.
Following AGENTS.md, each phase lists the tests to write first.

**Sides.** The code calls the window side of the building the *back* (−z)
and the airlock/yard side the *front* (+z). To avoid mixing them up, this
plan says **window side** and **yard side**.

**Status: implemented** (branch `feat/ragno`). AGENTS.md's "Ragno (the
camera entity)" section describes what was built; this plan stays as the
record of how it was meant. Where they differ, the code and AGENTS.md win.
Section 8 lists the decisions made after review.

---

## 1. The behaviour

### Outside

1. **Spawn.** He appears out of view at one of four spawn areas: window
   side or yard side, left (quarters) or right (server) end. He always
   heads for the vent at **that** end.
2. **Stare, then dart.** He alternates between two moves until he reaches
   the vent:
   - **Stare:** he stops and turns his head to the nearest camera for a
     moment.
   - **Dart:** he moves like a jumping spider, but without leaving the
     ground: short, very fast bursts (0.3–1 m), sudden stops, the odd
     sidestep.
3. **Camera flash outside.** He flinches briefly, then retreats very fast
   out of that camera's view and despawns.
4. **The window approach (window-side spawns).** His route stays at the
   edge of the window's view from the desk: you only catch him at the
   corner of the glass. If the player looks at him through the window, he
   dashes sideways to the building, behind the wing walls. The office juts
   2 m past the wings, so its own back wall hides him there. He then keeps
   going.
5. **Into the vent.** At the end wall he climbs the sloped berm to the
   vent. When he reaches the duct:
   - the camera watching that vent bursts into static;
   - he goes hidden for `ductSeconds`;
   - muffled thumps move through the side room's ceiling. This is the
     player's warning that he's inside.

### Inside (living quarters or server room)

6. **Emerge.** He climbs out of the interior grille, down the wall, and
   stands staring down the corridor at the doorway.
7. **Camera flash in the room** (camera 1 or 2). He flinches, then runs
   fast back up the wall into the grille. When he reaches the grille the
   camera bursts into static and he despawns.
8. **Aggro.** Either of these sets him on the player:
   - the player enters the corridor leading to his room;
   - `stareTimeout` runs out while he's in the room.

   He screeches and chases the player through the base. At doorways he
   narrows his stance, tall and thin, to fit.
9. **Escape by cutting the power.** Once he's aggroed, the camera flash no
   longer works on him. The player's way out is to run through the airlock,
   go out and cut the generator:
   - **Power off:** the **flashlight** makes him flinch and run back to his
     vent, where he despawns.
   - **Power on:** the flashlight does nothing to him.
10. **He doesn't camp the airlock.** When the player enters the airlock, he
    breaks off the chase and won't wait within `airlockKeepOut` of the
    office's front door. He prowls the base instead. If the player comes
    back in, he resumes the hunt after `returnGrace`. If the player stays
    out longer than `prowlTimeout`, he leaves by his vent.
11. **Caught** (within `catchDistance`): he lunges, the screen cuts to
    black, and `controller.fail(...)` ends the night. `[E]` retries, as
    with the other threats.

### Rules shared with the other threats

- **When he runs.** Only while `playing`. He is never active during a UFO
  visit (`_ufoBusy`, as for the storms). Only one Ragno at a time, with a
  cooldown between visits. Every night start, retry, the 6 AM shift end and
  `onDestroy` clear him.
- **The player outside.** He never attacks out there. A player who comes
  within `outsideSpook` of him with a clear line of sight sends him away,
  as a flash would.

---

## 2. The model and rig (measured)

`public/assets/models/ragno_monster.glb`, 4.1 MB, 3,615 triangles.
**"Ragno (Monster)" by Hobu**, CC-BY-4.0,
https://sketchfab.com/3d-models/ragno-monster-2e1a422e6f0048f98a786ceecac423d7
(from the file's `asset.extras`). It needs an entry in ATTRIBUTIONS.md, and
it comes off the "Downloaded but unattributed" list.

- **Units are already metres.**
  - At rest he is about **1.8 m wide, 1.6 m long and 2.2 m tall**: feet at
    x ±0.91, knee tops about 1.6 m, knee spikes up to 2.19 m.
  - He faces +z.
  - The doors are **1.2 × 2.2 m** and the corridors 2 m wide. He fits a
    corridor as he stands, but not a doorway, so the thin stance is
    required. Phase 1 settles a manifest `scale` (about 0.8 is the guess)
    so the thin stance fits under 2.2 m.
- **Skeleton** (57 joints, one skin):

  | Part | Bones | Notes |
  |---|---|---|
  | Spine / head | `Bone_00` → `Bone.001` … `Bone.003` | Head at `Bone.003_end` |
  | 4 legs, upper | `Bone.005–009`, `.011–015`, `.017–021`, `.023–027` | 5-bone chains from the body up to the knee apex (~1.6 m) |
  | 4 shins | `Bone.010`, `.016`, `.022`, `.028` | **Not attached to the legs**: children of `_rootJoint`, running knee → foot |
  | Knee spikes | `Bone.035–038` | Also not attached, at the knee tops |
  | Front arms | `Bone.004` → `.029–031`, `.032–034` | Two 3-bone chains: twitching palps |
  | Tail / abdomen | `Bone.039` | Unattached |

  The unattached shin and spike bones are where Blender's IK and
  child-of constraints were. Those didn't survive the export.
- **Shipped clip.** `EsqueletoAction` (3.3 s) is a breathing idle. No joint
  moves more than 4°. It plays under everything, through an
  `AnimationMixer`, and the IK overrides the leg bones on top of it.

### How the IK is set up

- **Reattach the loose bones.** At load, each shin is reattached to its
  leg's chain tip, and each spike to its knee, with `Object3D.attach`,
  which keeps world transforms so the skinning is unchanged. Each leg is
  then one chain: hip → … → knee → shin → foot.
- **Add target bones.** `CCDIKSolver` reads its targets from
  `skeleton.bones`, so the four foot targets are new `Bone`s. The skeleton
  is rebuilt with them, using identity inverses, and the mesh is rebound.
- **One IK entry per leg.**
  - **Effector:** the shin's end bone.
  - **Links:** shin, 009, 008, 007, 006, 005.
  - **Settings:** `iteration` 3–5, with `rotationMin` / `rotationMax` per
    link so the knees bend the right way.
- **Risk:** 6-link CCD can make the legs look like noodles. The fallback
  is an analytic two-bone solve: freeze 005–008 in their rest pose as the
  thigh, then aim the knee and the shin. Phase 1 decides which to use
  before anything depends on it.

---

## 3. The walk (procedural gait)

The gait logic is pure (`RagnoGait`), so it can be tested without three.js
or a model.

- **Planted feet.** Each foot stays put on the surface until it is more
  than `stepTrigger` from its home spot. Home is a point fixed under the
  body, pushed forward by the body's velocity.
- **Steps.**
  - **Pairs:** feet step in diagonal pairs (front-left with back-right).
    Never more than two feet are lifted at once.
  - **Arc:** a step travels over `stepSeconds` along an arc `stepHeight`
    high.
  - **Event:** each foot-down emits an event, and that event plays the
    skitter sound.
- **Body.** Its height comes from where the feet are, plus a small bob.
  It leans into acceleration.
- **Speed sets the style.**
  - **Creeping:** long, slow steps.
  - **Darting:** the step time shrinks and the trigger tightens, so the
    feet blur. A dart is the body moving fast, not a jump.
- **Stance** (`stance` 0 → 1, wide → thin): blends the home spots inward
  and the body height upward. It is set from the distance to the nearest
  doorway on the route, so he narrows as he reaches a door and spreads out
  again after it.
- **Surfaces.** The gait works in the body's frame on a surface given by a
  `surface.project(point) → { point, normal }` function. The body lines up
  with the normal, so the same walk covers all of these:

  | Surface | How it's found |
  |---|---|
  | Yard and valley | `terrainHeightAt` |
  | Indoor floors | y = 0, plus a downward Rapier ray, so feet land on furniture |
  | Bunker slope to the outside vent | Worked out from `BUNKER.batter` / `shoulder`. A ray can't be used: the colliders are sheer hulls, not the slope (AGENTS.md "bunker shell") |
  | Room wall under the inside grille | A vertical plane |

- **Arms and tail.** The palps twitch on their own idle noise and reach
  forward during a dart. The tail sways.

---

## 4. Changes to the world

### Two new cameras (7 and 8)

- **Where:** one on each wing's window-side wall, on the roof band, toward
  the outer end. They watch the window-side approach and can pan to look
  along the berm toward the vent.
- **Settings:** `zones: ['yard', 'unseen']`, with the yard cameras' wide
  pan.
- **Map and keys:** the map picks them up through `_cameraMap`. The
  terminal's number keys go up to 9, so 7 and 8 work as they are.

### Vents, one per wing

- **Outside:** a duct intake high on the end wall's slope, near the roof
  band.
- **Inside:** a grille high on the side room's end wall.
- **How they're built:** in code, like the other props, and kept clear of
  the racks and the bunk.
- **Placement is settled by a scene test** (phase 4) rather than by eye.
  Each outside vent, and the last 5 m of every route to it, must be
  visible from at least one outdoor camera at some pan, with nothing solid
  in between. If the test can't pass, cameras 7 and 8 are moved.

### Routes (`RagnoPaths`, pure)

- **Spawn points:** four spawn areas, all out of view.
  - Window-side spawns are beyond the window's view.
  - Yard-side spawns are outside the fence, so he goes round it and never
    crosses the yard.
- **Window-side route:** a path that hugs the edge of the window's view
  from the desk's eye, `windowEdgeMargin` inside it. It uses
  `_officeWindow()` and `throughWindow`, which the dust eyes already use.
- **Indoor route graph:** points for each grille foot, room centre,
  doorway (marked `door`), corridor end, office centre and office doors.
  - **Chase:** he goes straight at the player when the line between them
    is clear, otherwise along the graph.
  - **Furniture:** the graph's paths stay clear of furniture. He has no
    physics body, and his feet step onto whatever is below them.

### Camera terminal

- **Flash info:** expose what the flash is doing (lit, which camera, lens
  position and direction, reach, and whether the picture is live) so
  Ragno can test whether the flash is on him.
  - The test is the cone (`CAMERA_FLASH.angle`), the reach, and a Rapier
    ray from the lens to his body.
  - The ray is needed because the flash light itself shines through walls.
- **`interfere(cameraIndex, seconds)`:** a burst of static on that camera
  without switching away.
  - **Picture:** a new entry into `CameraTransition`, playing the same
    grain and tear as a switch.
  - **Sound:** if that camera isn't on screen, the monitor's speaker
    still gives a faint hiss at the desk. That's the tell he's entered.

---

## 5. Code layout

| File | Kind | What it holds |
|---|---|---|
| `src/gameplay/RagnoLogic.js` | pure | The states and their rules (below), timers, tuning `RAGNO` |
| `src/gameplay/RagnoGait.js` | pure | Foot planting, step timing, stance blend, foot-down events |
| `src/gameplay/RagnoPaths.js` | pure | Spawn points, window-edge route, indoor route graph, next point |
| `src/gameobjects/RagnoFigure.js` | three | Clone, reattach bones, IK + mixer, apply gait / stance / surface, flinch pose, emissive eyes |
| `src/gameplay/Ragno.js` | component | Hooks the logic to the world: flash and flashlight hits, the window glance, where the player is, sounds, static, `fail` |
| `src/gameobjects/WallVent.js` | three | Outside duct intake + inside grille |
| `BaseScene._addRagno`, `_addSecurityCameras` | scene | Cameras 7–8, vents, routes, the component on `GameplaySystems` |
| `devConsole/commands.js` | — | `ragno [spawn <window\|yard> <left\|right>\|aggro\|off]`, `ragno pose wide\|thin` |

**States in `RagnoLogic`:**

```
off ─▶ outside:{stare ⇄ dart} ─▶ climbOut ─▶ duct ─▶ emerge ─▶ watch ─▶ aggro ─▶ chase ─▶ (catch)
            │  ▲ window glance: dashToSide               │ flash        │ airlock: prowl ─▶ chase
            │ flash / spooked                            ▼              │ flashlight + power off
            └──▶ flinch ─▶ retreat ─▶ off           flinch ─▶ fleeToVent ◀┘
                                                            └─▶ climbIn ─▶ off (static)
```

**Starting values for `RAGNO`** (all to be tuned):

| Constant | Value | Meaning |
|---|---|---|
| `nights` | from 2 | Ragno needs the cameras; night 2 opens the server room (to confirm) |
| `chancePerCheck` / `checkSeconds` / `cooldown` | 0.15 / 20 s / 90 s | How often a visit starts |
| `stareSeconds` | 1.5–4 s | The pause looking at a camera, outside |
| `dartDistance` / `dartSpeed` / `dartPause` | 0.3–1 m / 6 m/s / 0.3–1.2 s | The jumping-spider movement |
| `windowEdgeMargin` | 3° | How far inside the window's view the route runs |
| `windowGlance` | 0.4 s within 8° | How long the player must look at him to set off the dash |
| `ductSeconds` | 8–15 s | Hidden in the duct |
| `stareTimeout` | 45–75 s | Watching the hallway before aggro on his own |
| `chaseSpeed` | 4.2 m/s | Below the player's 5 m/s run: a fast player gets away |
| `fleeSpeed` | 7 m/s | Running back to the vent after a flash |
| `flinchSeconds` | 0.4 s | |
| `catchDistance` | 1.1 m | |
| `airlockKeepOut` / `returnGrace` / `prowlTimeout` | 6 m / 4 s / 60 s | Rule 10 |
| `outsideSpook` | 10 m | Rule on the player outside |

---

## 6. Phases (TDD: write the tests first, then the code)

### Phase 0 — Story and asset

- Add Ragno to `docs/STORY.md` under "Entities/threats". It fills the
  "Camera entity" item that was left open there. Ask before editing:
  STORY.md is canon.
- Add the ATTRIBUTIONS.md entry and the manifest key `model:ragno` (no
  `physics`; `scale` comes from phase 1).
- **Tests:**
  - `manifest.test.js`: the key exists, lowercase.
  - `credits` picks it up.

### Phase 1 — Rig check and `RagnoFigure`

- **Tests:**
  - A test that reads the `.glb`'s JSON (as the bake script does) and
    checks:
    - every bone named in `LEG_CHAINS` / `SHINS` / `SPIKES` exists;
    - each shin's root sits at its chain's tip in the rest pose, within
      1 cm.
  - A `RagnoFigure` test on a small hand-built skinned skeleton:
    - reattaching the loose bones keeps every bone's world position;
    - the target bones are in `skeleton.bones`;
    - after a solve, each foot's tip is within 2 cm of a reachable
      target;
    - the knee stays on the outer side.
- **Then:**
  - Pick CCD or the two-bone fallback, by eye, with the console's
    `ragno pose`.
  - Set `scale`.
  - Check the idle clip and the IK together.

### Phase 2 — Gait

- **Tests in `RagnoGait.test.js`:**
  - A planted foot doesn't move while the body moves less than
    `stepTrigger`.
  - Steps go in diagonal pairs, and never more than 2 feet are up at once.
  - A step ends on the surface at its new home spot.
  - Foot-down events fire once per step.
  - Faster bodies take shorter steps.
  - At `stance` 1, every foot and knee is inside the door's half-width
    minus a margin, and the top is under the door height minus a margin.
  - The wide/thin blend is continuous.
- **Then:** hook it up to the figure and walk it round a loop from the
  console.

### Phase 3 — Surfaces and climbing

- **Tests:**
  - `surface.project` on the terrain, the floor, the worked-out berm slope
    (matches `BunkerShell`'s outline) and a wall plane.
  - The body lines up with the normal.
  - Going from ground to slope keeps the feet planted, with no pop.

### Phase 4 — World: vents, cameras 7–8, routes

- **Tests:**
  - `RagnoPaths.test.js`:
    - spawns are out of every window and outdoor-camera view at rest;
    - the window route stays within `windowEdgeMargin` of the window's
      view edge, seen from the desk's eye;
    - yard-side routes never enter the fence's rect;
    - the indoor graph connects each grille to the airlock door.
  - `BaseScene.ragno.test.js`:
    - each vent can be seen from some camera at some pan (the coverage
      test in §4);
    - cameras 7 and 8 keep the lens clear of the walls, as the existing
      pan-limit test does;
    - the indoor graph's paths are clear of colliders at body height;
    - thin stance fits the doorways.

### Phase 5 — Outside behaviour

- **Tests in `RagnoLogic.test.js`:**
  - Stare and dart alternate.
  - The stare faces the nearest camera.
  - A flash hit (lit, live, in the cone, clear ray) → flinch → retreat out
    of that camera's view → off.
  - A flash through a wall doesn't count.
  - A window glance → dash to a point out of the window's view, then the
    route resumes.
  - Reaching the vent → `climbOut` → `duct`, with `interfere` called for
    the camera that sees the vent.
  - The player within `outsideSpook` with a clear view → retreat.

### Phase 6 — Camera terminal hooks

- **Tests:**
  - The flash info matches the light.
  - `interfere` on the camera on screen plays a static burst without
    changing `feed.index`.
  - `interfere` on another camera only hisses.
  - `interfere` while off the monitor is quiet apart from the hiss.

### Phase 7 — Inside behaviour

- **Tests:**
  - Emerge → watch, facing the doorway.
  - A room-camera flash during `watch` → flee to the grille → static →
    off.
  - The player in his corridor → aggro.
  - `stareTimeout` → aggro.
  - In `chase`, the camera flash does nothing.
  - Flashlight with the power on: nothing.
  - Flashlight with the power off (cone, range, clear ray): flinch → flee
    → off.
  - The player in the airlock → prowl, never within `airlockKeepOut` of
    the front door; coming back in → chase after `returnGrace`; staying
    out for `prowlTimeout` → leaves.
  - Within `catchDistance` → `fail`, and the player is locked.

### Phase 8 — Scheduling and reset

- **Tests:**
  - Only from `nights`, at most one at a time, with the cooldown.
  - Never during a UFO visit.
  - A night start, retry or morning clears him.
  - `onDestroy` lets go of everything.
  - The console commands.

### Phase 9 — Sound, looks and cost

- **Sounds:** skitter (per foot-down), screech (aggro), flinch hiss, duct
  thumps, catch. These start as placeholders, as for the Sleep Demon.
- **Fog:** indoors nothing takes fog, but he would. In a storm (fog
  density 0.065) he'd be about 28 % dust-brown at 5 m. He needs two
  material sets, fog on and fog off, swapped at the vent. Both are
  compiled by `compileScene` at build.
- **Shadows:** start with **no shadow casting**, as for the Sleep Demon.
  - Outside, a moving caster redraws the moonlight's whole shadow map
    every frame.
  - If he looks pasted on, add a blob shadow under his body.
- **The head:** the export dropped the head's own nodes, leaving its face,
  hair and eyes at the wrong size and place. They are rebuilt at load
  (`assembleHead`), each bound to the spine's tip, to match the creator's
  thumbnail. That also brings his height down to about 1.6 m.
- **Culling:** a skinned mesh's bounds don't follow its bones. Give it a
  fixed bounding sphere big enough for any pose, rather than
  `frustumCulled = false`.
- **Checks:**
  - Measure with `perf`: him darting in the yard on a camera, and chasing
    in a corridor.
  - Then add the AGENTS.md section.

---

## 7. Open questions at planning time

These were asked before the build. Section 8 has how they were settled.

1. **Nights.** Night 2 onward, or only night 3?
2. **Cameras.** Two new cameras in all, or two per side?
3. **Camera flash during a chase.** Useless once he's aggroed?
4. **After the airlock.** Prowl, resume, leave, as in rule 10?
5. **The death.** A quick lunge and a cut to black, or a staged kill?

## 8. Decisions after review

- **He is the camera entity.** STORY.md's "Camera entity" item now
  describes him.
- **Every night, scaled up:**
  - **Night 1:** once, at midnight. He comes only as far as the vent,
    lingers and goes back. Slower, quieter (45 % of his sounds), meant to
    build tension.
  - **Night 2:** one or two visits.
  - **Night 3:** two to four, more aggressive. Shorter pauses outside, more
    darts, out of the room sooner, a little quicker in the chase.
  - **Timing:** only after dark, from 9 PM; night 1 at midnight.
- **Seen by the player outside** works like the window glance: he darts to
  the side of the building, out of view.
- **Cameras:** two, cameras 7 and 8. They sit on each end wall's roof band
  by the window-side corner, not on the wing's window-side wall: from
  there a camera can't see round the corner to an end-wall vent. A scene
  test checks a camera sees each vent.
- **The death:** a quick lunge into the view, then a red-black cut. The
  loud part of the third attack plays.
- **Sounds:**
  - **Flinch and aggro:** attacks 2 and 4.
  - **The death:** attack 8, its loud part only.
  - **His legs:** the walking clip, at his speed, only indoors.
  - **Outside:** the call's soft chirps under the wind, and rarely a loud
    burst pitched down (the screech).
  - **The duct:** placed at the vent he's in, so it's heard from that side.
    There was no vent recording, so the duct crawl is synthesised as a
    placeholder.
- **Console:** `ragno [window|yard] [left|right]` brings a night-3 Ragno
  from where you say; `ragno off` sends him away.
- **Fog:** instead of building the two material sets at a swap, a hidden
  second clone wears the fog-free set, so the boot compiles it.
- **Culling:** `frustumCulled = false` on his meshes, not a fixed sphere.
  He is 3,600 triangles.
