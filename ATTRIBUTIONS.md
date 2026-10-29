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

"Server" (https://skfb.ly/pqAAP) by //A (A87Models) is licensed under
Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/server-rack.glb` |
| **Manifest key** | `model:server-rack` |
| **Used for** | Server rack in the office |
| **Modifications** | None recorded |


### Bed

"PBR Bed Model" (https://www.cgtrader.com/free-3d-models/furniture/bed/pbr-bed-model)
from CGTrader (item 1960270), free under the CGTrader Royalty Free License.

| | |
|---|---|
| **File** | `public/assets/models/bed.glb` |
| **Manifest key** | `model:bed` |
| **Used for** | Crew quarters bed (replaced the bunk bed, whose ladder hid the bedside clock from the pillow) |
| **Designer** | Not recorded yet: the CGTrader page wouldn't load here, so add the designer's username from it |
| **Modifications** | FBX converted to `.glb` in Blender: scaled to 2 m long, turned so the pillow is at −z, origin on the floor; textures cut to 512–1024 px; the Unity metallic/smoothness map turned into a glTF metal/rough map, metalness at 60 % (no environment map to reflect) |


### Locker

"Metal Painted Rusty Wardrobe Lockers"
(https://sketchfab.com/3d-models/metal-painted-rusty-wardrobe-lockers-f2a7e2593f884ae4bb6aa59c575b2dc4)
by Ottto3d is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/locker.glb` |
| **Manifest key** | `model:locker` |
| **Used for** | Metal storage locker prop |
| **Modifications** | Base-colour recoloured from rust to dark gunmetal; roughness, metalness and normal map smoothed |

### Shelf

"Metal Shelf - 5MB"
(https://sketchfab.com/3d-models/metal-shelf-5mb-1621362eb54d4571a49323ceb74f80fb)
by Mehdi Shahsavan (ahmagh2e) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/shelf.glb` |
| **Manifest key** | `model:shelf` |
| **Used for** | Metal shelving unit prop |
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

### Ceiling light

"Industrial Light" (https://sketchfab.com/3d-models/industrial-light-0bcbb6f2a3e54b6b8c69e241bbd5bc5f)
by ConhuirParker is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/light-ceiling.glb` |
| **Manifest key** | `model:light-ceiling` |
| **Used for** | UV grow lights on the office's grow rack |
| **Modifications** | Hung face-down; glow recoloured UV purple at runtime (`GrowRack.js`) |

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

"Computer Desk" (https://sketchfab.com/3d-models/computer-desk-05353724b7884bfb81211c7033a57fd4)
by felixawani is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/simple-desk.glb` |
| **Manifest key** | `model:simple-desk` |
| **Used for** | The bedroom's desk |
| **Modifications** | Scaled to 0.88 and stood on the floor at load (manifest `scale`, `origin`) |

### Signal lamp bulb

"Lightbulb 01" (https://polyhaven.com/a/lightbulb_01) by Josh Dean from Poly
Haven, released under CC0 (https://creativecommons.org/publicdomain/zero/1.0/).
No attribution required; credited anyway.

| | |
|---|---|
| **File** | `public/assets/models/bulb.glb` |
| **Manifest key** | `model:bulb` |
| **Used for** | The office's signal lamp |
| **Modifications** | `scripts/prep-bulb.mjs`: the glass's transmission dropped, one colour atlas for glass and base, the maker's stamp painted off the glass, simplified to half its triangles and its textures to 512 px; scaled to 1.5 at load (manifest `scale`) |

### Coffee machine

"Coffee Machine Ascaso Dream" (https://free3d.io/model/Coffee-machine-Ascaso-Dream/d655706f)
from free3D.io, uploader not named on the page. Used under free3D.io's Terms
of Use (https://free3d.io/terms.html), which allow modifying a model and
sharing or redistributing it with credit to its creator.

| | |
|---|---|
| **File** | `public/assets/models/coffee-machine.glb` |
| **Manifest key** | `model:coffee-machine` |
| **Used for** | The bedroom's coffee machine |
| **Modifications** | `scripts/prep-coffee-machine.mjs`: transmission and specular extensions dropped, finishes changed, the body dulled to rust, the maker's name painted off the gauge face; scaled to 0.00396 and stood on the floor at load (manifest `scale`, `origin`) |

### Table wood

"Wood Table Worn" (https://polyhaven.com/a/wood_table_worn) by Dimitrios
Savva (photography) and Rico Cilliers (processing) from Poly Haven, released
under CC0 (https://creativecommons.org/publicdomain/zero/1.0/).
No attribution required; credited anyway.

| | |
|---|---|
| **File** | `public/assets/textures/wood-table.jpg`, `public/assets/textures/wood-table-normal.jpg` |
| **Manifest key** | `tex:wood-table`, `tex:wood-table-normal` |
| **Used for** | The bedroom's side table and coffee table |
| **Modifications** | The 1k colour and OpenGL normal maps, re-saved as JPEG at quality 85 and 90 |

### Bedroom laptop

"Classic Laptop" (https://polyhaven.com/a/classic_laptop) by Arrangemonk from
Poly Haven, released under CC0 (https://creativecommons.org/publicdomain/zero/1.0/).
No attribution required; credited anyway.

| | |
|---|---|
| **File** | `public/assets/models/laptop.glb` |
| **Manifest key** | `model:laptop` |
| **Used for** | The bedroom PC |
| **Modifications** | Scaled to 0.5 at load (manifest `scale`); the maker's badge on the lid painted out of every map (`scripts/debrand-laptop.mjs`) |

### Storage rack

"Worn Metal Rack" (https://polyhaven.com/a/worn_metal_rack) from Poly Haven,
released under CC0 (https://creativecommons.org/publicdomain/zero/1.0/).
No attribution required; credited anyway.

| | |
|---|---|
| **File** | `public/assets/models/bigger-shelf.glb` |
| **Manifest key** | `model:bigger-shelf` |
| **Used for** | The bedroom's storage racks |
| **Modifications** | None recorded |

### Generator

"generator" (https://sketchfab.com/3d-models/generator-33af87b9605e4c8a936a91da6dd5a86b)
by AnaCi (zuciwien) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/generator.glb` |
| **Manifest key** | `model:generator` |
| **Used for** | The base's generator, in the fenced yard: the power switch |
| **Modifications** | Scaled to 0.44 and stood on the ground at load (manifest `scale`, `origin`) |

### Metal chair

"Metal Folding Chair"
(https://sketchfab.com/3d-models/metal-folding-chair-7a99fce4bdbd40e1b2949cdeb39a8fba)
by Chen CheHsuan (jn930194) is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/metal-chair.glb` |
| **Manifest key** | `model:metal-chair` |
| **Used for** | Office/break room chair prop |
| **Modifications** | None recorded |

### Trash bin

"Metal Garbage Bin" (https://sketchfab.com/3d-models/metal-garbage-bin-acf11a0d63cb4955b554d7f2e9bfc182)
by Alexander Korn is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/trash-bin.glb` |
| **Manifest key** | `model:trash-bin` |
| **Used for** | Trash bin prop |
| **Modifications** | Bin texture recoloured from rust to dark galvanised steel; now lit, metallic 0.8 / roughness 0.32; its trash lowered from the rim to a thin layer on the floor (`scripts/settle-bin-trash.mjs`) |

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

### Security-camera monitor

"retro cyberpunk computer screens"
(https://sketchfab.com/3d-models/retro-cyberpunk-computer-screens-6fbdcecb1b1e4f41947b4c03b5eed8f9)
by ribot02 is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/camera-monitor.glb` |
| **Manifest key** | `model:camera-monitor` |
| **Used for** | The security-camera monitor on the office desk |
| **Modifications** | The bottom-left screen only, cut out of the bank of four; turned to face +z, scaled to 0.6 m wide, stood on the floor; screen made dark glass, as if off |

### Server room consoles

"Industrial Terminal"
(https://sketchfab.com/3d-models/industrial-terminal-846bb4773f74406bb8a24fcf2f17cf22)
by Vaportrash is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/radar-terminal.glb` |
| **Manifest key** | `model:radar-terminal` |
| **Used for** | The server room's processing console and its signal-delete console |
| **Modifications** | Renamed from `industrial_terminal.glb`; our own screen picture drawn over its CRT |

### Office computer desk

"Retro Futuristic Computer"
(https://sketchfab.com/3d-models/retro-futuristic-computer-a197548492214728929d897245dab32a)
by heslachris is licensed under Creative Commons Attribution
(http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/retro-computer.glb` |
| **Manifest key** | `model:retro-computer` |
| **Used for** | The office's computer desk, where signals are scanned and saved |
| **Modifications** | Renamed from `retro_futuristic_computer.glb`; glass transmission and double-sided faces turned off in the manifest; its inside lined in a dark material; our own screen picture drawn over its monitor |

### Security camera

"Security Camera"
(https://sketchfab.com/3d-models/security-camera-7a4d8b033982421e8a1de6b52e979176)
by Llop (llopestepari), under the Sketchfab Free Standard licence
(https://sketchfab.com/licenses).

| | |
|---|---|
| **File** | `public/assets/models/security-camera.glb` |
| **Manifest key** | `model:security-camera` |
| **Used for** | The security cameras in the older test scenes (`OfficeScene`, `TestScene`); the base's own cameras are built in code (`SecurityCamera.js`) |
| **Modifications** | None |

### Mars globe and stand

"Stylized Globes Collection – Earth, Mars & More" (https://sketchfab.com/3d-models/stylized-globes-collection-earth-mars-more-1dd5c95bb8794f99b785f032d910ca2e)
by My Name Is This (profileFromHere) is licensed under Creative Commons
Attribution (http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/mars-globe.glb`, `public/assets/models/mars-stand.glb` |
| **Manifest key** | `model:mars-globe`, `model:mars-stand` |
| **Used for** | The globe on the office desk; [E] spins it on its stand (`GlobeSpin`) |
| **Modifications** | The Mars globe and its stand taken from the collection and exported as two files sharing one origin; scaled ×0.02 in the manifest |

### UFO

"Bob Lazar Ufo" (https://skfb.ly/6URJp) by Batuhan13 is licensed under
Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/ufo.glb` |
| **Manifest key** | `model:ufo` |
| **Used for** | The UFO threat — the saucer that comes once a night (`Ufo`) |
| **Modifications** | Renamed from `bob_lazar_ufo.glb`; scaled ×5 in the manifest |

### Sleep Demon — ⚠ non-commercial license, ripped game asset

"The Boiled One: Horror Game - Boiled One"
(https://sketchfab.com/3d-models/the-boiled-one-horror-game-boiled-one-64ce66c413fe4e5e92a48e8e02a83590)
by MG Rips (MG_GameRips) is licensed under **Creative Commons
Attribution-NonCommercial** (http://creativecommons.org/licenses/by-nc/4.0/).
The character is from the horror game "The Boiled One".

⚠ Two things to know. The licence is non-commercial, like the soap dispenser:
fine for a university project, but it has to be replaced if the game is ever
sold or monetised. And the uploader ripped the model from a game they did not
make, so they may not have the right to license it at all. Found by Bruno;
not yet decided as a team.

| | |
|---|---|
| **File** | `public/assets/models/sleep-demon.glb` |
| **Source** | The download itself is not kept in `public/` (it would ship in the build); re-download it from the link above to re-bake |
| **Manifest key** | `model:sleep-demon` |
| **Used for** | The Sleep Demon's body, drawn as a pitch-black shade (`MonsterFigure`) |
| **Modifications** | Baked by `scripts/bake-sleep-demon.mjs`: bind pose baked in, rig, textures, eyes, gums, teeth and the head card dropped, decimated from 18,396 to 3,000 triangles, scaled to 1.8 m, eye and mouth markers added. Our own eyes and grin are drawn on it |

### Ragno

"Ragno (Monster)" (https://sketchfab.com/3d-models/ragno-monster-2e1a422e6f0048f98a786ceecac423d7) by Hobu (https://sketchfab.com/Hobu_Coffee) is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/models/ragno.glb` |
| **Manifest key** | `model:ragno` |
| **Used for** | Ragno, the camera entity (`RagnoFigure`) |
| **Modifications** | Renamed from `ragno_monster.glb`; scaled ×0.8 in the manifest; at load, the loose shin, spike and tail bones are reattached to the legs and body, the legs are walked by IK, the idle clip plays on everything but the legs, and the head's face, hair and eyes, which the export left at the wrong size and place, are rebuilt where the creator's thumbnail shows them |

## Sounds

### Gas mask breathing

"Gas Mask Raw" by xTokioBeatlex on Pixabay
(https://pixabay.com/sound-effects/film-special-effects-gas-mask-raw-36154/),
under the Pixabay Content License — free to use, attribution not required,
credited here anyway. Downloaded as
`freesound_community-gas-mask-breath-69348.mp3`.

| | |
|---|---|
| **File** | `public/assets/audio/mask-breathing.mp3` |
| **Manifest key** | `sfx:mask-breathing` |
| **Used for** | Breathing inside the EVA suit helmet (`SuitVisor`) |
| **Modifications** | Renamed; at load, encoder silence is trimmed and the ends crossfaded so it loops cleanly (`seamlessLoop`) |

### EPP UFO Flight

"EPP UFO Flight" (https://pixabay.com/sound-effects/film-special-effects-epp-ufo-flight-65106/) by sevenepp (Freesound), uploaded to Pixabay by freesound_community, is used under the Pixabay Content License — free to use,
attribution not required, credited here anyway. Downloaded as
`freesound_community-epp-ufo-flight-65106.mp3`.

| | |
|---|---|
| **File** | `public/assets/audio/ufo-flight.mp3` |
| **Manifest key** | `sfx:ufo-flight` |
| **Used for** | The UFO's approach (`UfoThreat`); it arrives on the clip's loudest moment |
| **Modifications** | Renamed |

### Flickeringlight

"Flickeringlight" (https://pixabay.com/sound-effects/film-special-effects-flickeringlight-90411/) by scotchio (Freesound), uploaded to Pixabay by freesound_community, is used under the Pixabay Content License — free to use,
attribution not required, credited here anyway. Downloaded as
`freesound_community-flickeringlight-90411.mp3`.

| | |
|---|---|
| **File** | `public/assets/audio/flickering-light.mp3` |
| **Manifest key** | `sfx:flickering-light` |
| **Used for** | The base's lamps surging as the UFO closes in |
| **Modifications** | Renamed; looped |

### Lightbulb Break sfx

"Lightbulb Break sfx" (https://pixabay.com/sound-effects/film-special-effects-lightbulb-break-sfx-320646/) by Kave_msri is used under the Pixabay Content License — free to use,
attribution not required, credited here anyway. Downloaded as
`kave_msri-lightbulb-break-sfx-320646.mp3`.

| | |
|---|---|
| **File** | `public/assets/audio/lightbulb-break.mp3` |
| **Manifest key** | `sfx:lightbulb-break` |
| **Used for** | The bulbs blowing when the UFO arrives with the power on |
| **Modifications** | Renamed |

### Power Down

"Power Down" (https://pixabay.com/sound-effects/film-special-effects-power-down-7103/) by noirenex (Freesound), uploaded to Pixabay by freesound_community, is used under the Pixabay Content License — free to use,
attribution not required, credited here anyway. Downloaded as
`freesound_community-power-down-7103.mp3`.

| | |
|---|---|
| **File** | `public/assets/audio/power-down.mp3` |
| **Manifest key** | `sfx:power-down` |
| **Used for** | The UFO's surge tripping the generator |
| **Modifications** | Renamed |

### Teleport Whoosh

"Teleport Whoosh" (https://pixabay.com/sound-effects/teleport-whoosh-453276/) by humordome is used under the Pixabay Content License — free to use,
attribution not required, credited here anyway. Downloaded as
`humordome-teleport-whoosh-453276.mp3`.

| | |
|---|---|
| **File** | `public/assets/audio/teleport-whoosh.mp3` |
| **Manifest key** | `sfx:teleport-whoosh` |
| **Used for** | The UFO teleporting away |
| **Modifications** | Renamed |

### Ear Ringing Sound Effect

"Ear Ringing Sound Effect" (https://pixabay.com/sound-effects/film-special-effects-ear-ringing-sound-effect-26746/) by ArrowheadProductions (Freesound), uploaded to Pixabay by freesound_community, is used under the Pixabay Content License — free to use,
attribution not required, credited here anyway. Downloaded as
`freesound_community-ear-ringing-sound-effect-26746.mp3`.

| | |
|---|---|
| **File** | `public/assets/audio/ear-ringing.mp3` |
| **Manifest key** | `sfx:ear-ringing` |
| **Used for** | The white-out when the UFO takes you |
| **Modifications** | Renamed; looped |

### Small Diesel Generator

"Small Diesel Generator" (https://pixabay.com/sound-effects/technology-small-diesel-generator-61728/) by jameswrowles (Freesound), uploaded to Pixabay by freesound_community, is used under the Pixabay Content License — free to use,
attribution not required, credited here anyway. Downloaded as
`freesound_community-small-diesel-generator-61728.mp3`.

| | |
|---|---|
| **File** | `public/assets/audio/generator-start.mp3`, `generator-running.mp3`, `generator-stop.mp3` |
| **Manifest key** | `sfx:generator-start`, `sfx:generator-running`, `sfx:generator-stop` |
| **Used for** | The generator outside (`GeneratorSound`): start-up, running hum, wind-down |
| **Modifications** | Cut, at MPEG frame boundaries with no re-encode, into three clips: 0–5 s (start-up), 40–50 s (running, crossfaded into a loop at load) and 171.5 s to the end (wind-down) |

### Light Switch On

"Light Switch On" (https://pixabay.com/sound-effects/household-light-switch-on-382714/) by DRAGON-STUDIO is used under the Pixabay Content License — free to use,
attribution not required, credited here anyway. Downloaded as
`dragon-studio-light-switch-on-382714.mp3`.

| | |
|---|---|
| **File** | `public/assets/audio/light-switch.mp3` |
| **Manifest key** | `sfx:light-switch` |
| **Used for** | A breaker flicked on the generator's repair panel (`BreakerPanel`) |
| **Modifications** | Renamed |

### Tiger Attack

"Tiger Attack" (https://pixabay.com/sound-effects/tiger-attack-195840/) by DFFDV is used under the Pixabay Content License — free to use,
attribution not required, credited here anyway. Downloaded as
`dffdv-tiger-attack-195840.mp3`.

| | |
|---|---|
| **File** | `public/assets/audio/tiger-attack.mp3` |
| **Manifest key** | `sfx:tiger-attack` |
| **Used for** | A dust eye chasing the player (`DustEyes`), looped and kept quiet |
| **Modifications** | Renamed |

### Monster Bite

"Monster Bite" (https://pixabay.com/sound-effects/monster-bite-44538/), uploaded to Pixabay by freesound_community, is used under the Pixabay Content License — free to use,
attribution not required, credited here anyway. Downloaded as
`freesound_community-monster-bite-44538.mp3`.

| | |
|---|---|
| **File** | `public/assets/audio/monster-bite.mp3` |
| **Manifest key** | `sfx:monster-bite` |
| **Used for** | A dust eye catching the player (`DustEyes`) |
| **Modifications** | Renamed |

### Young tired male yawns

"Young tired male yawns" (https://mixkit.co/free-sound-effects/yawn/) from Mixkit is used under the Mixkit Sound Effects Free License (https://mixkit.co/license/#sfxFree) — free to use in a game, attribution not required, credited here anyway. Downloaded as `mixkit-young-tired-male-yawns-2278.wav`.

| | |
|---|---|
| **File** | `public/assets/audio/yawn.mp3` |
| **Manifest key** | `sfx:yawn` |
| **Used for** | The tired player's yawns (`FatigueEffects`) |
| **Modifications** | Trailing silence cut (3.0 s → 2.5 s), short fades at both ends, converted to mp3 |

### Hard pop click

"Hard pop click" (https://mixkit.co/free-sound-effects/pop/) from Mixkit is used under the Mixkit Sound Effects Free License (https://mixkit.co/license/#sfxFree) — free to use in a game, attribution not required, credited here anyway. Downloaded as `mixkit-hard-pop-click-2364.wav`.

| | |
|---|---|
| **File** | `public/assets/audio/pop.mp3` |
| **Manifest key** | `sfx:pop` |
| **Used for** | The desk globe turning into a ball of cheese (`GlobeSound`) |
| **Modifications** | Its leading click cut off (the clip starts 38 ms in, on the pop), its quiet tail trimmed to 0.13 s with short fades, downmixed to mono, encoded as MP3, renamed |

### Heartbeat

"my heart beat for Halloween+.mp3" by strongheartbeat (https://freesound.org/people/strongheartbeat/sounds/62120/), used under Creative Commons Sampling+ 1.0 (https://creativecommons.org/licenses/sampling+/1.0/) — sampling and remixing allowed, attribution required.

| | |
|---|---|
| **File** | `public/assets/audio/heartbeat.mp3` |
| **Manifest key** | `sfx:heartbeat` |
| **Used for** | A tired player's heartbeat, looped, louder and faster towards empty (`FatigueEffects`) |
| **Modifications** | Cut to a five-beat loop, time-stretched 1.3× with the pitch kept (55 → 72 bpm), converted to mono mp3 |

### Knocks — ⚠ one part non-commercial

Three knocking takes, mixed by us from Freesound recordings: "Metal Knocking" by BenjaminNelan (https://freesound.org/people/BenjaminNelan/sounds/410362/), Creative Commons 0 (https://creativecommons.org/publicdomain/zero/1.0/); "KnockMetal1.wav" by ImaginaryDust (https://freesound.org/people/ImaginaryDust/sounds/670021/), used under Creative Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/); and "Urgent Impacts - 5" by Speedenza (https://freesound.org/people/Speedenza/sounds/223017/), used under Creative Commons Attribution-NonCommercial (https://creativecommons.org/licenses/by-nc/4.0/).

⚠ Speedenza's licence is non-commercial (the page's badge says 4.0, its description 3.0). Dead Air is a non-commercial university project, which satisfies NC, as for the poster and the Sleep Demon.

| | |
|---|---|
| **File** | `public/assets/audio/knocks.mp3` |
| **Manifest key** | `sfx:knocks` |
| **Used for** | The Sleep Demon's knocks, now and then in place of a whisper (`SleepDemon`) |
| **Modifications** | Cut and arranged into three takes in one file, downmixed to mono |

### Creepy whispering

Many whispering voices, mixed by us from Freesound recordings by JoelMcDaniel: "Creepy, Whispering Latin Paragraph 1" (https://freesound.org/people/JoelMcDaniel/sounds/851765/), "Creepy, Whispering Latin Paragraph 3" (https://freesound.org/people/JoelMcDaniel/sounds/851767/) and "Creepy, Whispering Latin Paragraph 4" (https://freesound.org/people/JoelMcDaniel/sounds/851768/), used under Creative Commons 0 (https://creativecommons.org/publicdomain/zero/1.0/) — free to use, attribution not required, credited here anyway.

| | |
|---|---|
| **File** | `public/assets/audio/whispering.mp3` |
| **Manifest key** | `sfx:whispering` |
| **Used for** | The Sleep Demon's whispers, a snippet at a time (`SleepDemon`) |
| **Modifications** | Overlaid into one 10 s clip, downmixed to mono, raised about 27 dB |

### Pressure release

One pressure-release hiss, mixed by us from two Freesound recordings: "Garage Air Compressor Releasing Pressure" by j_soundeffects (https://freesound.org/people/j_soundeffects/sounds/847748/), used under Creative Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/), and "Air (or steam) pressure release" by brunoboselli (https://freesound.org/people/brunoboselli/sounds/457294/), Creative Commons 0 — free to use, attribution not required, credited here anyway.

| | |
|---|---|
| **File** | `public/assets/audio/pressure-release.mp3` |
| **Manifest key** | `sfx:pressure-release` |
| **Used for** | The airlock sealing and cycling (`AirlockSound`) |
| **Modifications** | The two recordings layered and mixed down into one clip |

### Sand on the window

"sand pour on glass FF675.aif" (https://freesound.org/people/martinimeniscus/sounds/199361/) by martinimeniscus on Freesound is Creative Commons 0 — free to use, attribution not required, credited here anyway.

| | |
|---|---|
| **File** | `public/assets/audio/window-sand.mp3` |
| **Manifest key** | `sfx:window-sand` |
| **Used for** | A storm's sand hitting the office window (`WindowSand`) |
| **Modifications** | Cut to a short clip; crossfaded into a seamless loop at load |

### Satellite dish

"Satellite dish1.wav" (https://freesound.org/people/juskiddink/sounds/68077/) by juskiddink on Freesound is used under Creative Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/audio/dish-main-loop-distant.mp3`, `movement-ending.mp3` |
| **Manifest key** | `sfx:dish-main-loop-distant`, `sfx:movement-ending` |
| **Used for** | The dish slewing (`SatelliteSound`): its drive while it moves, and the click as it settles |
| **Modifications** | Cut into two clips: a loop of the drive and the ending; the loop is crossfaded into a seamless loop at load |

### Scanner alert

One beep, mixed by us from three Freesound recordings, all Creative Commons 0 — free to use, attribution not required, credited here anyway: "Radar" by unfa (https://freesound.org/people/unfa/sounds/584179/), and "Switch-083" (https://freesound.org/people/Moulaythami/sounds/842473/) and "Switch-090" (https://freesound.org/people/Moulaythami/sounds/842480/) by Moulaythami.

| | |
|---|---|
| **File** | `public/assets/audio/scanner-alert.mp3` |
| **Manifest key** | `sfx:scanner-alert` |
| **Used for** | The signal lamp's beep, once with every light-up (`ScannerAlertSound`) |
| **Modifications** | The three recordings cut, layered and mixed down into one short beep; pitch and level varied slightly, at random, while the lamp flashes for the UFO |

### Small electronic motor

"Small Electronic Motor" (Pixabay sound 60771), uploaded to Pixabay by freesound_community, is used under the Pixabay Content License — free to use, attribution not required, credited here anyway. Downloaded as `freesound_community-small-electronic-motor-60771.mp3`.

| | |
|---|---|
| **File** | `public/assets/audio/camera-servo.mp3` |
| **Manifest key** | `sfx:camera-servo` |
| **Used for** | A security camera's pan motor, looped faintly while it turns (`CameraTerminal`) |
| **Modifications** | Cut to its loud first 7 s (0.12–7.1 s), at MPEG frame boundaries with no re-encode; renamed |

### TV static

"TV Static" (Pixabay sound 7019), uploaded to Pixabay by freesound_community, is used under the Pixabay Content License — free to use, attribution not required, credited here anyway. Downloaded as `freesound_community-tv-static-7019.mp3`.

| | |
|---|---|
| **File** | `public/assets/audio/camera-static.mp3` |
| **Manifest key** | `sfx:camera-static` |
| **Used for** | The security monitor's static, looped while a feed comes in (`CameraTerminal`) |
| **Modifications** | Cut to its first 4 s, at MPEG frame boundaries with no re-encode; renamed |

### Camera flash switch

"MECHSwtch_small_electric_switch_on_off.wav" (https://freesound.org/people/DBS_Sounds/sounds/613657/) by DBS_Sounds on Freesound is used under Creative Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/).

| | |
|---|---|
| **File** | `public/assets/audio/camera-spotlight.mp3`, `public/assets/audio/camera-spotlight-off.mp3` |
| **Manifest key** | `sfx:camera-spotlight`, `sfx:camera-spotlight-off` |
| **Used for** | A security camera's flash coming on, and going off (`CameraTerminal`) |
| **Modifications** | Its two clicks cut apart: the switch going on, and going off |

### Drive box knocks

Three clips, cut by us from two Freesound recordings, both Creative Commons 0 — free to use, attribution not required, credited here anyway: "Cardboard Box Table.wav" by FlirtFM (https://freesound.org/people/FlirtFM/sounds/491094/) and "boxes small cardboard of junk and parts grab slide pickup put down on wood shelves rattle.wav" by kyles (https://freesound.org/people/kyles/sounds/452569/).

| | |
|---|---|
| **File** | `public/assets/audio/box-impact-1.mp3`, `box-impact-2.mp3`, `box-handle.mp3` |
| **Manifest key** | `sfx:box-impact-1`, `sfx:box-impact-2`, `sfx:box-handle` |
| **Used for** | A drive box put down or dropped, one of two picked at random; and a third for it being picked up, docked and undocked (`ImpactSound`) |
| **Modifications** | Cut into three short clips |

### Drive knocks

"Box Lifted and Put Down.wav" (https://freesound.org/people/180156/sounds/445498/) by 180156 on Freesound is used under Creative Commons Attribution 3.0 (https://creativecommons.org/licenses/by/3.0/).

| | |
|---|---|
| **File** | `public/assets/audio/drive-impact-1.mp3`, `drive-impact-2.mp3`, `drive-impact-3.mp3`, `drive-impact-4.mp3` |
| **Manifest key** | `sfx:drive-impact-1`, `sfx:drive-impact-2`, `sfx:drive-impact-3`, `sfx:drive-impact-4` |
| **Used for** | A drive dropped, knocked against something, picked up, or seated in a drive box or taken out of one (`ImpactSound`), one picked at random |
| **Modifications** | Cut into four short clips |

### Drive reader

Six clips, mixed by us from three Freesound recordings: "Opening Closing Tape Deck Inserting Ejecting Audio Cassette" by WeenyBeany (https://freesound.org/people/WeenyBeany/sounds/769362/), used under Creative Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/), and "floppy_insert.ogg" by asiekierka (https://freesound.org/people/asiekierka/sounds/628244/) and "sd card sounds.mp3" by Tairblenn (https://freesound.org/people/Tairblenn/sounds/535956/), both Creative Commons 0 — free to use, attribution not required, credited here anyway.

| | |
|---|---|
| **File** | `public/assets/audio/drive-insert-1.mp3`, `drive-insert-2.mp3`, `drive-insert-3.mp3`, `drive-remove-1.mp3`, `drive-remove-2.mp3`, `drive-remove-3.mp3` |
| **Manifest key** | `sfx:drive-insert-1`, `sfx:drive-insert-2`, `sfx:drive-insert-3`, `sfx:drive-remove-1`, `sfx:drive-remove-2`, `sfx:drive-remove-3` |
| **Used for** | A drive going into a reader and coming out of it (`DriveSlot`), one of three picked at random each way |
| **Modifications** | The recordings cut, layered and mixed down; split into three insert clips and three remove clips |

### Corrupted drive sparks

Three spark clips, cut by us from a mix of two Freesound recordings, both used under Creative Commons Attribution 4.0 (https://creativecommons.org/licenses/by/4.0/): "CRT Screen Static Sparks" by SiriusBizdness (https://freesound.org/people/SiriusBizdness/sounds/565193/) and "Sparks.wav" by Juan_Matthys_OW (https://freesound.org/people/Juan_Matthys_OW/sounds/655732/).

| | |
|---|---|
| **File** | `public/assets/audio/spark-1.mp3`, `spark-2.mp3`, `spark-3.mp3` |
| **Manifest key** | `sfx:spark-1`, `sfx:spark-2`, `sfx:spark-3` |
| **Used for** | The corrupted drive sparking on each hop (`EvilSignal`), one picked at random |
| **Modifications** | The recordings mixed and cut into three short clips |

### Evil signal hum

"mechanical hum.wav" (https://freesound.org/people/patchytherat/sounds/531562/) by patchytherat on Freesound is Creative Commons 0 — free to use, attribution not required, credited here anyway.

| | |
|---|---|
| **File** | `public/assets/audio/evil-hum.mp3` |
| **Manifest key** | `sfx:evil-hum` |
| **Used for** | The faint hum while a corrupted drive's countdown runs (`EvilSignal`) |
| **Modifications** | Cut to a short clip; crossfaded into a seamless loop at load |

### Base ambience (room tone loops)

Three room-tone loops, mixed by us from six Freesound recordings, all Creative Commons 0 — free to use, attribution not required, credited here anyway: "d0 gentle Computer hum with hard drive access" by dav0r (https://freesound.org/people/dav0r/sounds/381258/), "Interior bedroom apartment night room tone roomtone.wav" by franciscopcoutinho (https://freesound.org/people/franciscopcoutinho/sounds/466123/), "AMBIENCE_INTERIOR_WIND_NOISE_WINDOW" by pblzr (https://freesound.org/people/pblzr/sounds/816508/), "Computer Fan Loop" by Ezcah (https://freesound.org/people/Ezcah/sounds/242042/), "Computer Hum 1" by elle-trudgett (https://freesound.org/people/elle-trudgett/sounds/146949/) and "Utility room rear" by blaukreuz (https://freesound.org/people/blaukreuz/sounds/212780/).

| | |
|---|---|
| **File** | `public/assets/audio/interior-base-ambience-centre-room.mp3`, `interior-base-ambience-server-room.mp3`, `interior-base-ambience-bed-room.mp3` |
| **Manifest key** | `sfx:interior-base-ambience-centre-room`, `sfx:interior-base-ambience-server-room`, `sfx:interior-base-ambience-bed-room` |
| **Used for** | Room tone (`Ambience`): the main office, the server room, the living quarters |
| **Modifications** | Layered and mixed down into three loops; each cut to its first 60 s at an MPEG frame boundary (no re-encode) to keep decoded memory down; at load, each loop's tail is crossfaded into its head so it repeats cleanly (`blendLoopSeam`) |

### Exterior wind

One wind loop, mixed by us from four Freesound recordings, all Creative Commons 0 — free to use, attribution not required, credited here anyway: "Perpignan outdoor wind - 2024 12 08" by Sadiquecat (https://freesound.org/people/Sadiquecat/sounds/773670/), "Ambient Rumble" by Robo9418 (https://freesound.org/people/Robo9418/sounds/840409/), "Wind Over Holehead Hill" by Sandy-Ogilvie (https://freesound.org/people/Sandy-Ogilvie/sounds/847257/) and "AMBIENCE_INTERIOR_WIND_NOISE_WINDOW" by pblzr (https://freesound.org/people/pblzr/sounds/816508/).

| | |
|---|---|
| **File** | `public/assets/audio/exterior-base-ambience-wind.mp3` |
| **Manifest key** | `sfx:exterior-base-ambience-wind` |
| **Used for** | The wind outside the base, blown harder in a sandstorm (`Ambience`) |
| **Modifications** | Layered and mixed down into one 70 s loop; renamed; at load, the tail is crossfaded into the head so it loops cleanly (`blendLoopSeam`) |

### Tension music

"Lost in a bad place (horror ambience loop)" (https://opengameart.org/content/lost-in-a-bad-place-horror-ambience-loop) by congusbongus on OpenGameArt is used under CC0 — free to use, attribution not required, credited here anyway.

| | |
|---|---|
| **File** | `public/assets/audio/interior-base-spooky-music.mp3` |
| **Manifest key** | `sfx:interior-base-spooky-music` |
| **Used for** | Music that creeps in under a scare (`Ambience.setTension`) |
| **Modifications** | Renamed; at load, the tail is crossfaded into the head so it loops cleanly (`blendLoopSeam`) |

### Ambient music

"Space Ambient" (https://pixabay.com/music/ambient-space-ambient-354085/) by YuraSoop is used under the Pixabay Content License — free to use, attribution not required, credited here anyway. Downloaded as `yurasoop-space-ambient-354085.mp3`.

| | |
|---|---|
| **File** | `public/assets/audio/interior-base-ambient-music.mp3` |
| **Manifest key** | `sfx:interior-base-ambient-music` |
| **Used for** | The main menu's music (`MenuMusic`) |
| **Modifications** | Renamed; played at 0.07 of its file level; at load, the tail is crossfaded into the head (`blendLoopSeam`) |

### Giant spider walking

"Giant Spider Walking" (https://pixabay.com/sound-effects/giant-spider-walking-504034/) by Dragon Studio is used under the Pixabay Content License — free to use, attribution not required, credited here anyway. Downloaded as `dragon-studio-giant-spider-walking-504034.mp3`; the link is built from that name and still needs checking.

| | |
|---|---|
| **File** | `public/assets/audio/spider-walking.mp3` |
| **Manifest key** | `sfx:spider-walking` |
| **Used for** | Ragno's legs, indoors (`Ragno`) |
| **Modifications** | Renamed; looped, its playback rate following his speed |

### Spider call

"Spider Call" (https://pixabay.com/sound-effects/spider-call-71921/), uploaded to Pixabay by freesound_community, is used under the Pixabay Content License — free to use, attribution not required, credited here anyway. Downloaded as `freesound_community-spider-call-71921.mp3`; the link is built from that name and still needs checking.

| | |
|---|---|
| **File** | `public/assets/audio/spider-call.mp3` |
| **Manifest key** | `sfx:spider-call` |
| **Used for** | Ragno outside (`Ragno`): its soft chirps, and its loud bursts pitched down as a rare screech |
| **Modifications** | Renamed; cut at load into its separate sounds (`findBursts`), played one at a time, low-passed |

### Spider attacks

"Spider Attack 2", "Spider Attack 4" and "Spider Attack 8" (https://pixabay.com/sound-effects/spider-attack-2-482539/, https://pixabay.com/sound-effects/spider-attack-4-482536/, https://pixabay.com/sound-effects/spider-attack-8-482541/) by yodguard are used under the Pixabay Content License — free to use, attribution not required, credited here anyway. Downloaded as `yodguard-spider-attack-2-482539.mp3`, `yodguard-spider-attack-4-482536.mp3` and `yodguard-spider-attack-8-482541.mp3`; the links are built from those names and still need checking.

| | |
|---|---|
| **File** | `public/assets/audio/spider-attack-2.mp3`, `spider-attack-4.mp3`, `spider-attack-8.mp3` |
| **Manifest key** | `sfx:spider-attack-2`, `sfx:spider-attack-4`, `sfx:spider-attack-8` |
| **Used for** | Ragno flinching from a flash or setting off after the player (2 and 4), and catching them (8) (`Ragno`) |
| **Modifications** | Renamed; of the third, only its loud part plays (`loudSpan`) |

### Coffee machine running

"Coffee Machine Motor" (https://freesound.org/people/Dwums96/sounds/338130/) by Dwums96, from Freesound under CC0 1.0 (public domain) — attribution not required, credited here anyway.

| | |
|---|---|
| **File** | `public/assets/audio/coffee-machine.mp3` |
| **Manifest key** | `sfx:coffee-machine` |
| **Used for** | The bedroom's coffee machine while a cup brews (`CoffeeSound`) |
| **Modifications** | Cut to 20 s, a brew's length |

### Bean processor grinding

"Espresso Machine (Automated)" (https://freesound.org/people/ultradust/sounds/167506/) by ultradust, from Freesound, is used under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/): credit required.

| | |
|---|---|
| **File** | `public/assets/audio/coffee-grinding.mp3` |
| **Manifest key** | `sfx:coffee-grinding` |
| **Used for** | The office's bean processor while it processes a pile of beans (`ProcessorSound`) |
| **Modifications** | Renamed; cut to 5 s of its grind, a pile's length |

### Coffee beans

"shaking beads in a plastic container.wav" (https://freesound.org/people/__bernicetredoux/sounds/655302/) by __bernicetredoux, from Freesound, is used under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/): credit required.

| | |
|---|---|
| **File** | `public/assets/audio/beans.mp3` |
| **Manifest key** | `sfx:beans` |
| **Used for** | A pile of coffee beans knocked, picked up or taken in by the bean processor (`ImpactSound`, `IMPACT_SOUNDS.beans`) |
| **Modifications** | Renamed and shortened to three shakes, each played on its own |

### Coffee slurp

"Coffee Slurping" (https://freesound.org/people/redcheek/sounds/251984/) by redcheek, from Freesound under CC0 1.0 (public domain) — attribution not required, credited here anyway.

| | |
|---|---|
| **File** | `public/assets/audio/slurp.mp3` |
| **Manifest key** | `sfx:slurp` |
| **Used for** | A coffee drunk at the bedroom's machine (`BaseScene._addStamina`) |
| **Modifications** | Renamed |

### Globe spinning

"SpinningGlobeSound1" (https://freesound.org/people/TunaBombs/sounds/848502/) by TunaBombs, from Freesound, is used under CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/): credit required, no commercial use. Downloaded as `848502__tunabombs__spinningglobesound1.wav`.

| | |
|---|---|
| **File** | `public/assets/audio/globe-spin.wav` |
| **Manifest key** | `sfx:globe-spin` |
| **Used for** | The desk globe spun (`GlobeSound`) |
| **Modifications** | Renamed; trimmed to start on the push, its last 20 ms faded out; otherwise as recorded |

### Footsteps

"Heavy_step" (https://freesound.org/people/Hair_fire22/sounds/668818/) by Hair_fire22, from Freesound, used under CC BY-NC 4.0 (https://creativecommons.org/licenses/by-nc/4.0/): credit required, no commercial use. "Step on dead leaf.aif" (https://freesound.org/people/nextmaking/sounds/86015/) by nextmaking, from Freesound, used under Sampling+ 1.0 (https://creativecommons.org/licenses/sampling+/1.0/): transformed and credited.

| | |
|---|---|
| **File** | `public/assets/audio/steps.mp3` |
| **Manifest key** | `sfx:steps` |
| **Used for** | The player's footsteps (`Footsteps`): the heavy steps indoors, the leaf steps layered under them outside |
| **Modifications** | Cut into steps and joined into one file; low-passed and played well under their level in game |

### Footsteps on wood

"Wood Thud Underfoot.wav" (https://freesound.org/people/spookymodem/sounds/202106/) by spookymodem, from Freesound under CC0 1.0 (public domain) — attribution not required, credited here anyway.

| | |
|---|---|
| **File** | `public/assets/audio/steps-wood.mp3` |
| **Manifest key** | `sfx:steps-wood` |
| **Used for** | The player's footsteps on a desk or a table (`Footsteps`) |
| **Modifications** | Two of its thuds cut out and joined, faded at their ends, raised 8.2 dB to the interior steps' level, converted to mp3 |

### Ragno in the vents

"metal thing kicking hits thud rattle harder end.flac" (https://freesound.org/people/kyles/sounds/455809/) by kyles and "metal-thud.wav" (https://freesound.org/people/CaptainYulef/sounds/638613/) by CaptainYulef, both from Freesound under CC0 1.0 (public domain) — attribution not required, credited here anyway.

| | |
|---|---|
| **File** | `public/assets/audio/ragno-vents.mp3` |
| **Manifest key** | `sfx:ragno-vents` |
| **Used for** | Ragno crawling through a duct (`Ragno`, `DuctCrawl`): his steps, and thuds and creaks layered over them |
| **Modifications** | Snippets of both cut and joined into one mono file; played in pieces (`DUCT_CRAWL`), each pitched a little apart |


## Candidate links — upcoming assets

Not downloaded yet; kept here so the links survive. Move each into a proper
entry when its file lands in `public/assets/`.

- **Power box** — https://skfb.ly/onTVS (noted: fairly high poly)
- **Drive wiper** — link TBD
- **Sleep demon** — https://skfb.ly/pzR9J, https://skfb.ly/pGvqH,
  https://skfb.ly/oESrR, https://skfb.ly/oWApE (noted: high poly)
- **Wisps** — links TBD
- **Camera entity** — https://skfb.ly/pwTAH (noted: high poly)
- **Environment (alien foliage, terraformed Mars)** — links TBD
