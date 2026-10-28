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
// A tap of R (let go within ROTATE_TAP) keeps it turning, hands free, until
// R is pressed again or the object is dropped: a laptop's touchpad goes dead
// while a key is held (Windows' palm rejection), so R held + touchpad never
// turned anything. The angle is held by setting the body's angular velocity
// toward the target each physics step, so it still knocks against things.
//
// The held object is a real physics body — it can bump into things, be pushed
// by the player walking, and falls when dropped. It is held as far along the
// view as it was when picked up (within the Pickupable's reach). The mouse
// wheel moves it in and out from there, and so do ↑ / ↓ held (keyBinds
// holdFurther / holdCloser), for a laptop with no wheel. Until one of them
// is used (engine.input.hasWheel, from the first scroll on, or _steered) it
// eases to the Pickupable's restHoldDistance (1 m) while nothing is in the
// way.
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

/** How fast (m/s) ↑ / ↓ push a held item away or pull it in. */
const PUSH_SPEED = 1.5;

/** How fast (m/s) a carried item eases to its rest distance. */
const SETTLE_SPEED = 1;

/** Lagging further than this behind the hand (m), the item is held up by
 *  something — the easing waits rather than push the hand into it. */
const SETTLE_LAG = 0.25;

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

/** An R press let go within this (seconds) is a tap: it keeps the object
 *  turning until the next press. Held longer, it turns only while held. */
const ROTATE_TAP = 0.25;

/** How fast the body closes on its target angle: angular velocity is the
 *  remaining angle × this, per second (a ~1/12 s time constant). */
const ROTATE_GAIN = 12;

/** Cap on that angular velocity (rad/s), so a big error can't whip. */
const MAX_SPIN = 20;

/** Further than this from the hand (metres) and the item is stuck behind
 *  something: it snaps back (#77). */
const SNAP_DISTANCE = 1.5;

/** Seconds it has to stay that far before it counts as stuck — an item
 *  picked up from across the room starts far away and flies in. */
const STUCK_TIME = 0.5;

/** Seconds a snapped item stays out of collision, so it can't wedge again
 *  the moment it lands in the hand. */
const SNAP_GHOST_TIME = 1;

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

  /** Seconds left with the held item's collision off after a snap back. */
  _ghostTime = 0;

  /** Seconds the held item has been further than SNAP_DISTANCE from the hand. */
  _farTime = 0;

  /** R was down last frame. */
  _rotateDown = false;

  /** What the current R press does: 'start' turning, or 'stop' a tapped turn. */
  _rotatePress = null;

  /** Seconds the current R press has been held. */
  _rotatePressTime = 0;

  /** A tap of R set the object turning; it turns until the next press. */
  _rotateLatched = false;

  /** ↑ / ↓ have moved the item: no more easing to the rest distance. */
  _steered = false;

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
    this._rotateLatched = false;
    this._setLookLocked(false);
    // Solid again straight away — a dropped ghost would fall through the floor.
    this._setGhost(pickupable.gameObject, false);
    pickupable.gameObject?.rigidBody?.enableCcd?.(false);

    // Restore normal physics so the object falls / sits.
    const go = pickupable.gameObject;
    if (go) go.interpolate = true;
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
    this._farTime = 0;
    this._rotateLatched = false;

    // Make the body dynamic with no gravity and high damping so it floats.
    const go = pickupable.gameObject;
    // Drawn at the latest physics step, as the camera is: interpolated, it
    // trailed the camera by a part of a step that changed every frame, a
    // jitter while running.
    if (go) go.interpolate = false;
    if (go?.rigidBody) {
      go.rigidBody.setGravityScale(0, true);
      go.rigidBody.setLinearDamping(5.0, true);
      go.rigidBody.setAngularDamping(5.0, true);
      go.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      go.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      // Continuous collision while carried: the hold spring can whip a small
      // item fast enough to step clean through a thin surface (#76).
      go.rigidBody.enableCcd?.(true);
    }

    // Hold it as far away as it already is. A set arm length yanked it to
    // that distance on the first step — down through the desk it sat on,
    // or into the wall behind it.
    const engine = this._getEngine();
    const t = go?.rigidBody?.translation?.();
    if (engine?.camera && t) {
      this._view(engine.camera);
      const depth = _disp.set(t.x, t.y, t.z).sub(_camPos).dot(_camFwd);
      pickupable.holdDistance = THREE.MathUtils.clamp(
        depth, pickupable.minHoldDistance, pickupable.maxHoldDistance);
    }

    // Hold it at the angle it was picked up at, relative to the camera.
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

    // ── ↑ / ↓ push it away and pull it in ──
    // Not while the player is held still (the security monitor steps its
    // cameras with them) or the terminal is up.
    const free = !engine.playerController?.inputLocked
      && !(this.terminal && this.terminal.state !== 'idle');
    if (this.heldPickupable && free) {
      const push = (engine.isAction('holdFurther') ? 1 : 0) - (engine.isAction('holdCloser') ? 1 : 0);
      if (push !== 0) {
        const p = this.heldPickupable;
        p.holdDistance = THREE.MathUtils.clamp(
          p.holdDistance + push * PUSH_SPEED * dt, p.minHoldDistance, p.maxHoldDistance);
        this._steered = true;
      }
    }

    // ── R + mouse turns the held object, not the view ──
    const rotating = this._rotation(engine.isAction('rotateHeld'), dt);
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
    this._view(engine.camera);
    _target.copy(_camPos).addScaledVector(_camFwd, this.heldPickupable.holdDistance);

    // Current body position
    const t = go.rigidBody.translation();

    // Displacement from current to target
    _disp.set(_target.x - t.x, _target.y - t.y, _target.z - t.z);

    // Not yet moved by the wheel or ↑ / ↓: ease the hand to the rest
    // distance, while the item keeps up with it.
    const held = this.heldPickupable;
    if (!engine.input?.hasWheel && !this._steered && _disp.length() < SETTLE_LAG) {
      const step = SETTLE_SPEED * _dt;
      const off = held.restHoldDistance - held.holdDistance;
      held.holdDistance += THREE.MathUtils.clamp(off, -step, step);
    }

    // Collision back on once the snap's grace second has run out.
    if (this._ghostTime > 0) {
      this._ghostTime -= _dt;
      if (this._ghostTime <= 0) this._setGhost(go, false);
    }

    // Stuck behind something, too far from the hand (#77): snap it back and
    // let it pass through things for a moment so it can't wedge again.
    this._farTime = _disp.length() > SNAP_DISTANCE ? this._farTime + _dt : 0;
    if (this._farTime >= STUCK_TIME) {
      this._farTime = 0;
      go.rigidBody.setTranslation?.({ x: _target.x, y: _target.y, z: _target.z }, true);
      go.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      go.rigidBody.resetForces(false);
      this._setGhost(go, true);
      return;
    }

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
      // Respect the HUD toggle — don't show the prompt if promptsHidden is set.
      if (!this.interactionSystem.promptsHidden) {
        const binds = this._getEngine()?.keyBinds ?? {};
        const rotate = keyName(binds.rotateHeld ?? 'KeyR');
        const push = `${keyName(binds.holdFurther ?? 'ArrowUp')}/${keyName(binds.holdCloser ?? 'ArrowDown')}`;
        this.interactionSystem.prompt?.show(this._rotateLatched
          ? `[E] Drop \u00b7 [${rotate}] Stop rotating`
          : `[E] Drop \u00b7 [${rotate}] Rotate \u00b7 [${push}] Push/pull`);
      }
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

  /** Where the view starts and points: fills _camPos and _camFwd. */
  _view(camera) {
    camera.getWorldPosition(_camPos);
    _camFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
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

  /** Turn the item's collision off (a snap back) or on again. */
  _setGhost(go, ghost) {
    if (!ghost && this._ghostTime <= 0 && !this._ghosted) return;
    this._ghosted = ghost;
    this._ghostTime = ghost ? SNAP_GHOST_TIME : 0;
    const colliders = go?.colliders ?? (go?.collider ? [go.collider] : []);
    for (const collider of colliders) collider.setEnabled?.(!ghost);
  }

  /** Whether the held object turns with the mouse this frame, given R.
   *  Held, it turns while held; tapped, until the next press. */
  _rotation(down, dt) {
    if (down && !this._rotateDown) {
      this._rotatePress = this._rotateLatched ? 'stop' : 'start';
      this._rotateLatched = false;
      this._rotatePressTime = 0;
    }
    if (down) this._rotatePressTime += dt;
    else if (this._rotateDown && this._rotatePress === 'start'
      && this._rotatePressTime < ROTATE_TAP && this.heldPickupable) {
      this._rotateLatched = true;
    }
    this._rotateDown = down;
    return !!this.heldPickupable
      && ((down && this._rotatePress === 'start') || this._rotateLatched);
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
