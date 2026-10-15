import * as THREE from 'three';

// ─────────────────────────────────────────────
// RagnoLogic  –  the camera entity's rules (pure)
// ─────────────────────────────────────────────
// Ragno comes in through a side room's air vent. Outside he creeps up to it
// like a jumping spider that never jumps: a stare at the nearest camera, then
// a burst of sudden darts, then another stare. He climbs the slope to the
// vent, goes into the duct, and comes out of the grille in the living
// quarters or the server room, where he stands watching the corridor.
//
//   approach ─▶ climbOut ─▶ duct ─▶ emerge ─▶ watch ─▶ aggro ─▶ chase ─▶ caught
//      │ ▲ glance / seen outside                │ flash      │ airlock / outside:
//      │ └─ scurry (to the side of the building) ▼            ▼ prowl ─▶ chase | leave
//      │ flash                              flinch ─▶ flee ─▶ (grille) gone
//      └──▶ flinch ─▶ retreat ─▶ gone        ▲ torch, power off (chase, prowl)
//
// Night 1 (the calm mood) he only comes as far as the vent, lingers and goes
// back the way he came: tension, not a threat. Night 3 (aggressive) pauses
// less and comes out of the room sooner.
//
// Everything he senses comes in `update(dt, sense)` as plain answers worked
// out by the Ragno component (is a camera's flash on him, is the player
// looking at him through the window …); out come his pose, his state, and
// this frame's `events` for the sounds and the cameras' static:
//
//   'scurry' 'flinch' 'retreat' 'linger' 'ventIn' 'emerge' 'watch' 'aggro'
//   'prowl' 'hunt' 'ventOut' 'gone' 'catch' 'dart'
//
// Routes come from RagnoPaths, laid out by BaseScene (_ragnoLayout).
// ─────────────────────────────────────────────

export const RAGNO = {
  /** Visits a night, [fewest, most], by mood; night 1 is always one. */
  visits: { normal: [1, 2], aggressive: [2, 4] },
  /** Clock hours (from midnight) visits come between: after dark, 9 PM to
   *  4:30 AM, at least `minGapHours` apart. Night 1's one is at midnight. */
  firstHour: -3,
  lastHour: 4.5,
  minGapHours: 1.25,
  night1Hour: 0,

  /** Outside he spends far more time still than moving: a long stare at
   *  the nearest camera, then a short burst of darts with long pauses. A
   *  visit outside takes two to three minutes on night 2. */
  mood: {
    /** Night 1: slow, few darts, long stares — meant to be half-seen. */
    calm: {
      stare: [5, 9], dartSpeed: 1.3, dartDistance: [0.8, 2.0], dartPause: [1, 2], burst: [1, 3],
      linger: [3, 5], chaseSpeed: 0, watch: [60, 60],
    },
    normal: {
      stare: [5, 10], dartSpeed: 6, dartDistance: [0.5, 1.6], dartPause: [1.2, 3], burst: [2, 4],
      linger: [0, 0], chaseSpeed: 4.2, watch: [45, 75],
    },
    /** Night 3: shorter pauses, more darts, out of the room sooner, quicker. */
    aggressive: {
      stare: [2.5, 5], dartSpeed: 7, dartDistance: [0.5, 1.6], dartPause: [0.6, 1.6], burst: [2, 5],
      linger: [0, 0], chaseSpeed: 4.5, watch: [25, 40],
    },
  },

  /** m/s: to the side of the building when seen; away when flashed. */
  scurrySpeed: 7,
  fleeSpeed: 7,
  /** m/s up the slope and down the wall, and back up it fleeing. */
  climbSpeed: 1.1,
  climbFleeSpeed: 3,
  /** m/s walking across a room to his watch, and prowling. */
  walkSpeed: 1.4,
  /** Metres he runs away from the camera that flashed him, outside. */
  retreatDistance: 14,
  /** Seconds he rears back from a flash. */
  flinchSeconds: 0.45,
  /** Seconds of screech before the chase. */
  aggroSeconds: 1.1,
  /** Seconds in the duct, between the vent outside and the grille in. */
  ductSeconds: [7, 12],
  /** Seconds before another glance or sighting sends him scurrying. */
  spookCooldown: 4,
  /** In the player's sight outside (from the yard, through the fence): he
   *  bolts `evadeDistance` m straight out from the building, into the
   *  trees, and comes back only once out of sight for `evadeHold` s. */
  evadeDistance: 10,
  evadeHold: 3,
  /** Metres (flat) he catches the player at. */
  catchDistance: 1.1,
  /** With the player in the airlock or outside: never stopping within this
   *  many metres of the airlock's door; back on the hunt `returnGrace`
   *  seconds after they come in; gone by his vent after `prowlTimeout`. */
  airlockKeepOut: 6,
  returnGrace: 4,
  prowlTimeout: 60,
  prowlPause: [2, 4],
  /** Seconds between re-plans of the way to the player. */
  replan: 0.4,
  /** Metres from a doorway node he is fully thin, and back to wide. */
  doorNear: 1.0,
  doorFar: 2.4,
};

/** How he behaves on a night. */
export function moodFor(night) {
  if (night <= 1) return 'calm';
  return night === 2 ? 'normal' : 'aggressive';
}

/**
 * Tonight's visits: { hour, side (−1 quarters, +1 server), approach, mood },
 * in order.
 */
export function scheduleVisits(night, rand = Math.random, t = RAGNO) {
  const mood = moodFor(night);
  const pick = () => ({ side: rand() < 0.5 ? -1 : 1, approach: rand() < 0.5 ? 'window' : 'yard' });
  if (mood === 'calm') return [{ hour: t.night1Hour, mood, ...pick() }];
  const [lo, hi] = t.visits[mood];
  const n = lo + Math.min(Math.floor(rand() * (hi - lo + 1)), hi - lo);
  // One in each of n equal slots, never in the last `minGapHours` of its
  // slot, so any two are at least that far apart.
  const span = (t.lastHour - t.firstHour) / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const start = t.firstHour + i * span;
    out.push({ hour: start + rand() * Math.max(span - t.minGapHours, 0), mood, ...pick() });
  }
  return out;
}

const UP = [0, 1, 0];
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3();
const _dir = new THREE.Vector3();

const between = (rand, [lo, hi]) => lo + (hi - lo) * rand();
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (x, y, z, up = UP) => ({ x, y, z, up });

export class RagnoLogic {
  /** 'off' while there is no visit. */
  state = 'off';
  /** In the approach: 'stare' | 'dart' | 'pause'; else null. */
  mode = null;
  /** 'calm' | 'normal' | 'aggressive' */
  mood = 'normal';
  /** −1 the quarters' end, +1 the server room's. */
  side = -1;
  visible = false;
  indoors = false;
  /** 0 wide … 1 thin (doorways). */
  stance = 0;
  /** 0..1, rearing back from a flash. */
  flinch = 0;
  /** This frame's events. */
  events = [];

  /**
   * @param {object} opts
   * @param {object} opts.layout  { sides: { [-1|1]: side }, graph: NavGraph, airlockDoor: {x,z} }
   *        — see BaseScene._ragnoLayout for a side's fields.
   * @param {() => number} [opts.rand]
   * @param {typeof RAGNO} [opts.tuning]
   */
  constructor({ layout, rand = Math.random, tuning = RAGNO }) {
    this.layout = layout;
    this.rand = rand;
    this.t = tuning;
    /** Where his feet are: on the ground, the slope or the wall. */
    this.pos = new THREE.Vector3();
    /** The surface's normal under him. */
    this.up = new THREE.Vector3(0, 1, 0);
    /** Which way he faces, along the surface. */
    this.facing = new THREE.Vector3(0, 0, 1);
    /** m/s, this frame. */
    this.velocity = new THREE.Vector3();
    this._path = [];
    this._i = 0;
    this._timer = 0;
    this._then = null;
    this._spookWait = 0;
    this._from = null;
  }

  get active() { return this.state !== 'off'; }
  get tune() { return this.t.mood[this.mood]; }
  get sideSpec() { return this.layout.sides[this.side]; }

  /** A visit begins, at the start of its route, out of sight. */
  spawn({ side, approach, mood }) {
    this.side = side;
    this.mood = mood;
    this.approach = approach;
    this._route = this.sideSpec.approach[approach];
    this._setPath(this._route, 1);
    this._place(this._route[0]);
    this.visible = true;
    this.indoors = false;
    this.stance = 0;
    this.flinch = 0;
    this._spookWait = 0;
    this._enter('approach');
    this._stare();
  }

  /** Gone at once (a night start, the shift ending, the console). */
  despawn() {
    this.state = 'off';
    this.mode = null;
    this.visible = false;
    this.indoors = false;
    this.velocity.set(0, 0, 0);
  }

  /**
   * @param {number} dt
   * @param {object} s  What he senses this frame.
   * @param {boolean} s.flashHit      A security camera's flash is on him.
   * @param {THREE.Vector3|null} s.flashFrom  That camera, if so.
   * @param {boolean} s.flashlightHit The player's torch is on him.
   * @param {boolean} s.powerOn       The generator is running.
   * @param {boolean} s.glance        The player is looking at him through the window.
   * @param {boolean} s.spook         The player, outside, sees him close.
   * @param {boolean} [s.exposed]     The player is outside, and nothing (the
   *        building) stands between them: in their sight through the fence.
   * @param {{ pos: THREE.Vector3, zone: string }} s.player  Where the player is:
   *        a room or corridor's name, 'Airlock', or 'outside'.
   * @param {THREE.Vector3|null} s.nearestCamera  For a stare.
   * @param {boolean} s.clearToPlayer Nothing solid between him and the player.
   * @param {(from: {x:number,z:number}, to: {x:number,z:number}) => boolean} [s.canWalk]
   *        Can he walk straight from one spot to the other, through no wall?
   */
  update(dt, s) {
    this.events.length = 0;
    this.velocity.set(0, 0, 0);
    if (this.state === 'off') return;
    this._canWalk = s.canWalk ?? (() => true);
    this._spookWait = Math.max(0, this._spookWait - dt);
    this._timer -= dt;
    if (this.state !== 'flinch') this.flinch = Math.max(0, this.flinch - dt * 4);

    switch (this.state) {
      case 'approach': this._approach(dt, s); break;
      case 'scurry': this._scurry(dt, s); break;
      case 'evade': this._evading(dt, s); break;
      case 'linger': this._linger(dt, s); break;
      case 'leave': this._leaveOutside(dt); break;
      case 'climbOut': this._climbOut(dt, s); break;
      case 'duct': this._duct(); break;
      case 'emerge': this._emerge(dt, s); break;
      case 'watch': this._watch(s); break;
      case 'aggro': this._aggro(s); break;
      case 'chase': this._chase(dt, s); break;
      case 'prowl': this._prowl(dt, s); break;
      case 'flinch': this._flinching(); break;
      case 'retreat': this._retreat(dt); break;
      case 'flee': this._flee(dt); break;
      default: break;
    }
    this.stance = this.indoors ? this._doorStance() : 0;
  }

  // ── Outside ─────────────────────────────

  _approach(dt, s) {
    this._camera = s.nearestCamera;
    if (s.flashHit) return this._startFlinch('retreat', s.flashFrom);
    if (s.exposed && this._spookWait <= 0) return this._evade();
    if ((s.glance || s.spook) && this._spookWait <= 0 && this._scurryAway()) return;
    const tune = this.tune;
    if (this.mode === 'stare') {
      this._faceToward(s.nearestCamera);
      if (this._timer <= 0) {
        this._burst = Math.round(between(this.rand, tune.burst));
        this._startDart();
      }
      return;
    }
    if (this.mode === 'pause') {
      if (this._timer > 0) return;
      if (this._burst > 0) this._startDart();
      else this._stare();
      return;
    }
    // A dart: fast along the route for its length, then a dead stop.
    const { done, left } = this._follow(dt, tune.dartSpeed, this._dartLeft);
    this._dartLeft = left;
    if (done) return this._arrived();
    if (this._dartLeft <= 1e-6) {
      this.mode = 'pause';
      this._timer = between(this.rand, tune.dartPause);
      this._burst--;
    }
  }

  /** At the foot of the slope: in, or (night 1) a long look and away. */
  _arrived() {
    if (this.mood === 'calm') {
      this._enter('linger');
      this._timer = between(this.rand, this.tune.linger);
      this.events.push('linger');
      return;
    }
    this._enter('climbOut');
    this._setPath(this.sideSpec.climb, 1);
  }

  /** A dead stop, snapped round to the nearest camera: a jumping spider turns at once. */
  _stare() {
    this.mode = 'stare';
    this._timer = between(this.rand, this.tune.stare);
    this._faceToward(this._camera);
  }

  _startDart() {
    this.mode = 'dart';
    this._dartLeft = between(this.rand, this.tune.dartDistance);
    this.events.push('dart');
  }

  /** Seen: off to the next spot beside the building, out of view, fast. */
  _scurryAway() {
    let hide = -1;
    for (let i = this._i; i < this._route.length; i++) if (this._route[i].hide) { hide = i; break; }
    if (hide < 0) return false;
    this._resumeAt = hide + 1;
    this._setPath([this._here(), this._route[hide]], 1);
    this._enter('scurry');
    this._spookWait = this.t.spookCooldown;
    this.events.push('scurry');
    return true;
  }

  _scurry(dt, s) {
    if (s.flashHit) return this._startFlinch('retreat', s.flashFrom);
    if (!this._follow(dt, this.t.scurrySpeed).done) return;
    this._enter('approach');
    if (this._resumeAt >= this._route.length) return this._arrived();
    this._setPath(this._route, this._resumeAt);
    this._path[this._i - 1] = this._here();
    this.mode = 'pause';
    this._timer = between(this.rand, this.tune.dartPause);
    this._burst = 0;
  }

  /** In the player's sight outside: off to the side, well away, fast. */
  _evade() {
    const here = this._here();
    const out = { x: here.x + this.side * this.t.evadeDistance, y: here.y, z: here.z, up: UP };
    this._evadeFrom = this.state;
    // Where he was on his way in, to come back to.
    this._resumeAt = this.state === 'approach' ? this._i : this._route.length;
    this._setPath([here, out], 1);
    this._enter('evade');
    this._unseen = 0;
    this._spookWait = this.t.spookCooldown;
    this.events.push('scurry');
  }

  _evading(dt, s) {
    this._camera = s.nearestCamera;
    if (s.flashHit) return this._startFlinch('retreat', s.flashFrom);
    if (!this._follow(dt, this.t.scurrySpeed).done) return;
    // Out there, still, watching; back once the player has lost sight of him.
    this._faceToward(s.nearestCamera);
    this._unseen = s.exposed ? 0 : this._unseen + dt;
    if (this._unseen < this.t.evadeHold) return;
    if (this._evadeFrom === 'linger') {
      this._enter('linger');
      this._timer = 0;
      return;
    }
    this._enter('approach');
    this._setPath(this._route, Math.min(Math.max(this._resumeAt, 1), this._route.length - 1));
    this.mode = 'pause';
    this._timer = between(this.rand, this.tune.dartPause);
    this._burst = 0;
  }

  _linger(_dt, s) {
    if (s.flashHit) return this._startFlinch('retreat', s.flashFrom);
    if (s.exposed && this._spookWait <= 0) return this._evade();
    if ((s.glance || s.spook) && this._spookWait <= 0) {
      // Nowhere further to hide: away the way he came, at once.
      this._timer = 0;
    }
    this._faceToward(s.nearestCamera);
    if (this._timer > 0) return;
    this._enter('leave');
    this._setPath([...this._route].reverse(), 1);
  }

  _leaveOutside(dt) {
    if (this._follow(dt, this.tune.dartSpeed * 0.8).done) this._gone();
  }

  _climbOut(dt, s) {
    if (s.flashHit) return this._startFlinch('retreat', s.flashFrom);
    if (!this._follow(dt, this.t.climbSpeed).done) return;
    this.events.push('ventIn');
    this._enter('duct');
    this.visible = false;
    this._timer = between(this.rand, this.t.ductSeconds);
  }

  _duct() {
    if (this._timer > 0) return;
    const spec = this.sideSpec;
    const stare = this.layout.graph.get(spec.stare);
    this._setPath([...spec.descent, point(stare.x, 0, stare.z)], 1);
    this._place(spec.descent[0]);
    this.visible = true;
    this.indoors = true;
    this._enter('emerge');
    this.events.push('emerge');
  }

  _retreat(dt) {
    if (this._follow(dt, this.t.fleeSpeed).done) this._gone();
  }

  // ── Inside ──────────────────────────────

  _emerge(dt, s) {
    if (s.flashHit) return this._startFlinch('flee');
    const onWall = this.up.y < 0.9;
    if (!this._follow(dt, onWall ? this.t.climbSpeed : this.t.walkSpeed).done) return;
    this._enter('watch');
    this._timer = between(this.rand, this.tune.watch);
    this._faceToward(_a.set(this.sideSpec.door.x, this.pos.y, this.sideSpec.door.z));
    this.events.push('watch');
  }

  _watch(s) {
    if (s.flashHit) return this._startFlinch('flee');
    const spec = this.sideSpec;
    if (s.player.zone === spec.room || s.player.zone === spec.corridor || this._timer <= 0) this._startAggro();
  }

  _startAggro() {
    this._enter('aggro');
    this._timer = this.t.aggroSeconds;
    this.events.push('aggro');
  }

  _aggro(s) {
    if (this._torch(s)) return;
    this._faceToward(s.player.pos);
    if (this._timer <= 0) this._enter('chase');
  }

  _chase(dt, s) {
    if (this._torch(s)) return;
    const { zone } = s.player;
    if (zone === 'Airlock' || zone === 'outside') return this._startProwl();
    if (flat(this.pos, s.player.pos) < this.t.catchDistance) {
      this._enter('caught');
      this.events.push('catch');
      return;
    }
    // Straight at them when nothing is in the way; else by the rooms.
    const target = s.clearToPlayer ? s.player.pos : this._wayTo(dt, s.player.pos);
    this._walkTo(dt, target, this.tune.chaseSpeed);
  }

  _startProwl() {
    this._enter('prowl');
    this._prowlFor = 0;
    this._backFor = 0;
    this._prowlTarget = null;
    this.events.push('prowl');
  }

  _prowl(dt, s) {
    if (this._torch(s)) return;
    const away = s.player.zone === 'Airlock' || s.player.zone === 'outside';
    if (away) {
      this._backFor = 0;
      this._prowlFor += dt;
      if (this._prowlFor >= this.t.prowlTimeout) return this._leaveInside();
    } else {
      this._backFor += dt;
      if (this._backFor >= this.t.returnGrace) {
        this._enter('chase');
        this.events.push('hunt');
        return;
      }
    }
    // Wander from spot to spot, every one well away from the airlock's door.
    if (!this._prowlTarget) {
      const door = this.layout.airlockDoor;
      const here = this._reachable(this.pos);
      const spots = this.layout.graph.farFrom(door, this.t.airlockKeepOut).filter(n => n !== here);
      this._prowlTarget = spots[Math.floor(this.rand() * spots.length)] ?? here;
      this._setPath(this._nodePath(this._prowlTarget.id), 1);
      this._waiting = false;
    }
    if (this._waiting) {
      if (this._timer <= 0) this._prowlTarget = null;
      return;
    }
    if (this._follow(dt, this.t.walkSpeed).done) {
      this._waiting = true;
      this._timer = between(this.rand, this.t.prowlPause);
    }
  }

  /** Back to his vent without a fright: the player stayed out. */
  _leaveInside() {
    this._enter('flee');
    this._fleeSpeed = this.t.walkSpeed;
    this._setPath(this._ventPath(), 1);
  }

  _flee(dt) {
    const onWall = this.up.y < 0.9;
    const speed = onWall ? this.t.climbFleeSpeed : this._fleeSpeed;
    if (!this._follow(dt, speed).done) return;
    this.events.push('ventOut');
    this._gone();
  }

  /** The torch matters only with the power off, and only once he's out. */
  _torch(s) {
    if (s.flashlightHit && !s.powerOn) {
      this._startFlinch('flee');
      return true;
    }
    return false;
  }

  // ── Flinch, and where it sends him ──────

  _startFlinch(then, from = null) {
    this._then = then;
    this._from = from ? from.clone() : null;
    this._enter('flinch');
    this._timer = this.t.flinchSeconds;
    this.flinch = 1;
    this.events.push('flinch');
  }

  _flinching() {
    this.flinch = Math.max(0, this._timer / this.t.flinchSeconds);
    if (this._timer > 0) return;
    this.flinch = 0;
    if (this._then === 'flee') {
      this._enter('flee');
      this._fleeSpeed = this.t.fleeSpeed;
      this._setPath(this._ventPath(), 1);
      return;
    }
    // Outside: down off the slope if he's on it, then away from the camera
    // and a little aside, until he's out of its sight.
    const start = [this._here()];
    if (this.up.y < 0.9) start.push(this.sideSpec.climb[0]);
    const last = start[start.length - 1];
    const from = this._from ?? _b.set(0, 0, 0);
    _dir.set(last.x - from.x, 0, last.z - from.z);
    if (_dir.lengthSq() < 1e-6) _dir.set(this.side, 0, 0);
    _dir.normalize().applyAxisAngle(_up.set(0, 1, 0), (this.rand() < 0.5 ? -1 : 1) * 0.35);
    const d = this.t.retreatDistance;
    start.push(point(last.x + _dir.x * d, last.y, last.z + _dir.z * d));
    this._enter('retreat');
    this._setPath(start, 1);
    this.events.push('retreat');
  }

  _gone() {
    this.events.push('gone');
    this.despawn();
  }

  // ── Moving ──────────────────────────────

  _enter(state) {
    this.state = state;
    this.mode = state === 'approach' ? this.mode : null;
  }

  _here() {
    return point(this.pos.x, this.pos.y, this.pos.z, this.up.toArray());
  }

  _place(p) {
    this.pos.set(p.x, p.y, p.z);
    this.up.fromArray(p.up ?? UP);
  }

  _setPath(path, from) {
    this._path = path;
    this._i = from;
  }

  /**
   * Along the path at `speed` for `dt`, no more than `limit` metres.
   * @returns {{ done: boolean, left: number }}
   */
  _follow(dt, speed, limit = Infinity) {
    let budget = Math.min(speed * dt, limit);
    const start = _b.copy(this.pos);
    while (budget > 1e-9 && this._i < this._path.length) {
      const to = this._path[this._i];
      _a.set(to.x, to.y, to.z).sub(this.pos);
      const d = _a.length();
      if (d <= budget) {
        this.pos.set(to.x, to.y, to.z);
        this.up.fromArray(to.up ?? UP);
        budget -= d;
        this._i++;
      } else {
        this.pos.addScaledVector(_a, budget / d);
        // The surface turns under him as he goes from one point's to the next's.
        const prev = this._path[this._i - 1];
        const k = 1 - (d - budget) / Math.max(d + Math.hypot(prev.x - this.pos.x, prev.y - this.pos.y, prev.z - this.pos.z), 1e-6);
        _up.fromArray(prev.up ?? UP).lerp(_a.fromArray(to.up ?? UP), Math.min(Math.max(k, 0), 1)).normalize();
        this.up.copy(_up);
        budget = 0;
      }
    }
    const moved = _a.copy(this.pos).sub(start);
    const m = moved.length();
    if (m > 1e-9 && dt > 0) {
      this.velocity.copy(moved).divideScalar(dt);
      this.facing.copy(moved).normalize();
    }
    return { done: this._i >= this._path.length, left: limit === Infinity ? Infinity : Math.max(limit - m, 0) };
  }

  /** Straight toward `target` on the floor at `speed`. */
  _walkTo(dt, target, speed) {
    _a.set(target.x - this.pos.x, 0, target.z - this.pos.z);
    const d = _a.length();
    if (d < 1e-6) return;
    const step = Math.min(speed * dt, d);
    this.pos.addScaledVector(_a, step / d);
    this.pos.y = 0;
    this.up.set(0, 1, 0);
    this.velocity.copy(_a).multiplyScalar(step / d / dt);
    this.facing.copy(_a).normalize();
  }

  /** The next spot on the way through the rooms to `goal`. */
  _wayTo(dt, goal) {
    this._replanIn = (this._replanIn ?? 0) - dt;
    const graph = this.layout.graph;
    if (this._replanIn <= 0 || !this._way?.length) {
      this._replanIn = this.t.replan;
      this._way = graph.route(this._reachable(this.pos).id, graph.nearest(goal).id);
    }
    // Past the nodes already reached (or that the next one is nearer than).
    while (this._way.length > 1) {
      const [a, b] = this._way;
      if (flat(this.pos, a) < 0.4 || (flat(this.pos, b) < flat(a, b) && this._canWalk(this.pos, b))) this._way.shift();
      else break;
    }
    const next = this._way[0];
    // At the player's own spot: straight for them.
    if (!next || (this._way.length === 1 && flat(this.pos, next) < 0.4)) return goal;
    return _b.set(next.x, 0, next.z);
  }

  /** The nearest spot he can walk straight to — never one through a wall
   *  that only looks near. The nearest of all if none is clear. */
  _reachable(p) {
    const nodes = [...this.layout.graph.nodes].sort((a, b) => flat(p, a) - flat(p, b));
    return nodes.find(n => this._canWalk?.(p, n) ?? true) ?? nodes[0];
  }

  /** A floor path through the rooms to node `id`, from where he is. */
  _nodePath(id) {
    const graph = this.layout.graph;
    const nodes = graph.route(this._reachable(this.pos).id, id);
    return [this._here(), ...nodes.map(n => point(n.x, 0, n.z))];
  }

  /** Through the rooms to his landing, then up the wall into the grille. */
  _ventPath() {
    const spec = this.sideSpec;
    return [...this._nodePath(spec.landing), ...[...spec.descent].reverse()];
  }

  _faceToward(target) {
    if (!target) return;
    _a.set(target.x - this.pos.x, 0, target.z - this.pos.z);
    if (_a.lengthSq() > 1e-8) this.facing.copy(_a.normalize());
  }

  _doorStance() {
    const d = this.layout.graph.doorDistance(this.pos);
    const { doorNear, doorFar } = this.t;
    return Math.min(Math.max((doorFar - d) / (doorFar - doorNear), 0), 1);
  }
}
