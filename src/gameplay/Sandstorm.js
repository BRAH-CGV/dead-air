import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { UFO } from './UfoThreat.js';
import { NIGHT_SECONDS, SHIFT } from './NightClock.js';
import { WIND_DUST } from '../gameobjects/WindDust.js';

// ─────────────────────────────────────────────
// Sandstorm  –  dust storms that roll in on some nights
// ─────────────────────────────────────────────
// Every night brings two storms (SANDSTORM.perNight), one in each half of
// the night, at random hours (night 1 too — the dust eyes stay away until
// night 2; see DustEyes). It builds up over `rampSeconds`, blows for a while and dies
// down again. While it blows:
//
//   sound   none of its own. The wind outside is the Ambience's loop; the
//           storm tells it how hard it is blowing (Ambience.setStorm), and
//           the Ambience blows it harder outside and lets a hiss of it
//           through the walls.
//   fog     thicker and dust-brown wherever the valley is in view (outside,
//           and rooms with a window). Sealed rooms keep their own fog.
//   sky     dimmed toward dust: the stars and moons are lost (MarsSky.setStorm).
//   dust    streaming grit around the player wherever the valley is in view
//           — outside, and past the office window (DustStorm, which is cut
//           out of the building so no grain blows through a room).
//
// Where the valley is in view eases in and out rather than switching, so
// walking between a sealed room and the rest of the base fades the storm
// instead of popping it.
//
// The fog is shared with Daylight (colour) and the room fog (density). The
// storm never keeps its own copy of "the clear fog": each frame it notices
// whatever someone else wrote since its last write and lays itself on top
// of that, so it hands back exactly what the night would have had.
//
// Never with the UFO: on its nights (UFO.nights) there is no storm at
// random. Instead one always comes a little while after it has gone, and neither a scheduled storm nor the K key starts one mid-visit.
//
// `held` keeps it blowing at full for as long as it is set — DustEyes sets
// it through a chase, so the storm can't die down until the player is away.
//
// Outside, the fog closes right in (fogDensityOutside); from the windows the
// valley is murky but further (fogDensity). The change eases with the
// player's place, like the sound.
//
// For testing, summon() — the K key — starts one at once, on any night.
// Rooms don't know about gameplay, and this doesn't know about rooms: the
// scene hands it hooks for where the ear is, whether it is outside, and
// whether the valley is in view.
// ─────────────────────────────────────────────

/** Tuning. Seconds unless stated. */
export const SANDSTORM = {
  /** The first night storms can come on. */
  fromNight: 1,
  /** The stretch of night the storms blow in, in night-clock hours from
   *  midnight (7:30 PM is -4.5): 7:30 PM, after dark, to 5:54 AM. */
  stormHours: [-4.5, 5.9],
  /** Storms a night. The stretch is split into this many equal parts, one
   *  storm somewhere wholly inside each: 5.2 hours apiece, as often as the
   *  old six-hour night had its one (in 0:30 … 5:54). */
  perNight: 2,
  /** How long each blows, in clock hours — about an hour and a half. */
  durationHours: [1.3, 1.7],
  /** On a UFO night a storm always follows it, this long after it has gone
   *  (real seconds). */
  afterUfoDelay: [10, 30],
  /** Build-up and die-down. */
  rampSeconds: 6,
  /** Rate (per second) the storm eases at between indoors and out, and
   *  between having the valley in view and not. */
  placeRate: 4,
  /** FogExp2 density at full strength, seen from indoors: from the desk the
   *  storm swallows the view just before the radar dish, ~23 m out… */
  fogDensity: 0.065,
  /** …and with the player out in it — closed in tighter still, ~20 m. */
  fogDensityOutside: 0.08,
  /** The dust's colour, and how far the fog is pulled toward it. Chosen for
   *  what the fog comes out as at full storm, 0x4c2818: a dark rust-brown
   *  within a shade of the wind dust's clouds as the screen shows them (they
   *  are tone-mapped, which deepens WIND_DUST.nightColor to 0x4f2418; fog is
   *  laid on after tone mapping, so it is given the result). It is low in
   *  blue to cancel the clear night's blue that fogTint leaves in: with it
   *  the valley went mauve (0x4a251f). More green than this and it goes
   *  yellow (0x4b2d19). Tests pin both. */
  dustColor: 0x51280c,
  fogTint: 0.85,
  /** Wind speed in m/s, for the streaming dust. */
  windSpeed: 9,
};

/** The wind's axis (x, z): the way the dust clouds drift and the grass
 *  sways, so the grit blows the same way. */
export const WIND_DIRECTION = WIND_DUST.direction;

// ── Pure helpers ──────────────────────────────────────────

/**
 * Tonight's storms, in order: when each starts and how long it blows, in
 * real seconds from the start of the shift. SANDSTORM.perNight of them, one
 * inside each equal part of SANDSTORM.stormHours, so they never overlap.
 * @param {object} opts
 * @param {number} opts.night
 * @param {number} opts.nightDuration  Real seconds in the shift.
 * @param {number} [opts.nightHours=12] Clock hours in it.
 * @param {number} [opts.startHour=-6]  The clock hour it starts at.
 * @param {() => number} [opts.random]
 * @returns {{ start: number, duration: number }[]}  none on a UFO night
 *          (a storm follows the UFO there instead).
 */
export function scheduleStorms({
  night, nightDuration, nightHours = SHIFT.endHour - SHIFT.startHour, startHour = SHIFT.startHour, random = Math.random,
}) {
  if (night < SANDSTORM.fromNight) return [];
  if (UFO.nights.includes(night)) return [];   // it comes after the UFO instead
  const hour = nightDuration / nightHours;
  const [h0, h1] = SANDSTORM.stormHours;
  const [d0, d1] = SANDSTORM.durationHours;
  const part = (h1 - h0) / SANDSTORM.perNight;
  const storms = [];
  for (let i = 0; i < SANDSTORM.perNight; i++) {
    const duration = d0 + random() * (d1 - d0);
    const start = h0 + i * part + random() * (part - duration);
    storms.push({ start: (start - startHour) * hour, duration: duration * hour });
  }
  return storms;
}

/**
 * How hard it blows `t` seconds into a storm `duration` long: 0 → 1 over
 * the ramp, 1 while it holds, back to 0 over the last ramp.
 */
export function stormLevel(t, duration, ramp = SANDSTORM.rampSeconds) {
  if (t <= 0 || t >= duration) return 0;
  const r = Math.min(ramp, duration / 2);
  const k = Math.min(t / r, (duration - t) / r, 1);
  return k * k * (3 - 2 * k);
}

const _ear = new THREE.Vector3();
const _dust = new THREE.Color();

export class Sandstorm extends Component {
  /** How hard it is blowing, 0 … 1. */
  level = 0;
  /** While true, a storm that is blowing doesn't die down (a chase). */
  held = false;
  /** Counts the storms: a new number each time one comes up next or is
   *  summoned, so others can tell one storm from the next. */
  stormId = 0;

  /** How far through the current storm it is, 0 … 1 — null with none
   *  blowing (none tonight, not begun, or blown over). */
  get stormProgress() {
    const s = this._storm;
    if (!s) return null;
    const t = (this._elapsed - s.start) / s.duration;
    return t >= 0 && t <= 1 ? t : null;
  }

  /**
   * @param {object} opts
   * @param {import('./GameController.js').GameController} opts.controller
   * @param {object} opts.hooks
   * @param {(out: THREE.Vector3) => THREE.Vector3} opts.hooks.listenerPosition
   * @param {(p: THREE.Vector3) => boolean} opts.hooks.isOutside
   * @param {() => boolean} opts.hooks.valleyInView  Outside, or in a room with a window.
   * @param {THREE.FogExp2} [opts.fog]
   * @param {{ setStorm: (k: number) => void }} [opts.sky]  A MarsSky.
   * @param {{ setLevel: (k: number) => void, setWind: (angle: number, speed: number) => void }} [opts.dust]  A DustStorm.
   * @param {{ phase: string }} [opts.ufo]  The UfoThreat, so the two never overlap.
   * @param {{ setStorm: (k: number) => void }} [opts.clouds]  The wind dust's
   *        WindDustMotion: one storm level drives the clouds too.
   * @param {{ setStorm: (k: number) => void }} [opts.ambience]  The scene's
   *        Ambience: the storm's wind is its outside loop, blown harder.
   * @param {number} [opts.nightDuration=600]  Real seconds in a shift.
   * @param {number} [opts.nightHours=12]     Clock hours in it.
   * @param {number} [opts.startHour=-6]      The clock hour it starts at.
   * @param {() => number} [opts.random]
   */
  constructor({
    controller, hooks, fog = null, sky = null, dust = null, ufo = null, clouds = null, ambience = null,
    nightDuration = NIGHT_SECONDS, nightHours = SHIFT.endHour - SHIFT.startHour, startHour = SHIFT.startHour, random = Math.random,
  }) {
    super();
    Object.assign(this, { controller, hooks, fog, sky, dust, ufo, clouds, ambience, nightDuration, nightHours, startHour, random });

    this._elapsed = 0;       // seconds of 'playing' this night
    this._storm = null;      // { start, duration } in _elapsed, or null: the current or next storm
    this._queue = [];        // tonight's storms after that one
    this._view = null;       // eased 1 with the valley in view … 0, for the fog and dust
    this._out = null;        // eased 1 outside … 0 inside, for how close the fog is
    this._afterUfo = false;  // a UFO night with a storm to follow it
    this._afterUfoAt = null; // when that storm starts, in _elapsed, once the UFO has gone

    // The fog as someone else last left it, and what we last wrote over it.
    this._baseColor = new THREE.Color();
    this._wroteColor = new THREE.Color();
    this._baseDensity = 0;
    this._wroteDensity = null;
    this._dustColor = new THREE.Color(SANDSTORM.dustColor);
    this._off = null;
  }

  onStart() {
    this._off = this.controller.onNightStart?.(night => this.reset(night)) ?? null;
    this.reset(this.controller.nightNumber || 1);
  }

  onDestroy() {
    this._off?.();
    this._off = null;
    this.ambience?.setStorm?.(0);
  }

  /** A fresh night: calm, with tonight's storms (if any) scheduled. */
  reset(night) {
    this._elapsed = 0;
    this.level = 0;
    this.held = false;
    this._queue = scheduleStorms({ night, nightDuration: this.nightDuration, nightHours: this.nightHours, startHour: this.startHour, random: this.random });
    this._storm = null;
    this._next();
    this._afterUfo = night >= SANDSTORM.fromNight && UFO.nights.includes(night);
    this._afterUfoAt = null;
  }

  /**
   * Start one now rather than at its random time — the K debug key. Only
   * during a shift, and not over one already blowing.
   * @returns {boolean} whether a storm started
   */
  summon() {
    if (this.controller.state !== 'playing') return false;
    if (this.level > 0 || this._ufoBusy()) return false;
    // It stands in for the next storm that hasn't started: the current one
    // if it is still to come, else the first in the queue.
    if (this._blownOver()) this._queue.shift();
    this._startNow();
    return true;
  }

  /** The current storm has been and gone. */
  _blownOver() {
    const s = this._storm;
    return !!s && this._elapsed >= s.start + s.duration;
  }

  /** Bring up tonight's next storm, if there is one. One delayed past its
   *  time (a held storm ran long) starts now. */
  _next() {
    const s = this._queue.shift();
    if (!s) return;
    s.start = Math.max(s.start, this._elapsed);
    this._storm = s;
    this.stormId++;
    this._pickWind();
  }

  /** A storm from this moment, of a random length. */
  _startNow() {
    const [d0, d1] = SANDSTORM.durationHours;
    const duration = (d0 + this.random() * (d1 - d0)) * this.nightDuration / this.nightHours;
    this._storm = { start: this._elapsed, duration };
    this.stormId++;
    this._pickWind();
  }

  /** The UFO is on its way in, over the base, or has just taken someone. */
  _ufoBusy() {
    const phase = this.ufo?.phase;
    return !!phase && phase !== 'waiting' && phase !== 'gone';
  }

  /** On a UFO night: once it has gone, the storm follows a little after. */
  _followUfo() {
    if (!this._afterUfo || this._storm || this.ufo?.phase !== 'gone') return;
    if (this._afterUfoAt === null) {
      const [a, b] = SANDSTORM.afterUfoDelay;
      this._afterUfoAt = this._elapsed + a + this.random() * (b - a);
    }
    if (this._elapsed >= this._afterUfoAt) this._startNow();
  }

  onUpdate(dt) {
    if (this.controller.state === 'playing') {
      this._elapsed += dt;
      this._followUfo();
      if (this._blownOver() && !this.held && this._queue.length) this._next();
      const s = this._storm;
      // Due during a UFO visit (the U key, on another night): it waits.
      if (s && this._ufoBusy() && this.level === 0 && this._elapsed >= s.start) s.start = this._elapsed;
      // Held: the end is pushed back so it never gets inside the die-down.
      if (s && this.held && this.level > 0) {
        const t = this._elapsed - s.start;
        s.duration = Math.max(s.duration, t + SANDSTORM.rampSeconds + 1);
      }
      this.level = this._storm ? stormLevel(this._elapsed - s.start, s.duration) : 0;
    } else {
      // The shift is over: whatever is blowing dies down over the ramp.
      this.level = Math.max(0, this.level - dt / SANDSTORM.rampSeconds);
    }

    const ear = this.hooks.listenerPosition(_ear);
    const outside = this.hooks.isOutside(ear);
    const ease = 1 - Math.exp(-SANDSTORM.placeRate * dt);
    const view = this.hooks.valleyInView() ? 1 : 0;
    this._view = this._view === null ? view : this._view + (view - this._view) * ease;
    const out = outside ? 1 : 0;
    this._out = this._out === null ? out : this._out + (out - this._out) * ease;

    this._applyFog();
    this.ambience?.setStorm?.(this.level);
    this.sky?.setStorm?.(this.level);
    this.clouds?.setStorm?.(this.level);
    this.dust?.setLevel?.(this.level * this._view);
    this.dust?.tick?.(dt, ear);
  }

  /** Thicker, browner fog over whatever the night and the room left there. */
  _applyFog() {
    const fog = this.fog;
    if (!fog) return;
    if (fog.density !== this._wroteDensity) this._baseDensity = fog.density;
    if (this._wroteDensity === null || !fog.color.equals(this._wroteColor)) this._baseColor.copy(fog.color);

    const k = this.level * this._view;
    const base = this._baseDensity;
    const storm = SANDSTORM.fogDensity + (SANDSTORM.fogDensityOutside - SANDSTORM.fogDensity) * this._out;
    fog.density = base + (Math.max(base, storm) - base) * k;
    fog.color.lerpColors(this._baseColor, _dust.copy(this._dustColor), k * SANDSTORM.fogTint);

    this._wroteDensity = fog.density;
    this._wroteColor.copy(fog.color);
  }

  /** The storm's wind: along the one wind axis the clouds and grass share. */
  _pickWind() {
    this.dust?.setWind?.(Math.atan2(WIND_DIRECTION[1], WIND_DIRECTION[0]), SANDSTORM.windSpeed);
  }
}
