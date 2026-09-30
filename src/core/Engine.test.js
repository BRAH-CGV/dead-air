import { describe, it, expect, vi, beforeEach } from 'vitest';

// Rapier's WASM build doesn't load under vitest (BUG-003). A scene switch
// only needs a world it can free and replace.
vi.mock('@dimforge/rapier3d', () => ({
  default: { World: class { free() {} } },
}));

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
