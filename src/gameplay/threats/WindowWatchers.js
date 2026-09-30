import * as THREE from 'three';
import { Threat } from './Threat.js';
import { WindowWatcherLogic, WINDOW_WATCHERS, lookAngleTo } from './WindowWatcherLogic.js';
import { terrainHeightAt } from '../../gameobjects/MarsTerrain.js';
import { makeRandom } from '../../core/Random.js';

// ─────────────────────────────────────────────
// WindowWatchers  –  night 2: something walks up to the office window
// ─────────────────────────────────────────────
// WindowWatcherLogic holds the rules; this maps them onto the scene:
//
//   seen      the player is in the MainOffice and their eye is not inside
//             its `underDesk` zone (a standing eye is above the desk top,
//             so being in the zone means crouched in the kneehole), and
//             the office is lit — with the power cut (BaseLights `dark`)
//             it only sees a player within DARK_SIGHT of the glass
//   stare     angle from the camera's view centre to the figure's head,
//             counted only from inside the office
//   the walk  from a point far out in the dust to `threatAnchors.windowGlass`
//             and back, both read room-local and taken through the office's
//             transform — nothing here knows where the office is
//
// It taps on the glass as it arrives to look in — the cue to hide.
//
// The figure is a hidden, body-less GameObject the scene builds and owns.
// ─────────────────────────────────────────────

export const WINDOW_WATCHER_KILL = 'Something saw you through the window.';

/** In a dark office it can still make out anyone this close to the glass (m). */
export const DARK_SIGHT = 2;

/** Same visits every run of night 2, until something reseeds it. */
const SEED = 0x2b0b;

const _eye = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _head = new THREE.Vector3();

export class WindowWatchers extends Threat {
  objective = "Something walks up to the window. When it looks in, hide under the desk or leave the office — it can't see far into a dark one. Don't stare at it.";

  /**
   * @param {object} opts
   * @param {import('../../core/GameObject.js').GameObject} opts.figure
   * @param {() => number} [opts.rand]
   * @param {number} [opts.headHeight]  where the eyes are, metres above its feet
   * @param {typeof WINDOW_WATCHERS} [opts.tuning]
   */
  constructor({ figure, rand = makeRandom(SEED), headHeight = 2.2, tuning = WINDOW_WATCHERS }) {
    super();
    this.figure = figure;
    this.headHeight = headHeight;
    // This visit's path in world space, fixed when it sets off.
    this._glass  = new THREE.Vector3();
    this._far    = new THREE.Vector3();
    this._lookIn = new THREE.Vector3();
    this._tap = { at: figure.object3d, volume: 0.9 };
    this.logic = new WindowWatcherLogic({
      rand, tuning,
      isSeen:    () => this.isSeen(),
      lookAngle: () => this.lookAngle(),
      onKill:    () => this.kill(WINDOW_WATCHER_KILL),
      onPhase:   phase => this._onPhase(phase),
    });
  }

  get office() { return this.ctx?.rooms?.MainOffice ?? null; }

  playerInOffice() {
    const office = this.office;
    return !!office && this.ctx?.transitions?.currentRoom === office;
  }

  /** The player's eye is in the kneehole under the desk. */
  isHidden() {
    const zone = this.office?.underDesk;
    const camera = this.ctx?.engine?.camera;
    if (!zone || !camera) return false;
    return zone.containsPoint(camera.getWorldPosition(_eye));
  }

  /** The office is dark and the player's eye is more than DARK_SIGHT back
   *  from the glass, measured room-local, straight in from the window. */
  isInDark() {
    const office = this.office;
    const camera = this.ctx?.engine?.camera;
    if (!this.ctx?.lights?.dark || !office || !camera) return false;
    camera.getWorldPosition(_eye);
    office.root.object3d.worldToLocal(_eye);
    return _eye.z - office.threatAnchors.windowGlass[2] > DARK_SIGHT;
  }

  isSeen() { return this.playerInOffice() && !this.isHidden() && !this.isInDark(); }

  /** Radians between the view centre and the figure's head; Infinity when
   *  the player isn't in the office to see it through the glass. */
  lookAngle() {
    const camera = this.ctx?.engine?.camera;
    if (!camera || !this.playerInOffice()) return Infinity;
    camera.getWorldPosition(_eye);
    camera.getWorldDirection(_forward);
    this.figure.object3d.getWorldPosition(_head);
    _head.y += this.headHeight;
    return lookAngleTo(_eye, _forward, _head);
  }

  onStart() {
    this.figure.object3d.visible = false;
    this.logic.start();
  }

  onStop() {
    this.logic.stop();
    this.figure.object3d.visible = false;
  }

  update(dt) {
    this.logic.update(dt);
    this._place();
  }

  // ── Private ──

  _onPhase(phase) {
    if (phase === 'approach') this._pickPoints();
    if (phase === 'peer') this.ctx?.audio?.play('sfx:glass-tap', this._tap);
    this.figure.object3d.visible = this.logic.visible;
  }

  /** The logic picked a path in metres off the window; turn it into world
   *  points once, so the walk itself only lerps. */
  _pickPoints() {
    const office = this.office;
    if (!office) return;
    const { glassX, farLateral, farDistance } = this.logic;
    const [ax, , az] = office.threatAnchors.windowGlass;
    office.root.object3d.updateWorldMatrix(true, false);
    const m = office.root.object3d.matrixWorld;

    // The window is in the back wall, so "out" is room-local −Z.
    this._glass.set(ax + glassX, 0, az).applyMatrix4(m);
    this._far.set(ax + glassX + farLateral, 0, az - farDistance).applyMatrix4(m);
    this._lookIn.set(ax + glassX, 0, az + 1).applyMatrix4(m);
    // Feet on the ground. The walk lerps between the two ends, which is
    // exact on the flat pad round the base, where every walk stays.
    this._glass.y  = terrainHeightAt(this._glass.x, this._glass.z);
    this._far.y    = terrainHeightAt(this._far.x, this._far.z);
    this._lookIn.y = this._glass.y;
  }

  _place() {
    const { logic } = this;
    if (!logic.visible) return;
    const o = this.figure.object3d;
    switch (logic.phase) {
      case 'approach':
        o.position.lerpVectors(this._far, this._glass, logic.progress);
        o.lookAt(logic.progress < 1 ? this._glass : this._lookIn);
        break;
      case 'peer':
        o.position.copy(this._glass);
        o.lookAt(this._lookIn);
        break;
      case 'leave':
        o.position.lerpVectors(this._glass, this._far, logic.progress);
        o.lookAt(logic.progress < 1 ? this._far : this._lookIn);
        break;
    }
  }
}
