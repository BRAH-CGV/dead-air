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
// It blinks on real time (engine.realDt), so a nap's fast-forward doesn't
// set it — and its beep — racing.
//
// Handed the bulb model (`model`, an instance of model:bulb) it wears that:
// screwed into a small dark socket standing on its origin, its glass a
// see-through red that glows, its filament (the base's emissive map) glowing
// brighter inside. On copies of the model's materials: the cached ones are
// shared. Without one (a test, a scene with no assets) it is a red sphere.
// dispose() frees what it made, never the model's geometry.
// ─────────────────────────────────────────────

/** Frantic flashing: seconds each burst or gap holds, and how much brighter
 *  than a normal alert the bursts are. */
const FRANTIC_MIN = 0.03;
const FRANTIC_MAX = 0.11;
const FRANTIC_GAIN = 2;

/** The bulb model's fitting, for bulb.glb at its manifest scale, metres:
 *  the socket it stands in, how far above the lamp's origin the model's
 *  own origin goes (the screw's foot 1.2 cm into the socket), and how much
 *  brighter than the glass the filament glows. */
export const BULB = Object.freeze({
  socket: Object.freeze({ radius: 0.022, height: 0.038, plate: 0.04, plateHeight: 0.008 }),
  lift: 0.0373,
  filamentGain: 2.5,
  glass: Object.freeze({ tint: 0xff6a55, opacity: 0.55 }),
  filament: 0xff4422,
});
const GLOW = 0xff2211;

/** Drives the bulb each frame, on real time: a nap hands the updates 15×
 *  the frame (engine.timeScale), and a lamp — and its beep — racing at 15×
 *  is no lamp at all. With no engine (a bare lamp) it takes what it's given. */
class SignalAlertLightBlink extends Component {
  onUpdate(dt) {
    this.gameObject._tick(this.scene?.userData?.engine?.realDt ?? dt);
  }
}

export class SignalAlertLight extends GameObject {
  /** The signals to watch. @type {import('../gameplay/SignalManager.js').SignalManager|null} */
  signalManager = null;

  /** Gates the lamp to 'playing'. @type {import('../gameplay/GameController.js').GameController|null} */
  gameController = null;

  /** The glass (or the sphere): the mesh that glows. @type {THREE.Mesh} */ bulb;

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
   * @param {THREE.Object3D|null} [opts.model]  The bulb (model:bulb); a sphere without one.
   */
  constructor(name = 'SignalAlertLight', { period = 0.8, onIntensity = 3, offIntensity = 0.05, model = null } = {}) {
    super(name);
    this.period = period;
    this.onIntensity = onIntensity;
    this.offIntensity = offIntensity;
    /** [material, gain]: what glows, and how much of the lamp's level. */
    this._glows = [];
    this._owned = [];
    this.object3d.userData.offGrid = true;   // drives its own glow from powerLevel
    if (model) this._wear(model);
    else this._build();
    this._glow(this.offIntensity);
    this.addComponent(new SignalAlertLightBlink());
  }

  /** True while any unscanned signal is still visible. */
  isAlerting() {
    if (this.gameController && this.gameController.state !== 'playing') return false;
    const mgr = this.signalManager;
    if (!mgr) return false;
    return mgr.signals.some(s => !s.scanned && s.opacity > 0);
  }

  /** Free what the lamp made: its sphere or socket, and its copies of the
   *  bulb's materials. Never the bulb's geometry: the asset cache's. */
  dispose() {
    for (const resource of this._owned) resource.dispose();
  }

  /** Every glowing material at `level`, each by its gain. */
  _glow(level) {
    for (const [material, gain] of this._glows) material.emissiveIntensity = level * gain;
  }

  _tick(dt) {
    if (this.powerLevel <= 0) {
      this._glow(0);
      this.lit = false;
      return;
    }
    if (this.frantic) {
      this._tickFrantic(dt);
      return;
    }
    if (!this.isAlerting()) {
      this._glow(this.offIntensity);
      this._phase = 0;   // the next window starts on, not mid-off
      this.lit = false;
      return;
    }
    this._phase = (this._phase + dt) % this.period;
    const on = this._phase < this.period / 2;
    this.lit = on;
    this._glow((on ? this.onIntensity : this.offIntensity) * Math.max(this.powerLevel, 1));
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
    this._glow(this._franticOn
      ? this.onIntensity * FRANTIC_GAIN * Math.max(this.powerLevel, 1)
      : this.offIntensity);
  }

  /** The stand-in: a red sphere on its middle. */
  _build() {
    this.bulb = new THREE.Mesh(
      this._own(new THREE.SphereGeometry(0.06, 16, 12)),
      this._own(new THREE.MeshStandardMaterial({ color: 0x1a0505, emissive: GLOW, roughness: 0.4 })),
    );
    this.bulb.name = 'AlertBulb';
    this._glows.push([this.bulb.material, 1]);
    this.object3d.add(this.bulb);
  }

  /** The bulb model, screwed into a socket on the lamp's origin. */
  _wear(model) {
    const { socket } = BULB;
    const metal = this._own(new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.5, metalness: 0.6 }));
    const holder = new THREE.Mesh(this._own(new THREE.CylinderGeometry(socket.radius, socket.radius, socket.height, 20)), metal);
    holder.name = 'AlertSocket';
    holder.position.y = socket.height / 2;
    const plate = new THREE.Mesh(this._own(new THREE.CylinderGeometry(socket.plate, socket.plate, socket.plateHeight, 24)), metal);
    plate.position.y = socket.plateHeight / 2;
    this.object3d.add(holder, plate);

    model.position.y = BULB.lift;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      const material = this._own(o.material.clone());
      o.material = material;
      if (/glass/.test(material.name)) {
        o.name = 'AlertBulb';
        this.bulb = o;
        material.color.setHex(BULB.glass.tint);
        Object.assign(material, { transparent: true, opacity: BULB.glass.opacity, depthWrite: false });
        material.emissive.setHex(GLOW);
        this._glows.push([material, 1]);
      } else {
        o.name = 'AlertFilament';
        material.emissive.setHex(BULB.filament);
        this._glows.push([material, BULB.filamentGain]);
      }
    });
    this.object3d.add(model);
  }

  _own(resource) {
    this._owned.push(resource);
    return resource;
  }
}
