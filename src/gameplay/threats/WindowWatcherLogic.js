import * as THREE from 'three';
import { randRange } from '../../core/Random.js';

// ─────────────────────────────────────────────
// WindowWatcherLogic  –  night 2's rules, with no scene attached
// ─────────────────────────────────────────────
// A figure walks up to the office window, looks in, and walks away:
//
//   idle (25–45 s) → approach (8 s) → peer (5 s) → leave (4 s) → idle …
//
// About six visits in a 300 s night. While it peers in, a player who can be
// seen — in the office and not crouched under the desk — ends the night.
// It gives a short grace on arrival: the glass tap is the warning, and the
// grace is the time to act on it.
//
// Staring at it on the way in (within 10° of the view centre for 1.5 s)
// brings it straight to the glass: don't look at it.
//
// Everything the scene knows is injected — rand, isSeen(), lookAngle() —
// so this tests without physics, a camera or a DOM. WindowWatchers (the
// Threat) maps phase and progress onto the figure.
// ─────────────────────────────────────────────

/** Every number for night 2, in one place. Seconds and metres. */
export const WINDOW_WATCHERS = Object.freeze({
  idleMin: 25,
  idleMax: 45,
  approachTime: 8,
  peerTime: 5,
  leaveTime: 4,
  /** At the glass, before it looks: time to duck after the tap. */
  peerGrace: 0.6,
  lookHalfAngleDeg: 10,
  lookHold: 1.5,
  /** How far off the window's centre line it stands, either way. The
   *  opening is 8.5 m wide, so this keeps it framed by the glass. */
  glassSpread: 3,
  /** Where each walk starts: this far out from the glass … */
  farMin: 15,
  farMax: 20,
  /** … and this far to one side, so the path never crosses the dish. */
  farLateralMin: 5,
  farLateralMax: 9,
});

/** Guards phase ends against float drift in summed frame times. */
const EPS = 1e-9;

const _toPoint = new THREE.Vector3();

/** Angle between the view direction and the direction to `point`, radians.
 *  0 = dead centre, π = right behind. */
export function lookAngleTo(eye, forward, point) {
  _toPoint.subVectors(point, eye);
  if (_toPoint.lengthSq() === 0) return 0;
  return forward.angleTo(_toPoint);
}

export class WindowWatcherLogic {
  /** 'off' | 'idle' | 'approach' | 'peer' | 'leave' */
  phase = 'off';
  /** Seconds into the current phase. */
  timer = 0;
  /** Length of the current phase. */
  duration = 0;
  /** Visits finished since start(). */
  visits = 0;
  /** Caught the player this night; holds still until the next start(). */
  killed = false;

  /** This visit's spot at the glass (metres off the window centre) … */
  glassX = 0;
  /** … and where the walk starts: this far out, this far to the side. */
  farDistance = 0;
  farLateral = 0;

  /**
   * @param {object} [opts]
   * @param {() => number} [opts.rand]        0..1, seeded in the game
   * @param {() => boolean} [opts.isSeen]     in the office and not hidden
   * @param {() => number} [opts.lookAngle]   radians off the view centre
   * @param {() => void} [opts.onKill]
   * @param {(phase: string) => void} [opts.onPhase]  cues: sound, static
   * @param {typeof WINDOW_WATCHERS} [opts.tuning]
   */
  constructor({
    rand = Math.random, isSeen = () => false, lookAngle = () => Infinity,
    onKill = () => {}, onPhase = () => {}, tuning = WINDOW_WATCHERS,
  } = {}) {
    this.rand = rand;
    this.isSeen = isSeen;
    this.lookAngle = lookAngle;
    this.onKill = onKill;
    this.onPhase = onPhase;
    this.tuning = tuning;
    this._lookHalfAngle = THREE.MathUtils.degToRad(tuning.lookHalfAngleDeg);
    this._stare = 0;
  }

  /** The figure is out there to be seen. */
  get visible() {
    return this.phase === 'approach' || this.phase === 'peer' || this.phase === 'leave';
  }

  /** 0..1 through the walk: 0 far out, 1 at the glass (approach), and back
   *  out again (leave). 1 while peering. */
  get progress() {
    if (this.phase === 'peer') return 1;
    if (this.phase !== 'approach' && this.phase !== 'leave') return 0;
    return Math.min(1, this.timer / this.duration);
  }

  /** A fresh night: back to idle, nothing on the way. */
  start() {
    this.visits = 0;
    this.killed = false;
    this._enter('idle');
  }

  /** Off for the night: hidden, and nothing more happens. */
  stop() {
    this.phase = 'off';
    this.timer = 0;
  }

  update(dt) {
    if (this.phase === 'off' || this.killed) return;
    const T = this.tuning;
    this.timer += dt;

    switch (this.phase) {
      case 'idle':
        if (this._over()) this._next('approach');
        break;

      case 'approach':
        if (this.lookAngle() <= this._lookHalfAngle) {
          this._stare += dt;
          if (this._stare >= T.lookHold - EPS) { this._enter('peer'); break; }
        } else {
          this._stare = 0;
        }
        if (this._over()) this._next('peer');
        break;

      case 'peer':
        if (this.timer >= T.peerGrace - EPS && this.isSeen()) {
          this.killed = true;
          this.onKill();
          break;
        }
        if (this._over()) this._next('leave');
        break;

      case 'leave':
        if (this._over()) {
          this.visits++;
          this._next('idle');
        }
        break;
    }
  }

  // ── Private ──

  _over() { return this.timer >= this.duration - EPS; }

  /** Move on, carrying the overshoot so phase lengths don't drift with the
   *  frame rate. */
  _next(phase) {
    const carry = Math.max(0, this.timer - this.duration);
    this._enter(phase);
    this.timer = carry;
  }

  _enter(phase) {
    const T = this.tuning;
    this.phase = phase;
    this.timer = 0;
    this._stare = 0;
    switch (phase) {
      case 'idle':     this.duration = randRange(this.rand, T.idleMin, T.idleMax); break;
      case 'approach': this.duration = T.approachTime; this._pickPath(); break;
      case 'peer':     this.duration = T.peerTime; break;
      case 'leave':    this.duration = T.leaveTime; break;
    }
    this.onPhase(phase);
  }

  _pickPath() {
    const T = this.tuning;
    this.glassX      = randRange(this.rand, -T.glassSpread, T.glassSpread);
    this.farDistance = randRange(this.rand, T.farMin, T.farMax);
    const side       = this.rand() < 0.5 ? -1 : 1;
    this.farLateral  = side * randRange(this.rand, T.farLateralMin, T.farLateralMax);
  }
}
