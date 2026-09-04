import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DebugCamera } from './DebugCamera.js';
import { GameObject } from './GameObject.js';
import { Component } from './Component.js';

// ─────────────────────────────────────────────
// DebugCamera  –  free-fly spectator camera
// ─────────────────────────────────────────────
// Pure Three.js — no Rapier world needed, because the whole point of the fly
// camera is that it touches no physics.

const KEY_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', crouch: 'KeyC',
};

/** A player-shaped rig: Object3D carrying the camera, like Engine.buildPlayer. */
function buildRig() {
  const scene = new THREE.Scene();
  const player = new GameObject('Player');
  player.object3d.position.set(0, 1, 5);
  scene.add(player.object3d);

  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  camera.rotation.order = 'YXZ';
  player.object3d.add(camera);

  scene.updateMatrixWorld(true);
  return { scene, player, camera };
}

function makeInput(keys = {}, locked = true) {
  return {
    keys,
    locked,
    mouse: { dx: 0, dy: 0 },
  };
}

describe('DebugCamera enable/disable', () => {
  it('detaches the camera onto the scene root, preserving its world pose', () => {
    const { scene, player, camera } = buildRig();
    const dbg = new DebugCamera(camera, scene);

    dbg.enable(player);

    expect(dbg.active).toBe(true);
    expect(camera.parent).toBe(scene);
    // World position carried across the reparent (player stood at 0,1,5).
    expect(camera.position.x).toBeCloseTo(0, 6);
    expect(camera.position.y).toBeCloseTo(1, 6);
    expect(camera.position.z).toBeCloseTo(5, 6);
  });

  it('inherits the camera aim as yaw/pitch', () => {
    const { scene, player, camera } = buildRig();
    const dbg = new DebugCamera(camera, scene);
    camera.rotation.set(0.3, 0.5, 0);

    dbg.enable(player);

    expect(dbg.yaw).toBeCloseTo(0.5, 10);
    expect(dbg.pitch).toBeCloseTo(0.3, 10);
  });

  it('suspends every component on the player while flying', () => {
    const { scene, player, camera } = buildRig();
    const dbg = new DebugCamera(camera, scene);
    const comps = [new Component(), new Component()];
    for (const c of comps) player.addComponent(c);

    dbg.enable(player);
    expect(comps.map(c => c.enabled)).toEqual([false, false]);

    dbg.disable();
    expect(comps.map(c => c.enabled)).toEqual([true, true]);
  });

  it('restore re-mounts the camera on the player with a zeroed local transform', () => {
    const { scene, player, camera } = buildRig();
    const dbg = new DebugCamera(camera, scene);

    dbg.enable(player);
    // Fly somewhere else entirely.
    camera.position.set(40, -12, 3);
    camera.rotation.set(0.4, 2.5, 0);

    dbg.disable();

    expect(camera.parent).toBe(player.object3d);
    expect(camera.position.x).toBe(0);
    expect(camera.position.y).toBe(0);
    expect(camera.position.z).toBe(0);
    expect(camera.rotation.x).toBe(0);
    expect(camera.rotation.y).toBe(0);
    expect(camera.rotation.z).toBe(0);
  });

  it('enable and disable are idempotent', () => {
    const { scene, player, camera } = buildRig();
    const dbg = new DebugCamera(camera, scene);

    dbg.enable(player);
    dbg.enable(player);
    expect(dbg.active).toBe(true);

    dbg.disable();
    dbg.disable();
    expect(dbg.active).toBe(false);
  });

  it('toggle flips state', () => {
    const { scene, player, camera } = buildRig();
    const dbg = new DebugCamera(camera, scene);

    dbg.toggle(player);
    expect(dbg.active).toBe(true);
    dbg.toggle(player);
    expect(dbg.active).toBe(false);
  });

  it('works without a player (null is tolerated)', () => {
    const { scene, camera } = buildRig();
    const dbg = new DebugCamera(camera, scene);

    expect(() => dbg.enable(null)).not.toThrow();
    expect(dbg.active).toBe(true);
    expect(() => dbg.disable()).not.toThrow();
  });
});

describe('DebugCamera flight', () => {
  /** Enabled fly camera, camera re-centred on the origin — flight tests
   *  assert position deltas, and enable() preserves the world pose (0,1,5)
   *  that the rig starts at. */
  function flyRig() {
    const { scene, camera } = buildRig();
    const dbg = new DebugCamera(camera, scene);
    dbg.enable(null);
    camera.position.set(0, 0, 0);
    return { dbg, camera };
  }

  it('W flies forward along the view direction', () => {
    const { dbg, camera } = flyRig();
    dbg.speed = 8;

    dbg.update(1, makeInput({ KeyW: true }), KEY_BINDS);

    expect(camera.position.z).toBeCloseTo(-8, 6);
    expect(camera.position.x).toBeCloseTo(0, 6);
    expect(camera.position.y).toBeCloseTo(0, 6);
  });

  it('S flies backward', () => {
    const { dbg, camera } = flyRig();

    dbg.update(1, makeInput({ KeyS: true }), KEY_BINDS);

    expect(camera.position.z).toBeCloseTo(8, 6);
  });

  it('D strafes right, level regardless of pitch', () => {
    const { dbg, camera } = flyRig();
    dbg.pitch = -0.5;   // looking down
    dbg.update(0, makeInput(), KEY_BINDS);   // apply pitch to the camera

    dbg.update(1, makeInput({ KeyD: true }), KEY_BINDS);

    expect(camera.position.x).toBeCloseTo(8, 6);
    expect(camera.position.y).toBeCloseTo(0, 6);
  });

  it('forward includes pitch — diving descends', () => {
    const { dbg, camera } = flyRig();
    dbg.pitch = -Math.PI / 4;   // 45° down
    dbg.update(0, makeInput(), KEY_BINDS);

    dbg.update(1, makeInput({ KeyW: true }), KEY_BINDS);

    expect(camera.position.z).toBeCloseTo(-8 * Math.SQRT1_2, 6);
    expect(camera.position.y).toBeCloseTo(-8 * Math.SQRT1_2, 6);
  });

  it('Space rises and C sinks', () => {
    const { dbg, camera } = flyRig();

    dbg.update(0.5, makeInput({ Space: true }), KEY_BINDS);
    expect(camera.position.y).toBeCloseTo(4, 6);

    dbg.update(0.5, makeInput({ KeyC: true }), KEY_BINDS);
    expect(camera.position.y).toBeCloseTo(0, 6);
  });

  it('Shift multiplies speed by boost', () => {
    const { dbg, camera } = flyRig();

    dbg.update(1, makeInput({ KeyW: true, ShiftLeft: true }), KEY_BINDS);

    expect(camera.position.z).toBeCloseTo(-8 * 4, 6);
  });

  it('no keys held → no movement', () => {
    const { dbg, camera } = flyRig();

    dbg.update(1, makeInput(), KEY_BINDS);

    expect(camera.position.length()).toBe(0);
  });

  it('mouse deltas steer yaw and pitch, and pitch is clamped', () => {
    const { dbg } = flyRig();
    dbg.sensitivity = 0.1;

    dbg.update(0, { locked: true, keys: {}, mouse: { dx: 1, dy: 0 } }, KEY_BINDS);
    expect(dbg.yaw).toBeCloseTo(-0.1, 10);

    // Massive upward dy — pitch must stop just short of straight up.
    dbg.update(0, { locked: true, keys: {}, mouse: { dx: 0, dy: -1e6 } }, KEY_BINDS);
    expect(dbg.pitch).toBeLessThan(Math.PI / 2);
    expect(dbg.pitch).toBeGreaterThan(Math.PI / 2 - 0.05);
  });

  it('ignores mouse when the pointer is not locked', () => {
    const { dbg } = flyRig();

    dbg.update(0, { locked: false, keys: {}, mouse: { dx: 50, dy: 50 } }, KEY_BINDS);

    expect(dbg.yaw).toBe(0);
    expect(dbg.pitch).toBe(0);
  });

  it('does nothing while inactive', () => {
    const { scene, camera } = buildRig();
    const dbg = new DebugCamera(camera, scene);

    dbg.update(1, makeInput({ KeyW: true }), KEY_BINDS);

    expect(camera.position.x).toBe(0);
    expect(camera.position.y).toBe(0);
    expect(camera.position.z).toBe(0);
  });
});

describe('Component.enabled guard (GameObject propagation)', () => {
  class Probe extends Component {
    updates = 0;
    fixed   = 0;
    late    = 0;
    onUpdate()     { this.updates++; }
    onFixedUpdate() { this.fixed++; }
    onLateUpdate()  { this.late++; }
  }

  it('disabled components skip every per-frame hook', () => {
    const go = new GameObject('go');
    const on = new Probe();
    const off = new Probe();
    off.enabled = false;
    go.addComponent(on);
    go.addComponent(off);

    go._update(0.016);
    go._fixedUpdate(1 / 60);
    go._lateUpdate(0.016);

    expect(on.updates).toBe(1);
    expect(on.fixed).toBe(1);
    expect(on.late).toBe(1);
    expect(off.updates).toBe(0);
    expect(off.fixed).toBe(0);
    expect(off.late).toBe(0);
  });

  it('a disabled component still receives its one-shot lifecycle', () => {
    const go = new GameObject('go');
    const c = new Probe();
    c.enabled = false;
    go.addComponent(c);

    go._update(0.016);   // triggers onStart even while disabled

    expect(c.updates).toBe(0);   // but not the per-frame hook
  });
});
