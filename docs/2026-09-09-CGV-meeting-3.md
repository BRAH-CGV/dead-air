# CGV Meeting 3 — Summary (2026-09-09)

**Duration:** 53:47
**Attendees:** drax9207 (Adrian), mortalnumbnut, haydnrad, thotslayer666 (Bruno), siboneloblessingmaduna

---

## Setting & Theme Decisions

- Game is set on **Mars**, recently terraformed.
- Aesthetic described as **"RetroSaffa"** — retro sci-fi, South African flavour. Desolate, weathered, not clean futuristic.
- Red grass, otherworldly trees, terraformed landscape.
- All assets must be consistent with the retro/terraformed theme. Bruno to source models with this in mind.

## Scene Structure

- **One continuous scene** — not separate levels/scenes. Doors open to new areas each night.
- **3 rooms** agreed upon:
  - Night 1: 1 room open
  - Night 2: 2 rooms open
  - Night 3: all 3 rooms + small outside area
- **Outside area:** small, contains a generator. Fence acts as play boundary. Terrain visible beyond.
- Terrain concept: base sits in a **valley**, player can see the "edge of the world" — small hills on the horizon. Satellite dishes visible in the distance.
- mortalnumbnut to build skybox and basic terrain, leaving a gap in the middle for the base scene.

## Gameplay Mechanics Discussed

### Stamina / Sleep System
- **Stamina bar** on screen (top or side).
- Decreases over time during the night.
- **Coffee** restores stamina (keyboard input or on-screen button).
- Low stamina effects:
  - Lighting gets darker / light becomes more concentrated (smaller radius).
  - **Sleep Demon** teleports closer as stamina drops.
  - Atmosphere becomes more threatening.
- **Audio cues:** yawn sounds as stamina drops, more frequent when critical.
- haydnrad assigned to implement this.

### Sleep Demon Behaviour
- Spawns in the distance (visible on terrain/skybox).
- Gets progressively closer as player's stamina drops.
- Something "creepy happens" when stamina is very low.

## Menus & UI

- **Inspiration:** Voices of the Void's clean, minimal UI (screenshots shared by mortalnumbnut).
- Need: **main menu**, **pause menu**, **settings page**.
- Settings: mouse sensitivity, render distance, keybinds.
- Pause menu should allow access to developer settings (F2 editor toggle, debug hotkeys).
- siboneloblessingmaduna assigned to menus/settings.

## Level Editor Demo

- Adrian demoed the level editor (F2 to open):
  - Move objects with on-screen controls, rotate with R.
  - Glow toggle (emissive + point light).
  - Hide objects (visual hidden, collider stays).
  - Remove colliders independently.
  - Hierarchical selection (select parent group to move entire office).
  - Add primitives (box, cylinder, cone, torus).
  - Delete objects.
  - Save scene as JSON + .js.
  - Switch between scenes (TestScene / OfficeScene).
- Known issue: JSON loading from file doesn't work yet — export JSON/.js and feed to AI to rebuild.
- Cone collider shape not working correctly yet.

## Bugs & Issues Noted

- **Server rack texture flickering** — mortalnumbnut sees multiple overlapping objects on the server rack. Not visible in fullbright. Possibly a lighting/normal issue. Needs investigation.
- **Z-fighting** observed in some areas.
- **Free cam breaks** when switching scenes in the editor.

## Technical Notes

- Crouch uses **C** key (not Ctrl — Ctrl closes browser tabs).
- Fullbright toggle: **B** — useful for working in dark areas.
- Collider overlay: **backtick** key.
- Free cam: **V** key.
- Integration branch should be merged; Hayden's PRs included in it.
- Adrian to close Hayden's individual branches after merge.

## Task Assignments

| Who | Task |
|---|---|
| mortalnumbnut | Skybox + basic terrain (valley, red grass, hills) |
| thotslayer666 (Bruno) | Find more models (retro/terraformed theme), assist with scene |
| haydnrad | Stamina/sleep system functionality |
| siboneloblessingmaduna | Pause menu, main menu, settings (VotV-inspired) |
| drax9207 (Adrian) | Scene design (3 rooms), work with Bruno on layout |

## Workflow Decisions

- Tasks tracked on **GitHub Projects** board.
- Team prefers **assigned tasks** over self-selection.
- Use **integration branch** for merging; feature branches for individual work.
- Coding conventions to be added to **AGENTS.md** so AI tools stay consistent across conversations.

## Beta Timeline

- Beta is approximately **2 weeks** from the meeting date (late September 2026).
- Alpha already demonstrated.
- Team needs playable content before beta.
