import * as THREE from 'three';
import { loopable } from './GeneratorSound.js';

// ─────────────────────────────────────────────
// LoopVoice  –  one looping clip whose level someone else decides
// ─────────────────────────────────────────────
// For a sound that is a state, not an event, like the evil drive's hum:
//
//   const voice = new LoopVoice({ key: 'sfx:evil-hum' });
//   voice.set(0.3, dt, gameObject);   // each frame it is wanted
//   voice.set(0, dt);                 // each frame it isn't
//
// `level` is the volume (0..1, of the clip's own). The voice eases toward it
// (`rate`), so a hum comes up and goes away instead of switching, and at
// zero the loop is stopped and starts from its top next time.
//
// Not placed in the world: it is all around you. The loop is made seamless
// at load (loopable). A pause calls pause() on the sound and resumes it
// after, since the audio clock runs on while the game doesn't.
// ─────────────────────────────────────────────

/** Rate (per second) the level eases at, and the level that counts as
 *  having arrived. */
const RATE = 3;
const SETTLED = 2e-3;

export class LoopVoice {
  /**
   * @param {object} [opts]
   * @param {string} [opts.key]  Manifest key of the clip.
   * @param {THREE.Audio|null} [opts.sound]  Built from `key` when left out.
   *        Null: silent.
   */
  constructor({ key = null, sound } = {}) {
    this.key = key;
    this.sound = sound;
    this._level = 0;
    this._paused = false;
    this._offPause = null;
    this._hooked = false;
  }

  /**
   * Ease toward `level`.
   * @param {number} level  0..1
   * @param {number} dt
   * @param {import('../core/GameObject.js').GameObject} [gameObject]  What
   *        the engine is reached through; needed the first time level > 0.
   * @returns {boolean} whether there is a sound to ease.
   */
  set(level, dt, gameObject = null) {
    if (level <= 0 && this._level <= 0) return !!this.sound;
    const sound = this._ready(gameObject);
    if (!sound) return false;

    const target = Math.max(level, 0);
    let next = this._level + (target - this._level) * (1 - Math.exp(-RATE * dt));
    if (Math.abs(target - next) < SETTLED) next = target;
    this._level = next;

    if (next > 0) {
      sound.setVolume(next);
      if (!sound.isPlaying && !this._paused) sound.play();
    } else if (sound.isPlaying) {
      sound.stop();
    }
    return true;
  }

  /** Stop at once and let go. */
  dispose() {
    this._offPause?.();
    this._offPause = null;
    const sound = this.sound;
    this._level = 0;
    if (!sound) return;
    if (sound.isPlaying) sound.stop();
    try { sound.disconnect?.(); } catch (_) { /* never connected */ }
  }

  // ── Internals ─────────────────────────────

  /** The sound, built the first time it is wanted. Null when there can't be
   *  one (yet); asked before the scene has an engine, nothing is given up on. */
  _ready(gameObject) {
    const engine = gameObject?.scene?.userData?.engine;
    if (!this._hooked && engine) {
      this._hooked = true;
      this._offPause = engine.onPauseChange?.(paused => this._onPause(paused)) ?? null;
    }
    if (this.sound !== undefined) return this.sound;
    if (!engine) return null;
    const { audioListener, assets } = engine;
    if (!audioListener || !assets?.has?.(this.key)) return (this.sound = null);
    const audio = new THREE.Audio(audioListener);
    audio.setBuffer(loopable(assets.get(this.key), audioListener.context));
    audio.setLoop(true);
    audio.setVolume(0);
    return (this.sound = audio);
  }

  _onPause(paused) {
    this._paused = paused;
    const sound = this.sound;
    if (!sound) return;
    if (paused) {
      if (sound.isPlaying) sound.pause();
    } else if (this._level > 0 && !sound.isPlaying) {
      sound.play();
    }
  }
}
