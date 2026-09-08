# Level Editor: Hierarchical Scene Graph & Advanced Export

## Overview

Transform the level editor from a flat object list into a **hierarchical scene graph** where objects are organised into named groups (parent-child). Selecting a group in the editor moves all its children together. Objects can be reparented — dragged between groups or promoted/demoted in the tree. Dynamic/interactable objects (crates, etc.) are kept separate from static scene geometry so physics is not broken by group transforms.

**Scene File Management:** The editor tracks which scene file is being edited, allows switching between scenes, and provides save functionality that exports both a standalone `.js` scene file (that can replace the original and just work) and a `.hierarchy.json` file (that remembers the group structure). Changes are tracked with a dirty indicator, and unsaved changes prompt before scene switching.

---

## 1. Current State

- The level editor (`src/editor/LevelEditor.js`) manages a **flat list** of `editableObjects` filtered from `engine._rootObjects`.
- The object list UI is a simple `<div>` with one entry per object — no nesting, no grouping.
- Export (`_exportCode` / `_exportJSON`) produces flat `spawnModel()` calls with no hierarchy information.
- `OfficeScene.js` builds procedural geometry (walls, window, ground, lighting) as raw `THREE.Mesh` objects added directly to `engine.scene`. Spawned models are flat root objects.
- `GameObject` already supports `addChild` / `removeChild` / `find` / `parent` — the hierarchy primitives exist but are unused by the editor.

---

## 2. Desired Behaviour

### 2.1 Hierarchical Groups

```
SceneRoot (GameObject, no mesh, no physics)
├── Office (group)
│   ├── BackWall_Left        (static mesh + collider)
│   ├── BackWall_Right       (static mesh + collider)
│   ├── ...all walls...
│   ├── WindowFrame_TOP      (static mesh + collider)
│   ├── ...all window parts...
│   ├── ComputerDesk         (spawned model, static physics)
│   ├── ServerRack           (spawned model, static physics)
│   ├── RadarTerminal         (spawned model, static physics)
│   ├── Switchboard           (spawned model, static physics)
│   ├── SecurityCamera_Window (spawned model, no physics)
│   ├── SecurityCamera_Door   (spawned model, no physics)
│   └── SecurityCamera_Desk   (spawned model, no physics)
├── Outside (group)
│   ├── VisibleMoon           (decorative mesh)
│   └── ...outdoor props...
└── [Lighting]                (group, lights only — not selectable for transform)
    ├── AmbientLight
    ├── DirectionalLight (moon)
    ├── CeilingPointLight
    ├── DeskGlowPointLight
    └── MoonGlowPointLight
```

### 2.2 Dynamic / Interactable Objects Stay at Root

```
engine._rootObjects (flat, as before)
├── SceneRoot          ← the hierarchy container (no physics, no render)
├── Crate_A            ← dynamic body, Interactable component
├── Crate_B            ← dynamic body, Interactable component
├── Crate_C            ← dynamic body (no Interactable yet)
└── Player             ← kinematic body, camera, controllers
```

**Why separate?** A group transform would fight Rapier. Dynamic bodies own their own position via `rigidBody.translation()`. If a crate were a child of "Office", moving the Office group would teleport the crate's visual but not its collider, or vice versa. Keeping dynamic objects at root level means physics stays authoritative and predictable.

### 2.3 Selection & Group Transform

- The editor UI shows a **tree view** (indented list or collapsible tree) instead of the flat list.
- Clicking a **group name** selects the group. Transform controls (arrow keys) then move **every child** together by offsetting the group's `object3d.position`.
- Clicking an **individual object** inside a group selects just that object for fine transform.
- The info panel shows the group name and aggregate position when a group is selected.

### 2.4 Reparenting

- Keyboard-driven reparenting (consistent with the existing keyboard-only editor philosophy):
  - **`[` / `]`** — move selected object up/down in the sibling order.
  - **`Shift+[` / `Shift+]`** — promote/demote hierarchy level (move into/out of a group).
  - Alternatively, a dropdown in the info panel: "Parent: [dropdown of all groups]". Changing the dropdown reparents the object.
- When reparenting, the object's **world position is preserved** — its local position is recalculated relative to the new parent so it doesn't visually jump.

### 2.5 Creating New Groups

- **Button in editor UI**: "Create Group" — creates a new empty group GameObject at the current selection's level (sibling of selected, or child of selected group).
- Groups are just `GameObject` instances with `isGroup = true`, no mesh, no physics.

---

## 3. Architecture Changes

### 3.1 `GameObject` Extensions

**File:** `src/core/GameObject.js`

Add:

```js
/** Marker for group nodes (no mesh, no physics, just a container). */
isGroup = false;

/** Convert this node into a group (strip render/physics, keep hierarchy). */
makeGroup() {
  this.isGroup = true;
  // Remove any mesh/collider references — groups are pure containers.
  return this;
}

/** Return all descendants (depth-first) including self. */
descendants() {
  const result = [this];
  for (const c of this.children) result.push(...c.descendants());
  return result;
}

/** Reparent: move this object under a new parent, preserving world transform. */
reparentUnder(newParent) {
  if (this.parent) this.parent.removeChild(this);
  newParent.addChild(this);
  // Recalculate local position so world position is unchanged.
  const worldPos = new THREE.Vector3();
  this.object3d.getWorldPosition(worldPos);
  const parentWorldInverse = new THREE.Matrix4();
  newParent.object3d.updateWorldMatrix(true, false);
  parentWorldInverse.copy(newParent.object3d.matrixWorld).invert();
  const localPos = worldPos.applyMatrix4(parentWorldInverse);
  this.object3d.position.copy(localPos);
  return this;
}
```

**Tests (write FIRST):**

- `descendants()` returns self + all children recursively.
- `reparentUnder()` preserves world position.
- `reparentUnder()` from root to group, from group to root, from group to group.
- `makeGroup()` sets `isGroup = true`.
- Moving a group's `object3d.position` moves all children's world positions.

### 3.2 `LevelEditor` — Hierarchy Management

**File:** `src/editor/LevelEditor.js`

New state:

```js
// Root container for the scene hierarchy (created on editor init or scene load)
this.sceneRoot = null;       // GameObject, isGroup = true, name = 'SceneRoot'
this.dynamicObjects = [];    // Objects with dynamic rigidBody — NOT under sceneRoot
```

New methods:

```js
/** Build the hierarchy from the current engine._rootObjects.
 *  Static objects → children of sceneRoot (grouped by spatial zone or manual assignment).
 *  Dynamic objects → remain at root, tracked separately.
 *  Lights → grouped under a [Lighting] group (informational, not transformable). */
_buildHierarchy()

/** Select a group — transform applies to group.object3d, moving all children. */
selectObject(gameObject)  // existing, modified to handle groups

/** Reparent selected object to a new group, preserving world position. */
_reparentSelected(newParent)

/** Create a new empty group. */
_createGroup(name, parent)

/** Move selected object up/down in sibling order. */
_moveSiblingUp()
_moveSiblingDown()
```

Modified methods:

```js
_refreshEditableObjects()
// Now returns: sceneRoot (with children tree), dynamic objects, player (excluded).
// The tree is used by the UI tree view.

_syncTransformToPhysics()
// When a GROUP is selected, sync must iterate all descendant objects with rigid bodies
// and update each one's physics to match its new world transform.

_updateObjectList()
// Replaced with _updateTreeView() — renders an indented/collapsible tree.
```

**Tests (write FIRST):**

- `_buildHierarchy()` correctly separates static vs dynamic objects.
- `_buildHierarchy()` places procedural meshes and spawned models under `sceneRoot`.
- Selecting a group and translating it moves all children's world positions.
- `_syncTransformToPhysics()` on a group updates all descendant rigid bodies.
- `_reparentSelected()` preserves world position.
- `_createGroup()` creates a group with `isGroup = true` and adds it to the tree.
- `_moveSiblingUp()` / `_moveSiblingDown()` change child order without changing world position.

### 3.3 `LevelEditor` — UI Tree View

Replace the flat `objectList` div with a tree:

```js
_updateTreeView() {
  this.objectList.innerHTML = '';
  this._renderTreeNode(this.sceneRoot, this.objectList, 0);
  // Also render dynamic objects at root level
  for (const go of this.dynamicObjects) {
    this._renderTreeNode(go, this.objectList, 0);
  }
}

_renderTreeNode(go, container, depth) {
  const item = document.createElement('div');
  item.style.paddingLeft = `${depth * 16}px`;
  item.textContent = `${go.isGroup ? '📁 ' : ''}${go.name}`;
  item.style.background = go === this.selectedObject ? '#25a' : 'rgba(255,255,255,0.1)';
  item.style.cursor = 'pointer';
  item.style.padding = '4px 5px';
  item.style.margin = '1px 0';
  item.style.borderRadius = '3px';
  item.onclick = (e) => {
    e.stopPropagation();
    this.selectObject(go);
  };
  container.appendChild(item);
  
  // Render children recursively
  for (const child of go.children) {
    this._renderTreeNode(child, container, depth + 1);
  }
}
```

**Dropdown reparenting in info panel:**

When an object is selected, show a "Parent" dropdown listing all groups:

```js
// In _updateInfoPanel():
const parentSelect = document.createElement('select');
parentSelect.style.cssText = 'width: 100%; margin-top: 5px; ...';
const groups = this._getAllGroups();
for (const g of groups) {
  const opt = document.createElement('option');
  opt.value = g.name;
  opt.textContent = g.name;
  if (go.parent === g) opt.selected = true;
  parentSelect.appendChild(opt);
}
parentSelect.onchange = () => this._reparentSelected(groups[parentSelect.selectedIndex]);
```

### 3.4 `OfficeScene` Refactor

**File:** `src/scenes/OfficeScene.js`

Refactor `build()` to create the hierarchy:

```js
build() {
  // Create hierarchy root
  const sceneRoot = new GameObject('SceneRoot');
  sceneRoot.makeGroup();
  
  const office = new GameObject('Office');
  office.makeGroup();
  sceneRoot.addChild(office);
  
  const outside = new GameObject('Outside');
  outside.makeGroup();
  sceneRoot.addChild(outside);
  
  const lighting = new GameObject('Lighting');
  lighting.makeGroup();
  sceneRoot.addChild(lighting);
  
  // Add all procedural geometry to the appropriate groups
  this._addLighting(lighting);
  this._addGround(office);        // ground collider stays at world level
  this._addWalls(office);
  this._addWindow(office);
  this._addOfficeFurniture(office);
  this._addProps();               // dynamic crates stay at root
  
  this.engine._rootObjects.push(sceneRoot);
  this.engine.buildPlayer();
}
```

Each `_add*` method receives a parent group and adds its objects as children:

```js
_addWalls(parent) {
  // Instead of scene.add(mesh), do:
  // parent.object3d.add(mesh) — or use parent.addChild(go) for GameObjects
}
```

**Note:** Procedural meshes (walls, window) are currently raw `THREE.Mesh` objects, not `GameObject`s. Two options:

- **Option A:** Wrap each in a `GameObject` so the hierarchy is uniform. More work, but consistent.
- **Option B:** Add raw `THREE.Object3D` children to the group's `object3d`. Simpler, but the editor can only select `GameObject`s. **This is the recommended approach for Phase 1** — wrap procedurals in GameObjects later.

For the editor to select and move wall segments, they need to be `GameObject`s. So **Option A is required** for full editor support:

```js
_addStaticBox(name, position, size, material, parent) {
  const go = new GameObject(name);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.castShadow = mesh.receiveShadow = true;
  go.object3d.add(mesh);
  go.object3d.position.set(...position);
  
  // Physics (same as before)
  const body = this.engine.world.createRigidBody(...);
  this.engine.world.createCollider(...);
  go.rigidBody = body;
  
  parent.addChild(go);
  return go;
}
```

### 3.5 Export with Hierarchy

`_exportCode()` must emit the hierarchy structure:

```js
_exportCode() {
  let code = '// ── Generated by Level Editor ──\n\n';
  
  code += `// Create hierarchy\n`;
  code += `const sceneRoot = new GameObject('SceneRoot');\n`;
  code += `sceneRoot.makeGroup();\n`;
  
  for (const group of this.sceneRoot.children) {
    code += `const ${group.name} = new GameObject('${group.name}');\n`;
    code += `${group.name}.makeGroup();\n`;
    code += `sceneRoot.addChild(${group.name});\n\n`;
    
    for (const child of group.children) {
      if (child.isGroup) continue; // nested groups handled recursively
      code += this._exportSpawnCall(child, group.name);
    }
  }
  
  // Dynamic objects at root
  for (const go of this.dynamicObjects) {
    code += this._exportSpawnCall(go, null);
  }
}
```

---

## 4. Implementation Phases (TDD)

**Every phase follows: Write test → Run (RED) → Implement → Run (GREEN) → Refactor.**

### Phase 1: GameObject Hierarchy Extensions

**Tests to write first** (`src/core/GameObject.test.js` or new `src/core/GameObject.hierarchy.test.js`):

```
describe('GameObject hierarchy extensions', () => {
  describe('descendants()', () => {
    it('returns [self] when no children')
    it('returns self + direct children')
    it('returns self + all nested descendants depth-first')
  })
  
  describe('makeGroup()', () => {
    it('sets isGroup to true')
    it('returns this for chaining')
  })
  
  describe('reparentUnder()', () => {
    it('moves object from root to under a group')
    it('moves object from one group to another')
    it('moves object from group back to root (via a temporary root parent)')
    it('preserves world position after reparenting')
    it('preserves world position when new parent has a non-zero transform')
  })
  
  describe('group transform propagation', () => {
    it('moving a group object3d.position moves all children world positions')
    it('rotating a group object3d.rotation rotates all children')
  })
})
```

**Implementation:** Add `isGroup`, `makeGroup()`, `descendants()`, `reparentUnder()` to `GameObject.js`.

### Phase 2: LevelEditor Hierarchy Building

**Tests to write first** (`src/editor/LevelEditor.test.js`):

```
describe('hierarchy building', () => {
  it('creates a sceneRoot group on _buildHierarchy()')
  it('places static spawned models under sceneRoot')
  it('keeps dynamic-body objects out of sceneRoot (in dynamicObjects)')
  it('excludes Player from both sceneRoot and dynamicObjects')
  it('groups objects by their spatial zone when zone metadata exists')
  it('places render-only objects (no rigidBody, not dynamic) under sceneRoot')
})
```

**Implementation:** Add `_buildHierarchy()`, `sceneRoot`, `dynamicObjects` to `LevelEditor.js`. Modify `_refreshEditableObjects()` to call `_buildHierarchy()`.

### Phase 3: Group Selection & Transform

**Tests to write first** (`src/editor/LevelEditor.test.js`):

```
describe('group selection and transform', () => {
  it('selectObject() accepts a group (isGroup = true)')
  it('translating a group moves all descendant object3d positions')
  it('_syncTransformToPhysics() on a group updates all descendant rigid bodies')
  it('_syncTransformToPhysics() on a group skips children without rigidBody')
  it('info panel shows group name and child count when group is selected')
})
```

**Implementation:** Modify `selectObject()`, arrow key handlers, `_syncTransformToPhysics()` to handle groups. When a group is selected, arrow keys move `group.object3d.position` (children follow via Three.js hierarchy). Physics sync iterates `group.descendants()`.

### Phase 4: Reparenting

**Tests to write first** (`src/editor/LevelEditor.test.js`):

```
describe('reparenting', () => {
  it('_reparentSelected() moves object under new parent group')
  it('_reparentSelected() preserves world position')
  it('_reparentSelected() updates editableObjects tree')
  it('prevents reparenting a group under its own descendant (cycle guard)')
  it('prevents reparenting Player or dynamic objects into sceneRoot')
})
```

**Implementation:** Add `_reparentSelected(newParent)`, `_getAllGroups()`, dropdown UI in `_updateInfoPanel()`.

### Phase 5: Tree View UI

**Tests to write first** (`src/editor/LevelEditor.test.js`):

```
describe('tree view UI', () => {
  it('_updateTreeView() renders group nodes with folder icon')
  it('_updateTreeView() indents children deeper than parents')
  it('_updateTreeView() highlights selected object or group')
  it('clicking a group name selects the group')
  it('clicking a child name selects the child')
  it('shows "Parent:" dropdown in info panel when object is selected')
  it('changing parent dropdown reparents the object')
})
```

**Implementation:** Replace `_updateObjectList()` with `_updateTreeView()` + `_renderTreeNode()`. Add parent dropdown to `_updateInfoPanel()`.

### Phase 6: Group Creation & Sibling Reordering

**Tests to write first** (`src/editor/LevelEditor.test.js`):

```
describe('group creation', () => {
  it('_createGroup() creates a group with isGroup = true')
  it('_createGroup() adds the group as child of specified parent')
  it('_createGroup() with no parent adds to sceneRoot')
  it('Create Group button exists in editor UI')
})

describe('sibling reordering', () => {
  it('_moveSiblingUp() swaps object with previous sibling')
  it('_moveSiblingDown() swaps object with next sibling')
  it('_moveSiblingUp() at index 0 is a no-op')
  it('_moveSiblingDown() at last index is a no-op')
})
```

**Implementation:** Add `_createGroup()`, `_moveSiblingUp()`, `_moveSiblingDown()`, keyboard shortcuts (`[` / `]`), "Create Group" button.

### Phase 7: OfficeScene Refactor

**Tests to write first** (`src/scenes/OfficeScene.test.js` or update existing):

```
describe('OfficeScene hierarchy', () => {
  it('creates SceneRoot group')
  it('creates Office group as child of SceneRoot')
  it('creates Outside group as child of SceneRoot')
  it('creates Lighting group as child of SceneRoot')
  it('all wall segments are children of Office group')
  it('all window parts are children of Office group')
  it('all spawned furniture models are children of Office group')
  it('dynamic crates remain at engine._rootObjects (not under SceneRoot)')
  it('player remains at engine._rootObjects')
})
```

**Implementation:** Refactor `OfficeScene.build()` and all `_add*` methods to use the group hierarchy. Wrap static boxes in `GameObject`s with `parent.addChild()`.

### Phase 8: Hierarchy-Aware Export

**Tests to write first** (`src/editor/LevelEditor.test.js`):

```
describe('hierarchy-aware export', () => {
  it('_exportCode() emits group creation before spawn calls')
  it('_exportCode() nests spawn calls inside their parent group')
  it('_exportCode() emits dynamic objects at root level')
  it('_exportJSON() includes parent reference for each object')
  it('exported code is valid JavaScript that recreates the hierarchy')
})
```

**Implementation:** Rewrite `_exportCode()` and `_exportJSON()` to traverse the hierarchy tree.

### Phase 9: Scene File Management — Live Editing

**Goal:** The editor knows which scene file it's editing, can switch between scenes, and saves changes directly back to the scene file + a separate hierarchy file.

**Tests to write first** (`src/editor/LevelEditor.test.js`):

```
describe('scene file management', () => {
  describe('scene tracking', () => {
    it('displays current scene name at the top of the editor UI')
    it('defaults to "OfficeScene" when no scene metadata exists')
    it('reads scene name from engine.activeScene.constructor.name')
  })
  
  describe('scene switching', () => {
    it('provides a dropdown listing all available scene classes')
    it('switching scenes calls engine.loadScene(SceneClass)')
    it('after switching, the editor rebuilds the hierarchy for the new scene')
    it('prompts to save unsaved changes before switching')
  })
  
  describe('save functionality', () => {
    it('Save button is visible in the editor UI')
    it('_saveHierarchy() writes the hierarchy tree to a .json file')
    it('_saveHierarchy() file is named after the scene: "OfficeScene.hierarchy.json"')
    it('_saveSceneCode() writes a complete Scene class that can replace the original')
    it('_saveSceneCode() file is named after the scene: "OfficeScene.js"')
    it('marks the scene as "dirty" (unsaved) when objects are moved/added/removed')
    it('clears the "dirty" flag after save')
    it('shows a visual indicator (asterisk or colour) when scene is dirty')
  })
  
  describe('hierarchy persistence', () => {
    it('_loadHierarchy() reads a .json hierarchy file if it exists')
    it('_loadHierarchy() reconstructs the group tree from the JSON')
    it('falls back to auto-building hierarchy if no file exists')
    it('preserves custom group assignments across save/load cycles')
  })
})
```

**Implementation:**

**UI additions:**
```js
// At the top of the editor panel
this.sceneHeader = document.createElement('div');
this.sceneHeader.innerHTML = `
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
    <div>
      <strong>Scene:</strong> <span id="current-scene-name">OfficeScene</span>
      <span id="dirty-indicator" style="color: #f80; display: none;">*</span>
    </div>
    <select id="scene-switcher" style="...">
      <option value="OfficeScene">OfficeScene</option>
      <option value="CustomScene">CustomScene</option>
      <!-- populated dynamically -->
    </select>
  </div>
  <div style="display: flex; gap: 5px; margin-bottom: 10px;">
    <button id="save-btn" style="...">💾 Save</button>
    <button id="save-as-btn" style="...">💾 Save As</button>
  </div>
`;
```

**Save methods:**
```js
/** Save hierarchy structure to a JSON file */
_saveHierarchy() {
  const hierarchy = this._serializeHierarchy();
  const sceneName = this.engine.activeScene.constructor.name;
  const filename = `${sceneName}.hierarchy.json`;
  
  const json = JSON.stringify(hierarchy, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  
  this._dirty = false;
  this._updateDirtyIndicator();
}

/** Save complete scene code that can replace the original */
_saveSceneCode() {
  const sceneName = this.engine.activeScene.constructor.name;
  const filename = `${sceneName}.js`;
  
  const code = this._generateFullSceneClass();
  const blob = new Blob([code], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  
  this._dirty = false;
  this._updateDirtyIndicator();
}

/** Generate a complete Scene class that can replace the original file */
_generateFullSceneClass() {
  const sceneName = this.engine.activeScene.constructor.name;
  let code = `import * as THREE from 'three';\n`;
  code += `import RAPIER from '@dimforge/rapier3d';\n`;
  code += `import { GameObject } from '../core/GameObject.js';\n`;
  code += `import { Scene } from '../core/Scene.js';\n\n`;
  code += `export class ${sceneName} extends Scene {\n`;
  code += `  build() {\n`;
  code += `    this._buildHierarchy();\n`;
  code += `    this.engine.buildPlayer();\n`;
  code += `  }\n\n`;
  code += this._generateHierarchyBuilder();
  code += `}\n`;
  return code;
}

/** Mark scene as dirty when changes are made */
_markDirty() {
  this._dirty = true;
  this._updateDirtyIndicator();
}

_updateDirtyIndicator() {
  const indicator = this.panel.querySelector('#dirty-indicator');
  if (indicator) indicator.style.display = this._dirty ? 'inline' : 'none';
}
```

**Hierarchy serialization:**
```js
_serializeHierarchy() {
  const serialize = (go) => ({
    name: go.name,
    isGroup: go.isGroup || false,
    position: go.object3d ? [
      go.object3d.position.x,
      go.object3d.position.y,
      go.object3d.position.z
    ] : [0, 0, 0],
    children: go.children.map(serialize)
  });
  
  return {
    sceneName: this.engine.activeScene.constructor.name,
    root: serialize(this.sceneRoot),
    dynamicObjects: this.dynamicObjects.map(go => go.name)
  };
}

_loadHierarchy(json) {
  // Reconstruct the group tree from JSON
  // Match objects by name in engine._rootObjects
  // Rebuild parent-child relationships
}
```

### Phase 10: Export Options — Standalone vs Live Edit

**Goal:** Provide two export modes: (1) Export standalone scene file for handoff, (2) Live editing with auto-save to hierarchy file.

**Tests to write first** (`src/editor/LevelEditor.test.js`):

```
describe('export modes', () => {
  describe('standalone export', () => {
    it('"Export Standalone" button generates a complete Scene class')
    it('exported file includes all imports')
    it('exported file includes build() method with hierarchy construction')
    it('exported file can replace the original scene file and work')
    it('exported file is human-readable and editable')
  })
  
  describe('live editing mode', () => {
    it('editor can load hierarchy from .hierarchy.json file')
    it('changes are tracked and marked as dirty')
    it('Save button writes updated hierarchy to .hierarchy.json')
    it('Save button writes updated scene code to .js file')
    it('reloading the scene preserves the edited hierarchy')
  })
})
```

**Implementation:**

Add two export buttons to the UI:
```js
// In _buildUI():
const exportDiv = document.createElement('div');
exportDiv.style.display = 'flex';
exportDiv.style.gap = '5px';
exportDiv.style.marginTop = '10px';

const exportStandaloneBtn = document.createElement('button');
exportStandaloneBtn.textContent = '📦 Export Standalone';
exportStandaloneBtn.onclick = () => this._exportStandalone();

const exportHierarchyBtn = document.createElement('button');
exportHierarchyBtn.textContent = '🌳 Export Hierarchy';
exportHierarchyBtn.onclick = () => this._exportHierarchy();

exportDiv.appendChild(exportStandaloneBtn);
exportDiv.appendChild(exportHierarchyBtn);
```

**Export methods:**
```js
/** Export a complete standalone Scene class */
_exportStandalone() {
  const code = this._generateFullSceneClass();
  const sceneName = this.engine.activeScene.constructor.name;
  const filename = `${sceneName}.standalone.js`;
  
  const blob = new Blob([code], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Export just the hierarchy structure */
_exportHierarchy() {
  this._saveHierarchy(); // Same as save, but always downloads
}
```

---

## 5. Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Group representation | `GameObject` with `isGroup = true` | Reuses existing hierarchy primitives, no new class needed |
| Dynamic objects location | Stay at `engine._rootObjects`, not under `sceneRoot` | Physics owns their position; group transforms would fight Rapier |
| Procedural geometry wrapping | Wrap in `GameObject` (Option A) | Editor needs to select/move individual wall segments |
| Reparenting UX | Dropdown in info panel + keyboard `[`/`]` | Consistent with existing keyboard-only editor philosophy |
| Group transform | Move `group.object3d.position`, children follow via Three.js | Free behaviour from the scene graph — no manual iteration needed for visuals |
| Group physics sync | Iterate `descendants()` on group select | Only needed when group is moved; static bodies need `setTranslation` update |
| Cycle prevention | Check `newParent.descendants().includes(this)` before reparenting | Prevents infinite loops in the tree |
| Scene file format | Two files: `.js` (scene code) + `.hierarchy.json` (structure) | Separation of concerns — code is human-editable, hierarchy is machine-readable |
| Save strategy | Download files via blob URLs (browser-based) | No server needed; works in static deployment; user manually replaces files |
| Dirty tracking | Boolean flag set on any transform/add/remove | Simple and reliable; cleared on save |
| Scene switching | Dropdown in editor header, calls `engine.loadScene()` | Reuses existing scene management; editor rebuilds hierarchy after switch |

---

## 6. Edge Cases & Constraints

1. **Player can never be reparented** into `sceneRoot` — it must stay at `_rootObjects` for the engine loop.
2. **Dynamic bodies can never be children of a group** — the editor must reject this with a warning.
3. **Moving a group with `object3d.position` does NOT update static rigid body positions automatically** — `_syncTransformToPhysics()` must iterate descendants and call `setTranslation()` on each.
4. **World matrix must be updated before `reparentUnder()`** reads it — call `object3d.updateWorldMatrix(true, false)` on the current parent first.
5. **Export must flatten** — the generated code creates groups and adds children, but the runtime engine loop still iterates `_rootObjects` for physics. Groups are an editor/authoring concept; the engine treats the `sceneRoot` GameObject like any other root object (its `_update` propagates to children).
6. **Ground collider stays at world level** — it's a raw Rapier body, not a GameObject. The ground mesh can be under a group, but the collider is independent.
7. **Lights under a group** — moving the Lighting group moves all lights. This is correct behaviour for the editor but has no physics implications.
8. **Scene switching with unsaved changes** — must prompt the user before discarding edits. Use `confirm()` or a custom modal.
9. **Hierarchy file loading** — if the `.hierarchy.json` file references objects that don't exist in the scene (e.g., deleted objects), skip them silently and log a warning.
10. **Exported scene code must be self-contained** — all imports, hierarchy construction, and object spawning in one file. No external dependencies beyond the core framework.
11. **Dirty flag must be set on any change** — transform, reparent, delete, add. Not just on save.
12. **Browser download limitations** — the editor can only trigger downloads, not write directly to the filesystem. The user must manually replace the original files. This is a constraint of the browser-based architecture.

---

## 7. Key Files to Modify

| File | Changes |
|---|---|
| `src/core/GameObject.js` | Add `isGroup`, `makeGroup()`, `descendants()`, `reparentUnder()` |
| `src/core/GameObject.test.js` | **NEW** — tests for hierarchy extensions |
| `src/editor/LevelEditor.js` | Add hierarchy building, group selection, reparenting, tree view, group creation, scene management, save/export |
| `src/editor/LevelEditor.test.js` | Add tests for all new editor features (Phases 2-10) |
| `src/scenes/OfficeScene.js` | Refactor to use group hierarchy |
| `src/scenes/OfficeScene.test.js` | **NEW or update** — tests for hierarchy structure |
| `src/scenes/OfficeScene.hierarchy.json` | **NEW** — saved hierarchy structure (generated by editor) |
| `AGENTS.md` | Add TDD mandate if not present |

---

## 8. Success Criteria

- [ ] Scene has a visible hierarchy in the editor tree view (Office, Outside, Lighting groups).
- [ ] Selecting "Office" in the tree and pressing arrow keys moves all office objects together.
- [ ] Selecting an individual wall or prop inside "Office" moves just that object.
- [ ] Reparenting via the dropdown moves an object to a new group without visual jump.
- [ ] Dynamic crates remain independent — pushing them with physics works regardless of group structure.
- [ ] Export generates code that recreates the hierarchy.
- [ ] Editor header shows the current scene name and a scene-switcher dropdown.
- [ ] Save button downloads both `.js` (scene code) and `.hierarchy.json` (structure).
- [ ] Dirty indicator (asterisk) appears when changes are made and clears after save.
- [ ] Switching scenes prompts to save unsaved changes.
- [ ] Exported standalone scene file can replace the original and work without modification.
- [ ] All new code is TDD: tests written first, RED → GREEN → refactor.
- [ ] Existing tests still pass (no regressions).

---

## 9. Notes

- The hierarchy is primarily an **editor/authoring concept**. At runtime, the engine loop iterates `_rootObjects` and propagates lifecycle calls through `GameObject._update()` → children. This already works — groups are just empty containers.
- The `SceneRoot` GameObject is added to `engine._rootObjects` once, so its `_init()`, `_update()`, etc. propagate to all children automatically.
- For Phase 7 (OfficeScene refactor), the procedural `_addStaticBox` needs to return a `GameObject` instead of a raw `THREE.Mesh`. This is a breaking change to the method signature but straightforward.
- Consider adding a "collapse/expand" toggle for groups in the tree view to keep the UI manageable with many objects.
- The current keyboard shortcuts (G/R/T for mode, arrows for transform, Delete for delete) remain unchanged. New shortcuts: `[`/`]` for sibling reorder, and the dropdown handles reparenting.
- **Scene file management** uses browser downloads (blob URLs) because the project is deployed as static files with no server. The user manually replaces the original files after downloading. This is a constraint of the architecture but keeps deployment simple.
- The `.hierarchy.json` file is separate from the `.js` scene file so that: (a) the hierarchy can be loaded/inspected independently, (b) the JS file remains human-editable without worrying about breaking machine-readable structure, (c) version control can track both code and structure separately.
- **Future enhancement:** If a backend is added (e.g., for multiplayer or cloud saves), the save methods can be extended to POST the files to a server instead of downloading them. The serialization logic stays the same.
