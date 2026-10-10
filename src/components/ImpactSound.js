import { Component } from '../core/Component.js';
import { Pickupable } from './Pickupable.js';
import { ClipVoice, clipSet } from './ClipVoice.js';

// ─────────────────────────────────────────────
// ImpactSound  –  the knock of a loose prop hitting something
// ─────────────────────────────────────────────
// Rides on a prop with a dynamic body (a drive box, a drive) and plays one
// of the prop's clips, picked at random, whenever it is knocked: put down,
// dropped, bounced, or sent sliding by something else.
//
// A knock is read off the body's own velocity: how much it changed in one
// physics step. Falling, sliding and settling change it a little at a time
// (gravity is 0.16 m/s a step); landing on the floor takes all of it at
// once. So there are no collision events to wire up, and whatever the prop
// hits — a wall, a shelf, another prop — counts.
//
//   level = impactLevel(change in velocity)   // 0 below minSpeed
//   clip  = one of its own, at random         // ClipVoice: never the one just played
//
// Its velocity says nothing when it isn't the world doing the knocking:
//   • in the hand — the hold's spring throws the body about;
//   • seated in a socket — the body is kinematic, and placed each frame;
//   • as either of those begins or ends — the body is swapped or stopped
//     dead, which is a change in velocity but not a blow.
//
// Those moments are handling, and sound too, at a set level instead of a
// measured one:
//   • picked up — heard here, as `held` goes true (pickUpLevel);
//   • seated in a socket or taken out of one — the socket says so, with
//     handle(IMPACT.seatLevel) (a SnapSocket with `sounds: 'item'`).
// Taken out of a socket *and* into the hand is both at once; the cooldown
// makes it one sound. A socket with a sound of its own (a drive reader)
// calls hush() instead, and the prop keeps quiet through that moment.
//
// A prop may keep clips apart for handling (`handling`): the drive box has
// two for landing on things and one of its own for being lifted and set
// in the dock. Left out, handling uses the knocks.
//
// Like the signal lamp's beep, the sound is placed in the world, on the
// prop (a ClipVoice). It is only built the first time the prop makes a
// sound, so a drive that sits in its box all night costs nothing.
// ─────────────────────────────────────────────

/** Tuning shared by every prop. Metres a second unless stated. */
export const IMPACT = {
  /** The gentlest change of velocity that makes a sound, and the one that
   *  makes it at full level. A drop from 1 cm lands at 0.44; from the
   *  hand (~0.8 m), at 4. */
  minSpeed: 0.4,
  fullSpeed: 4,
  /** The level of the gentlest knock, of the hardest. */
  minLevel: 0.4,
  /** Seconds after a sound before the prop can make another, so a rattle
   *  of bounces is one clip, not several cut short. */
  cooldown: 0.12,
  /** Levels for handling, of a hard drop: seated in a socket or taken out
   *  of one, and picked up. */
  seatLevel: 0.7,
  pickUpLevel: 0.5,
  /** Full volume within this (metres) of the prop; inverse falloff beyond. */
  refDistance: 1.5,
  rolloff: 1,
};

/** The clips of each kind of prop, and a trim on their level: `clips` for
 *  knocks, `handling` for being picked up, seated and taken out (left out:
 *  the knocks again). */
export const IMPACT_SOUNDS = {
  box: {
    clips: ['sfx:box-impact-1', 'sfx:box-impact-2'],
    handling: ['sfx:box-handle'],
    volume: 1,
  },
  drive: {
    clips: ['sfx:drive-impact-1', 'sfx:drive-impact-2', 'sfx:drive-impact-3', 'sfx:drive-impact-4'],
    volume: 1,
  },
};

/** How loud a knock that changed the prop's velocity by `speed` is, 0..1:
 *  nothing below minSpeed, minLevel there, full from fullSpeed. */
export function impactLevel(speed) {
  const { minSpeed, fullSpeed, minLevel } = IMPACT;
  if (speed < minSpeed) return 0;
  const t = Math.min((speed - minSpeed) / (fullSpeed - minSpeed), 1);
  return minLevel + (1 - minLevel) * t;
}

export class ImpactSound extends Component {
  /**
   * @param {object} [opts]
   * @param {string[]} [opts.clips]  Manifest keys of the prop's knocks.
   * @param {string[]} [opts.handling]  Keys of its handling clips. Left
   *        out, the knocks.
   * @param {number} [opts.volume=1]  Of the clips' own level.
   * @param {AudioBuffer[]} [opts.buffers]  The knocks. Read from the asset
   *        cache by `clips` when left out.
   * @param {AudioBuffer[]} [opts.handlingBuffers]  Likewise, for `handling`.
   * @param {import('three').Audio|null} [opts.sound]  Built the first time it is
   *        wanted when left out. Null: silent.
   * @param {() => number} [opts.random]  0..1, for the choice of clip.
   */
  constructor({ clips = [], handling, volume = 1, buffers, handlingBuffers, sound, random = Math.random } = {}) {
    super();
    this.clips = clips;
    this.handling = handling ?? clips;
    this.volume = volume;
    this._voice = new ClipVoice({ sound, random, refDistance: IMPACT.refDistance, rolloff: IMPACT.rolloff });

    this._knocks = clipSet(clips, buffers);
    this._handling = handling || handlingBuffers ? clipSet(this.handling, handlingBuffers) : this._knocks;

    /** The body whose velocity was last read, and that velocity. A body
     *  seen for the first time has nothing to be compared with. */
    this._body = null;
    this._vx = 0;
    this._vy = 0;
    this._vz = 0;
    this._cooldown = 0;
    this._held = false;
    /** @type {Pickupable|null|undefined} */
    this._pickupable = undefined;
  }

  /** On the physics step, not the frame: the velocity read here is the one
   *  the last step left, and each step is compared with the one before. */
  onFixedUpdate(dt) {
    if (this._cooldown > 0) this._cooldown -= dt;

    if (this._pickupable === undefined) this._pickupable = this.gameObject?.getComponent?.(Pickupable) ?? null;
    const held = !!this._pickupable?.held;
    if (held && !this._held) this.handle(IMPACT.pickUpLevel);
    this._held = held;

    const body = this.gameObject?.rigidBody;
    if (!body || !body.isDynamic() || held) {
      this._body = null;
      return;
    }

    // A sleeping body is at rest; no need to ask.
    let x = 0, y = 0, z = 0;
    if (!body.isSleeping()) ({ x, y, z } = body.linvel());

    const known = body === this._body;
    const change = known ? Math.hypot(x - this._vx, y - this._vy, z - this._vz) : 0;
    this._body = body;
    this._vx = x;
    this._vy = y;
    this._vz = z;

    if (change >= IMPACT.minSpeed) this.knock(impactLevel(change));
  }

  onDestroy() {
    this._voice.dispose();
  }

  /** The prop's sound: undefined until it first makes one, null if it
   *  can't. @returns {import('three').Audio|null|undefined} */
  get sound() {
    return this._voice.sound;
  }

  /** One of the prop's knocks, at `level` (0..1) of its volume. */
  knock(level = 1) {
    this._play(this._knocks, level);
  }

  /** One of its handling clips: picked up, seated, or taken out. */
  handle(level = 1) {
    this._play(this._handling, level);
  }

  /** Say nothing for a moment: whatever is handling the prop is making
   *  the sound itself (a reader, as a drive is lifted out of it). */
  hush() {
    this._cooldown = IMPACT.cooldown;
  }

  // ── Internals ─────────────────────────────

  /** A clip from `set`, picked at random. Nothing within the cooldown of
   *  the last sound. */
  _play(set, level) {
    if (this._cooldown > 0) return;
    if (this._voice.play(this.gameObject, set, this.volume * level)) this._cooldown = IMPACT.cooldown;
  }
}
