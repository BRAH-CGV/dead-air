import { Component } from '../core/Component.js';
import { STAMINA } from '../gameplay/Stamina.js';

// ─────────────────────────────────────────────
// StaminaDrain  –  ticks Stamina through the night
// ─────────────────────────────────────────────
// On GameplaySystems, after the controller and before the ThreatDirector,
// so within a frame the Sleep Demon reads this frame's stamina.
//
// Polls the controller the way ThreatDirector does: a night starting (the
// state becoming 'playing', or the night number changing while playing)
// fills the stamina and calls onNightStart; it drains only while playing.
// The day and a failed night hold it. Shows it on the HUD every frame —
// HUD.setStamina only writes the DOM when the percent changes.
//
// A tired player sees the base dim: below 'tired' the lights sink smoothly
// towards FATIGUE_DIM_MIN, written as BaseLights' 'fatigue' factor so it
// multiplies with a power cut instead of overwriting it.
// ─────────────────────────────────────────────

/** How much light a player with no stamina left still sees. */
export const FATIGUE_DIM_MIN = 0.6;

/**
 * The fatigue light factor: 1 until the player is tired, then down to
 * FATIGUE_DIM_MIN at empty, eased (smoothstep) so it creeps in.
 * @param {number} stamina  0 … 1
 */
export function fatigueLight(stamina) {
  const t = Math.min(Math.max(stamina / STAMINA.tiredBelow, 0), 1);
  return FATIGUE_DIM_MIN + (1 - FATIGUE_DIM_MIN) * t * t * (3 - 2 * t);
}

export class StaminaDrain extends Component {
  /**
   * @param {object} opts
   * @param {import('../gameplay/Stamina.js').Stamina} opts.stamina
   * @param {{state: string, nightNumber: number}} opts.controller
   * @param {{setStamina(value: number, level: string): void}|null} [opts.hud]
   * @param {(() => void)|null} [opts.onNightStart]  e.g. the dispenser's reset
   * @param {{ setFactor(key: string, value: number): void }|null} [opts.lights]  BaseLights.
   */
  constructor({ stamina, controller, hud = null, onNightStart = null, lights = null }) {
    super();
    this.stamina = stamina;
    this.controller = controller;
    this.hud = hud;
    this.onNightStart = onNightStart;
    this.lights = lights;
    this._lastState = null;
    this._lastNight = 0;
  }

  onUpdate(dt) {
    const { state, nightNumber } = this.controller;
    const playing = state === 'playing';
    if (playing && (this._lastState !== 'playing' || this._lastNight !== nightNumber)) {
      this.stamina.reset();
      this.onNightStart?.();
    } else if (playing) {
      this.stamina.update(dt);
    }
    this._lastState = state;
    this._lastNight = nightNumber;

    this.hud?.setStamina(this.stamina.value, this.stamina.level);
    this.lights?.setFactor('fatigue', fatigueLight(this.stamina.value));
  }
}
