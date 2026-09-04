import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// FirstPersonController  –  Component
// ─────────────────────────────────────────────
// onUpdate      → mouse look + input → desired movement (variable timestep)
// onFixedUpdate → physics movement via character controller (fixed timestep,
//                 runs just before world.step() so translation is applied)
//
// Crouch: the player body carries two capsule colliders — standing and
// crouched — with exactly one enabled at a time. Desired state
// (`_wantCrouch`, derived from the crouch key in onUpdate: 'toggle' flips on
// press, 'hold' follows the key) is reconciled into actual state (`crouched`)
// in onFixedUpdate. Standing up is gated by a headroom query, so the player
// stays crouched until there is room to stand. Everything below that input
// seam reads only `_wantCrouch`/`crouched`, never input — which is what makes
// switching crouchMode a one-word change.
// ─────────────────────────────────────────────

// A resting capsule's lowest point touches the floor exactly, and
// intersectionWithShape counts that touch as a hit — lift the headroom query
// by this much so standing on flat ground never reads as blocked.
const HEADROOM_EPSILON = 0.02;

export class FirstPersonController extends Component {
  /** @param {RAPIER.KinematicCharacterController} rapierCtrl */
  constructor(rapierCtrl, opts = {}) {
    super();
    this.ctrl = rapierCtrl;

    this.speed       = opts.speed       ?? 5;
    this.jumpForce   = opts.jumpForce   ?? 4;
    this.sensitivity = opts.sensitivity ?? 0.002;

    // ── Crouch ──
    /** @type {RAPIER.Collider} full-height capsule, enabled while standing */
    this.standCollider  = opts.standCollider;
    /** @type {RAPIER.Collider} short capsule, enabled while crouched */
    this.crouchCollider = opts.crouchCollider;
    this.crouchSpeed          = opts.crouchSpeed          ?? 2.5;
    this.crouchTransitionTime = opts.crouchTransitionTime ?? 0.2;
    this.crouchMode           = opts.crouchMode           ?? 'toggle';  // 'toggle' | 'hold'

    /** Public: gameplay reads this (hide-under-desk mechanic). */
    this.crouched = false;
    /** Public: true while standing is desired but headroom refuses it. */
    this.standBlocked = false;

    this.pitch     = 0;
    this.yaw       = 0;
    this.grounded  = false;
    this.vertVel   = 0;

    /** @type {THREE.Camera|null} set by Engine after construction */
    this.camera = null;

    /** @type {{x:number, y:number, z:number}} consumed by onFixedUpdate */
    this._desiredMove = { x: 0, y: 0, z: 0 };
    this._wantJump = false;

    this._wantCrouch = false;     // desired state — the ONLY input-derived crouch field
    this._crouchHeld = false;     // previous-frame key state for edge detection
    this._eyeLift    = 0;         // camera-local Y compensation during transitions

    // Derived once from the colliders: the vertical distance between the two
    // capsule centres when their feet share a floor.
    const standH  = this.standCollider.halfHeight()  + this.standCollider.radius();
    const crouchH = this.crouchCollider.halfHeight() + this.crouchCollider.radius();
    this._swapDrop = standH - crouchH;

    // Reused query state — no per-frame allocations (codebase rule).
    this._headroomShape = new RAPIER.Capsule(
      this.standCollider.halfHeight(), this.standCollider.radius(),
    );
    this._queryPos    = { x: 0, y: 0, z: 0 };
    this._identityRot = { x: 0, y: 0, z: 0, w: 1 };
    // Queries can see disabled colliders, and the disabled stand capsule sits
    // exactly where a stand-up would put the player — exclude both by identity.
    this._notOwnCollider =
      (c) => c !== this.standCollider && c !== this.crouchCollider;
  }

  // ── Variable timestep: input + mouse look ─────────────
  onUpdate(dt) {
    if (!this.gameObject || !this.camera) return;

    const engine = this.gameObject.scene?.userData.engine;
    if (!engine) return;

    const { input, keyBinds } = engine;

    // ── Mouse look ──
    if (input.locked) {
      this.yaw   -= input.mouse.dx * this.sensitivity;
      this.pitch -= input.mouse.dy * this.sensitivity;
      this.pitch  = Math.max(-Math.PI / 2 + 0.01,
                    Math.min( Math.PI / 2 - 0.01, this.pitch));
    }

    // Apply rotation directly to camera (YXZ Euler order set in Engine)
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    // ── Crouch input — the entire input-mode seam ──
    const crouchHeld = engine.isAction('crouch');
    if (this.crouchMode === 'hold') {
      this._wantCrouch = crouchHeld;              // level-driven: follows the key
    } else if (crouchHeld && !this._crouchHeld) {
      this._wantCrouch = !this._wantCrouch;       // edge-driven: flip on press
    }
    this._crouchHeld = crouchHeld;

    // ── Compute desired horizontal movement (relative to yaw) ──
    const fwd   = Number(!!input.keys[keyBinds.forward]) - Number(!!input.keys[keyBinds.back]);
    const right = Number(!!input.keys[keyBinds.right])   - Number(!!input.keys[keyBinds.left]);

    const dir = new THREE.Vector3(right, 0, -fwd);
    if (dir.lengthSq() > 0) dir.normalize();
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    const speed = this.crouched ? this.crouchSpeed : this.speed;
    this._desiredMove.x = dir.x * speed;
    this._desiredMove.z = dir.z * speed;
    this._wantJump = !!input.keys[keyBinds.jump];

    // ── Ease the camera to the new eye height after a swap ──
    // The physics shift lands in one step; _eyeLift holds the camera at the
    // old eye height for an instant, then decays to the new one.
    const liftStep = (this._swapDrop / this.crouchTransitionTime) * dt;
    this._eyeLift -= Math.sign(this._eyeLift) * Math.min(liftStep, Math.abs(this._eyeLift));
    this.camera.position.y = this._eyeLift;
  }

  // ── Fixed timestep: physics movement (runs before world.step) ──
  onFixedUpdate(dt) {
    if (!this.gameObject) return;
    const rb = this.gameObject.rigidBody;
    if (!rb) return;

    // ── Gravity & jump ──
    this.vertVel -= 9.81 * dt;
    if (this.grounded && this._wantJump && !this.crouched) {
      this.vertVel = this.jumpForce;
    }

    // ── Build desired translation delta for this physics step ──
    const desired = {
      x: this._desiredMove.x * dt,
      y: this.vertVel * dt,
      z: this._desiredMove.z * dt,
    };

    // ── Resolve via Rapier character controller ──
    // Always from the enabled collider's fresh position. A crouch shift must
    // NOT go through setTranslation: the controller reads collider positions
    // that only update inside world.step(), so teleporting here would desync
    // movement for a frame. Instead the swap + shift ride along with this
    // step's setNextKinematicTranslation, and world.step() propagates them
    // atomically.
    this.ctrl.computeColliderMovement(
      this.gameObject.collider,
      desired,
    );

    const corrected = this.ctrl.computedMovement();

    // ── Crouch reconciliation: desired state vs actual state ──
    let shiftY = 0;
    if (this._wantCrouch !== this.crouched) {
      if (this._wantCrouch) {
        shiftY = this._enterCrouch();
      } else if (this._checkHeadroom(corrected)) {
        shiftY = this._exitCrouch();
      }
      // else: standing refused — stays crouched and retries every tick, so
      // walking out from under the desk auto-stands.
    }
    this.standBlocked = !this._wantCrouch && this.crouched;

    const t = rb.translation();
    rb.setNextKinematicTranslation({
      x: t.x + corrected.x,
      y: t.y + corrected.y + shiftY,
      z: t.z + corrected.z,
    });

    this.grounded = this.ctrl.computedGrounded();
    if (this.grounded && this.vertVel < 0) this.vertVel = 0;
  }

  // ── Crouch helpers ─────────────────────────

  /** Swap to the crouch capsule. Returns the vertical shift for this step. */
  _enterCrouch() {
    this.standCollider.setEnabled(false);
    this.crouchCollider.setEnabled(true);
    this.gameObject.collider = this.crouchCollider;
    this._eyeLift += this._swapDrop;   // camera world position unchanged this frame
    this.crouched = true;
    return -this._swapDrop;            // feet stay planted
  }

  /** Swap back to the standing capsule. Returns the vertical shift. */
  _exitCrouch() {
    this.crouchCollider.setEnabled(false);
    this.standCollider.setEnabled(true);
    this.gameObject.collider = this.standCollider;
    this._eyeLift -= this._swapDrop;
    this.crouched = false;
    return this._swapDrop;
  }

  /** Would the full standing capsule fit where the crouched one is about to
   *  be? Queried at this step's end position (current + corrected + shift).
   *  Both capsules share a radius, so this only really tests the volume
   *  above the crouch capsule — pressing against a wall never blocks it. */
  _checkHeadroom(corrected) {
    const t = this.gameObject.rigidBody.translation();
    this._queryPos.x = t.x + corrected.x;
    this._queryPos.y = t.y + corrected.y + this._swapDrop + HEADROOM_EPSILON;
    this._queryPos.z = t.z + corrected.z;
    return this.world.intersectionWithShape(
      this._queryPos, this._identityRot, this._headroomShape,
      undefined, undefined, undefined,           // flags, groups, excludeCollider
      this.gameObject.rigidBody,                 // exclude our own two capsules
      this._notOwnCollider,
    ) === null;
  }
}
