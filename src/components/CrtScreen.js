import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { EMERGENCY_LEVEL } from '../gameplay/Power.js';

// ─────────────────────────────────────────────
// CrtScreen  –  drives the terminal monitor's shader from the game
// ─────────────────────────────────────────────
// On the ComputerDesk. Each frame it writes the CRT material's four uniforms
// (src/shaders/CrtScreen.js) from what the rest of the game already knows:
//
//   uSignal  the dish's scan: scanProgress / scanTarget.scanTime
//   uPower   the base's Power, 1 on and 0 once only the emergency glow is
//            left — it follows the lights' stutter on the way
//   uNoise   eases toward a target: CRT_NOISE.scanning mid-scan, .idle
//            otherwise, and .disturbed while the power is out or
//            `disturbed()` says something is interfering (a Watcher at the
//            glass)
//   uTime    its own clock
//
// It only writes numbers into the material's existing uniform objects:
// nothing is allocated per frame. The scene owns the material and the mesh.
// ─────────────────────────────────────────────

export const CRT_NOISE = Object.freeze({
  /** The dish is aimed at nothing: a hiss of static over the radar. */
  idle: 0.3,
  /** Mid-scan: the picture is clean. */
  scanning: 0.05,
  /** The power is out, or something is at the window: all static. */
  disturbed: 1,
  /** How quickly the static follows (1/s). */
  ease: 6,
});

/** uTime wraps here so the shader's float never loses precision. */
const TIME_WRAP = 1000;

/**
 * Where the screen sits on `model:retro-computer`, in the model's own units
 * (the desk spawns at scale 0.016, so 1 unit is 1.6 cm). The glass is a
 * tilted panel over the Details mesh's emissive face — centre (0, 57.4,
 * −17.15), facing +Z and tilted back 32.6° — with the glass itself 0.55
 * units out. The plane sits 0.25 units out, between the two, and bulges
 * 0.2 more at its centre. Measured from the .glb's vertices; re-derive it
 * if the desk model is ever replaced.
 */
export const RETRO_COMPUTER_SCREEN = Object.freeze({
  position: [0, 57.53, -16.94],
  tilt: -0.569,
  size: [21, 11.4],
  bulge: 0.2,
});

/**
 * The plane the CRT is drawn on, placed for `model:retro-computer`. Add it
 * under the desk's object3d.
 * @param {THREE.Material} material  From createCrtMaterial({ bulge: RETRO_COMPUTER_SCREEN.bulge }).
 */
export function createCrtScreenMesh(material) {
  const [w, h] = RETRO_COMPUTER_SCREEN.size;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 12, 8), material);
  mesh.name = 'CrtScreen';
  mesh.position.fromArray(RETRO_COMPUTER_SCREEN.position);
  mesh.rotation.x = RETRO_COMPUTER_SCREEN.tilt;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

export class CrtScreen extends Component {
  /**
   * @param {object} opts
   * @param {THREE.ShaderMaterial} opts.material  From createCrtMaterial().
   * @param {{scanProgress: number, scanTarget: {scanTime: number}|null, isScanning: boolean}|null} [opts.satellite]
   * @param {{on: boolean, level: number}|null} [opts.power]
   * @param {(() => boolean)|null} [opts.disturbed]
   */
  constructor({ material, satellite = null, power = null, disturbed = null }) {
    super();
    this.material = material;
    this.uniforms = material.uniforms;
    this.satellite = satellite;
    this.power = power;
    this.disturbed = disturbed;
  }

  onUpdate(dt) {
    const u = this.uniforms;
    u.uTime.value = (u.uTime.value + dt) % TIME_WRAP;
    u.uSignal.value = this._signal();
    u.uPower.value = this._power();
    const target = this._noiseTarget();
    u.uNoise.value += (target - u.uNoise.value) * Math.min(1, dt * CRT_NOISE.ease);
  }

  _signal() {
    const target = this.satellite?.scanTarget;
    if (!target) return 0;
    return Math.min(1, Math.max(0, this.satellite.scanProgress / target.scanTime));
  }

  /** The lights' level, rescaled so the emergency glow is 0: the tube runs
   *  off the generator, not the battery. */
  _power() {
    if (!this.power) return 1;
    const v = (this.power.level - EMERGENCY_LEVEL) / (1 - EMERGENCY_LEVEL);
    return Math.min(1, Math.max(0, v));
  }

  _noiseTarget() {
    if ((this.power && !this.power.on) || this.disturbed?.()) return CRT_NOISE.disturbed;
    return this.satellite?.isScanning ? CRT_NOISE.scanning : CRT_NOISE.idle;
  }
}
