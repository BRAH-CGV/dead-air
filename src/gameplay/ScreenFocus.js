// ─────────────────────────────────────────────
// ScreenFocus  –  leaning in to a screen (#161)
// ─────────────────────────────────────────────
// Using a computer doesn't throw a panel over the view: the view leans in
// until the screen fills it, and what the computer shows is drawn on the
// screen itself. This is the pure side; ScreenView puts it on the camera
// and the overlay.
//
//   framePose(corners, { fov, aspect, fill })  where the camera stands to
//       frame a screen: on its normal, square to it, the screen filling
//       `fill` of the view in the tighter direction.
//   ScreenFocusMotion                          the lean in and back out:
//       `t` (0 the player's eye … 1 the screen, eased).
// ─────────────────────────────────────────────

import * as THREE from 'three';

export const SCREEN_FOCUS = {
  /** Seconds to lean in, and to lean back out. */
  inSeconds: 0.55,
  outSeconds: 0.4,
  /** Vertical field of view, degrees, once on the screen: narrower than
   *  the player's, so the camera stands back a little and the screen is
   *  seen nearly flat. */
  fov: 40,
  /** How much of the view the screen fills, in its tighter direction: the
   *  bezel shows round it. */
  fill: 0.92,
};

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _basis = new THREE.Matrix4();

/**
 * Where the camera stands to frame a screen.
 * @param {THREE.Vector3[]} corners  [tl, tr, br, bl], world, as the screen is
 *        read (its right runs tl → tr, its up bl → tl).
 * @param {{ fov: number, aspect: number, fill?: number }} view  fov in degrees
 * @param {{ position: THREE.Vector3, quaternion: THREE.Quaternion }} [out]
 */
export function framePose(corners, { fov, aspect, fill = SCREEN_FOCUS.fill },
  out = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }) {
  const [tl, tr, br, bl] = corners;
  const width = tl.distanceTo(tr);
  const height = tl.distanceTo(bl);
  _right.subVectors(tr, tl).normalize();
  _up.subVectors(tl, bl).normalize();
  _normal.crossVectors(_right, _up).normalize();
  _up.crossVectors(_normal, _right);   // square to the right, whatever the quad

  const tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const tanH = tanV * aspect;
  const distance = Math.max(height / (2 * tanV * fill), width / (2 * tanH * fill));

  out.position.copy(tl).add(tr).add(br).add(bl).multiplyScalar(0.25)
    .addScaledVector(_normal, distance);
  // A camera looks down its −z: its z axis is the screen's normal.
  out.quaternion.setFromRotationMatrix(_basis.makeBasis(_right, _up, _normal));
  return out;
}

const smoothstep = x => x * x * (3 - 2 * x);

export class ScreenFocusMotion {
  /** 'idle' | 'in' | 'on' | 'out' */
  phase = 'idle';
  /** Linear progress, 0 … 1. */
  _raw = 0;

  /** @param {Partial<typeof SCREEN_FOCUS>} [opts] */
  constructor(opts = {}) {
    this.opts = { ...SCREEN_FOCUS, ...opts };
  }

  /** Leaning in, out or on the screen: the camera is ours. */
  get active() { return this.phase !== 'idle'; }

  /** How far from the eye to the screen, eased. */
  get t() { return smoothstep(this._raw); }

  /** Lean in, from wherever the camera is now. */
  enter() {
    this.phase = this._raw >= 1 ? 'on' : 'in';
  }

  /** Lean back out, from wherever it is now. */
  leave() {
    if (this.phase === 'idle') return;
    this.phase = 'out';
  }

  /** Straight back to the eye, no lean. */
  cut() {
    this.phase = 'idle';
    this._raw = 0;
  }

  /** @returns {boolean} true on the frame it gets back out to the eye. */
  update(dt) {
    if (this.phase === 'in') {
      this._raw = Math.min(1, this._raw + dt / this.opts.inSeconds);
      if (this._raw >= 1) this.phase = 'on';
    } else if (this.phase === 'out') {
      this._raw = Math.max(0, this._raw - dt / this.opts.outSeconds);
      if (this._raw <= 0) {
        this.phase = 'idle';
        return true;
      }
    }
    return false;
  }
}
