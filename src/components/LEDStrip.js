import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// LEDStrip  –  independently blinking status-light meshes
// ─────────────────────────────────────────────
// A handful of small emissive meshes (server-rack indicator dots, say),
// each toggling between a dim and a bright emissiveIntensity on its own
// phase-offset cycle — so a row of them reads as flashing lights, not one
// light synced across every dot. Attach to any GameObject; the meshes
// themselves can live anywhere in the scene graph.
// ─────────────────────────────────────────────

export class LEDStrip extends Component {
  /**
   * @param {{material:{emissiveIntensity:number}}[]} leds  Meshes to drive.
   * @param {object} [opts]
   * @param {number} [opts.period=0.6]         Seconds for one on/off cycle.
   * @param {number} [opts.onIntensity=2.5]
   * @param {number} [opts.offIntensity=0.4]
   */
  constructor(leds, { period = 0.6, onIntensity = 2.5, offIntensity = 0.4 } = {}) {
    super();
    this.leds = [...leds];
    this.period = period;
    this.onIntensity = onIntensity;
    this.offIntensity = offIntensity;
    // Evenly spread starting phases so the dots don't blink in lockstep.
    this._phase = this.leds.map((_, i) => (i / this.leds.length) * period);
  }

  onUpdate(dt) {
    for (let i = 0; i < this.leds.length; i++) {
      this._phase[i] = (this._phase[i] + dt) % this.period;
      const on = this._phase[i] < this.period / 2;
      this.leds[i].material.emissiveIntensity = on ? this.onIntensity : this.offIntensity;
    }
  }
}
