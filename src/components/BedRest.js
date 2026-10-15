import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { BedTransition } from '../gameplay/BedTransition.js';
import { PLAYER_BODY } from './PlayerBody.js';

// ─────────────────────────────────────────────
// BedRest  –  getting into and out of the bunk, on the camera (Component)
// ─────────────────────────────────────────────
// BedTransition holds the steps; this maps them onto the scene, the way
// SleepDemon maps SleepDemonDeath. There is no player body to animate, so
// it is the view: the camera's place, pitch and roll, and the
// FatigueOverlay's darkness (in bed) or eyelids (outside it).
//
//   lieDown(onAsleep)    from where you stand to the bunk's pillow, the
//                        darkness closing; onAsleep once it is fully down
//                        (a nap speeds the night up then, the morning
//                        sleep runs)
//   getUp(style, onUp)   'calm' or 'startled': the darkness lifts, sit up
//                        on the edge, stand beside the bunk
//                        (Bed.getOutSpot). Only then is the capsule
//                        teleported there, so the view hands back to the
//                        controller exactly where it is
//   cancel()             handed back at once, where the capsule stands
//
// For the whole animation the player is locked (setPlayerLocked) and its
// controller and interaction are off (no prompt, no crosshair), so nothing
// else writes the camera:
// the capsule stays where it stood by the bed while the camera, a child of
// it, is placed in the world. The bunk's views come from the Bed, so they
// follow the bunk if it moves.
//
// It runs on real time (engine.realDt): a nap hands the updates fifteen
// times the frame. A pause holds it (the engine stops updating, and it
// checks engine.paused besides), and so does the fly camera. A failed night
// or a finished run under it (any state but 'playing' or 'morning'), a
// retry, or the scene torn down (onDestroy) hand everything back.
//
// In bed the closed eyes are a darkened view, not black lids:
// `darkness` (0 … 1) is the strength, written to the FatigueOverlay's
// #bed-darkness layer. The real eyelids stay for fatigue blinks, nodding
// off and the Sleep Demon's death sequence.
// ─────────────────────────────────────────────

/** Metres above the floor the capsule's feet are put at when you get up,
 *  so it never starts a step touching the floor. */
const FEET_CLEAR = 0.02;

const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _parentQ = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

const lerp = (a, b, t) => a + (b - a) * t;
/** The shortest way round from yaw `a` to yaw `b`, `t` of the way. */
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** A view: where the eye is (world) and which way it looks. */
const view = () => ({ position: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0 });

export class BedRest extends Component {
  /**
   * @param {object} opts
   * @param {{ timeScale: number, realDt?: number, paused?: boolean }} opts.engine
   * @param {THREE.Camera|null} [opts.camera]
   * @param {{ enabled: boolean, yaw: number, pitch: number,
   *           teleport(centre: number[], facing: { yaw: number, pitch: number }): void }|null} [opts.player]
   *        The FirstPersonController.
   * @param {{ enabled: boolean }|null} [opts.interaction]  The InteractionSystem.
   * @param {{ set(tunnel: number, lid: number, darkness: number): void, clear(): void }|null} [opts.overlay]
   * @param {import('./Bed.js').Bed} opts.bed  The bunk's poses.
   * @param {{ state: string, onNightStart?: (fn: Function) => () => void }} opts.controller
   * @param {(locked: boolean) => void} [opts.setPlayerLocked]
   * @param {() => boolean} [opts.isFrozen]  The debug fly camera is on.
   * @param {import('../gameplay/BedTransition.js').BED_TRANSITION} [opts.tuning]
   * @param {() => number} [opts.rand]  When the demon's stretches come.
   */
  constructor({
    engine, camera = null, player = null, interaction = null, overlay = null, bed, controller,
    setPlayerLocked = () => {}, isFrozen = () => false, tuning, rand,
  }) {
    super();
    Object.assign(this, { engine, camera, player, interaction, overlay, bed, controller, setPlayerLocked, isFrozen });
    this.transition = new BedTransition({
      tuning, rand,
      onPhase: phase => this._onPhase(phase),
      onAsleep: () => { const fn = this._onAsleep; this._onAsleep = null; fn?.(); },
      onUp: () => this._up(),
    });
    this._views = { here: view(), lie: view(), sit: view(), out: view() };
    /** The camera's local position on the capsule as it was taken over. */
    this._cameraLocal = new THREE.Vector3();
    /** The eye's offset from the capsule's centre, world: where it will be
     *  once the capsule stands at the get-out spot. */
    this._eyeOffset = new THREE.Vector3();
    /** Where the capsule's centre goes when you get up. */
    this._outCentre = new THREE.Vector3();
    this._onAsleep = null;
    this._onUp = null;
    this._off = null;
  }

  /** Getting in, asleep or getting out. */
  get active() { return this.transition.active; }

  /** Lying with the darkness down. */
  get asleep() { return this.transition.asleep; }

  /** The demon's stretch is on: the night holds to real time, and the demon shows in the darkened view. */
  get peeking() { return this.transition.peeking; }

  /** The darkening's strength, 0 … 1: for a sound to follow. */
  get darkness() { return this.transition.lid; }

  /** Where the demon stands to watch a sleeper (the bunk's). */
  watchSpots() {
    return this.bed?.watchSpots?.() ?? [];
  }

  onStart() {
    this._off = this.controller.onNightStart?.((_, opts = {}) => {
      if (opts.retry) this.cancel();
    }) ?? null;
  }

  onDestroy() {
    this._off?.();
    this._off = null;
    this.cancel();
  }

  /**
   * Into bed.
   * @param {() => void} [onAsleep]  once the lids are shut
   * @returns {boolean} false while already in (or getting out of) bed
   */
  lieDown(onAsleep) {
    if (this.active) return false;
    this._takeOver();
    this._onAsleep = onAsleep ?? null;
    return this.transition.lieDown();
  }

  /**
   * Out of bed: from getting in, or asleep.
   * @param {'calm'|'startled'} [style]
   * @param {() => void} [onUp]  standing, the view handed back
   * @returns {boolean}
   */
  getUp(style = 'calm', onUp) {
    if (!this.transition.getUp(style)) return false;
    this._onAsleep = null;
    this._onUp = onUp ?? null;
    this._apply();
    return true;
  }

  /** Back to the player at once, where the capsule stands. Safe when idle. */
  cancel() {
    if (!this.active) return;
    this.transition.cancel();
    this._onAsleep = this._onUp = null;
    this._handBack(false);
  }

  onUpdate(dt) {
    if (!this.active) return;
    const state = this.controller.state;
    if (state !== 'playing' && state !== 'morning') return this.cancel();
    if (this.engine?.paused || this.isFrozen()) return;
    this.transition.update(this.engine?.realDt ?? dt);
    if (this.active) this._apply();
  }

  // FatigueEffects writes the lids in its update: these are written after.
  // In bed the darkness replaces the lids; outside it the lids run as usual.
  onLateUpdate() {
    if (!this.active || this.isFrozen()) return;
    if (this.asleep) this.overlay?.set(0, 0, this.transition.lid);
    else this.overlay?.set(0, this.transition.lid, 0);
  }

  // ── Private ──

  /** The player frozen and the camera ours: what it was, kept to give back. */
  _takeOver() {
    this.setPlayerLocked(true);
    if (this.player) this.player.enabled = false;
    if (this.interaction) this.interaction.enabled = false;
    // Nothing to use from bed: the prompt and the crosshair go.
    this.interaction?.resetPrompt?.();
    this.engine?.crosshair?.hide?.();
    const camera = this.camera;
    if (!camera) return;
    this._cameraLocal.copy(camera.position);
    const body = this.player?.gameObject?.object3d ?? camera.parent?.parent ?? camera.parent;
    camera.getWorldPosition(this._eyeOffset);
    if (body) this._eyeOffset.sub(body.getWorldPosition(_pos));
  }

  /** Each phase as it begins: the views it runs between. */
  _onPhase(phase) {
    if (phase === 'lyingDown') {
      this._snapshot(this._views.here);
      this._fromBed();
    } else if (phase === 'opening') {
      this._snapshot(this._views.here);
    }
  }

  /** The bunk's views, as they stand now. */
  _fromBed() {
    const { lie, sit, out } = this._views;
    copyView(lie, this.bed.pillowPose());
    copyView(sit, this.bed.sitPose());
    const spot = this.bed.getOutSpot();
    this._outCentre.copy(spot.position);
    this._outCentre.y += PLAYER_BODY.standHeight / 2 + FEET_CLEAR;
    out.position.copy(this._outCentre).add(this._eyeOffset);
    out.yaw = spot.yaw;
    out.pitch = 0;
    out.roll = 0;
  }

  /** Where the camera is now, world. */
  _snapshot(v) {
    const camera = this.camera;
    if (!camera) return;
    camera.getWorldPosition(v.position);
    _euler.setFromQuaternion(camera.getWorldQuaternion(_q), 'YXZ');
    v.pitch = _euler.x;
    v.yaw = _euler.y;
    v.roll = _euler.z;
  }

  /** This frame's view onto the camera: the world pose, through its parent. */
  _apply() {
    const camera = this.camera;
    if (!camera) return;
    const { from, to, t } = this.transition.pose;
    const a = this._views[from], b = this._views[to];
    _pos.lerpVectors(a.position, b.position, t);
    _euler.set(lerp(a.pitch, b.pitch, t), lerpAngle(a.yaw, b.yaw, t), lerp(a.roll, b.roll, t), 'YXZ');
    _q.setFromEuler(_euler);
    const parent = camera.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      parent.worldToLocal(_pos);
      _q.premultiply(parent.getWorldQuaternion(_parentQ).invert());
    }
    camera.position.copy(_pos);
    camera.quaternion.copy(_q);
  }

  /** Standing beside the bunk: the capsule put there, the view handed back. */
  _up() {
    const onUp = this._onUp;
    this._onUp = null;
    this._handBack(true);
    onUp?.();
  }

  /** The camera back on the capsule, the player's own again. `getOut`:
   *  the capsule teleported to the get-out spot first, facing the room. */
  _handBack(getOut) {
    // The fly camera owns the view and the player: it hands them back itself.
    if (!this.isFrozen()) {
      const ctrl = this.player;
      if (getOut && ctrl) {
        const c = this._outCentre;
        ctrl.teleport([c.x, c.y, c.z], { yaw: this._views.out.yaw, pitch: 0 });
      }
      const camera = this.camera;
      if (camera) {
        camera.position.copy(this._cameraLocal);
        camera.rotation.set(ctrl?.pitch ?? 0, ctrl?.yaw ?? 0, 0);
      }
      if (ctrl) ctrl.enabled = true;
      if (this.interaction) this.interaction.enabled = true;
    }
    this.interaction?.resetPrompt?.();
    this.engine?.crosshair?.show?.();
    this.overlay?.clear();
    this.setPlayerLocked(false);
  }
}

function copyView(v, { position, yaw = 0, pitch = 0, roll = 0 }) {
  v.position.copy(position);
  v.yaw = yaw;
  v.pitch = pitch;
  v.roll = roll;
}
