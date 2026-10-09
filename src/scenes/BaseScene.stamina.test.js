import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { makeEngine } from '../test/fakeRapier.js';
import { Stamina } from '../gameplay/Stamina.js';
import { StaminaDrain, FATIGUE_DIM_MIN } from '../components/StaminaDrain.js';
import { SleepDemon } from '../gameplay/SleepDemon.js';
import { SLEEP_DEMON_DEATH } from '../gameplay/SleepDemonDeath.js';
import { FatigueEffects } from '../components/FatigueEffects.js';
import { FatigueOverlay } from '../ui/FatigueOverlay.js';
import { Flashlight } from '../components/Flashlight.js';

// A full base build is slow under jsdom — see BaseScene.test.js.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// ─────────────────────────────────────────────
// Stamina, the Sleep Demon and fatigue, wired into the real base. Their rules
// are covered beside their own modules (Stamina, SleepDemonLogic, Fatigue);
// this pins the wiring. A file of its own, like BaseScene.ambience.test.js:
// every test here builds the whole base, the builds in one file pile up in
// its worker's memory, and BaseScene.test.js ran out with these added to it.
// ─────────────────────────────────────────────

function makeSceneEngine() {
  const engine = makeEngine();
  engine.scene = new THREE.Scene();
  engine.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);
  engine.assets = { get: vi.fn(() => null) };
  engine.buildPlayer = vi.fn(({ position = [0, 1, 5] } = {}) => {
    const player = new GameObject('Player');
    player.object3d.position.set(...position);
    player.addComponent(new Flashlight());   // as Engine.buildPlayer gives it one
    engine.player = player;
    engine._rootObjects.push(player);
    return player;
  });
  return engine;
}

describe('BaseScene stamina, the sleep demon and fatigue', () => {
  let engine, scene, gameplay;
  const at = c => gameplay.components.indexOf(c);
  /** Frames of the demon alone, `seconds` long. */
  const runDemon = (seconds, dt = 0.1) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) scene.sleepDemon.onUpdate(dt);
  };

  beforeEach(() => {
    engine = makeSceneEngine();
    // The demon finds the corner of the player's eye through the camera:
    // here, at eye height in the office, looking at the window.
    engine.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    engine.camera.position.set(0, 1.24, 0);
    scene = new BaseScene(engine);
    scene.build();
    gameplay = scene._sceneRoot.find('GameplaySystems');
  });

  afterEach(() => vi.restoreAllMocks());

  it('one Stamina for the night: drained after the controller, read by the demon, then played out as fatigue', () => {
    expect(scene.stamina).toBeInstanceOf(Stamina);
    const drain = gameplay.getComponent(StaminaDrain);
    const fx = gameplay.getComponent(FatigueEffects);
    expect(gameplay.getComponent(SleepDemon)).toBe(scene.sleepDemon);
    for (const c of [drain, scene.sleepDemon, fx]) {
      expect(c.stamina).toBe(scene.stamina);
      expect(c.controller).toBe(scene.gameController);
    }
    // Within a frame, each reads this frame's stamina.
    expect(at(drain)).toBeGreaterThan(at(scene.gameController));
    expect(at(scene.sleepDemon)).toBeGreaterThan(at(drain));
    expect(at(fx)).toBeGreaterThan(at(drain));
  });

  it('shows the stamina bar on the HUD, and a tired player sees the base dim, on top of the power', () => {
    const drain = gameplay.getComponent(StaminaDrain);
    expect(drain.hud).toBe(scene.hud);
    const ceiling = scene.rooms.MainOffice.root.find('CeilingLight').object3d.children.find(o => o.isLight);
    const full = ceiling.intensity;
    scene.stamina.value = 0;
    drain.onUpdate(0);
    scene.power.update(0.016);
    expect(ceiling.intensity).toBeCloseTo(full * FATIGUE_DIM_MIN);
    scene.power.setOn(false);
    scene.power.update(0.016);
    expect(ceiling.intensity).toBe(0);
  });

  it("feeds the office's ration dispenser the same stamina, and has it ready again each night", () => {
    const dispenser = scene.rooms.MainOffice.rationDispenser;
    expect(dispenser.stamina).toBe(scene.stamina);
    scene.stamina.value = 0.2;
    dispenser.onInteract({});
    expect(scene.stamina.value).toBeCloseTo(0.55);
    expect(dispenser.refill).toBeGreaterThan(0);

    gameplay.getComponent(StaminaDrain).onStart();
    scene.nights.advance();
    expect(scene.stamina.value).toBe(1);
    expect(dispenser.refill).toBe(0);
  });

  it('a ration makes a sound', () => {
    const ration = { isPlaying: false, play: vi.fn(), stop: vi.fn() };
    vi.spyOn(BaseScene.prototype, '_sound').mockImplementation(key => (key === 'sfx:ration' ? ration : null));
    const other = new BaseScene(makeSceneEngine());
    other.build();
    other.rooms.MainOffice.rationDispenser.onInteract({});
    expect(ration.play).toHaveBeenCalledTimes(1);
  });

  it('the sleep demon is a hidden placeholder under Threats: no body, and in no occlusion zone', () => {
    const figure = scene._sceneRoot.find('Threats').find('SleepDemon');
    expect(figure).toBe(scene.sleepDemon.figure);
    expect(figure.object3d.visible).toBe(false);
    expect(figure.rigidBody).toBeNull();
    expect(figure.placeholderFor).toBe('sleep-demon.glb');
    // A zone hides and shows what it holds; the demon shows itself, wherever
    // the player is.
    const zoned = scene.zones.names().flatMap(name => scene.zones.objects(name));
    for (let o = figure.object3d; o; o = o.parent) expect(zoned).not.toContain(o);
  });

  it("watches the player's camera, and the terminal's screen covers the view", () => {
    expect(scene.sleepDemon.camera).toBe(engine.camera);
    expect(scene.sleepDemon.terminal).toBe(scene.terminal);
  });

  it("is handed the player's flashlight, which stutters while the beam is on it", () => {
    expect(scene.sleepDemon.flashlight).toBeInstanceOf(Flashlight);
    expect(scene.sleepDemon.flashlight).toBe(engine.player.getComponent(Flashlight));
  });

  it("ducks the scene's ambience as the view comes round to it: dead air", () => {
    expect(scene.sleepDemon.ambience).toBe(scene.ambience);
  });

  it('comes for the player on every night, 1 to 3', () => {
    scene.sleepDemon.onStart();
    for (const night of [1, 2, 3]) {
      if (night > 1) scene.nights.advance();
      expect(scene.gameController.nightNumber).toBe(night);
      expect(scene.sleepDemon.figure.object3d.visible).toBe(false);
      scene.stamina.value = 0.425;
      runDemon(4);
      expect(scene.sleepDemon.figure.object3d.visible, `night ${night}`).toBe(true);
    }
  });

  it('holds while the fly camera is out, and every show redraws the frozen shadow maps', () => {
    engine.shadows = { invalidate: vi.fn() };
    engine.debugCamera = { active: true };
    scene.sleepDemon.onStart();
    scene.stamina.value = 0.425;
    runDemon(4);
    expect(scene.sleepDemon.figure.object3d.visible).toBe(false);
    expect(engine.shadows.invalidate).not.toHaveBeenCalled();
    engine.debugCamera.active = false;
    runDemon(4);
    expect(scene.sleepDemon.figure.object3d.visible).toBe(true);
    expect(engine.shadows.invalidate).toHaveBeenCalled();
  });

  it('ends the night when stamina runs out, once the player has fallen asleep on it', () => {
    scene.sleepDemon.onStart();
    scene.stamina.value = 0;
    scene.sleepDemon.onUpdate(0.1);
    expect(scene.gameController.state).toBe('playing');
    const { passOut, black, loom, cut } = SLEEP_DEMON_DEATH;
    runDemon(passOut + black + loom + cut + 0.2);
    expect(scene.gameController.state).toBe('gameOver');
  });

  it("its death writes FatigueEffects' own overlay, and has the screen fade and the listener", () => {
    const fx = gameplay.getComponent(FatigueEffects);
    expect(scene.sleepDemon.overlay).toBe(fx.overlay);
    expect(scene.sleepDemon.fade).toBe(scene.screenFade);
    expect(scene.sleepDemon.listener).toBe(engine.audioListener ?? null);
  });

  it("frees the placeholder's geometry on dispose", () => {
    const body = scene.sleepDemon.figure.object3d.children.find(o => o.isMesh);
    const dispose = vi.spyOn(body.geometry, 'dispose');
    scene.dispose();
    expect(dispose).toHaveBeenCalled();
  });

  it("plays fatigue out on the overlay and the grid's 'dread' factor, and clears it for the fly camera", () => {
    const fx = gameplay.getComponent(FatigueEffects);
    expect(fx.overlay).toBeInstanceOf(FatigueOverlay);
    expect(fx.grid).toBe(scene.power);
    scene.power.setFactor('dread', 0.5);
    fx.onUpdate(0.016);
    expect(scene.power.getFactor('dread')).toBe(1);
    expect(fx.isFrozen()).toBe(false);
    engine.debugCamera = { active: true };
    expect(fx.isFrozen()).toBe(true);
  });
});
