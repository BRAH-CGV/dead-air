import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { FatigueLogic, tunnel, heartbeat } from '../gameplay/Fatigue.js';

// ─────────────────────────────────────────────
// FatigueEffects  –  plays out what low stamina does to the player
// ─────────────────────────────────────────────
// On GameplaySystems, after StaminaDrain (so it reads this frame's
// stamina). Each frame, from FatigueLogic and the pure curves in
// Fatigue.js:
//
//   - the overlay: the tunnel narrowing the view, and the eyelids;
//   - the PowerGrid's 'dread' factor: the lights stutter when critical;
//   - a heartbeat in the player's head, louder and faster towards empty;
//   - a yawn, now and then, once tired.
//
// Every night that starts resets the logic's timers; outside 'playing'
// everything settles — eyes open, lights steady, the heart quiet. The fly
// camera sees the scene clear.
// ─────────────────────────────────────────────

/** Manifest key behind each sound. */
export const FATIGUE_SOUNDS = { heartbeat: 'sfx:heartbeat', yawn: 'sfx:yawn' };

const YAWN_VOLUME = 0.7;
const HEARTBEAT_VOLUME = 0.9;
/** How much faster the heart beats at empty than when it is first heard. */
const HEARTBEAT_QUICKEN = 0.35;

export class FatigueEffects extends Component {
  /**
   * @param {object} opts
   * @param {import('../gameplay/Stamina.js').Stamina} opts.stamina
   * @param {import('../gameplay/GameController.js').GameController} opts.controller
   * @param {{set(tunnel: number, eyelid: number): void, clear?(): void}|null} [opts.overlay]  FatigueOverlay
   * @param {{setFactor(key: string, value: number): void}|null} [opts.grid]  PowerGrid
   * @param {() => boolean} [opts.isFrozen]  The debug fly camera is on.
   * @param {Record<string, THREE.Audio>} [opts.sounds]  Built from FATIGUE_SOUNDS when left out.
   * @param {() => number} [opts.rand]
   */
  constructor({ stamina, controller, overlay = null, grid = null, isFrozen = () => false, sounds = null, rand = Math.random }) {
    super();
    Object.assign(this, { stamina, controller, overlay, grid, isFrozen, sounds });
    this.logic = new FatigueLogic({ rand, onYawn: () => this._yawn() });
    this._heart = 0;     // the heartbeat's level as last written, in hundredths
    this._off = null;
  }

  onStart() {
    if (!this.sounds) this.sounds = this._buildSounds();
    this._off = this.controller.onNightStart?.(() => this.logic.reset()) ?? null;
  }

  onDestroy() {
    this._off?.();
    this._off = null;
    this.overlay?.clear?.();
    for (const sound of Object.values(this.sounds ?? {})) {
      if (sound?.isPlaying) sound.stop();
      try { sound?.disconnect?.(); } catch (_) { /* never connected */ }
    }
  }

  onUpdate(dt) {
    const playing = this.controller.state === 'playing';
    const v = this.stamina.value;
    if (playing) this.logic.update(dt, v);
    else this.logic.reset();

    if (this.isFrozen()) this.overlay?.set(0, 0);
    else this.overlay?.set(playing ? tunnel(v) : 0, this.logic.eyelid);
    this.grid?.setFactor('dread', this.logic.dread);
    this._beat(playing ? heartbeat(v) : 0);
  }

  // ── Private ──

  /** The heartbeat at `level` (0 … 1), written only when its hundredths
   *  change: silent and stopped at 0. */
  _beat(level) {
    const step = Math.round(level * 100);
    if (step === this._heart) return;
    this._heart = step;
    const heart = this.sounds?.heartbeat;
    if (!heart) return;
    const l = step / 100;
    heart.setVolume(l * HEARTBEAT_VOLUME);
    heart.setPlaybackRate(1 + HEARTBEAT_QUICKEN * l);
    if (l > 0) {
      if (!heart.isPlaying) heart.play();
    } else if (heart.isPlaying) {
      heart.stop();
    }
  }

  _yawn() {
    const yawn = this.sounds?.yawn;
    if (!yawn) return;
    if (yawn.isPlaying) yawn.stop();
    yawn.setVolume(YAWN_VOLUME);
    yawn.play();
  }

  /** One THREE.Audio per clip from the preloaded buffers, the heartbeat
   *  looping. Missing ones are left out — silence, not a crash. */
  _buildSounds() {
    const engine = this.gameObject?.scene?.userData?.engine;
    const sounds = {};
    if (!engine?.audioListener || !engine.assets) return sounds;
    for (const [name, key] of Object.entries(FATIGUE_SOUNDS)) {
      if (engine.assets.has && !engine.assets.has(key)) continue;
      const buffer = engine.assets.get(key);
      if (!buffer) continue;
      const audio = new THREE.Audio(engine.audioListener);
      audio.setBuffer(buffer);
      if (name === 'heartbeat') audio.setLoop(true);
      sounds[name] = audio;
    }
    return sounds;
  }
}
