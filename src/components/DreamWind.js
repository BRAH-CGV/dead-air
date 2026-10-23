import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { AMBIENCE, loopSeam } from './Ambience.js';
import { fadeAndRelease } from './DreamMusic.js';

// ─────────────────────────────────────────────
// DreamWind  –  the wind rushing past as the dream drags you back
// ─────────────────────────────────────────────
// On the run-away dream (DreamScene), following its DreamWalk. While the
// player walks, nothing. Once the base pulls them back, the wind outside
// the base (AMBIENCE.outside, on the seam Ambience blends) rushes past:
// louder and a touch higher the faster they are dragged, full at
// `fullSpeed`. Awake, it dies away over `fadeOut`; the scene going fades
// what is left on the audio clock. Paused, it pauses with the game.
// ─────────────────────────────────────────────

/** Tuning. */
export const DREAM_WIND = {
  key: AMBIENCE.outside,
  /** Of the clip's own level at full speed (calm, it plays at 0.5 in the
   *  base; a storm takes it to 3.3). */
  volume: 1.6,
  /** m/s of pull at which it is full. */
  fullSpeed: 12,
  /** Playback rate at the start of the pull and at full speed: it rushes. */
  rate: [0.9, 1.15],
  /** Seconds it dies away over once they wake. */
  fadeOut: 0.6,
};

export class DreamWind extends Component {
  /**
   * @param {object} opts
   * @param {{ state: string, pullSpeed: number }} opts.walk  The DreamWalk.
   * @param {THREE.Audio|null} [opts.sound]  Loaded from DREAM_WIND.key when
   *        left out. Null: silent.
   */
  constructor({ walk, sound } = {}) {
    super();
    this.walk = walk;
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
    if (!sound || this._gone || !this.walk) return;
    const real = this._engine?.realDt ?? dt;
    const state = this.walk.state;
    const pace = Math.min(1, (this.walk.pullSpeed ?? 0) / DREAM_WIND.fullSpeed);
    if (state === 'pulled') this._level = pace;
    else if (state === 'awake') this._level = Math.max(0, this._level - real / DREAM_WIND.fadeOut);
    else this._level = 0;
    if (this._level <= 0) {
      if (sound.isPlaying) sound.stop();
      return;
    }
    const [slow, fast] = DREAM_WIND.rate;
    sound.setPlaybackRate(slow + (fast - slow) * pace);
    sound.setVolume(DREAM_WIND.volume * this._level);
    if (!sound.isPlaying && !this._paused) sound.play();
  }

  onDestroy() {
    this._gone = true;
    this._offPause?.();
    fadeAndRelease(this.sound, DREAM_WIND.fadeOut);
  }

  _onPause(paused) {
    const sound = this.sound;
    if (!sound || this._gone) return;
    this._paused = paused;
    if (paused) {
      if (sound.isPlaying) sound.pause();
    } else if (this._level > 0 && !sound.isPlaying) {
      sound.play();
    }
  }

  _load(engine) {
    if (!engine?.audioListener || !engine.assets?.load) return;
    engine.assets.load(DREAM_WIND.key).then((buffer) => {
      if (this._gone) return;
      const sound = new THREE.Audio(engine.audioListener);
      sound.setBuffer(buffer);
      sound.setLoop(true);
      sound.setLoopStart(loopSeam(buffer));
      sound.setVolume(0);
      this.sound = sound;
    }).catch(err => console.warn(`[DreamWind] no ${DREAM_WIND.key} — ${err.message}`));
  }
}
