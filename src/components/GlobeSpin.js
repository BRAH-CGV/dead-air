import * as THREE from 'three';
import { Interactable } from './Interactable.js';
import { createCheeseBall } from '../gameobjects/CheeseBall.js';

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
//
// Mashed (#169): every push that lands while it is already near top speed
// winds up a strain that wears off by itself. Mash long enough — a few
// seconds — and the globe becomes a ball of cheese (CheeseBall) the same
// size, which pops in and spins on as the globe did, for the rest of the
// run. The ball is built hidden on awake, so its shader is compiled with
// the scene rather than on the moment it appears.
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
  /** Pushes so far, at top speed too: what its sound (GlobeSound) follows. */
  pushes = 0;
  /** How wound up it is from being mashed; wears off at `strainDecay`. */
  strain = 0;
  /** Whether it has become a ball of cheese. */
  cheese = false;

  /**
   * @param {object} [opts]
   * @param {number[]} [opts.axis=GLOBE_AXIS]  Spin axis, in the globe's own space
   * @param {number} [opts.kick=8]        Speed one push adds, rad/s
   * @param {number} [opts.friction=1.3]  How fast it loses speed, 1/s — a push carries it kick / friction radians, about a turn
   * @param {number} [opts.maxSpeed=16]   Top speed, however often it is pushed
   * @param {number} [opts.stopSpeed=0.08]  Below this it is at rest
   * @param {number} [opts.strainFrom=0.75]  A push strains it only when it is already past this share of top speed
   * @param {number} [opts.strainDecay=1.5]  Strain worn off a second
   * @param {number} [opts.cheeseAt=20]  Strain at which it turns to cheese: about 3 s of mashing at 8 presses a second
   * @param {number} [opts.radius=0.143]  The globe's radius, metres: the cheese's
   * @param {number} [opts.popSeconds=0.35]  How long the cheese takes to pop in
   */
  constructor({
    axis = GLOBE_AXIS, kick = 8, friction = 1.3, maxSpeed = 16, stopSpeed = 0.08,
    strainFrom = 0.75, strainDecay = 1.5, cheeseAt = 20, radius = 0.143, popSeconds = 0.35,
  } = {}) {
    super();
    this.kick = kick;
    this.friction = friction;
    this.maxSpeed = maxSpeed;
    this.stopSpeed = stopSpeed;
    this.strainFrom = strainFrom;
    this.strainDecay = strainDecay;
    this.cheeseAt = cheeseAt;
    this.radius = radius;
    this.popSeconds = popSeconds;

    this._axis = new THREE.Vector3(...axis).normalize();
    this._turn = new THREE.Quaternion();
    /** The globe as the room turned it, before any spin. Read on the first
     *  push, once the room has placed it. @type {THREE.Quaternion|null} */
    this._rest = null;
    /** The cheese, built hidden on awake. @type {THREE.Group|null} */
    this._ball = null;
    /** Seconds into the cheese's pop; null when not popping. */
    this._pop = null;
  }

  get spinning() { return this.speed > 0; }

  onAwake() {
    this._buildBall();
  }

  onInteract() {
    this._rest ??= this.gameObject.object3d.quaternion.clone();
    if (this.speed >= this.strainFrom * this.maxSpeed) this.strain++;
    this.speed = Math.min(this.maxSpeed, this.speed + this.kick);
    this.pushes++;
    if (!this.cheese && this.strain >= this.cheeseAt) this._becomeCheese();
  }

  onUpdate(dt) {
    this.strain = Math.max(0, this.strain - this.strainDecay * dt);
    if (this._pop !== null) this._popIn(dt);
    if (this.speed === 0) return;

    this.angle = (this.angle + this.speed * dt) % TWO_PI;
    this.speed *= Math.exp(-this.friction * dt);
    if (this.speed < this.stopSpeed) this.speed = 0;

    this._turn.setFromAxisAngle(this._axis, this.angle);
    this.gameObject.object3d.quaternion.copy(this._rest).multiply(this._turn);
  }

  onDestroy() {
    this._ball?.removeFromParent();
    this._ball?.dispose();
    this._ball = null;
  }

  _buildBall() {
    if (this._ball) return;
    this._ball = createCheeseBall({ radius: this.radius });
    this._ball.visible = false;
    this.gameObject.object3d.add(this._ball);
  }

  /** The globe's own model goes, the cheese pops in where it was. */
  _becomeCheese() {
    this._buildBall();
    this.cheese = true;
    this.promptLabel = '[E] Spin the cheese';
    for (const child of this.gameObject.object3d.children) {
      if (child !== this._ball) child.visible = false;
    }
    this._ball.visible = true;
    this._ball.scale.setScalar(0);
    this._pop = 0;
    this._redrawShadows();
  }

  /** Grows from nothing, overshoots a little and settles on its size. */
  _popIn(dt) {
    this._pop = Math.min(this.popSeconds, this._pop + dt);
    const t = this._pop / this.popSeconds;
    // easeOutBack: past 1 near the end, landing exactly on 1.
    const c = 2.2;
    const s = 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
    this._ball.scale.setScalar(s);
    if (t >= 1) {
      this._pop = null;
      this._redrawShadows();
    }
  }

  _redrawShadows() {
    this.gameObject?.scene?.userData?.engine?.shadows?.invalidate();
  }
}
