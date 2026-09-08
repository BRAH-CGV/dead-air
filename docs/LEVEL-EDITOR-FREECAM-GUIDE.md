# Dead Air In-Game Level Editor and FreeCam Guide

This guide explains how to use the in-game level editor and FreeCam while running the game locally.

## Starting the game

Run the dev server:

```bash
npm run dev
```

Open the local Vite URL shown in the terminal, usually `http://localhost:5173/`.

## FreeCam

FreeCam lets you fly around the scene to inspect layouts quickly.

### Toggle FreeCam

- Press `V` once to enable FreeCam.
- Press `V` again to disable FreeCam.

When FreeCam is enabled, player gravity is disabled and normal first-person walking/jumping is paused. When FreeCam is disabled, normal player controls resume.

### FreeCam movement

While FreeCam is active:

| Key | Action |
|---|---|
| `W` | Move forward relative to camera view |
| `S` | Move backward relative to camera view |
| `A` | Move left relative to camera view |
| `D` | Move right relative to camera view |
| `E` | Move up |
| `Q` | Move down |
| Mouse / touchpad | Look around |

Tip: Use FreeCam first to move to a good inspection angle, then toggle the editor with `F2` if you want to adjust objects.

## Level Editor

The level editor is an in-game object placement/editing tool. It is useful for moving props around, checking positions, and exporting scene layout data.

### Toggle the editor

- Press `F2` to enable the level editor.
- Press `F2` again to disable it.

When the editor opens, the editor panel appears on the right side of the screen and pointer lock is released so you can click UI elements.

## Selecting objects

With the level editor enabled:

- Left-click an object in the scene to select it.
- You can also select objects from the object list in the editor panel.
- The selected object’s position, rotation, and scale values appear in the panel.
- Clicking empty space deselects the current object.

The player object is filtered out and cannot be selected in the editor.

## Transform modes

The editor has three transform modes:

| Key | Mode | Purpose |
|---|---|---|
| `G` | Move mode | Move the selected object |
| `R` | Rotate mode | Rotate the selected object |
| `T` | Scale mode | Uniformly scale the selected object |

The active mode is shown at the top of the editor panel.

## Keyboard transform controls

Select an object first, then choose a mode with `G`, `R`, or `T`.

### Move mode (`G`)

| Key | Action |
|---|---|
| `Left Arrow` | Move object left on X |
| `Right Arrow` | Move object right on X |
| `Up Arrow` | Move object forward on Z |
| `Down Arrow` | Move object backward on Z |
| `PageUp` | Move object up on Y |
| `PageDown` | Move object down on Y |

### Rotate mode (`R`)

| Key | Action |
|---|---|
| `Left Arrow` | Rotate around Y one direction |
| `Right Arrow` | Rotate around Y the other direction |
| `Up Arrow` | Rotate around X one direction |
| `Down Arrow` | Rotate around X the other direction |
| `PageUp` | Rotate around Z one direction |
| `PageDown` | Rotate around Z the other direction |

### Scale mode (`T`)

| Key | Action |
|---|---|
| `Up Arrow` or `Right Arrow` | Scale up uniformly |
| `Down Arrow` or `Left Arrow` | Scale down uniformly |

Scale mode does not use `PageUp` or `PageDown`.

## How to press PageUp and PageDown

Some laptops and compact keyboards do not have dedicated `PageUp` and `PageDown` keys. You still need to send the real `PageUp` / `PageDown` key event for vertical movement and Z rotation.

Try these common options:

- Look for small secondary labels like `PgUp` and `PgDn` printed on your arrow keys or nearby keys.
- Try `Fn + Up Arrow` for `PageUp`.
- Try `Fn + Down Arrow` for `PageDown`.
- Some keyboards use `Fn + Left Arrow` / `Fn + Right Arrow` instead.
- Some laptops use `Fn + P` / `Fn + N`, depending on the manufacturer.
- On Windows, you can use the On-Screen Keyboard if your hardware keyboard does not expose these keys.

If PageUp/PageDown do not work, check your laptop keyboard manual or keyboard settings to see which `Fn` combination generates `PgUp` and `PgDn`.

## Editing values directly

The editor panel also shows numeric fields for:

- Position X/Y/Z
- Rotation X/Y/Z in degrees
- Scale X/Y/Z

You can type values directly into these fields. Press Enter or click away to apply changes.

## Deleting objects

- Select an object.
- Press `Delete` to remove it from the scene.

This removes the visual object and its physics body if it has one.

## Exporting your layout

The level editor is useful because you can move props in-game, then export the layout so the scene can be recreated in code.

At the bottom of the editor panel there are two export buttons:

| Button | Output file | Use it for |
|---|---|---|
| `Export JSON` | `level-layout.json` | Saving a readable layout list with each object’s name, position, rotation, and scale. Good for reviewing or sharing placements. |
| `Export Code` | `level-layout.js` | Generating `this.engine.spawnModel(...)` calls that can be pasted into scene code later. |

Recommended workflow:

1. Arrange the scene in-game with the editor.
2. Click `Export JSON` to keep a clean data backup.
3. Click `Export Code` when you want code that can be copied into `src/scenes/OfficeScene.js` or another scene file.
4. Commit the final scene code once the exported layout has been cleaned up and tested.

Important: the editor currently exports layouts. It does not import `level-layout.json` back into the game automatically yet.

## Physics note

When you move, rotate, or scale a manifest-spawned model in the editor, the editor syncs the physics body to match the visible transform. Scale changes rebuild that model’s Rapier colliders because Rapier collider shapes cannot be resized directly.

## Quick workflow for teammates

1. Run `npm run dev`.
2. Click the game canvas if you want normal mouse look.
3. Press `V` to enable FreeCam and fly to a useful angle.
4. Press `V` again if you want to return to normal player movement.
5. Press `F2` to open the level editor.
6. Select an object by clicking it or choosing it from the object list.
7. Press `G`, `R`, or `T` for move, rotate, or scale.
8. Use arrow keys and PageUp/PageDown to adjust the object.
9. Click `Export JSON` for a layout backup, or `Export Code` for scene code snippets.
10. Press `F2` again to close the editor when done.
