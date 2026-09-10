# Dead Air — Level Editor & Controls Guide

Everything your team needs to know about the in-browser editor, free camera, and debug tools.

---

## Quick Reference — All Keyboard Shortcuts

| Key | What it does |
|-----|-------------|
| **F2** | Toggle Level Editor on/off |
| **V** | Toggle DebugCamera (noclip fly mode) on/off |
| **\`** (backtick) | Toggle physics collider wireframe overlay |
| **F4** | Toggle model debug logging (bounds/scale to console) |
| **B** | Toggle Fullbright (unlit debug lighting) |
| **G** | Switch to **Move** mode (editor) |
| **R** | Switch to **Rotate** mode (editor) |
| **T** | Switch to **Scale** mode (editor) |
| **Arrow Keys** | Transform selected object (editor) |
| **PageUp / PageDown** | Move up/down or rotate Z axis (editor) |
| **Delete** | Delete selected object (editor) |
| **WASD** | Walk / fly movement |
| **Space** | Ascend (DebugCamera) / Jump (normal) |
| **C** | Descend (DebugCamera) / Crouch (tap = toggle, hold = hold) |
| **Shift** | Speed boost (DebugCamera) |
| **Mouse** | Look around (pointer lock) |
| **Left Click** | Select object (editor) / Interact |

---

## Level Editor (F2)

### Getting Started

1. Press **F2** to open the editor panel on the right side of the screen
2. The game pauses pointer lock so you can click UI elements
3. Press **F2** again to close the editor and return to normal gameplay

### The Editor Panel — Top to Bottom

```
┌─────────────────────────────────┐
│  🔧 Level Editor                │  ← Title
├─────────────────────────────────┤
│  Scene: OfficeScene  *          │  ← Scene name (* = unsaved changes)
│  Switch: [OfficeScene ▼]       │  ← Scene switcher dropdown
│  [💾 Save All] [🌳 .json] [📜 .js] [📂 Load] │  ← Save/load buttons
├─────────────────────────────────┤
│  🔀 MOVE MODE (G)               │  ← Current transform mode
├─────────────────────────────────┤
│  Controls:                      │  ← Quick help
│  G: Move | R: Rotate | T: Scale│
│  Arrows: Transform | Del: Delete│
├─────────────────────────────────┤
│  BackWall_Left                  │  ← Selected object info
│  Position:                      │
│  X: [______] Y: [______] Z: [__]│  ← Editable number fields
│  Rotation (deg):                │
│  X: [______] Y: [______] Z: [__]│
│  Scale:                         │
│  X: [______] Y: [______] Z: [__]│
│  Parent: [Office ▼]            │  ← Reparenting dropdown
├─────────────────────────────────┤
│  Scene Objects:                 │
│  ▼ 📁 SceneRoot                │  ← Tree view (▼ = expanded)
│    ▼ 📁 Office                 │
│      BackWall_Left             │
│      BackWall_Right            │
│      ComputerDesk              │
│      ...                       │
│    ▼ 📁 Outside                │
│      Ground                    │
│    ▼ 📁 Lighting               │
│      AmbientLight              │
│      ...                       │
│    Crate_A                     │  ← Dynamic objects (outside groups)
│    Crate_B                     │
├─────────────────────────────────┤
│  [➕ Create Group]              │  ← New group button
├─────────────────────────────────┤
│  [+ Add Object…]                │  ← Manifest models & primitives
└─────────────────────────────────┘
```

### Selecting Objects

- **Click in the 3D view** to select an object (left mouse button)
- **Click in the tree view** to select any object in the hierarchy
- Selected object highlights blue in the tree
- Info panel shows position/rotation/scale for the selected object

### Transform Modes

Press these keys to switch modes:

| Key | Mode | What arrows do |
|-----|------|----------------|
| **G** | Move | ←→ = X axis, ↑↓ = Z axis, PgUp/PgDn = Y axis |
| **R** | Rotate | ←→ = Y axis, ↑↓ = X axis, PgUp/PgDn = Z axis |
| **T** | Scale | ↑/→ = grow, ↓/← = shrink (uniform) |

Each key press moves/rotates/scales by a small amount (0.01 units). Hold the key for continuous movement.

### PageUp and PageDown

These keys handle the **vertical axis** (Y) that arrow keys can't reach:

- **In Move mode**: PageUp = move UP, PageDown = move DOWN
- **In Rotate mode**: PageUp = rotate Z clockwise, PageDown = rotate Z counter-clockwise
- **In Scale mode**: not used (scale is uniform)

> **Tip:** On some laptops, PageUp/PageDown requires holding **Fn** + Up/Down arrow keys.

### Editing Values Directly

Click any number in the info panel to edit it precisely:

1. Click the value field (e.g., the X position number)
2. Type a new value
3. Press Enter or click away to apply

Changes apply immediately. The physics colliders update to match.

### Reparenting (Changing an Object's Parent)

1. Select the object you want to move
2. In the info panel, find the **Parent:** dropdown
3. Select a new parent group
4. The object moves under that group (preserving its world position)

---

## Hierarchies & Groups

### How the Scene is Organized

```
SceneRoot
├── Office              ← All room geometry (walls, windows, furniture)
│   ├── BackWall_Left
│   ├── BackWall_Right
│   ├── FrontWall_Left
│   ├── LeftWall
│   ├── RightWall
│   ├── Ceiling
│   ├── WindowFrame_TOP
│   ├── ComputerDesk
│   ├── ServerRack
│   ├── RadarTerminal
│   ├── Switchboard
│   └── SecurityCamera_Window / _Door / _Desk
├── Outside             ← Exterior elements
│   └── Ground
├── Lighting            ← All lights
│   ├── AmbientLight
│   ├── MoonLight
│   ├── CeilingLight
│   ├── DeskGlow
│   ├── VisibleMoon
│   └── MoonGlow
├── Crate_A             ← Dynamic objects (at root, not in any group)
└── Crate_B
```

### Why Groups Matter

- **Moving a group moves ALL its children.** Move "Office" and the walls, windows, and furniture all move together.
- **Moving SceneRoot moves everything** (the entire scene).
- Children can still be selected and moved individually.

### Expanding / Collapsing Groups

- Click the **▼** arrow next to a group to **collapse** it (hide children)
- Click the **▶** arrow to **expand** it (show children)
- Groups start expanded when the editor opens

### Creating a New Group

1. Click the **➕ Create Group** button
2. Type a name for the group (e.g., "MyProps")
3. The group appears under SceneRoot in the tree
4. Select objects and use the **Parent:** dropdown to move them into your new group

### Group Transform

When you select a **group** (folder icon in the tree), the info panel shows the same position/rotation/scale fields as individual objects. Changing these transforms the entire group — all children move together.

---

## Saving & Exporting Levels

### The Quick Save Workflow

1. Make your changes in the editor (move objects, create groups, reparent, etc.)
2. You'll see an orange **\*** appear next to the scene name — that means unsaved changes
3. Click **💾 Save All** — this downloads two files:
   - `OfficeScene.hierarchy.json` — the layout data (positions, rotations, parent-child structure)
   - `OfficeScene.js` — a complete JavaScript scene file
4. The **\*** disappears

### What Each Button Does

| Button | Downloads | Use when |
|--------|-----------|----------|
| **💾 Save All** | Both .json + .js | Your go-to save button. Gets everything. |
| **🌳 .json** | Just the hierarchy JSON | When you want to back up the layout data only |
| **📜 .js** | Just the JavaScript scene file | When you want the code file only |
| **📂 Load** | Nothing — it *opens* a file picker | **Rebuild a saved .hierarchy.json in the editor** and keep editing |

### How to Use the Saved Files

**📂 Load is the main workflow now.** Save your layout as `.hierarchy.json`, then
load it back any time to continue where you left off — the editor rebuilds the
groups, objects, transforms, colliders, glow, colours and hidden state exactly
as they were. No copy-pasting required.

> ⚠️ **Loading replaces the current editable scene.** Objects the editor can
> rebuild (groups, editor-added primitives, manifest models) come back fully;
> hand-coded scene content (procedural walls, `Interactable` wiring, the
> `Satellite` class) is not part of the JSON — those still live in the scene's
> source file. Treat Load as "restore my editor work", not "replace the scene".

**The .js file** contains a complete Scene class that mirrors your editor
layout — useful as a reference or scaffold for new scenes. To use it as a real
scene, place it in `src/scenes/` and register it with the engine. Don't paste
it into an existing scene's `build()` method — the imports won't work there.

**The .json file** is the round-trip format. It stores:
- Every object's name, position, rotation, and scale
- The group hierarchy (which objects are children of which groups)
- Editor state per object: collider on/off, glow (colour/intensity/range), object colour, hidden
- Which objects are dynamic (physics-driven) vs static

### The `*` Dirty Indicator

When you see an orange **\*** next to the scene name, it means you have **unsaved changes**. It disappears after you save.

### Scene Switcher

The dropdown lets you switch between registered scenes. Selecting a different scene loads it and refreshes the editor.

---

## Adding New Objects to a Scene

This section is for anyone who wants to add new 3D models, lights, walls, or boxes to a level. There are three main approaches depending on what you're adding.

### Option A: Adding a 3D Model (.glb file)

This is for imported models like furniture, props, decorations, characters, etc.

**Step 1 — Get the model file**

- The model must be a `.glb` file (single file, not `.gltf` with loose files)
- It must NOT be Draco or Meshopt compressed
- Model it in Blender with: origin at the floor centre, +Y up, measured in metres
- Export as `.glb` from Blender (File → Export → glTF 2.0 → select .glb format)

**Step 2 — Add it to the project**

1. Drop the `.glb` file into `public/assets/models/`
2. Name it in **lowercase with hyphens** (e.g. `office-chair.glb`) — the server is case-sensitive
3. Open `src/assets/manifest.js`
4. Add a new entry:

```js
'model:office-chair': {
  type: 'model',
  url: 'assets/models/office-chair.glb',
  physics: 'static',    // 'static' = solid scenery. Remove this line for render-only (no collision)
},
```

**Step 3 — Spawn it in the scene**

Open your scene file (e.g. `src/scenes/OfficeScene.js`) and add inside the `build()` method or a helper:

```js
const chair = this.engine.spawnModel('model:office-chair', {
  name: 'OfficeChair',
  position: [2, 0, -1],      // [x, y, z] in metres
  rotationY: Math.PI / 2,    // facing direction (radians)
  scale: 1.0,                // uniform scale if the model needs resizing
});
this._office.addChild(chair); // put it under the Office group
```

**Physics options for models:**

| Setting | What it does |
|---------|-------------|
| `physics: 'static'` | Solid scenery you can't walk through (most props, furniture) |
| `physics: 'dynamic'` | Pushable object affected by gravity (crates, barrels) |
| No `physics` line | Render-only — visible but you walk straight through it (decorations, posters) |
| `physics: { body: 'dynamic', mass: 12 }` | Pushable with a specific weight in kg |

### Option B: Adding a Wall, Box, or Solid Surface (procedural geometry)

This is for simple box shapes made from code — walls, floors, ceilings, platforms, shelves. No model file needed.

**In your scene file**, use this pattern:

```js
// Helper: creates a box mesh + physics collider, adds it to a parent group
_addStaticBox(name, position, size, material, parent) {
  const { world } = this.engine;

  const go = new GameObject(name);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = mesh.receiveShadow = true;
  go.object3d.add(mesh);

  // Physics collider at the same position
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(...position),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2),
    body,
  );

  if (parent) parent.addChild(go);
  return go;
}
```

**How to call it:**

```js
// Create a wall: name, [x, y, z], [width, height, depth], material, parent group
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x2f3945, roughness: 0.95 });

this._addStaticBox('BackWall', [0, 1.5, -5], [12, 3, 0.2], wallMaterial, this._office);
this._addStaticBox('Floor', [0, 0, 0], [12, 0.1, 10], floorMaterial, this._outside);
this._addStaticBox('Platform', [3, 0.5, 2], [2, 0.1, 2], platformMaterial, this._office);
```

**Parameters:**

| Parameter | What it means | Example |
|-----------|--------------|--------|
| `name` | Display name (shows in editor tree) | `'BackWall'` |
| `position` | Centre of the box `[x, y, z]` in metres | `[0, 1.5, -5]` |
| `size` | Full dimensions `[width, height, depth]` in metres | `[12, 3, 0.2]` |
| `material` | Three.js material (colour, texture, etc.) | See below |
| `parent` | Which group to put it under | `this._office`, `this._outside` |

**Creating materials:**

```js
// Simple coloured surface
const wallMat = new THREE.MeshStandardMaterial({ color: 0x2f3945, roughness: 0.95 });

// Textured surface
const floorMat = new THREE.MeshStandardMaterial({
  color: 0x8890a0,
  roughness: 0.9,
  map: assets.get('tex:floor-basecolor'),      // colour texture
  normalMap: assets.get('tex:floor-normal'),    // bump/normal texture
  normalScale: new THREE.Vector2(0.8, 0.8),
});

// Dark / metallic surface
const metalMat = new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.4, metalness: 0.8 });
```

### Option C: Adding Lights

Lights go under the **Lighting** group. Each light is wrapped in a GameObject so the editor can select and move it.

**Types of lights:**

| Type | Use for | Code |
|------|---------|------|
| **AmbientLight** | Overall scene brightness (no shadows) | `new THREE.AmbientLight(color, intensity)` |
| **DirectionalLight** | Sun / moon light (casts shadows) | `new THREE.DirectionalLight(color, intensity)` |
| **PointLight** | A light bulb, screen glow, lamp | `new THREE.PointLight(color, intensity, range, decay)` |

**How to add a light:**

```js
// Inside _addLighting() or a similar method:

// 1. Create a GameObject to hold the light
const myLightGO = new GameObject('MyNewLight');

// 2. Create the Three.js light
const myLight = new THREE.PointLight(0xffd8a8, 10.0, 24, 1.0);
//                          colour    intensity  range  decay
myLight.position.set(0, 2.75, 0.4);       // position relative to the GameObject
myLight.castShadow = true;                 // set to false for non-shadow lights (cheaper)
myLight.shadow.mapSize.set(1024, 1024);    // shadow resolution (keep at 512 or 1024)

// 3. Add the light to the GameObject
myLightGO.object3d.add(myLight);

// 4. Add the GameObject to the Lighting group
this._lighting.addChild(myLightGO);
```

**Adding a visible light fixture (the physical object):**

```js
// If you want players to SEE the light source (like a ceiling lamp):
const fixture = new THREE.Mesh(
  new THREE.CylinderGeometry(0.35, 0.45, 0.08, 24),
  new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    emissive: 0xffc36b,          // glowing colour
    emissiveIntensity: 1.8,
  }),
);
fixture.position.copy(myLight.position);   // same position as the light
myLightGO.object3d.add(fixture);           // add to the SAME GameObject as the light
```

**Light colour cheat:**

| Colour hex | Look |
|-----------|------|
| `0xffffff` | Pure white |
| `0xffd8a8` | Warm yellow (incandescent bulb) |
| `0x66ccff` | Cool blue (monitor glow) |
| `0x8fb7ff` | Moonlight |
| `0xff6633` | Orange / fire |
| `0x435472` | Dim ambient (dark blue-grey) |

**Performance tip:** Only 2–3 lights should have `castShadow = true`. Each shadow-casting light adds rendering cost. Ambient lights and distant point lights usually don't need shadows.

### Quick Recipe Card

| I want to add... | Use this approach | Key file to edit |
|------------------|-------------------|------------------|
| A new 3D model (furniture, prop) | Option A: .glb + manifest + spawnModel | `manifest.js` + scene file |
| A wall, floor, ceiling, platform | Option B: _addStaticBox | Scene file |
| A coloured box / crate | Option B: _addStaticBox | Scene file |
| A light (bulb, sun, glow) | Option C: Light + GameObject | Scene file |
| A visible lamp fixture | Option C + a Mesh | Scene file |
| A pushable object | Option A with `physics: 'dynamic'` | `manifest.js` + scene file |
| A decoration (no collision) | Option A without `physics` line | `manifest.js` + scene file |

---

## DebugCamera (V)

The DebugCamera is a noclip fly camera that lets you inspect the scene from any angle. It's not a separate FreeCam component — it detaches the actual game camera from the player, suspends all player components (movement, look, physics), and lets you fly freely.

### How to Use

1. Press **V** to toggle the DebugCamera ON
2. The player freezes in place (all components suspended)
3. Use these controls:

| Key | Movement |
|-----|----------|
| **W / S** | Fly forward / backward (follows view pitch) |
| **A / D** | Strafe left / right |
| **Space** | Ascend (go up) |
| **C** | Descend (go down) |
| **Shift** | Speed boost (4× normal) |
| **Mouse** | Look around |

4. Press **V** again to toggle OFF — the camera snaps back to the player's eyes exactly where they left off (the player never moved)

### When to Use DebugCamera

- Inspecting the scene from above or from angles you can't reach normally
- Positioning objects that are high up (lights, ceiling elements)
- Getting a cinematic view for screenshots or trailer footage
- Quick navigation across the map

---

## Debug Tools

### Physics Collider Overlay (`)

Press the **backtick key** (\`) to toggle a wireframe overlay showing every physics collider in the scene.

- Drawn in Rapier's own colours, straight over the scene
- Green/colored lines = static colliders (walls, floor, props)
- Shows you exactly what shape Rapier is using for collision
- Useful for checking if colliders match the visual geometry
- Off by default; costs nothing while hidden
- The wireframe is a fresh snapshot of the physics world every frame — if it disagrees with what you see, the *physics* is wrong, not the drawing
- Implementation: [src/core/PhysicsDebug.js](../src/core/PhysicsDebug.js)

### Model Debug Logging (F4)

Press **F4** to toggle per-model console logging. When enabled, the console shows measured bounding box, position, and scale for every loaded model. Turns the logging on and re-spawns the current scene so you get the numbers immediately.

Useful when a model lands at the wrong size or floats above the floor.

> F4 rather than F1 — Chrome and DevTools own F1, so the key never reached the game.

### Fullbright (B)

Press **B** to toggle unlit debug lighting. Every lit material is swapped for a `MeshBasicMaterial` twin showing its albedo colour at full brightness — useful for spotting texture issues or checking a scene without shadow darkness. Fog is also disabled while active.

- All standard lit materials (Standard, Physical, Phong, Lambert) are swapped for unlit twins
- Twins are cached and reused, so memory stays flat
- Unlit materials (Basic, Shader) are left alone
- Toggle off restores the original materials and fog
- Implementation: [src/core/Fullbright.js](../src/core/Fullbright.js)

### P — Recentering the Pivot

Rotation and scale happen around an object's pivot. Objects whose pivot is stale (off in a corner, or parked at the group's origin) rotate and scale around the wrong point. **P** fixes that:

- **Group selected** — the pivot moves to the **average position of the group's direct children**, and each child is offset the other way so nothing visually moves. Rotating/scaling the group now pivots around the children's centre.
- **Single object selected** — the pivot moves to the object's **own visual (bounding-box) centre**. The mesh content is shifted back so the object stays exactly where it was on screen; only the pivot moved.

After recentering, the collider is **rebuilt from the measured world bounding box**. This matters for models like the desk: their collider offset was baked at load time relative to the model's original origin, so after the pivot moves the offset would be stale and the collider would drift upward. The forced rebuild keeps the collider glued to the visual.

### Measured Colliders (What Happens Behind the Scenes)

Every transform edit syncs the physics body to match the visuals:

- **Move / rotate** — the body's world position and rotation are updated.
- **Scale** — the collider is **rebuilt by measuring the mesh's actual world bounding box**, not by trusting stored size × scale bookkeeping. Whatever the scale, parent transforms, or mesh offsets are, the collider wraps what you can see. Applies to procedural boxes (walls, window parts) and models.
- Every rebuild logs a line like:

  ```
  [LevelEditor] rebuilt collider 'Wall': size=(2.00, 4.00, 2.00) center=(5.00, 1.50, -4.00)
  ```

  If a collider ever looks misplaced, these numbers tell you whether the size or the centre is wrong.

---

## Common Workflows

### "I want to move all the office furniture together"

1. Press **F2** to open the editor
2. Click **Office** in the tree view (or click any wall/furniture in the 3D view)
3. Press **G** for Move mode
4. Use arrow keys to move everything at once

### "I want to create a custom group of objects"

1. Press **F2**, click **➕ Create Group**, name it
2. Select each object you want in the group
3. Use the **Parent:** dropdown to move each object under your new group
4. Now selecting the group moves them all together

### "I want to precisely position something"

1. Select the object
2. Click the exact value field you want to change (e.g., Position Y)
3. Type the number you want
4. Press Enter

### "I want to save my layout and use it permanently"

1. Make your changes in the editor
2. Click **💾 Save All** to download both `.hierarchy.json` and `.js`
3. Click **📂 Load** anytime to rebuild a saved `.hierarchy.json` in the editor
4. The `.js` file is a scaffold for new scenes — place it in `src/scenes/` and register it with the engine

> ⚠️ Don't paste the `.js` export into an existing scene's `build()` method — the `import` statements are module-top-only.

### "I want to add a new model to the scene"

1. Drop the `.glb` file into `public/assets/models/` (lowercase name)
2. Add it to `src/assets/manifest.js` with a key like `'model:my-prop'`
3. In the scene file, call `this.engine.spawnModel('model:my-prop', { name: 'MyProp', position: [x, y, z] })`
4. Add it to a group: `this._office.addChild(myProp)`
5. See "Adding New Objects to a Scene" section above for full details

### "I want to fly up and inspect the ceiling"

1. Press **V** to enable the DebugCamera
2. Hold **Space** to ascend
3. Use **WASD** + mouse to navigate (hold **Shift** for speed boost)
4. Press **V** again to return to normal controls

---

## Tips

- **Moving a group moves everything under it.** This is the most powerful feature — use it to reposition entire rooms instantly.
- **Dynamic objects (crates) are outside groups** because physics controls their position. You can still select and move them individually.
- **The tree view mirrors the Three.js scene graph.** If something is nested under a group in the tree, it's a child in the 3D engine too.
- **Save and reload your layout.** 💾 Save All gives you a `.hierarchy.json` you can 📂 Load straight back into the editor — your edits survive across sessions without touching scene code.
- **PageUp/PageDown on a laptop:** You may need to hold **Fn** + arrow key.
