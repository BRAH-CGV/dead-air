import * as THREE from 'three';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// Flashlight  –  a short-reach torch in the player's hand
// ─────────────────────────────────────────────
// Rides on the Player; F (Engine keyBinds.flashlight) toggles it. Bright up
// close, but a narrow cone with inverse-square falloff that dies within a
// few metres, so it shows what's right in front of you and nothing that's
// waiting further down the corridor. Horror needs the dark to stay dark.
//
//   player.addComponent(new Flashlight({ intensity: 40, distance: 9 }));
//
// The light hangs off the camera, held a little low and to the right like a
// hand-held torch, so it follows the view — and the debug fly camera, which
// carries the camera off with it.
//
// Off is intensity 0, never `visible = false`: three.js compiles the light
// count into every lit material's shader, so hiding a light recompiles the
// whole scene and the first press would hitch. A zero-intensity light costs
// a few uniforms and nothing else.
//
// Something can interfere with it (setInterference, by a name of its own):
// while anyone does, the light stutters (FlashlightStutter). The Sleep Demon
// does, while the beam is on him.
// ─────────────────────────────────────────────

/** The stutter: irregular dips and brief dropouts, never a clean strobe. */
export const FLASHLIGHT_STUTTER = Object.freeze({
  /** The lowest a dip goes, a share of full intensity. Above 0, so only a
   *  dropout ever puts it out. */
  floor: 0.15,
  /** Seconds each dip holds, a fresh random length every time: an even
   *  rhythm reads as a strobe, not as a failing torch. */
  holdMin: 0.03,
  holdMax: 0.12,
  /** Dropouts a second, on average, at random moments. */
  dropoutsPerSecond: 3,
  /** Seconds a dropout is fully off: a blink, never longer. */
  dropoutMin: 0.03,
  dropoutMax: 0.08,
});

const lerp = (a, b, t) => a + (b - a) * t;

/** The stutter's pattern and timing, with no light attached: a share of
 *  full intensity, frame by frame. */
export class FlashlightStutter {
  /** The share of full intensity now, 0 … 1. */
  level = 1;

  /**
   * @param {object} [opts]
   * @param {typeof FLASHLIGHT_STUTTER} [opts.tuning]
   * @param {() => number} [opts.rand]
   */
  constructor({ tuning = FLASHLIGHT_STUTTER, rand = Math.random } = {}) {
    Object.assign(this, { tuning, rand });
    this.start();
  }

  /** Fresh interference. It opens with a dip, in the lower half, so even a
   *  quick sweep across whatever causes it shows. */
  start() {
    const t = this.tuning;
    this._out = false;
    this._toDropout = this._gap();
    this._hold(lerp(t.floor, (1 + t.floor) / 2, this.rand()));
  }

  /** @param {number} dt @returns {number} the level */
  update(dt) {
    const t = this.tuning;
    this._left -= dt;
    if (this._out) {
      if (this._left > 0) return this.level;
      // Back on after a blink, and the next dropout counted from here, so
      // two never run together into a long dark.
      this._out = false;
      this._toDropout = this._gap();
      this._hold(lerp(t.floor, 1, this.rand()));
      return this.level;
    }
    this._toDropout -= dt;
    if (this._toDropout <= 0) {
      this._out = true;
      this.level = 0;
      this._left = lerp(t.dropoutMin, t.dropoutMax, this.rand());
    } else if (this._left <= 0) {
      this._hold(lerp(t.floor, 1, this.rand()));
    }
    return this.level;
  }

  // ── Private ──

  _hold(level) {
    this.level = level;
    this._left = lerp(this.tuning.holdMin, this.tuning.holdMax, this.rand());
  }

  /** Seconds to the next dropout: anywhere from half to one and a half
   *  times the average gap. */
  _gap() {
    return (0.5 + this.rand()) / this.tuning.dropoutsPerSecond;
  }
}

export class Flashlight extends Component {
  /** True while the torch is on. */
  on = false;

  /** @type {THREE.SpotLight|null} */
  light = null;

  /**
   * @param {object} [opts]
   * @param {number} [opts.intensity=40]  Candela while on. Several times the
   *        room lights (2–14) up close; inverse-square falloff still has it fading a few metres out.
   * @param {number} [opts.distance=9]    Metres to complete falloff.
   * @param {number} [opts.angle=0.45]    Cone half-angle, radians (~26°).
   * @param {number} [opts.penumbra=0.7]  Soft edge — a hard disc reads as a game light.
   * @param {number} [opts.color=0xffe6c4] Warm, slightly yellow incandescent bulb.
   * @param {typeof FLASHLIGHT_STUTTER} [opts.stutter]  How it stutters under interference.
   * @param {() => number} [opts.rand]  The stutter's dice.
   */
  constructor({
    intensity = 40,
    distance = 9,
    angle = 0.45,
    penumbra = 0.7,
    color = 0xffe6c4,
    stutter = FLASHLIGHT_STUTTER,
    rand = Math.random,
  } = {}) {
    super();
    this.intensity = intensity;
    this.distance  = distance;
    this.angle     = angle;
    this.penumbra  = penumbra;
    this.color     = color;
    this.stutter   = new FlashlightStutter({ tuning: stutter, rand });
    /** Who is interfering, by name. */
    this._interference = new Set();
  }

  /** Something is interfering with it: on, it stutters. */
  get interfered() {
    return this._interference.size > 0;
  }

  /**
   * Interfere with the light, under a name of your own, or stop. It stutters
   * while anyone interferes, and is back at exactly `intensity` the moment
   * the last one stops. Switched off, it stays off.
   * @param {boolean} on
   * @param {string} [source]
   */
  setInterference(on, source = 'default') {
    const was = this.interfered;
    if (on) this._interference.add(source);
    else this._interference.delete(source);
    if (this.interfered === was) return;
    if (this.interfered) this.stutter.start();
    else if (this.on && this.light) this.light.intensity = this.intensity;
  }

  get _engine() {
    return this.gameObject?.scene?.userData?.engine ?? null;
  }

  /** On awake, not start: awake runs while the scene is built, before the
   *  boot warm-up compiles every shader. A light added on the first frame
   *  instead changes the light count after that, and every lit shader
   *  recompiles. */
  onAwake() {
    const camera = this._engine?.camera;
    if (!camera || this.light) return;

    // decay 2 is physical inverse-square falloff — the reason the beam fades
    // out fast instead of carrying evenly to `distance`.
    const light = new THREE.SpotLight(this.color, 0, this.distance, this.angle, this.penumbra, 2);
    light.name = 'Flashlight';
    light.position.set(0.18, -0.15, 0);   // held low and to the right
    light.target.position.set(0, 0, -4);  // aimed down the view, converging on the crosshair
    camera.add(light, light.target);
    this.light = light;
  }

  onUpdate(dt) {
    const engine = this._engine;
    if (!engine || !this.light) return;
    if (engine.input.pressed[engine.keyBinds.flashlight]) this.toggle();
    if (this.on && this.interfered) this.light.intensity = this.intensity * this.stutter.update(dt);
  }

  /** Switch it on if it's off, off if it's on. @returns {boolean} on */
  toggle() {
    this.on = !this.on;
    if (this.light) this.light.intensity = this.on ? this.intensity : 0;
    return this.on;
  }

  onDestroy() {
    if (!this.light) return;
    this.light.removeFromParent();
    this.light.target.removeFromParent();
    this.light.dispose();
    this.light = null;
  }
}
