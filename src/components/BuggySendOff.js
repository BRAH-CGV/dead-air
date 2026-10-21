import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { BuggyDeparture, eagleView } from '../gameplay/BuggyDeparture.js';
import { BUGGY_CARGO } from './BuggyCargo.js';

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
//   4. The screen fades, and the player is back on their feet.
//
// The buggy is back every evening (resetForNight).
//
// Built after _addBedRest, on the GameplaySystems GO. The scene hands it
// the buggy, the boot, the lid pivot, the socket, the gate, the controller,
// the fade, the player and the interaction system. The rules (the route, the
// timeline, the camera) are pure, in BuggyDeparture.
//
// Exposes: active, driving, logic, curve — for a sound owner to follow.
// ─────────────────────────────────────────────

const _pos = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _eagle = { position: new THREE.Vector3(), target: new THREE.Vector3() };
const _eagleQ = new THREE.Quaternion();
const _lookMat = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _axisQ = new THREE.Quaternion();
const _xAxis = new THREE.Vector3(1, 0, 0);

export const BUGGY_SEND_OFF = {
  /** Wheel radius at BUGGY_SCALE (0.75), metres: how far a turn rolls it. */
  wheelRadius: 0.54,
  /** How fast the eagle view swings round to the way the buggy is heading,
   *  per second, so a bend in the road is a turn, not a cut. */
  headingRate: 3,
  /** How fast the idle lid swings open in the morning and shut otherwise,
   *  per second. */
  lidRate: 3,
};

/** Share of the way to a target to move this frame, for an exponential ease
 *  at `rate` per second — the same at any frame rate. */
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);

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
   * @param {object} opts.boot  The BuggyBoot GameObject, a child of the buggy.
   * @param {THREE.Object3D} opts.lidPivot  The lid's pivot group.
   * @param {object} opts.socket  The boot's SnapSocket.
   * @param {object} opts.gate  The fence's FenceGate.
   * @param {object} opts.controller  The GameController.
   * @param {object} opts.fade  The ScreenFade.
   * @param {object} opts.player  The FirstPersonController.
   * @param {object} opts.interaction  The InteractionSystem.
   * @param {(locked: boolean) => void} opts.setPlayerLocked
   * @param {() => boolean} opts.isFrozen  The debug fly camera is on.
   * @param {THREE.CatmullRomCurve3|null} opts.curve  The route curve.
   * @param {number} opts.length  Route length in metres.
   * @param {number} opts.gateAt  Gate position along the route in metres.
   */
  constructor({
    engine, buggy, boot, lidPivot, socket, gate, controller, fade, player, interaction,
    setPlayerLocked, isFrozen = () => false, curve, length, gateAt,
  }) {
    super();
    Object.assign(this, {
      engine, buggy, boot, lidPivot, socket, gate, controller, fade, player, interaction,
      setPlayerLocked, isFrozen, curve, length, gateAt,
    });

    this.logic = new BuggyDeparture({ length, gateAt });

    // Where it parks, for the evening.
    this._buggyPos = buggy.object3d.position.clone();
    this._buggyQuat = buggy.object3d.quaternion.clone();

    // A camera of its own for the eagle view, handed to engine.viewCamera.
    this._viewCam = new THREE.PerspectiveCamera();
    this._viewCam.name = 'BuggySendOffCamera';

    // Wheels (absent in tests), rolled from where they were built.
    this._wheels = ['Rover_wheel_1', 'Rover_wheel_2', 'Rover_wheel_3']
      .map(name => buggy.object3d.getObjectByName(name))
      .filter(Boolean);
    this._wheelInitialQ = this._wheels.map(w => w.quaternion.clone());

    // The player's eye when it started, for the rise out of it.
    this._eyeSnapPos = new THREE.Vector3();
    this._eyeSnapQuat = new THREE.Quaternion();
    this._heading = 0;

    this._fading = false;
    this._viewCamActive = false;
  }

  /** Start the cutscene. */
  start() {
    this.engine.consumeAction('interact');
    this.setPlayerLocked(true);
    if (this.player) this.player.enabled = false;
    if (this.interaction) this.interaction.enabled = false;
    this.interaction?.resetPrompt?.();
    this.engine.crosshair?.hide?.();

    this.engine.camera.updateMatrixWorld(true);
    this.engine.camera.getWorldPosition(this._eyeSnapPos);
    this.engine.camera.getWorldQuaternion(this._eyeSnapQuat);

    this._viewCam.position.copy(this._eyeSnapPos);
    this._viewCam.quaternion.copy(this._eyeSnapQuat);
    this.engine.viewCamera = this._viewCam;
    this._viewCamActive = true;

    // Read off where the nose points, not rotation.y: once the night start
    // has put the parked quaternion back, three reads a heading past 90°
    // out as x and z flipped by π and y mirrored.
    _forward.set(0, 0, 1).applyQuaternion(this.buggy.object3d.quaternion);
    this._heading = Math.atan2(_forward.x, _forward.z);
    this._fading = false;
    this.logic.start();
  }

  onUpdate(dt) {
    // Real time, so a nap's speed-up never hurries it; the fly camera holds it.
    const realDt = this.engine.realDt ?? dt;
    if (this.isFrozen()) return;
    if (!this.logic.active) {
      this._easeLidIdle(realDt);
      return;
    }

    this.logic.update(realDt);
    if (this.curve) this._moveBuggyAlongCurve(realDt);
    this.gate?.setOpen(this.logic.gateOpen);
    this._setLid(this.logic.lid);
    if (this._viewCamActive) this._updateCamera();

    if (this.engine.isAction('interact') && this.logic.skip()) this.engine.consumeAction('interact');

    // One fade. A fade already running (play() refuses) is tried again next
    // frame. Set first: without a #fade element play() calls back at once.
    if (this.logic.wantsFade && !this._fading) {
      this._fading = true;
      if (!this.fade) this._onDark();
      else if (!this.fade.play(() => this._onDark())) this._fading = false;
    }
  }

  _moveBuggyAlongCurve(dt) {
    const t = Math.min(this.logic.distance / this.length, 1);
    this.curve.getPointAt(t, _pos);
    this.curve.getTangentAt(t, _tangent);
    const yaw = Math.atan2(_tangent.x, _tangent.z);

    this.buggy.object3d.position.copy(_pos);
    // A turn about the vertical, the whole rotation: setting rotation.y alone
    // kept whatever x and z three had read out of the parked quaternion (π
    // and π past 90°), which mirrored the heading, so after the first night
    // it spun and drove off backwards.
    this.buggy.object3d.quaternion.setFromAxisAngle(_up, yaw);
    this.buggy.object3d.updateMatrixWorld(true);

    this._syncBody(this.buggy);
    this._syncBody(this.boot);
    this.socket?.syncAttached();

    const spin = this.logic.distance / BUGGY_SEND_OFF.wheelRadius;
    _axisQ.setFromAxisAngle(_xAxis, spin);
    for (let i = 0; i < this._wheels.length; i++) {
      this._wheels[i].quaternion.copy(this._wheelInitialQ[i]).multiply(_axisQ);
    }

    // The camera's heading follows the road's, the short way round.
    let d = (yaw - this._heading) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    this._heading += d * ease(BUGGY_SEND_OFF.headingRate, dt);
  }

  /** A fixed body written to its GameObject's world pose. */
  _syncBody(go) {
    if (!go?.rigidBody) return;
    go.object3d.updateMatrixWorld(true);
    go.object3d.getWorldPosition(_pos);
    go.object3d.getWorldQuaternion(_q);
    go.rigidBody.setTranslation({ x: _pos.x, y: _pos.y, z: _pos.z }, true);
    go.rigidBody.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
  }

  _updateCamera() {
    // Resizes only touch engine.camera, so the lens is copied each frame.
    const cam = this.engine.camera;
    this._viewCam.fov = cam.fov;
    this._viewCam.aspect = cam.aspect;
    this._viewCam.near = cam.near;
    this._viewCam.far = cam.far;
    this._viewCam.updateProjectionMatrix();

    _forward.set(Math.sin(this._heading), 0, Math.cos(this._heading));
    eagleView(this.buggy.object3d.position, _forward, _eagle);
    _lookMat.lookAt(_eagle.position, _eagle.target, _up);
    _eagleQ.setFromRotationMatrix(_lookMat);

    // Out of the player's eyes and up: place and turn together.
    const v = this.logic.view;
    this._viewCam.position.lerpVectors(this._eyeSnapPos, _eagle.position, v);
    this._viewCam.quaternion.slerpQuaternions(this._eyeSnapQuat, _eagleQ, v);
    this._viewCam.updateMatrixWorld(true);
  }

  _setLid(t) {
    if (this.lidPivot) this.lidPivot.rotation.x = BUGGY_CARGO.lidOpen * t;
  }

  /** Not playing: open in the morning, waiting for the box; shut otherwise. */
  _easeLidIdle(dt) {
    if (!this.lidPivot) return;
    const open = this.controller?.state === 'morning' && this.logic.phase === 'idle';
    const target = open ? BUGGY_CARGO.lidOpen : 0;
    const x = this.lidPivot.rotation.x;
    this.lidPivot.rotation.x = x + (target - x) * ease(BUGGY_SEND_OFF.lidRate, dt);
  }

  /** The player's view and controls back, as BedRest hands them back. */
  _handBack() {
    if (this.engine.viewCamera === this._viewCam) this.engine.viewCamera = null;
    this._viewCamActive = false;
    // The fly camera owns the player while it is out: it hands them back.
    if (!this.isFrozen()) {
      if (this.player) this.player.enabled = true;
      if (this.interaction) this.interaction.enabled = true;
    }
    this.interaction?.resetPrompt?.();
    this.engine.crosshair?.show?.();
    this.setPlayerLocked(false);
  }

  /** The screen is dark: the buggy has gone. */
  _onDark() {
    this._fading = false;
    this._handBack();
    // Out of sight until the evening: moved under the ground, never hidden
    // (the zone sort owns `visible`). The boot rides on it, so it goes too.
    this.buggy.object3d.position.y = -50;
    this.buggy.object3d.updateMatrixWorld(true);
    this._syncBody(this.buggy);
    this._syncBody(this.boot);
    this.socket?.syncAttached();
    this.engine.shadows?.invalidate();
    this.gate?.setOpen(0);
    this.controller.dispatch();
    this.logic.finish();
  }

  /** Every night start: the buggy back where it parks, lid and gate shut. */
  resetForNight() {
    const wasActive = this._viewCamActive;
    this.buggy.object3d.position.copy(this._buggyPos);
    this.buggy.object3d.quaternion.copy(this._buggyQuat);
    this.buggy.object3d.updateMatrixWorld(true);
    this._syncBody(this.buggy);
    this._syncBody(this.boot);
    this.socket?.syncAttached();
    for (let i = 0; i < this._wheels.length; i++) {
      this._wheels[i].quaternion.copy(this._wheelInitialQ[i]);
    }
    this._setLid(0);
    this.gate?.setOpen(0);
    this.engine.shadows?.invalidate();
    this.logic.reset();
    this._fading = false;
    if (wasActive) this._handBack();
  }

  onDestroy() {
    if (this.engine.viewCamera === this._viewCam) this.engine.viewCamera = null;
  }
}
