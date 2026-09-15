# JSON Hierarchy Loading — Known Issues (Feature Disabled)

> **Status:** The Load feature is **disabled at the UI level** as of Sept 2026.
> The Load button was removed from `_buildUI` in `src/editor/LevelEditor.js`.
> The underlying methods still exist, are unit-tested, and can be re-enabled,
> but round-tripping a saved JSON back into the live scene has two unresolved
> visual bugs that no one has had time to chase down. This document is the
> handoff for whoever picks it up.

---

## Background: what the feature was supposed to do

**Save All** downloads two files:

| File | Content |
|---|---|
| `<Scene>.hierarchy.json` | Every editable object: name, world transform, group membership, assetKey/shapeType, collider, glow, colour, hidden, light data, materialProps |
| `<Scene>.js` | A generated Scene class (reference/scaffold only — see TEAM-EDITOR-GUIDE.md) |

**Load** opened a file picker and applied the JSON with two strategies:

1. **Delta mode** — `_applyHierarchyDelta(data)` in `LevelEditor.js` (~line 716).
   Matches JSON entries to *existing* GameObjects by name, then applies only
   transform / glow / visibility changes. Objects not in the JSON are left
   untouched. This mode was designed to preserve hand-authored visuals
   (textures, lights, Satellite steering, Interactable components).
2. **Full rebuild** — `_applyHierarchy(data)` (~line 676). Clears everything
   editable and recreates it via `_instantiateEntry`. Lossy: any object
   without a manifest `assetKey` or a `light` entry comes back as a grey box.
   Only kept as fallback for malformed data.

Delta mode is the interesting one. It is also the one with the surviving bugs.

---

## Bugs fixed during the Sept 2026 session (context for the remaining ones)

These were all found and patched. They are listed because each fix interacts
with the remaining issues, and because re-introducing any of them is easy.

1. **Duplicate-name entries from GLB internals.** `GameObject.fromObject3D`
   (`src/core/GameObject.js`) wraps *every* Object3D child of a cloned GLB
   into a child GameObject. The `dish_tower` model contains an internal part
   also named "Satellite". The serializer then wrote two entries named
   "Satellite", and name-matching in the delta loader matched the wrong one,
   teleporting the satellite to origin.
   *Fix:* `_generateJSON` skips children of objects with a `physicsAssetKey`
   (imported models are atomic).

2. **Colour resets on models and lights.** The delta loader called
   `_setObjectColor` on every matched object, which traverses all meshes and
   overwrites `material.color` — tinting imported-model textures and
   clobbering light GameObjects.
   *Fix:* colour is only applied when the object is neither an imported model
   (`physicsAssetKey`) nor a light carrier (`_findSceneLight`).

3. **Emissive corruption on imported models.** `_setGlow` saved
   `mat._originalEmissive` then overwrote emissive on *every* mesh, including
   GLB models whose materials are shared from the asset cache. On delta-load
   this captured a wrong "original" and corrupted material state.
   *Fix:* `_setGlow` skips emissive manipulation entirely when
   `go.physicsAssetKey` is set — glow on imported models is light-only.

4. **World/local transform mismatch (CeilingLight shift).** The serializer
   originally stored `obj.position` (local). The editor had moved the
   *parent* `CeilingLight` GameObject to where the child PointLight visually
   sat, so on reload the child's local offset compounded with the parent's
   new position → light ended up ~2× too high.
   *Fix:* `_generateJSON` now stores **world-space** position/rotation/scale
   (via `getWorldPosition`/`getWorldQuaternion`/`getWorldScale`), and
   `_applyHierarchyDelta` converts back to local with
   `obj.parent.worldToLocal(...)` + inverse parent quaternion premultiply.

---

## Bugs that STILL reproduce (why Load was disabled)

After all fixes above, loading a freshly-saved JSON still shows:

### Issue A — "Textures/lighting inverted" around Fullbright

**Repro:** toggle Fullbright (B) off and on a few times after a JSON load.
Some objects look correct in Fullbright (unlit) mode but wrong when it is
off — or the reverse. Random-ish, per-object.

**Where to look:** the interaction between the delta loader's material
mutations and `src/core/Fullbright.js`.

**Root-cause hypotheses (ranked):**

1. **Mutating Fullbright twins instead of originals.** Fullbright swaps every
   `MeshStandardMaterial` for a cached `MeshBasicMaterial` twin. If a JSON
   load runs while Fullbright is ON, `_setGlow` / `_setObjectColor` traverse
   meshes holding the *twins*. The twins are disposed on toggle-off, so any
   mutation is silently discarded — but `_originalEmissive` markers get
   written onto the twin, never onto the original. Toggling Fullbright after
   a load therefore desynchronises which material instance holds the
   `_originalEmissive` snapshot. Candidate fix: make the delta loader a
   Fullbright-aware operation (defer material mutations until Fullbright is
   off, or route mutations through Fullbright so they hit both twin and
   original), and/or call `fullbright.refresh()` at the end of the delta load
   (note: `Engine.spawnModel` already does this for spawned meshes).

2. **Shared-material `_originalEmissive` ownership.** Asset-cache clones
   *share* materials (AGENTS.md ownership rule). The `_originalEmissive`
   snapshot lives on the material instance, not the object. If two objects
   share a material and the delta loader disables glow on one, the restore
   writes the snapshot back for *both* — or worse, the second object's
   `_setGlow(enabled=true)` re-snapshots an already-glow-tinted material as
   the "original". A per-object (or per-mesh-node) snapshot keyed by
   `userData` on the GameObject rather than the material would fix this, at
   the cost of memory duplication.

3. **Scene-light adoption leaks.** `_setGlow(go, true)` *adopts* any untagged
   child PointLight (tags it `_editorGlowLight`) and mutates its colour/
   intensity/distance. `_setGlow(go, false)` then *removes* it. If the JSON
   says `glow.enabled: false` for an object whose scene-authored light (e.g.
   `DeskGlow`) was adopted during an earlier edit, the loader deletes a
   hand-authored light permanently. Check the `else if` branch in
   `_applyHierarchyDelta`'s glow handling.

### Issue B — "Slight shifting" of some objects after load

**Repro:** load a JSON saved in the same session; some objects (reported:
ceiling light, security cameras) are offset by a small amount.

**Root-cause hypotheses (ranked):**

1. **Stale parent matrixWorld during world→local conversion.** The delta
   loader calls `obj.updateMatrixWorld(false)` on the *object*, but
   `obj.parent.worldToLocal()` requires the **parent chain's** matrixWorld to
   be current. If a parent group's matrixWorld is stale (e.g. its transform
   was also just applied in the same loop, but with `updateMatrixWorld(false)`
   which only updates the object itself, not descendants), the conversion
   bakes in wrong offsets. Candidate fix:
   `obj.parent.updateMatrixWorld(true)` before each `worldToLocal`, or update
   the whole sceneRoot once before the walk.

2. **Euler order / gimbal re-decomposition.** The serializer decomposes the
   world quaternion into an Euler with order `'XYZ'` and the loader rebuilds
   a quaternion from that Euler assuming `'XYZ'`. For objects with compound
   rotations (security cameras have X+Y), a world quaternion that was
   authored as a *different* euler order decomposes to an equivalent-but-
   numerically-different XYZ euler. This is mathematically lossless for the
   quaternion, but the JSON *stores the euler*, and any future code reading
   those numbers as the object's rotation (e.g. the generated .js) gets a
   different euler representation. If any code path applies the euler
   directly instead of through the quaternion conversion, tiny rotations
   appear. Storing the quaternion (x,y,z,w) in the JSON and only converting
   at the boundary would remove the whole class of issue.

3. **Order-of-application within one walk.** `applyDelta` recurses
   depth-first and applies parent transforms before children. Because each
   step does world→local conversion against the *current* parent pose, moving
   a parent then converting a child is only correct if the parent's new pose
   has propagated to `matrixWorld` first (same as hypothesis 1 — this is the
   concrete mechanism by which it manifests).

4. **Physics-side interpolation.** Dynamic objects go through
   `_syncSingleTransformToPhysics` (teleport). If the fixed-step loop's
   interpolation snapshot was taken between the visual move and the physics
   sync, a one-frame-old pose can render. Verify against
   `Engine.rigidBodyMap` sync code; only relevant for dynamic objects.

---

## Structural limitation worth knowing before investing more

Name-matching is the only identity mechanism (`existingByName` keeps the
*first* object for any duplicate name). Any two objects with the same name —
editor-created duplicates, GLB internals (now excluded, but only for
`physicsAssetKey` carriers) — silently collide. A durable fix would give every
GameObject a stable `editorId` (UUID) at creation/first-edit time and store
*that* in the JSON instead of relying on names.

---

## How to re-enable and test

1. **Re-add the button** in `_buildUI` (`src/editor/LevelEditor.js`), next to
   the `.js` button:

   ```js
   const loadBtn = document.createElement('button');
   loadBtn.id = 'load-hierarchy-btn';
   loadBtn.textContent = '\u{1F4C2} Load';
   loadBtn.onclick = () => this._loadHierarchy();
   saveRow.appendChild(loadBtn);
   ```

2. **Flip the test** — `LevelEditor.test.js`, describe `button dedupe`, test
   `'panel keeps Save All, .json and .js, and has no Load button'` asserts the
   button is absent; invert the last assertion.

3. **Unit tests:** `npx vitest run src/editor/LevelEditor.test.js`
   (~200 tests, all currently green). The delta loader has dedicated tests in
   the `delta hierarchy loading` describe block.

4. **Manual repro loop** (the part tests do NOT cover — jsdom can't render):

   ```
   npm run dev
   F2 → edit something → Save All → F2 → Load the fresh .hierarchy.json
   Toggle B (Fullbright) off/on several times → compare against pre-save state
   Walk the room; check ceiling light, security cameras, satellite.
   ```

   Compare console logs: `[LevelEditor] Delta load: matched N/M existing
   objects` — anything below M means entries fell through to
   `_instantiateEntry` (which spawns boxes for unknowns).

---

## File map

| Concern | Location |
|---|---|
| Load entry point (no UI) | `LevelEditor._loadHierarchy` |
| Delta loader | `LevelEditor._applyHierarchyDelta` |
| Full rebuild loader | `LevelEditor._applyHierarchy` / `_instantiateEntry` |
| JSON serializer (world-space) | `LevelEditor._generateJSON` |
| Glow / emissive | `LevelEditor._setGlow`, `_findGlowLight`, `_findSceneLight` |
| Colour | `LevelEditor._setObjectColor`, `_getObjectColor` |
| Fullbright material swap | `src/core/Fullbright.js` |
| GLB → child GameObject wrapping | `GameObject.fromObject3D` in `src/core/GameObject.js` |
| Scene under test | `src/scenes/OfficeScene.js` (hand-authored reference scene) |
