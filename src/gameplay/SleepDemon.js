import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { Component } from '../core/Component.js';
import { packGroups, Layers } from '../core/PhysicsLayers.js';
import { SleepDemonLogic, SLEEP_DEMON, angleToUpright } from './SleepDemonLogic.js';
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
//              until the floor is clear. It must land inside the view.
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
// It breathes: a loop on the figure, from the moment it first shows, louder
// the nearer it comes, on top of the distance falloff. Looked away, it still
// breathes from where it stood.
//
// The figure is a hidden, body-less GameObject the scene builds and owns,
// under a group at the world origin, so its position is a world position.
// Its body casts a shadow and the shadow maps are frozen between redraws,
// so every show, step or hide calls onFigureChanged — turning on the spot
// doesn't (the body is round).
//
// At empty the player falls asleep on it (SleepDemonDeath): frozen, the lids
// slam shut as the view drops to the floor and the world's sound falls away;
// black; the eyes flare open on it looming right over them; a cut to black,
// and only then the failed night. Whatever it took over (the player, the
// camera, the lids, the listener's volume) is put back by the next night
// start, the shift ending under it, or onDestroy.
// ─────────────────────────────────────────────

export const SLEEP_DEMON_KILL = 'You fell asleep. It was waiting. [E] to retry';

/** Manifest key behind each sound. The breathing is a placeholder for the
 *  sound owner to replace (see the manifest): the key stays, the file swaps. */
export const SLEEP_DEMON_SOUNDS = { breathing: 'sfx:breathing' };

/** The placeholder figure, metres: person-sized, so right beside the player
 *  its eyes are still in view. */
export const SLEEP_DEMON_FIGURE = Object.freeze({ height: 1.8, radius: 0.26 });

/** The breathing: its volume right beside the player, the share of that when
 *  it first shows, and the distance it is that loud at. */
const BREATH = { volume: 0.8, far: 0.3, refDistance: 1.5 };
/** The level is rounded to these steps, so it isn't re-set every frame. */
const BREATH_STEPS = 20;

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
   * @param {{ enabled: boolean }|null} [opts.player]  The FirstPersonController, frozen as they pass out.
   * @param {{ set(tunnel: number, lid: number): void, clear(): void }|null} [opts.overlay]
   *        The FatigueOverlay FatigueEffects writes: the same one, so their caches agree.
   * @param {{ play(onDark?: () => void): boolean }|null} [opts.fade]  The ScreenFade for the cut.
   * @param {THREE.AudioListener|null} [opts.listener]  Whose volume falls away.
   * @param {typeof SLEEP_DEMON_DEATH} [opts.deathTuning]
   */
  constructor({
    controller, stamina, figure, camera = null, terminal = null, rayHit = () => Infinity,
    isFrozen = () => false, onFigureChanged = null, height = SLEEP_DEMON_FIGURE.height,
    tuning = SLEEP_DEMON, sounds = null, rand = Math.random,
    player = null, overlay = null, fade = null, listener = null, deathTuning = SLEEP_DEMON_DEATH,
  }) {
    super();
    Object.assign(this, {
      controller, stamina, figure, camera, terminal, rayHit, isFrozen, onFigureChanged, height, tuning, sounds,
    });
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
    this._breath = 0;
    /** It has stood somewhere since it came: there is a spot to breathe from. */
    this._placed = false;
    this._off = null;
    this.logic = new SleepDemonLogic({
      tuning, rand,
      lookAngle: () => this.lookAngle(),
      place: spot => this._place(spot),
      hide: () => this._hide(),
      onKill: () => this._death.start(),
    });
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
    this._placed = false;
    this._hide();
    this._breathe(0);
  }

  onUpdate(dt) {
    if (this.controller.state !== 'playing') {
      // The shift ended under it (6 AM, another threat): called off. Once
      // over, the freeze holds behind the failed night until the retry.
      if (this._death.running) this._wake();
      this._hide();
      this._breathe(0);
      return;
    }
    if (this.isFrozen()) return;
    if (this._death.active) {
      this._dying(dt);
      return;
    }
    const logic = this.logic;
    logic.update(dt, this.stamina.value);
    if (this.figure.object3d.visible) this._facePlayer();
    if (!logic.around) this._placed = false;
    this._breathe(this._placed ? lerp(BREATH.far, 1, logic.closeness) : 0);
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

  /** The terminal's radar or review screen fills the view. */
  _onScreen() {
    const state = this.terminal?.state;
    return !!state && state !== 'idle';
  }

  /** Stand it `distance` out from the eye, `edge` of the way out to the
   *  `side` (+1 right, −1 left) of the view. False: no room there. */
  _place({ distance, side, edge }) {
    const camera = this.camera;
    if (!camera) return false;
    camera.getWorldPosition(_eye);
    camera.getWorldDirection(_dir);
    _dir.y = 0;
    if (_dir.lengthSq() < 1e-8) _dir.set(0, 0, -1);
    // Level, then turned off the centre: a turn about +Y goes left, so the
    // right side is a negative turn.
    _dir.normalize().applyAxisAngle(UP, -side * edge * halfWidth(camera));

    const t = this.tuning;
    let d = Math.min(distance, this.rayHit(_eye, _dir, distance + t.wallGap) - t.wallGap);
    while (d >= t.minDistance && this._occupied(_eye.x + _dir.x * d, _eye.z + _dir.z * d)) d -= STEP;
    if (d < t.minDistance) return false;

    _spot.copy(_eye).addScaledVector(_dir, d);
    _spot.y = terrainHeightAt(_spot.x, _spot.z);
    if (!this._inView(_spot)) return false;

    const o = this.figure.object3d;
    o.position.copy(_spot);
    o.visible = true;
    this._placed = true;
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

  /** Out of sight. Tells the scene only if it was showing. */
  _hide() {
    const o = this.figure.object3d;
    if (!o.visible) return;
    o.visible = false;
    this.onFigureChanged?.();
  }

  _facePlayer() {
    if (!this.camera) return;
    const o = this.figure.object3d;
    this.camera.getWorldPosition(_look);
    _look.y = o.position.y;
    o.lookAt(_look);
  }

  /** The breathing at `level` (0 … 1): silent and stopped at 0. */
  _breathe(level) {
    level = Math.round(level * BREATH_STEPS) / BREATH_STEPS;
    if (level === this._breath) return;
    this._breath = level;
    const breath = this.sounds?.breathing;
    if (!breath) return;
    breath.setVolume(level * BREATH.volume);
    if (level > 0) {
      if (!breath.isPlaying) breath.play();
    } else if (breath.isPlaying) {
      breath.stop();
    }
  }

  /** The breathing as a looping PositionalAudio on the figure, from the
   *  preloaded buffer. Without a listener or the buffer: silence. */
  _buildSounds() {
    const engine = this.gameObject?.scene?.userData?.engine;
    const sounds = {};
    if (!engine?.audioListener || !engine.assets) return sounds;
    const key = SLEEP_DEMON_SOUNDS.breathing;
    if (engine.assets.has && !engine.assets.has(key)) return sounds;
    const buffer = engine.assets.get(key);
    if (!buffer) return sounds;
    const audio = new THREE.PositionalAudio(engine.audioListener);
    audio.setBuffer(buffer);
    audio.setLoop(true);
    audio.setRefDistance(BREATH.refDistance);
    this.figure.object3d.add(audio);
    sounds.breathing = audio;
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
    this._facePlayer();
    o.rotateX(t.lean);
    this.onFigureChanged?.();
  }

  /** Every beat has run, behind the black: the failed night, as before. */
  _died() {
    this._hide();
    this._breathe(0);
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
    this._hide();
  }
}
