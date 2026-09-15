# Dead Air — General Vision (Meeting 2026-09-09)

> Distilled from the CGV team voice channel meeting. This is the north-star document for the project.

---

## Setting & Theme

- **Planet:** Mars, recently terraformed.
- **Aesthetic:** "RetroSaffa" — retro sci-fi with a South African flavour. Desolate landscape, currently being terraformed. Not clean futuristic — weathered, lived-in, 1970s Brutalist research base left to rot.
- **Tone:** Horror. FNAF-style survival tension on an alien world.
- **Asset consistency:** All models, textures and props must share the retro/terraformed look. No mixing clean sci-fi with the weathered base style.

## Game Concept

**Five Nights at Freddy's on Mars.** The player is stationed at a remote signal observatory. Each night they must collect and process signals while a monster hunts them down. Survive until morning. Repeat. Escalate.

- **Core loop:** Collect signals → meet quota → survive the night → upgrade → repeat.
- **Perspective:** First-person, in-game (not a security camera view — the player is *inside* the base).
- **Day/night cycle:** Gameplay happens at night. The stamina/sleep system bridges the gap between nights.

## Scene Structure

**One continuous scene, not separate levels.** A single base with rooms that unlock progressively:

| Night | Rooms Accessible |
|---|---|
| 1 | Room 1 (starting room) |
| 2 | Rooms 1 + 2 |
| 3 | All 3 rooms + outside area |

### The 3 Rooms

1. **Main Office / Signal Lab** — The hub. Computer workstation, radar, switchboard, big window. Where signals are collected.
2. **Server Room** — Dark, minimal lighting. Process and store signals. High danger.
3. **Living Quarters / Break Room** — Sleep, eat, recover stamina. The "safe" room — but never truly safe.

### Outside Area

- Small exterior zone attached to the base.
- Contains the **generator** (power management).
- Surrounded by a fence acting as the play boundary.
- Terrain: valley setting — the base sits in a dip, player can see the horizon / "edge of the world" with small hills.
- Red grass, otherworldly trees, desolate terraformed landscape.
- Satellite dishes visible in the distance (may spawn as distant silhouettes / skybox elements).

## Stamina & Sleep System

- **Stamina bar** displayed on-screen (top or side of HUD).
- Stamina decreases over time as the night progresses.
- **Coffee** consumable restores stamina (keyboard input / on-screen button).
- **Low stamina effects:**
  - Lighting gets darker / more concentrated (light radius shrinks).
  - **Sleep Demon** teleports progressively closer.
  - Environment becomes more threatening.
- **Audio cues:** Yawning sounds as stamina drops — more frequent as it gets critical.

## Menus & Settings

**Inspiration:** Voices of the Void's clean, minimal UI.

- **Main menu** — Simple, in the VotV style.
- **Pause menu** — Accessible in-game.
- **Settings:**
  - Mouse sensitivity
  - Render distance
  - Keybinds
- **Developer toggle:** Accessible from pause → developer settings → enables F2 (level editor), debug hotkeys.

## Enemy Concepts (per night)

| Night | Enemy | Mechanic |
|---|---|---|
| 1 | Sleep Demon | Punishes low stamina. Teleports closer as fatigue increases. |
| 2 | Window Entities | Visible through the office window. Must hide / avoid looking. |
| 3 | Camera Entity | Watches from the server room. Must avoid its line of sight. |

## Technical Notes

- **One scene file** — doors open to new areas rather than loading separate scenes.
- **Level editor** (F2) available for scene authoring. Export JSON + .js, feed to AI for scene building.
- **Debug tools:** V (free cam), B (fullbright), ` (collider overlay).
- **Branching:** Use integration branch for merging. Feature branches for individual work.
- **Asset pipeline:** All models go through the manifest. Attribution must be tracked.
- **Collision:** Custom collider meshes (UCX_*) needed for complex models like the computer desk.

## Team Roles (as agreed)

| Member | Focus |
|---|---|
| drax9207 (Adrian) | Scene design, level editor, overall architecture |
| mortalnumbnut | Skybox, terrain, environment |
| thotslayer666 (Bruno) | Model sourcing, asset consistency, scene assistance |
| haydnrad (Hayden) | Stamina/sleep system functionality, debug camera |
| siboneloblessingmaduna | Pause menu, main menu, settings UI |

## Key Decisions

1. **3 rooms + small outside area** — not more, not less. Keeps scope manageable.
2. **One continuous scene** — doors unlock rooms progressively, no scene loading.
3. **FNAF-style first-person horror** — not a security camera sim. Player is *in* the base.
4. **RetroSaffa aesthetic** — all assets must match. Consistency over variety.
5. **VotV-inspired UI** — clean, minimal, functional.
6. **Stamina as core tension** — the sleep demon is the consequence of running out.
