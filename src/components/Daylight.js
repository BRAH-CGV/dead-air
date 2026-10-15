import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { SHIFT } from '../gameplay/NightClock.js';

// ─────────────────────────────────────────────
// Daylight  –  dusk at the start of a shift, the Martian day at its end
// ─────────────────────────────────────────────
// A shift starts at sunset, 6 PM, in the last of the daylight, which fades
// to night over its first hour; the Sun comes back up over its last hour.
// Reads the hour and how far into the day it is from the GameController
// (its clock and state) and applies them to everything that should change
// with them: the sky shader's uDawn uniform, the ambient and sun lights, and
// the fog follow the dawn; the sky's turn follows the hour.
//
//   gameplayGO.addComponent(new Daylight({
//     controller: gameController, sky, ambient, sun, fog: scene.fog,
//   }));
//
// The night values are whatever the lights and fog hold when Daylight is
// built, so the scene stays the one place that decides how the night looks —
// build it after the lighting. The day values are targets, below, and can be
// overridden per scene. Every piece is optional.
//
// With a sky, the sun light — the moonlight at night — is aimed as well: from
// wherever Phobos is as the sky turns, swinging through the dawn to the
// Sun's bearing, `sunElevation` up. It keeps the distance the scene put it
// at, so its shadow camera still spans what it was sized for.
//
// Phobos rises at about 10:30 PM. Until then the moonlight comes from its
// bearing but never lower than MOONLIGHT.minElevation (never from under the
// ground), and dimmed to MOONLIGHT.downLevel: the early evening is the
// darkest part of the night, and it brightens as Phobos comes up.
//
// It lights the scene as soon as it is built (onAwake), so the main menu,
// over a scene that never ticks, shows the dusk the first night starts in.
//
// Nothing is allocated per frame. Through the night the hour moves, so the
// sky and the light are rewritten every frame; in the morning the clock has
// stopped and nothing is written at all.
// ─────────────────────────────────────────────

const DEFAULT_DAY = {
  // Sunlit dust bounces warm light everywhere, into the rooms too.
  ambientColor:     0xb89a80,
  ambientIntensity: 1.4,
  // Mars gets ~43% of Earth's sunlight, but the eye adapts; this reads as a
  // bright, slightly hazy morning against the dark night.
  sunColor:         0xffe0c0,
  sunIntensity:     2.2,
  // Unset: the sky's day horizon, so the terrain fades into the sky behind it.
  fogColor:         null,
  // Degrees up the sun light comes from, on the Sun's bearing. The Sun
  // itself is on the horizon, and light that low would leave the ground in
  // the terrain's shadow; 30° is the height the moonlight was tuned at.
  sunElevation:     30,
};

/** The moonlight while Phobos is down. */
export const MOONLIGHT = {
  /** Degrees: the light never comes from lower than this. */
  minElevation: 20,
  /** Its night intensity, as a fraction, with Phobos below the horizon. */
  downLevel:    0.35,
  /** Degrees of Phobos's elevation over which it brightens to full. */
  rise:         [-10, 10],
};

const _day   = new THREE.Vector3();
const _light = new THREE.Vector3();

/**
 * How far into the day it is: 0 at night, 1 in daylight.
 *
 * The shift starts at sunset in daylight (1), which fades to night (0) over
 * its first hour. The Sun comes up over the last hour — 0 until an hour
 * before the end, easing to 1 at the end — and it stays up all morning,
 * until sleep starts the next night.
 *
 * @param {number} hour   The clock's current in-game hour.
 * @param {string} state  GameController state.
 * @param {{ startHour?: number, endHour?: number }} [opts]  When the shift
 *        starts (6 PM, -6) and ends (6 AM).
 * @returns {number} 0 … 1
 */
export function dawnFactor(hour, state, { startHour = SHIFT.startHour, endHour = SHIFT.endHour } = {}) {
  if (state === 'morning' || state === 'finished') return 1;
  const dawn = THREE.MathUtils.clamp(hour - (endHour - 1), 0, 1);
  const dusk = THREE.MathUtils.clamp(startHour + 1 - hour, 0, 1);
  return smoothstep(Math.max(dawn, dusk));
}

/** Eases in and out of a change rather than starting and stopping on a hard edge. */
function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

export class Daylight extends Component {
  /** The dawn factor currently applied, 0 … 1. */
  factor = 0;
  /** The clock hour currently applied; null until the first update. */
  hour = null;

  /**
   * @param {Object} opts
   * @param {import('../gameplay/GameController.js').GameController} opts.controller
   * @param {import('../core/GameObject.js').GameObject} [opts.sky]  A MarsSky.
   * @param {THREE.Light} [opts.ambient]
   * @param {THREE.Light} [opts.sun]
   * @param {THREE.Fog|THREE.FogExp2} [opts.fog]
   * @param {Partial<typeof DEFAULT_DAY>} [opts.day]  Day targets.
   */
  constructor({ controller, sky = null, ambient = null, sun = null, fog = null, day = {} } = {}) {
    super();
    this.controller = controller;
    this.sky        = sky;

    const target = { ...DEFAULT_DAY, ...day };
    const dayFog = target.fogColor ?? sky?.skyUniforms?.uDayHorizonColor?.value.getHex();

    this._ambient = ambient && lerpable(ambient, target.ambientColor, target.ambientIntensity);
    this._sun     = sun     && lerpable(sun,     target.sunColor,     target.sunIntensity);
    // Built once: apply() runs every frame of the night.
    this._lights  = [this._ambient, this._sun].filter(Boolean);
    this._fog     = fog && dayFog !== undefined && {
      color: fog.color,
      night: fog.color.clone(),
      day:   new THREE.Color(dayFog),
    };

    // Aimed only when there is a turning sky to follow.
    this._aim = sun && sky?.directions && {
      light:     sun,
      distance:  sun.position.distanceTo(sun.target.position),
      elevation: THREE.MathUtils.degToRad(target.sunElevation),
    };
  }

  /** Light the scene for the hour it was built at — the main menu shows it. */
  onAwake() {
    this.onUpdate();
  }

  onUpdate() {
    const clock = this.controller?.nightClock;
    if (!clock) return;

    const hour   = clock.currentTime;
    const factor = dawnFactor(hour, this.controller.state, { startHour: clock.startHour, endHour: clock.endHour });
    if (factor === this.factor && hour === this.hour) return;
    this.apply(factor, hour);
  }

  /** Set the scene to `factor` of the way from night (0) to day (1), with
   *  the sky turned to `hour`. */
  apply(factor, hour = this.hour ?? 0) {
    this.factor = factor;
    this.hour   = hour;

    this.sky?.setHour?.(hour);

    const uDawn = this.sky?.skyUniforms?.uDawn;
    if (uDawn) uDawn.value = factor;

    // How much of the moonlight there is: dimmed while Phobos is down.
    const moon = this._aim ? moonLevel(this.sky.directions.phobos.y) : 1;

    for (const light of this._lights) {
      light.target.color.lerpColors(light.night.color, light.day.color, factor);
      const night = light === this._sun ? light.night.intensity * moon : light.night.intensity;
      // MathUtils.lerp lands exactly on either end, so a light comes back to
      // precisely its night intensity.
      light.target.intensity = THREE.MathUtils.lerp(night, light.day.intensity, factor);
    }

    if (this._fog) this._fog.color.lerpColors(this._fog.night, this._fog.day, factor);

    if (this._aim) this._aimSun(factor);
  }

  /** Night: along Phobos, never lower than MOONLIGHT.minElevation. Day: the
   *  Sun's bearing, lifted to sunElevation. In between, the direction swings
   *  from one to the other. */
  _aimSun(factor) {
    const { light, distance, elevation } = this._aim;
    const { sun, phobos } = this.sky.directions;

    _day.set(sun.x, 0, sun.z).normalize().multiplyScalar(Math.cos(elevation));
    _day.y = Math.sin(elevation);
    if (phobos.y < MIN_MOON_Y) {
      _light.set(phobos.x, 0, phobos.z).normalize().multiplyScalar(MIN_MOON_XZ);
      _light.y = MIN_MOON_Y;
    } else {
      _light.copy(phobos);
    }
    _light.lerp(_day, factor).normalize();
    light.position.copy(light.target.position).addScaledVector(_light, distance);
  }
}

const MIN_MOON_Y  = Math.sin(THREE.MathUtils.degToRad(MOONLIGHT.minElevation));
const MIN_MOON_XZ = Math.cos(THREE.MathUtils.degToRad(MOONLIGHT.minElevation));
const RISE_FROM   = Math.sin(THREE.MathUtils.degToRad(MOONLIGHT.rise[0]));
const RISE_TO     = Math.sin(THREE.MathUtils.degToRad(MOONLIGHT.rise[1]));

/** The moonlight's share of its night intensity for Phobos `y` up (the sine
 *  of its elevation): MOONLIGHT.downLevel below the horizon, full once up. */
function moonLevel(y) {
  const t = THREE.MathUtils.clamp((y - RISE_FROM) / (RISE_TO - RISE_FROM), 0, 1);
  return THREE.MathUtils.lerp(MOONLIGHT.downLevel, 1, smoothstep(t));
}

/** A light's night (as it is now) and day ends, with preallocated colours. */
function lerpable(light, dayColor, dayIntensity) {
  return {
    target: light,
    night:  { color: light.color.clone(),       intensity: light.intensity },
    day:    { color: new THREE.Color(dayColor), intensity: dayIntensity },
  };
}
