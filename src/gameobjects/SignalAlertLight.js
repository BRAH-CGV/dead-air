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
// It runs off the PowerGrid (`powerLevel`, set by the grid): dark with the
// power off or the bulb blown. While the UFO closes in, `frantic` makes it
// flash in short, uneven, over-bright bursts whatever the signals are doing.
// Its bulb is `offGrid` so the grid's collect() leaves the material to it.
//
// `lit` says whether the bulb is shining this frame, for whoever wants to
// act on each light-up (ScannerAlertSound beeps on it).
//
// Placeholder until a proper warning-lamp model is sourced. It owns its
// geometry and material; dispose() frees them.
// ─────────────────────────────────────────────

/** Frantic flashing: seconds each burst or gap holds, and how much brighter
 *  than a normal alert the bursts are. */
const FRANTIC_MIN = 0.03;
const FRANTIC_MAX = 0.11;
const FRANTIC_GAIN = 2;

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

  /** Is the bulb shining right now? False through the dim half of a blink,
   *  with nothing to scan and with no power. */
  lit = false;

  /** Set while the UFO closes in: the lamp flashes wildly, signal or not. */
  frantic = false;
  /** From the PowerGrid: 0 with the power off or the bulb blown, past 1 in
   *  a surge. The grid sets it; the lamp owns its own blinking. */
  powerLevel = 1;

  _franticOn = false;
  _franticHold = 0;

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
    if (this.powerLevel <= 0) {
      this.bulb.material.emissiveIntensity = 0;
      this.lit = false;
      return;
    }
    if (this.frantic) {
      this._tickFrantic(dt);
      return;
    }
    if (!this.isAlerting()) {
      this.bulb.material.emissiveIntensity = this.offIntensity;
      this._phase = 0;   // the next window starts on, not mid-off
      this.lit = false;
      return;
    }
    this._phase = (this._phase + dt) % this.period;
    const on = this._phase < this.period / 2;
    this.lit = on;
    this.bulb.material.emissiveIntensity = (on ? this.onIntensity : this.offIntensity) * Math.max(this.powerLevel, 1);
  }

  /** The UFO's field in the line: short, uneven bursts, brighter than any
   *  signal ever drives it. Held states of FRANTIC_MIN..MAX seconds. */
  _tickFrantic(dt) {
    this._franticHold -= dt;
    if (this._franticHold <= 0) {
      this._franticOn = !this._franticOn;
      this._franticHold = FRANTIC_MIN + Math.random() * (FRANTIC_MAX - FRANTIC_MIN);
    }
    this.lit = this._franticOn;
    this.bulb.material.emissiveIntensity = this._franticOn
      ? this.onIntensity * FRANTIC_GAIN * Math.max(this.powerLevel, 1)
      : this.offIntensity;
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
    this.bulb.userData.offGrid = true;   // drives its own glow from powerLevel
    this.object3d.add(this.bulb);
  }
}
