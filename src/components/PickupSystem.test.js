import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { PickupSystem } from './PickupSystem.js';
import { Pickupable } from './Pickupable.js';
import { Interactable } from './Interactable.js';
import { InteractionSystem } from './InteractionSystem.js';
import { GameObject } from '../core/GameObject.js';

// ── Helpers ──────────────────────────────────────────────────

function makeEngine() {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.6, 0);
  camera.rotation.set(0, 0, 0);
  return {
    camera,
    input: { keys: {}, pressed: {}, mouse: { dx: 0, dy: 0, wheel: 0 }, locked: true },
    keyBinds: { interact: 'KeyE', forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'KeyC', rotateHeld: 'KeyR', holdFurther: 'ArrowUp', holdCloser: 'ArrowDown' },
    playerController: { lookLocked: false, inputLocked: false },
    isAction(action) { const code = this.keyBinds[action]; return code ? !!this.input.keys[code] : false; },
  };
}

function makePlayer(engine) {
  const player = new GameObject('Player');
  const scene = { userData: { engine }, add: vi.fn() };
  player.scene = scene;
  player.world = {};
  return player;
}

function makePickupableGO(name = 'PickupGO', rotation = new THREE.Quaternion()) {
  const go = new GameObject(name);
  const pickupable = new Pickupable();
  go.addComponent(pickupable);
  // Fake rigid body for physics manipulation
  go.rigidBody = {
    translation: () => ({ x: 0, y: 1, z: -2 }),
    rotation: () => ({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }),
    enableCcd: vi.fn(),
    setTranslation: vi.fn(),
    linvel: () => ({ x: 0, y: 0, z: 0 }),
    setGravityScale: vi.fn(),
    setLinearDamping: vi.fn(),
    setAngularDamping: vi.fn(),
    setLinvel: vi.fn(),
    setAngvel: vi.fn(),
    resetForces: vi.fn(),
    addForce: vi.fn(),
    applyImpulse: vi.fn(),
    mass: () => 1.0,
    handle: 42,
  };
  return { go, pickupable };
}

function makeInteractionSystem() {
  const is = new InteractionSystem();
  is.prompt = { show: vi.fn(), hide: vi.fn() };
  is.currentTarget = null;
  return is;
}

// ── Tests ────────────────────────────────────────────────────

describe('PickupSystem', () => {
  let engine, player, system, interactionSys;

  beforeEach(() => {
    engine = makeEngine();
    player = makePlayer(engine);
    system = new PickupSystem();
    player.addComponent(system);
    interactionSys = makeInteractionSystem();
    system.interactionSystem = interactionSys;
  });

  // ── Initial state ──

  it('starts not holding anything', () => {
    expect(system.heldPickupable).toBeNull();
  });

  // ── Pick up ──

  it('pickUp marks the pickupable as held and configures physics', () => {
    const { go, pickupable } = makePickupableGO();
    const result = system.pickUp(pickupable);
    expect(result).toBe(true);
    expect(pickupable.held).toBe(true);
    expect(system.heldPickupable).toBe(pickupable);
    expect(go.rigidBody.setGravityScale).toHaveBeenCalledWith(0, true);
    expect(go.rigidBody.setLinearDamping).toHaveBeenCalledWith(5.0, true);
    expect(go.rigidBody.setAngularDamping).toHaveBeenCalledWith(5.0, true);
    expect(go.rigidBody.setLinvel).toHaveBeenCalledWith({ x: 0, y: 0, z: 0 }, true);
  });

  it('a held object is drawn at the latest physics step, as the camera is, until it is dropped', () => {
    const { go, pickupable } = makePickupableGO();
    expect(go.interpolate).toBe(true);
    system.pickUp(pickupable);
    expect(go.interpolate).toBe(false);
    system.dropHeld();
    expect(go.interpolate).toBe(true);
  });

  it('pickUp returns false if already holding something', () => {
    const { pickupable: p1 } = makePickupableGO('A');
    const { pickupable: p2 } = makePickupableGO('B');
    system.pickUp(p1);
    expect(system.pickUp(p2)).toBe(false);
    expect(system.heldPickupable).toBe(p1);
  });

  it('pickUp returns false for null', () => {
    expect(system.pickUp(null)).toBe(false);
  });

  it('pickUp calls onBeforePickUp hook before changing physics', () => {
    const { go, pickupable } = makePickupableGO();
    const onBeforePickUp = vi.fn();
    pickupable.onBeforePickUp = onBeforePickUp;

    system.pickUp(pickupable);

    // The hook fires before physics changes — so it runs before setGravityScale.
    expect(onBeforePickUp).toHaveBeenCalledTimes(1);
    // Verify ordering: onBeforePickUp call should come before the first
    // setGravityScale call (both are on the same tick).
    const gravityCallOrder = go.rigidBody.setGravityScale.mock.invocationCallOrder[0];
    const hookCallOrder = onBeforePickUp.mock.invocationCallOrder[0];
    expect(hookCallOrder).toBeLessThan(gravityCallOrder);
  });

  // ── Hold distance: where the item already is ──

  describe('picked up at the distance it is', () => {
    // Camera at (0, 1.6, 0) facing -Z.
    const at = (go, pos) => { go.rigidBody.translation = () => ({ ...pos }); };

    it('holds it as far away as it was, not at a set arm length', () => {
      const { go, pickupable } = makePickupableGO('Drive');
      at(go, { x: 0, y: 1.6, z: -0.9 });
      system.pickUp(pickupable);
      expect(pickupable.holdDistance).toBeCloseTo(0.9);
    });

    it('so the first step does not pull it anywhere (no yank into the desk under it)', () => {
      const { go, pickupable } = makePickupableGO('Drive');
      at(go, { x: 0, y: 1.6, z: -0.7 });
      system.pickUp(pickupable);
      system.onFixedUpdate(1 / 60);
      const f = go.rigidBody.addForce.mock.calls.at(-1)[0];
      expect(Math.hypot(f.x, f.y, f.z)).toBeLessThan(1e-6);
    });

    it('measures along the view: an item off the crosshair keeps its depth', () => {
      const { go, pickupable } = makePickupableGO('Drive');
      at(go, { x: 0.3, y: 1.3, z: -0.9 });
      system.pickUp(pickupable);
      expect(pickupable.holdDistance).toBeCloseTo(0.9);
    });

    it('forgets the distance it was last carried at', () => {
      const { go, pickupable } = makePickupableGO('Drive');
      at(go, { x: 0, y: 1.6, z: -0.95 });
      system.pickUp(pickupable);
      engine.input.mouse.wheel = 3;              // reeled in to 0.65
      system.onUpdate(1 / 60);
      engine.input.mouse.wheel = 0;
      system.dropHeld();

      at(go, { x: 0, y: 1.6, z: -0.8 });
      system.pickUp(pickupable);
      expect(pickupable.holdDistance).toBeCloseTo(0.8);
    });

    it('a second item is held at its own distance, not the last one\'s', () => {
      const a = makePickupableGO('A');
      at(a.go, { x: 0, y: 1.6, z: -0.9 });
      system.pickUp(a.pickupable);
      system.dropHeld();

      const b = makePickupableGO('B');
      at(b.go, { x: 0, y: 1.6, z: -0.6 });
      system.pickUp(b.pickupable);
      expect(b.pickupable.holdDistance).toBeCloseTo(0.6);
    });

    it('stays within reach: too near is held at the minimum, too far at the maximum', () => {
      const near = makePickupableGO('Near');
      at(near.go, { x: 0, y: 1.6, z: -0.2 });
      system.pickUp(near.pickupable);
      expect(near.pickupable.holdDistance).toBe(near.pickupable.minHoldDistance);
      system.dropHeld();

      const far = makePickupableGO('Far');
      at(far.go, { x: 0, y: 1.6, z: -2.8 });
      system.pickUp(far.pickupable);
      expect(far.pickupable.holdDistance).toBe(far.pickupable.maxHoldDistance);
    });
  });

  describe('without a scroll wheel it eases to 1 m while carried', () => {
    // Camera at (0, 1.6, 0) facing -Z.
    const steps = (n) => { for (let i = 0; i < n; i++) system.onFixedUpdate(1 / 60); };
    /** Picked up at `depth`; the body keeps up with the hand, as it does
     *  with nothing in the way. */
    function carried(depth) {
      const { go, pickupable } = makePickupableGO('Drive');
      go.rigidBody.translation = () => ({ x: 0, y: 1.6, z: -depth });
      system.pickUp(pickupable);
      go.rigidBody.translation = () => ({ x: 0, y: 1.6, z: -pickupable.holdDistance });
      return { go, pickupable };
    }

    it('picked up at 1.4 m it comes in to 1 m, and stops there', () => {
      const { pickupable } = carried(1.4);
      steps(10);
      expect(pickupable.holdDistance).toBeLessThan(1.4);
      expect(pickupable.holdDistance).toBeGreaterThan(1);
      steps(120);
      expect(pickupable.holdDistance).toBeCloseTo(1);
    });

    it('picked up at 0.6 m it goes out to 1 m', () => {
      const { pickupable } = carried(0.6);
      steps(120);
      expect(pickupable.holdDistance).toBeCloseTo(1);
    });

    it('not into something in the way: a blocked item holds the hand back', () => {
      const { go, pickupable } = makePickupableGO('Drive');
      go.rigidBody.translation = () => ({ x: 0, y: 1.6, z: -0.6 });   // against a wall
      system.pickUp(pickupable);
      steps(120);
      expect(pickupable.holdDistance).toBeLessThan(0.9);
    });

    it('with a scroll wheel it stays where it was picked up — the wheel moves it', () => {
      engine.input.hasWheel = true;              // the Engine saw a wheel event
      const { pickupable } = carried(1.4);
      steps(120);
      expect(pickupable.holdDistance).toBeCloseTo(1.4);
    });

    it('the first scroll stops the easing, and it stays where it was scrolled to', () => {
      const { pickupable } = carried(1.2);
      steps(6);                                  // eased in a little
      engine.input.hasWheel = true;
      engine.input.mouse.wheel = -2;
      system.onUpdate(1 / 60);
      engine.input.mouse.wheel = 0;
      const scrolled = pickupable.holdDistance;
      steps(120);
      expect(pickupable.holdDistance).toBeCloseTo(scrolled);
    });
  });

  // ── Drop ──

  it('dropHeld releases the object and restores physics', () => {
    const { go, pickupable } = makePickupableGO();
    system.pickUp(pickupable);
    const dropped = system.dropHeld();
    expect(dropped).toBe(pickupable);
    expect(pickupable.held).toBe(false);
    expect(system.heldPickupable).toBeNull();
    expect(go.rigidBody.setGravityScale).toHaveBeenCalledWith(1, true);
    expect(go.rigidBody.setLinearDamping).toHaveBeenCalledWith(0.5, true);
    expect(go.rigidBody.setAngularDamping).toHaveBeenCalledWith(1.0, true);
    expect(go.rigidBody.resetForces).toHaveBeenCalled();
  });

  it('dropHeld returns null when nothing is held', () => {
    expect(system.dropHeld()).toBeNull();
  });

  // ── Input: pick up on E ──

  it('picks up a Pickupable when E is pressed while looking at it', () => {
    const { pickupable } = makePickupableGO();
    // InteractionSystem casts the ray and reports what it saw under the crosshair.
    interactionSys.currentPickupable = pickupable;

    // Press E
    engine.input.keys['KeyE'] = true;
    system.onUpdate(1 / 60);
    expect(system.heldPickupable).toBe(pickupable);
    expect(pickupable.held).toBe(true);

    // Release E
    engine.input.keys['KeyE'] = false;
    system._interactHeld = false;
  });

  it('drops when E is pressed while holding and no Interactable targeted', () => {
    const { pickupable } = makePickupableGO();
    system.pickUp(pickupable);

    // No InteractionSystem target
    interactionSys.currentTarget = null;

    engine.input.keys['KeyE'] = true;
    system.onUpdate(1 / 60);
    expect(system.heldPickupable).toBeNull();
    expect(pickupable.held).toBe(false);
  });

  it('drops when E is pressed while holding, even if an Interactable is targeted', () => {
    const { pickupable } = makePickupableGO();
    system.pickUp(pickupable);

    // Target a non-pickup Interactable (like the drive reader tooltip)
    const readerGO = new GameObject('Reader');
    const readerInteractable = new Interactable();
    readerInteractable.onInteract = vi.fn();
    readerGO.addComponent(readerInteractable);
    interactionSys.currentTarget = readerInteractable;

    engine.input.keys['KeyE'] = true;
    system.onUpdate(1 / 60);
    // Held objects take priority — always drop
    expect(system.heldPickupable).toBeNull();
  });

  // ── Terminal gating ──

  it('skips pickup when terminal is not idle', () => {
    system.terminal = { state: 'radar' };
    const { pickupable } = makePickupableGO();
    interactionSys.currentPickupable = pickupable;

    engine.input.keys['KeyE'] = true;
    system.onUpdate(1 / 60);
    expect(system.heldPickupable).toBeNull();
  });

  it('skips drop when terminal is not idle', () => {
    const { pickupable } = makePickupableGO();
    system.pickUp(pickupable);
    system.terminal = { state: 'review' };

    engine.input.keys['KeyE'] = true;
    system.onUpdate(1 / 60);
    expect(system.heldPickupable).toBe(pickupable);
  });

  // ── Scroll to adjust hold distance ──

  it('scroll down decreases hold distance (brings closer)', () => {
    const { pickupable } = makePickupableGO();
    system.pickUp(pickupable);
    const initial = pickupable.holdDistance;

    engine.input.mouse.wheel = 3;  // scroll down 3 ticks
    system.onUpdate(1 / 60);
    expect(pickupable.holdDistance).toBe(initial - 0.3);
  });

  it('scroll up increases hold distance (pushes further)', () => {
    const { go, pickupable } = makePickupableGO();
    go.rigidBody.translation = () => ({ x: 0, y: 1.6, z: -0.7 });   // room to push out
    system.pickUp(pickupable);
    const initial = pickupable.holdDistance;

    engine.input.mouse.wheel = -2;  // scroll up 2 ticks
    system.onUpdate(1 / 60);
    expect(pickupable.holdDistance).toBe(initial + 0.2);
  });

  it('hold distance is clamped to min/max', () => {
    const { pickupable } = makePickupableGO();
    system.pickUp(pickupable);

    // Scroll way down (brings closer → hits min)
    engine.input.mouse.wheel = 100;
    system.onUpdate(1 / 60);
    expect(pickupable.holdDistance).toBe(pickupable.minHoldDistance);

    // Scroll way up (pushes further → hits max)
    engine.input.mouse.wheel = -100;
    system.onUpdate(1 / 60);
    expect(pickupable.holdDistance).toBe(pickupable.maxHoldDistance);
  });

  it('scroll does nothing when not holding', () => {
    engine.input.mouse.wheel = 5;
    system.onUpdate(1 / 60);
    expect(system.heldPickupable).toBeNull();
  });

  // ── Spring-damper hold forces ──

  it('applies spring-damper forces while holding', () => {
    const { go, pickupable } = makePickupableGO();
    system.pickUp(pickupable);
    pickupable.holdDistance = 1;                 // reeled in from where it was picked up

    system.onFixedUpdate(1 / 60);
    // Rapier 0.20 user forces persist until reset, so each step must clear
    // last step's force first — there is no applyForce any more.
    expect(go.rigidBody.resetForces).toHaveBeenCalled();
    expect(go.rigidBody.addForce).toHaveBeenCalled();
    const force = go.rigidBody.addForce.mock.calls[0][0];
    // Force should have non-zero components (spring pulling toward target)
    expect(typeof force.x).toBe('number');
    expect(typeof force.y).toBe('number');
    expect(typeof force.z).toBe('number');
    expect(force.z).toBeGreaterThan(0);          // the hand is 1 m nearer (+z) than the body
  });

  it('does not apply forces when not holding', () => {
    system.onFixedUpdate(1 / 60);
    // No error, no calls
  });

  // ── Prompt override ──

  it('sets promptOverride while holding and shows drop prompt', () => {
    const { pickupable } = makePickupableGO();
    system.pickUp(pickupable);

    system.onLateUpdate(1 / 60);
    expect(interactionSys.promptOverride).toBe(system);
    expect(interactionSys.prompt.show).toHaveBeenCalledWith('[E] Drop \u00b7 [R] Rotate \u00b7 [\u2191/\u2193] Push/pull');
  });

  it('clears promptOverride when not holding', () => {
    system.onLateUpdate(1 / 60);
    expect(interactionSys.promptOverride).toBeNull();
  });

  it('clears promptOverride after dropping', () => {
    const { pickupable } = makePickupableGO();
    system.pickUp(pickupable);
    system.onLateUpdate(1 / 60);
    expect(interactionSys.promptOverride).toBe(system);

    system.dropHeld();
    system.onLateUpdate(1 / 60);
    expect(interactionSys.promptOverride).toBeNull();
  });

  // ── Ray exclusion ──

  it('excludes the carried body from the interaction ray while holding', () => {
    // The carried object floats on the camera axis — without this it would
    // stop the ray before whatever the player is actually looking at.
    const { go, pickupable } = makePickupableGO();
    system.pickUp(pickupable);

    system.onLateUpdate(1 / 60);
    expect(interactionSys.excludeBody).toBe(go.rigidBody);

    system.dropHeld();
    system.onLateUpdate(1 / 60);
    expect(interactionSys.excludeBody).toBeNull();
  });

  it("shows drop prompt while holding, even if an Interactable is targeted", () => {
    // Looking at the drive reader tooltip while carrying a drive: the held
    // object takes priority — '[E] Drop' wins over the tooltip label.
    const { pickupable } = makePickupableGO();
    system.pickUp(pickupable);
    interactionSys.currentTarget = new Interactable();

    system.onLateUpdate(1 / 60);
    expect(interactionSys.promptOverride).toBe(system);
    expect(interactionSys.prompt.show).toHaveBeenCalledWith('[E] Drop \u00b7 [R] Rotate \u00b7 [\u2191/\u2193] Push/pull');
  });

  // ── Rotation (#60) ──

  describe('rotation', () => {
    const yaw = (rad) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rad);
    const angleBetween = (a, b) => a.angleTo(b);

    it('keeps the angle it was picked up at, relative to the camera, as the player turns', () => {
      const { pickupable } = makePickupableGO('Box', yaw(0.5));
      system.pickUp(pickupable);
      engine.camera.quaternion.copy(yaw(Math.PI / 2));
      engine.camera.updateMatrixWorld();
      const target = system.targetRotation(new THREE.Quaternion());
      expect(angleBetween(target, yaw(Math.PI / 2 + 0.5))).toBeLessThan(1e-6);
    });

    it('turns the body toward that angle on the physics step', () => {
      const { go, pickupable } = makePickupableGO('Box');
      system.pickUp(pickupable);
      go.rigidBody.setAngvel.mockClear();
      engine.camera.quaternion.copy(yaw(0.4));
      engine.camera.updateMatrixWorld();
      system.onFixedUpdate(1 / 60);
      const w = go.rigidBody.setAngvel.mock.calls.at(-1)[0];
      expect(w.y).toBeGreaterThan(0);
      expect(Math.abs(w.x)).toBeLessThan(1e-6);
      expect(Math.abs(w.z)).toBeLessThan(1e-6);
    });

    it('settles: no spin once the body is at the angle', () => {
      const { go, pickupable } = makePickupableGO('Box');
      system.pickUp(pickupable);
      go.rigidBody.setAngvel.mockClear();
      system.onFixedUpdate(1 / 60);
      const w = go.rigidBody.setAngvel.mock.calls.at(-1)[0];
      expect(Math.hypot(w.x, w.y, w.z)).toBeLessThan(1e-6);
    });

    it('holding R turns the object with the mouse, and freezes the view', () => {
      const { pickupable } = makePickupableGO('Box');
      system.pickUp(pickupable);
      engine.input.keys.KeyR = true;
      engine.input.mouse.dx = 100;
      system.onUpdate(1 / 60);
      expect(engine.playerController.lookLocked).toBe(true);
      const target = system.targetRotation(new THREE.Quaternion());
      // Mouse right spins it about the camera's up axis.
      const axisAngle = 2 * Math.acos(Math.min(1, Math.abs(target.w)));
      expect(axisAngle).toBeGreaterThan(0.1);
      expect(Math.abs(target.x)).toBeLessThan(1e-6);
    });

    it('without R the mouse looks around as usual and the object keeps its angle', () => {
      const { pickupable } = makePickupableGO('Box');
      system.pickUp(pickupable);
      engine.input.mouse.dx = 100;
      system.onUpdate(1 / 60);
      expect(engine.playerController.lookLocked).toBe(false);
      expect(system.targetRotation(new THREE.Quaternion()).w).toBeCloseTo(1);
    });

    /** R down for `seconds` of frames, then up for one. */
    function pressR(seconds) {
      engine.input.keys.KeyR = true;
      for (let t = 0; t < seconds; t += 1 / 60) system.onUpdate(1 / 60);
      engine.input.keys.KeyR = false;
      system.onUpdate(1 / 60);
    }
    const turned = () => 2 * Math.acos(Math.min(1, Math.abs(system.targetRotation(new THREE.Quaternion()).w)));

    it('held, then let go: the view comes back on release, or when the object is dropped', () => {
      const { pickupable } = makePickupableGO('Box');
      system.pickUp(pickupable);
      pressR(0.5);
      expect(engine.playerController.lookLocked).toBe(false);

      engine.input.keys.KeyR = true;
      system.onUpdate(1 / 60);
      system.dropHeld();
      expect(engine.playerController.lookLocked).toBe(false);
    });

    // A laptop's touchpad goes dead while a key is held (Windows' palm
    // rejection), so R held + touchpad never turned anything.
    it('a tap of R keeps turning with the mouse, hands free, until R is tapped again', () => {
      const { pickupable } = makePickupableGO('Box');
      system.pickUp(pickupable);
      pressR(1 / 60);
      expect(engine.playerController.lookLocked).toBe(true);
      engine.input.mouse.dx = 100;
      system.onUpdate(1 / 60);
      expect(turned()).toBeGreaterThan(0.1);

      engine.input.mouse.dx = 0;
      pressR(1 / 60);
      expect(engine.playerController.lookLocked).toBe(false);
      const before = turned();
      engine.input.mouse.dx = 100;
      system.onUpdate(1 / 60);
      expect(turned()).toBeCloseTo(before);
    });

    it('a tap stops the turning while R is still going down, not only when it comes up', () => {
      const { pickupable } = makePickupableGO('Box');
      system.pickUp(pickupable);
      pressR(1 / 60);
      engine.input.keys.KeyR = true;
      system.onUpdate(1 / 60);
      expect(engine.playerController.lookLocked).toBe(false);
    });

    it('dropping ends the turning: the next thing picked up is not turned', () => {
      const { pickupable } = makePickupableGO('Box');
      system.pickUp(pickupable);
      pressR(1 / 60);
      system.dropHeld();
      expect(engine.playerController.lookLocked).toBe(false);

      const other = makePickupableGO('Drive').pickupable;
      system.pickUp(other);
      system.onUpdate(1 / 60);
      expect(engine.playerController.lookLocked).toBe(false);
    });

    it('a tap with empty hands leaves nothing waiting for the next pick-up', () => {
      pressR(1 / 60);
      system.pickUp(makePickupableGO('Box').pickupable);
      system.onUpdate(1 / 60);
      expect(engine.playerController.lookLocked).toBe(false);
    });

    it('while it turns on a tap, the prompt says how to stop', () => {
      const { pickupable } = makePickupableGO('Box');
      system.pickUp(pickupable);
      pressR(1 / 60);
      system.onLateUpdate(1 / 60);
      expect(interactionSys.prompt.show).toHaveBeenLastCalledWith('[E] Drop \u00b7 [R] Stop rotating');
    });

    it('R does nothing with empty hands', () => {
      engine.input.keys.KeyR = true;
      system.onUpdate(1 / 60);
      expect(engine.playerController.lookLocked).toBe(false);
    });

    it('the prompt names the keys as bound', () => {
      engine.keyBinds.rotateHeld = 'KeyT';
      engine.keyBinds.holdFurther = 'KeyU';
      engine.keyBinds.holdCloser = 'KeyJ';
      const { pickupable } = makePickupableGO('Box');
      system.pickUp(pickupable);
      system.onLateUpdate(1 / 60);
      expect(interactionSys.prompt.show).toHaveBeenCalledWith('[E] Drop \u00b7 [T] Rotate \u00b7 [U/J] Push/pull');
    });
  });

  // \u2500\u2500 Push and pull on keys: a laptop has no wheel \u2500\u2500

  describe('\u2191 / \u2193 push it away and pull it in', () => {
    const steps = (n) => { for (let i = 0; i < n; i++) system.onFixedUpdate(1 / 60); };
    /** Picked up 1 m off, the body keeping up with the hand. */
    function carried() {
      const { go, pickupable } = makePickupableGO('Drive');
      go.rigidBody.translation = () => ({ x: 0, y: 1.6, z: -1 });
      system.pickUp(pickupable);
      go.rigidBody.translation = () => ({ x: 0, y: 1.6, z: -pickupable.holdDistance });
      return pickupable;
    }
    /** `code` held for `seconds`, then let go. */
    function hold(code, seconds) {
      engine.input.keys[code] = true;
      for (let t = 0; t < seconds; t += 1 / 60) system.onUpdate(1 / 60);
      engine.input.keys[code] = false;
    }

    it('\u2191 pushes it further the longer it is held, \u2193 brings it closer', () => {
      const p = carried();
      hold('ArrowUp', 0.2);
      const pushed = p.holdDistance;
      expect(pushed).toBeGreaterThan(1.1);
      hold('ArrowDown', 0.1);
      expect(p.holdDistance).toBeLessThan(pushed);
      expect(p.holdDistance).toBeGreaterThan(1);
    });

    it('never out of reach, either way', () => {
      const p = carried();
      hold('ArrowUp', 3);
      expect(p.holdDistance).toBe(p.maxHoldDistance);
      hold('ArrowDown', 3);
      expect(p.holdDistance).toBe(p.minHoldDistance);
    });

    it('the keys stop the easing to 1 m, as a wheel does', () => {
      const p = carried();
      hold('ArrowUp', 0.3);
      const pushed = p.holdDistance;
      steps(120);
      expect(p.holdDistance).toBeCloseTo(pushed);
    });

    it('follow their binds', () => {
      engine.keyBinds.holdFurther = 'KeyU';
      const p = carried();
      hold('ArrowUp', 0.3);
      expect(p.holdDistance).toBeCloseTo(1);
      hold('KeyU', 0.3);
      expect(p.holdDistance).toBeGreaterThan(1.1);
    });

    it('not while the player is held still: the security monitor steps cameras with \u2191 / \u2193', () => {
      const p = carried();
      engine.playerController.inputLocked = true;
      hold('ArrowUp', 0.3);
      expect(p.holdDistance).toBeCloseTo(1);
    });

    it('do nothing with empty hands', () => {
      expect(() => hold('ArrowUp', 0.3)).not.toThrow();
      expect(system.heldPickupable).toBeNull();
    });
  });

  // ── #76: no tunnelling while carried ──

  describe('continuous collision while carried (#76)', () => {
    it('turns CCD on when picked up, and off when dropped', () => {
      const { go, pickupable } = makePickupableGO('Drive');
      system.pickUp(pickupable);
      expect(go.rigidBody.enableCcd).toHaveBeenLastCalledWith(true);
      system.dropHeld();
      expect(go.rigidBody.enableCcd).toHaveBeenLastCalledWith(false);
    });
  });

  // ── #77: snap back to the hand when stuck ──

  describe('snap back when stuck (#77)', () => {
    const STEP = 1 / 60;
    /** A held item whose body sits at `pos` (move it with `at.pos = …`). */
    function heldAt(pos) {
      const { go, pickupable } = makePickupableGO('Drive');
      const at = { pos };
      go.rigidBody.translation = () => ({ ...at.pos });
      const collider = { setEnabled: vi.fn() };
      go.colliders = [collider];
      system.pickUp(pickupable);
      pickupable.holdDistance = 1;   // reeled in, or knocked away from the hand
      return { go, collider, at };
    }
    const steps = (n) => { for (let i = 0; i < n; i++) system.onFixedUpdate(STEP); };
    // Camera at (0, 1.6, 0) facing -Z, hold distance 1: the hand is (0, 1.6, -1).
    const STUCK = { x: 0, y: 1.6, z: -3 };     // 2 m from the hand
    const HAND = { x: 0, y: 1.6, z: -1 };

    it('more than 1.5 m from the hand for half a second: teleports there, stops, drops collision', () => {
      const { go, collider } = heldAt(STUCK);
      steps(31);
      const [p] = go.rigidBody.setTranslation.mock.calls.at(-1);
      expect(p.x).toBeCloseTo(0);
      expect(p.y).toBeCloseTo(1.6);
      expect(p.z).toBeCloseTo(-1);
      expect(go.rigidBody.setLinvel).toHaveBeenLastCalledWith({ x: 0, y: 0, z: 0 }, true);
      expect(collider.setEnabled).toHaveBeenLastCalledWith(false);
    });

    it('an item still flying in from across the room is not snapped', () => {
      const { go } = heldAt(STUCK);
      steps(10);
      expect(go.rigidBody.setTranslation).not.toHaveBeenCalled();
    });

    it('collision comes back after a second', () => {
      const { collider, at } = heldAt(STUCK);
      steps(31);
      at.pos = HAND;
      steps(55);
      expect(collider.setEnabled).toHaveBeenLastCalledWith(false);
      steps(10);
      expect(collider.setEnabled).toHaveBeenLastCalledWith(true);
    });

    it('within 1.5 m it is left to the spring (1.2 m here)', () => {
      const { go, collider } = heldAt({ x: 0, y: 1.6, z: -2.2 });
      steps(60);
      expect(go.rigidBody.setTranslation).not.toHaveBeenCalled();
      expect(collider.setEnabled).not.toHaveBeenCalled();
    });

    it('dropping it mid-snap gives collision back at once (or it falls through the floor)', () => {
      const { collider } = heldAt(STUCK);
      steps(31);
      system.dropHeld();
      expect(collider.setEnabled).toHaveBeenLastCalledWith(true);
    });
  });
});
