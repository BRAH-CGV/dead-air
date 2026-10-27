import * as THREE from 'three';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// ProcessorSound  –  the bean processor at work (#168)
// ─────────────────────────────────────────────
// Rides on the bean processor and follows the night's CoffeeHarvest: each
// time a pile starts processing (its processLeft jumps back up) the grind
// plays from the top, a recording exactly a pile long (processSeconds), so
// it ends as the pile is done. A second pile in the hopper starts it over.
//
// Cut short with more than `tail` of the clip still to play (a new night
// empties the hopper; a nap's fast-forward races the pile, not the audio),
// the rest fades out over `fadeOut` rather than stopping dead. Paused, it
// pauses with the game (the audio clock runs on) and carries on where it
// was. Placed in the world, on the machine, like the coffee machine's.
// ─────────────────────────────────────────────

/** Tuning. Metres and seconds. */
export const PROCESSOR_SOUND = {
  key: 'sfx:coffee-grinding',
  /** The recording's length; a test keeps it equal to processSeconds. */
  seconds: 5,
  /** Of the clip's own level. */
  volume: 0.8,
  /** Full volume within this of the machine; inverse falloff beyond. */
  refDistance: 1.5,
  rolloff: 1,
  /** Left over this much of the clip when processing stops, the rest fades. */
  tail: 0.3,
  fadeOut: 0.3,
};

export class ProcessorSound extends Component {
  /**
   * @param {object} [opts]
   * @param {{ processLeft: number, processor: string }|null} [opts.harvest]
   * @param {THREE.Audio|null} [opts.grind]  Built from the manifest when
   *        left out. Null: silent.
   */
  constructor({ harvest = null, grind } = {}) {
    super();
    this.harvest = harvest;
    this.grind = grind;
    this._left = 0;
    this._played = 0;
    this._level = 0;
    this._fading = false;
    this._pausedMidGrind = false;
  }

  onStart() {
    const engine = this.gameObject?.scene?.userData?.engine;
    this._engine = engine;
    if (this.grind === undefined) this.grind = this._build();
    this._offPause ??= engine?.onPauseChange?.(paused => this._onPause(paused)) ?? null;
    this._left = this.harvest?.processLeft ?? 0;
  }

  onUpdate(dt) {
    const h = this.harvest;
    if (!h) return;
    const real = this._engine?.realDt ?? dt;
    const left = h.processLeft;
    if (left > this._left + 1e-6) this._start();
    else if (h.processor !== 'processing' && this._left > 0) this._end();
    this._left = left;

    const grind = this.grind;
    if (!grind?.isPlaying) return;
    this._played += real;
    if (!this._fading) return;
    this._level -= PROCESSOR_SOUND.volume * real / PROCESSOR_SOUND.fadeOut;
    if (this._level > 0) grind.setVolume(this._level);
    else {
      grind.stop();
      this._fading = false;
    }
  }

  onDestroy() {
    this._offPause?.();
    this._offPause = null;
    const grind = this.grind;
    if (!grind) return;
    if (grind.isPlaying) grind.stop();
    try { grind.disconnect?.(); } catch (_) { /* never connected */ }
    grind.removeFromParent?.();
  }

  // ── Internals ─────────────────────────────

  _start() {
    const grind = this.grind;
    if (!grind) return;
    if (grind.isPlaying) grind.stop();
    grind.setVolume(PROCESSOR_SOUND.volume);
    grind.play();
    this._level = PROCESSOR_SOUND.volume;
    this._played = 0;
    this._fading = false;
  }

  /** Processing stopped: on time, the clip runs out; early, it fades. */
  _end() {
    if (!this.grind?.isPlaying) return;
    if (PROCESSOR_SOUND.seconds - this._played > PROCESSOR_SOUND.tail) this._fading = true;
  }

  _onPause(paused) {
    const grind = this.grind;
    if (!grind) return;
    if (paused) {
      this._pausedMidGrind = grind.isPlaying;
      if (grind.isPlaying) grind.pause();
    } else if (this._pausedMidGrind) {
      this._pausedMidGrind = false;
      grind.play();
    }
  }

  /** The clip from its preloaded buffer, as a point source on the machine.
   *  Null without audio. */
  _build() {
    const engine = this.gameObject?.scene?.userData?.engine;
    if (!engine?.audioListener || !engine.assets?.has?.(PROCESSOR_SOUND.key)) return null;
    const audio = new THREE.PositionalAudio(engine.audioListener);
    audio.setBuffer(engine.assets.get(PROCESSOR_SOUND.key));
    audio.setRefDistance(PROCESSOR_SOUND.refDistance);
    audio.setRolloffFactor(PROCESSOR_SOUND.rolloff);
    this.gameObject.object3d.add(audio);
    return audio;
  }
}
