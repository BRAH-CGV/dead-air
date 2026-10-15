import * as THREE from 'three';

// ─────────────────────────────────────────────
// RagnoGait  –  where Ragno's four feet are (pure)
// ─────────────────────────────────────────────
// A procedural walk: no clip. Each foot stays planted where it last came down
// until the body has carried its home spot too far from it, then steps there
// along an arc. Feet go in diagonal pairs (front-left with back-right), and a
// pair only lifts once the other pair is down, so it never stands on fewer
// than two. Faster bodies take quicker, shorter steps, so a dart blurs the
// legs instead of skating them.
//
// It works in whatever frame the body is in: its matrix places the homes, and
// `cast` finds the surface under each one along the body's own down. Floor,
// slope or wall: the same walk climbs.
//
//   const gait = new RagnoGait({ homes });        // rest foot spots, body-local
//   gait.reset(matrix, up, cast);                 // every foot planted
//   gait.update(dt, { matrix, velocity, up, stance, cast });
//   gait.feet[i]                                  // world position, for the IK
//   gait.footDowns                                // feet that landed this frame
//
// No scene, no model: RagnoFigure hands the feet to its IK.
// ─────────────────────────────────────────────

export const RAGNO_GAIT = {
  /** Metres a foot's home may get from it before it steps: at a creep, and
   *  at a dart (`dartSpeed` and over). */
  stepTrigger: 0.34,
  dartTrigger: 0.2,
  /** Seconds a step takes: at a standstill, and at `dartSpeed`. */
  stepSlow: 0.3,
  stepFast: 0.085,
  dartSpeed: 5,
  /** Metres the foot lifts at the top of its arc. */
  stepHeight: 0.22,
  /** Seconds of the body's velocity a step lands ahead of the home. */
  lead: 0.3,
  /** Metres from home past which a foot is re-planted at once (a teleport). */
  snap: 2.5,
  /** Metres above the home (along the body's up) the cast starts, and how far it looks. */
  castFrom: 1.2,
  castReach: 3,
  /** The thin stance at 1: the feet in to `across` of their spread, out to
   *  `along` of it, and the body raised `lift` metres to make up the reach. */
  thin: { across: 0.34, along: 1.25, lift: 0 },
};

/** Legs stepping together: front-left with back-right, front-right with
 *  back-left (indices into the homes, which RagnoFigure orders so). */
export const LEG_PAIRS = [[0, 3], [1, 2]];

/**
 * A foot's home at a stance: 0 wide (as rigged), 1 thin (to fit a door).
 * @param {number[]} home  Body-local [x, y, z].
 * @param {number} stance  0..1
 * @param {THREE.Vector3} out
 */
export function stanceHome(home, stance, out, tuning = RAGNO_GAIT) {
  const s = Math.min(Math.max(stance, 0), 1);
  const across = 1 + (tuning.thin.across - 1) * s;
  const along = 1 + (tuning.thin.along - 1) * s;
  return out.set(home[0] * across, home[1], home[2] * along);
}

const _home = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _down = new THREE.Vector3();
const _hit = new THREE.Vector3();

class Leg {
  constructor() {
    /** Where it stands while planted, or set off from while stepping. */
    this.planted = new THREE.Vector3();
    /** Where it is heading while stepping. */
    this.target = new THREE.Vector3();
    /** Where it is now: planted, or partway along its arc. */
    this.foot = new THREE.Vector3();
    /** 0..1 along the step; -1 while planted. */
    this.t = -1;
    /** Where it would like to be, this frame. */
    this.wanted = new THREE.Vector3();
    /** How far its home has wandered from it, this frame. */
    this.drift = 0;
  }

  get stepping() { return this.t >= 0; }
}

export class RagnoGait {
  /**
   * @param {object} opts
   * @param {number[][]} opts.homes  Each foot's rest spot, body-local [x, y, z],
   *        ordered front-left, back-left, front-right, back-right.
   * @param {typeof RAGNO_GAIT} [opts.tuning]
   */
  constructor({ homes, tuning = RAGNO_GAIT }) {
    this.homes = homes;
    this.tuning = tuning;
    this.legs = homes.map(() => new Leg());
    /** World positions of the feet, for the IK. */
    this.feet = this.legs.map(l => l.foot);
    /** Feet that came down this frame. */
    this.footDowns = 0;
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /** Feet off the ground. */
  get lifted() {
    let n = 0;
    for (const leg of this.legs) if (leg.stepping) n++;
    return n;
  }

  /** Seconds a step takes at `speed` m/s. */
  stepSeconds(speed) {
    const { stepSlow, stepFast, dartSpeed } = this.tuning;
    const k = Math.min(Math.abs(speed) / dartSpeed, 1);
    return stepSlow + (stepFast - stepSlow) * k;
  }

  /** Metres the body stands higher at a stance (the thin one reaches down). */
  bodyLift(stance) {
    return this.tuning.thin.lift * Math.min(Math.max(stance, 0), 1);
  }

  /** Every foot planted on its home: on spawning, or after a jump cut. */
  reset(matrix, up, cast, stance = 0) {
    this._up.copy(up);
    this.legs.forEach((leg, i) => {
      this._homeOf(i, matrix, null, stance, cast, leg.planted);
      leg.foot.copy(leg.planted);
      leg.t = -1;
    });
    this.footDowns = 0;
  }

  /**
   * @param {number} dt
   * @param {object} body
   * @param {THREE.Matrix4} body.matrix  The body's world matrix (its feet's frame).
   * @param {THREE.Vector3} body.velocity  World m/s.
   * @param {THREE.Vector3} body.up  The surface normal it stands on.
   * @param {number} [body.stance=0]  0 wide … 1 thin.
   * @param {(origin: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3) => boolean} body.cast
   *        The surface along `dir` from `origin`, into `out`; false if none.
   */
  update(dt, { matrix, velocity, up, stance = 0, cast }) {
    const { tuning } = this;
    this._up.copy(up);
    this.footDowns = 0;
    const speed = velocity.length();
    const k = Math.min(speed / tuning.dartSpeed, 1);
    const trigger = tuning.stepTrigger + (tuning.dartTrigger - tuning.stepTrigger) * k;
    const duration = this.stepSeconds(speed);

    // Where each foot would like to be, and how far it has drifted from it.
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i];
      this._homeOf(i, matrix, velocity, stance, cast, _home);
      leg.drift = leg.planted.distanceTo(_home);
      if (leg.drift > tuning.snap) {
        // Teleported: plant it there and then.
        leg.planted.copy(_home);
        leg.foot.copy(_home);
        leg.t = -1;
        leg.drift = 0;
        continue;
      }
      leg.wanted.copy(_home);
      // A step under way homes in on the moving spot.
      if (leg.stepping) leg.target.copy(_home);
    }

    // A pair lifts only once the other pair is down; a foot already halfway
    // to its trigger goes with its partner, so pairs stay in step.
    for (let p = 0; p < LEG_PAIRS.length; p++) {
      const pair = LEG_PAIRS[p];
      const other = LEG_PAIRS[1 - p];
      if (other.some(i => this.legs[i].stepping)) continue;
      if (pair.some(i => this.legs[i].stepping)) continue;
      const due = pair.some(i => this.legs[i].drift > trigger);
      if (!due) continue;
      // The pair further behind goes first.
      const mine = pair.reduce((s, i) => s + this.legs[i].drift, 0);
      const theirs = other.reduce((s, i) => s + this.legs[i].drift, 0);
      if (theirs > mine && other.some(i => this.legs[i].drift > trigger)) continue;
      for (const i of pair) {
        const leg = this.legs[i];
        if (leg.drift < trigger * 0.4) continue;
        leg.t = 0;
        leg.target.copy(leg.wanted);
      }
    }

    // Move the steps along their arcs.
    for (const leg of this.legs) {
      if (!leg.stepping) {
        leg.foot.copy(leg.planted);
        continue;
      }
      leg.t = Math.min(leg.t + dt / duration, 1);
      const s = leg.t * leg.t * (3 - 2 * leg.t);
      leg.foot.lerpVectors(leg.planted, leg.target, s)
        .addScaledVector(this._up, tuning.stepHeight * Math.sin(Math.PI * leg.t));
      if (leg.t >= 1) {
        leg.planted.copy(leg.target);
        leg.foot.copy(leg.planted);
        leg.t = -1;
        this.footDowns++;
      }
    }
    return this.footDowns;
  }

  /** Foot `i`'s home in the world: its stance spot under the body, led by
   *  the velocity, dropped onto the surface along the body's down. */
  _homeOf(i, matrix, velocity, stance, cast, out) {
    stanceHome(this.homes[i], stance, out, this.tuning).applyMatrix4(matrix);
    if (velocity) out.addScaledVector(velocity, this.tuning.lead);
    _origin.copy(out).addScaledVector(this._up, this.tuning.castFrom);
    _down.copy(this._up).negate();
    if (cast && cast(_origin, _down, _hit) && _hit.distanceTo(_origin) <= this.tuning.castReach) out.copy(_hit);
    return out;
  }
}
