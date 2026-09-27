import * as THREE from 'three';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// Daylight  –  turns the night into the Martian day at the end of a shift
// ─────────────────────────────────────────────
// Reads how far into the dawn it is from the GameController (its clock and
// state) and applies that one number to everything that should change with
// it: the sky shader's uDawn uniform, the ambient and sun lights, and the fog.
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
// Nothing is allocated per frame, and nothing is written while the factor
// holds still — which is all night, and all morning.
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
};

/**
 * How far into the day it is: 0 at night, 1 in daylight.
 *
 * The Sun comes up over the last hour of the shift — 0 until an hour before
 * the end, easing to 1 at the end — and it stays up all morning, until sleep
 * starts the next night.
 *
 * @param {number} hour   The clock's current in-game hour.
 * @param {string} state  GameController state.
 * @param {{ endHour?: number }} [opts]  When the shift ends (6 AM).
 * @returns {number} 0 … 1
 */
export function dawnFactor(hour, state, { endHour = 6 } = {}) {
  if (state === 'morning' || state === 'finished') return 1;
  const t = THREE.MathUtils.clamp(hour - (endHour - 1), 0, 1);
  // Smoothstep, so the light eases in and out of the change rather than
  // starting and stopping on a hard edge.
  return t * t * (3 - 2 * t);
}

export class Daylight extends Component {
  /** The dawn factor currently applied, 0 … 1. */
  factor = 0;

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
    this._fog     = fog && dayFog !== undefined && {
      color: fog.color,
      night: fog.color.clone(),
      day:   new THREE.Color(dayFog),
    };
  }

  onUpdate() {
    const clock = this.controller?.nightClock;
    if (!clock) return;

    const factor = dawnFactor(clock.currentTime, this.controller.state, { endHour: clock.endHour });
    if (factor === this.factor) return;
    this.apply(factor);
  }

  /** Set the scene to `factor` of the way from night (0) to day (1). */
  apply(factor) {
    this.factor = factor;

    const uDawn = this.sky?.skyUniforms?.uDawn;
    if (uDawn) uDawn.value = factor;

    for (const light of [this._ambient, this._sun]) {
      if (!light) continue;
      light.target.color.lerpColors(light.night.color, light.day.color, factor);
      // MathUtils.lerp lands exactly on either end, so a light comes back to
      // precisely its night intensity.
      light.target.intensity = THREE.MathUtils.lerp(light.night.intensity, light.day.intensity, factor);
    }

    if (this._fog) this._fog.color.lerpColors(this._fog.night, this._fog.day, factor);
  }
}

/** A light's night (as it is now) and day ends, with preallocated colours. */
function lerpable(light, dayColor, dayIntensity) {
  return {
    target: light,
    night:  { color: light.color.clone(),       intensity: light.intensity },
    day:    { color: new THREE.Color(dayColor), intensity: dayIntensity },
  };
}
