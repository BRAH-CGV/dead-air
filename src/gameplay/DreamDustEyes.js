import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { synthGrowl } from './Growl.js';
import { terrainHeightAt } from '../gameobjects/MarsTerrain.js';

// ─────────────────────────────────────────────
// DreamDustEyes  –  the things in the crater dream that watch
// ─────────────────────────────────────────────
// A simplified dust-eyes manager for the dream crater. No yard/window
// distinction, no random spawning, no aggro rolls, no storm dependency.
// All eyes are pre-placed in three concentric rings around the player at
// build time; they stay passive until the player looks directly at one,
// then it growls, leaps and chases. Once aggro'd it never calms down —
// it chases until it catches the player or the dream ends.
//
//   passive ──stared at (stareSeconds)──▶ growling ──growlSeconds──▶ leaping ──▶ chasing
//      │                 (still, red eyes, jaws shut,      (jaws open, a hop
//      │                  a low growl)                      that closes the gap)
//      │                                                         │
//      │                       caught (catchDistance) ◀──────────┘
//      │                                                         │
//      └──────────────────────────── onCatch hook ◀──────────────┘
//
// Once an eye enters the chase it stays aggressive for the rest of the
// dream — looking away no longer calms it.
//
// The gaze check is the same dot-product approach as DustEyes: the eye
// must sit within gazeAngle degrees of the view centre for stareSeconds
// continuous looking to trigger it.
// ─────────────────────────────────────────────

/** Tuning. Seconds and metres unless stated. */
export const DREAM_EYES = {
  /** Total eyes in the pool (all spawn; 3 rings of equal share). */
  poolSize: 36,
  /** Each sub-array is one ring: [minDist, maxDist] from the player. */
  spawnRings: [[14, 28], [45, 70], [90, 130]],
  /** Height above the local terrain surface. */
  height: [1.9, 2.6],
  /** Degrees off the middle of the view that still counts as looking. */
  gazeAngle: 8,
  /** How long the player must look before the eye turns. */
  stareSeconds: 0.8,
  /** How long it growls (jaws shut, still) before it leaps. */
  growlSeconds: 1.5,
  /** The leap: duration, max distance, min gap to player, arc height. */
  leapSeconds: 0.42,
  leapDistance: 12,
  leapMinGap: 4,
  leapHeight: 0.9,
  /** Chase speed (m/s) — the player runs at 5. Accelerates without cap. */
  chaseSpeed: 3.6,
  /** How much faster it gets each second of chase (m/s²). No top speed. */
  chaseAccel: 0.4,
  /** Random chase-jump: height, duration, horizontal reach, cooldown between jumps. */
  jumpHeight: 1.2,
  jumpDuration: 0.5,
  jumpLength: 5,
  jumpCooldown: 3,
  /** Chance per second of triggering a random jump while chasing. */
  jumpChance: 0.4,
  /** Walking bob: frequency (Hz), vertical amplitude (m). */
  bobFrequency: 2,
  bobAmplitude: 0.015,
  /** It has the player at this distance. */
  catchDistance: 1.5,
  /** Fade in/out duration. */
  fadeSeconds: 1.5,
  /** Farthest it can be seen from. */
  sightRange: 50,
  /** The slow side-to-side drift while watching. */
  swayAmplitude: 1.5,
  swayRate: 0.35,
  /** How the eyes dim with distance — exp(−(d · dim)²). */
  dimDensity: 0.02,
  /** The silhouette: the fog's own colour, times this. */
  silhouetteShade: 0.85,
  /** The growl volume. */
  growlVolume: 0.35,
};

const lerp = (a, b, t) => a + (b - a) * t;

// ── Pure helpers ──────────────────────────────────────────

/** One eye from the pool, and what it is doing. */
class Slot {
  constructor(go) {
    this.go = go;
    /** 'off' | 'in' | 'passive' | 'growling' | 'leaping' | 'chasing' | 'caught' | 'out' */
    this.phase = 'off';
    this.fade = 0;
    this.gaze = 0;
    this.t = 0;

    /** Where it hangs; it sways either side of this along `side`. */
    this.anchor = new THREE.Vector3();
    this.side = new THREE.Vector3(1, 0, 0);
    this.swayPhase = 0;
    /** The leap, start to end. */
    this.leapFrom = new THREE.Vector3();
    this.leapTo = new THREE.Vector3();
    /** Phase of the walking bob (radians, accumulated over time). */
    this.bobPhase = 0;
    /** Seconds spent chasing — drives acceleration. */
    this.chaseTime = 0;
    /** Countdown until the eye can jump again. */
    this.jumpCooldown = 0;
    /** Jump progress: -1 = not jumping, 0…jumpDuration = in arc. */
    this.jumpT = -1;
    this.jumpFrom = new THREE.Vector3();
    this.jumpTo = new THREE.Vector3();
    this.jumpPeak = 0;
  }
  get position() { return this.go.object3d.position; }
  get mode() { return this.go.mode; }
}

const _eye = new THREE.Vector3();
const _view = new THREE.Vector3();
const _to = new THREE.Vector3();
const _way = new THREE.Vector3();
const _silhouette = new THREE.Color();
const _jumpDir = new THREE.Vector3();

export class DreamDustEyes extends Component {
  /**
   * @param {object} opts
   * @param {import('../gameobjects/DustEye.js').DustEye[]} opts.pool  Built and parented by the scene.
   * @param {object} opts.hooks
   * @param {(out: THREE.Vector3) => THREE.Vector3} opts.hooks.eyePosition
   * @param {(out: THREE.Vector3) => THREE.Vector3} opts.hooks.viewDirection
   * @param {() => void} opts.hooks.onCatch  Called when an eye reaches the player.
   * @param {THREE.Fog|THREE.FogExp2} [opts.fog]  The silhouettes take its colour.
   * @param {() => number} [opts.random]
   */
  constructor({ pool, hooks, fog = null, random = Math.random }) {
    super();
    Object.assign(this, { hooks, fog, random });
    this.slots = pool.map(go => new Slot(go));
    for (const slot of this.slots) this._hide(slot);
    this._caught = false;
    this.sounds = {};
  }

  /** The eyes out there now. */
  get active() { return this.slots.filter(s => s.phase !== 'off'); }

  onStart() {
    if (!this.sounds.growl) this.sounds.growl = this._buildGrowl();
    this._spawnAll();
  }

  onDestroy() {
    for (const sound of Object.values(this.sounds)) {
      if (sound?.isPlaying) sound.stop();
      try { sound?.disconnect?.(); } catch (_) { /* never connected */ }
    }
  }

  /** Place every eye in one of three rings around the player. */
  _spawnAll() {
    const eye = this.hooks.eyePosition(_eye);
    const count = this.slots.length;
    const rings = DREAM_EYES.spawnRings;
    const ringSize = Math.ceil(count / rings.length);
    for (let i = 0; i < count; i++) {
      const slot = this.slots[i];
      const ringIdx = Math.min(Math.floor(i / ringSize), rings.length - 1);
      const ring = rings[ringIdx];
      const angle = (i / count) * Math.PI * 2 + (this.random() - 0.5) * 0.5;
      const dist = lerp(ring[0], ring[1], this.random());
      const x = eye.x + Math.cos(angle) * dist;
      const z = eye.z + Math.sin(angle) * dist;
      const groundY = terrainHeightAt(x, z);
      const y = groundY + lerp(DREAM_EYES.height[0], DREAM_EYES.height[1], this.random());
      slot.anchor.set(x, y, z);
      // Sway across the player's line of sight.
      const dx = slot.anchor.x - eye.x;
      const dz = slot.anchor.z - eye.z;
      slot.side.set(-dz, 0, dx).normalize();
      slot.swayPhase = this.random() * Math.PI * 2;
      slot.position.copy(slot.anchor);
      slot.phase = 'in';
      slot.fade = 0;
      slot.gaze = 0;
      slot.t = 0;
      slot.go.setMode('passive');
      slot.go.setIntensity(1);
      slot.go.object3d.visible = true;
    }
  }

  onUpdate(dt) {
    if (this._caught) return;
    const eye = this.hooks.eyePosition(_eye);
    this.hooks.viewDirection(_view);

    for (const slot of this.slots) {
      if (slot.phase === 'off') continue;
      slot.t += dt;
      switch (slot.phase) {
        case 'in':
          slot.fade = Math.min(1, slot.fade + dt / DREAM_EYES.fadeSeconds);
          if (slot.fade >= 1) slot.phase = 'passive';
          break;
        case 'passive':
          this._sway(slot);
          this._checkGaze(slot, dt, eye);
          break;
        case 'growling':
          if (slot.t >= DREAM_EYES.growlSeconds) this._startLeap(slot, eye);
          break;
        case 'leaping':
          this._leap(slot);
          break;
        case 'chasing':
          this._chase(slot, dt, eye);
          break;
        case 'out':
          slot.fade -= dt / DREAM_EYES.fadeSeconds;
          if (slot.fade <= 0) this._hide(slot);
          break;
      }
    }

    this._tickVisuals(dt, eye);
  }

  // ── Gaze ────────────────────────────────

  /** Accumulate gaze while the player looks at a passive eye. */
  _checkGaze(slot, dt, eye) {
    const looking = this._seen(slot, eye) && this._lookingAt(slot, eye);
    if (looking) {
      slot.gaze += dt;
      if (slot.gaze >= DREAM_EYES.stareSeconds) this._turn(slot);
    } else {
      slot.gaze = Math.max(0, slot.gaze - dt);
    }
  }

  /** Is it in range? */
  _seen(slot, eye) {
    return eye.distanceTo(slot.position) <= DREAM_EYES.sightRange;
  }

  /** Is it near the middle of the view? */
  _lookingAt(slot, eye) {
    _to.copy(slot.position).sub(eye).normalize();
    return _to.dot(_view) >= Math.cos(THREE.MathUtils.degToRad(DREAM_EYES.gazeAngle));
  }

  // ── State transitions ───────────────────

  /** It turns: red eyes, jaws shut, a growl. */
  _turn(slot) {
    slot.go.setMode('growl');
    slot.fade = 1;
    slot.t = 0;
    slot.phase = 'growling';
    this._growl(DREAM_EYES.growlVolume);
  }

  /** Jaws open, a hop toward the player. */
  _startLeap(slot, eye) {
    slot.phase = 'leaping';
    slot.t = 0;
    slot.go.setMode('aggressive');
    slot.leapFrom.copy(slot.position);
    _to.copy(eye).sub(slot.position);
    const d = _to.length();
    const travel = Math.min(DREAM_EYES.leapDistance, Math.max(0, d - DREAM_EYES.leapMinGap));
    slot.leapTo.copy(slot.position).addScaledVector(_to, d > 0 ? travel / d : 0);
  }
  _leap(slot) {
    const u = Math.min(slot.t / DREAM_EYES.leapSeconds, 1);
    const ease = 1 - (1 - u) * (1 - u);
    slot.position.lerpVectors(slot.leapFrom, slot.leapTo, ease);
    slot.position.y += Math.sin(Math.PI * u) * DREAM_EYES.leapHeight;
    if (u >= 1) {
      slot.phase = 'chasing'; slot.t = 0;
      slot.bobPhase = 0; slot.chaseTime = 0; slot.jumpCooldown = 0; slot.jumpT = -1;
    }
  }

  /** Accelerating chase with random jumps. Never calms down once aggro'd. */
  _chase(slot, dt, eye) {
    slot.chaseTime += dt;
    slot.jumpCooldown = Math.max(0, slot.jumpCooldown - dt);

    if (slot.position.distanceTo(eye) <= DREAM_EYES.catchDistance) {
      this._catch(slot);
      return;
    }

    // ── Jump sub-state ──
    if (slot.jumpT >= 0) {
      this._tickJump(slot, dt);
    } else {
      // Accelerated stride toward the player — no speed cap.
      const speed = DREAM_EYES.chaseSpeed + DREAM_EYES.chaseAccel * slot.chaseTime;
      _way.copy(eye).sub(slot.position);
      const d = _way.length();
      const step = Math.min(speed * dt, d);
      if (d > 1e-6) slot.position.addScaledVector(_way, step / d);

      // Maybe start a random jump.
      if (slot.jumpCooldown <= 0 && this.random() < DREAM_EYES.jumpChance * dt) {
        this._startJump(slot, eye);
      }
    }

    // Walking bob: time-based so the cadence stays steady regardless of speed.
    slot.bobPhase += dt * DREAM_EYES.bobFrequency * Math.PI * 2;
    slot.position.y += Math.sin(slot.bobPhase) * DREAM_EYES.bobAmplitude;
  }

  /** Begin a random jump toward the player. */
  _startJump(slot, eye) {
    slot.jumpT = 0;
    slot.jumpFrom.copy(slot.position);
    _jumpDir.copy(eye).sub(slot.position);
    const d = _jumpDir.length();
    const travel = Math.min(DREAM_EYES.jumpLength, d > 0 ? d * 0.4 : 0);
    slot.jumpTo.copy(slot.position);
    if (d > 1e-6) slot.jumpTo.addScaledVector(_jumpDir, travel / d);
    slot.jumpPeak = DREAM_EYES.jumpHeight * (0.7 + this.random() * 0.6);
  }

  /** Advance the jump arc; when done, set the cooldown. */
  _tickJump(slot, dt) {
    slot.jumpT += dt;
    const u = Math.min(slot.jumpT / DREAM_EYES.jumpDuration, 1);
    slot.position.lerpVectors(slot.jumpFrom, slot.jumpTo, u);
    slot.position.y += Math.sin(Math.PI * u) * slot.jumpPeak;
    if (u >= 1) {
      slot.jumpT = -1;
      slot.jumpCooldown = DREAM_EYES.jumpCooldown;
    }
  }

  _catch(slot) {
    slot.phase = 'caught';
    this._caught = true;
    this.hooks.onCatch();
  }

  // ── Helpers ─────────────────────────────

  /** Drift either side of where it hangs, slowly. */
  _sway(slot) {
    const s = Math.sin(slot.swayPhase + slot.t * DREAM_EYES.swayRate) * DREAM_EYES.swayAmplitude;
    slot.position.copy(slot.anchor).addScaledVector(slot.side, s);
  }

  _hide(slot) {
    slot.phase = 'off';
    slot.fade = 0;
    slot.gaze = 0;
    slot.go.setMode('passive');
    slot.go.setFade(0);
    slot.go.object3d.visible = false;
  }

  _growl(volume) {
    const growl = this.sounds?.growl;
    if (!growl) return;
    if (growl.isPlaying) growl.stop();
    growl.setVolume(volume);
    growl.play();
  }

  /** The synthesised growl as a THREE.Audio, or null without audio. */
  _buildGrowl() {
    const engine = this.gameObject?.scene?.userData?.engine;
    const listener = engine?.audioListener;
    if (!listener) return null;
    const { context } = listener;
    const samples = synthGrowl({ sampleRate: context.sampleRate });
    const buffer = context.createBuffer(1, samples.length, context.sampleRate);
    buffer.copyToChannel(samples, 0);
    const audio = new THREE.Audio(listener);
    audio.setBuffer(buffer);
    return audio;
  }

  /** Look at the player, dimmed by distance through the dust. */
  _tickVisuals(dt, eye) {
    if (this.fog) _silhouette.copy(this.fog.color).multiplyScalar(DREAM_EYES.silhouetteShade);
    for (const slot of this.slots) {
      if (slot.phase === 'off') continue;
      const d = eye.distanceTo(slot.position) * DREAM_EYES.dimDensity;
      slot.go.setFade(Math.max(slot.fade, 0) * Math.exp(-d * d));
      if (this.fog) slot.go.setSilhouetteColor(_silhouette);
      slot.go.tick(dt, eye);
    }
  }
}
