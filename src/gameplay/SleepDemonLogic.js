// ─────────────────────────────────────────────
// SleepDemonLogic  –  the Sleep Demon's rules, with no scene attached
// ─────────────────────────────────────────────
// It lives in the corner of the player's eye, and it never teleports. Once
// stamina drops below `appearBelow` it is about: a few seconds later it
// fades in (slowly — the scene's fadeIn) in the periphery, or, by the roll
// (behindChance), behind the player. Where it showed it stays. It moves
// only while nobody looks at it, and slowly: then, and only then, its
// footsteps are heard.
//
//   stamina      0.85 ──────────── 0.5 ──────────── 0.1 ──── 0.05 ── 0.01 ── 0
//   presence     barely there (faintest) ─▶ solid by 0.3
//   look cone    50° ────────────────────────────▶ 15° │ no longer fades
//   seen                fades away from a look         │ stares │ walks in
//   unseen       creeps in, very slowly at first, quicker as the player tires
//   face                                                        smiles ─▶ the kill
//
// Looked at — any of it within the frame's look cone of the centre of the
// view (focusAngleFor) — it fades away where it stood, and fades in again
// `goneFor` later on the other side. It always shows outside the cone, so
// it only ever appears where the eye isn't quite looking. Below `holdBelow`
// it no longer fades from a look; below `walkBelow` it walks in on the
// player, seen or not. At `smileBelow` it smiles, and keeps it through the
// kill. At empty it takes the player.
//
// Unseen — turned away from, out of the frustum, or the terminal's screen
// up — it creeps (sneakSpeedFor), no nearer than creepFloorFor(stamina):
// while the player is fresh it keeps its distance. A banishing look gives
// the ground it crept back. Shut out (a wall between them, the player gone
// to another room) for `stuckAfter`, it fades in somewhere new, near them.
//
// While the view is covered (the terminal) a figure standing in view slips
// round out of sight, beside or behind the player, at the ambush's nearer
// distances (ambushDistanceFar/Near) — closing the screen may find it right
// behind them.
//
// The scene is injected: lookAngle() says where the view is from it,
// place() fades it in at a spot, approach() steps it in, hide() fades it
// away. SleepDemon (the component) maps them onto the camera, the physics
// and the figure.
// ─────────────────────────────────────────────

const DEG = Math.PI / 180;

export const SLEEP_DEMON = Object.freeze({
  /** It is about once stamina is below this. */
  appearBelow: 0.85,
  /** Metres from the player's eye it first shows … */
  farthest: 10,
  /** … and at empty. */
  nearest: 0.8,
  /** How far out from the centre of the view it shows, as a share of the
   *  view's half-width — but always at least `showMargin` outside the look
   *  cone, so it never fades in where the eye is already looking. */
  edgeFar: 0.95,
  edgeNear: 0.5,
  showMargin: 4 * DEG,
  /** The look cone, radians off the centre of the view: 50° at 85 %
   *  stamina, closing to 15° at `holdBelow` (10 %). */
  focusFar: 50 * DEG,
  focusNear: 15 * DEG,
  /** Below this it no longer fades from a look: it stands, and stares. */
  holdBelow: 0.10,
  /** Below this it walks in on the player, seen or not. */
  walkBelow: 0.05,
  /** At or below this it smiles, and keeps it through the kill. */
  smileBelow: 0.01,
  /** Seconds it stays gone after a look: when it first shows, and at empty. */
  goneFar: 6,
  goneNear: 1,
  /** Seconds to fade in wherever it shows, and to fade away from a look
   *  (SleepDemon reads them). */
  fadeIn: 2.5,
  fadeOut: 0.6,
  /** How there it is (its opacity, 0 … 1): `faintest` down to `faintAbove`
   *  — elusive, barely noticeable, but there — then solid by `solidBelow`. */
  faintest: 0.25,
  faintAbove: 0.5,
  solidBelow: 0.3,
  /** Metres a second it creeps while unseen: when it first shows … at empty. */
  sneakFar: 0.08,
  sneakNear: 0.35,
  /** The nearest it creeps unseen, metres from the eye: when it first
   *  shows … at empty (stareFloor). */
  creepFloorFar: 5,
  /** Shut out — unseen and unable to step in — this many seconds, it fades
   *  in somewhere new. */
  stuckAfter: 5,
  /** Seconds before it tries again when neither side had room. */
  retryAfter: 0.25,
  /** Metres it keeps clear of a wall or a prop in the way (SleepDemon). */
  wallGap: 0.45,
  /** Less room than this and it doesn't show on that side (SleepDemon). */
  minDistance: 0.6,
  /** It moves on its own at all: the creep, and the walk-in below
   *  walkBelow. Off, it only shows, stands and fades. */
  stareDown: true,
  /** Metres a second it walks in, seen, below walkBelow. */
  stareSpeed: 0.12,
  /** Metres from the eye it walks in to: arm's length. */
  stareFloor: 0.5,
  /** The share of the player's retreat a step takes up: it follows a
   *  backing player, but they gain ground. */
  stareFollow: 0.5,
  /** Dead air (duckFor): the world's sound, as a share of its level, with
   *  it standing where it showed … */
  duckEdge: 0.7,
  /** … and at the look. Near-silence, not a mute. */
  duckFloor: 0.06,
  /** Out of sight it stands this far round, as a share of the view's
   *  half-width (past 1 is out of view): beside the player when it first
   *  shows, behind them at empty. */
  ambushEdgeFar: 1.6,
  ambushEdgeNear: 2.8,
  /** … and this near, metres. */
  ambushDistanceFar: 6,
  ambushDistanceNear: 1.2,
  /** The share of showings that land behind the player rather than in the
   *  periphery. */
  behindChance: 0.35,
});

const clamp01 = x => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * How near it is: 0 until it shows, 1 at empty.
 * @param {number} stamina  0 … 1
 */
export function closenessFor(stamina, { appearBelow } = SLEEP_DEMON) {
  return clamp01(1 - stamina / appearBelow);
}

/**
 * The look cone, radians off the centre of the view: `focusFar` (50°) until
 * it shows, closing to `focusNear` (15°) at the hold.
 * @param {number} stamina  0 … 1
 */
export function focusAngleFor(stamina, { appearBelow, holdBelow, focusFar, focusNear } = SLEEP_DEMON) {
  return lerp(focusFar, focusNear, clamp01((appearBelow - stamina) / (appearBelow - holdBelow)));
}

/**
 * How there it is, 0 … 1: faint down to half stamina, solid by `solidBelow`.
 * @param {number} stamina  0 … 1
 */
export function presenceFor(stamina, { faintest, faintAbove, solidBelow } = SLEEP_DEMON) {
  return lerp(faintest, 1, clamp01((faintAbove - stamina) / (faintAbove - solidBelow)));
}

/**
 * Metres a second it creeps while unseen.
 * @param {number} stamina  0 … 1
 */
export function sneakSpeedFor(stamina, t = SLEEP_DEMON) {
  return lerp(t.sneakFar, t.sneakNear, closenessFor(stamina, t));
}

/**
 * The nearest it creeps unseen, metres from the eye.
 * @param {number} stamina  0 … 1
 */
export function creepFloorFor(stamina, t = SLEEP_DEMON) {
  return lerp(t.creepFloorFar, t.stareFloor, closenessFor(stamina, t));
}

/**
 * The angle (radians) between a line of sight and the nearest point of
 * something standing upright: 0 when the view runs anywhere along it, feet
 * to crown. Plain {x, y, z} objects, so THREE.Vector3s do.
 * @param {{x:number,y:number,z:number}} eye
 * @param {{x:number,y:number,z:number}} forward  unit length
 * @param {{x:number,y:number,z:number}} feet
 * @param {number} height
 */
export function angleToUpright(eye, forward, feet, height) {
  const dx = feet.x - eye.x;
  const dz = feet.z - eye.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return 0;
  // Over the heights u along it (from the eye's height), the cosine of the
  // angle is (d·a + b·u) / √(d² + u²): highest at an end, or where it turns,
  // u = b·d / a.
  const a = (forward.x * dx + forward.z * dz) / d;
  const b = forward.y;
  const lo = feet.y - eye.y;
  const hi = lo + height;
  const cos = u => (d * a + b * u) / Math.hypot(d, u);
  let best = Math.max(cos(lo), cos(hi));
  if (a !== 0) {
    const u = (b * d) / a;
    if (u > lo && u < hi) best = Math.max(best, cos(u));
  }
  return Math.acos(Math.min(1, Math.max(-1, best)));
}

/**
 * Dead air: how loud the world should be, as a share of its level (1 is
 * untouched), with the view `angle` radians off it. Mild where it showed,
 * `shownAt` radians off the centre of the view, falling to the floor at the
 * look (focusAngle). Linear in level, so the drop in loudness steepens as
 * the view closes in. Infinity (out of view): nothing. null (the terminal
 * covers the view): it is still there, but the view is on the screen, not
 * coming round to it, so the mild duck holds — the room neither dies nor
 * comes back while the player works.
 * @param {number|null} angle  lookAngle()
 * @param {number} shownAt  radians
 * @param {number} focusAngle  radians — the frame's focusAngleFor
 */
export function duckFor(angle, shownAt, focusAngle, { duckEdge, duckFloor } = SLEEP_DEMON) {
  if (angle === null) return duckEdge;
  if (!Number.isFinite(angle)) return 1;
  if (angle <= focusAngle) return duckFloor;
  if (shownAt <= focusAngle) return duckEdge;
  return lerp(duckEdge, duckFloor, clamp01((shownAt - angle) / (shownAt - focusAngle)));
}

export class SleepDemonLogic {
  /** Stamina is low enough for it to be about. */
  around = false;
  /** Placed: fading in, or standing there. */
  shown = false;
  /** 0 when it first shows … 1 at empty. */
  closeness = 0;
  /** How there it is, 0 … 1 (presenceFor): the scene's opacity. */
  presence = 0;
  /** Smiling: from smileBelow, through the kill. */
  smiling = false;
  /** Where it shows next: +1 right of the view, −1 left. */
  side = 1;
  /** Metres from the player's eye it stands, as last placed or stepped in. */
  distance = Infinity;
  /** 0 until the walk-in starts … 1 at arm's length. For a sound. */
  closingIn = 0;
  /** Walking in, seen, this frame (below walkBelow): the scene slows the
   *  player down. */
  walking = false;
  /** Creeping in unseen this frame: the scene plays its footsteps. */
  sneaking = false;
  /** Standing out of sight: behind the player, or round the terminal. */
  ambush = false;
  /** This frame's look cone, radians (focusAngleFor). */
  focus = SLEEP_DEMON.focusFar;

  /**
   * @param {object} [opts]
   * @param {() => number|null} [opts.lookAngle]  radians from the centre of the
   *        view; Infinity out of view, null while the view is covered
   * @param {(spot: {distance: number, side: number, edge: number, focus: number, ambush?: boolean}) => boolean} [opts.place]
   *        fades it in at a spot (ambush: out of sight); false: no room there
   * @param {() => void} [opts.hide]  fades it away
   * @param {() => void} [opts.onKill]
   * @param {() => number} [opts.rand]
   * @param {typeof SLEEP_DEMON} [opts.tuning]
   * @param {(step: number, unseen?: boolean) => number|false} [opts.approach]  steps it
   *        `step` metres in toward the eye; the metres it then stands off, or
   *        false when it couldn't step there. unseen: the spot need not be in view.
   * @param {() => number} [opts.playerDrift]  metres the player's eye has
   *        backed away this frame, along the line to it
   */
  constructor({
    lookAngle = () => Infinity, place = () => true, hide = () => {}, onKill = () => {},
    rand = Math.random, tuning = SLEEP_DEMON,
    approach = () => false, playerDrift = () => 0,
  } = {}) {
    Object.assign(this, { lookAngle, place, hide, onKill, rand, tuning });
    this.approach = approach;
    this.playerDrift = playerDrift;
    this.start();
  }

  /** A new or retried night: away, nothing counted. */
  start() {
    this.around = false;
    this.shown = false;
    this.closeness = 0;
    this.presence = 0;
    this.smiling = false;
    this.side = this._anySide();
    this.ambush = false;
    this._gone = 0;
    this._stuck = 0;
    this._crept = false;
    this._killed = false;
    this.distance = Infinity;
    this._endWalk();
  }

  /** @param {number} dt @param {number} stamina  0 … 1 */
  update(dt, stamina) {
    if (this._killed) return;
    this.walking = false;
    this.sneaking = false;
    const t = this.tuning;
    if (stamina <= 0) {
      this._killed = true;
      this.smiling = true;
      this.onKill();
      return;
    }
    this.smiling = stamina <= t.smileBelow;
    if (stamina >= t.walkBelow) this._endWalk();
    if (stamina >= t.appearBelow) {
      this._vanish();
      this.around = false;
      this.closeness = 0;
      this.presence = 0;
      return;
    }
    if (!this.around) {
      this.around = true;
      this._gone = this._goneFor(stamina);
    }
    this.closeness = closenessFor(stamina, t);
    this.focus = focusAngleFor(stamina, t);
    this.presence = presenceFor(stamina, t);

    if (this.shown) {
      const angle = this.lookAngle();
      if (Number.isFinite(angle)) {
        // Seen.
        this._stuck = 0;
        if (angle < this.focus && stamina >= t.holdBelow) {
          this._vanish();
          this.side = -this.side;
          this._gone = this._goneFor(stamina);
          return;
        }
        if (stamina < t.walkBelow) this._walkIn(dt);
      } else if (angle === null && !this.ambush) {
        // The view just covered: it slips round out of sight, now.
        this.shown = false;
        this._gone = 0;
      } else {
        // Unseen: it creeps. Shut out for long enough, it finds them anew.
        if (this._creep(dt, stamina) === false) this._stuck += dt;
        else this._stuck = 0;
        if (this._stuck >= t.stuckAfter) {
          this._stuck = 0;
          this.shown = false;
          this._gone = 0;
        }
      }
    }
    if (!this.shown && (this._gone -= dt) <= 0) this._show();
  }

  // ── Private ──

  _show() {
    const { closeness: c, tuning: t } = this;
    const spot = { distance: lerp(t.farthest, t.nearest, c), edge: lerp(t.edgeFar, t.edgeNear, c), focus: this.focus };
    // Nobody is watching that way — the screen covers the view, or the roll
    // sends it round behind the player.
    const covered = this.lookAngle() === null;
    const ambush = covered || this.rand() < t.behindChance;
    if (ambush) Object.assign(spot, {
      distance: lerp(t.ambushDistanceFar, t.ambushDistanceNear, c),
      edge: lerp(t.ambushEdgeFar, t.ambushEdgeNear, c),
      ambush,
    });
    // What it crept unseen, or walked in, it keeps.
    if (this._crept || this._walkFrom !== null) {
      spot.distance = Math.min(spot.distance, Math.max(t.minDistance, this.distance));
    }
    for (const side of [this.side, -this.side]) {
      if (!this.place({ ...spot, side })) continue;
      this.distance = spot.distance;
      this.side = side;
      this.shown = true;
      this.ambush = ambush;
      this._stuck = 0;
      return;
    }
    this.ambush = false;
    this.hide();             // it may still stand where it was
    this._gone = t.retryAfter;
  }

  _vanish() {
    if (!this.shown) return;
    this.shown = false;
    this.ambush = false;
    this._crept = false;                    // a banishment gives the creep back
    this.hide();
  }

  _goneFor(stamina) {
    const t = this.tuning;
    return lerp(t.goneFar, t.goneNear, closenessFor(stamina, t));
  }

  _anySide() {
    return this.rand() < 0.5 ? -1 : 1;
  }

  /** One frame's step in toward the eye, `speed` metres a second plus the
   *  share of the player's retreat, no nearer than `floor`. The approach's
   *  answer: the metres it stands off, or false. */
  _step(dt, speed, floor, unseen) {
    const t = this.tuning;
    const drift = Math.max(0, this.playerDrift()) * t.stareFollow;
    const room = this.distance + drift - floor;
    const step = Math.max(0, Math.min(speed * dt + drift, room));
    const at = this.approach(step, unseen);
    if (at !== false) this.distance = at;
    return at === false ? false : step;
  }

  /** Seen, below walkBelow: it walks in on the player, down to arm's length. */
  _walkIn(dt) {
    const t = this.tuning;
    if (!t.stareDown || !(t.stareSpeed > 0)) return;
    this._walkFrom ??= this.distance;
    const step = this._step(dt, t.stareSpeed, t.stareFloor, false);
    this.walking = step !== false && step > 1e-9;
    const span = this._walkFrom - t.stareFloor;
    this.closingIn = span > 0 ? clamp01((this._walkFrom - this.distance) / span) : 1;
  }

  /** Unseen: it creeps in, no nearer than the creep floor. False when the
   *  step was refused (something in the way); otherwise the metres stepped. */
  _creep(dt, stamina) {
    const t = this.tuning;
    if (!t.stareDown) return 0;
    const speed = sneakSpeedFor(stamina, t);
    if (!(speed > 0)) return 0;
    const step = this._step(dt, speed, creepFloorFor(stamina, t), true);
    this.sneaking = step !== false && step > 1e-9;
    if (this.sneaking) this._crept = true;
    return step;
  }

  _endWalk() {
    this._walkFrom = null;
    this.closingIn = 0;
    this.walking = false;
  }
}
