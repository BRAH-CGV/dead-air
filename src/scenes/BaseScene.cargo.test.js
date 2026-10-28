import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { makeEngine } from '../test/fakeRapier.js';
import { BuggyCargo, BUGGY_CARGO } from '../components/BuggyCargo.js';
import { BED_TRANSITION } from '../gameplay/BedTransition.js';

// A full base build is slow under jsdom — see BaseScene.test.js.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// ─────────────────────────────────────────────
// The morning's job: the night's drive box carried out to the buggy and
// loaded into its boot before bed (#98). The rules are in GameController and
// BuggyCargo; this pins the wiring into the real base. A file of its own,
// like BaseScene.stamina.test.js, so the builds don't pile up in one worker.
// ─────────────────────────────────────────────

/** The buggy as the real spawn draws it: a box its size at BUGGY_SCALE
 *  (colony-rover.glb is ~3.4 × 3.3 × 6.6 m, its origin at its middle). */
const BUGGY_SIZE = [2.55, 2.48, 4.95];

function makeSceneEngine() {
  const engine = makeEngine();
  engine.scene = new THREE.Scene();
  engine.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);
  engine.assets = { get: vi.fn(() => null) };
  engine.isAction ??= () => false;
  engine.consumeAction ??= () => {};
  engine.camera ??= new THREE.PerspectiveCamera();
  const spawn = engine.spawnModel;
  engine.spawnModel = vi.fn((key, opts) => {
    const go = spawn(key, opts);
    if (key === 'model:colony-rover') go.object3d.add(new THREE.Mesh(new THREE.BoxGeometry(...BUGGY_SIZE)));
    return go;
  });
  engine.buildPlayer = vi.fn(({ position = [0, 1, 5] } = {}) => {
    const player = new GameObject('Player');
    player.object3d.position.set(...position);
    engine.player = player;
    engine._rootObjects.push(player);
    return player;
  });
  return engine;
}

const boxOf = go => { go.object3d.updateMatrixWorld(true); return new THREE.Box3().setFromObject(go.object3d); };

describe('BaseScene — the drives go out to the buggy before bed', () => {
  let engine, scene, outside, cargo;

  beforeEach(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
    outside = scene._sceneRoot.find('Outside');
    cargo = scene.buggyCargo;
  });

  /** Dock a shelf box holding the quota's saved drives, enough of them
   *  processed, and run the clock out: it is morning. @returns the docked box */
  function workTheShift() {
    const { gameController, rooms } = scene;
    const dock = rooms.Airlock.quotaDock;
    const box = rooms.MainOffice.driveBoxes[0];
    dock.socket.attach(box, 0);
    const seated = box.receiver.attachedItems.filter(Boolean);
    for (let i = 0; i < dock.requiredCount; i++) seated[i].setSaved(true);
    for (let i = 0; i < dock.requiredProcessed; i++) seated[i].setSignalLevel(2);
    gameController.onSignalSaved();
    gameController.onUpdate(999);
    expect(gameController.state).toBe('morning');
    return box;
  }

  /** Carry the docked box out of the airlock and set it on the bay. */
  function loadTheBuggy(box) {
    scene.rooms.Airlock.quotaDock.socket.detach(box);
    return cargo.dock.socket.attach(box, 0);
  }

  it('puts the boot on the buggy\'s rear, inside the fence, with a fixed body', () => {
    const buggy = outside.find('Buggy');
    const boot = scene.buggyBoot;
    expect(boot).toBeTruthy();
    expect(boot.getComponent(BuggyCargo)).toBe(cargo);
    expect(boot.rigidBody).toBeTruthy();

    // The boot sits on the buggy's rear (-z end).
    const buggyBox = boxOf(buggy);
    const bootBox = boxOf(boot);
    // The boot's top is roughly at BUGGY_CARGO.top.
    expect(bootBox.max.y).toBeCloseTo(BUGGY_CARGO.top, 0);

    // Inside the fence.
    const { minX, maxX, minZ, maxZ } = scene.fence.rect;
    expect(bootBox.min.x).toBeGreaterThan(minX);
    expect(bootBox.max.x).toBeLessThan(maxX);
    expect(bootBox.min.z).toBeGreaterThan(minZ);
    expect(bootBox.max.z).toBeLessThan(maxZ);
  });

  it("is part of the buggy's GameObject tree, its colliders on its floor and walls", () => {
    const boot = scene.buggyBoot;
    expect(outside.find('Buggy').children).toContain(boot);   // so its components tick
    const box = boxOf(boot).expandByScalar(0.01);
    const t = boot.rigidBody.translation();
    const q = boot.rigidBody.rotation();
    const bodyAt = new THREE.Vector3(t.x, t.y, t.z);
    const bodyQ = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    expect(boot.colliders).toHaveLength(5);
    for (const c of boot.colliders) {
      const o = c.translation();
      const at = new THREE.Vector3(o.x, o.y, o.z).applyQuaternion(bodyQ).add(bodyAt);
      expect(box.containsPoint(at)).toBe(true);
    }
  });

  it('sends the buggy off: out through the gate, the box with it, then back for the evening', () => {
    const box = workTheShift();
    loadTheBuggy(box);
    const buggy = outside.find('Buggy');
    const parked = buggy.object3d.position.clone();
    const send = scene.buggySendOff;
    expect(cargo.canSend).toBe(true);
    cargo.onInteract({});
    expect(send.active).toBe(true);
    expect(engine.viewCamera).toBeTruthy();

    // Drive it out (no #fade under jsdom: the dark comes at once).
    let passedGate = false;
    engine.realDt = 1 / 30;
    for (let i = 0; i < 30 * 60 && send.active; i++) {
      send.onUpdate(1 / 30);
      const p = buggy.object3d.position;
      if (p.z > scene.fence.rect.maxZ) {
        passedGate ||= Math.abs(p.x - scene.exitGate.at) < 1;
      }
    }
    expect(passedGate).toBe(true);
    expect(send.logic.phase).toBe('gone');
    expect(scene.gameController.dispatched).toBe(true);
    expect(scene.gameController.canSleep).toBe(true);
    expect(engine.viewCamera).toBeNull();
    expect(buggy.object3d.position.y).toBe(-50);
    expect(box.object3d.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(-40);

    scene.nights.advance();
    expect(buggy.object3d.position.distanceTo(parked)).toBeLessThan(1e-6);
    expect(send.logic.phase).toBe('idle');
    expect(scene.fence.gate.open).toBe(0);
  });

  it('the fence has a gate on the north side', () => {
    const gate = scene.fence.gate;
    expect(gate).toBeTruthy();
    expect(gate.side).toBe('N');
  });

  it('is wired to the controller, which asks it for the night\'s quota', () => {
    expect(cargo.controller).toBe(scene.gameController);
    expect(scene.gameController.cargo).toBe(cargo.dock);
    expect(cargo.dock.requiredCount).toBe(scene.rooms.Airlock.quotaDock.requiredCount);
    // Every shelf box can be set down on it.
    for (const box of scene.rooms.MainOffice.driveBoxes) expect(cargo.dock.socket.candidates).toContain(box);
  });

  it('refuses the box during the shift: the quota is counted at the airlock all night', () => {
    const box = scene.rooms.MainOffice.driveBoxes[0];
    expect(cargo.dock.socket.attach(box, 0)).toBe(false);
    expect(cargo.dock.depositedBox).toBeNull();
  });

  it('keeps the bed shut in the morning until the box is loaded and the buggy sent, then sleeps', () => {
    const box = workTheShift();
    const bed = scene.rooms.LivingQuarters.bed;
    bed.onUpdate(0.016);
    expect(bed.promptLabel).toMatch(/buggy/i);
    bed.onInteract({});
    expect(scene.bedRest.active).toBe(false);
    expect(scene.gameController.nightNumber).toBe(1);

    expect(loadTheBuggy(box)).toBe(true);
    expect(scene.gameController.canSleep).toBe(false);   // loaded, not yet sent off
    expect(scene.gameController.dispatch()).toBe(true);
    expect(scene.gameController.canSleep).toBe(true);
    bed.onUpdate(0.016);
    expect(bed.promptLabel).toBe('[E] Sleep');
    bed.onInteract({});
    for (let t = 0; t < BED_TRANSITION.lieDown + 0.1; t += 0.05) scene.bedRest.onUpdate(0.05);
    expect(scene.gameController.nightNumber).toBe(2);
  });

  it('the next night empties the bay: the box comes back to the office floor, its drives blank', () => {
    const box = workTheShift();
    const drives = box.receiver.attachedItems.filter(Boolean);
    loadTheBuggy(box);
    scene.gameController.dispatch();
    scene.gameController.sleep();
    expect(scene.gameController.nightNumber).toBe(2);

    expect(cargo.dock.depositedBox).toBeNull();
    expect(box._snapOwner).toBeNull();
    const office = scene.rooms.MainOffice.bounds();
    expect(office.containsPoint(box.object3d.getWorldPosition(new THREE.Vector3()))).toBe(true);
    for (const drive of drives) expect(drive.saved, drive.name).toBe(false);
  });

  it('two boxes left out — one docked, one loaded — are parked apart', () => {
    const [docked, loaded] = scene.rooms.MainOffice.driveBoxes;
    workTheShift();
    scene.rooms.Airlock.quotaDock.socket.detach(docked);
    cargo.dock.socket.attach(docked, 0);
    scene.rooms.Airlock.quotaDock.socket.attach(loaded, 0);
    scene.nights.advance();
    const a = docked.object3d.position, b = loaded.object3d.position;
    expect(a.distanceTo(b)).toBeGreaterThan(0.3);
  });

  it('a chasing dust eye goes round the buggy (which now includes the boot)', () => {
    const buggyBox = boxOf(outside.find('Buggy'));
    const rects = scene._yardObstacles();
    // The Buggy's box now includes the boot, so the obstacle rect covers both.
    expect(rects.some(r => Math.abs(r.minX - buggyBox.min.x) < 0.1 && Math.abs(r.maxZ - buggyBox.max.z) < 0.1)).toBe(true);
  });
});
