import { Component } from '../core/Component.js';
import { STAMINA } from '../gameplay/Stamina.js';

// ─────────────────────────────────────────────
// StaminaDrain  –  ticks Stamina through the night
// ─────────────────────────────────────────────
// On GameplaySystems, after the controller and before the Sleep Demon, so
// within a frame the demon reads this frame's stamina.
//
// Every night that starts (the next one, or a retry) fills the stamina and
// calls onNightStart — the dispenser's reset. It drains only while playing;
// the day and a failed night hold it. Shows it on the HUD every frame —
// HUD.setStamina only writes the DOM when the percent changes.
//
// A tired player sees the base dim: below 'tired' the lights sink smoothly
// towards FATIGUE_DIM_MIN, written as the PowerGrid's 'fatigue' factor so it
// multiplies with a power cut or a brown-out instead of overwriting it.
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
   * @param {{ state: string, onNightStart?: (fn: Function) => () => void }} opts.controller
   * @param {{ setStamina(value: number, level: string): void }|null} [opts.hud]
   * @param {(() => void)|null} [opts.onNightStart]  e.g. the dispenser's reset
   * @param {{ setFactor(key: string, value: number): void }|null} [opts.grid]  The PowerGrid.
   */
  constructor({ stamina, controller, hud = null, onNightStart = null, grid = null }) {
    super();
    this.stamina = stamina;
    this.controller = controller;
    this.hud = hud;
    this.onNightStart = onNightStart;
    this.grid = grid;
    this._off = null;
  }

  onStart() {
    this._off = this.controller.onNightStart?.(() => this.reset()) ?? null;
  }

  onDestroy() {
    this._off?.();
    this._off = null;
  }

  /** A new or retried night: wide awake. */
  reset() {
    this.stamina.reset();
    this.onNightStart?.();
  }

  onUpdate(dt) {
    if (this.controller.state === 'playing') this.stamina.update(dt);
    this.hud?.setStamina(this.stamina.value, this.stamina.level);
    this.grid?.setFactor('fatigue', fatigueLight(this.stamina.value));
  }
}
