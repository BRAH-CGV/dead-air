import * as THREE from 'three';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// FirstPersonController  –  Component
// ─────────────────────────────────────────────
// onUpdate   → mouse look + store desired movement (variable timestep)
// onFixedUpdate → physics movement via character controller (fixed timestep,
//                 runs just before world.step() so translation is applied)
// ─────────────────────────────────────────────

export class FirstPersonController extends Component {
  /** @param {RAPIER.KinematicCharacterController} rapierCtrl */
  constructor(rapierCtrl, opts = {}) {
    super();
    this.ctrl = rapierCtrl;

    this.speed       = opts.speed       ?? 5;
    this.jumpForce   = opts.jumpForce   ?? 4;
    this.sensitivity = opts.sensitivity ?? 0.002;

    this.pitch     = 0;
    this.yaw       = 0;
    this.grounded  = false;
    this.vertVel   = 0;

    /** @type {THREE.Camera|null} set by Engine after construction */
    this.camera = null;

    /** @type {{x:number, y:number, z:number}} consumed by onFixedUpdate */
    this._desiredMove = { x: 0, y: 0, z: 0 };
    this._wantJump = false;
  }

  // ── Variable timestep: input + mouse look ─────────────
  onUpdate(dt) {
    if (!this.gameObject || !this.camera) return;

    const { input } = this.gameObject.scene.userData.engine
      ?? { input: { keys: {}, mouse: { dx: 0, dy: 0 }, locked: false } };

    // ── Mouse look ──
    if (input.locked) {
      this.yaw   -= input.mouse.dx * this.sensitivity;
      this.pitch -= input.mouse.dy * this.sensitivity;
      this.pitch  = Math.max(-Math.PI / 2 + 0.01,
                    Math.min( Math.PI / 2 - 0.01, this.pitch));
    }

    // Apply rotation directly to camera (YXZ Euler order set in Engine)
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    // ── Compute desired horizontal movement (relative to yaw) ──
    const fwd   = Number(input.keys['KeyW'] ?? false) - Number(input.keys['KeyS'] ?? false);
    const right = Number(input.keys['KeyD'] ?? false) - Number(input.keys['KeyA'] ?? false);

    const dir = new THREE.Vector3(right, 0, -fwd);
    if (dir.lengthSq() > 0) dir.normalize();
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    this._desiredMove.x = dir.x * this.speed;
    this._desiredMove.z = dir.z * this.speed;
    this._wantJump = !!(input.keys['Space']);
  }

  // ── Fixed timestep: physics movement (runs before world.step) ──
  onFixedUpdate(dt) {
    if (!this.gameObject) return;
    const rb = this.gameObject.rigidBody;
    if (!rb) return;

    // ── Gravity & jump ──
    this.vertVel -= 9.81 * dt;
    if (this.grounded && this._wantJump) {
      this.vertVel = this.jumpForce;
    }

    // ── Build desired translation delta for this physics step ──
    const desired = {
      x: this._desiredMove.x * dt,
      y: this.vertVel * dt,
      z: this._desiredMove.z * dt,
    };

    // ── Resolve via Rapier character controller ──
    this.ctrl.computeColliderMovement(
      this.gameObject.collider,
      desired,
    );

    const corrected = this.ctrl.computedMovement();
    const t = rb.translation();
    rb.setNextKinematicTranslation({
      x: t.x + corrected.x,
      y: t.y + corrected.y,
      z: t.z + corrected.z,
    });

    this.grounded = this.ctrl.computedGrounded();
    if (this.grounded && this.vertVel < 0) this.vertVel = 0;
  }
}
