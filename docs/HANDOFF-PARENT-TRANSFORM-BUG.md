# HANDOFF: Parent Group Transform Doesn't Propagate to Initial Children

## The Bug

In the browser (not tests), when the Level Editor (F2) moves a **parent group**, the **initially-loaded children don't move visually**. But **newly-spawned objects DO move**.

| Action | Expected | Actual |
|--------|----------|--------|
| Move **SceneRoot** | Everything moves | Nothing else moves |
| Move **Office** group | Walls, windows, lights, furniture all move | Only ComputerDesk/ServerRack/etc move; walls & lights stay put |
| Move **Lighting** group | All lights move | Lights stay put |
| Move individual wall | Wall moves | Works fine |

## Why This Is Confusing

`GameObject.addChild()` calls `this.object3d.add(child.object3d)` — the standard Three.js parent-child mechanism. Both walls (procedural) and furniture (GLB models) use the same `addChild` call. Three.js SHOULD cascade transforms automatically.

## The Critical Difference Between Moving and Non-Moving Objects

### Objects that DON'T move (walls, lights, window frames)

Created by `_addStaticBox()` in `src/scenes/OfficeScene.js` (line 276-296):

```js
_addStaticBox(name, position, size, material, parent) {
  const go = new GameObject(name);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);           // ← position on the MESH
  go.object3d.add(mesh);                    // ← mesh is child of go.object3d
  // ... physics body created separately at world position ...
  if (parent) parent.addChild(go);          // ← go.object3d added to parent
  return go;
}
```

Structure: `office.object3d` → `wallGO.object3d` (at origin) → `mesh` (at world position)

Lights follow the same pattern in `_addLighting()` — light/mesh positioned inside a GameObject whose `object3d` is at origin.

### Objects that DO move (ComputerDesk, ServerRack, etc.)

Created by `engine.spawnModel()` in `src/core/Engine.js` (line 246-267):

```js
spawnModel(key, opts = {}) {
  const go = new GameObject(name ?? key);
  go.object3d.add(this.assets.instantiate(key));  // ← model is child of go.object3d
  go.object3d.position.set(position[0], ...);      // ← position on go.object3d ITSELF
  // ...
  this._rootObjects.push(go);
  return go;
}
```

Then reparented: `this._office.addChild(computer);`

Structure: `office.object3d` → `computerGO.object3d` (at world position) → `model clone`

### The structural difference

- **Walls**: position is on the **grandchild mesh**, `wallGO.object3d` is at (0,0,0)
- **Furniture**: position is on `computerGO.object3d` itself

Both are children of `office.object3d` via `addChild()`. Both SHOULD move when office moves.

## What Was Already Tried

1. **Fixed `_buildHierarchy()` to adopt the existing SceneRoot** instead of creating a duplicate parallel root. The editor now uses `this.sceneRoot = existingRoot` (the same GameObject OfficeScene created). This ensures transforms operate on the same Three.js hierarchy that's rendering. **Did not fix the bug.**

2. **Changed expand/collapse from `_expandedGroups` Set to `_collapsedGroups` Set** — groups are expanded by default, collapsed tracked explicitly. Cleaner semantics, fixed test issues.

3. **Verified in tests** — All 151 tests pass. Tests confirm Three.js hierarchy is correct and transforms cascade. The bug only manifests in the browser.

## Files to Investigate

| File | What to look at |
|------|----------------|
| `src/scenes/OfficeScene.js` | How walls/lights are built. `_addStaticBox()` (L276), `_addLighting()` (L56), `_addOfficeFurniture()` (L222) |
| `src/editor/LevelEditor.js` | Transform code (L79-117), `_buildHierarchy()` (L158), `_syncTransformToPhysics()` (L825) |
| `src/core/GameObject.js` | `addChild()` (L69-74) — calls `this.object3d.add(child.object3d)` |
| `src/core/Engine.js` | `spawnModel()` (L246), `_rootObjects` management |

## Diagnostic Steps to Try

### 1. Add runtime assertions after OfficeScene.build()

At the end of `OfficeScene.build()`, add:

```js
// DEBUG: verify Three.js parent-child chain
console.assert(this._office.object3d.parent === sceneRoot.object3d,
  'Office should be child of SceneRoot in Three.js');
const wall = sceneRoot.find('BackWall_Left');
console.assert(wall.object3d.parent === this._office.object3d,
  'Wall should be child of Office in Three.js');
console.log('[OfficeScene] Office children:', this._office.object3d.children.length);
console.log('[OfficeScene] Office→wall chain:', wall.object3d.parent === this._office.object3d);
```

### 2. Add runtime assertions after editor opens

In `LevelEditor._buildHierarchy()`, after adopting the sceneRoot:

```js
// DEBUG: verify hierarchy integrity
console.log('[Editor] sceneRoot is same object:', this.sceneRoot === this.engine._rootObjects.find(go => go.name === 'SceneRoot'));
const office = this.sceneRoot.find('Office');
if (office) {
  console.log('[Editor] Office Three.js children:', office.object3d.children.length);
  console.log('[Editor] Office GameObject children:', office.children.length);
  for (const child of office.object3d.children) {
    console.log('  child:', child.name, 'parent:', child.parent?.name);
  }
}
```

### 3. Log the actual transform

In the keyboard handler (LevelEditor.js ~L80), when transforming:

```js
console.log('[Transform]', this.selectedObject.name,
  'obj3d:', obj.position.x.toFixed(4),
  'three-children:', obj.children.length,
  'go-children:', this.selectedObject.children?.length);
```

### 4. Check if `_buildHierarchy()` breaks the chain

The most suspicious code path: when `_buildHierarchy()` runs (on F2 toggle), does it somehow **re-parent** or **detach** the wall GameObjects from the Office group?

Key question: after `_buildHierarchy()`, is `wallGO.object3d.parent` still `office.object3d`?

### 5. Possible root cause theories

- **Theory A**: Something in `_buildHierarchy()` or `_collectEditableObjects()` is calling `removeChild` on the Three.js object, breaking the parent-child link for procedural objects but not for spawnModel objects.

- **Theory B**: The `engine.scene.add(sceneRoot.object3d)` in OfficeScene.build() and the editor's adoption of the same sceneRoot creates a conflict where Three.js's internal parent tracking gets confused.

- **Theory C**: The `_syncTransformToPhysics()` method, which iterates descendants and calls `rb.setTranslation()`, is somehow resetting positions. Static walls have rigidBodies (created in `_addStaticBox`), and `_syncSingleTransformToPhysics` reads `obj.position` (which is LOCAL position, not world) and sets it as the rigidBody's world position. For nested objects this is wrong.

- **Theory D**: The editor is selecting the correct GameObject but modifying a different `object3d` than what's rendering. Maybe the GameObject reference in `editableObjects` is stale or points to a different instance.

- **Theory E**: The `_addStaticBox` pattern of positioning the mesh (not the GameObject's object3d) means that when the editor selects "Office" and reads its children, the wall GameObjects' `object3d` positions are all at (0,0,0) — and some code path might be using those zero positions to "correct" or override the parent transform.

## Test Results

- **151 tests pass** across 7 test files
- Only 2 pre-existing WASM import failures (`Colliders.test.js`, `FirstPersonController.test.js`) — unrelated
- 4 new tests specifically verify transform propagation through adopted hierarchy — all pass in tests
- Bug is **browser-only**, not caught by tests

## How to Run

```bash
npm run dev          # Start dev server
# Open browser, press F2 to open editor
# Select "Office" in tree view, press arrow keys
# Watch if walls move or stay put
```

## Key Architectural Context

- `engine._rootObjects` contains: `[sceneRoot, crateA, crateB, crateC]`
- `sceneRoot` → Office → walls/windows/furniture; Outside → ground; Lighting → lights
- Dynamic crates are at `_rootObjects` root (NOT under sceneRoot) because Rapier owns their position
- Editor transforms work by modifying `selectedObject.object3d.position/rotation/scale` directly
- `_syncTransformToPhysics()` copies visual transforms to Rapier rigid bodies after each change
