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
    keyBinds: { interact: 'KeyE', forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', crouch: 'KeyC', rotateHeld: 'KeyR' },
    playerController: { lookLocked: false },
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
    const { pickupable } = makePickupableGO();
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
    expect(force.z).toBeGreaterThan(0);          // target is 1 m further -z than the body
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
    expect(interactionSys.prompt.show).toHaveBeenCalledWith('[E] Drop \u00b7 hold [R] Rotate');
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
    expect(interactionSys.prompt.show).toHaveBeenCalledWith('[E] Drop \u00b7 hold [R] Rotate');
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

    it('lets go of the view when R is released, or the object is dropped', () => {
      const { pickupable } = makePickupableGO('Box');
      system.pickUp(pickupable);
      engine.input.keys.KeyR = true;
      system.onUpdate(1 / 60);
      engine.input.keys.KeyR = false;
      system.onUpdate(1 / 60);
      expect(engine.playerController.lookLocked).toBe(false);

      engine.input.keys.KeyR = true;
      system.onUpdate(1 / 60);
      system.dropHeld();
      expect(engine.playerController.lookLocked).toBe(false);
    });

    it('R does nothing with empty hands', () => {
      engine.input.keys.KeyR = true;
      system.onUpdate(1 / 60);
      expect(engine.playerController.lookLocked).toBe(false);
    });

    it('the prompt names the rotate key as bound', () => {
      engine.keyBinds.rotateHeld = 'KeyT';
      const { pickupable } = makePickupableGO('Box');
      system.pickUp(pickupable);
      system.onLateUpdate(1 / 60);
      expect(interactionSys.prompt.show).toHaveBeenCalledWith('[E] Drop \u00b7 hold [T] Rotate');
    });
  });
});
