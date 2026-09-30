import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// Power  –  the generator's output: on, or the emergency glow
// ─────────────────────────────────────────────
// One switch for the whole base. Cutting it (the generator's lever, outside)
// drops every interior light to the battery-fed emergency level, shuts the
// terminal and parks the dish — BaseScene wires those to `onChange`. The
// airlock is on its own battery, so it cycles either way.
//
// The lights don't fade: they stutter, catching once or twice on the way
// down (or up) before they settle, over FLICKER_TIME. The level is written
// to BaseLights as its 'power' factor, only while it is moving.
//
// reset() is a new night: power on at once, no flicker.
// ─────────────────────────────────────────────

/** What is left with the generator off: the emergency lights. */
export const EMERGENCY_LEVEL = 0.08;

/** How long the lights stutter before they settle (s). */
export const FLICKER_TIME = 0.6;

/** How much of the change is still to come, step by step through the
 *  flicker. It comes back up twice: a stutter, not a fade. */
const STUTTER = [1, 0.15, 0.7, 0.05, 0.45, 0, 0.25, 0];

export class Power extends Component {
  /**
   * @param {object} [opts]
   * @param {{ setFactor(key: string, value: number): void }|null} [opts.lights]  BaseLights.
   */
  constructor({ lights = null } = {}) {
    super();
    this.lights = lights;
    this.on = true;
    /** The light level the power gives, 1 on down to EMERGENCY_LEVEL. */
    this.level = 1;
    this._from = 1;
    this._t = FLICKER_TIME;
    this._listeners = new Set();
  }

  /** Switch it. Does nothing if it already is. */
  set(on) {
    on = !!on;
    if (on === this.on) return;
    this.on = on;
    this._from = this.level;
    this._t = 0;
    this._emit();
  }

  toggle() {
    this.set(!this.on);
  }

  /** A new night: on at once, the lights straight to full. */
  reset() {
    this.on = true;
    this.level = 1;
    this._t = FLICKER_TIME;
    this.lights?.setFactor('power', 1);
    this._emit();
  }

  /**
   * @param {(on: boolean) => void} fn
   * @returns {() => void} Unsubscribe.
   */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) fn(this.on);
  }

  onUpdate(dt) {
    if (this._t >= FLICKER_TIME) return;
    this._t += dt;
    const to = this.on ? 1 : EMERGENCY_LEVEL;
    if (this._t >= FLICKER_TIME) this.level = to;
    else this.level = to + (this._from - to) * STUTTER[Math.floor((this._t / FLICKER_TIME) * STUTTER.length)];
    this.lights?.setFactor('power', this.level);
  }
}
