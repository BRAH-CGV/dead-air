import { Component } from '../core/Component.js';
import { dreamLevel, walkScale, unease } from '../gameplay/dream.js';

// ─────────────────────────────────────────────
// DreamWalk  –  the base won't let you leave (#101)
// ─────────────────────────────────────────────
// Runs the dream's rules (gameplay/dream.js) each frame:
//
//   walking  the player's speedScale falls with distance from the base;
//            the fog thickens and the sky turns rust (MarsSky.setStorm);
//            at level 3 the view starts to breathe (the camera's FOV)
//   pulled   past the pull radius the controls go (inputLocked) and the
//            player is dragged backwards to the base, faster and faster,
//            still looking out at what they were walking towards
//   awake    back at the base: the screen fades and onWake runs, once
//
// Everything it touched is handed back in onDestroy, so a scene swap
// mid-dream leaves no slowed player or warped camera behind.
// ─────────────────────────────────────────────

/** Metres from the base where the pull lets go and the player wakes. */
const WAKE_RADIUS = 7;

export class DreamWalk extends Component {
  /** 'walking' | 'pulled' | 'awake' */
  state = 'walking';

  /**
   * @param {object} opts
   * @param {number} [opts.level=1]
   * @param {{x: number, z: number}} [opts.base]  The base's centre
   * @param {object} opts.controller  The FirstPersonController (speedScale, inputLocked, yaw, pitch, teleport)
   * @param {THREE.PerspectiveCamera} [opts.camera]
   * @param {{ setStorm: (k: number) => void }} [opts.sky]
   * @param {{ density: number }} [opts.fog]
   * @param {{ play: (cb: () => void) => boolean }} [opts.fade]
   * @param {() => void} [opts.onWake]
   */
  constructor({ level = 1, base = { x: 0, z: 0 }, controller, camera = null, sky = null, fog = null, fade = null, onWake = null }) {
    super();
    this.level = level;
    this.rules = dreamLevel(level);
    this.base = base;
    this.controller = controller;
    this.camera = camera;
    this.sky = sky;
    this.fog = fog;
    this.fade = fade;
    this.onWake = onWake;
    this._baseFov = camera?.fov ?? null;
    this._pullSpeed = 0;
    this._time = 0;
  }

  onUpdate(dt) {
    if (this.state === 'awake' || !this.controller) return;
    this._time += dt;
    const L = this.rules;
    const pos = this.controller.gameObject?.object3d?.position;
    if (!pos) return;
    const dx = pos.x - this.base.x;
    const dz = pos.z - this.base.z;
    const distance = Math.hypot(dx, dz);
    const k = this.state === 'pulled' ? 1 : unease(distance, L);

    if (this.fog) this.fog.density = L.fogBase + (L.fogMax - L.fogBase) * k;
    this.sky?.setStorm?.(L.skyBase + (L.skyMax - L.skyBase) * k);
    this._breathe(k);

    if (this.state === 'walking') {
      this.controller.speedScale = walkScale(distance, L);
      if (distance >= L.pullRadius) {
        this.state = 'pulled';
        this.controller.inputLocked = true;
      }
      return;
    }

    // Pulled: dragged straight back, faster the longer it lasts.
    this._pullSpeed += L.drag * dt;
    const step = Math.min(this._pullSpeed * dt, Math.max(0, distance - WAKE_RADIUS));
    const nx = pos.x - (dx / distance) * step;
    const nz = pos.z - (dz / distance) * step;
    this.controller.teleport([nx, pos.y, nz], { yaw: this.controller.yaw, pitch: this.controller.pitch });
    if (distance - step <= WAKE_RADIUS + 1e-6) this.wake();
  }

  /** Back at the base: fade, then onWake — once. */
  wake() {
    if (this.state === 'awake') return;
    this.state = 'awake';
    const done = () => this.onWake?.();
    if (!this.fade?.play?.(done)) done();
  }

  onDestroy() {
    if (this.controller) {
      this.controller.speedScale = 1;
      this.controller.inputLocked = false;
    }
    if (this.camera && this._baseFov !== null && this.camera.fov !== this._baseFov) {
      this.camera.fov = this._baseFov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** At level 3 the view breathes in and out, more the further out. */
  _breathe(k) {
    const amp = this.rules.fovWobble * k;
    if (!this.camera || this._baseFov === null || amp === 0) return;
    this.camera.fov = this._baseFov + amp * Math.sin(this._time * 1.7);
    this.camera.updateProjectionMatrix();
  }
}
