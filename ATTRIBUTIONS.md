# Attributions

Third-party assets used in Dead Air. Everything not listed here is original
work by the team. This file is the source of truth for the in-game credits
screen — add an entry whenever a downloaded asset lands in `public/assets/`.

## How to add an entry

Open the `skfb.ly` short link, and record three things from the model page:
**title**, **author**, **licence** (most of our picks are CC Attribution —
CC BY 4.0 permits use and adaptation with attribution, which this file and
the in-game credits provide). Then fill the table: which file it became,
where it is used, and anything we changed. Only link assets that are actually
downloadable — the Sketchfab filter does not remove all undownloadable ones.

**Copy the credit from the downloaded file, not from the link.** Sketchfab
writes the model's title, author, licence and source URL into every `.glb`
it serves, under `asset.extras` in the file's JSON chunk. Those four are what
actually shipped. Ten entries here once credited the candidate someone had
meant to download rather than the model that landed, so
`src/assets/manifest.test.js` now reads every shipped `.glb` and fails if its
entry here names a different source, author or licence. It also fails for any
file under `public/` this page doesn't name, and for any file it names that
no longer ships.

## Models

### Satellite dish tower

"Space information Dish" (https://skfb.ly/oSALw) by Cybertron B-127 is
licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/dish-tower.glb` |
| **Manifest key** | `model:dish-tower` |
| **Used for** | The satellite dish outside the office |
| **Modifications** | Created a base that the dish sits on and moves with |

### Server

"Server" (https://sketchfab.com/3d-models/server-884903cc15fc441ebb9075c9d84a767b)
by //A (Demonxp) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/server-rack.glb` |
| **Manifest key** | `model:server-rack` |
| **Used for** | Server rack in the office |
| **Modifications** | None recorded |

### Blast door — closed

"Space Ship Blast Door (Closed)"
(https://sketchfab.com/3d-models/space-ship-blast-door-closed-d652b30770574419bbc37b7024cffd22)
by Jacob Smith (ChampComputings) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/blast-door-closed.glb` |
| **Manifest key** | `model:blast-door-closed` |
| **Used for** | Large sliding blast door — closed state |
| **Modifications** | None recorded |

### Blast door — open

"Space Ship Blast Door (Open)"
(https://sketchfab.com/3d-models/space-ship-blast-door-open-f28fa7e29155478a9238c349959a72d6)
by Jacob Smith (ChampComputings) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/blast-door-open.glb` |
| **Manifest key** | `model:blast-door-open` |
| **Used for** | Large sliding blast door — open state |
| **Modifications** | None recorded |

### Server console (terminal)

"console03b"
(https://sketchfab.com/3d-models/console03b-a7301efe05454ed38c257524137b0045)
by ~Drift~ (QuickDriftVR) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/server-console.glb` |
| **Manifest key** | `model:server-console` |
| **Used for** | Server room console/terminal prop |
| **Modifications** | None recorded |

### Server rack (tall)

"Server Rack - Low Poly"
(https://sketchfab.com/3d-models/server-rack-low-poly-458b456d8a064517bd7f1fcdeba78304)
by PolyDavid is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/server-rack-tall.glb` |
| **Manifest key** | `model:server-rack-tall` |
| **Used for** | Tall server rack prop |
| **Modifications** | None recorded |

### Bunk bed

"bunk bed" (https://sketchfab.com/3d-models/bunk-bed-8b2a538ab53a4dc3816c8ca78e43ce5e)
by Tomas Anglim (tomas.anglim.811) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/bunk-bed.glb` |
| **Manifest key** | `model:bunk-bed` |
| **Used for** | Crew quarters bunk bed |
| **Modifications** | None recorded |

### Couch

"Old Couch" (https://sketchfab.com/3d-models/old-couch-8da7e0d122f544e2862b4e592988e183)
by Oliver Triplett (OliverTriplett) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/couch.glb` |
| **Manifest key** | `model:couch` |
| **Used for** | Break room / lounge couch |
| **Modifications** | None recorded |

### Locker

"Game Ready - Rusted Locker"
(https://sketchfab.com/3d-models/game-ready-rusted-locker-c3a4c76c7d22483eb91aa6fd949cf157)
by Allan-Jay Branscombe (AllanJayBranscombe) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/locker.glb` |
| **Manifest key** | `model:locker` |
| **Used for** | Metal storage locker prop |
| **Modifications** | None recorded |

### Fuel barrel

"Fuel Barrel" (https://sketchfab.com/3d-models/fuel-barrel-55f313a9dfee4946b0a0dcb59704c2cb)
by Emil Gilmutdinov (Emil_Gilmutdinov) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/barrel.glb` |
| **Manifest key** | `model:barrel` |
| **Used for** | Metal barrel prop |
| **Modifications** | None recorded |

### Shelf

"Low-Poly Metal Shelf"
(https://sketchfab.com/3d-models/low-poly-metal-shelf-d9f0169a2a254d5a8668d4cf598c743e)
by Ronstu is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/shelf.glb` |
| **Manifest key** | `model:shelf` |
| **Used for** | Metal shelving unit prop |
| **Modifications** | None recorded |

### Soap dispenser — ⚠ non-commercial license

"Retro Soap Dispenser(2K)"
(https://sketchfab.com/3d-models/retro-soap-dispenser2k-8945615518324c5dbdca911f0545edd9)
by Minh Nguyen (Minh_Nguyen_2004) is licensed under **Creative Commons
Attribution-NonCommercial**
(http://creativecommons.org/licenses/by-nc/4.0/) — **not** the standard CC BY
used everywhere else in this file. Commercial use is not permitted under this
licence.

**Decided (Sept 2026): keep it.** Dead Air is a non-commercial university
project. Unlike the poster this licence carries no ND clause, so the asset may
be modified. It has to be replaced if the game is ever sold or monetised.

| | |
|---|---|
| **File** | `public/assets/models/soap-dispenser.glb` |
| **Manifest key** | `model:soap-dispenser` |
| **Used for** | Bathroom / break room soap dispenser prop |
| **Modifications** | None recorded |

### Vending machine

"(Retro) - Vending Machine"
(https://sketchfab.com/3d-models/retro-vending-machine-8864bbc0957649c7b17f9147e9b58910)
by Kasujin is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/vending-machine.glb` |
| **Manifest key** | `model:vending-machine` |
| **Used for** | Break room vending machine |
| **Modifications** | None recorded |

### Mars rover

"Colony Rover" (https://sketchfab.com/3d-models/colony-rover-1ba1bf4753c1409a865c8a7b2d37ea3a)
by Aleksey Basinskiy (rakorian) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/colony-rover.glb` |
| **Manifest key** | `model:colony-rover` |
| **Used for** | Mars colony rover exterior prop |
| **Modifications** | None recorded |

### Poster — ⚠ non-commercial, no-derivatives license

"Mars Poster" (https://sketchfab.com/3d-models/mars-poster-fe37ea9b8bdd4debab6605facd087bc4)
by Whystler is licensed under **Creative Commons
Attribution-NonCommercial-NoDerivs**
(http://creativecommons.org/licenses/by-nc-nd/4.0/) — **not** the standard CC
BY used everywhere else in this file. This licence forbids commercial use
*and* modified/derivative versions of the asset.

**Decided (Sept 2026): keep it.** Dead Air is a non-commercial university
project, which satisfies NC, and the poster ships exactly as downloaded, which
satisfies ND. Renaming a file is not a modification of the work, and CC 4.0
§2(a)(4) puts format conversion outside "Adapted Material" as well. Two
standing conditions come with that decision:

- **Never modify this asset.** No retexturing, no mesh edits, and no
  `material:` override on `model:poster` in the manifest — each of those
  would ship a derivative, which ND forbids.
- **If Dead Air is ever sold or monetised, this and the soap dispenser have to
  be replaced.** Both are NonCommercial.

| | |
|---|---|
| **File** | `public/assets/models/poster.glb` |
| **Manifest key** | `model:poster` |
| **Used for** | Wall poster decoration |
| **Modifications** | None recorded |

### Birch tree

"Birch Tree - Proto Series - Free"
(https://sketchfab.com/3d-models/birch-tree-proto-series-free-f0203eb84beb4d638d148e2116f5dbf7)
by BitGem is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/tree-birch.glb` |
| **Manifest key** | `model:tree-birch` |
| **Used for** | Exterior foliage |
| **Modifications** | None recorded |

### Pine tree

"Pine Tree - Proto Series - Free"
(https://sketchfab.com/3d-models/pine-tree-proto-series-free-08014e92a59244c992884091218230b8)
by BitGem is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/tree-pine.glb` |
| **Manifest key** | `model:tree-pine` |
| **Used for** | Exterior foliage |
| **Modifications** | None recorded |

### Fantasy tree

"fantasy tree 1" (https://sketchfab.com/3d-models/fantasy-tree-1-fee2b59583084ae1a755a1b02133a42c)
by DJMaesen (bumstrum) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/tree-fantasy.glb` |
| **Manifest key** | `model:tree-fantasy` |
| **Used for** | Dead / exterior tree foliage |
| **Modifications** | None recorded |

### Low poly dead tree

"Low Poly: Dead Tree"
(https://sketchfab.com/3d-models/low-poly-dead-tree-addc2aef9e534a93a8798320fea440ef)
by ClintonAbbott.Art is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/tree-dead.glb` |
| **Manifest key** | `model:tree-dead` |
| **Used for** | Dead / exterior tree foliage |
| **Modifications** | None recorded |

### Fire extinguisher

"Fire Extingusher Low Poly" (sic)
(https://sketchfab.com/3d-models/fire-extingusher-low-poly-88dffd0ed79548c589344788956233c6)
by r.m.kowalewski is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/fire-extinguisher.glb` |
| **Manifest key** | `model:fire-extinguisher` |
| **Used for** | Wall-mounted fire extinguisher prop |
| **Modifications** | None recorded |

### Ceiling light

"Industrial Light" (https://sketchfab.com/3d-models/industrial-light-0bcbb6f2a3e54b6b8c69e241bbd5bc5f)
by ConhuirParker is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/light-ceiling.glb` |
| **Manifest key** | `model:light-ceiling` |
| **Used for** | Ceiling-mounted light fixture |
| **Modifications** | None recorded |

### Wall light

"Industrial Bulkhead Wall Lamp Lowpoly"
(https://sketchfab.com/3d-models/industrial-bulkhead-wall-lamp-lowpoly-4c50439bcbc247629fe2194862d7acc9)
by iwanPlays is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/wall-light.glb` |
| **Manifest key** | `model:wall-light` |
| **Used for** | Wall-mounted light fixture |
| **Modifications** | None recorded |

### Chainlink fence

"Chainlink Fence - Low Poly"
(https://sketchfab.com/3d-models/chainlink-fence-low-poly-50901b0cc91b4e04a18ecd13bc379a90)
by Gamedirection is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/chainlink-fence.glb` |
| **Manifest key** | `model:chainlink-fence` |
| **Used for** | Exterior fencing |
| **Modifications** | None recorded |

### Simple desk

"Old Metal Table (Low Poly)"
(https://sketchfab.com/3d-models/old-metal-table-low-poly-92a14c8d231b4812bc7b97d03da6ddd9)
by Berk Gedik (berkgedik) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/simple-desk.glb` |
| **Manifest key** | `model:simple-desk` |
| **Used for** | Office desk prop |
| **Modifications** | None recorded |

### Generator

"Game asset "Generator""
(https://sketchfab.com/3d-models/game-asset-generator-d225389de8c24d1c9cf7102c740eccf9)
by Daniel_Bakunin (Daniel_Baku) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/generator.glb` |
| **Manifest key** | `model:generator` |
| **Used for** | The generator outside the base — the power you restart after a blackout |
| **Modifications** | None recorded |

### Metal chair

"Folding Chair - Low Poly"
(https://sketchfab.com/3d-models/folding-chair-low-poly-54bd0acd7c524d678128367a25a0f504)
by Jeremy E. Grayson (JeremyGrayson) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/metal-chair.glb` |
| **Manifest key** | `model:metal-chair` |
| **Used for** | Office/break room chair prop |
| **Modifications** | None recorded |

### Trash bin

"PS2 Style Rusty Trash Bin"
(https://sketchfab.com/3d-models/ps2-style-rusty-trash-bin-036b2bcc27aa4d2e9b2168f83006aa4d)
by TetsuoTetsuo is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/trash-bin.glb` |
| **Manifest key** | `model:trash-bin` |
| **Used for** | Trash bin prop |
| **Modifications** | None recorded |

### Crate

"Crate box" (https://sketchfab.com/3d-models/crate-box-e1a6856037c54d0d9019aedf61315569)
by KloWorks is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/crate.glb` |
| **Manifest key** | `model:crate` |
| **Used for** | Stackable crate prop |
| **Modifications** | None recorded |

### Wall screen

"retro cyberpunk computer screens"
(https://sketchfab.com/3d-models/retro-cyberpunk-computer-screens-6fbdcecb1b1e4f41947b4c03b5eed8f9)
by ribot02 is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/wall-screen.glb` |
| **Manifest key** | `model:wall-screen` |
| **Used for** | Wall-mounted retro CRT/monitor screens |
| **Modifications** | None recorded |

### Interior door

"Metal Door" (https://sketchfab.com/3d-models/metal-door-8d56d78187684f54a5c38319b43a5b1d)
by Spellkaze is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/door-interior.glb` |
| **Manifest key** | `model:door-interior` |
| **Used for** | Interior door prop |
| **Modifications** | None recorded |

### Radar terminal

"Industrial Terminal"
(https://sketchfab.com/3d-models/industrial-terminal-846bb4773f74406bb8a24fcf2f17cf22)
by Vaportrash (vaportrash) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/radar-terminal.glb` (downloaded as `industrial_terminal.glb`) |
| **Manifest key** | `model:radar-terminal` |
| **Used for** | The radar console in the server room |
| **Modifications** | None to the file |

### Desk with computer

"Retro Futuristic Computer"
(https://sketchfab.com/3d-models/retro-futuristic-computer-a197548492214728929d897245dab32a)
by heslachris is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/retro-computer.glb` (downloaded as `retro_futuristic_computer.glb`) |
| **Manifest key** | `model:retro-computer` |
| **Used for** | The signal computer's desk in the main office |
| **Modifications** | None to the file. In game, the CRT shader (`src/shaders/CrtScreen.js`) draws a screen over its monitor, and the manifest gives it a hand-made collider with an open kneehole |

### Security camera — ⚠ Sketchfab Standard licence

"Security Camera"
(https://sketchfab.com/3d-models/security-camera-7a4d8b033982421e8a1de6b52e979176)
by Llop (llopestepari) is licensed under the **Sketchfab Standard** licence
(https://sketchfab.com/licenses) — **not** Creative Commons, unlike everything
else in this file.

**Needs a decision.** The Standard licence lets a model be used inside a
project but not handed on as a file in its own right, and a web game ships
its `.glb` where any visitor can download it. The team should read the
licence and either keep the camera, as it did the poster, or swap in a CC BY
one.

| | |
|---|---|
| **File** | `public/assets/models/security-camera.glb` |
| **Manifest key** | `model:security-camera` |
| **Used for** | The server room's security camera, the night-3 threat |
| **Modifications** | None to the file |

### Switchboard

"Switchboard USSR"
(https://sketchfab.com/3d-models/switchboard-ussr-c3f198e379a2430cb35c6ded2bfe6fcb)
by AlexJJ is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/switchboard.glb` (downloaded as `switchboard_ussr.glb`) |
| **Manifest key** | `model:switchboard` |
| **Used for** | The power box in the old `OfficeScene` only; the base does not spawn it |
| **Modifications** | None. A byte-identical copy that shipped as `break-panel.glb` was removed |

### Bush

"George W. Bush in a Bush"
(https://sketchfab.com/3d-models/george-w-bush-in-a-bush-51db4066b4f44f3797ba499c39905c0d)
by MSEECS 298 (mseecs298) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/bush.glb` (downloaded as `best-bush.glb`) |
| **Manifest key** | `model:bush` |
| **Used for** | Nothing in the game spawns it; the manifest keeps it for the level editor's library |
| **Modifications** | None |

## Sounds

Every `.wav` in `public/assets/audio/` is original: synthesised from the
recipes in `src/audio/sounds.js` by `node scripts/make-sounds.mjs`. The two
`.mp3` ambience beds are recordings the team supplied. What their files'
own tags say is below; the source links are still to be recorded.

### Base interior — TODO: source link, author, licence

Tagged with the title "Lost" and nothing else. Supplied as
`louder-rumbling-ethereal.mpeg`.

| | |
|---|---|
| **File** | `public/assets/audio/base-interior.mp3` |
| **Manifest key** | `amb:base-interior` |
| **Used for** | The machinery bed everywhere inside the base (`src/audio/Ambience.js`) |
| **Modifications** | Renamed from `.mpeg`, otherwise as supplied |

### Outside wind — TODO: source link

Tagged with the artist Jerimee Richir and the licence CC0 (public domain — no
attribution required, credited anyway). Supplied as
`quieter-rumbling-windy.mpeg`.

| | |
|---|---|
| **File** | `public/assets/audio/outside-wind.mp3` |
| **Manifest key** | `amb:outside-wind` |
| **Used for** | The wind outside the base, and in the airlock while its hatch is open |
| **Modifications** | Renamed from `.mpeg`, otherwise as supplied |

## Images

### Signal images — TODO: which tool

`public/assets/signals/signal-*.png`, eight 1024 × 768 images that the
computer shows for a decoded signal. They were added as placeholders
(Haydn, 10 Sept 2026). Each file carries a TC260 `AIGC` label in its XMP
metadata, which marks it as AI-generated content, so they were not drawn or
photographed by the team.

**TODO (Haydn):** record which image generator made them, check that its
terms allow them in a published game, and credit the tool on the credits
screen.

## Original work that ships

Made by the team; listed so every file under `public/` is accounted for.

- `public/assets/models/desk.glb` — a stand-in desk built from primitives
  (`model:desk`, the living quarters' desk).
- `public/assets/textures/floor-basecolor.png` and
  `public/assets/textures/floor-normal.png` — a seamless procedural
  concrete-tile pair.
- Every `.wav` in `public/assets/audio/`; see Sounds.
- `public/assets/models/dish-tower.glb` is a download with a base the team
  added in Blender; its entry is at the top.

## Kept in `source-assets/` — not shipped

Downloads nothing in the game loads. They stay in git (the monsters may
become enemies) but sit outside `public/`, so the build leaves them out.
What each file records about itself:

| File | Title, author, licence | Source |
|---|---|---|
| `source-assets/models/server_v2_console.glb` | "Server V2 +console", FlevasGR, CC BY 4.0 | https://sketchfab.com/3d-models/server-v2-console-f24594ece9634cec9c1210c041838371 |
| `source-assets/models/retro_command_console_aged.glb` | "Retro Command Console Aged", cgwhiteford, CC BY 4.0 | https://sketchfab.com/3d-models/retro-command-console-aged-d9242c3047234734910e2a3082c4ffea |
| `source-assets/models/ragno_monster.glb` | "Ragno (Monster)", Hobu (Hobu_Coffee), CC BY 4.0 | https://sketchfab.com/3d-models/ragno-monster-2e1a422e6f0048f98a786ceecac423d7 |
| `source-assets/models/the_boiled_one_horror_game_-_boiled_one.glb` | "The Boiled One: Horror Game - Boiled One", MG Rips (MG_GameRips), **CC BY-NC 4.0** | https://sketchfab.com/3d-models/the-boiled-one-horror-game-boiled-one-64ce66c413fe4e5e92a48e8e02a83590 |
| `source-assets/models/office-scene.glb` | Exported from Blender, with no source recorded | — |

Before any of these ships, give it a full entry above. The Boiled One needs
more than that: its uploader's name says it was ripped from a commercial
game, and an uploader can't license a character they don't own.

## Candidate links — upcoming assets

Not downloaded yet; kept here so the links survive. Move each into a proper
entry when its file lands in `public/assets/`.

- **Power box** — https://skfb.ly/onTVS (noted: fairly high poly)
- **Drive wiper** — link TBD
- **Sleep demon** — https://skfb.ly/pzR9J, https://skfb.ly/pGvqH,
  https://skfb.ly/oESrR, https://skfb.ly/oWApE (noted: high poly)
- **Wisps** — links TBD
- **UFO** — https://skfb.ly/6URJp
- **Camera entity** — https://skfb.ly/pwTAH (noted: high poly)
- **Environment (alien foliage, terraformed Mars)** — links TBD
