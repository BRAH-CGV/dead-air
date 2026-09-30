// ─────────────────────────────────────────────
// Fatigue  –  what low stamina does to the player
// ─────────────────────────────────────────────
// Hayden's list (GENERAL-VISION.md): a tired player yawns, sees darker and
// narrower, and a critical one starts to feel threatened. By level:
//
//   ok        nothing
//   tired     a yawn every 20–35 s; the view narrows (tunnel)
//   critical  a yawn every 7–12 s, blinks, the lights stutter (dread),
//             a heartbeat rising towards empty
//   < 0.08    it nods off: the lids stay shut for a moment
//
// The base dimming with fatigue is StaminaDrain's 'fatigue' factor; this is
// everything on top of it. tunnel() and heartbeat() are pure functions of
// stamina. FatigueLogic holds what happens now and then — yawns, lids,
// flickers — on timers drawn from an injected rand(), so tests can pin
// them. FatigueEffects (a Component) plays them out: the sounds, the
// overlay and the 'dread' light factor.
// ─────────────────────────────────────────────

import { STAMINA } from './Stamina.js';

export const FATIGUE = Object.freeze({
  /** How dark the tunnel's edge gets at empty (the overlay's opacity). */
  tunnelMax: 0.85,
  /** Seconds between yawns [min, max], by level. */
  yawnGap: Object.freeze({ tired: [20, 35], critical: [7, 12] }),
  /** Seconds from first feeling tired to the first yawn [min, max]. */
  firstYawn: [2, 6],
  /** Critical: seconds between blinks, and how long one takes. */
  blinkGap: [4, 8],
  blinkSeconds: 0.25,
  /** Below this stamina the player nods off now and then. */
  microsleepBelow: 0.08,
  microsleepGap: [9, 15],
  microsleepSeconds: 1.2,
  /** Share of a nod-off the lids are fully shut. */
  microsleepHold: 0.4,
  /** Critical: seconds between light stutters [min, max], how long one
   *  lasts [min, max], and how fast it flips between dim and full. */
  flickerGap: [4, 10],
  flickerSeconds: [0.15, 0.45],
  flickerStep: 0.06,
  /** The 'dread' light factor at the bottom of a stutter. With the fatigue
   *  dim under it the base must still not count as dark (DARK_LEVEL). */
  dreadMin: 0.5,
});

const clamp01 = x => Math.min(1, Math.max(0, x));

/**
 * How closed in the view is: 0 until tired, easing up to tunnelMax at empty.
 * @param {number} stamina  0 … 1
 */
export function tunnel(stamina, { tunnelMax } = FATIGUE) {
  const t = clamp01(1 - stamina / STAMINA.tiredBelow);
  return tunnelMax * t * t * (3 - 2 * t);
}

/**
 * The heartbeat's loudness: 0 until critical, 1 at empty.
 * @param {number} stamina  0 … 1
 */
export function heartbeat(stamina) {
  return clamp01(1 - stamina / STAMINA.criticalBelow);
}

function levelOf(stamina) {
  if (stamina >= STAMINA.tiredBelow) return 'ok';
  if (stamina >= STAMINA.criticalBelow) return 'tired';
  return 'critical';
}

export class FatigueLogic {
  /** How shut the eyes are: 0 open … 1 shut. */
  eyelid = 0;
  /** The 'dread' light factor: 1, or dreadMin at the bottom of a stutter. */
  dread = 1;

  /**
   * @param {object} [opts]
   * @param {typeof FATIGUE} [opts.tuning]
   * @param {() => number} [opts.rand]  0 ≤ r < 1
   * @param {(() => void)|null} [opts.onYawn]
   */
  constructor({ tuning = FATIGUE, rand = Math.random, onYawn = null } = {}) {
    this.tuning = tuning;
    this.rand = rand;
    this.onYawn = onYawn;
    this.reset();
  }

  /** A new or retried night, or a nap: eyes open, lights steady. */
  reset() {
    this.eyelid = 0;
    this.dread = 1;
    this._level = 'ok';
    this._yawnIn = Infinity;
    this._blinkIn = Infinity;
    this._sleepIn = Infinity;
    this._flickerIn = Infinity;
    this._lid = null;           // { t, length, hold } while the lids move
    this._flicker = null;       // { t, length } while the lights stutter
  }

  /** @param {number} dt @param {number} stamina 0 … 1 */
  update(dt, stamina) {
    const level = levelOf(stamina);
    if (level !== this._level) this._changeLevel(this._level, level);
    this._level = level;
    const nodding = stamina < this.tuning.microsleepBelow;
    if (!nodding) this._sleepIn = Infinity;
    else if (this._sleepIn === Infinity) this._sleepIn = this._between(this.tuning.microsleepGap);

    this._yawnIn -= dt;
    if (this._yawnIn <= 0) {
      this.onYawn?.();
      this._yawnIn += this._between(this.tuning.yawnGap[level]);
    }

    this._updateLids(dt);
    this._updateFlicker(dt);
  }

  // ── Private ──

  _changeLevel(from, to) {
    const { yawnGap, firstYawn, blinkGap, flickerGap } = this.tuning;
    if (to === 'ok') {
      this._yawnIn = this._blinkIn = this._flickerIn = Infinity;
      return;
    }
    if (from === 'ok') this._yawnIn = this._between(firstYawn);
    if (to === 'critical') {
      this._yawnIn = Math.min(this._yawnIn, this._between(yawnGap.critical));
      this._blinkIn = this._between(blinkGap);
      this._flickerIn = this._between(flickerGap);
    } else {
      this._blinkIn = this._flickerIn = Infinity;
    }
  }

  _updateLids(dt) {
    const t = this.tuning;
    this._blinkIn -= dt;
    this._sleepIn -= dt;
    // A lid movement runs to its end, so one never cuts into another: a
    // nod-off that comes due mid-blink starts as the blink ends.
    if (!this._lid) {
      if (this._sleepIn <= 0) {
        this._lid = { t: 0, length: t.microsleepSeconds, hold: t.microsleepHold };
        this._sleepIn = this._between(t.microsleepGap);
      } else if (this._blinkIn <= 0) {
        this._lid = { t: 0, length: t.blinkSeconds, hold: 0 };
        this._blinkIn = this._between(t.blinkGap);
      }
    } else {
      this._lid.t += dt;
    }

    const lid = this._lid;
    if (!lid) { this.eyelid = 0; return; }
    if (lid.t >= lid.length) { this._lid = null; this.eyelid = 0; return; }
    // Shut over the first part, hold, open over the last: eased each way.
    const u = lid.t / lid.length;
    const edge = (1 - lid.hold) / 2;
    const x = u < edge ? u / edge : u > 1 - edge ? (1 - u) / edge : 1;
    this.eyelid = x * x * (3 - 2 * x);
  }

  _updateFlicker(dt) {
    const t = this.tuning;
    this._flickerIn -= dt;
    if (!this._flicker && this._flickerIn <= 0) {
      this._flicker = { t: 0, length: this._between(t.flickerSeconds) };
      this._flickerIn = this._between(t.flickerGap);
    } else if (this._flicker) {
      this._flicker.t += dt;
    }

    const f = this._flicker;
    if (!f) { this.dread = 1; return; }
    if (f.t >= f.length) { this._flicker = null; this.dread = 1; return; }
    // Starts dim, then flips each flickerStep: a stutter, not a fade.
    this.dread = Math.floor(f.t / t.flickerStep) % 2 === 0 ? t.dreadMin : 1;
  }

  _between([min, max]) {
    return min + (max - min) * this.rand();
  }
}
