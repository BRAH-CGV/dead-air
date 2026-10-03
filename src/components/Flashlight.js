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
// ─────────────────────────────────────────────

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
   */
  constructor({
    intensity = 40,
    distance = 9,
    angle = 0.45,
    penumbra = 0.7,
    color = 0xffe6c4,
  } = {}) {
    super();
    this.intensity = intensity;
    this.distance  = distance;
    this.angle     = angle;
    this.penumbra  = penumbra;
    this.color     = color;
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

  onUpdate() {
    const engine = this._engine;
    if (!engine || !this.light) return;
    if (engine.input.pressed[engine.keyBinds.flashlight]) this.toggle();
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
