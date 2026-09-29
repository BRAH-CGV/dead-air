import * as THREE from 'three';
import { Threat } from './Threat.js';
import { SleepDemonLogic, SLEEP_DEMON } from './SleepDemonLogic.js';
import { terrainHeightAt } from '../../gameobjects/MarsTerrain.js';

// ─────────────────────────────────────────────
// SleepDemon  –  night 1: it comes closer as you tire
// ─────────────────────────────────────────────
// SleepDemonLogic holds the rules; this maps them onto the scene:
//
//   stamina   ctx.stamina (StaminaDrain ticks it, the dispenser restores it)
//   stages    1–4 are room-local threatAnchors, read once per night through
//             each room's transform; 5 is behind the player, fixed at the
//             moment it steps there — turn round and it is standing there
//   in view   inside the camera's frustum, with a margin round the figure,
//             and within range. Walls are ignored: seeing where it could
//             be is enough to hold it. While the terminal's radar or review
//             screen is up the player is looking at that, not the room.
//
// The figure is a hidden, body-less GameObject the scene builds and owns.
// Ambiguous on purpose — the protagonist is an insomniac, and nothing it
// does can be told apart from a tired mind until it is too late.
// ─────────────────────────────────────────────

export const SLEEP_DEMON_KILL = 'You fell asleep. It was waiting.';

/** Stage → [room, anchor, stands outside]. Stage 0 is nowhere and 5 is
 *  computed from the player. */
const ANCHORS = [
  null,
  ['MainOffice', 'outsideWindow', true],
  ['LivingQuarters', 'corridorEnd', false],
  ['MainOffice', 'leftDoorway', false],
  ['MainOffice', 'cornerBehindDesk', false],
];

const _eye = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _look = new THREE.Vector3();
const _viewProj = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();

export class SleepDemon extends Threat {
  objective = "Stay awake: eat at the ration dispenser. Something comes closer as you tire, and it only moves when you aren't looking.";

  /**
   * @param {object} opts
   * @param {import('../../core/GameObject.js').GameObject} opts.figure
   * @param {number} [opts.height]  metres, for the in-view test
   * @param {typeof SLEEP_DEMON} [opts.tuning]
   */
  constructor({ figure, height = 2.2, tuning = SLEEP_DEMON }) {
    super();
    this.figure = figure;
    this.height = height;
    this.tuning = tuning;
    /** World spots for stages 1–5, filled by onStart and on the step to 5. */
    this._spots = ANCHORS.map(() => new THREE.Vector3());
    this._spots.push(new THREE.Vector3());
    this._hasSpot = this._spots.map(() => false);
    this.logic = new SleepDemonLogic({
      tuning,
      canSee: stage => this.canSee(stage),
      onKill: () => this.kill(SLEEP_DEMON_KILL),
      onMove: stage => this._onMove(stage),
    });
  }

  onStart() {
    this.logic.start();
    this.figure.object3d.visible = false;
    this._readAnchors();
  }

  onStop() {
    this.figure.object3d.visible = false;
  }

  update(dt) {
    this.logic.update(dt, this.ctx?.stamina?.value ?? 1);
    if (this.figure.object3d.visible) this._facePlayer();
  }

  /** Is where it would stand at `stage` in the player's view? */
  canSee(stage) {
    const camera = this.ctx?.engine?.camera;
    if (stage === 0 || !camera || this._onScreen()) return false;
    const spot = this._spotFor(stage);
    if (!spot) return false;

    camera.getWorldPosition(_eye);
    _sphere.center.copy(spot);
    _sphere.center.y += this.height / 2;
    _sphere.radius = this.height / 2 + this.tuning.viewMargin;
    if (_sphere.center.distanceTo(_eye) > this.tuning.viewRange) return false;

    _viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_viewProj);
    return _frustum.intersectsSphere(_sphere);
  }

  // ── Private ──

  /** The terminal's radar or review screen fills the view. */
  _onScreen() {
    const state = this.ctx?.scene?.terminal?.state;
    return !!state && state !== 'idle';
  }

  /** Stage 1–4 anchors in world space, once a night — rooms don't move. */
  _readAnchors() {
    const rooms = this.ctx?.rooms ?? {};
    for (let stage = 1; stage < ANCHORS.length; stage++) {
      const [roomName, anchor, outside] = ANCHORS[stage];
      const room = rooms[roomName];
      const local = room?.threatAnchors?.[anchor];
      this._hasSpot[stage] = !!local;
      if (!local) continue;
      room.root.object3d.updateWorldMatrix(true, false);
      const spot = this._spots[stage].set(...local).applyMatrix4(room.root.object3d.matrixWorld);
      if (outside) spot.y = terrainHeightAt(spot.x, spot.z);
    }
  }

  /** Where it stands at `stage`. Stage 5 is live until it steps there. */
  _spotFor(stage) {
    const last = this._spots.length - 1;
    if (stage === last && this.logic.stage !== last) return this._behindPlayer(this._spots[last]);
    return stage === last || this._hasSpot[stage] ? this._spots[stage] : null;
  }

  /** `behindDistance` behind the camera, level, feet on the ground. */
  _behindPlayer(target) {
    const camera = this.ctx?.engine?.camera;
    if (!camera) return null;
    camera.getWorldPosition(_eye);
    camera.getWorldDirection(_forward);
    _forward.y = 0;
    if (_forward.lengthSq() < 1e-8) _forward.set(0, 0, -1);
    _forward.normalize();
    target.copy(_eye).addScaledVector(_forward, -this.tuning.behindDistance);
    target.y = terrainHeightAt(target.x, target.z);
    return target;
  }

  _onMove(stage) {
    const o = this.figure.object3d;
    if (stage === 0) { o.visible = false; return; }
    const spot = stage === this._spots.length - 1
      ? this._behindPlayer(this._spots[stage])
      : this._spotFor(stage);
    if (!spot) { o.visible = false; return; }
    o.position.copy(spot);
    o.visible = true;
    this._facePlayer();
  }

  _facePlayer() {
    const camera = this.ctx?.engine?.camera;
    if (!camera) return;
    const o = this.figure.object3d;
    camera.getWorldPosition(_look);
    _look.y = o.position.y;
    o.lookAt(_look);
  }
}
