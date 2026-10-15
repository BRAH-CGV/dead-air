import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { makeEngine } from '../test/fakeRapier.js';
import { Flashlight } from '../components/Flashlight.js';
import { Tutorial, TUTORIAL } from '../components/Tutorial.js';
import { TUTORIAL_QUOTA } from '../gameplay/SignalManager.js';

// A full base build is slow under jsdom — see BaseScene.test.js.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// ─────────────────────────────────────────────
// Night 0, the tutorial, wired into the real base. Its steps are covered in
// TutorialSteps.test.js and the component on fakes in Tutorial.test.js;
// this pins the wiring. A file of its own, like BaseScene.stamina.test.js.
// ─────────────────────────────────────────────

function makeSceneEngine() {
  const engine = makeEngine();
  engine.scene = new THREE.Scene();
  engine.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);
  engine.assets = { get: vi.fn(() => null) };
  engine.buildPlayer = vi.fn(({ position = [0, 1, 5] } = {}) => {
    const player = new GameObject('Player');
    player.object3d.position.set(...position);
    player.addComponent(new Flashlight());
    engine.player = player;
    engine._rootObjects.push(player);
    return player;
  });
  return engine;
}

describe('BaseScene tutorial (night 0)', () => {
  let engine, scene, gameplay;
  const frames = (seconds, dt = 0.1) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) gameplay._update(dt);
  };

  beforeEach(() => {
    engine = makeSceneEngine();
    engine.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    engine.camera.position.set(0, 1.24, 0);
    scene = new BaseScene(engine);
    scene.build();
    gameplay = scene._sceneRoot.find('GameplaySystems');
  });

  afterEach(() => vi.restoreAllMocks());

  it('is on GameplaySystems after the nap, so it reads every system after it has moved', () => {
    const tutorial = gameplay.getComponent(Tutorial);
    expect(tutorial).toBe(scene.tutorial);
    expect(gameplay.components.indexOf(tutorial)).toBeGreaterThan(gameplay.components.indexOf(scene.nap));
  });

  it('the scene is built on night 1, and night 0 can be set', () => {
    expect(scene.nights.currentNight).toBe(1);
    expect(scene.nights.minNight).toBe(0);
    frames(0.1);
    expect(scene.tutorial.active).toBe(false);
    scene.nights.setNight(0);
    expect(scene.gameController.nightNumber).toBe(0);
    expect(scene.tutorial.active).toBe(true);
  });

  it('night 0 asks for one signal, has one, and holds the clock at 7 PM', () => {
    scene.nights.setNight(0);
    frames(1);
    expect(scene.signalManager.required).toBe(TUTORIAL_QUOTA);
    expect(scene.signalManager.signals.length).toBe(1);
    expect(scene.rooms.Airlock.quotaDock.requiredCount).toBe(TUTORIAL_QUOTA);
    expect(scene.nightClock.currentTime).toBe(TUTORIAL.startHour);
    expect(scene.nightClock.paused).toBe(true);
  });

  it('every arrow has something to point at', () => {
    for (const [name, target] of Object.entries(scene.tutorial.targets)) {
      const object = typeof target.object === 'function' ? target.object() : target.object;
      expect(object, name).toBeInstanceOf(THREE.Object3D);
    }
  });

  it('reads the drives in the office\'s boxes', () => {
    scene.nights.setNight(0);
    frames(0.1);
    const [box] = scene.rooms.MainOffice.driveBoxes;
    const drive = box.receiver.attachments.find(Boolean).item;
    expect(scene.tutorial.readContext().boxed).toBe(false);
    drive.setSaved(true);
    expect(scene.tutorial.readContext().boxed).toBe(true);
  });

  it('the storm step brings a storm that takes the power', () => {
    scene.nights.setNight(0);
    frames(0.1);
    expect(scene.power.on).toBe(true);
    scene.tutorial.runner.goTo('storm');
    frames(60, 0.25);
    expect(scene.sandstorm.level).toBeGreaterThan(0);
    expect(scene.power.on).toBe(false);
    expect(scene.tutorial.runner.step.id).toBe('flashlight');
  });

  it('a drive box set down on the office desk is on the desk', () => {
    scene.nights.setNight(0);
    frames(0.1);
    const [box] = scene.rooms.MainOffice.driveBoxes;
    expect(scene.tutorial.readContext().boxOnDesk).toBe(false);
    const desk = scene.rooms.MainOffice.root.find('ComputerDesk').object3d;
    const top = desk.localToWorld(new THREE.Vector3(0.3, 0.95, 0));
    box.object3d.parent.worldToLocal(top);
    box.object3d.position.copy(top);
    box.object3d.updateMatrixWorld(true);
    expect(scene.tutorial.readContext().boxOnDesk).toBe(true);
  });

  it("reads the player's flashlight", () => {
    scene.nights.setNight(0);
    frames(0.1);
    expect(scene.tutorial.readContext().flashlightOn).toBe(false);
    engine.player.getComponent(Flashlight).toggle();
    expect(scene.tutorial.readContext().flashlightOn).toBe(true);
  });

  it('no storm of its own on night 0, however long it is played', () => {
    scene.nights.setNight(0);
    frames(0.1);
    scene.nightClock.resume();              // as it does once the quota is met
    frames(120, 0.5);
    expect(scene.sandstorm.level).toBe(0);
  });
});
