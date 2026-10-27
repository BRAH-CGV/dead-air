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
//
// Mashed into a ball of cheese (GlobeSpin.cheese, #169), it pops once
// (sfx:pop, Mixkit's "Hard pop click" with its leading click cut off), from
// a voice of its own so a spin still sounding isn't cut.
//
// When the cheese goes off (GlobeSpin.blasted), everything else is cut for
// the explosion (sfx:explosion, off Pixabay), played flat rather than from
// the globe, at twice its own level: it fills the room. As the screen
// blacks out (GlobeSpin.blackedOut), the ears ring: the UFO's catch's
// ringing (sfx:ear-ringing), looped at its level, kept through a pause as
// that one is (the Night failed menu pauses), until the night is rebuilt.
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
  /** The pop as it turns to cheese: once, at `volume` of the clip's level. */
  pop: { key: 'sfx:pop', volume: 0.8 },
  /** The cheese going off: once, at `volume` of the clip's level. */
  boom: { key: 'sfx:explosion', volume: 2 },
  /** The black after it: looped, as the UFO's catch plays it (UfoThreat). */
  ringing: { key: 'sfx:ear-ringing', volume: 0.7 },
};

export class GlobeSound extends Component {
  /**
   * @param {object} [opts]
   * @param {{ pushes: number }} [opts.spin]  Left out, the GameObject's GlobeSpin.
   * @param {THREE.Audio[]|null} [opts.voices]  Built from GLOBE_SOUND.key
   *        when left out. Null or empty: silent.
   * @param {THREE.Audio|null} [opts.pop]  Built from GLOBE_SOUND.pop.key
   *        when left out. Null: no pop.
   * @param {THREE.Audio|null} [opts.boom]  Built from GLOBE_SOUND.boom.key
   *        when left out. Null: no boom.
   * @param {THREE.Audio|null} [opts.ringing]  Built from GLOBE_SOUND.ringing.key
   *        when left out. Null: no ringing.
   */
  constructor({ spin = null, voices, pop, boom, ringing } = {}) {
    super();
    this.spin = spin;
    this.voices = voices;
    this.pop = pop;
    this.boom = boom;
    this.ringing = ringing;
    this._cheese = false;
    this._blasted = false;
    this._blackedOut = false;
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
    if (this.pop === undefined) this.pop = this._buildPop(engine);
    if (this.boom === undefined) this.boom = this._buildFlat(engine, GLOBE_SOUND.boom.key);
    if (this.ringing === undefined) this.ringing = this._buildFlat(engine, GLOBE_SOUND.ringing.key);
    this._cheese = !!this.spin?.cheese;
    this._blasted = !!this.spin?.blasted;
    this._blackedOut = !!this.spin?.blackedOut;
    this._offPause ??= engine?.onPauseChange?.(paused => this._onPause(paused)) ?? null;
  }

  onUpdate(dt) {
    this._since += dt;
    if (!this._cheese && this.spin?.cheese) {
      this._cheese = true;
      this._pop();
    }
    if (!this._blasted && this.spin?.blasted) {
      this._blasted = true;
      this._boom();
    }
    if (!this._blackedOut && this.spin?.blackedOut) {
      this._blackedOut = true;
      this._ring();
    }
    const pushes = this.spin?.pushes ?? 0;
    if (pushes === this._pushes) return;
    this._pushes = pushes;
    // The press that set it off is the boom's, not a spin's.
    if (this._blasted) return;
    if (this._since < GLOBE_SOUND.minGap || !this.voices.length) return;
    this._since = 0;
    this._push();
  }

  onDestroy() {
    this._offPause?.();
    for (const v of [...(this.voices ?? []), ...[this.pop, this.boom, this.ringing].filter(Boolean)]) {
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
    if (!paused) return;
    for (const v of this.voices ?? []) if (v.isPlaying) v.stop();
    if (this.pop?.isPlaying) this.pop.stop();
    if (this.boom?.isPlaying) this.boom.stop();
    // The ringing goes on under the Night failed menu, as the UFO's does.
  }

  /** Everything else cut: the boom alone. */
  _boom() {
    for (const v of [...(this.voices ?? []), this.pop]) if (v?.isPlaying) v.stop();
    if (!this.boom) return;
    this.boom.setVolume(GLOBE_SOUND.boom.volume);
    this.boom.play();
  }

  _ring() {
    if (!this.ringing) return;
    this.ringing.setLoop?.(true);
    this.ringing.setVolume(GLOBE_SOUND.ringing.volume);
    if (!this.ringing.isPlaying) this.ringing.play();
  }

  _pop() {
    if (!this.pop) return;
    if (this.pop.isPlaying) this.pop.stop();
    this.pop.setVolume(GLOBE_SOUND.pop.volume);
    this.pop.play();
  }

  /** The pop's voice, a point source on the globe. Null without audio. */
  _buildPop(engine) {
    const { key } = GLOBE_SOUND.pop;
    if (!engine?.audioListener || !engine.assets?.has?.(key)) return null;
    const audio = new THREE.PositionalAudio(engine.audioListener);
    audio.setBuffer(engine.assets.get(key));
    audio.setRefDistance(GLOBE_SOUND.refDistance);
    this.gameObject.object3d.add(audio);
    return audio;
  }

  /** A voice for `key`, flat (not from the globe). Null without audio. */
  _buildFlat(engine, key) {
    if (!engine?.audioListener || !engine.assets?.has?.(key)) return null;
    const audio = new THREE.Audio(engine.audioListener);
    audio.setBuffer(engine.assets.get(key));
    this.gameObject.object3d.add(audio);
    return audio;
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
