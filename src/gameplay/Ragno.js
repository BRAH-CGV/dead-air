import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { Component } from '../core/Component.js';
import { RagnoLogic, scheduleVisits, moodFor } from './RagnoLogic.js';
import { throughWindow } from './DustEyes.js';
import { findBursts, loudSpan, DuctCrawl, DUCT_CRAWL, ductEnvelope, walkRate } from './RagnoSounds.js';
import { LoopVoice } from '../components/LoopVoice.js';
import { CAMERA_FLASH } from '../components/CameraTerminal.js';
import { terrainHeightAt } from '../gameobjects/MarsTerrain.js';

// ─────────────────────────────────────────────
// Ragno  –  the camera entity, in the base
// ─────────────────────────────────────────────
// The rules are RagnoLogic's; the walk is RagnoFigure's. This is what joins
// them to the world, once a frame:
//
//   • when he comes: tonight's visits (scheduleVisits) on the night clock,
//     never during the UFO's visit, one at a time.
//   • what he senses: a security camera's flash on him (the camera on air,
//     lit, its picture in, its cone and reach, nothing between), the
//     player's torch on him (only matters with the power off), the player
//     looking at him through the office window, the player outside seeing
//     him close, where the player is.
//   • what follows: the figure posed and walked, the camera that sees a vent
//     he reaches breaking up into static, his sounds, the tension music, and
//     the night failed when he catches the player.
//
// Sounds:
//   outside   soft chirps cut from the spider call, low and muffled under the
//             wind, now and then, carrying far; rarely a loud shriek, pitched
//             down: one of the call's loud bursts or one of the two attacks
//   in a duct the vent recording in pieces (DuctCrawl): his steps, and thuds
//             and creaks layered over them, placed where he is in the wall
//   indoors   his legs, looped at the pace of his steps (heard only inside)
//   flinch    / aggro: one of the two attacks
//   the kill  the third attack's loud part
// ─────────────────────────────────────────────

export const RAGNO_SOUNDS = {
  /** Volumes, of each clip's own level. */
  chirp: 0.45,
  screech: 0.7,
  attack: 0.85,
  /** Indoors, the attacks' share: he's close, and in a room. */
  attackInside: 0.75,
  death: 1,
  walk: 0.5,
  duct: 0.9,
  /** Night 1's share of the outside sounds: quieter, meant to be half-heard. */
  calm: 0.45,
  /** Indoors, the outside calls come through the walls at this share. */
  throughWalls: 0.3,
  /** Seconds between chirps outside. */
  chirpEvery: [3, 8],
  /** Of the calls, the share that are the shriek. */
  screechChance: 0.1,
  /** Cents the shriek is pitched down. */
  screechDetune: -700,
  /** Hz the outside calls are low-passed at, to sit under the wind. */
  muffle: 1000,
  /** Metres within which a placed sound is at full volume. Outside, his
   *  calls are subtle, easy to miss: soft, muffled, and falling off
   *  sooner than they used to (`callRolloff`), so from across the yard or
   *  through the office window they are only just there. */
  refDistance: 4,
  callRefDistance: 6,
  callRolloff: 0.9,
  /** In the duct, HRTF-panned like every placed sound, so the wall he is in
   *  is plain. Through a camera (the ears on its lens, often in his room) it
   *  is full only close by and falls off steeply; with the player's own ears,
   *  usually rooms away, it is louder (`gain`) and carries further. */
  ductCamera: { refDistance: 1.5, rolloff: 1.6, gain: 1 },
  ductEars: { refDistance: 3.5, rolloff: 0.9, gain: 1.8 },
  /** The duct's swell as he climbs in and fade as he climbs out
   *  (ductEnvelope): seconds, and the level it starts and ends at. */
  ductFade: { fadeIn: 1.2, fadeOut: 1, floor: 0.25 },
  /** Indoors, his legs and his screech: full only within arm's reach and
   *  falling off steeply, so the ear finds him in the room. */
  inside: { refDistance: 1.2, rolloff: 1.8 },
  /** dB: the call's chirps are under this, its loud bursts over it. */
  loudPeak: -22,
  /** Keys. */
  keys: {
    walk: 'sfx:spider-walking',
    call: 'sfx:spider-call',
    attacks: ['sfx:spider-attack-2', 'sfx:spider-attack-4'],
    death: 'sfx:spider-attack-8',
    duct: 'sfx:ragno-vents',
  },
};

/** The prompt when he catches the player, and the screen it is shown on. */
const CAUGHT_PROMPT = 'Something came out of the vents.';
const CAUGHT_SCREEN = { tone: 'blood', fadeMs: 0, redMs: 900, messageDelayMs: 700 };
/** Seconds of lunge, in the player's face, before the screen cuts. The view
 *  drains to red through it, as with the evil signal (RedOut). */
const LUNGE_SECONDS = 0.25;
/** Seconds a camera breaks up when he reaches a vent it sees, or the room
 *  he is coming into. */
const VENT_STATIC = 1.6;
/** Degrees from the middle of the view a look through the window must be
 *  within, and seconds it must hold, to count as seen. */
const GLANCE = { angle: 9, seconds: 0.3 };
/** The player outside sees him within this many metres and degrees. */
const SPOOK = { distance: 12, angle: 30 };
/** Out in the yard, the player is in sight of him within this many metres,
 *  wherever they look, with only the fence (see-through) between: he bolts. */
const EXPOSED = 30;
/** Metres from a vent within which an outdoor camera on screen breaks up as
 *  he goes in, whether or not the vent is in its frame. */
const VENT_NEAR = 16;

const _eye = new THREE.Vector3();
const _view = new THREE.Vector3();
const _body = new THREE.Vector3();
const _to = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _ray = new THREE.Ray();
const _frustum = new THREE.Frustum();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _wa = new THREE.Vector3();
const _wb = new THREE.Vector3();
/** Heights a walk is checked at (his legs, his body), the offsets across
 *  it (his middle and his flanks: about his thin width), and the slack. */
const WALK_HEIGHTS = [0.35, 0.9];
const WALK_FLANKS = [0, -0.4, 0.4];
const WALK_MIDDLE = [0];
const WALK_SLACK = 0.1;

export class Ragno extends Component {
  /**
   * @param {object} o
   * @param {import('./GameController.js').GameController} o.controller
   * @param {{ currentTime: number }} o.clock  The night clock.
   * @param {object} o.layout  RagnoLogic's layout, plus `window`, `vents`,
   *        `occluders` and `slope` (BaseScene._ragnoLayout).
   * @param {import('../gameobjects/RagnoFigure.js').RagnoFigure} o.figure
   * @param {import('../components/CameraTerminal.js').CameraTerminal|null} [o.terminal]
   * @param {import('../gameobjects/SecurityCamera.js').SecurityCamera[]} [o.cameras]
   * @param {import('../components/Flashlight.js').Flashlight|null} [o.flashlight]
   * @param {{ on: boolean }} o.power
   * @param {THREE.Camera} [o.camera]  The player's eye.
   * @param {object} o.hooks  zoneOf(p) → a room or corridor name, 'outside';
   *        ufoBusy(); setPlayerLocked(locked); isFrozen(); rayHit(from, dir, max)
   *        → metres to the first solid thing (sightRay); leaveScreens(): off
   *        the computer's or the console's screen, for the lunge.
   */
  constructor({
    controller, clock, layout, figure, terminal = null, cameras = [], flashlight = null, power,
    camera = null, hooks, whiteOut = null, redOut = null, ambience = null, rand = Math.random, sounds = null,
  }) {
    super();
    this.controller = controller;
    this.clock = clock;
    this.layout = layout;
    this.figure = figure;
    this.terminal = terminal;
    this.cameras = cameras;
    this.flashlight = flashlight;
    this.power = power;
    this.camera = camera;
    this.hooks = hooks;
    this.whiteOut = whiteOut;
    this.redOut = redOut;
    this.ambience = ambience;
    this.rand = rand;
    this.logic = new RagnoLogic({ layout, rand });
    /** Tonight's visits still to come. */
    this.visits = [];
    this.sounds = sounds;
    this._glance = 0;
    this._chirpIn = 4;
    this._locked = false;
    this._lunge = -1;
    this._night = 1;
    this._ray = null;
    this._crawl = new DuctCrawl(rand);
    this._ductAnchor = new THREE.Object3D();
    this._ducting = false;
    this._ductNext = 0;
    this._walk = new LoopVoice({ key: RAGNO_SOUNDS.keys.walk, placed: RAGNO_SOUNDS.inside });
  }

  /** Out on a hunt (for a nap's alarm, the music). */
  get hunting() {
    const s = this.logic.state;
    return s === 'aggro' || s === 'chase';
  }

  onStart() {
    // His sounds made now, as the scene starts: cutting the 58 s call into
    // its bursts is work no frame should wait on
    // (the first sound used to be the kill's, on its lunge).
    this._audio();
    this._off = this.controller.onNightStart?.((night) => this.reset(night)) ?? null;
    this._offState = this.controller.onStateChange?.((state) => {
      if (state !== 'playing') this._end();
    }) ?? null;
    // Paused, nothing updates but the audio clock runs on: what is sounding
    // in the duct is cut, and the crawl picks up again with the game.
    const engine = this.gameObject?.scene?.userData?.engine;
    this._offPause = engine?.onPauseChange?.((paused) => {
      if (paused) this._silenceDuct();
    }) ?? null;
    this.reset(this.controller.nightNumber || 1);
  }

  onDestroy() {
    this._off?.();
    this._offState?.();
    this._offPause?.();
    this._end();
    this._walk.dispose();
    for (const s of [...Object.values(this._built ?? {}), ...(this._built?.duct ?? [])]) {
      if (!s?.isAudio) continue;
      if (s.isPlaying) s.stop();
      try { s.disconnect(); } catch (_) { /* never connected */ }
    }
    if (this._locked) this.hooks.setPlayerLocked?.(false);
  }

  /** A night starts (or is retried): tonight's visits, nobody out. */
  reset(night) {
    this._night = night;
    this.redOut?.clear?.();
    this.visits = scheduleVisits(night, this.rand);
    this._end();
    if (this._locked) {
      this._locked = false;
      this.hooks.setPlayerLocked?.(false);
    }
    this._lunge = -1;
  }

  /**
   * Testing (the console's `ragno`): a night-3 Ragno now, by the way asked.
   * @param {{ approach?: 'window'|'yard', side?: -1|1 }} [opts]
   * @returns {boolean} whether one came
   */
  summon({ approach, side, creep = false } = {}) {
    if (this.controller.state !== 'playing' || this.logic.active || this.hooks.ufoBusy?.()) return false;
    this._spawn({
      approach: approach ?? (this.rand() < 0.5 ? 'window' : 'yard'),
      side: side ?? (this.rand() < 0.5 ? -1 : 1),
      ...(creep ? { kind: 'creep', mood: 'calm', partway: true } : { kind: 'attack', mood: moodFor(3) }),
    });
    return true;
  }

  /** Away at once, without a sound (the console's `ragno off`). */
  dismiss() {
    this._end();
  }

  onUpdate(dt) {
    if (this._lunge >= 0) return this._lunging(dt);
    if (this.controller.state !== 'playing' || this.hooks.isFrozen?.()) return;
    // The duct's sound runs on a moment after he has gone in by a grille.
    this._tickDuct(dt);
    const logic = this.logic;
    const next = this.visits[0];
    const due = !!next && (this.clock?.currentTime ?? -Infinity) >= next.hour && !this.hooks.ufoBusy?.();
    if (!logic.active) {
      this._makingWay = false;
      if (due) {
        this.visits.shift();
        this._spawn(next);
      }
      return;
    }
    if (due) {
      // One of him at a time. A creep due while he is out is let go; an
      // attack due while he is only creeping sends the creeper off,
      // silently, and comes once he has gone.
      if (next.kind === 'creep') this.visits.shift();
      else if (logic.creep && !this._makingWay) {
        this._makingWay = true;
        logic.runOff();
      }
    }

    logic.update(dt, this._sense(dt));
    for (const e of logic.events) this._onEvent(e);
    if (!logic.active) return;
    this._pose(dt);
    this._sound(dt);
  }

  // ── Spawning and ending ─────────────────

  _spawn(visit) {
    this.logic.spawn(visit);
    this._glance = 0;
    this._chirpIn = 2 + this.rand() * 3;
    this.figure.setIndoors(false);
    this._poseFigure();
    this.figure.plant(this._cast);
    this.figure.show(true);
  }

  /** Gone. `keepDuct`: he went into a grille, and the duct carries his
   *  sound on a moment. */
  _end({ keepDuct = false } = {}) {
    if (this.logic.active) this.logic.despawn();
    this.figure.show(false);
    this._walk.silence();
    if (!keepDuct) this._stopDuct();
    this.ambience?.setTension?.(0, 'ragno');
  }

  // ── Senses ──────────────────────────────

  _sense(dt) {
    const logic = this.logic;
    const eye = this.camera ? this.camera.getWorldPosition(_eye) : _eye.set(0, 1.6, 0);
    if (this.camera) this.camera.getWorldDirection(_view);
    const zone = this.hooks.zoneOf?.(eye) ?? 'outside';
    this.figure.bodyPosition(_body);
    if (!logic.visible) _body.copy(logic.pos);

    // A camera's flash on him.
    let flashHit = false, flashFrom = null;
    const air = this.terminal?.onAir;
    if (air?.flash && air.live && logic.visible && this._cameraSees(air.camera, _body, true)) {
      flashHit = true;
      flashFrom = air.camera.lens.getWorldPosition(new THREE.Vector3());
    }

    // The torch, from the player's eye.
    let flashlightHit = false;
    const torch = this.flashlight;
    if (torch?.on && logic.visible) {
      _to.copy(_body).sub(eye);
      const d = _to.length();
      if (d <= torch.distance + 1 && _to.normalize().dot(_view) >= Math.cos(torch.angle + 0.08)) {
        flashlightHit = this._clear(eye, _body, d);
      }
    }

    // A look through the office window, held a moment.
    let glance = false;
    if (logic.visible && !logic.indoors && zone !== 'outside' && this.layout.window
      && throughWindow(eye, _body, this.layout.window)) {
      _to.copy(_body).sub(eye).normalize();
      if (_to.dot(_view) >= Math.cos(THREE.MathUtils.degToRad(GLANCE.angle))) this._glance += dt;
      else this._glance = 0;
      glance = this._glance >= GLANCE.seconds;
    } else this._glance = 0;

    // Seen close by the player outside.
    let spook = false;
    if (logic.visible && !logic.indoors && zone === 'outside') {
      _to.copy(_body).sub(eye);
      const d = _to.length();
      spook = d <= SPOOK.distance
        && _to.normalize().dot(_view) >= Math.cos(THREE.MathUtils.degToRad(SPOOK.angle))
        && !this._blockedOutside(eye, _body);
    }

    // In the player's sight out in the yard: only the fence between.
    const exposed = logic.visible && !logic.indoors && zone === 'outside'
      && eye.distanceTo(_body) <= EXPOSED && !this._blockedOutside(eye, _body);

    // On the monitor: the camera on screen has him in frame.
    const onScreen = !!air && logic.visible && this._cameraSees(air.camera, _body);

    return {
      flashHit, flashFrom, flashlightHit, glance, spook, exposed, onScreen,
      powerOn: !!this.power?.on,
      player: { pos: eye, zone },
      nearestCamera: this._nearestCamera(logic.pos),
      clearToPlayer: logic.indoors && this._walkable(logic.pos, eye),
      canWalk: this._canWalk,
    };
  }

  /** Can he walk straight from `from` to `to` (on the floor), through no
   *  wall or prop? Two rays, low and at his body's height, with almost no
   *  slack: a ray that stops at a wall a step short of the player, as one
   *  standing half in the airlock's door does, is a wall in the way. */
  _walkable(from, to, { flanks = true } = {}) {
    const rayHit = this.hooks.rayHit;
    if (!rayHit) return true;
    // Across the line: his flanks, either side of the middle.
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return true;
    const ax = -dz / len, az = dx / len;
    for (const h of WALK_HEIGHTS) {
      for (const side of flanks ? WALK_FLANKS : WALK_MIDDLE) {
        _wa.set(from.x + ax * side, h, from.z + az * side);
        _wb.set(to.x + ax * side, h, to.z + az * side);
        _w.copy(_wb).sub(_wa).divideScalar(len);
        if (rayHit(_wa, _w, len) < len - WALK_SLACK) return false;
      }
    }
    return true;
  }

  /** For finding his way between standing spots, which are laid out along
   *  open floor: only his middle need be clear. A flank grazing a rack's
   *  corner would make a spot look unreachable from partway to it. */
  _canWalk = (from, to) => this._walkable(from, to, { flanks: false });

  /** Can camera `cam` see `point` (within its flash's cone and reach, if `flash`)? */
  _cameraSees(cam, point, flash = false) {
    const lens = cam.lens;
    lens.updateMatrixWorld();
    const from = lens.getWorldPosition(_p);
    _to.copy(point).sub(from);
    const d = _to.length();
    if (flash) {
      if (d > (cam.flashReach ?? 12)) return false;
      lens.getWorldDirection(_v);
      if (_to.normalize().dot(_v) < Math.cos(CAMERA_FLASH.angle + 0.05)) return false;
    } else {
      _frustum.setFromProjectionMatrix(_m.multiplyMatrices(lens.projectionMatrix, lens.matrixWorldInverse));
      if (!_frustum.containsPoint(point)) return false;
    }
    // Indoors: only from a camera in the same room. Outside: past the building.
    const camOutside = (this.hooks.zoneOf?.(from) ?? 'outside') === 'outside';
    const there = this.hooks.zoneOf?.(point) ?? 'outside';
    if (!camOutside) return there === this.hooks.zoneOf(from);
    return there === 'outside' && !this._blockedOutside(from, point);
  }

  /** Does the building stand between two points outside? */
  _blockedOutside(a, b) {
    const d = a.distanceTo(b);
    _ray.origin.copy(a);
    _ray.direction.copy(b).sub(a).normalize();
    for (const box of this.layout.occluders ?? []) {
      const hit = _ray.intersectBox(box, _q);
      if (hit && hit.distanceTo(a) < d) return true;
    }
    return false;
  }

  /** Nothing solid between a and b (the rooms' walls and props)? */
  _clear(a, b, d) {
    const rayHit = this.hooks.rayHit;
    if (!rayHit) return true;
    _v.copy(b).sub(a).normalize();
    return rayHit(a, _v, d) >= d - WALK_SLACK;
  }

  _nearestCamera(p) {
    // One vector per camera, kept: nothing made per frame.
    this._lensAt ??= this.cameras.map(() => new THREE.Vector3());
    let best = null, bestD = Infinity;
    for (let i = 0; i < this.cameras.length; i++) {
      const at = this.cameras[i].lens.getWorldPosition(this._lensAt[i]);
      const d = at.distanceToSquared(p);
      if (d < bestD) { bestD = d; best = at; }
    }
    return best;
  }

  // ── Events ──────────────────────────────

  _onEvent(e) {
    const logic = this.logic;
    const vent = this.layout.vents?.[logic.side];
    switch (e) {
      case 'ventIn':
        // The camera watching the vent, and the one in the room he's headed for.
        if (vent) this._staticIfSeen(vent.intake, vent.room);
        this._startDuct(vent?.intake, vent?.grille);
        break;
      case 'emerge':
        this.figure.setIndoors(true);
        this._poseFigure();
        this.figure.plant(this._cast);
        if (vent) this._staticIfSeen(vent.grille, vent.room);
        break;
      case 'ventOut':
        if (vent) this._staticIfSeen(vent.grille, vent.room);
        this._startDuct(vent?.grille, vent?.intake, 2.5);
        break;
      case 'flinch':
      case 'aggro':
        this._playAttack(logic.indoors ? 1 : 0.7);
        break;
      case 'scurry':
        this._chirp(false);
        break;
      case 'catch':
        this._catch();
        break;
      case 'gone':
        this._end({ keepDuct: true });
        break;
      default:
        break;
    }
    if (e === 'aggro') this.ambience?.setTension?.(1, 'ragno');
    if (e === 'flinch' || e === 'prowl') this.ambience?.setTension?.(0.5, 'ragno');
  }

  /** The camera on screen breaks up if it can see `point`, is the camera
   *  in `room` (his room's, as he comes and goes through its wall), or is
   *  an outdoor camera near it (the end wall's, the vent just below it). */
  _staticIfSeen(point, room = null) {
    const air = this.terminal?.onAir;
    if (!air || !point) return;
    const at = air.camera.lens.getWorldPosition(_w);
    const zone = this.hooks.zoneOf?.(at) ?? 'outside';
    const inRoom = !!room && zone === room;
    const near = zone === 'outside' && at.distanceTo(_q.copy(point)) <= VENT_NEAR;
    if (inRoom || near || this._cameraSees(air.camera, _q.copy(point))) this.terminal.interfere(air.index, VENT_STATIC);
  }

  _catch() {
    this._locked = true;
    this.hooks.setPlayerLocked?.(true);
    this.terminal?.exit?.();
    this.hooks.leaveScreens?.();
    this._walk.silence();
    this._lunge = 0;
    const death = this._audio().death;
    if (death) {
      if (death.isPlaying) death.stop();
      death.setVolume(RAGNO_SOUNDS.death);
      death.offset = this._deathSpan?.[0] ?? 0;
      death.duration = this._deathSpan ? this._deathSpan[1] - this._deathSpan[0] : undefined;
      death.play();
    }
    this.ambience?.setTension?.(0, 'ragno');
  }

  /** In the player's face, then the screen cuts. */
  _lunging(dt) {
    this._lunge += dt;
    this.redOut?.setIntensity?.(Math.min(this._lunge / LUNGE_SECONDS, 1));
    const eye = this.camera?.getWorldPosition(_eye);
    if (eye && this.logic.pos) {
      // He rears up into the view; the player's eyes are dragged to him.
      _to.copy(eye).sub(this.logic.pos).setY(0);
      const d = _to.length();
      if (d > 0.7) this.logic.pos.addScaledVector(_to.normalize(), Math.min(dt * 6, d - 0.7));
      this.logic.facing.copy(_to.lengthSq() > 0 ? _to.normalize() : this.logic.facing);
      this._pose(dt, 1);
      this.figure.headPosition(_body);
      this.camera.lookAt(_body);
    }
    if (this._lunge >= LUNGE_SECONDS) {
      this._lunge = -1;
      this.controller.fail(CAUGHT_PROMPT, { promptAfter: CAUGHT_SCREEN.messageDelayMs / 1000 });
      this.whiteOut?.play(CAUGHT_PROMPT, CAUGHT_SCREEN);
      this.logic.despawn();
      this.figure.show(false);
    }
  }

  // ── The figure ──────────────────────────

  _poseFigure() {
    this.figure.setPose(this.logic.pos, this.logic.up, this.logic.facing);
  }

  _pose(dt, flinch = this.logic.flinch) {
    const logic = this.logic;
    this.figure.show(logic.visible);
    if (!logic.visible) return;
    this._poseFigure();
    this.figure.update(dt, {
      velocity: logic.velocity,
      cast: this._cast,
      stance: logic.stance,
      flinch,
      twitch: logic.state === 'watch' || logic.mode === 'stare' ? 0.6 : 0.3,
    });
  }

  /** Where a foot lands, along `dir` from `origin`: indoors the rooms'
   *  colliders (floor, walls, furniture); outside the ground and the slope
   *  of the vent's wall, worked out — the bunker's colliders are sheer
   *  hulls, not its slope. */
  _cast = (origin, dir, out) => {
    if (this.logic.indoors) {
      const hit = this.hooks.rayHit?.(origin, dir, 3);
      if (hit !== undefined && hit < 3) {
        out.copy(origin).addScaledVector(dir, hit);
        return true;
      }
      if (dir.y < -1e-3) {
        out.copy(origin).addScaledVector(dir, origin.y / -dir.y);
        return true;
      }
      return false;
    }
    let best = Infinity;
    // The ground: a few steps of the terrain's height under the ray.
    if (dir.y < -1e-3) {
      let t = origin.y / -dir.y;
      for (let k = 0; k < 3; k++) {
        const x = origin.x + dir.x * t, z = origin.z + dir.z * t;
        t = (origin.y - terrainHeightAt(x, z)) / -dir.y;
      }
      if (t > 0) best = t;
    }
    // The slope up to this side's vent.
    const slope = this.layout.slopes?.[this.logic.side];
    if (slope) {
      const { normal: n, c, x0, x1, z0, z1 } = slope;
      const nd = n.x * dir.x + n.y * dir.y + n.z * dir.z;
      if (nd < -1e-4) {
        const t = (c - (n.x * origin.x + n.y * origin.y + n.z * origin.z)) / nd;
        const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
        if (t > 0 && t < best && y > -0.2 && x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && z >= z0 && z <= z1) best = t;
      }
    }
    if (best === Infinity) return false;
    out.copy(origin).addScaledVector(dir, best);
    return true;
  };

  // ── Sound ───────────────────────────────

  _sound(dt) {
    const logic = this.logic;
    // His legs: indoors only, at the pace of his steps.
    const speed = logic.velocity.length();
    const walking = logic.indoors && logic.visible ? Math.min(speed / 1.5, 1) * RAGNO_SOUNDS.walk : 0;
    if (this._walk.set(walking, dt, this.figure) && this._walk.sound && walking > 0) {
      this._walk.sound.setPlaybackRate?.(Math.max(walkRate(speed), 0.6));
    }
    // Calls outside, now and then — not while making way for an attack.
    if (!logic.indoors && logic.visible && !this._makingWay) {
      this._chirpIn -= dt;
      if (this._chirpIn <= 0) {
        const [lo, hi] = RAGNO_SOUNDS.chirpEvery;
        this._chirpIn = lo + (hi - lo) * this.rand();
        this._chirp(logic.mood !== 'calm' && this.rand() < RAGNO_SOUNDS.screechChance);
      }
    }
  }

  /** The sounds, built the first time they are wanted. */
  _audio() {
    if (this._built) return this._built;
    const engine = this.gameObject?.scene?.userData?.engine;
    const listener = engine?.audioListener;
    const assets = engine?.assets;
    this._built = {};
    if (this.sounds) return (this._built = this.sounds);
    if (!listener) return this._built;
    const { keys } = RAGNO_SOUNDS;
    const placed = (buffer) => {
      const a = new THREE.PositionalAudio(listener);
      a.setRefDistance(RAGNO_SOUNDS.refDistance);
      if (buffer) a.setBuffer(buffer);
      this.figure.object3d.add(a);
      return a;
    };
    const buf = key => (assets?.has?.(key) ? assets.get(key) : null);
    // The call, cut into its chirps and its loud bursts.
    const call = buf(keys.call);
    if (call) {
      const bursts = findBursts(call.getChannelData(0), call.sampleRate);
      this._chirps = bursts.filter(b => b.peak < RAGNO_SOUNDS.loudPeak);
      this._screeches = bursts.filter(b => b.peak >= RAGNO_SOUNDS.loudPeak);
      const voice = placed(call);
      voice.setRefDistance(RAGNO_SOUNDS.callRefDistance);
      voice.setRolloffFactor(RAGNO_SOUNDS.callRolloff);
      const muffle = listener.context.createBiquadFilter();
      muffle.type = 'lowpass';
      muffle.frequency.value = RAGNO_SOUNDS.muffle;
      voice.setFilter(muffle);
      this._built.call = voice;
    }
    this._built.attacks = keys.attacks.map(k => buf(k)).filter(Boolean).map(b => placed(b));
    const death = buf(keys.death);
    if (death) {
      this._deathSpan = loudSpan(death.getChannelData(0), death.sampleRate, -30);
      const a = new THREE.Audio(listener);
      a.setBuffer(death);
      this._built.death = a;
    }
    // The duct: the vent recording, a few voices on one buffer so a step and
    // the layers over it overlap, all placed where he is in the wall.
    const vents = buf(keys.duct);
    if (vents) {
      this._built.duct = Array.from({ length: DUCT_CRAWL.voices }, () => {
        const a = new THREE.PositionalAudio(listener);
        a.setBuffer(vents);
        this._ductAnchor.add(a);
        return a;
      });
      this.figure.object3d.parent?.add(this._ductAnchor);
    }
    return this._built;
  }

  _canPlay(a) {
    return !!a && a.context?.state !== 'suspended';
  }

  _chirp(screech) {
    const built = this._audio();
    const calm = this.logic.mood === 'calm' ? RAGNO_SOUNDS.calm : 1;
    const walls = this.hooks.zoneOf?.(this.camera?.getWorldPosition(_eye) ?? _eye) !== 'outside' ? RAGNO_SOUNDS.throughWalls : 1;
    // The shriek: one of the call's loud bursts, or either attack, pitched down.
    if (screech) {
      const kinds = [...(this._screeches?.length ? ['call'] : []), ...(built.attacks ?? []).map((_, i) => i)];
      const pick = kinds[Math.floor(this.rand() * kinds.length)];
      if (pick !== undefined && pick !== 'call') {
        const shriek = built.attacks[pick];
        if (!this._canPlay(shriek)) return;
        if (shriek.isPlaying) shriek.stop();
        shriek.setRefDistance(RAGNO_SOUNDS.callRefDistance);
        shriek.setRolloffFactor(RAGNO_SOUNDS.callRolloff);
        shriek.setVolume(RAGNO_SOUNDS.screech * calm * walls);
        shriek.setDetune(RAGNO_SOUNDS.screechDetune);
        shriek.play();
        return;
      }
    }
    const a = built.call;
    const list = screech ? this._screeches : this._chirps;
    if (!this._canPlay(a) || !list?.length) return;
    const b = list[Math.floor(this.rand() * list.length)];
    if (a.isPlaying) a.stop();
    a.setVolume((screech ? RAGNO_SOUNDS.screech : RAGNO_SOUNDS.chirp) * calm * walls);
    a.setDetune(screech ? RAGNO_SOUNDS.screechDetune : (this.rand() - 0.5) * 300);
    a.offset = b.start;
    a.duration = b.end - b.start;
    a.play();
  }

  _playAttack(volume) {
    const list = this._audio().attacks ?? [];
    if (!list.length) return;
    const a = list[Math.floor(this.rand() * list.length)];
    if (!this._canPlay(a)) return;
    if (a.isPlaying) a.stop();
    // Up close and at its own pitch: a shriek outside may have changed both.
    // Indoors, tight to where he is, and not as loud.
    const inside = this.logic.indoors;
    a.setRefDistance(inside ? RAGNO_SOUNDS.inside.refDistance : RAGNO_SOUNDS.refDistance);
    a.setRolloffFactor(inside ? RAGNO_SOUNDS.inside.rolloff : 1);
    a.setDetune(0);
    a.setVolume(RAGNO_SOUNDS.attack * (inside ? RAGNO_SOUNDS.attackInside : 1) * volume * (this.logic.mood === 'calm' ? RAGNO_SOUNDS.calm : 1));
    a.play();
  }

  /** The duct crawl, from `from` toward `to` over `seconds` (or the time in
   *  the duct): heard from the side he's in the wall on. */
  _startDuct(from, to, seconds) {
    if (!this._audio().duct?.length || !from) return;
    this._ductFrom = from;
    this._ductTo = to ?? from;
    this._ductT = 0;
    this._ductFor = seconds ?? Math.max(this.logic._timer, 1);
    this._ductAnchor.position.set(from.x, from.y, from.z);
    this._crawl.start();
    this._ducting = true;
    this._tickDuct(0);   // the first step, now
  }

  _tickDuct(dt) {
    if (!this._ducting) return;
    this._ductT += dt;
    const k = Math.min(this._ductT / this._ductFor, 1);
    const a = this._ductFrom, b = this._ductTo;
    this._ductAnchor.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
    // Through the duct: it ends when he comes out, or has run its time, and
    // what is sounding rings out.
    if (this.logic.state !== 'duct' && k >= 1) {
      this._ducting = false;
      return;
    }
    const voices = this._built.duct;
    const heard = this.terminal?.onAir ? RAGNO_SOUNDS.ductCamera : RAGNO_SOUNDS.ductEars;
    const level = RAGNO_SOUNDS.duct * heard.gain * (this.logic.mood === 'calm' ? RAGNO_SOUNDS.calm : 1)
      * ductEnvelope(this._ductT, this._ductFor, RAGNO_SOUNDS.ductFade);
    for (const cue of this._crawl.update(dt)) {
      // The next voice round, cutting off the oldest if they're all sounding.
      const v = voices[this._ductNext];
      this._ductNext = (this._ductNext + 1) % voices.length;
      if (!this._canPlay(v)) continue;
      if (v.isPlaying) v.stop();
      v.setVolume(level * cue.gain);
      v.setRefDistance(heard.refDistance);
      v.setRolloffFactor(heard.rolloff);
      v.setDetune(cue.detune);
      v.offset = cue.clip[0];
      v.duration = cue.clip[1];
      v.play();
    }
  }

  /** What is sounding in the duct cut; the crawl carries on if he is in it. */
  _silenceDuct() {
    for (const v of this._built?.duct ?? []) if (v.isPlaying) v.stop();
  }

  _stopDuct() {
    this._ducting = false;
    this._silenceDuct();
  }
}

/** A ray caster for the feet and the sight checks, that never hits the
 *  player's own capsule or a sensor. */
export function ragnoRay(world, playerBody = null) {
  if (!world?.castRay) return () => Infinity;
  let ray = null;
  return (from, dir, max) => {
    ray ??= new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    ray.origin.x = from.x; ray.origin.y = from.y; ray.origin.z = from.z;
    ray.dir.x = dir.x; ray.dir.y = dir.y; ray.dir.z = dir.z;
    const hit = world.castRay(ray, max, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, playerBody);
    return hit ? hit.timeOfImpact : Infinity;
  };
}
