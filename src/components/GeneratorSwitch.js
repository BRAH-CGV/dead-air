import { Interactable } from './Interactable.js';

// ─────────────────────────────────────────────
// GeneratorSwitch  –  the generator's lever, outside the base
// ─────────────────────────────────────────────
// Toggles the base's Power. The prompt says what pressing it will do, and
// follows the power however it changes — a new night turns it back on
// without anyone touching the lever.
// ─────────────────────────────────────────────

export const CUT_POWER = '[E] Cut power';
export const RESTORE_POWER = '[E] Restore power';

export class GeneratorSwitch extends Interactable {
  promptLabel = CUT_POWER;

  /** @type {import('../gameplay/Power.js').Power|null} */
  power = null;
  _unbind = null;

  /** @param {import('../gameplay/Power.js').Power} power */
  bind(power) {
    this._unbind?.();
    this.power = power;
    this._follow(power.on);
    this._unbind = power.onChange(on => this._follow(on));
    return this;
  }

  _follow(on) {
    this.promptLabel = on ? CUT_POWER : RESTORE_POWER;
  }

  onInteract() {
    this.power?.toggle();
  }

  onDestroy() {
    this._unbind?.();
    this._unbind = null;
    this.power = null;
  }
}
