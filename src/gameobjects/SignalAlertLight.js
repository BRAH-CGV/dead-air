import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// SignalAlertLight  –  the red lamp over the computer desk
// ─────────────────────────────────────────────
// Signals only show for a short window, so the office needs something that
// drags the player to the terminal the moment one opens. This is that thing:
//
//   const light = room.root.addChild(new SignalAlertLight());
//   light.object3d.position.set(0, 1.3, -2.45);   // above the computer
//   light.signalManager  = signalManager;         // scene wiring
//   light.gameController = gameController;        // dark outside 'playing'
//
// While an unscanned signal is still visible (opacity > 0) the bulb blinks
// square-wave between a bright and a dim emissiveIntensity; with nothing to
// scan it sits at the dim level, indistinguishable from a dead lamp. If a
// controller is wired it only alerts during 'playing' — a lingering morning
// signal must not keep it blinking.
//
// Placeholder until a proper warning-lamp model is sourced. It owns its
// geometry and material; dispose() frees them.
// ─────────────────────────────────────────────

/** Drives the bulb each frame. */
class SignalAlertLightBlink extends Component {
  onUpdate(dt) {
    this.gameObject._tick(dt);
  }
}

export class SignalAlertLight extends GameObject {
  /** The signals to watch. @type {import('../gameplay/SignalManager.js').SignalManager|null} */
  signalManager = null;

  /** Gates the lamp to 'playing'. @type {import('../gameplay/GameController.js').GameController|null} */
  gameController = null;

  /** @type {THREE.Mesh} */ bulb;

  /** Seconds for one on/off blink cycle. */
  period;
  /** emissiveIntensity while the bulb is lit. */
  onIntensity;
  /** emissiveIntensity while dark — a lamp that is off, not gone. */
  offIntensity;

  _phase = 0;

  /**
   * @param {string} [name]
   * @param {object} [opts]
   * @param {number} [opts.period=0.8]        Seconds for one on/off cycle.
   * @param {number} [opts.onIntensity=3]
   * @param {number} [opts.offIntensity=0.05]
   */
  constructor(name = 'SignalAlertLight', { period = 0.8, onIntensity = 3, offIntensity = 0.05 } = {}) {
    super(name);
    this.period = period;
    this.onIntensity = onIntensity;
    this.offIntensity = offIntensity;
    this._build();
    this.addComponent(new SignalAlertLightBlink());
  }

  /** True while any unscanned signal is still visible. */
  isAlerting() {
    if (this.gameController && this.gameController.state !== 'playing') return false;
    const mgr = this.signalManager;
    if (!mgr) return false;
    return mgr.signals.some(s => !s.scanned && s.opacity > 0);
  }

  /** Free the geometry and material the lamp built. */
  dispose() {
    const resources = new Set();
    this.object3d.traverse(o => {
      if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); }
    });
    for (const resource of resources) resource.dispose();
  }

  _tick(dt) {
    if (!this.isAlerting()) {
      this.bulb.material.emissiveIntensity = this.offIntensity;
      this._phase = 0;   // the next window starts on, not mid-off
      return;
    }
    this._phase = (this._phase + dt) % this.period;
    const on = this._phase < this.period / 2;
    this.bulb.material.emissiveIntensity = on ? this.onIntensity : this.offIntensity;
  }

  _build() {
    this.bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 16, 12),
      new THREE.MeshStandardMaterial({
        color: 0x1a0505,
        emissive: 0xff2211,
        emissiveIntensity: this.offIntensity,
        roughness: 0.4,
      }),
    );
    this.bulb.name = 'AlertBulb';
    this.object3d.add(this.bulb);
  }
}
