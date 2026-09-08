# What's Been Added — Debug Tools & Editor Features

A quick tour of the tools that have landed recently: the collider overlay,
model debug logging, and the level editor's newer tricks (recentering,
hierarchy, measured colliders). For the full editor walkthrough see
[TEAM-EDITOR-GUIDE.md](TEAM-EDITOR-GUIDE.md); for the free camera see
[LEVEL-EDITOR-FREECAM-GUIDE.md](LEVEL-EDITOR-FREECAM-GUIDE.md).

---

## Global hotkeys (work any time in-game)

| Key | What it does |
|---|---|
| <code>`</code> (backtick) | Toggle the **physics debug overlay** |
| F4 | Toggle **model debug logging** (bounds/scale to console) |
| F2 | Toggle the **level editor** panel |
| V | Toggle the **free camera** (fly mode) |

### ` — the physics debug overlay

Draws every collider Rapier knows about, in Rapier's own colours, straight
over the scene. Authoring a collider blind is guesswork — a hand-typed box or
a `UCX_` mesh exported with a stray transform looks fine until you walk into
thin air. With the overlay on, the mismatch is obvious.

- Off by default; costs nothing while hidden.
- The wireframe is a fresh snapshot of the physics world every frame — if it
  disagrees with what you see, the *physics* is wrong, not the drawing.
- Implementation: [src/core/PhysicsDebug.js](src/core/PhysicsDebug.js).
  Lines use `depthTest` + `polygonOffset`, so they sit just behind mesh
  surfaces instead of fighting them for pixels (the old always-on-top mode
  shimmered on large scaled walls).

### F4 — model debug logging

Toggles per-model console logging: measured bounding box, position, scale for
every spawned model. Turns the logging on and re-spawns the current scene so
you get the numbers immediately. Useful when a model lands at the wrong size
or floats above the floor. (F4 rather than F1 — Chrome and DevTools own F1,
so the key never reached the game.)

---

## Level editor (F2)

### Transform basics

| Key | What it does |
|---|---|
| G / R / T | Switch to **move** / **rotate** / **scale** mode |
| Arrow keys | Transform the selected object (fine steps) |
| PageUp / PageDown | Move up/down (move mode) or rotate on Z (rotate mode) |
| Click | Select an object (works through the tree view too) |
| Delete | Remove the selected object from the scene |
| P | **Recenter the pivot** — see below |

The info panel also has editable number fields for position/rotation/scale —
type a value, press Enter, and the physics body follows.

### P — recentering the pivot

Rotation and scale happen around an object's pivot. Objects whose pivot is
stale (off in a corner, or parked at the group's origin) rotate and scale
around the wrong point. P fixes that:

- **Group selected** — the pivot moves to the **average position of the
  group's direct children**, and each child is offset the other way so
  nothing visually moves. Rotating/scaling the group now pivots around the
  children's centre.
- **Single object selected** — the pivot moves to the object's **own visual
  (bounding-box) centre**. The mesh content is shifted back so the object
  stays exactly where it was on screen; only the pivot moved.

After recentering, the collider is **rebuilt from the measured world bounding
box**. This matters for models like the desk: their collider offset was baked
at load time relative to the model's original origin, so after the pivot
moves the offset would be stale and the collider would drift upward. The
forced rebuild keeps the collider glued to the visual.

### Measured colliders (what happens behind the scenes)

Every transform edit syncs the physics body to match the visuals:

- **Move / rotate** — the body's world position and rotation are updated.
- **Scale** — the collider is **rebuilt by measuring the mesh's actual world
  bounding box**, not by trusting stored size × scale bookkeeping. Whatever
  the scale, parent transforms, or mesh offsets are, the collider wraps what
  you can see. Applies to procedural boxes (walls, window parts) and models.
- Every rebuild logs a line like:

  ```
  [LevelEditor] rebuilt collider 'Wall': size=(2.00, 4.00, 2.00) center=(5.00, 1.50, -4.00)
  ```

  If a collider ever looks misplaced, these numbers tell you whether the size
  or the centre is wrong.

### Hierarchy & groups

- **Create Group** button — new empty group under the scene root.
- **Parent dropdown** in the info panel — reparent any object/group, with
  world position preserved and cycle guards (can't parent a group into its
  own descendant).
- Parent transforms **cascade**: move, rotate or scale a group and every
  child follows, including their colliders (children sync using *world*
  transforms).
- Tree view with expand/collapse arrows per group.

### Saving & exporting

| Button | Output |
|---|---|
| 💾 Save All | Downloads both files below |
| 🌳 .json | Hierarchy JSON — the tree structure with transforms |
| 📜 .js | Generated scene class — paste-ready code |
| 📦 Standalone | Complete standalone `Scene` class file |
| 🌳 Hierarchy | Same hierarchy JSON as a quick export |

The **scene switcher** dropdown at the top swaps between registered scenes
via `engine.loadScene()`; unsaved changes show a `*` next to the scene name.

---

## Quick reference

```
`   collider overlay        F4  model debug logging   F2  level editor
V   free camera             G/R/T  move/rotate/scale  P   recenter pivot
```

**Rule of thumb:** edit with F2, verify with `, ship with Save All.
