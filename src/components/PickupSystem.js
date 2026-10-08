import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { InteractionSystem } from './InteractionSystem.js';
import { Pickupable } from './Pickupable.js';
import { keyName } from '../app/keyNames.js';

// ─────────────────────────────────────────────
// PickupSystem  –  Component (attach to Player)
// ─────────────────────────────────────────────
// Generic carry mechanic: detects Pickupable objects via InteractionSystem's
// raycast, picks them up on E, holds them in front of the camera with
// spring-damper forces, and drops them on E again.
//
// Rotation (#60): a held object keeps the angle it was picked up at
// relative to the camera — turn round and it turns with you, instead of
// spinning freely in world space. Holding R (keyBinds.rotateHeld) turns the
// object with the mouse instead of the view (the controller's lookLocked).
// The angle is held by setting the body's angular velocity toward the
// target each physics step, so it still knocks against things.
//
// The held object is a real physics body — it can bump into things, be pushed
// by the player walking, and falls when dropped. Mouse wheel scrolling
// adjusts the hold distance while carrying.
//
// Prompt coordination with InteractionSystem:
//   - While carrying, the carried body is excluded from InteractionSystem's
//     ray (interactionSystem.excludeBody), so it cannot block whatever the
//     player looks at — the drive reader behind it stays targetable.
//   - While carrying with no Interactable in view, PickupSystem claims the
//     prompt (interactionSystem.promptOverride) and shows '[E] Drop'.
//   - With an Interactable in view (the drive reader), the override stays
//     clear so the Interactable's own prompt ('[E] Insert drive') wins.
//   - With hands free, the override stays clear and InteractionSystem shows
//     the Pickupable's own promptLabel ('[E] Pick up').
//
// External references (set by the scene during wiring):
//   interactionSystem  – the player's InteractionSystem (for target detection
//                        and prompt override)
//   terminal           – the ComputerTerminal (for gating input while open)
// ─────────────────────────────────────────────

/** Spring stiffness for the hold force. */
const SPRING_STIFFNESS = 800;

/** Damping coefficient for the hold force. */
const SPRING_DAMPING = 25;

/** Mouse wheel step size in metres per tick. */
const SCROLL_STEP = 0.1;

// Pre-allocated scratch vectors to avoid per-frame allocations.
const _target = new THREE.Vector3();
const _disp   = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camQuat = new THREE.Quaternion();
const _bodyQuat = new THREE.Quaternion();
const _err = new THREE.Quaternion();
const _turn = new THREE.Quaternion();
const _axisX = new THREE.Vector3(1, 0, 0);
const _axisY = new THREE.Vector3(0, 1, 0);

/** Radians the held object turns per pixel of mouse while R is held. */
const ROTATE_SENSITIVITY = 0.008;

/** How fast the body closes on its target angle: angular velocity is the
 *  remaining angle × this, per second (a ~1/12 s time constant). */
const ROTATE_GAIN = 12;

/** Cap on that angular velocity (rad/s), so a big error can't whip. */
const MAX_SPIN = 20;

export class PickupSystem extends Component {
  // ── External references (set by scene wiring) ──
  /** @type {InteractionSystem|null} */
  interactionSystem = null;

  /** @type {object|null}  Anything with a `state` field ('idle' when closed). */
  terminal = null;

  // ── State ──
  /** @type {Pickupable|null} The Pickupable component currently being
   *  carried (or null). */
  heldPickupable = null;

  /** The held object's rotation in camera space: its world rotation is
   *  camera × this, so it turns with the player. */
  holdRotation = new THREE.Quaternion();

  // ──────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────

  /** Drop whatever is being held. Called by the drive reader to accept a
   *  drive, or by the player pressing E while holding with no target. */
  dropHeld() {
    if (!this.heldPickupable) return null;
    const pickupable = this.heldPickupable;
    this.heldPickupable = null;
    pickupable.held = false;
    this._setLookLocked(false);

    // Restore normal physics so the object falls / sits.
    const go = pickupable.gameObject;
    if (go?.rigidBody) {
      go.rigidBody.setGravityScale(1, true);
      go.rigidBody.setLinearDamping(0.5, true);
      go.rigidBody.setAngularDamping(1.0, true);
      // Kill the spring's accumulated force so it doesn't keep pulling the
      // object toward the old target. Velocity is preserved — whatever
      // momentum the hold spring imparted carries through naturally.
      go.rigidBody.resetForces(true);
    }
    return pickupable;
  }

  /** Pick up a specific Pickupable. Called when the player presses E while
   *  looking at a Pickupable. */
  pickUp(pickupable) {
    if (this.heldPickupable || !pickupable) return false;

    // Hook: let the DriveSlot (or any other owner) prepare the body before
    // we change physics. This is how an inserted drive gets converted from
    // kinematic back to dynamic before we set gravity/damping.
    pickupable.onBeforePickUp?.();

    pickupable.held = true;
    this.heldPickupable = pickupable;

    // Make the body dynamic with no gravity and high damping so it floats.
    const go = pickupable.gameObject;
    if (go?.rigidBody) {
      go.rigidBody.setGravityScale(0, true);
      go.rigidBody.setLinearDamping(5.0, true);
      go.rigidBody.setAngularDamping(5.0, true);
      go.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      go.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    // Hold it at the angle it was picked up at, relative to the camera.
    const engine = this._getEngine();
    const r = go?.rigidBody?.rotation?.();
    _bodyQuat.set(r?.x ?? 0, r?.y ?? 0, r?.z ?? 0, r?.w ?? 1);
    if (engine?.camera) engine.camera.getWorldQuaternion(_camQuat);
    else _camQuat.identity();
    this.holdRotation.copy(_camQuat).invert().multiply(_bodyQuat);
    return true;
  }

  // ──────────────────────────────────────────────────────────
  // Per-frame update
  // ──────────────────────────────────────────────────────────

  onUpdate(dt) {
    const engine = this._getEngine();
    if (!engine) return;

    // ── Scroll to adjust hold distance ──
    if (this.heldPickupable && engine.input.mouse.wheel !== 0) {
      const p = this.heldPickupable;
      // Scroll up (negative wheel) = push further.
      // Scroll down (positive wheel) = bring closer.
      p.holdDistance -= engine.input.mouse.wheel * SCROLL_STEP;
      p.holdDistance = Math.max(p.minHoldDistance, Math.min(p.maxHoldDistance, p.holdDistance));
    }

    // ── R + mouse turns the held object, not the view ──
    const rotating = !!this.heldPickupable && engine.isAction('rotateHeld');
    this._setLookLocked(rotating);
    if (rotating) {
      const { dx = 0, dy = 0 } = engine.input.mouse;
      // Camera-space turns, applied before the current angle: mouse right
      // spins it about the view's up axis, mouse up/down about its right.
      _turn.setFromAxisAngle(_axisY, dx * ROTATE_SENSITIVITY);
      this.holdRotation.premultiply(_turn);
      _turn.setFromAxisAngle(_axisX, dy * ROTATE_SENSITIVITY);
      this.holdRotation.premultiply(_turn);
      this.holdRotation.normalize();
    }

    // ── Terminal gating: no pickup/drop while the terminal is open ──
    if (this.terminal && this.terminal.state !== 'idle') return;

    // ── Interaction edge detection ──
    const wantInteract = engine.isAction('interact');
    if (wantInteract && !this._interactHeld) {
      if (this.heldPickupable) {
        // Holding something: always drop (held objects take priority over
        // tooltip Interactables like the drive reader label).
        this.dropHeld();
      } else {
        // Not holding: pick up if looking at a Pickupable.
        const pickupTarget = this._getPickupTarget();
        if (pickupTarget) {
          this.pickUp(pickupTarget);
        }
      }
    }
    this._interactHeld = wantInteract;
  }

  // ──────────────────────────────────────────────────────────
  // Fixed update — spring-damper hold forces
  // ──────────────────────────────────────────────────────────

  onFixedUpdate(_dt) {
    if (!this.heldPickupable) return;
    const engine = this._getEngine();
    if (!engine) return;

    const go = this.heldPickupable.gameObject;
    if (!go?.rigidBody) return;

    // Target = camera position + camera forward * holdDistance
    engine.camera.getWorldPosition(_camPos);
    _camFwd.set(0, 0, -1).applyQuaternion(engine.camera.quaternion);
    _target.copy(_camPos).addScaledVector(_camFwd, this.heldPickupable.holdDistance);

    // Current body position
    const t = go.rigidBody.translation();

    // Displacement from current to target
    _disp.set(_target.x - t.x, _target.y - t.y, _target.z - t.z);

    // Spring + damping, tuned in acceleration space: F = m · (k·disp − c·v).
    // Scaling by mass lets any carried object settle identically — a fixed
    // force diverges for the light (~0.15 kg) drives, because explicit
    // integration is only stable while c · dt / mass stays below 2.
    // Gravity is off while held (see pickUp), so nothing sags and there is
    // nothing to compensate for.
    const mass = go.rigidBody.mass();
    const v = go.rigidBody.linvel();
    const ax = _disp.x * SPRING_STIFFNESS - v.x * SPRING_DAMPING;
    const ay = _disp.y * SPRING_STIFFNESS - v.y * SPRING_DAMPING;
    const az = _disp.z * SPRING_STIFFNESS - v.z * SPRING_DAMPING;

    // Rapier 0.20: user forces persist until cleared, so drop last step's
    // force before adding this step's (the old applyForce is gone).
    go.rigidBody.resetForces(false);
    go.rigidBody.addForce(
      { x: ax * mass, y: ay * mass, z: az * mass },
      true,
    );

    this._holdAngle(go.rigidBody);
  }

  // ──────────────────────────────────────────────────────────
  // Late update — prompt override management
  // ──────────────────────────────────────────────────────────

  onLateUpdate(_dt) {
    if (!this.interactionSystem) return;

    const held = this.heldPickupable;

    // The carried body floats on the camera axis — keep it out of the
    // interaction ray so the reader (or anything else) behind it is still
    // targetable.
    this.interactionSystem.excludeBody = held ? (held.gameObject?.rigidBody ?? null) : null;

    // While carrying, the prompt is always ours ('[E] Drop') — held objects
    // take priority over tooltip Interactables like the drive reader label.
    if (held) {
      this.interactionSystem.promptOverride = this;
      const rotateKey = keyName(this._getEngine()?.keyBinds?.rotateHeld ?? 'KeyR');
      this.interactionSystem.prompt?.show(`[E] Drop \u00b7 hold [${rotateKey}] Rotate`);
    } else {
      this.interactionSystem.promptOverride = null;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  /** Return the Pickupable the player is looking at, or null. Read from
   *  InteractionSystem's raycast — the same ray the prompt runs on. */
  _getPickupTarget() {
    return this.interactionSystem?.currentPickupable ?? null;
  }

  /** The world rotation the held object is steered to: camera × holdRotation.
   *  @param {THREE.Quaternion} out
   *  @returns {THREE.Quaternion} out */
  targetRotation(out) {
    const camera = this._getEngine()?.camera;
    if (camera) camera.getWorldQuaternion(out);
    else out.identity();
    return out.multiply(this.holdRotation);
  }

  /** Steer the body's angular velocity toward targetRotation: proportional
   *  to the remaining angle, along the shortest way round. */
  _holdAngle(body) {
    if (!body.rotation || !body.setAngvel) return;
    const r = body.rotation();
    _bodyQuat.set(r.x, r.y, r.z, r.w);
    this.targetRotation(_err).multiply(_bodyQuat.invert());
    if (_err.w < 0) _err.set(-_err.x, -_err.y, -_err.z, -_err.w);   // shortest way
    const w = Math.min(1, _err.w);
    const angle = 2 * Math.acos(w);
    const s = Math.sqrt(1 - w * w);
    if (s < 1e-6) {
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }
    const speed = Math.min(angle * ROTATE_GAIN, MAX_SPIN) / s;
    body.setAngvel({ x: _err.x * speed, y: _err.y * speed, z: _err.z * speed }, true);
  }

  /** Freeze or free the player's view while the held object is turned. */
  _setLookLocked(locked) {
    const ctrl = this._getEngine()?.playerController;
    if (ctrl) ctrl.lookLocked = locked;
  }

  /** Reach the Engine from the component's GameObject. */
  _getEngine() {
    return this.gameObject?.scene?.userData?.engine ?? null;
  }
}
