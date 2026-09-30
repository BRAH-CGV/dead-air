# Trailer Shot List

> The trailer is 10% of the mark: at most **2 minutes**, cinematic, showing
> real gameplay, on YouTube. This is a shot list to film from, with each shot
> tied to the grading area it proves. Film in the production build
> (`npm run build`, then `npx serve dist`) on the best machine you have, at
> 1080p.

---

## Before you film

**Two cameras.**

- **First person** is the player's own view.
- **`V`** is the free-fly camera: WASD flies where you look, Space rises, C
  sinks, Shift speeds up. Press `V` again to snap back to the player's eyes.

**The fly camera freezes the threats.** While it's on, the player is frozen,
and so is every monster (so nothing can hunt a frozen player). The clock,
the sky, the dish, the lights and the sounds keep going.

- Fly-camera shots are for places and moods: the base, the valley, the dawn.
- Monster shots are filmed **in first person**. The one exception is a
  deliberate "frozen moment": press `V` mid-scare and drift around the
  monster standing still.

**Clean frames.** No key hides the HUD. For a shot without it, open DevTools
(F12) and run this in the console:

```js
['hud', 'crosshair', 'prompt'].forEach(id => document.getElementById(id)?.style.setProperty('display', 'none'));
```

Reload the page to bring the HUD back. Keep it on for at least one shot,
because the clock, quota and oxygen bar show there's a game here.

**Timing a night.**

- One night is 300 real seconds, 12:00 to 6:00 AM, so an in-game hour lasts
  50 s.
- Dawn plays over the last hour: from about 4 min 10 s into the night.
- `N` jumps to the next night, and wraps back to night 1 after night 3.
- Nights bring the threats: night 1 the sleep demon, night 2 the window
  watchers, night 3 the camera entity.

**Sound on.** Record the game audio. The ambience beds (machinery inside,
wind outside), the glass tap, the airlock's hiss and clunk and the generator
are half the mood.

**Debug views stay out of the trailer.** Don't use `B` (fullbright), `` ` ``
(collider wireframes) or `I` (the performance readout) on camera.

---

## Shots

Times are suggestions that add up to about 1 min 50 s.

| # | Shot | How to get it | Shows | Grading area | Time |
|---|---|---|---|---|---|
| 1 | **Cold open: the valley at night.** A slow push across the valley toward the base, with the stars, the Milky Way and both moons overhead | `V` from outside the hatch; rise, look back at the base, drift toward it | Skybox, fog, terrain and scale | 3D Effects, Viewing | 8 s |
| 2 | **The window.** From outside, looking in at the lit office through the big window; the dish tower beyond | `V`, outside the window | Lighting, shadows, the base as a place | 3D Effects | 5 s |
| 3 | **The job.** Sit at the terminal, open the radar and pick a blip. The dish slews to it outside the window, and the scan fills. The green CRT sweeps and its lock ring closes | First person, night 1, at the computer desk | The core loop; the custom CRT shader, driven by the scan's progress | Shaders, Gameplay | 10 s |
| 4 | **Close on the CRT.** The curved screen, scanlines, static, the sweep's afterglow | First person, lean in; or `V` to within half a metre of the glass | The fragment and vertex shader (the glass bows out) | Shaders | 4 s |
| 5 | **Save or delete.** A signal image comes up; save it | First person | The decision every signal asks for | Gameplay | 4 s |
| 6 | **The sleep demon: look away, look back.** Stare at the office's left doorway, turn to the terminal, turn back: it's in the doorway. Turn away and back again: it's in the corner behind the desk | First person, night 1, with stamina low (don't eat). It only moves while you aren't looking, so this has to be real turns of the head | Tension, and a monster built on where you look | Gameplay, Innovation | 10 s |
| 7 | **"Right behind you."** Turn round; it's 1.5 m behind the chair. Cut to black | First person, stamina nearly out | The scare | Gameplay | 3 s |
| 8 | **The Watcher arrives.** Night 2. A glass tap, then a figure walking up to the office window out of the dark | First person, night 2, facing the window. Staring at it on the way in brings it straight to the glass | Sound as a warning; the Watcher's approach | Gameplay | 6 s |
| 9 | **Hide.** Crouch (`C`) and crawl under the desk. From under it, the Watcher peering in, the CRT fizzing with static above you | First person, under the desk while it peers in (5 s) | Hiding, crouch physics under a real collider, the CRT's static tied to the threat | Control & Playability, Shaders | 8 s |
| 10 | **Frozen moment.** Mid-peer, press `V` and orbit slowly round the Watcher at the glass, the player crouched under the desk inside | First person to `V`, then fly | The scene from outside the player's head | Viewing | 6 s |
| 11 | **Cut the power.** Outside at the generator: pull the lever, and the base's lights die behind you, leaving the emergency lights | First person, suit on, at the generator | Power as a mechanic; lighting changing with state | Gameplay, 3D Effects | 6 s |
| 12 | **The airlock cycle.** Put the suit on at the locker. The inner door shuts, the beacon goes red to amber to green with the hiss, and the hatch opens on the valley | First person, inside the airlock | A real interlock, sound, the suit and the oxygen bar | Control & Playability, Gameplay | 10 s |
| 13 | **Night 3: the camera.** The server room from behind the racks. The camera's faint cone sweeps the aisle; wait for it to pass, then cross to the storage console | First person, night 3, with signals waiting to be stored. Not the fly camera: the sweep freezes under `V` | The cone as a visible, timed danger; moving through cover | Gameplay, 3D Effects | 10 s |
| 14 | **Lock-on.** Step into the cone; it stops sweeping and follows you | First person, stand in the aisle | The "entity" part: the camera hunts you | Gameplay, Innovation | 4 s |
| 15 | **Dawn.** From the dish: the sky turning butterscotch, the stars fading out, the Sun rising in line with the office window | `V`, at the dish, from about 4 min 10 s into a night. The threats are frozen, so it's safe to wait | The day-night sky shader (`uDawn`), the sky turning 15° an hour, the moonlight becoming sunlight | Shaders, 3D Effects | 12 s |
| 16 | **Morning.** Walk to the bunk and sleep; fade to black. "Night 2" | First person, in the morning, quota met | The loop closes; replay | Gameplay | 4 s |
| 17 | **Title card.** *Dead Air*, the team, the course | Edit | — | Trailer | 4 s |

---

## Grading areas the shots cover

| Area | Shots |
|---|---|
| Viewing: 3D scene, animation, camera control, multiple views | 1, 10 (fly camera); every other shot in first person |
| Control & Playability: keyboard and mouse, objectives, physics | 9 (crouch under the desk's collider), 12 (airlock) |
| 3D Effects: lighting, shadows, skybox, textures | 1, 2, 11, 13, 15 |
| Shaders: custom vertex and fragment, time- and state-driven uniforms | 3, 4, 9 (CRT: `uSignal`, `uNoise`, the bowed glass), 15 (sky: `uDawn`, `uSkyRotation`) |
| Gameplay & Experience: theme, sound, tension | 3, 5–9, 11–14, 16 |
| Innovation: original mechanics | 6 (moves only when unseen), 8 (don't look at it), 14 (lock-on) |

The credits screen and the menus are Sibonelo's. If they're ready before
the trailer is cut, a two-second menu shot covers Polish.
