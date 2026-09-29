import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// EVASuit  –  whether the player is suited up for the surface
// ─────────────────────────────────────────────
// Rides on the Player. The suit locker in the airlock toggles it; the
// airlock's outer hatch and the HUD listen through onChange. It is state,
// not behaviour — no per-frame hooks — so nothing polls it.
//
//   const suit = engine.player.getComponent(EVASuit);
//   suit.onChange(worn => hatch.locked = !worn);
// ─────────────────────────────────────────────

export class EVASuit extends Component {
  /** True while the suit is on. Change it through putOn/takeOff so
   *  listeners hear about it. */
  worn = false;

  _listeners = new Set();

  putOn()   { this._set(true); }
  takeOff() { this._set(false); }

  /** Put it on if it's off, take it off if it's on. @returns {boolean} worn */
  toggle() {
    this._set(!this.worn);
    return this.worn;
  }

  /** Subscribe to changes: `listener(worn)`. @returns {() => void} unsubscribe */
  onChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _set(worn) {
    if (worn === this.worn) return;
    this.worn = worn;
    for (const listener of [...this._listeners]) listener(worn);
  }
}
