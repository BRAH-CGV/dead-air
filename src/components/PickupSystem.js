import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { InteractionSystem } from './InteractionSystem.js';
import { Pickupable } from './Pickupable.js';

// ─────────────────────────────────────────────
// PickupSystem  –  Component (attach to Player)
// ─────────────────────────────────────────────
// Generic carry mechanic: detects Pickupable objects via InteractionSystem's
// raycast, picks them up on E, holds them in front of the camera with
// spring-damper forces, and drops them on E again.
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

/** Small forward impulse applied when dropping (metres/second). */
const DROP_IMPULSE = 1.5;

// Pre-allocated scratch vectors to avoid per-frame allocations.
const _target = new THREE.Vector3();
const _disp   = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _camPos = new THREE.Vector3();

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

    // Restore normal physics so the object falls / sits.
    const go = pickupable.gameObject;
    if (go?.rigidBody) {
      go.rigidBody.setGravityScale(1, true);
      go.rigidBody.setLinearDamping(0.5, true);
      go.rigidBody.setAngularDamping(1.0, true);
      // Kill the spring's leftover velocity first, then add a small forward
      // impulse for a "place" feel.
      go.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      const engine = this._getEngine();
      if (engine) {
        _camFwd.set(0, 0, -1).applyQuaternion(engine.camera.quaternion);
        const mass = go.rigidBody.mass();
        go.rigidBody.applyImpulse(
          { x: _camFwd.x * DROP_IMPULSE * mass,
            y: 0,
            z: _camFwd.z * DROP_IMPULSE * mass },
          true,
        );
      }
    }
    return pickupable;
  }

  /** Pick up a specific Pickupable. Called when the player presses E while
   *  looking at a Pickupable. */
  pickUp(pickupable) {
    if (this.heldPickupable || !pickupable) return false;
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
      // Scroll down (positive wheel) = push further.
      // Scroll up (negative wheel) = bring closer.
      p.holdDistance += engine.input.mouse.wheel * SCROLL_STEP;
      p.holdDistance = Math.max(p.minHoldDistance, Math.min(p.maxHoldDistance, p.holdDistance));
    }

    // ── Terminal gating: no pickup/drop while the terminal is open ──
    if (this.terminal && this.terminal.state !== 'idle') return;

    // ── Interaction edge detection ──
    const wantInteract = engine.isAction('interact');
    if (wantInteract && !this._interactHeld) {
      if (this.heldPickupable) {
        // Holding something: drop unless an Interactable is targeted
        // (the Interactable's onInteract fires first — e.g. the drive reader).
        if (!this.interactionSystem?.currentTarget) {
          this.dropHeld();
        }
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

    // While carrying, the prompt is ours ('[E] Drop') — unless an
    // Interactable is in view (the drive reader), whose own prompt wins and
    // is shown by InteractionSystem.
    if (held && !this.interactionSystem.currentTarget) {
      this.interactionSystem.promptOverride = this;
      this.interactionSystem.prompt?.show('[E] Drop');
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

  /** Reach the Engine from the component's GameObject. */
  _getEngine() {
    return this.gameObject?.scene?.userData?.engine ?? null;
  }
}
