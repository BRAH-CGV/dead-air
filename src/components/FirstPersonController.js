import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// FirstPersonController  –  Component
// ─────────────────────────────────────────────
// onUpdate      → mouse look + input sampling (variable timestep)
// onFixedUpdate → movement + physics via character controller (fixed
//                 timestep, runs just before world.step() so translation
//                 is applied)
//
// Movement is Source-engine flavoured: horizontal velocity lives on the
// fixed step instead of snapping to wish speed. Friction bleeds speed while
// grounded, `accelerate` steers velocity toward the wish direction without
// ever overshooting the wish speed along it, and the air keeps momentum
// with gentler control.
//
// Crouch: the player body carries two capsule colliders — standing and
// crouched — with exactly one enabled at a time. Desired state
// (`_wantCrouch`, derived from the crouch key in onUpdate: 'toggle' flips on
// press, 'hold' follows the key) is reconciled into actual state (`crouched`)
// in onFixedUpdate. Grounded swaps anchor the feet: crouching sinks under
// the desk, standing rises (headroom-gated). Mid-air swaps anchor the
// capsule's centre instead: crouching tucks the legs up (the Source
// crouch-jump), and standing sweeps the legs back down — whatever the legs
// land on pops the body up the remaining distance, so only the ceiling (the
// headroom check) can refuse a stand-up. Jumping while crouched is allowed.
// Everything below the input seam reads only `_wantCrouch`/`crouched`,
// never input — which is what makes switching crouchMode a one-word change.
// ─────────────────────────────────────────────

// A resting capsule's lowest point touches the floor exactly, and
// intersectionWithShape counts that touch as a hit — lift the headroom query
// by this much so standing on flat ground never reads as blocked.
const HEADROOM_EPSILON = 0.02;

// KinematicCharacterController collision offset — the controller rests the
// capsule this far above geometric contact, so pop-ups must target the same
// height or the body sinks through the floor.
const SKIN = 0.01;

export class FirstPersonController extends Component {
  /** @param {RAPIER.KinematicCharacterController} rapierCtrl */
  constructor(rapierCtrl, opts = {}) {
    super();
    this.ctrl = rapierCtrl;

    this.speed       = opts.speed       ?? 5;
    this.jumpForce   = opts.jumpForce   ?? 4;
    this.sensitivity = opts.sensitivity ?? 0.002;

    // ── Source-style horizontal movement ──
    // `accelerate`/`friction` are sv_accelerate/sv_friction in spirit:
    // accelSpeed is capped at accel * wishSpeed * dt, and friction drops a
    // fraction of the current speed per tick (constant below stopSpeed).
    this.accel      = opts.accel      ?? 6;
    this.airAccel   = opts.airAccel   ?? 2;
    this.friction   = opts.friction   ?? 6;
    this.stopSpeed  = opts.stopSpeed  ?? 1;

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

    // Sampled in onUpdate, consumed on the fixed step.
    this._wishDir = { x: 0, z: 0 };   // unit direction of held inputs
    this._wish    = false;            // any movement key held?
    this._wantJump = false;

    // Integrated on the fixed step — the actual horizontal velocity.
    this._vel = { x: 0, z: 0 };

    this._wantCrouch = false;     // desired state — the ONLY input-derived crouch field
    this._crouchHeld = false;     // previous-frame key state for edge detection
    this._eyeLift    = 0;         // camera-local Y compensation during transitions

    // Derived once from the colliders: the vertical distance between the two
    // capsule centres when their feet share a floor.
    const standH  = this.standCollider.halfHeight()  + this.standCollider.radius();
    const crouchH = this.crouchCollider.halfHeight() + this.crouchCollider.radius();
    this._swapDrop = standH - crouchH;

    // Scratch vectors for input direction — nothing allocated per frame.
    this._dir = new THREE.Vector3();
    this._up  = new THREE.Vector3(0, 1, 0);

    // Reused query state — no per-frame allocations (codebase rule).
    this._headroomShape = new RAPIER.Capsule(
      this.standCollider.halfHeight(), this.standCollider.radius(),
    );
    this._queryPos    = { x: 0, y: 0, z: 0 };
    this._castPos     = { x: 0, y: 0, z: 0 };
    this._castVel     = { x: 0, y: 0, z: 0 };
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

    // ── Sample movement intent (speed is applied on the fixed step) ──
    const fwd   = Number(!!input.keys[keyBinds.forward]) - Number(!!input.keys[keyBinds.back]);
    const right = Number(!!input.keys[keyBinds.right])   - Number(!!input.keys[keyBinds.left]);

    this._wish = fwd !== 0 || right !== 0;
    if (this._wish) {
      this._dir.set(right, 0, -fwd).normalize().applyAxisAngle(this._up, this.yaw);
      this._wishDir.x = this._dir.x;
      this._wishDir.z = this._dir.z;
    }
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

    // ── Gravity & jump (crouch-jumping allowed: hiding beats hopping) ──
    this.vertVel -= 9.81 * dt;
    if (this.grounded && this._wantJump) this.vertVel = this.jumpForce;

    // ── Source-style horizontal velocity ──
    // Friction only runs while grounded — the air keeps momentum.
    if (this.grounded) this._applyFriction(dt);
    const wishSpeed = this._wish ? (this.crouched ? this.crouchSpeed : this.speed) : 0;
    this._accelerate(
      this._wishDir, wishSpeed,
      this.grounded ? this.accel : this.airAccel, dt,
    );

    // ── Build desired translation delta for this physics step ──
    const desired = {
      x: this._vel.x * dt,
      y: this.vertVel * dt,
      z: this._vel.z * dt,
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
    // Grounded swaps anchor the feet; mid-air swaps anchor the capsule's
    // centre. A refused stand-up stays crouched and retries every tick, so
    // walking out from under the desk auto-stands.
    let shiftY = 0;
    if (this._wantCrouch !== this.crouched) {
      if (this._wantCrouch) {
        shiftY = this.grounded ? this._enterCrouch() : this._enterCrouchAir();
      } else {
        shiftY = this.grounded
          ? this._tryExitCrouchGrounded(corrected)
          : this._tryExitCrouchAir(corrected);
      }
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

  // ── Source-style movement helpers ─────────

  /** Bleed horizontal speed while grounded. Above stopSpeed the drop is
   *  proportional to speed (a glide); below it the drop is constant, so
   *  low speeds still come to a clean stop instead of asymptoting. */
  _applyFriction(dt) {
    const speed = Math.hypot(this._vel.x, this._vel.z);
    if (speed < 1e-4) { this._vel.x = 0; this._vel.z = 0; return; }
    const drop  = Math.max(speed, this.stopSpeed) * this.friction * dt;
    const scale = Math.max(0, speed - drop) / speed;
    this._vel.x *= scale;
    this._vel.z *= scale;
  }

  /** Steer velocity toward wishDir. The projection clamp means speed is
   *  only ever added along the wish direction, never past wishSpeed along
   *  it — perpendicular momentum (air control, wall slides) survives. */
  _accelerate(wishDir, wishSpeed, accel, dt) {
    if (wishSpeed <= 0) return;
    const current = this._vel.x * wishDir.x + this._vel.z * wishDir.z;
    const add     = wishSpeed - current;
    if (add <= 0) return;
    const accelSpeed = Math.min(accel * wishSpeed * dt, add);
    this._vel.x += wishDir.x * accelSpeed;
    this._vel.z += wishDir.z * accelSpeed;
  }

  // ── Crouch helpers ─────────────────────────

  /** Grounded: swap to the crouch capsule, feet planted. Returns the shift. */
  _enterCrouch() {
    this.standCollider.setEnabled(false);
    this.crouchCollider.setEnabled(true);
    this.gameObject.collider = this.crouchCollider;
    this._eyeLift += this._swapDrop;   // camera world position unchanged this frame
    this.crouched = true;
    return -this._swapDrop;            // feet stay planted
  }

  /** Mid-air: shrink the capsule around its centre — the body stays put and
   *  the legs tuck up (the Source crouch-jump leg-lift). The view holds too,
   *  so there is no eye compensation. Returns the shift (0). */
  _enterCrouchAir() {
    this.standCollider.setEnabled(false);
    this.crouchCollider.setEnabled(true);
    this.gameObject.collider = this.crouchCollider;
    this.crouched = true;
    return 0;
  }

  /** Grounded stand-up: feet-anchored, gated by headroom. Returns the
   *  vertical shift, or 0 when the ceiling refuses. */
  _tryExitCrouchGrounded(corrected) {
    if (!this._checkHeadroom(corrected, this._swapDrop + SKIN)) return 0;
    return this._exitCrouch(this._swapDrop + SKIN);
  }

  /** Mid-air stand-up: sweep the standing capsule down from the
   *  feet-anchored spot to the centre-anchored one. The legs extend as far
   *  as they can before touching something; whatever is left of the sweep
   *  pops the body up, landing the feet on top of it. Only the ceiling (the
   *  headroom check at the final spot) can refuse a stand-up. */
  _tryExitCrouchAir(corrected) {
    const t = this.gameObject.rigidBody.translation();
    this._castPos.x = t.x + corrected.x;
    this._castPos.y = t.y + corrected.y + this._swapDrop;  // feet-anchored start
    this._castPos.z = t.z + corrected.z;
    this._castVel.x = 0;
    this._castVel.y = -this._swapDrop;
    this._castVel.z = 0;
    const hit = this.world.castShape(
      this._castPos, this._identityRot, this._castVel,
      this._headroomShape,
      0,      // targetDistance: rest at exact contact (touching still hits)
      1,      // maxToi: the full sweep (distance = |shapeVel| * 1)
      true,   // stopAtPenetration: a touching/penetrating start hits at toi 0
      undefined, undefined, undefined,   // flags, groups, excludeCollider
      this.gameObject.rigidBody,         // exclude our own two capsules
      this._notOwnCollider,
    );
    // No hit: the whole leg sweep is clear — expand around the centre.
    // Hit: the legs drop by toi * sweep; the body rises by the rest, plus the
    // controller's skin offset so the capsule lands at its proper rest height
    // (without it the controller can't resolve a body at exact contact and the
    // legs sink through the floor).
    const drop   = hit ? hit.time_of_impact * this._swapDrop : this._swapDrop;
    const shiftY = this._swapDrop - drop + (hit ? SKIN : 0);
    if (!this._checkHeadroom(corrected, shiftY)) return 0;
    return this._exitCrouch(shiftY);
  }

  /** Swap back to the standing capsule, body raised by [shiftY]. */
  _exitCrouch(shiftY) {
    this.crouchCollider.setEnabled(false);
    this.standCollider.setEnabled(true);
    this.gameObject.collider = this.standCollider;
    this._eyeLift -= shiftY;           // camera world position unchanged this frame
    this.crouched = false;
    return shiftY;
  }

  /** Would the standing capsule, centred [shiftY] above where the crouch
   *  capsule is about to end this step, fit? Both capsules share a radius,
   *  so this only really tests the volume above the crouch capsule —
   *  pressing against a wall never blocks it. */
  _checkHeadroom(corrected, shiftY) {
    const t = this.gameObject.rigidBody.translation();
    this._queryPos.x = t.x + corrected.x;
    this._queryPos.y = t.y + corrected.y + shiftY + HEADROOM_EPSILON;
    this._queryPos.z = t.z + corrected.z;
    return this.world.intersectionWithShape(
      this._queryPos, this._identityRot, this._headroomShape,
      undefined, undefined, undefined,           // flags, groups, excludeCollider
      this.gameObject.rigidBody,                 // exclude our own two capsules
      this._notOwnCollider,
    ) === null;
  }
}
