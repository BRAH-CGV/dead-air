import * as THREE from 'three';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// CoffeeSound  –  the coffee machine at work
// ─────────────────────────────────────────────
// Rides on the CoffeeMachine and follows its state. As a brew starts, a
// very soft click (the machine switched on: the camera flash's switch,
// quiet and pitched up, a small button) and the machine running, a
// recording exactly as long as a brew (COFFEE.brewSeconds), so it ends as
// the cup is ready.
//
// Brewed on time, it is left to run out. Brewed early (a nap's 15× races
// the brew, but not the audio) or stopped (a new night resets the machine),
// the rest of it fades out over `fadeOut` rather than stopping dead.
// Paused, it pauses with the game (the audio clock runs on) and carries on
// where it was.
//
// Placed in the world, on the machine, like the signal lamp's beep: an
// appliance heard from where it stands.
// ─────────────────────────────────────────────

/** Tuning. Metres and seconds. */
export const COFFEE_SOUND = {
  keys: { brew: 'sfx:coffee-machine', click: 'sfx:camera-spotlight' },
  /** The recording's length; a test keeps it equal to COFFEE.brewSeconds. */
  brewSeconds: 20,
  /** Of the brew clip's own level (a quiet recording). */
  volume: 1.4,
  /** The click: barely there, and pitched up to a small button. */
  click: { volume: 0.12, detune: 400 },
  /** Full volume within this of the machine; inverse falloff beyond. */
  refDistance: 1.5,
  rolloff: 1,
  /** Left over this much of the clip when the brew ends, the rest fades. */
  tail: 0.5,
  fadeOut: 0.4,
};

export class CoffeeSound extends Component {
  /**
   * @param {object} [opts]
   * @param {{ state: string }} [opts.machine]  Left out, the GameObject
   *        this rides on's CoffeeMachine (or the GameObject itself).
   * @param {THREE.Audio|null} [opts.brew]  Built from the manifest when
   *        left out. Null: silent.
   * @param {THREE.Audio|null} [opts.click]
   */
  constructor({ machine = null, brew, click } = {}) {
    super();
    this.machine = machine;
    this.brew = brew;
    this.click = click;
    this._was = null;
    this._played = 0;
    this._fading = false;
    this._pausedMidBrew = false;
    this._level = 0;
  }

  onStart() {
    this.machine ??= this.gameObject;
    this._was = this.machine?.state ?? null;
    const engine = this.gameObject?.scene?.userData?.engine;
    this._engine = engine;
    if (this.brew === undefined) this.brew = this._build(COFFEE_SOUND.keys.brew);
    if (this.click === undefined) this.click = this._build(COFFEE_SOUND.keys.click);
    this._offPause ??= engine?.onPauseChange?.(paused => this._onPause(paused)) ?? null;
  }

  onUpdate(dt) {
    const state = this.machine?.state;
    const real = this._engine?.realDt ?? dt;
    if (state === 'brewing' && this._was !== 'brewing') this._start();
    else if (state !== 'brewing' && this._was === 'brewing') this._end();
    this._was = state;
    const brew = this.brew;
    if (!brew?.isPlaying) return;
    this._played += real;
    if (!this._fading) return;
    this._level -= COFFEE_SOUND.volume * real / COFFEE_SOUND.fadeOut;
    if (this._level > 0) brew.setVolume(this._level);
    else {
      brew.stop();
      this._fading = false;
    }
  }

  onDestroy() {
    this._offPause?.();
    for (const sound of [this.brew, this.click]) {
      if (!sound) continue;
      if (sound.isPlaying) sound.stop();
      try { sound.disconnect?.(); } catch (_) { /* never connected */ }
      sound.removeFromParent?.();
    }
  }

  // ── Internals ─────────────────────────────

  _start() {
    const { click, brew } = this;
    if (click) {
      if (click.isPlaying) click.stop();
      click.setVolume(COFFEE_SOUND.click.volume);
      click.setDetune(COFFEE_SOUND.click.detune);
      click.play();
    }
    if (brew) {
      if (brew.isPlaying) brew.stop();
      brew.setVolume(COFFEE_SOUND.volume);
      brew.play();
    }
    this._level = COFFEE_SOUND.volume;
    this._played = 0;
    this._fading = false;
  }

  /** The brew is over: on time, the clip runs out; early, it fades. */
  _end() {
    if (!this.brew?.isPlaying) return;
    const left = COFFEE_SOUND.brewSeconds - this._played;
    if (this.machine?.state !== 'brewed' || left > COFFEE_SOUND.tail) this._fading = true;
  }

  _onPause(paused) {
    const brew = this.brew;
    if (!brew) return;
    if (paused) {
      this._pausedMidBrew = brew.isPlaying;
      if (brew.isPlaying) brew.pause();
    } else if (this._pausedMidBrew) {
      this._pausedMidBrew = false;
      brew.play();
    }
  }

  /** A clip from its preloaded buffer, as a point source on the machine.
   *  Null without audio. */
  _build(key) {
    const engine = this.gameObject?.scene?.userData?.engine;
    if (!engine?.audioListener || !engine.assets?.has?.(key)) return null;
    const audio = new THREE.PositionalAudio(engine.audioListener);
    audio.setBuffer(engine.assets.get(key));
    audio.setRefDistance(COFFEE_SOUND.refDistance);
    audio.setRolloffFactor(COFFEE_SOUND.rolloff);
    this.gameObject.object3d.add(audio);
    return audio;
  }
}
