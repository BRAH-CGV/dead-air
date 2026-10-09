// ─────────────────────────────────────────────
// SleepDemonLogic  –  the Sleep Demon's rules, with no scene attached
// ─────────────────────────────────────────────
// It lives in the corner of the player's eye. Once stamina drops below
// `appearBelow` it is about: a few seconds later it shows at the edge of
// the view, and the tireder the player, the nearer it stands and the nearer
// the middle of the view:
//
//   stamina      0.85 ─────────────────────────────────▶ 0
//   distance     10 m                                    0.8 m, right beside them
//   from centre  at the very edge of the view            just inside the tunnel's clear middle
//   gone for     6 s after a look                        half a second
//
// Looked at (within focusAngle of the centre of the view) it is gone at once,
// and shows again `goneFor` later at the other edge of the view. Out of view
// for `lostAfter` (turned away from, or something in the way) it finds the
// edge of the view again. Every eighth of the way down it steps in to a new
// spot, looked at or not, and a ration sends it back the same way. Below
// `holdBelow` it no longer flees a look: it stands there. At empty it takes
// the player.
//
// With the stare-down on (see the tuning), "stands there" is a slow walk in
// on the player for as long as it is seen, down to arm's length.
//
// While the view is covered (the terminal's screen) it neither flees nor
// wanders. It slips round out of sight, beside or behind the player, and
// steps in there band by band, so closing the screen may find it right
// behind them. Then the usual rules take over.
//
// The scene is injected: lookAngle() says where the view is from it,
// place() puts it at the edge of the view, hide() takes it away. SleepDemon
// (the component) maps them onto the camera, the physics and the figure.
// ─────────────────────────────────────────────

export const SLEEP_DEMON = Object.freeze({
  /** It is about once stamina is below this. */
  appearBelow: 0.85,
  /** Metres from the player's eye when it first shows … */
  farthest: 10,
  /** … and at empty. */
  nearest: 0.8,
  /** How far out from the centre of the view it stands, as a share of the
   *  view's half-width: at the very edge at first, and at empty just inside
   *  the clear middle of the fatigue tunnel, where it can still be seen. */
  edgeFar: 0.85,
  edgeNear: 0.45,
  /** Looked at: within this angle (radians) of the centre of the view. */
  focusAngle: 12 * Math.PI / 180,
  /** Seconds it stays gone after a look: when it first shows, and at empty. */
  goneFar: 6,
  goneNear: 0.5,
  /** Seconds out of view before it finds the edge of the view again. */
  lostAfter: 1.5,
  /** It steps in (or back) each time stamina crosses into a new band. */
  bands: 8,
  /** Below this stamina it no longer flees a look. */
  holdBelow: 0.08,
  /** Seconds before it tries again when neither side had room. */
  retryAfter: 0.25,
  /** Metres it keeps clear of a wall or a prop in the way (SleepDemon). */
  wallGap: 0.45,
  /** Less room than this and it doesn't show on that side (SleepDemon). */
  minDistance: 0.6,
  /** The stare-down. Below holdBelow, while it is in view, it walks in on the
   *  player along the line it is seen along, and a look away no longer sends
   *  it back out. On, it is a predator that closes in for the kill; off (or a
   *  stareSpeed of 0) it is a presence that only stands there, as before.
   *  Which it should be is still open: flip this to A/B the two. */
  stareDown: true,
  /** Metres a second it walks in. 0.08 brings it from where the last band
   *  stood it (1.95 m) to arm's length in about the 19 s the last of the
   *  stamina lasts. Faster, it is there early and waits; slower, the kill
   *  comes before it arrives. */
  stareSpeed: 0.08,
  /** Metres from the eye it walks in to: arm's length. Nearer than
   *  minDistance, which is the room it needs to show, not to stand. */
  stareFloor: 0.5,
  /** Dead air (duckFor): the world's sound, as a share of its level, with
   *  it standing where it showed … */
  duckEdge: 0.7,
  /** … and at the look. Near-silence, not a mute: the room dies around it. */
  duckFloor: 0.06,
  /** While the view is covered it stands this far round instead, as a share
   *  of the view's half-width: past 1 is out of view. Beside the player when
   *  it first shows (86° off the centre of the default view), behind them at
   *  empty (150°). */
  ambushEdgeFar: 1.6,
  ambushEdgeNear: 2.8,
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
 */
export function duckFor(angle, shownAt, { focusAngle, duckEdge, duckFloor } = SLEEP_DEMON) {
  if (angle === null) return duckEdge;
  if (!Number.isFinite(angle)) return 1;
  if (angle <= focusAngle) return duckFloor;
  if (shownAt <= focusAngle) return duckEdge;
  return lerp(duckEdge, duckFloor, clamp01((shownAt - angle) / (shownAt - focusAngle)));
}

export class SleepDemonLogic {
  /** Stamina is low enough for it to be about: it breathes. */
  around = false;
  /** Standing in view. */
  shown = false;
  /** 0 when it first shows … 1 at empty. */
  closeness = 0;
  /** Where it shows next: +1 right of the view, −1 left. */
  side = 1;
  /** Metres from the player's eye it stands, as last placed or walked in. */
  distance = Infinity;
  /** 0 until the stare-down walks it in … 1 at arm's length. For a sound. */
  closingIn = 0;
  /** Standing out of sight, where it went while the view was covered. */
  ambush = false;

  /**
   * @param {object} [opts]
   * @param {() => number|null} [opts.lookAngle]  radians from the centre of the
   *        view; Infinity out of view, null while the view is covered
   * @param {(spot: {distance: number, side: number, edge: number, ambush?: boolean}) => boolean} [opts.place]
   *        puts it at the edge of the view (ambush: past it, out of sight); false: no room there
   * @param {() => void} [opts.hide]
   * @param {() => void} [opts.onKill]
   * @param {() => number} [opts.rand]
   * @param {typeof SLEEP_DEMON} [opts.tuning]
   * @param {(step: number) => number|false} [opts.approach]  the stare-down:
   *        walks it `step` metres in toward the eye; the metres it then stands
   *        off, or false when it couldn't step there
   */
  constructor({
    lookAngle = () => Infinity, place = () => true, hide = () => {}, onKill = () => {},
    rand = Math.random, tuning = SLEEP_DEMON,
    approach = () => false,
  } = {}) {
    Object.assign(this, { lookAngle, place, hide, onKill, rand, tuning });
    this.approach = approach;
    this.start();
  }

  /** A new or retried night: away, nothing counted. */
  start() {
    this.around = false;
    this.shown = false;
    this.closeness = 0;
    this.side = this._anySide();
    this.ambush = false;
    this._band = -1;
    this._gone = 0;
    this._lost = 0;
    this._killed = false;
    this.distance = Infinity;
    this._endStare();
  }

  /** @param {number} dt @param {number} stamina  0 … 1 */
  update(dt, stamina) {
    if (this._killed) return;
    if (stamina <= 0) {
      this._killed = true;
      this.onKill();
      return;
    }
    const t = this.tuning;
    if (stamina >= t.holdBelow) this._endStare();
    if (stamina >= t.appearBelow) {
      this._vanish();
      this.around = false;
      this.closeness = 0;
      return;
    }
    if (!this.around) {
      this.around = true;
      this._gone = this._goneFor(stamina);
    }
    this.closeness = closenessFor(stamina, t);
    const band = Math.min(t.bands - 1, Math.floor(this.closeness * t.bands));

    if (this.shown) {
      const angle = this.lookAngle();
      if (angle !== null) {
        if (angle < t.focusAngle && stamina >= t.holdBelow) {
          this._vanish();
          this.side = -this.side;
          this._gone = this._goneFor(stamina);
          return;
        }
        this._lost = Number.isFinite(angle) ? 0 : this._lost + dt;
      }
      if (this._lost >= t.lostAfter) this.side = this._anySide();
      // Somewhere new, now: it moves straight there. The view just covered,
      // it slips out of sight.
      if (this._lost >= t.lostAfter || band !== this._band || (angle === null && !this.ambush)) {
        this.shown = false;
        this._gone = 0;
      }
      if (this.shown && Number.isFinite(angle) && stamina < t.holdBelow) this._walkIn(dt);
    }
    if (!this.shown && (this._gone -= dt) <= 0) this._show(band);
  }

  // ── Private ──

  _show(band) {
    const { closeness: c, tuning: t } = this;
    const spot = { distance: lerp(t.farthest, t.nearest, c), edge: lerp(t.edgeFar, t.edgeNear, c) };
    // A glance away doesn't undo a stare-down: it shows again as near as it came.
    if (this._walkFrom !== null) spot.distance = Math.min(spot.distance, Math.max(t.minDistance, this.distance));
    // Nobody is watching the room: it may stand anywhere, so it stands
    // where turning round will find it.
    const ambush = this.lookAngle() === null;
    if (ambush) Object.assign(spot, { edge: lerp(t.ambushEdgeFar, t.ambushEdgeNear, c), ambush });
    for (const side of [this.side, -this.side]) {
      if (!this.place({ ...spot, side })) continue;
      this.distance = spot.distance;
      this.side = side;
      this.shown = true;
      this.ambush = ambush;
      this._band = band;
      this._lost = 0;
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
    this.hide();
  }

  _goneFor(stamina) {
    const t = this.tuning;
    return lerp(t.goneFar, t.goneNear, closenessFor(stamina, t));
  }

  _anySide() {
    return this.rand() < 0.5 ? -1 : 1;
  }

  /** The stare-down's step. A step of 0 still asks, so a player who backed
   *  off is walked after again rather than left at a stale distance. */
  _walkIn(dt) {
    const t = this.tuning;
    if (!t.stareDown || !(t.stareSpeed > 0)) return;
    this._walkFrom ??= this.distance;
    const at = this.approach(Math.max(0, Math.min(t.stareSpeed * dt, this.distance - t.stareFloor)));
    if (at !== false) this.distance = at;
    const span = this._walkFrom - t.stareFloor;
    this.closingIn = span > 0 ? clamp01((this._walkFrom - this.distance) / span) : 1;
  }

  _endStare() {
    this._walkFrom = null;
    this.closingIn = 0;
  }
}
