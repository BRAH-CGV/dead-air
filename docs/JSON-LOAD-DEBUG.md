# JSON Hierarchy Loading

> **Status (30 Sept 2026):** the Load button is back in the editor's save row
> (`#load-hierarchy-btn`). The two issues that got it switched off, A and B
> below, are fixed under BUG-R5, and each cause has a unit test. **It has not
> been checked in a browser yet.** jsdom can't render, so run the manual loop
> at the end of this page before trusting a load with real work.

---

## What the feature does

**Save All** downloads two files:

| File | Content |
|---|---|
| `<Scene>.hierarchy.json` | Every editable object: name, world transform, group membership, assetKey/shapeType, collider, glow, colour, hidden, light data, materialProps |
| `<Scene>.js` | A generated Scene class (reference/scaffold only, see TEAM-EDITOR-GUIDE.md) |

**Load** opens a file picker and applies the JSON in one of two ways:

1. **Delta mode**, `_applyHierarchyDelta(data)`. It matches the JSON's
   entries to the GameObjects already in the scene and gives each back its
   saved transform, colour, glow and visibility. Objects the JSON doesn't
   mention are left alone, so hand-authored visuals survive: textures,
   lights, the Satellite's steering, Interactable components. Entries with no
   match are spawned through `_instantiateEntry`.
2. **Full rebuild**, `_applyHierarchy(data)`. It clears everything editable
   and recreates it through `_instantiateEntry`. It is lossy: an object with
   no manifest `assetKey` and no `light` entry comes back as a grey box.
   `_loadHierarchy` only reaches it when delta mode rejects the data.

The scene source is still what ships. A load picks an editing session back
up; it does not make the change permanent.

---

## How an entry finds its object

An entry takes the first *unclaimed* child with its name under the object
its parent entry matched. Two rooms' `Ceiling`s each find their own, and a
row of `Crate`s pair up in order. When no such child exists, the entry takes
the one object in the whole scene with its name, but only if exactly one
object has it. That covers an object moved to another parent since the save.
When nothing matches, the entry is spawned.

Imported models' parts are never matched. `_generateJSON` doesn't write them
(see fix 1 below), and the loader doesn't index them.

Names are still the only identity. Renaming an object since the save breaks
its match, and the entry spawns a copy. A durable fix would give every
GameObject a stable `editorId` at creation and store that instead.

---

## Fixed

### Before BUG-R5

These were found and patched first. Each one interacts with the later
fixes, and each is easy to reintroduce.

1. **Duplicate-name entries from GLB internals.** `GameObject.fromObject3D`
   wraps every Object3D child of a cloned GLB in a child GameObject. The
   `dish_tower` model has an internal part that is also named "Satellite",
   so the serializer wrote two "Satellite" entries and the loader teleported
   the dish to the origin.
   *Fix:* `_generateJSON` skips the children of objects that have a
   `physicsAssetKey`, so imported models are atomic.
2. **Colour resets on models and lights.** The loader coloured every matched
   object, tinting model textures and overwriting light carriers.
   *Fix:* colour only applies to an object that is neither an imported model
   (`physicsAssetKey`) nor a light carrier (`_findSceneLight`).
3. **Emissive corruption on imported models.** `_setGlow` overwrote the
   emissive on shared asset-cache materials.
   *Fix:* on imported models, glow only adds a light and leaves the
   materials alone.
4. **World-space save.** `_generateJSON` stores world position, rotation and
   scale, so a parent moved in the editor doesn't compound with its child's
   local offset.

### BUG-R5

**Issue A: colours and glow lost, "inverted", or deleted around Fullbright**

- **Edits hit the unlit twins.** With Fullbright on, every lit material is
  swapped for a `MeshBasicMaterial` twin. A colour or glow loaded then was
  written to the twin, and thrown away when the mode was turned off.
  *Fix:* `_withLitMaterials(fn)` turns Fullbright off for the edit and back
  on after it. That rebuilds the twins from the edited originals, hides any
  light the edit made, and makes twins for meshes the load spawned. It wraps
  both loaders, `_setGlow` and `_setObjectColor`, so the colour picker is
  covered too. A nested call is safe, since the mode is already off inside.
- **Adopted scene lights were deleted.** Turning glow on for an object with
  a scene-authored PointLight (such as `DeskGlow`) adopts that light by
  tagging it. A save made *before* the adoption lists it as `entry.light`
  with glow off, and the loader then removed the tagged light for good.
  *Fix:* when the save has glow off and a `light` of the same type, the
  loader gives the light back with `_restoreSceneLight`: it is untagged, and
  gets the saved colour, intensity, range, decay and shadow flag.
  `_restoreEmissive` puts the material's emissive back. It was split out of
  `_setGlow`'s disable branch.

**Issue B: objects shifted after a load**

- **Scale was applied as local.** The save has world scale, and the loader
  wrote it straight into `scale`. Under a parent scaled ×2, a child came
  back twice its size.
- **Parent matrices were stale.** `updateMatrixWorld(false)` on the object
  doesn't update its parents, so a child could be converted against a pose
  its parent had already left.
- **Groups never moved.** Only their children were put back.
- **Spawned entries took world values as local.** Under a group 10 m along,
  a spawned object landed 10 m further on.
- **Same-name objects collided.** Only the first object with a name was
  indexed, so every entry with that name moved it.

*Fix:* all of these go through `_applySavedTransform(obj, entry)`. It brings
the parent chain up to date (`updateWorldMatrix(true, false)`), composes the
saved world matrix and multiplies it by the parent's inverse. It then
decomposes the result into position, quaternion and scale, and uses scratch
objects so a big load allocates nothing per object. It is applied parents
first, to groups, matched objects, spawned entries and dynamic objects
alike. The matching is described above.

### Still open, untested

- **Shared-material emissive snapshots.** `_originalEmissive` lives on the
  material. If two procedural objects share a material, glowing one glows
  both, and a restore on one restores both. This happens in the editor
  itself, not just in a load. A per-mesh snapshot in `userData` would fix it.
- **Euler storage.** The JSON stores rotation as an XYZ Euler of the world
  quaternion. The loader rebuilds the quaternion from it, so a round trip is
  exact. Anything that reads those numbers as an authored Euler (for example
  the generated `.js`) may see an equivalent but different triple. Storing
  the quaternion would remove the question.
- **Physics interpolation.** Dynamic objects are teleported with
  `_syncSingleTransformToPhysics`. If an interpolation snapshot lands between
  the visual move and the sync, a one-frame-old pose could render. This has
  not been observed.

---

## Testing

1. **Unit tests:** `npx vitest run src/editor/LevelEditor.test.js`. The
   loader's tests are in the `delta hierarchy loading` describe block. The
   BUG-R5 ones start at "BUG-R5: what a save-then-load still got wrong", and
   `with Fullbright on (issue A)` runs a real `Fullbright` over the editor's
   scene.
2. **Manual loop** (what the tests can't cover):

   ```
   npm run dev
   F2 → edit something → Save All → F2 → Load the fresh .hierarchy.json
   Toggle B (Fullbright) off/on several times → compare against pre-save state
   Load again with Fullbright on → toggle it off → compare again
   Walk the room; check ceiling light, security cameras, satellite, DeskGlow.
   ```

   Check the console for `[LevelEditor] Delta load: matched N/M existing
   objects`. N counts the objects the JSON found. M counts every object the
   scene offered, including ones added since the save, so N < M is normal
   after adding objects. A warning from `_instantiateEntry`, or a
   `placeholder 1³ box` line, means an entry found nothing and was rebuilt.

---

## File map

| Concern | Location |
|---|---|
| Load button, file picker | `LevelEditor._buildUI` (`#load-hierarchy-btn`), `_loadHierarchy` |
| Delta loader, matching | `LevelEditor._applyHierarchyDelta` |
| World transform → local | `LevelEditor._applySavedTransform` |
| Colour, glow, hidden on a match | `LevelEditor._applySavedState` |
| Fullbright stepping aside | `LevelEditor._withLitMaterials` |
| Full rebuild loader | `LevelEditor._applyHierarchy` / `_instantiateEntry` |
| JSON serializer (world space) | `LevelEditor._generateJSON` |
| Glow / emissive / scene lights | `LevelEditor._setGlow`, `_restoreEmissive`, `_restoreSceneLight`, `_findGlowLight`, `_findSceneLight` |
| Colour | `LevelEditor._setObjectColor`, `_getObjectColor` |
| Fullbright material swap | `src/core/Fullbright.js` |
| GLB → child GameObject wrapping | `GameObject.fromObject3D` in `src/core/GameObject.js` |
