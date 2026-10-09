import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { Component } from '../core/Component.js';
import { packGroups, Layers } from '../core/PhysicsLayers.js';
import { SleepDemonLogic, SLEEP_DEMON, angleToUpright, duckFor } from './SleepDemonLogic.js';
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
// The stare-down (below holdBelow, while seen) walks it in along the line
// from the eye, each step checked like a new spot: nothing at eye height in
// the way, the floor clear, in view. A step that fails, it holds. Its shadow
// is redrawn once a centimetre, not on each of the frames between.
//
// The torch betrays it: while it shows, the flashlight stutters whenever its
// beam (the cone, and a margin) falls on any of it. The beam is wider than
// the look that sends it away, so a sweep toward it stutters first.
//
// Dead air: while it stands in view, the ambience is ducked by how near the
// view has come round to it (duckFor), down to near-silence at the look. Its
// breathing is not part of the ambience, so it stands over the silence.
// Hidden, out of view, outside the shift or on a new night, it lets go.
// ─────────────────────────────────────────────

export const SLEEP_DEMON_KILL = 'You fell asleep. It was waiting. [E] to retry';

/** The name it ducks the ambience under (Ambience.setDuck). */
export const SLEEP_DEMON_DUCK = 'sleep-demon';

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
/** Metres the stare-down walks between shadow redraws: ShadowScheduler's own
 *  threshold for a moving caster. Every frame would redraw every map. */
const SHADOW_STEP = 0.01;

/** The torch's beam on it: radians past the cone's edge that still count,
 *  for the width of its body and a sweep that only comes near. */
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
   */
  constructor({
    controller, stamina, figure, camera = null, terminal = null, rayHit = () => Infinity,
    isFrozen = () => false, onFigureChanged = null, height = SLEEP_DEMON_FIGURE.height,
    tuning = SLEEP_DEMON, sounds = null, rand = Math.random, flashlight = null,
    ambience = null,
  }) {
    super();
    Object.assign(this, {
      controller, stamina, figure, camera, terminal, rayHit, isFrozen, onFigureChanged, height, tuning, sounds,
    });
    this.flashlight = flashlight;
    this.ambience = ambience;
    this._breath = 0;
    /** It has stood somewhere since it came: there is a spot to breathe from. */
    this._placed = false;
    this._off = null;
    this.logic = new SleepDemonLogic({
      tuning, rand,
      lookAngle: () => this.lookAngle(),
      place: spot => this._place(spot),
      hide: () => this._hide(),
      onKill: () => this.controller.fail(SLEEP_DEMON_KILL),
      approach: step => this._approach(step),
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
    this.logic.start();
    this._placed = false;
    this._hide();
    this._breathe(0);
    this._duck(1);
  }

  onUpdate(dt) {
    if (this.controller.state !== 'playing') {
      this._hide();
      this._breathe(0);
      this.flashlight?.setInterference(false, 'sleep-demon');
      this._duck(1);
      return;
    }
    if (this.isFrozen()) {
      // The torch is frozen with the player: a stutter left on would hold
      // it mid-dip, or dark, the whole flight.
      this.flashlight?.setInterference(false, 'sleep-demon');
      return;
    }
    const logic = this.logic;
    logic.update(dt, this.stamina.value);
    if (this.figure.object3d.visible) this._facePlayer();
    this.flashlight?.setInterference(this._inBeam(), 'sleep-demon');
    if (!logic.around) this._placed = false;
    this._breathe(this._placed ? lerp(BREATH.far, 1, logic.closeness) : 0);
    this._deadAir();
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

  /** The stare-down: `step` metres in toward the eye, along the level line
   *  from it, never nearer than stareFloor. The metres it then stands off,
   *  or false when the new spot is no good. */
  _approach(step) {
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
    // a shelf, onto a desk, or out of view.
    if (this.rayHit(_eye, _dir, d + t.wallGap) < d + t.wallGap) return false;
    _spot.copy(_eye).addScaledVector(_dir, d);
    if (this._occupied(_spot.x, _spot.z)) return false;
    _spot.y = terrainHeightAt(_spot.x, _spot.z);
    if (!this._inView(_spot)) return false;

    o.position.copy(_spot);
    this._facePlayer();
    if ((this._unshadowed += now - d) >= SHADOW_STEP) {
      this._unshadowed = 0;
      this.onFigureChanged?.();
    }
    return d;
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

  /** Duck the ambience by how near the view has come round to it. Measured
   *  from the share of the view's half-width it shows at for this stamina,
   *  so it is mild wherever it first shows. A second lookAngle() after the
   *  rules', since it may have just shown, stepped or fled this frame. */
  _deadAir() {
    const { logic, tuning: t } = this;
    if (!logic.shown || !this.camera) return this._duck(1);
    const shownAt = lerp(t.edgeFar, t.edgeNear, logic.closeness) * halfWidth(this.camera);
    this._duck(duckFor(this.lookAngle(), shownAt, t));
  }

  /** The ambience at `level` of itself; 1 lets go. */
  _duck(level) {
    this.ambience?.setDuck(level, SLEEP_DEMON_DUCK);
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
}
