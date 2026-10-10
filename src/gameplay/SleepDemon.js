import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { Component } from '../core/Component.js';
import { packGroups, Layers } from '../core/PhysicsLayers.js';
import { SleepDemonLogic, SLEEP_DEMON, angleToUpright, duckFor } from './SleepDemonLogic.js';
import { SleepDemonDeath, SLEEP_DEMON_DEATH } from './SleepDemonDeath.js';
import { tunnel } from './Fatigue.js';
import { terrainHeightAt } from '../gameobjects/MarsTerrain.js';

// ─────────────────────────────────────────────
// SleepDemon  –  in the corner of the eye, nearer as you tire
// ─────────────────────────────────────────────
// SleepDemonLogic holds the rules; this maps them onto the scene:
//
//   stamina    StaminaDrain ticks it, the ration dispenser restores it
//   a spot     a level line out from the player's eye, turned off the centre
//              of the view by a share of its half-width, as far as the rules
//              ask. Something solid along it (a sight ray) and it stands
//              wallGap in front of that; furniture on the floor there (a ray
//              down from its full height) and it steps in toward the player
//              until the floor is clear. It must land inside the view, unless
//              the rules ask for out of sight — the terminal's screen is up,
//              or a behind-roll landed: then beside or behind them.
//   in view    inside the camera's frustum, with nothing solid between the
//              eye and its face. While the terminal's radar or review screen
//              is up the player is looking at that, not the room.
//   looked at  the angle between the line of sight and its upright body.
//
// It comes every night, and runs only through the shift. In the morning, or
// behind the failed-night prompt, it is hidden and silent; every night that
// starts (a new one, a retry, the N key) sends it away. It holds while the
// debug fly camera has frozen the player.
//
// It is silent but for its footsteps (FOOTSTEP), and those only while it
// moves: creeping in unseen, or walking in below walkBelow. Showing up is
// silent — it fades in. Everything else about it is stillness: no
// breathing, no growl.
//
// The figure is a hidden, body-less GameObject the scene builds and owns,
// under a group at the world origin, so its position is a world position.
// Its body casts a shadow and the shadow maps are frozen between redraws,
// so every show, step or hide calls onFigureChanged — turning on the spot
// doesn't (the body is round). It never pops: wherever it shows it fades in
// from nothing over the rules' fadeIn, up to their presence (faint while the
// player is fresh, solid once they are tired), and a look fades it away
// where it stood (fadeOut); only a night start, the shift ending or the
// death take it away at once. In the periphery it shows just outside the
// look cone (showMargin past it), so it appears where the eye isn't quite
// looking. From smileBelow it smiles (the figure's `smile`), through the kill.
//
// The walk-in (below walkBelow, while seen) walks it in along the line
// from the eye, each step checked like a new spot: nothing at eye height in
// the way, the floor clear, in view. A step that fails, it holds. It follows
// a player who backs away — but only half as fast as they retreat, so they
// gain ground: it follows, it doesn't stick. While it walks the player is
// slowed down and the dread lifted on the breathing and the heartbeat
// (FatigueEffects.setDread): the last stretch of the shift is heavy-legged.
// Its shadow is redrawn once a centimetre, not on each of the frames between.
//
// Out of sight — turned away from, or something in between — it sneaks (the
// rules' sneak): it takes up the player's own retreat and more (sneakSpeed),
// at any stamina, and the footsteps quicken with it. Only a look that
// banishes it, the hold coming back, or a night start gives the ground back.
//
// The torch betrays it: while it shows, the flashlight stutters whenever its
// beam (the cone, and a margin) falls on any of it. At the stamina of the
// first showings the look that sends it away reaches a little wider than the
// beam, so a sweep doesn't stutter without already banishing it; as stamina
// falls the look closes in (focusAngleFor) and the beam outgrows it, until
// the stare it can no longer flee (below holdBelow), and the ambush nobody
// is watching, are lit by a torch that gives it away anyway.
//
// Dead air: while it stands in view, the ambience is ducked by how near the
// view has come round to it (duckFor), down to near-silence at the look. Its
// footsteps are not part of the ambience, so it walks over the silence.
// Hidden, out of view, outside the shift or on a new night, it lets go.
//
// At empty the player falls asleep on it (SleepDemonDeath): frozen, the lids
// slam shut as the view drops to the floor and the world's sound falls away;
// black; the eyes flare open on it looming right over them; a cut to black,
// and only then the failed night. Whatever it took over (the player, the
// camera, the lids, the listener's volume) is put back by the next night
// start, the shift ending under it, or onDestroy.
// ─────────────────────────────────────────────

export const SLEEP_DEMON_KILL = 'You fell asleep. It was waiting. [E] to retry';

/** The name it ducks the ambience under (Ambience.setDuck). */
export const SLEEP_DEMON_DUCK = 'sleep-demon';

/** Manifest key behind each sound. The footsteps are a placeholder for the
 *  sound owner to replace (see the manifest): the key stays, the file swaps. */
export const SLEEP_DEMON_SOUNDS = { footstep: 'sfx:footsteps' };

/** The placeholder figure, metres: person-sized, so right beside the player
 *  its eyes are still in view. */
export const SLEEP_DEMON_FIGURE = Object.freeze({ height: 1.8, radius: 0.26 });

/** The footsteps: its volume right beside the player, the share of that
 *  when it first shows, the distance it is that loud at, and the seconds
 *  between steps while it walks in, seen … creeps in, unseen: slow, careful
 *  steps. Standing still it makes no sound. */
const FOOTSTEP = { volume: 0.6, far: 0.35, refDistance: 1.5, walk: [1.1, 1.8], sneak: [0.9, 1.6] };

/** The walk-down's grip: the share of the player's speed it leaves them
 *  while it walks in on them. The breathing and the heartbeat floor come
 *  with it (FatigueEffects.setDread). */
export const SLEEP_DEMON_DREAD = Object.freeze({ slow: 0.6 });

/** What blocks sight: walls, props, the floor, shelves and what is on them.
 *  Not the player's capsule. The interaction ray's groups. */
const SIGHT_GROUPS = packGroups([Layers.DEFAULT, Layers.SHELF], [Layers.DEFAULT, Layers.SHELF]);

/** The line of sight runs to its face: this share of the way up. */
const FACE = 0.85;
/** Metres short of its face something must be to come between. */
const SIGHT_SLACK = 0.25;
/** Metres it steps in at a time, past furniture on the floor. */
const STEP = 0.25;
/** Furniture stands higher than this off the floor (a threshold doesn't). */
const CLEAR = 0.15;
/** Metres the stare-down walks between shadow redraws: ShadowScheduler's own
 *  threshold for a moving caster. Every frame would redraw every map. */
const SHADOW_STEP = 0.01;

/** The torch's beam on it: radians past the cone's edge that still count,
 *  for the width of its body. The look that banishes it is a little wider,
 *  so a sweep is already sending it away when the stutter starts. */
export const SLEEP_DEMON_BEAM = Object.freeze({ margin: 0.05 });

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

const _eye = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _sight = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _spot = new THREE.Vector3();
const _look = new THREE.Vector3();
const _slumped = new THREE.Vector3();
const _viewProj = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();

const lerp = (a, b, t) => a + (b - a) * t;

/** Half the width of the camera's view, radians. */
function halfWidth(camera) {
  return Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
}

/**
 * The sight ray: metres from `from` along `dir` to the first solid thing,
 * or Infinity when nothing is within `max`. Open doorways (sensors) and the
 * player's own body don't count.
 * @param {import('@dimforge/rapier3d').World|null} world
 * @param {import('@dimforge/rapier3d').RigidBody|null} [excludeBody]
 * @returns {(from: THREE.Vector3, dir: THREE.Vector3, max: number) => number}
 */
export function sightRay(world, excludeBody = null) {
  if (!world?.castRay) return () => Infinity;
  let ray = null;                            // built on first use, then reused
  return (from, dir, max) => {
    ray ??= new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
    ray.origin.x = from.x; ray.origin.y = from.y; ray.origin.z = from.z;
    ray.dir.x = dir.x; ray.dir.y = dir.y; ray.dir.z = dir.z;
    const hit = world.castRay(
      ray, max, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, SIGHT_GROUPS, undefined, excludeBody,
    );
    return hit ? hit.timeOfImpact : Infinity;
  };
}

export class SleepDemon extends Component {
  /**
   * @param {object} opts
   * @param {import('./GameController.js').GameController} opts.controller
   * @param {import('./Stamina.js').Stamina} opts.stamina
   * @param {import('../core/GameObject.js').GameObject} opts.figure  Built hidden and owned by the scene.
   * @param {THREE.PerspectiveCamera|null} [opts.camera]  The player's eye.
   * @param {{ state: string }|null} [opts.terminal]
   * @param {(from: THREE.Vector3, dir: THREE.Vector3, max: number) => number} [opts.rayHit]
   *        metres to the first solid thing (sightRay); Infinity: nothing in the way
   * @param {() => boolean} [opts.isFrozen]  The debug fly camera is on.
   * @param {(() => void)|null} [opts.onFigureChanged]  It moved, showed or hid.
   * @param {number} [opts.height]  The figure's, metres.
   * @param {typeof SLEEP_DEMON} [opts.tuning]
   * @param {Record<string, THREE.Audio>} [opts.sounds]  Built from SLEEP_DEMON_SOUNDS when left out.
   * @param {() => number} [opts.rand]  Which side it shows first.
   * @param {import('../components/Flashlight.js').Flashlight|null} [opts.flashlight]
   *        The player's torch: it stutters while its beam is on it.
   * @param {{ setDuck: (level: number, source: string) => void }|null} [opts.ambience]
   *        Ducked as the view comes round to it (dead air).
   * @param {{ enabled: boolean, speedScale?: number }|null} [opts.player]
   *        The FirstPersonController, slowed while it walks in and frozen as they pass out.
   * @param {{ setDread: (level: number) => void }|null} [opts.fatigue]
   *        FatigueEffects, told 1 while it walks in and 0 whenever it isn't.
   * @param {{ set(tunnel: number, lid: number): void, clear(): void }|null} [opts.overlay]
   *        The FatigueOverlay FatigueEffects writes: the same one, so their caches agree.
   * @param {{ play(onDark?: () => void): boolean }|null} [opts.fade]  The ScreenFade for the cut.
   * @param {THREE.AudioListener|null} [opts.listener]  Whose volume falls away.
   * @param {typeof SLEEP_DEMON_DEATH} [opts.deathTuning]
   */
  constructor({
    controller, stamina, figure, camera = null, terminal = null, rayHit = () => Infinity,
    isFrozen = () => false, onFigureChanged = null, height = SLEEP_DEMON_FIGURE.height,
    tuning = SLEEP_DEMON, sounds = null, rand = Math.random, flashlight = null,
    ambience = null,
    player = null, overlay = null, fade = null, listener = null, deathTuning = SLEEP_DEMON_DEATH,
    fatigue = null,
  }) {
    super();
    Object.assign(this, {
      controller, stamina, figure, camera, terminal, rayHit, isFrozen, onFigureChanged, height, tuning, sounds,
    });
    this.flashlight = flashlight;
    this.ambience = ambience;
    this.rand = rand;
    this.fatigue = fatigue;
    Object.assign(this, { player, overlay, fade, listener, deathTuning });
    /** What the death took over, to give back: the camera's pose, the drop
     *  to the floor and which way the view tips. Null when it took nothing. */
    this._pose = null;
    /** The listener's volume before it fell away. Null when untouched. */
    this._volume = null;
    this._death = new SleepDemonDeath({
      tuning: deathTuning,
      onPhase: phase => this._onDeathPhase(phase),
      onDone: () => this._died(),
    });
    this._stepIn = 0;
    /** The last cadence's mode (0 standing, 1 sneaking, 2 walking in), so a
     *  change of pace re-times the next step. */
    this._stepMode = 0;
    /** Metres the eye backed away from it this frame (playerDrift), and the
     *  eye's last position — no frame before the first. */
    this._away = 0;
    this._eyeWas = new THREE.Vector3();
    this._hasEye = false;
    /** The figure's fade: 1 fully there, 0 away, and which way it is
     *  going: +1 in, −1 out, 0 settled. */
    this._opacity = 0;
    this._fadeDir = 0;
    this._fadeFrom = 0;
    /** Its materials, and the opacity each was built at, collected on the
     *  first fade so the fade scales what a model came with. */
    this._fadeMaterials = null;
    /** Radians off the centre of the view it last showed at (dead air). */
    this._shownAt = 0;
    this._off = null;
    this.logic = new SleepDemonLogic({
      tuning, rand,
      lookAngle: () => this.lookAngle(),
      place: spot => this._place(spot),
      hide: () => this._fadeAway(),
      onKill: () => this._death.start(),
      approach: (step, unseen) => this._approach(step, unseen),
      playerDrift: () => this._away,
    });
    /** Metres walked since its shadow was last redrawn. */
    this._unshadowed = 0;
  }

  onStart() {
    if (!this.sounds) this.sounds = this._buildSounds();
    this._off = this.controller.onNightStart?.(() => this.reset()) ?? null;
    this.reset();
  }

  onDestroy() {
    // A rebuild from the menu: the camera outlives the scene.
    this._wake();
    this._off?.();
    this._off = null;
    this.flashlight?.setInterference(false, 'sleep-demon');
    this._duck(1);
    for (const sound of Object.values(this.sounds ?? {})) {
      if (sound?.isPlaying) sound.stop();
      sound?.parent?.remove(sound);
      try { sound?.disconnect?.(); } catch (_) { /* never connected */ }
    }
  }

  /** A new or retried night: away, silent, nothing counted. */
  reset() {
    this._wake();
    this.logic.start();
    this._hide();
    this._smile(false);
    this._hushStep();
    this._release();
    this._hasEye = false;
    this._duck(1);
  }

  onUpdate(dt) {
    if (this.controller.state !== 'playing') {
      // The shift ended under it (6 AM, another threat): called off. Once
      // over, the freeze holds behind the failed night until the retry.
      if (this._death.running) this._wake();
      // Its rules start over too: hidden, it must not go on thinking it stands.
      if (this.logic.around) this.logic.start();
      this._hide();
      this._hushStep();
      this.flashlight?.setInterference(false, 'sleep-demon');
      this._release();
      this._hasEye = false;
      this._duck(1);
      return;
    }
    if (this.isFrozen()) {
      // The torch is frozen with the player: a stutter left on would hold
      // it mid-dip, or dark, the whole flight.
      this.flashlight?.setInterference(false, 'sleep-demon');
      this._release();
      this._hasEye = false;
      return;
    }
    if (this._death.active) {
      this._smile(true);                    // it kept its smile for this
      // Still on it as it looms over them: the torch in their hand stutters.
      this.flashlight?.setInterference(this._inBeam(), 'sleep-demon');
      this._release();
      this._dying(dt);
      return;
    }
    const logic = this.logic;
    this._trackAway();
    logic.update(dt, this.stamina.value);
    this._tickFade(dt);
    this._smile(logic.smiling);
    if (this.figure.object3d.visible) this._facePlayer();
    this.flashlight?.setInterference(this._inBeam(), 'sleep-demon');
    this._footsteps(dt);
    // Walking in on them: heavy-legged, with the dread on the breath and
    // the heart. Anything else, let go.
    if (this.player) this.player.speedScale = logic.walking ? SLEEP_DEMON_DREAD.slow : 1;
    this.fatigue?.setDread(logic.walking ? 1 : 0);
    this._deadAir();
  }

  // FatigueEffects writes the lids every frame, after this update; the
  // death's own are written last, so they win.
  onLateUpdate() {
    if (!this._death.running || this.isFrozen()) return;
    this.overlay?.set(tunnel(this.stamina.value), this._death.lid);
  }

  /** Where the death is: 'idle', then 'passOut', 'black', 'flare', 'cut' and
   *  'over' until the night starts again. For a sound to follow. */
  get deathPhase() {
    return this._death.phase;
  }

  /**
   * Where the player's view is from it, radians: 0 looking anywhere along
   * it. Infinity while it is out of view, hidden or behind something; null
   * while the terminal's screen covers the view.
   */
  lookAngle() {
    if (this._onScreen()) return null;
    const camera = this.camera;
    const o = this.figure.object3d;
    if (!camera || !o.visible) return Infinity;
    camera.getWorldPosition(_eye);
    const feet = o.position;
    if (!this._inView(feet)) return Infinity;
    _sight.set(feet.x, feet.y + this.height * FACE, feet.z).sub(_eye);
    const far = _sight.length();
    if (this.rayHit(_eye, _sight.divideScalar(far), far) < far - SIGHT_SLACK) return Infinity;
    camera.getWorldDirection(_forward);
    return angleToUpright(_eye, _forward, feet, this.height);
  }

  // ── Private ──

  /** Showing, with the torch on and its beam, cone and margin, on any of
   *  its upright body. The beam is taken down the view: the torch is held
   *  close beside the eye. */
  _inBeam() {
    const torch = this.flashlight;
    const camera = this.camera;
    if (!torch?.on || !torch.light || !camera || !this.figure.object3d.visible) return false;
    camera.getWorldPosition(_eye);
    camera.getWorldDirection(_forward);
    const angle = angleToUpright(_eye, _forward, this.figure.object3d.position, this.height);
    return angle <= torch.light.angle + SLEEP_DEMON_BEAM.margin;
  }

  /** The terminal's radar or review screen fills the view. */
  _onScreen() {
    const state = this.terminal?.state;
    return !!state && state !== 'idle';
  }

  /** Fade it in `distance` out from the eye, `edge` of the way out to the
   *  `side` (+1 right, −1 left) of the view — but never inside the look
   *  cone (`focus`, plus showMargin); an ambush may land out of view.
   *  False: no room there. Silent: it fades in, it doesn't step in. */
  _place({ distance, side, edge, focus = 0, ambush = false }) {
    const camera = this.camera;
    if (!camera) return false;
    camera.getWorldPosition(_eye);
    camera.getWorldDirection(_dir);
    _dir.y = 0;
    if (_dir.lengthSq() < 1e-8) _dir.set(0, 0, -1);
    // Level, then turned off the centre: a turn about +Y goes left, so the
    // right side is a negative turn.
    const t = this.tuning;
    const off = ambush ? edge * halfWidth(camera) : Math.max(edge * halfWidth(camera), focus + t.showMargin);
    _dir.normalize().applyAxisAngle(UP, -side * off);

    let d = Math.min(distance, this.rayHit(_eye, _dir, distance + t.wallGap) - t.wallGap);
    while (d >= t.minDistance && this._occupied(_eye.x + _dir.x * d, _eye.z + _dir.z * d)) d -= STEP;
    if (d < t.minDistance) return false;

    _spot.copy(_eye).addScaledVector(_dir, d);
    _spot.y = terrainHeightAt(_spot.x, _spot.z);
    if (!ambush && !this._inView(_spot)) return false;

    const o = this.figure.object3d;
    o.position.copy(_spot);
    o.visible = true;
    this._applyOpacity(0);                  // a new spot: in from nothing, never a pop
    this._fadeDir = 1;
    this._shownAt = off;
    this._facePlayer();
    this.onFigureChanged?.();
    return true;
  }

  /** Is something standing on the floor at (x, z), taller than a threshold
   *  and no taller than the figure? A ray down from its full height. */
  _occupied(x, z) {
    _probe.set(x, terrainHeightAt(x, z) + this.height, z);
    const reach = this.height - CLEAR;
    return this.rayHit(_probe, DOWN, reach) < reach;
  }

  /** Is any of it, standing at `feet`, inside the camera's view? */
  _inView(feet) {
    const camera = this.camera;
    _viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_viewProj);
    _sphere.center.copy(feet);
    _sphere.center.y += this.height / 2;
    _sphere.radius = this.height / 2;
    return _frustum.intersectsSphere(_sphere);
  }

  /** Out of sight at once, whatever fade ran: a night start, the shift
   *  ending, the death. The look fades instead (see _fadeAway). */
  _hide() {
    this._fadeDir = 0;
    this._applyOpacity(0);
    const o = this.figure.object3d;
    if (!o.visible) return;
    o.visible = false;
    this.onFigureChanged?.();
  }

  /** Out of sight, fading away where it stood. It stays visible (and
   *  casting) until the fade is done: _tickFade hides it then. */
  _fadeAway() {
    this._fadeDir = this.figure.object3d.visible ? -1 : 0;
    this._fadeFrom = this._opacity;         // out over fadeOut, however there it was
  }

  /** A frame of the fade. In: from nothing up to the rules' presence over
   *  fadeIn; settled, it follows the presence as stamina moves it. Out: to
   *  nothing over fadeOut, and then it is gone and the frozen shadow maps
   *  are told. */
  _tickFade(dt) {
    const o = this.figure.object3d;
    if (!o.visible) return;
    const t = this.tuning;
    if (this._fadeDir < 0) {
      const x = this._opacity - dt * Math.max(this._fadeFrom, 0.05) / t.fadeOut;
      if (x > 0) return this._applyOpacity(x);
      this._fadeDir = 0;
      this._applyOpacity(0);
      o.visible = false;
      this.onFigureChanged?.();
      return;
    }
    const target = this.logic.presence;
    const rate = Math.max(target, 0.05) / t.fadeIn;
    const x = this._opacity < target
      ? Math.min(target, this._opacity + rate * dt)
      : Math.max(target, this._opacity - rate * dt);
    if (x === target) this._fadeDir = 0;
    if (x !== this._opacity) this._applyOpacity(x);
  }

  /** Its grin, on or off. The figure's own: a placeholder without one shows none. */
  _smile(on) {
    const smile = this.figure.smile;
    if (smile && smile.visible !== on) smile.visible = on;
  }

  /** How there it is, 0 … 1: every material the figure was built with,
   *  scaled from the opacity it came with. Collected on the first fade. */
  _applyOpacity(x) {
    this._opacity = x;
    if (!this._fadeMaterials) {
      this._fadeMaterials = [];
      const seen = new Set();
      this.figure.object3d.traverse(node => {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          if (!material || seen.has(material)) continue;
          seen.add(material);
          this._fadeMaterials.push({ material, opacity: material.opacity });
        }
      });
    }
    for (const { material, opacity } of this._fadeMaterials) {
      material.opacity = x * opacity;
    }
  }

  _facePlayer() {
    if (!this.camera) return;
    const o = this.figure.object3d;
    this.camera.getWorldPosition(_look);
    _look.y = o.position.y;
    o.lookAt(_look);
  }

  /** The player's eye as the rules need it: how far it has backed away from
   *  the figure since the last frame, along the line between them. Only
   *  retreats count. The rules walk it after (playerDrift). */
  _trackAway() {
    this._away = 0;
    const camera = this.camera;
    const o = this.figure.object3d;
    if (!camera || !o.visible) { this._hasEye = false; return; }
    camera.getWorldPosition(_eye);
    if (this._hasEye) {
      const dx = _eye.x - this._eyeWas.x;
      const dz = _eye.z - this._eyeWas.z;
      const fx = o.position.x - _eye.x;
      const fz = o.position.z - _eye.z;
      const len = Math.hypot(fx, fz);
      if (len > 1e-6) this._away = Math.max(0, -(dx * fx + dz * fz) / len);
    }
    this._eyeWas.copy(_eye);
    this._hasEye = true;
  }

  /** The walk-down or the sneak: `step` metres in toward the eye, along the
   *  level line from it, never nearer than stareFloor. The metres it then
   *  stands off, or false when the new spot is no good. `unseen` is the
   *  sneak: with the player turned away (or something in between) the spot
   *  is allowed out of view — but the walls, the floor and the room still
   *  are not, so it can never creep through what hides it. */
  _approach(step, unseen = false) {
    const camera = this.camera;
    if (!camera) return false;
    const o = this.figure.object3d;
    camera.getWorldPosition(_eye);
    _dir.set(o.position.x - _eye.x, 0, o.position.z - _eye.z);
    const now = _dir.length();
    if (now < 1e-6) return false;
    _dir.divideScalar(now);
    const t = this.tuning;
    const d = Math.max(t.stareFloor, now - step);
    if (d >= now) return now;               // at arm's length, or the player came to it
    // The same checks as _place makes of a new spot, so it never walks into
    // a shelf, onto a desk, or (a walk-down, seen) out of view. A sneak
    // waives only the view: what hides it still stops it.
    if (this.rayHit(_eye, _dir, d + t.wallGap) < d + t.wallGap) return false;
    _spot.copy(_eye).addScaledVector(_dir, d);
    if (this._occupied(_spot.x, _spot.z)) return false;
    _spot.y = terrainHeightAt(_spot.x, _spot.z);
    if (!unseen && !this._inView(_spot)) return false;

    o.position.copy(_spot);
    this._facePlayer();
    if ((this._unshadowed += now - d) >= SHADOW_STEP) {
      this._unshadowed = 0;
      this.onFigureChanged?.();
    }
    return d;
  }

  /** One footstep, now: the nearer it stands, the louder, and what the next
   *  one is timed from. Not part of the ambience, so dead air doesn't take
   *  it with it. */
  _playStep() {
    this._stepIn = this._stepEvery();
    const sound = this.sounds?.footstep;
    if (!sound) return;
    sound.setVolume(FOOTSTEP.volume * lerp(FOOTSTEP.far, 1, this.logic.closeness));
    if (sound.isPlaying) sound.stop();
    sound.play();
  }

  /** How long to the next step: walking in, seen, or creeping, unseen. */
  _stepEvery() {
    const [lo, hi] = this.logic.walking ? FOOTSTEP.walk : FOOTSTEP.sneak;
    return lo + (hi - lo) * this.rand();
  }

  /** Steps only while it moves: the first as it sets off, then at the
   *  cadence. Standing still, fading in or gone: nothing. */
  _footsteps(dt) {
    const logic = this.logic;
    const mode = !logic.shown ? 0 : logic.walking ? 2 : logic.sneaking ? 1 : 0;
    if (!mode) {
      this._stepIn = 0;
      this._stepMode = 0;
      return;
    }
    if (mode !== this._stepMode) {
      this._stepMode = mode;
      this._stepIn = Math.min(this._stepIn, this._stepEvery());
    }
    if ((this._stepIn -= dt) > 0) return;
    this._playStep();
  }

  /** Cut a step still sounding: a night start, the shift ending, the death. */
  _hushStep() {
    const sound = this.sounds?.footstep;
    if (sound?.isPlaying) sound.stop();
  }

  /** Let the player go: full speed, no dread on the breath and the heart.
   *  Called whenever the walk-down isn't running, and it never hurts. */
  _release() {
    if (this.player) this.player.speedScale = 1;
    this.fatigue?.setDread(0);
  }

  /** Duck the ambience by how near the view has come round to it. Measured
   *  from where it last showed (_shownAt), so it is mild wherever it first
   *  shows. A second lookAngle() after the
   *  rules', since it may have just shown, stepped or fled this frame. */
  _deadAir() {
    const logic = this.logic;
    if (!logic.shown || !this.camera) return this._duck(1);
    this._duck(duckFor(this.lookAngle(), this._shownAt, logic.focus));
  }

  /** The ambience at `level` of itself; 1 lets go. */
  _duck(level) {
    this.ambience?.setDuck(level, SLEEP_DEMON_DUCK);
  }

  /** The footsteps as a PositionalAudio on the figure, from the preloaded
   *  buffer — one-shots, not a loop. Without a listener or the buffer:
   *  silence. Its cone is left all round (the Web Audio default): standing
   *  behind the player, after the terminal, it must still be heard. */
  _buildSounds() {
    const engine = this.gameObject?.scene?.userData?.engine;
    const sounds = {};
    if (!engine?.audioListener || !engine.assets) return sounds;
    const key = SLEEP_DEMON_SOUNDS.footstep;
    if (engine.assets.has && !engine.assets.has(key)) return sounds;
    const buffer = engine.assets.get(key);
    if (!buffer) return sounds;
    const audio = new THREE.PositionalAudio(engine.audioListener);
    audio.setBuffer(buffer);
    audio.setRefDistance(FOOTSTEP.refDistance);
    this.figure.object3d.add(audio);
    sounds.footstep = audio;
    return sounds;
  }

  // ── The death ──

  _onDeathPhase(phase) {
    if (phase === 'passOut') this._passOut();
    else if (phase === 'flare') this._loomOver();
    else if (phase === 'cut') this.fade?.play();
  }

  /** Frozen where they stand; the fall worked out from where the view
   *  starts; the world's sound eased away on the audio clock. */
  _passOut() {
    const t = this.deathTuning;
    if (this.player) this.player.enabled = false;
    const camera = this.camera;
    if (camera) {
      camera.getWorldPosition(_slumped);
      const floor = terrainHeightAt(_slumped.x, _slumped.z);
      const { x: pitch, y: yaw, z: roll } = camera.rotation;
      this._pose = {
        y: camera.position.y, pitch, yaw, roll,
        drop: Math.max(0, _slumped.y - (floor + t.slumpEye)),
        side: this.logic.side,
      };
    }
    const volume = this.listener?.gain?.gain;
    const audio = this.listener?.context;
    if (volume && audio) {
      this._volume = volume.value;
      const now = audio.currentTime;
      volume.cancelScheduledValues(now);
      volume.setTargetAtTime(this._volume * t.hush, now, t.passOut / 3);
    }
  }

  /** A frame of it, on the game clock, so a pause or the fly camera holds it. */
  _dying(dt) {
    // The fly camera hands every player component back on its way out.
    if (this.player) this.player.enabled = false;
    const death = this._death;
    death.update(dt);
    if (!death.active) return;
    this._slump(death.slump);
    const scale = 1 + (this.deathTuning.eyeFlare - 1) * death.flare;
    for (const eye of this.figure.eyes ?? []) eye.scale.setScalar(scale);
  }

  /** The view `s` of the way (0 … 1) from where it stood to the floor,
   *  looking up, tipped over. At 0 it is exactly where it was. */
  _slump(s) {
    const p = this._pose;
    if (!p) return;
    const t = this.deathTuning;
    this.camera.position.y = p.y - p.drop * s;
    this.camera.rotation.set(lerp(p.pitch, t.slumpPitch, s), p.yaw, lerp(p.roll, p.side * t.slumpRoll, s));
  }

  /** The eyes open on it: just ahead the way they faced as they fell, its
   *  top leaning over them so its face is in their upturned view. Bypasses
   *  _place: nothing about the view's edge applies now. */
  _loomOver() {
    const camera = this.camera;
    if (!camera) return;
    const t = this.deathTuning;
    camera.getWorldPosition(_eye);
    camera.getWorldDirection(_dir);
    _dir.y = 0;
    if (_dir.lengthSq() < 1e-8) _dir.set(0, 0, -1);
    _dir.normalize();
    // Short of a wall or a prop, but never so near its face leaves the view.
    const room = this.rayHit(_eye, _dir, t.loomDistance + this.tuning.wallGap) - this.tuning.wallGap;
    const d = Math.max(t.loomDistance / 2, Math.min(t.loomDistance, room));
    _spot.copy(_eye).addScaledVector(_dir, d);
    _spot.y = terrainHeightAt(_spot.x, _spot.z);
    const o = this.figure.object3d;
    o.position.copy(_spot);
    o.visible = true;
    this._fadeDir = 0;
    this._applyOpacity(1);                  // fully there at once, whatever fade ran
    this._facePlayer();
    o.rotateX(t.lean);
    this.onFigureChanged?.();
  }

  /** Every beat has run, behind the black: the failed night, as before. */
  _died() {
    this._hide();
    this._hushStep();
    this.controller.fail(SLEEP_DEMON_KILL);
  }

  /** Called off, or the night starts again: all it took over given back. */
  _wake() {
    if (!this._death.active) return;
    this._death.cancel();
    // While the fly camera is on it owns the view and the player, and hands
    // them back itself.
    if (!this.isFrozen()) {
      this._slump(0);
      if (this.player) this.player.enabled = true;
    }
    this._pose = null;
    this.overlay?.clear();
    const volume = this.listener?.gain?.gain;
    if (volume && this._volume !== null) {
      const now = this.listener.context.currentTime;
      volume.cancelScheduledValues(now);
      volume.setValueAtTime(this._volume, now);
    }
    this._volume = null;
    for (const eye of this.figure.eyes ?? []) eye.scale.setScalar(1);
    this._smile(false);
    this._hide();
  }
}
