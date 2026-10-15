import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { BuggyDeparture, BUGGY_DEPARTURE, eagleView } from './BuggyDeparture.js';

// ─────────────────────────────────────────────
// BuggySendOff  –  the cutscene that sends the buggy off each morning
// ─────────────────────────────────────────────
// Every morning, once the drive box is in the boot and the quota is met,
// the player presses E on the buggy and this plays out (#98):
//
//   1. The boot lid shuts.
//   2. The view rises from the player's eyes to an eagle view behind and
//      above the buggy.
//   3. The buggy drives itself out through the sliding gate in the fence
//      and down a lane through the belt.
//   4. The screen fades, and the player is back on their feet with
//      "Buggy away — get some sleep".
//
// The buggy is back every evening (resetForNight).
//
// Built after _addBedRest, on the GameplaySystems GO. The scene hands it
// the buggy, the boot, the lid pivot, the socket, the gate, the controller,
// the fade, the player, the interaction system, and the moonlight.
//
// Exposes: active, driving, logic, curve — for a sound owner to follow.
// ─────────────────────────────────────────────

const _pos = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _eyePos = new THREE.Vector3();
const _eyeTarget = new THREE.Vector3();
const _lookMat = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _axisQ = new THREE.Quaternion();
const _xAxis = new THREE.Vector3(1, 0, 0);

/** Wheel radius at scale 0.75 (the real buggy's wheels). */
const WHEEL_RADIUS = 0.54;

export class BuggySendOff extends Component {
  /** @type {boolean} Whether the cutscene is playing (closing or driving). */
  get active() { return this.logic.active; }
  /** @type {boolean} Whether the buggy is moving along the route. */
  get driving() { return this.logic.driving; }
  /** @type {BuggyDeparture} The timeline. */
  logic;
  /** @type {THREE.CatmullRomCurve3|null} The route curve. */
  curve;

  /**
   * @param {object} opts
   * @param {object} opts.engine
   * @param {object} opts.buggy  The Buggy GameObject.
   * @param {object} opts.boot  The BuggyBoot GameObject.
   * @param {THREE.Object3D} opts.lidPivot  The lid's pivot group.
   * @param {object} opts.socket  The boot's SnapSocket.
   * @param {object} opts.gate  The fence's FenceGate.
   * @param {object} opts.controller  The GameController.
   * @param {object} opts.fade  The ScreenFade.
   * @param {object} opts.player  The FirstPersonController.
   * @param {object} opts.interaction  The InteractionSystem.
   * @param {(locked: boolean) => void} opts.setPlayerLocked
   * @param {() => boolean} opts.isFrozen
   * @param {object} opts.moonLight  The scene's moonlight.
   * @param {THREE.CatmullRomCurve3|null} opts.curve  The route curve.
   * @param {number} opts.length  Route length in metres.
   * @param {number} opts.gateAt  Gate position along the route in metres.
   */
  constructor({
    engine, buggy, boot, lidPivot, socket, gate, controller, fade, player, interaction,
    setPlayerLocked, isFrozen, moonLight, curve, length, gateAt,
  }) {
    super();
    this.engine = engine;
    this.buggy = buggy;
    this.boot = boot;
    this.lidPivot = lidPivot;
    this.socket = socket;
    this.gate = gate;
    this.controller = controller;
    this.fade = fade;
    this.player = player;
    this.interaction = interaction;
    this.setPlayerLocked = setPlayerLocked;
    this.isFrozen = isFrozen;
    this.moonLight = moonLight;
    this.curve = curve;
    this.length = length;
    this.gateAt = gateAt;

    this.logic = new BuggyDeparture({ length, gateAt });

    // Snapshot of the buggy's initial pose for reset.
    this._buggyPos = buggy.object3d.position.clone();
    this._buggyQuat = buggy.object3d.quaternion.clone();

    // The buggy's own camera for the eagle view.
    this._viewCam = new THREE.PerspectiveCamera();
    this._viewCam.name = 'BuggySendOffCamera';

    // Wheels (may be absent in tests).
    this._wheels = [
      buggy.object3d.getObjectByName('Rover_wheel_1'),
      buggy.object3d.getObjectByName('Rover_wheel_2'),
      buggy.object3d.getObjectByName('Rover_wheel_3'),
    ].filter(Boolean);
    this._wheelInitialQ = this._wheels.map(w => w.quaternion.clone());

    // Eye pose snapshot for the camera lerp.
    this._eyeSnapPos = new THREE.Vector3();
    this._eyeSnapQuat = new THREE.Quaternion();
    this._heading = 0;

    this._fadePending = false;
    this._viewCamActive = false;
  }

  /** Start the cutscene. */
  start() {
    this.engine.consumeAction('interact');
    // Lock the player.
    this.setPlayerLocked(true);
    this.player.enabled = false;
    this.interaction.enabled = false;
    this.interaction.resetPrompt();
    this.engine.crosshair?.hide();

    // Snapshot the camera's world pose.
    this.engine.camera.updateMatrixWorld(true);
    this.engine.camera.getWorldPosition(this._eyeSnapPos);
    this.engine.camera.getWorldQuaternion(this._eyeSnapQuat);

    // Set up the view camera.
    this._viewCam.position.copy(this._eyeSnapPos);
    this._viewCam.quaternion.copy(this._eyeSnapQuat);
    this.engine.viewCamera = this._viewCam;
    this._viewCamActive = true;

    this._heading = this.buggy.object3d.rotation.y;
    this.logic.start();
  }

  onUpdate(dt) {
    const realDt = this.engine.realDt ?? dt;
    if (this.isFrozen()) return;
    if (!this.logic.active) {
      // Idle: ease the lid toward open in the morning, shut otherwise.
      this._easeLidIdle();
      return;
    }

    this.logic.update(realDt);

    if (this.curve) {
      this._moveBuggyAlongCurve();
    }

    // Gate.
    this.gate?.setOpen(this.logic.gateOpen);

    // Lid.
    this._setLid(this.logic.lid);

    // Camera.
    if (this._viewCamActive) this._updateCamera();

    // Skip.
    if (this.engine.isAction('interact')) {
      if (this.logic.skip()) this.engine.consumeAction('interact');
    }

    // Fade.
    if (this.logic.wantsFade && !this.fade.playing && !this._fadePending) {
      const ok = this.fade.play(() => this._onDark());
      if (!ok) this._fadePending = true;
    }
    if (this._fadePending && !this.fade.playing) {
      this._fadePending = false;
      if (this.logic.wantsFade) this.fade.play(() => this._onDark());
    }
  }

  _moveBuggyAlongCurve() {
    const t = this.logic.distance / this.length;
    this.curve.getPointAt(Math.min(t, 1), _pos);
    this.curve.getTangentAt(Math.min(t, 1), _tangent);
    const yaw = Math.atan2(_tangent.x, _tangent.z);

    this.buggy.object3d.position.copy(_pos);
    this.buggy.object3d.rotation.y = yaw;
    this.buggy.object3d.updateMatrixWorld(true);

    // Update rigid bodies.
    this._syncBody(this.buggy);
    this._syncBody(this.boot);
    this.socket?.syncAttached();

    // Wheels.
    const dist = this.logic.distance;
    const spin = dist / WHEEL_RADIUS;
    for (let i = 0; i < this._wheels.length; i++) {
      const w = this._wheels[i];
      _axisQ.setFromAxisAngle(_xAxis, spin);
      w.quaternion.copy(this._wheelInitialQ[i]).multiply(_axisQ);
    }

    // Damp the camera heading toward the tangent.
    const targetHeading = yaw;
    let d = (targetHeading - this._heading) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    this._heading += d * 0.05;
  }

  _syncBody(go) {
    if (!go?.rigidBody) return;
    go.object3d.updateMatrixWorld(true);
    go.object3d.getWorldPosition(_pos);
    go.object3d.getWorldQuaternion(_q);
    go.rigidBody.setTranslation({ x: _pos.x, y: _pos.y, z: _pos.z }, true);
    go.rigidBody.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
  }

  _updateCamera() {
    const cam = this.engine.camera;
    this._viewCam.fov = cam.fov;
    this._viewCam.aspect = cam.aspect;
    this._viewCam.near = cam.near;
    this._viewCam.far = cam.far;
    this._viewCam.updateProjectionMatrix();

    // Eagle view.
    const forward = new THREE.Vector3(Math.sin(this._heading), 0, Math.cos(this._heading));
    eagleView(this.buggy.object3d.position, forward, { position: _eyePos, target: _eyeTarget });

    // Lerp from the eye snap.
    const v = this.logic.view;
    this._viewCam.position.lerpVectors(this._eyeSnapPos, _eyePos, v);
    _lookMat.lookAt(this._viewCam.position, _eyeTarget, _up);
    this._viewCam.quaternion.setFromRotationMatrix(_lookMat);
    this._viewCam.updateMatrixWorld(true);
  }

  _setLid(t) {
    if (!this.lidPivot) return;
    const open = BUGGY_CARGO_lidOpen();
    this.lidPivot.rotation.x = open * t;
  }

  _easeLidIdle() {
    if (!this.lidPivot) return;
    const open = BUGGY_CARGO_lidOpen();
    const target = this.controller?.state === 'morning' ? open : 0;
    const current = this.lidPivot.rotation.x;
    this.lidPivot.rotation.x = current + (target - current) * 0.05;
  }

  _onDark() {
    this.engine.viewCamera = null;
    this._viewCamActive = false;
    // Hand the player back.
    this.setPlayerLocked(false);
    this.player.enabled = true;
    this.interaction.enabled = true;
    this.engine.crosshair?.show();
    // Move the buggy and boot off-screen.
    this.buggy.object3d.position.y = -50;
    this.boot?.object3d?.position.set(0, -50, 0);
    this._syncBody(this.buggy);
    this._syncBody(this.boot);
    this.engine.shadows?.invalidate();
    // Shut the gate.
    this.gate?.setOpen(0);
    // Dispatch and finish.
    this.controller.dispatch();
    this.logic.finish();
  }

  /** Reset for the next night: restore the buggy, shut the lid and gate. */
  resetForNight() {
    // Restore the buggy's pose.
    this.buggy.object3d.position.copy(this._buggyPos);
    this.buggy.object3d.quaternion.copy(this._buggyQuat);
    this.buggy.object3d.updateMatrixWorld(true);
    this._syncBody(this.buggy);
    this._syncBody(this.boot);
    // Reset wheels.
    for (let i = 0; i < this._wheels.length; i++) {
      this._wheels[i].quaternion.copy(this._wheelInitialQ[i]);
    }
    // Shut lid and gate.
    this._setLid(0);
    this.gate?.setOpen(0);
    // Reset logic.
    const wasActive = this.logic.active;
    this.logic.reset();
    // Drop the view camera if mid-cutscene.
    if (wasActive && this._viewCamActive) {
      this.engine.viewCamera = null;
      this._viewCamActive = false;
      this.setPlayerLocked(false);
      this.player.enabled = true;
      this.interaction.enabled = true;
      this.engine.crosshair?.show();
    }
    this._fadePending = false;
  }

  onDestroy() {
    if (this._viewCamActive && this.engine.viewCamera === this._viewCam) {
      this.engine.viewCamera = null;
    }
  }
}

/** Read the lid open angle from BUGGY_CARGO without a circular import. */
function BUGGY_CARGO_lidOpen() {
  // Imported lazily to avoid a cycle at module load.
  return 80 * Math.PI / 180;
}
