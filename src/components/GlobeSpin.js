import * as THREE from 'three';
import { Interactable } from './Interactable.js';

// ─────────────────────────────────────────────
// GlobeSpin  –  [E] gives the desk globe a little spin on its stand
// ─────────────────────────────────────────────
// On the globe (`model:mars-globe`). The player looks at it and presses the
// interact key; it spins west to east about its own tilted axis and slows
// to a stop by itself. Nothing rides on it — it is something to fiddle
// with at the desk.
//
//   const globe = room._spawnProp('model:mars-globe', { … });
//   globe.addComponent(new GlobeSpin());
//
// Only the globe's turn changes: its body is fixed, and a ball looks the
// same to the physics and to the frozen shadow maps however it is turned.
// The stand is a separate model and never moves.
// ─────────────────────────────────────────────

/** The globe's polar axis in mars-globe.glb's own space, read off the mesh
 *  (its two poles): tilted 21° from upright, toward +x — the side the
 *  stand's arc is on. */
export const GLOBE_AXIS = [0.3563, 0.9344, 0];

const TWO_PI = Math.PI * 2;

export class GlobeSpin extends Interactable {
  promptLabel = '[E] Spin the globe';
  interactRange = 2.5;

  /** Radians a second, now. 0 at rest. */
  speed = 0;
  /** How far it has turned from where the room put it, radians. */
  angle = 0;

  /**
   * @param {object} [opts]
   * @param {number[]} [opts.axis=GLOBE_AXIS]  Spin axis, in the globe's own space
   * @param {number} [opts.kick=8]        Speed one push adds, rad/s
   * @param {number} [opts.friction=1.3]  How fast it loses speed, 1/s — a push carries it kick / friction radians, about a turn
   * @param {number} [opts.maxSpeed=16]   Top speed, however often it is pushed
   * @param {number} [opts.stopSpeed=0.08]  Below this it is at rest
   */
  constructor({ axis = GLOBE_AXIS, kick = 8, friction = 1.3, maxSpeed = 16, stopSpeed = 0.08 } = {}) {
    super();
    this.kick = kick;
    this.friction = friction;
    this.maxSpeed = maxSpeed;
    this.stopSpeed = stopSpeed;

    this._axis = new THREE.Vector3(...axis).normalize();
    this._turn = new THREE.Quaternion();
    /** The globe as the room turned it, before any spin. Read on the first
     *  push, once the room has placed it. @type {THREE.Quaternion|null} */
    this._rest = null;
  }

  get spinning() { return this.speed > 0; }

  onInteract() {
    this._rest ??= this.gameObject.object3d.quaternion.clone();
    this.speed = Math.min(this.maxSpeed, this.speed + this.kick);
  }

  onUpdate(dt) {
    if (this.speed === 0) return;

    this.angle = (this.angle + this.speed * dt) % TWO_PI;
    this.speed *= Math.exp(-this.friction * dt);
    if (this.speed < this.stopSpeed) this.speed = 0;

    this._turn.setFromAxisAngle(this._axis, this.angle);
    this.gameObject.object3d.quaternion.copy(this._rest).multiply(this._turn);
  }
}
