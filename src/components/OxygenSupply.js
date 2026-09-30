import { Component } from '../core/Component.js';
import { OXYGEN } from '../gameplay/Oxygen.js';

// ─────────────────────────────────────────────
// OxygenSupply  –  the suit's air, spent outside and topped up in the airlock
// ─────────────────────────────────────────────
// On GameplaySystems. Each frame of a shift:
//
//   suit on, outside         the tank drains; below OXYGEN.lowBelow the
//                            helmet beeps every OXYGEN.beepEvery seconds, and
//                            an empty tank ends the night
//   in the pressurised       the tank refills
//   airlock
//
// The HUD gauge shows while the suit is worn. Outside the shift (morning,
// game over) it holds still. The scene says what "outside" and "refilling"
// mean, through the two callbacks, so this knows nothing about rooms.
// ─────────────────────────────────────────────

export const OXYGEN_KILL = 'You ran out of air.';

export class OxygenSupply extends Component {
  /**
   * @param {object} opts
   * @param {import('../gameplay/Oxygen.js').Oxygen} opts.oxygen
   * @param {{worn: boolean}} opts.suit
   * @param {{state: string, fail: (reason: string) => void}} opts.controller
   * @param {() => boolean} opts.isOutside    The player is out on the surface.
   * @param {() => boolean} opts.isRefilling  The player stands in a pressurised airlock.
   * @param {{setOxygen: (v: number|null) => void}|null} [opts.hud]
   * @param {{play: (key: string) => void}|null} [opts.audio]
   */
  constructor({ oxygen, suit, controller, isOutside, isRefilling, hud = null, audio = null }) {
    super();
    this.oxygen = oxygen;
    this.suit = suit;
    this.controller = controller;
    this.isOutside = isOutside;
    this.isRefilling = isRefilling;
    this.hud = hud;
    this.audio = audio;
    this._sinceBeep = Infinity;
  }

  onUpdate(dt) {
    if (this.controller.state !== 'playing') return;
    const tank = this.oxygen;

    if (this.suit.worn && this.isOutside()) {
      tank.drain(dt);
      this._beep(dt);
      if (tank.empty) this.controller.fail(OXYGEN_KILL);
    } else {
      this._sinceBeep = Infinity;
      if (this.isRefilling()) tank.refill(dt);
    }

    this.hud?.setOxygen(this.suit.worn ? tank.value : null);
  }

  /** The first beep on running low, then one every OXYGEN.beepEvery. */
  _beep(dt) {
    if (!this.oxygen.low) { this._sinceBeep = Infinity; return; }
    this._sinceBeep += dt;
    if (this._sinceBeep < OXYGEN.beepEvery) return;
    this._sinceBeep = 0;
    this.audio?.play('sfx:o2-warning');
  }
}
