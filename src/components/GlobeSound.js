import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { GlobeSpin } from './GlobeSpin.js';

// ─────────────────────────────────────────────
// GlobeSound  –  the desk globe spun on its stand
// ─────────────────────────────────────────────
// Rides on the globe beside its GlobeSpin. The recording (sfx:globe-spin,
// TunaBombs on Freesound) is one real spin: the hand's push, then the
// globe dying away, about two seconds. Every push plays it from its top,
// whole and at its own pitch:
//
//   • pushed again while it still sounds, it flows on: a fresh spin on the
//     next voice from just past the slap (`flowOffset`), swelling up
//     (`swell`), while the last one lingers under it, fading over
//     `release` rather than cut;
//   • mashed, presses closer than `minGap` add no new push sound, so it
//     never stutters (the globe still takes the push).
//
// It follows GlobeSpin's push count, so a press at top speed sounds too.
// A pause silences it. Placed in the world, on the globe.
// ─────────────────────────────────────────────

/** Tuning. */
export const GLOBE_SOUND = {
  key: 'sfx:globe-spin',
  /** Of the clip's own level: a touch under it. */
  volume: 0.7,
  /** A push while it still sounds flows on: the new spin starts at
   *  `flowOffset`, past the hand's slap (a sharp click `slapAt` seconds into
   *  the clip), swelling up over `swell` seconds, while the last one lingers
   *  under it, fading over `release`. */
  slapAt: 0.23,
  flowOffset: 0.26,
  swell: 0.12,
  release: 0.5,
  /** Seconds: presses closer than this add no new push sound. */
  minGap: 0.2,
  /** Voices: a push and the ones fading out under it. */
  voices: 4,
  /** Full volume within this of the globe, metres; inverse falloff beyond. */
  refDistance: 1,
};

export class GlobeSound extends Component {
  /**
   * @param {object} [opts]
   * @param {{ pushes: number }} [opts.spin]  Left out, the GameObject's GlobeSpin.
   * @param {THREE.Audio[]|null} [opts.voices]  Built from GLOBE_SOUND.key
   *        when left out. Null or empty: silent.
   */
  constructor({ spin = null, voices } = {}) {
    super();
    this.spin = spin;
    this.voices = voices;
    this._next = 0;
    this._current = null;
    this._pushes = 0;
    this._since = Infinity;
  }

  onStart() {
    this.spin ??= this.gameObject?.getComponent?.(GlobeSpin) ?? null;
    this._pushes = this.spin?.pushes ?? 0;
    const engine = this.gameObject?.scene?.userData?.engine;
    if (this.voices === undefined) this.voices = this._build(engine);
    this.voices ??= [];
    this._offPause ??= engine?.onPauseChange?.(paused => this._onPause(paused)) ?? null;
  }

  onUpdate(dt) {
    this._since += dt;
    const pushes = this.spin?.pushes ?? 0;
    if (pushes === this._pushes) return;
    this._pushes = pushes;
    if (this._since < GLOBE_SOUND.minGap || !this.voices.length) return;
    this._since = 0;
    this._push();
  }

  onDestroy() {
    this._offPause?.();
    for (const v of this.voices ?? []) {
      if (v.isPlaying) v.stop();
      try { v.disconnect?.(); } catch (_) { /* never connected */ }
      v.removeFromParent?.();
    }
  }

  /** The spin on the next voice: from its top from rest; while one still
   *  sounds, from past the slap, swelling in, the last one let go. */
  _push() {
    const flowing = !!this._current?.isPlaying;
    if (flowing) this._release(this._current);
    const v = this.voices[this._next];
    this._next = (this._next + 1) % this.voices.length;
    if (v.isPlaying) v.stop();
    v.offset = flowing ? GLOBE_SOUND.flowOffset : 0;
    const g = v.gain?.gain;
    const t = v.context?.currentTime;
    if (g?.linearRampToValueAtTime && t !== undefined) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(flowing ? 0 : GLOBE_SOUND.volume, t);
      if (flowing) g.linearRampToValueAtTime(GLOBE_SOUND.volume, t + GLOBE_SOUND.swell);
    } else {
      v.setVolume(GLOBE_SOUND.volume);
    }
    v.play();
    this._current = v;
  }

  /** Faded out over `release` on the audio clock, then stopped; without a
   *  gain node (a test's voice), just stopped. */
  _release(v) {
    const g = v.gain?.gain;
    const t = v.context?.currentTime;
    if (!g?.linearRampToValueAtTime || t === undefined) return v.stop();
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + GLOBE_SOUND.release);
    v.stop(GLOBE_SOUND.release);
  }

  _onPause(paused) {
    if (paused) for (const v of this.voices ?? []) if (v.isPlaying) v.stop();
  }

  /** The voices on the preloaded buffer, as point sources on the globe.
   *  Null without audio. */
  _build(engine) {
    if (!engine?.audioListener || !engine.assets?.has?.(GLOBE_SOUND.key)) return null;
    const buffer = engine.assets.get(GLOBE_SOUND.key);
    return Array.from({ length: GLOBE_SOUND.voices }, () => {
      const audio = new THREE.PositionalAudio(engine.audioListener);
      audio.setBuffer(buffer);
      audio.setRefDistance(GLOBE_SOUND.refDistance);
      this.gameObject.object3d.add(audio);
      return audio;
    });
  }
}
