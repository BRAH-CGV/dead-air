# Next Features Plan — Shift Update

> Written 2026-09-27, after the room-based scene (`docs/ROOM-BASED-SCENE-PLAN.md`)
> and the Mars sky/scenery (#29) landed.
> Reference: `docs/GENERAL-VISION.md`, AGENTS.md (TDD is mandatory — every
> phase below lists the tests to write first).

This round fixes what playtesting flagged and gives the game a day/night
structure that makes sense:

1. The player feels tiny.
2. The signal minigame looks good but is far too slow.
3. Doors locked "until night N" feel arbitrary.
4. Nothing in the game tracks the day: the clock runs out and nothing happens.
5. The office is cluttered with props that have no job, and there's no bed.

---

## 1. Story frame (decided)

These answer "why is the game shaped like this?" and every feature below
follows from them.

- **Why work at night: the Sun.** The Sun is by far the loudest radio source
  in the sky, and daytime heating on Mars kicks up dust devils and storms. The
  dish can only hear faint signals after dark and is stowed during the day.
- **The day is safe.** No monsters in daylight. Morning is the relief, like
  in FNAF. The danger comes with the work: listening is what draws them in.
- **The protagonist has a sleep disorder.** The company hires insomniacs for
  night shifts. This is the character hook, and it makes the Sleep Demon
  ambiguous: is it real, or sleep deprivation?
- **Every room earns its place with a mechanic.** No room exists only to look
  at.

| Room | What the player does there |
|---|---|
| Main Office | Signal work (radar, aim the dish, scan, review). Ration dispenser (the vending machine) for stamina. |
| Bedroom (`LivingQuarters`) | Sleep: ends the day and starts the next night. Later: a risky mid-shift nap. |
| Server Room | A signal step (later), and the Camera Entity's territory. |
| Airlock (new) | Put on the EVA suit, the only way outside. |
| Outside | Generator and dish (later: repairs and power). |

No break room: without a mechanic it would just be one more place to keep track of.

---

## 2. Branches

Features are independent where they can be. Where two touch the same
files, the later one is stacked on the earlier one so they merge without
conflicts. **Merge the stacked ones in order.**

| # | Branch | Based on | Feature |
|---|---|---|---|
| F1 | `feat/player-eye-height` | `main` | Player feels full-size |
| F2 | `feat/faster-signal-minigame` | `main` | Minigame speed |
| F3 | `feat/airlock-and-suit` | `main` | Doors always open; Airlock and EVA suit |
| F4 | `feat/day-night-cycle` | F3 | Shift → morning → sleep → next night |
| F5 | `feat/office-bedroom-redesign` | F4 | Office and bedroom set dressing |

One commit per unit of work (usually one test + implementation pair).

---

## F1 — Player eye height

**Problem.** The camera sits at the *centre* of the 1.6 m standing capsule, so
eye level is 0.8 m, about a child's hip height. The desk top (0.72 m) is
almost at eye level, which is why everything reads as oversized.

**Why not scale the capsule 1.5×?** A 2.4 m capsule doesn't fit through
the 2.2 m doorways. What makes you feel tall is where the eyes are, not how
big the collider is.

| | Before | First pass | Now |
|---|---|---|---|
| Standing capsule | 1.6 m | 1.8 m | 1.35 m |
| Standing eye height | 0.8 m | 1.65 m | **1.24 m** (+55%) |
| Crouch capsule | 0.65 m | 0.65 m | 0.65 m (unchanged: must clear the desk's 0.72 m gap) |
| Crouched eye height | 0.33 m | 0.55 m | 0.55 m |

**Revised after play-testing.** The first pass felt far too tall, so
standing is now 3/4 of it. The crouch stays, because it's fitted to the
desk rather than to the player's height.

**Design.** A pure module, `src/components/PlayerBody.js`, holds the numbers
and derives the capsule half-heights and camera offsets from them. This
follows the `ColliderSpec.js` pattern: the maths can be tested without
Rapier (see BUG-003). `Engine.buildPlayer` and `FirstPersonController` read
their numbers from it. The controller puts the camera at the eye offset
above the capsule centre. It also keeps the eye's world height continuous
across crouch swaps, so crouching glides down instead of snapping.

**Tests first**
- `PlayerBody.test.js`
  - standing capsule is 1.35 m tip to tip; eye is 1.24 m above the feet
  - crouch capsule is below the desk's 0.72 m gap
  - eye offsets are measured from each capsule's centre (stand: 0.565, crouch: 0.225)
  - the standing player fits under a 2.2 m doorway
- `FirstPersonController.eye.test.js` (mocked Rapier)
  - at rest standing, `camera.position.y` is the standing eye offset
  - a grounded crouch swap leaves the camera's world height unchanged on the
    swap frame, then eases it to the crouched eye height
  - standing back up eases the camera to the standing eye height

---

## F2 — Faster signal minigame

**Problem.** The dish's top speed is `π/64` rad/s (2.8°/s). A half turn
takes **64 s** however fast the cursor moves. The cursor itself takes 4 s to
cross the radar.

| Tunable | Before | After |
|---|---|---|
| `Satellite.maxRotationSpeed` | π/64 (2.8°/s) | π/5 (36°/s) |
| `Satellite.angularAccel` | 2 | raised with the damping so the dish still settles without oscillating |
| `CURSOR_RATE` (radar radius per s) | 1/4 | 1/2 (first pass: 1/1.25) |
| `SignalTarget` default `scanTime` | 3 s | 2.5 s |

**Target:** any signal on the radar is aimed at and scanned in under ~8 s.

**Revised after play-testing.** At 1/1.25 the cursor swept 72°/s of sky
while the dish turns at most 45°/s, so the dish fell further behind the
longer a key was held. The cursor now crosses the 90° radius in 2 s, the
dish's own pace: it trails by a steady ~18° while moving and is on target
about 0.3 s after you let go.

**Tests first**
- `Satellite.test.js`: a 180° yaw slew settles within 6 s of simulated
  time; the dish comes to rest within the default signal tolerance without
  swinging back out of it (no oscillation).
- `ComputerTerminal.test.js`: holding a direction moves the cursor from the
  centre to the rim in 2 s; after that sweep the real dish is on target
  within 0.5 s of letting go.
- `SignalTarget`/`SignalManager` test: default scan time is 2.5 s.

---

## F3 — Airlock and EVA suit

**Problem.** Locking interior doors until a given night is arbitrary. Only the
outside should be gated, and on Mars the reason is obvious: you need a suit.

**Design**
- `NightManager` becomes a plain night counter (`currentNight`, `maxNight`,
  `advance`, `setNight`, `onChange`). The per-night room table and
  `applyTo` go. Interior doors are never locked.
- **Airlock**, a new small room (≈ 2.4 × 3 m) built onto the office's front
  door. It is a `Corridor` along Z with its inner end open against the
  office wall (so no two walls overlap) and a doorway at the outer end.
  `Corridor` gains per-end `ends` (`['open', 'doorway']`).
- **EVA suit**: `EVASuit` component on the player (`worn`, `putOn()`,
  `takeOff()`, `onChange`). A **suit locker** in the airlock toggles it
  (`[E] Put on EVA suit` / `[E] Take off EVA suit`). Stand-in: the
  existing `model:locker`, until a suit model is sourced.
- The airlock's **outer door** is locked unless the suit is worn. Its prompt
  says why: "Sealed — put on the EVA suit".
- HUD shows `EVA SUIT` while it's worn.

**Tests first**
- `NightManager.test.js`: counts nights, `advance` stops at the last,
  `setNight`/`onChange` as before; no room/door API remains.
- `Corridor.test.js`: `ends: ['open', 'doorway']` builds an end wall only
  at the doorway end.
- `EVASuit.test.js`: starts off; `putOn`/`takeOff` flip `worn` and notify.
- `Airlock.test.js`: shell sits flush against the office's front wall,
  lined up with its doorway; the outer door is locked by default with the
  suit prompt; the suit locker's interactable toggles the suit.
- `BaseScene.test.js`: every interior door is unlocked on every night; the
  outer airlock door follows the suit; the airlock is in the rooms that
  `RoomTransitionSystem` tracks.

---

## F4 — Day/night cycle

**What exists.** `NightClock` runs 12:00 AM → 6:00 AM over 300 s and the
HUD shows it in the top-right. At 6 AM, `GameController` flips to
`nightComplete` or `gameOver` and prints `[E] to continue` / `[E] to retry`,
but **nothing listens for either**, so the game stalls. The sky never changes.

**Design:** shift → morning → sleep → next night.
- **Shift end (6 AM).** Quota met: the state becomes `morning`, the prompt
  says "Shift over — get some sleep (bedroom)". Quota missed: `gameOver`
  with a working retry key that resets the clock and signals.
- **Sleeping.** The bed's interactable is live only in the morning. It
  fades the screen, advances `NightManager`, and starts the next night at
  12:00 AM. After the last night, sleeping ends the run (the credits screen
  hooks in here later).
- **Dawn.** A pure `dawnFactor(hour, state)` rises from 0 over the last
  in-game hour, and holds at 1 all morning. A `Daylight` component applies
  it: ambient and moon intensity rise, the sky dome shifts toward the
  butterscotch Martian day, and the horizon glows blue at sunrise (real
  Martian twilight is blue). This is a **state-driven shader uniform**,
  which the Shaders category asks for.
- **In-world wall clock** in the office: a face plus hour and minute hands,
  driven from `NightClock`. The time is readable without the HUD.

**Tests first**
- `GameController.test.js`: quota met at 6 AM → `morning`; missed →
  `gameOver`; `retryNight` restarts the clock and signals;
  `sleep()` only works in the morning, advances the night and restarts the
  clock; sleeping after the last night → `finished`.
- `Daylight.test.js`: `dawnFactor` is 0 at 3 AM, rises through 5–6 AM, 1 in
  the morning; applying it raises the light intensities and moves the sky
  uniforms.
- `WallClock.test.js`: hand angles for 12:00, 3:00 and 4:30.
- `BaseScene.test.js`: the bed triggers sleep; the night number stays in
  sync across `NightManager`, `GameController` and the HUD.

---

## F5 — Office and bedroom redesign

**Office.** Keep the desk. Remove the props with no job: the three security
cameras, server rack, radar terminal and switchboard. Dress it by purpose:

| Zone | Contents |
|---|---|
| Back wall (window) | Computer desk, `metal-chair`, wall clock (F4), `wall-screen` |
| Left wall | Vending machine as the ration dispenser (stamina hook for Hayden) and `trash-bin` |
| Right wall | `shelf`, `fire-extinguisher`, `poster` |
| Front wall | Doors to the airlock and corridors |

**Bedroom** (`LivingQuarters`). Real models replace the grey boxes:
`bunk-bed` (with the F4 sleep interactable), a row of `locker`s,
`simple-desk` and `metal-chair`. The vending machine moves out.

Exact positions are a first pass. Tune them with the level editor (F2)
and the collider overlay (`` ` ``).

**Tests first**
- `MainOffice.test.js`: no `SecurityCamera_*`, `ServerRack`,
  `RadarTerminal` or `Switchboard`; has `ComputerDesk`, `VendingMachine`
  (with an interactable), `DeskChair`, `WallClock`; props stay inside the
  room and clear the doorways.
- `LivingQuarters.test.js`: the bed is the real model with the sleep
  interactable; no vending machine; no placeholder boxes left.

**As built** (where it differs from the above)
- The ration dispenser is procedural: `vending-machine.glb` turned out to be
  a broken 5 cm fragment. It is a box with a lit screen, a button and a
  hatch, and an `[E] Take a food ration` stub for the stamina system.
- No `wall-screen` in the office: the model is a 2 × 2 bank of monitors,
  not a wall screen.
- The bedroom desk is the existing `model:desk` (11 KB, already
  preloaded), not `simple-desk` (2 MB).
- Two engine fixes came with it. A manifest `scale` used to be dropped by
  `spawnModel`; it is now baked in below the model root. There is also a
  new manifest `origin: 'floor'` for downloads modelled off-centre (see
  AGENTS.md → Assets).

---

## Later (not this round)

In rough priority order, with the owners from the meeting:

1. **Enemies**, one per night: Sleep Demon, Window Entities, Camera Entity.
   This is what makes the 3 nights genuinely distinct levels. *Unassigned.*
2. **Stamina and rations**: hooks into the office dispenser and a mid-shift
   nap in the bedroom. *Hayden.*
3. **Sound**: ambience, dish motors, signal audio, stingers. *Unassigned.*
4. **Menus, settings, credits screen**: the credits screen hooks into the end of
   F4's final night. *Sibonelo.*
5. **Oxygen timer outside**, so going outside has a cost.
6. **Custom shader the whole team can explain**: F4's dawn uniform is a start;
   a CRT/signal-static shader on the terminal screen would be a good second.
7. **Asset hygiene**: `break-panel.glb` and `switchboard.glb` are byte-identical
   (~11 MB each); `public/assets/models` is 113 MB, all of which ships in the
   Moodle zip.
