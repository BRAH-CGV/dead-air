import { Component } from '../core/Component.js';
import { FatigueLogic, tunnel, heartbeat } from '../gameplay/Fatigue.js';

// ─────────────────────────────────────────────
// FatigueEffects  –  plays out what low stamina does to the player
// ─────────────────────────────────────────────
// On GameplaySystems, after StaminaDrain (so it reads this frame's stamina)
// and after the AudioSystem. Each frame, from FatigueLogic and the pure
// curves in Fatigue.js:
//
//   - the overlay: the tunnel narrowing the view, and the eyelids;
//   - BaseLights' 'dread' factor: the lights stutter when critical;
//   - a heartbeat riding the listener, louder and faster towards empty;
//   - a yawn, now and then, once tired.
//
// It polls the controller the way StaminaDrain does. A night starting
// resets the logic's timers; outside 'playing' everything settles — eyes
// open, lights steady, the heart quiet. The fly camera sees the scene clear.
// ─────────────────────────────────────────────

const YAWN_VOLUME = 0.7;
const HEARTBEAT_VOLUME = 0.9;
/** How much faster the heart beats at empty than when it is first heard. */
const HEARTBEAT_QUICKEN = 0.35;

export class FatigueEffects extends Component {
  /**
   * @param {object} opts
   * @param {import('../gameplay/Stamina.js').Stamina} opts.stamina
   * @param {{state: string, nightNumber: number}} opts.controller
   * @param {{set(tunnel: number, eyelid: number): void, clear?(): void}|null} [opts.overlay]  FatigueOverlay
   * @param {import('../audio/AudioSystem.js').AudioSystem|null} [opts.audio]
   * @param {{setFactor(key: string, value: number): void}|null} [opts.lights]  BaseLights
   * @param {import('three').Object3D|null} [opts.listener]  what the heartbeat rides: the camera
   * @param {{debugCamera?: {active: boolean}}|null} [opts.engine]
   * @param {() => number} [opts.rand]
   */
  constructor({ stamina, controller, overlay = null, audio = null, lights = null,
                listener = null, engine = null, rand = Math.random }) {
    super();
    this.stamina = stamina;
    this.controller = controller;
    this.overlay = overlay;
    this.audio = audio;
    this.lights = lights;
    this.engine = engine;
    this.logic = new FatigueLogic({ rand, onYawn: () => this._yawn() });
    this._heart = audio && listener
      ? audio.positional('amb:heartbeat', listener, { volume: HEARTBEAT_VOLUME, refDistance: 1 })
      : null;
    this._lastState = null;
    this._lastNight = 0;
  }

  onUpdate(dt) {
    const { state, nightNumber } = this.controller;
    const playing = state === 'playing';
    const v = this.stamina.value;
    if (!playing || this._lastState !== 'playing' || this._lastNight !== nightNumber) {
      this.logic.reset();
    }
    if (playing) this.logic.update(dt, v);
    this._lastState = state;
    this._lastNight = nightNumber;

    if (this.engine?.debugCamera?.active) this.overlay?.set(0, 0);
    else this.overlay?.set(playing ? tunnel(v) : 0, this.logic.eyelid);
    this.lights?.setFactor('dread', this.logic.dread);
    if (this._heart) {
      const level = playing ? heartbeat(v) : 0;
      this._heart.setLevel(level);
      this._heart.setRate(1 + HEARTBEAT_QUICKEN * level);
    }
  }

  onDestroy() {
    this.overlay?.clear?.();
    this._heart?.setLevel(0);
  }

  // ── Private ──

  _yawn() {
    this.audio?.play('sfx:yawn', { volume: YAWN_VOLUME });
  }
}
