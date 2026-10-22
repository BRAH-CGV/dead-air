// ─────────────────────────────────────────────
// FootstepLogic  –  when the player's feet make a sound (pure)
// ─────────────────────────────────────────────
// Fed the controller's state each frame — on the ground or not, how fast
// over it, how fast up or down, crouched — it says what the feet did:
//
//   step   a foot down, every `stride` metres walked (`crouchStride`
//          crouched, softer); the first half a stride after setting off
//   jump   the push-off, softer, as the player leaves the ground going up
//          (walking off a ledge makes none)
//   land   a thump back on the ground after at least `minAir` in the air,
//          heavier the harder the fall (`hardFall`)
//
// Each event has a `weight`, 1 an ordinary step. Footsteps plays them.
// ─────────────────────────────────────────────

/** Tuning. Metres and seconds. */
export const FOOTSTEPS = {
  /** Metres between steps, standing and crouched (crouched is slower too,
   *  so its steps still come further apart in time). */
  stride: 1.9,
  crouchStride: 1.2,
  /** m/s under which the feet are still. */
  minSpeed: 0.5,
  /** Weights: crouched steps, the push-off of a jump. */
  crouch: 0.5,
  jump: 0.7,
  /** m/s up that counts as a jump, not a ledge. */
  jumpSpeed: 0.5,
  /** Seconds in the air before a landing is heard: a lip or a step isn't. */
  minAir: 0.2,
  /** A landing's weight: `land[0]` from a hop, up to `land[1]` from a fall
   *  of `hardFall` m/s or more. */
  land: [0.8, 1.5],
  hardFall: 9,
};

export class FootstepLogic {
  constructor(opts = FOOTSTEPS) {
    this.opts = opts;
    this._events = [];
    this._pool = [{}, {}];
    this._walked = opts.stride / 2;
    this._wasGrounded = true;
    this._air = 0;
    this._fall = 0;
  }

  /**
   * @param {number} dt
   * @param {{ grounded: boolean, speed: number, vertVel: number, crouched: boolean }} s
   * @returns {{ kind: 'step'|'jump'|'land', weight: number }[]}  Reused: read before the next update.
   */
  update(dt, { grounded, speed, vertVel, crouched }) {
    const o = this.opts;
    this._events.length = 0;
    if (!grounded) {
      if (this._wasGrounded && vertVel > o.jumpSpeed) this._event('jump', o.jump);
      this._air += dt;
      this._fall = Math.max(this._fall, -vertVel);
    } else {
      if (!this._wasGrounded && this._air >= o.minAir) {
        const k = Math.min(Math.max(this._fall / o.hardFall, 0), 1);
        this._event('land', o.land[0] + (o.land[1] - o.land[0]) * k);
        this._walked = 0;
      }
      this._air = 0;
      this._fall = 0;
      const stride = crouched ? o.crouchStride : o.stride;
      if (speed < o.minSpeed) {
        this._walked = stride / 2;
      } else {
        this._walked += speed * dt;
        if (this._walked >= stride) {
          this._walked -= stride;
          this._event('step', crouched ? o.crouch : 1);
        }
      }
    }
    this._wasGrounded = grounded;
    return this._events;
  }

  _event(kind, weight) {
    const e = this._pool[this._events.length];
    e.kind = kind;
    e.weight = weight;
    this._events.push(e);
  }
}
