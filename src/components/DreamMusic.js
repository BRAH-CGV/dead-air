import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { AMBIENCE, loopSeam } from './Ambience.js';

// ─────────────────────────────────────────────
// DreamMusic  –  the spooky music under a dream
// ─────────────────────────────────────────────
// Both dreams (DreamScene, DreamCraterScene) put one on their root: the
// base's tension music (AMBIENCE.music), looped from the seam Ambience
// blends into the shared buffer (loopSeam), creeping in over `fadeIn` as the
// dream starts. Paused, it pauses with the game. As the dream goes it fades
// over `fadeOut` on the audio clock rather than stopping dead, under the
// black the wake holds.
//
// Loaded on demand like the Ambience's tracks: the dream starts silent and
// the music creeps in once its buffer is there.
// ─────────────────────────────────────────────

/** Tuning. */
export const DREAM_MUSIC = {
  key: AMBIENCE.music,
  /** Of the track's own level (its file level is its ceiling). */
  volume: 0.8,
  /** Seconds to creep in, and to fade as the dream ends. */
  fadeIn: 3,
  fadeOut: 1.5,
};

/**
 * A sound let go of as its scene goes: faded out over `seconds` on the audio
 * clock (nothing updates once the scene is gone), stopped, then unhooked
 * from the listener. Without a gain node (a test's voice), just stopped.
 * @param {THREE.Audio|null} sound
 * @param {number} seconds
 */
export function fadeAndRelease(sound, seconds) {
  if (!sound) return;
  const g = sound.gain?.gain;
  const t = sound.context?.currentTime;
  if (sound.isPlaying && g?.linearRampToValueAtTime && t !== undefined) {
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + seconds);
    sound.stop(seconds);
    setTimeout(() => { try { sound.disconnect(); } catch (_) { /* gone */ } }, seconds * 1000 + 100);
    return;
  }
  if (sound.isPlaying) sound.stop();
  try { sound.disconnect?.(); } catch (_) { /* never connected */ }
}

export class DreamMusic extends Component {
  /**
   * @param {object} [opts]
   * @param {THREE.Audio|null} [opts.sound]  Loaded from DREAM_MUSIC.key
   *        when left out. Null: silent.
   */
  constructor({ sound } = {}) {
    super();
    this.sound = sound;
    this._level = 0;
    this._paused = false;
    this._gone = false;
  }

  onStart() {
    const engine = this.gameObject?.scene?.userData?.engine;
    this._engine = engine;
    if (this.sound === undefined) {
      this.sound = null;
      this._load(engine);
    }
    this._offPause ??= engine?.onPauseChange?.(paused => this._onPause(paused)) ?? null;
  }

  onUpdate(dt) {
    const sound = this.sound;
    if (!sound || this._gone) return;
    const real = this._engine?.realDt ?? dt;
    this._level = Math.min(1, this._level + real / DREAM_MUSIC.fadeIn);
    sound.setVolume(DREAM_MUSIC.volume * this._level);
    if (!sound.isPlaying && !this._paused) sound.play();
  }

  onDestroy() {
    this._gone = true;
    this._offPause?.();
    fadeAndRelease(this.sound, DREAM_MUSIC.fadeOut);
  }

  _onPause(paused) {
    const sound = this.sound;
    if (!sound || this._gone) return;
    this._paused = paused;
    if (paused) {
      if (sound.isPlaying) sound.pause();
    } else if (!sound.isPlaying) {
      sound.play();
    }
  }

  _load(engine) {
    if (!engine?.audioListener || !engine.assets?.load) return;
    engine.assets.load(DREAM_MUSIC.key).then((buffer) => {
      if (this._gone) return;
      const sound = new THREE.Audio(engine.audioListener);
      sound.setBuffer(buffer);
      sound.setLoop(true);
      sound.setLoopStart(loopSeam(buffer));
      sound.setVolume(0);
      this.sound = sound;
    }).catch(err => console.warn(`[DreamMusic] no ${DREAM_MUSIC.key} — ${err.message}`));
  }
}
