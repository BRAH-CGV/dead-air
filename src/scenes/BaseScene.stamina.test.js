import { Footsteps, STEP_SOUNDS } from '../components/Footsteps.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { makeEngine } from '../test/fakeRapier.js';
import { Stamina, STAMINA } from '../gameplay/Stamina.js';
import { StaminaDrain, FATIGUE_DIM_MIN } from '../components/StaminaDrain.js';
import { SleepDemon } from '../gameplay/SleepDemon.js';
import { SLEEP_DEMON_DEATH } from '../gameplay/SleepDemonDeath.js';
import { FatigueEffects } from '../components/FatigueEffects.js';
import { FatigueOverlay } from '../ui/FatigueOverlay.js';
import { Flashlight } from '../components/Flashlight.js';
import { CoffeeMachine, COFFEE } from '../components/CoffeeMachine.js';
import { CoffeeHarvest, COFFEE_HARVEST } from '../gameplay/CoffeeHarvest.js';
import { CoffeeItems } from '../components/CoffeeItems.js';
import { ProcessorSound } from '../components/ProcessorSound.js';
import { ImpactSound, IMPACT_SOUNDS } from '../components/ImpactSound.js';

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

  it("drains over the scene's own shift, so a longer night drains as slowly", () => {
    const shift = scene.nightClock.nightDuration;
    expect(scene.stamina.drainPerSecond).toBeCloseTo(1 / (STAMINA.emptyAt * shift));
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

  /** Carry what is in hand to `object` and let it go there. */
  const dropAt = (item, object) => {
    item.place(object.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.6, 0, 0)));
    scene.pickupSystem.dropHeld();
  };

  /** Pick a ripe bush, let the beans go by the office's processor, [E] to
   *  process them, pick up the bag: a bag of ground coffee in hand. */
  const groundCoffee = () => {
    const { coffeeBushes, beanProcessor } = scene.rooms.MainOffice;
    const i = scene.coffee.bushes.indexOf('ripe');
    const rack = coffeeBushes.gameObject.object3d;
    rack.updateMatrixWorld(true);
    coffeeBushes.onInteract({ point: rack.localToWorld(coffeeBushes.bushes[i].clone().setX(0.35)) });
    const pile = scene.coffeeItems.held('beans');
    expect(pile).toBeTruthy();                            // the beans in hand
    dropAt(pile, beanProcessor.gameObject.object3d);
    beanProcessor.onUpdate(0.016);
    expect(pile.inPlay).toBe(false);                      // taken in
    beanProcessor.onInteract({});
    beanProcessor.onUpdate(COFFEE_HARVEST.processSeconds + 0.1);
    const bag = scene.coffeeItems.bags.find(b => b.inPlay);
    scene.pickupSystem.pickUp(bag.pickupable);
    return bag;
  };

  it('one night\'s coffee for the rack, the processor and the bedroom machine: two ripe bushes, fresh each night (#168)', () => {
    expect(scene.coffee).toBeInstanceOf(CoffeeHarvest);
    expect(scene.coffeeItems).toBeInstanceOf(CoffeeItems);
    const { coffeeBushes, beanProcessor } = scene.rooms.MainOffice;
    expect(coffeeBushes.harvest).toBe(scene.coffee);
    expect(coffeeBushes.items).toBe(scene.coffeeItems);
    expect(beanProcessor.harvest).toBe(scene.coffee);
    expect(beanProcessor.items).toBe(scene.coffeeItems);
    expect(scene.coffee.bushes.length).toBe(coffeeBushes.bushes.length);
    expect(scene.coffee.ripeLeft).toBe(COFFEE_HARVEST.ripePerNight);
    // The goods are the office's, carried like its drives.
    for (const it of [...scene.coffeeItems.beans, ...scene.coffeeItems.bags]) {
      expect(it.parent).toBe(scene.rooms.MainOffice.root);
      expect(it.inPlay).toBe(false);
    }

    const bag = groundCoffee();
    expect(scene.coffeeItems.held('bag')).toBe(bag);
    expect(scene.coffee.ripeLeft).toBe(1);

    gameplay.getComponent(StaminaDrain).onStart();
    scene.nights.advance();
    expect(scene.coffee.ripeLeft).toBe(COFFEE_HARVEST.ripePerNight);
    expect(bag.inPlay).toBe(false);                       // put away, out of the hands
    expect(scene.pickupSystem.heldPickupable).toBeNull();
  });

  it('the coffee sounds: the processor grinds and sounds the beans going in, the machine the bag', () => {
    const processor = scene.rooms.MainOffice.beanProcessor.gameObject;
    const grind = processor.getComponent(ProcessorSound);
    expect(grind).toBeTruthy();
    expect(grind.harvest).toBe(scene.coffee);
    expect(processor.getComponent(ImpactSound).clips).toEqual(IMPACT_SOUNDS.beans.clips);
    const machine = scene.rooms.LivingQuarters.coffeeMachine.gameObject;
    expect(machine.getComponent(ImpactSound).clips).toEqual(IMPACT_SOUNDS.bag.clips);
  });

  it("hands the bedroom's coffee machine the same stamina and the coffee carried to it", () => {
    const machine = scene.rooms.LivingQuarters.coffeeMachine;
    expect(machine).toBeInstanceOf(CoffeeMachine);
    expect(machine.stamina).toBe(scene.stamina);
    expect(machine.items).toBe(scene.coffeeItems);
    scene.stamina.value = 0.2;
    machine.onInteract({});
    expect(machine.state).toBe('empty');                  // nothing to brew with yet
    const bag = groundCoffee();
    dropAt(bag, machine.gameObject.object3d);
    machine.onUpdate(0.016);
    expect(bag.inPlay).toBe(false);                       // the bag went in
    machine.onInteract({});
    machine.onUpdate(COFFEE.brewSeconds + 0.1);
    machine.onInteract({});
    expect(scene.stamina.value).toBeCloseTo(0.2 + COFFEE.amount);

    gameplay.getComponent(StaminaDrain).onStart();
    scene.nights.advance();
    expect(scene.stamina.value).toBe(1);
    expect(machine.state).toBe('empty');
  });

  it('the player has footsteps, that know when they are outside', () => {
    const feet = engine.player.getComponent(Footsteps);
    expect(feet).toBeTruthy();
    expect(feet.isOutside()).toBe(false);                  // the camera is in the office
    engine.camera.position.set(200, 1.24, 200);
    engine.camera.updateMatrixWorld();
    expect(feet.isOutside()).toBe(true);
    // …that know what is under them…
    expect(scene.rooms.LivingQuarters.root.find('Desk').surface).toBe('wood');
    expect(scene.rooms.LivingQuarters.root.find('SideTable').surface).toBe('wood');
    expect(scene.rooms.LivingQuarters.root.find('Bunk').surface).toBe('bed');
    expect(scene.rooms.MainOffice.root.find('ComputerDesk').surface).toBe('wood');
    expect(feet.surfaceUnder()).toBe('floor');
    // …and that are muffled in the suit, put on the player after them.
    expect(feet.cutoff('interior')).toBe(STEP_SOUNDS.lowpass);
    scene.suit.putOn();
    expect(feet.cutoff('interior')).toBe(STEP_SOUNDS.suitLowpass);
  });

  it('a coffee is slurped as it is drunk, not as it brews', () => {
    const sip = { isPlaying: false, play: vi.fn(), stop: vi.fn() };
    vi.spyOn(BaseScene.prototype, '_sound').mockImplementation(key => (key === 'sfx:slurp' ? sip : null));
    const other = new BaseScene(makeSceneEngine());
    other.build();
    const machine = other.rooms.LivingQuarters.coffeeMachine;
    machine.loaded = true;                                // a bag of ground coffee in it
    machine.onUpdate(0.016);
    machine.onInteract({});
    expect(sip.play).not.toHaveBeenCalled();
    machine.onUpdate(COFFEE.brewSeconds + 0.1);
    machine.onInteract({});
    expect(sip.play).toHaveBeenCalledTimes(1);
  });

  it('drains faster with the player outside, and faster again while they stare at the dust eyes', () => {
    const drain = gameplay.getComponent(StaminaDrain);
    expect(drain.isOutside()).toBe(false);                 // the camera is in the office
    engine.camera.position.set(200, 1.24, 200);
    engine.camera.updateMatrixWorld();
    expect(drain.isOutside()).toBe(true);

    expect(drain.isStaring()).toBe(false);
    scene.dustEyes.staredAt = true;
    expect(drain.isStaring()).toBe(true);
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

  it('the sleep demon wears the baked model once it is loaded: its body, eyes and grin', () => {
    const model = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 0.3).translate(0, 0.9, 0));
    body.name = 'Body';
    model.add(body);
    for (const [name, z] of [['EyeL', 0.14], ['EyeR', 0.14], ['Mouth', 0.15], ['MouthAxis', 0.03]]) {
      const node = new THREE.Object3D();
      node.name = name;
      node.position.set(name === 'EyeL' ? -0.05 : 0.05, 1.6, z);
      model.add(node);
    }
    const withModel = makeSceneEngine();
    withModel.assets = {
      has: key => key === 'model:sleep-demon',
      get: vi.fn(key => (key === 'model:sleep-demon' ? { scene: model } : null)),
    };
    const other = new BaseScene(withModel);
    other.build();
    const figure = other.sleepDemon.figure;
    expect(figure.placeholderFor).toBeNull();
    const worn = figure.object3d.children.find(c => c.name === 'SleepDemonBody');
    expect(worn.geometry.attributes.position.count).toBe(body.geometry.attributes.position.count);
    expect(worn.material.fragmentShader).toMatch(/uEdge/);   // the shade
    expect(figure.eyes[0].position.z).toBeCloseTo(0.14);
    expect(figure.smile.visible).toBe(false);
  });

  it("watches the player's camera, and the terminal's screen covers the view", () => {
    expect(scene.sleepDemon.camera).toBe(engine.camera);
    expect(scene.sleepDemon.terminal.state).toBe('idle');
    scene.terminal.state = 'radar';
    expect(scene.sleepDemon.terminal.state).toBe('radar');
    scene.terminal.state = 'idle';
  });

  it('the security monitor covers the view too: nobody is watching the room through it', () => {
    expect(scene.cameraTerminal).toBeTruthy();
    scene.cameraTerminal.state = 'viewing';
    expect(scene.sleepDemon.terminal.state).toBe('viewing');
    scene.cameraTerminal.state = 'idle';
    expect(scene.sleepDemon.terminal.state).toBe('idle');
  });

  it("is handed the player's flashlight, which stutters while the beam is on it", () => {
    expect(scene.sleepDemon.flashlight).toBeInstanceOf(Flashlight);
    expect(scene.sleepDemon.flashlight).toBe(engine.player.getComponent(Flashlight));
  });

  it("is handed fatigue itself: the walk-down's dread lands on the breath and the heart", () => {
    const fx = gameplay.getComponent(FatigueEffects);
    expect(scene.fatigueEffects).toBe(fx);
    expect(scene.sleepDemon.fatigue).toBe(fx);
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
      scene.stamina.value = 0.25;
      runDemon(4);
      expect(scene.sleepDemon.figure.object3d.visible, `night ${night}`).toBe(true);
    }
  });

  it('holds while the fly camera is out; it casts no shadow, so it never redraws the frozen shadow maps', () => {
    engine.shadows = { invalidate: vi.fn() };
    engine.debugCamera = { active: true };
    scene.sleepDemon.onStart();
    scene.stamina.value = 0.25;
    runDemon(4);
    expect(scene.sleepDemon.figure.object3d.visible).toBe(false);
    expect(engine.shadows.invalidate).not.toHaveBeenCalled();
    engine.debugCamera.active = false;
    runDemon(4);
    expect(scene.sleepDemon.figure.object3d.visible).toBe(true);
    expect(engine.shadows.invalidate).not.toHaveBeenCalled();
    scene.sleepDemon.figure.object3d.traverse(node => {
      if (node.isMesh) expect(node.castShadow, node.name).toBe(false);
    });
    // A shadow in itself: pitch black, whatever light is on it.
    const body = scene.sleepDemon.figure.object3d.children.find(c => c.name.endsWith('Body'));
    expect(body.material.isShaderMaterial).toBe(true);
    expect(body.material.lights).toBe(false);
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
