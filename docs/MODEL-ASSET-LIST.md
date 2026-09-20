# Model Asset List — Room-Based Scene

> For Bruno (thotslayer666): find, download and add these models to the project.
>
> **IMPORTANT:** Every model you add MUST be recorded in `ATTRIBUTIONS.md` at the repo root. Follow the existing format there — title, author, licence, file path, manifest key, what it's used for, and any modifications you made. The credits screen pulls from this file. If it's not in ATTRIBUTIONS.md, it can't ship.

---

## Style Guide

- **Aesthetic:** "RetroSaffa" — retro sci-fi, 1970s Brutalist research base on Mars. Weathered, lived-in, not clean futuristic.
- **Colour palette:** Muted blues, greys, rust oranges, dull greens. Think Soviet research station, not Apple store.
- **Scale:** Author all models in **metres**, +Y up, origin on the floor at the object's centre.
- **Format:** `.glb` only (single file). No `.gltf` with loose `.bin`/`.png` siblings.
- **Compression:** Plain `.glb` only — no Draco or Meshopt. If a download uses Draco, re-export from Blender without compression.
- **Naming:** Lowercase, hyphen-separated. `server-rack-v2.glb`, not `ServerRack_V2.glb`.
- **Poly count:** Keep it reasonable. These run in a browser. Under 50k triangles per model is ideal, under 100k is acceptable for hero pieces.

---

## Priority 1 — Essential (rooms can't function without these)

### Doors

| Model | Description | Where it's used | Notes |
|---|---|---|---|
| `door-interior.glb` | Interior door, retro/industrial style. Single panel, maybe with a small window or handle. Metal or heavy wood look. | All room doorways (MainOffice ↔ corridors, corridors ↔ ServerRoom/GeneratorBay) | Needs to look like it belongs in a 1970s research base. Not a modern office door. Not a spaceship door. Think concrete building, heavy fire-door style. |
| `door-frame-interior.glb` | Door frame / lining. Just the frame, no panel — the frame sits in the wall opening, the door panel sits in the frame. | Same as above | Can be combined with door-interior into one model if easier. Separate if we want to swap door styles independently. |

### Generator Bay

| Model | Description | Where it's used | Notes |
|---|---|---|---|
| `generator.glb` | Industrial generator / power generator. Large, central piece. Diesel or turbine style. | GeneratorBay room, centre or against a wall | This is a hero prop — the player has to physically go to it to cut power. Make it feel heavy and important. Think backup generator for a building, not a portable camping one. |
| `breaker-panel.glb` | Electrical breaker panel / switchboard box. Wall-mounted, with switches/levers. | GeneratorBay room, on a wall | Already have `switchboard.glb` which could work for this. Check if it fits the aesthetic. If yes, reuse it. If not, find a separate breaker panel. |

---

## Priority 2 — High (rooms feel empty without these)

### Server Room

| Model | Description | Where it's used | Notes |
|---|---|---|---|
| `server-rack-tall.glb` | Tall server rack, 19" rack style. Retro computing look — blinking lights, tape drives, reel-to-reel if possible. | ServerRoom, multiple instances (3-5 racks) | We already have `server.glb`. Check if it can be reused here. If it looks right, we just spawn more copies. If not, find a taller/different rack. |
| `server-console.glb` | A console/terminal desk that sits in front of the server racks. CRT monitor, keyboard, status lights. | ServerRoom, facing the racks | This is where the player processes/deletes signals. Needs to feel like a workstation, not just decoration. |

### Living Quarters / Break Room

| Model | Description | Where it's used | Notes |
|---|---|---|---|
| `bunk-bed.glb` | Bunk bed. Metal frame, 2-3 tiers. Military/dormitory style. | LivingQuarters room | 100 hits to destroy with a crowbar (per VotV). Doesn't need to be breakable for us, but should look sturdy and institutional. |
| `vending-machine.glb` | Snack/drink vending machine. Retro style. | BreakRoom or LivingQuarters, against a wall | Think 1970s vending machine, not a modern touchscreen one. Buttons, glass front, dim internal light. Could dispense coffee (gameplay item for stamina). |
| `couch.glb` | Worn couch / sofa. Fabric, slightly dirty/stained. | BreakRoom | Doesn't need to be interactive. Just atmosphere. |
| `locker.glb` | Metal wall locker / storage locker. Steel, maybe with a vent grille. | LivingQuarters or corridor walls, row of 3-4 | Institutional style. Gym locker or military locker. |

---

## Priority 3 — Medium (adds character and atmosphere)

### Props & Decoration

| Model | Description | Where it's used | Notes |
|---|---|---|---|
| `crate-supply.glb` | Supply crate. Wooden or metal. Stackable. | All rooms, scattered around | We have dynamic crates already. Find a model that matches the retro aesthetic — not a modern shipping container. Think wooden ammo crate or metal supply box. |
| `barrel.glb` | Industrial barrel / drum. Metal, maybe with rust. | GeneratorBay, ServerRoom corners | Standard 200L drum. Could be fuel, water, or mystery contents. |
| `pipe-set.glb` | Exposed pipe section. Industrial piping, valves, fittings. | GeneratorBay walls/ceiling, corridor ceilings | Adds to the industrial feel. Can be placed along walls and ceilings. |
| `shelf.glb` | Metal storage shelf. Loaded with boxes, binders, equipment. | ServerRoom, LivingQuarters | Institutional metal shelving unit. Think stockroom, not IKEA. |
| `desk-simple.glb` | Simple metal desk. No computer built in — just a flat surface with a drawer. | LivingQuarters, BreakRoom | Standard government/office desk from the 70s. Metal legs, formica top. |
| `chair-metal.glb` | Simple metal chair. Stackable, institutional. | LivingQuarters, BreakRoom | Not an office chair. A foldable or stackable metal chair. |
| `trash-bin.glb` | Trash bin / wastepaper basket. Metal wire or simple metal can. | Various rooms | Small detail. Adds to the "lived-in" feel. |

---

## Priority 4 — Low (nice to have, polish)

### Environment & Exterior

| Model | Description | Where it's used | Notes |
|---|---|---|---|
| `fence-section.glb` | Perimeter fence section. Chain-link or corrugated metal. | Outside area, perimeter | Doesn't need to be detailed. Just a visual + collision barrier. |
| `light-fixture-ceiling.glb` | Ceiling-mounted light fixture. Industrial fluorescent tube style. | All rooms, on ceilings | We build these procedurally (cylinder geometry), but a proper model would look better. Retro fluorescent tube with a metal cage/shade. |
| `light-fixture-wall.glb` | Wall-mounted light. Simple caged bulb or industrial sconce. | Corridors, GeneratorBay | Same as above but for walls. |
| `fire-extinguisher.glb` | Fire extinguisher. Red, wall-mounted. | Various rooms, on walls | VotV has these everywhere. Small detail that adds realism. |
| `poster-wall.glb` | Wall poster / sign. Faded, peeling. Propaganda-style or safety notice. | Various rooms, on walls | Retro-futuristic propaganda or safety notices. "SIGNAL HYGIENE IS BASE HYGIENE" type thing. Can be flat planes with textures. |
| `mannequin.glb` | Store mannequin. Slightly creepy standing around. | Various rooms | VotV uses these for atmosphere/jump scares. They're just static meshes but add unease. |

---

## Already Available (check before downloading)

These models already exist in `public/assets/models/` and might be reusable:

| Existing file | Could serve as | Action |
|---|---|---|
| `server.glb` | Server rack in ServerRoom | Check if it looks right for the server room. If yes, just spawn more copies. |
| `switchboard.glb` | Breaker panel in GeneratorBay | Check if it looks like a breaker panel. Could be repurposed. |
| `retro-computer.glb` | Server console in ServerRoom | Could be reused as the server room terminal, or keep in MainOffice only. |
| `radar-terminal.glb` | Secondary terminal | Could be repurposed. |
| `security-camera.glb` | Already used | Keep as-is. |
| `desk.glb` | Simple desk | Check if it fits the living quarters aesthetic. |

---

## Workflow

1. **Find the model** on Sketchfab (or similar). Must be downloadable.
2. **Check the licence** — CC Attribution (CC BY 4.0) is ideal. Note the title, author, and licence.
3. **Download as `.glb`** — if only `.gltf` is available, open in Blender and re-export as `.glb`.
4. **Check compression** — if it uses Draco, re-export without it.
5. **Check scale** — author in metres, +Y up, origin on floor at centre.
6. **Name it** — lowercase, hyphen-separated, descriptive.
7. **Drop it in** `public/assets/models/`.
8. **Update ATTRIBUTIONS.md** — add a full entry with title, author, licence, file path, manifest key, what it's used for, and modifications. **This is mandatory.**
9. **Update manifest.js** — add the model entry with the correct key and physics settings.
10. **Tell Adrian** — so he can wire it into the scene.

---

## Quick Reference — File Naming

```
public/assets/models/
├── door-interior.glb
├── door-frame-interior.glb
├── generator.glb
├── breaker-panel.glb
├── server-rack-tall.glb
├── server-console.glb
├── bunk-bed.glb
├── vending-machine.glb
├── couch.glb
├── locker.glb
├── crate-supply.glb
├── barrel.glb
├── pipe-set.glb
├── shelf.glb
├── desk-simple.glb
├── chair-metal.glb
├── trash-bin.glb
├── fence-section.glb
├── light-fixture-ceiling.glb
├── light-fixture-wall.glb
├── fire-extinguisher.glb
├── poster-wall.glb
└── mannequin.glb
```
