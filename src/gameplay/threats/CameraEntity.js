import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { Threat } from './Threat.js';
import { CAMERA_ENTITY, CameraSweep, CameraExposure, inCone, turnToward } from './CameraEntityLogic.js';

// ─────────────────────────────────────────────
// CameraEntity  –  night 3: the camera in the server room
// ─────────────────────────────────────────────
// CameraEntityLogic holds the rules; this maps them onto the ServerRoom:
//
//   the rig     `securityCamera`, swept between its `minYaw` and `maxYaw`
//   seen        the player's eye is in the room's `sightline` (the aisle),
//               inside the view cone from the lens, and the ray from the
//               lens to the eye hits nothing solid — racks are the cover
//   lock-on     past 0.6 exposure the sweep waits and the rig turns to
//               follow the eye until exposure has decayed away
//
// Night 3 is also when saved signals have to be stored at the console in
// this room (SignalManager storage), which is what brings the player in.
// ─────────────────────────────────────────────

export const CAMERA_ENTITY_KILL = 'The camera found you.';

/** The line of sight stops this short of the eye, so a wall the player is
 *  pressed against doesn't count as cover. */
const EYE_CLEARANCE = 0.3;

const _eye = new THREE.Vector3();
const _lens = new THREE.Vector3();
const _view = new THREE.Vector3();
const _local = new THREE.Vector3();
const _rayFrom = new THREE.Vector3();
const _rayDir = new THREE.Vector3();

export class CameraEntity extends Threat {
  objective = 'Store saved signals at the server console. Its camera watches the aisle: time the sweep, or keep behind the racks.';

  /**
   * @param {object} [opts]
   * @param {(from: THREE.Vector3, to: THREE.Vector3) => boolean} [opts.isOccluded]
   *        replaces the physics ray (tests)
   * @param {typeof CAMERA_ENTITY} [opts.tuning]
   */
  constructor({ isOccluded, tuning = CAMERA_ENTITY } = {}) {
    super();
    this.tuning = tuning;
    if (isOccluded) this.isOccluded = isOccluded;
    this.sweep = null;
    this.exposure = new CameraExposure({ tuning, onKill: () => this.kill(CAMERA_ENTITY_KILL) });
    this._ray = null;
  }

  get room() { return this.ctx?.rooms?.ServerRoom ?? null; }
  get rig() { return this.room?.securityCamera ?? null; }

  onStart() {
    const rig = this.rig;
    this.exposure.start();
    if (!rig) return;
    this.sweep ??= new CameraSweep({
      minYaw: rig.minYaw, maxYaw: rig.maxYaw,
      sweepTime: this.tuning.sweepTime, pauseTime: this.tuning.pauseTime,
    });
    this.sweep.reset();
    rig.setCone(this.tuning.range, this.tuning.halfAngle);
    rig.yaw = this.sweep.yaw;
    rig.tilt = rig.restTilt;
    rig.setActive(true);
  }

  onStop() {
    const rig = this.rig;
    if (!rig) return;
    rig.setActive(false);
    rig.yaw = rig.minYaw;
    rig.tilt = rig.restTilt;
  }

  update(dt) {
    const rig = this.rig;
    const camera = this.ctx?.engine?.camera;
    if (!this.active || !rig || !camera || !this.sweep) return;

    camera.getWorldPosition(_eye);
    this.exposure.update(dt, this.canSee(_eye));

    let yaw, tilt;
    if (this.exposure.locked) {
      yaw = this.yawTo(_eye);
      tilt = this._tiltTo(_eye);
    } else {
      this.sweep.update(dt);
      yaw = this.sweep.yaw;
      tilt = rig.restTilt;
    }
    const step = this.tuning.turnRate * dt;
    rig.yaw = turnToward(rig.yaw, yaw, step);
    rig.tilt = turnToward(rig.tilt, tilt, step);
    rig.setAlert(this.exposure.exposure);
  }

  /** In the aisle, in the cone, and nothing solid between. The cheap tests
   *  first: the ray is only cast for a player the camera could see. */
  canSee(eye) {
    const { room, rig } = this;
    if (!room?.sightline?.containsPoint(eye)) return false;
    rig.getLensPosition(_lens);
    rig.getLensDirection(_view);
    if (!inCone(_lens, _view, eye, this.tuning.halfAngle, this.tuning.range)) return false;
    return !this.isOccluded(_lens, eye);
  }

  /** Solid colliders between the two points, sensors (open doorways) and
   *  the player's own body ignored. Nothing is in the way without a
   *  physics world. */
  isOccluded(from, to) {
    const engine = this.ctx?.engine;
    const world = engine?.world;
    if (!world?.castRay) return false;
    _rayDir.subVectors(to, from);
    const dist = _rayDir.length();
    if (dist <= EYE_CLEARANCE) return false;
    _rayDir.divideScalar(dist);
    _rayFrom.copy(from);
    this._ray ??= new RAPIER.Ray(_rayFrom, _rayDir);   // holds the two vectors by reference
    const player = this.ctx?.player?.rigidBody ?? engine.player?.rigidBody;
    const hit = world.castRay(
      this._ray, dist - EYE_CLEARANCE, true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, player,
    );
    return !!hit;
  }

  /** The yaw that points the rig at a world point. */
  yawTo(point) {
    this._toRig(point);
    return Math.atan2(_local.x, _local.z);
  }

  // ── Private ──

  _tiltTo(point) {
    this._toRig(point);
    return Math.atan2(-_local.y, Math.hypot(_local.x, _local.z));
  }

  /** A world point in the rig's own frame, where its pivot is the origin. */
  _toRig(point) {
    const o = this.rig.object3d;
    o.updateWorldMatrix(true, false);
    return o.worldToLocal(_local.copy(point));
  }
}
