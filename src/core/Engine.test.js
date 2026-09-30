import { describe, it, expect, vi, beforeEach } from 'vitest';

// A scene switch only needs a world it can free and replace, so these tests
// don't pay for Rapier's real WASM world.
vi.mock('@dimforge/rapier3d', () => ({
  default: { World: class { free() {} } },
}));

// The editor's DOM panel is its own file's business (LevelEditor.test.js).
// Here it is a stand-in that records what the engine asks of it, and
// whether its module has been loaded at all.
const editorModule = vi.hoisted(() => ({ loaded: false, built: [] }));
vi.mock('../editor/LevelEditor.js', () => {
  editorModule.loaded = true;
  return {
    LevelEditor: class {
      constructor(engine) { this.engine = engine; this.enabled = false; editorModule.built.push(this); }
      init() { this.ready = true; }
      toggle() { this.enabled = !this.enabled; }
    },
  };
});

import * as THREE from 'three';
import { Engine } from './Engine.js';
import { DebugCamera } from './DebugCamera.js';
import { GameObject } from './GameObject.js';
import { Component } from './Component.js';

// ─────────────────────────────────────────────
// Engine.loadScene  –  switching scenes (the editor's scene switcher, F4)
// ─────────────────────────────────────────────
// Engine.init needs a WebGL context, so these tests call the real loadScene
// and _teardownScene on a bare engine carrying only what they touch.

/** Mounts the camera on a new player, as Engine.buildPlayer does. */
function playerFor(engine) {
  const player = new GameObject('Player');
  player.addComponent(new Component());
  player.object3d.add(engine.camera);
  engine.player = player;
  engine._rootObjects.push(player);
  return player;
}

class PlayerScene {
  constructor(engine) { this.engine = engine; }
  build() { playerFor(this.engine); }
  dispose() {}
}

function bareEngine() {
  const engine = Object.create(Engine.prototype);
  engine.scene = new THREE.Scene();
  engine.camera = new THREE.PerspectiveCamera();
  engine.world = { free() {} };
  engine._rootObjects = [];
  engine.rigidBodyMap = new Map();
  engine._bodyToGO = new Map();
  engine._prevPos = new Map();
  engine._prevQuat = new Map();
  engine.debugCamera = new DebugCamera(engine.camera, engine.scene);
  engine.loadScene(PlayerScene);
  return engine;
}

describe('Engine.loadScene with the fly camera on', () => {
  let engine;
  let oldPlayer;

  beforeEach(() => {
    engine = bareEngine();
    oldPlayer = engine.player;
    engine.debugCamera.toggle(engine.player);   // V
    engine.loadScene(PlayerScene);
  });

  // BUG-R3: the fly camera kept the old player, so V put the camera back
  // on a player that was no longer in the scene, and the view froze.
  it('ends the fly camera, leaving the view on the new player', () => {
    expect(engine.debugCamera.active).toBe(false);
    expect(engine.camera.parent).toBe(engine.player.object3d);
    expect(engine.player).not.toBe(oldPlayer);
  });

  it('flies from the new player and comes back to it', () => {
    engine.debugCamera.toggle(engine.player);   // V: fly
    expect(engine.player.components[0].enabled).toBe(false);

    engine.debugCamera.toggle(engine.player);   // V: back
    expect(engine.camera.parent).toBe(engine.player.object3d);
    expect(engine.player.components[0].enabled).toBe(true);
  });

  it('leaves the old player alone', () => {
    expect(oldPlayer.object3d.parent).toBeNull();
    expect(oldPlayer.object3d.children).not.toContain(engine.camera);
  });
});

// BUG-007: the editor is a dev tool most players never open, and it was a
// fifth of the game's bundle. It is fetched on the first F2 press instead.
describe('Engine.toggleLevelEditor (F2)', () => {
  beforeEach(() => { editorModule.built.length = 0; });

  it('does not load the editor with the engine', () => {
    expect(editorModule.loaded).toBe(false);
    expect(bareEngine().levelEditor).toBeUndefined();
  });

  it('loads, builds and opens the editor on the first press', async () => {
    const engine = bareEngine();
    await engine.toggleLevelEditor();

    expect(editorModule.built).toHaveLength(1);
    expect(engine.levelEditor).toBe(editorModule.built[0]);
    expect(engine.levelEditor.engine).toBe(engine);
    expect(engine.levelEditor.ready).toBe(true);
    expect(engine.levelEditor.enabled).toBe(true);
  });

  it('closes the same editor on the next press', async () => {
    const engine = bareEngine();
    await engine.toggleLevelEditor();
    await engine.toggleLevelEditor();

    expect(editorModule.built).toHaveLength(1);
    expect(engine.levelEditor.enabled).toBe(false);
  });

  it('builds one editor when F2 is pressed twice before it arrives', async () => {
    const engine = bareEngine();
    await Promise.all([engine.toggleLevelEditor(), engine.toggleLevelEditor()]);

    expect(editorModule.built).toHaveLength(1);
    expect(engine.levelEditor.enabled).toBe(false);   // open, then closed
  });
});
