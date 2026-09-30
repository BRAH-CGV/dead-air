import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// CoffeeThermos  –  the drink key, and the cups left on the HUD
// ─────────────────────────────────────────────
// On GameplaySystems, beside StaminaDrain. The Thermos is pure; this ticks
// its sip and reads the drink key (Engine.keyBinds.drink, F) as a one-frame
// press, so holding it down drinks one cup. Only during the shift, and not
// from the fly camera (the player is frozen there). A cup plays the sip.
// ─────────────────────────────────────────────

const SIP_VOLUME = 0.8;

/**
 * A KeyboardEvent.code as the HUD shows it: 'KeyF' → 'F', 'Digit2' → '2'.
 * @param {string} code
 */
export function keyLabel(code) {
  return code?.replace(/^(Key|Digit)/, '') ?? '';
}

export class CoffeeThermos extends Component {
  /**
   * @param {object} opts
   * @param {import('../gameplay/Thermos.js').Thermos} opts.thermos
   * @param {import('../gameplay/Stamina.js').Stamina} opts.stamina
   * @param {{state: string}} opts.controller
   * @param {{setCoffee(cups: number, key: string): void}|null} [opts.hud]
   * @param {import('../audio/AudioSystem.js').AudioSystem|null} [opts.audio]
   * @param {object|null} [opts.engine]  defaults to the scene's engine
   */
  constructor({ thermos, stamina, controller, hud = null, audio = null, engine = null }) {
    super();
    this.thermos = thermos;
    this.stamina = stamina;
    this.controller = controller;
    this.hud = hud;
    this.audio = audio;
    this._engine = engine;
  }

  onUpdate(dt) {
    this.thermos.update(dt);
    const engine = this._engine ?? this.scene?.userData?.engine;
    const code = engine?.keyBinds?.drink;
    if (this.controller.state === 'playing' && !engine?.debugCamera?.active
        && engine?.input?.pressed?.[code] && this.thermos.drink(this.stamina)) {
      this.audio?.play('sfx:sip', { volume: SIP_VOLUME });
    }
    this.hud?.setCoffee(this.thermos.cups, keyLabel(code));
  }
}
