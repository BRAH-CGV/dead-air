import * as THREE from 'three';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// FirstPersonController  –  Component
// ─────────────────────────────────────────────
// Attach to the Player GameObject.  Reads Engine.input and drives
// the Rapier character controller + camera rotation.
// ─────────────────────────────────────────────

export class FirstPersonController extends Component {
  /** @param {RAPIER.KinematicCharacterController} rapierCtrl */
  constructor(rapierCtrl, opts = {}) {
    super();
    this.ctrl = rapierCtrl;

    this.speed       = opts.speed       ?? 5;
    this.jumpForce   = opts.jumpForce   ?? 4;
    this.sensitivity = opts.sensitivity ?? 0.002;
    this.halfH       = opts.capsuleHalfHeight ?? 0.5;
    this.radius      = opts.capsuleRadius     ?? 0.3;

    this.pitch     = 0;
    this.yaw       = 0;
    this.grounded  = false;
    this.velocity  = { x: 0, y: 0, z: 0 };

    /** @type {THREE.Camera|null} set by Engine after construction */
    this.camera = null;
  }

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

    // ── Movement input (relative to yaw) ──
    const fwd   = Number(input.keys['KeyW'] ?? false) - Number(input.keys['KeyS'] ?? false);
    const right = Number(input.keys['KeyD'] ?? false) - Number(input.keys['KeyA'] ?? false);

    const dir = new THREE.Vector3(right, 0, -fwd);
    if (dir.lengthSq() > 0) dir.normalize();
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    this.velocity.x =  dir.x * this.speed;
    this.velocity.z =  dir.z * this.speed;

    // ── Gravity & jump ──
    this.velocity.y -= 9.81 * dt;

    if (this.grounded && input.keys['Space']) {
      this.velocity.y = this.jumpForce;
    }

    // ── Move via Rapier character controller ──
    const rb = this.gameObject.rigidBody;
    const ox = this.velocity.x * dt;
    const oy = this.velocity.y * dt;
    const oz = this.velocity.z * dt;

    this.ctrl.computeColliderMovement(
      this.gameObject.collider,
      { x: ox, y: oy, z: oz },
    );

    const corrected = this.ctrl.computedMovement();
    rb.setNextKinematicTranslation({
      x: rb.translation().x + corrected.x,
      y: rb.translation().y + corrected.y,
      z: rb.translation().z + corrected.z,
    });

    this.grounded = this.ctrl.computedGrounded();
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
  }
}
