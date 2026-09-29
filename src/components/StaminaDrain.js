import { Component } from '../core/Component.js';

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
// ─────────────────────────────────────────────

export class StaminaDrain extends Component {
  /**
   * @param {object} opts
   * @param {import('../gameplay/Stamina.js').Stamina} opts.stamina
   * @param {{state: string, nightNumber: number}} opts.controller
   * @param {{setStamina(value: number, level: string): void}|null} [opts.hud]
   * @param {(() => void)|null} [opts.onNightStart]  e.g. the dispenser's reset
   */
  constructor({ stamina, controller, hud = null, onNightStart = null }) {
    super();
    this.stamina = stamina;
    this.controller = controller;
    this.hud = hud;
    this.onNightStart = onNightStart;
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
  }
}
