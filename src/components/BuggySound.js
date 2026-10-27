import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { BUGGY_DEPARTURE } from '../gameplay/BuggyDeparture.js';
import { synthRoverHum } from '../gameplay/RoverHum.js';
import { loopable } from './GeneratorSound.js';

// ─────────────────────────────────────────────
// BuggySound  –  the buggy driving off
// ─────────────────────────────────────────────
// Follows the send-off (BuggySendOff): the rover's hum (RoverHum, made at
// load), looped. It wakes as the boot's lid shuts, a soft idle; driving
// off it swells and its whine climbs with the speed — the playback rate
// follows it, as an electric motor's pitch does. It fades out with the
// screen (the logic's `wantsFade`) and stops once the buggy has gone.
// Beside it, faint, the sand under the tyres: the office window's sand
// (sfx:window-sand) slowed down and muffled — a band round the crunch, no
// hiss — so it is grit under wheels rather than on glass. Nothing standing,
// more the faster it goes.
// Paused, it pauses with the game.
//
// Not placed in the world: the eagle view follows the buggy, but the ears
// stay on the player, who stands back at the boot.
// ─────────────────────────────────────────────

/** Tuning. */
export const BUGGY_SOUND = {
  /** Its level at top speed. */
  volume: 0.32,
  /** The sand under the tyres: the window's clip, its level at top speed
   *  (none standing), its playback rate slow and fast (slowed, so it is
   *  heavier, coarser grit; quickening with the speed), and the filters
   *  that make it tyres on dust: a high-pass clear of the hum, a low-pass
   *  taking the hiss off, and a lift round the crunch. */
  sandKey: 'sfx:window-sand',
  sand: 0.22,
  sandRate: [0.55, 0.8],
  sandFilter: { highpass: 150, lowpass: 1100, crunch: 450, crunchGain: 4 },
  /** Its share of that idling, before it moves (and as the lid shuts). */
  idle: 0.4,
  /** Playback rate idling and at top speed: the whine's climb. */
  rate: [0.85, 1.25],
  /** Per second: how fast the level follows, rising and fading. */
  rise: 2.5,
  fade: 4,
};

const ease = (rate, dt) => 1 - Math.exp(-rate * dt);

export class BuggySound extends Component {
  /**
   * @param {object} opts
   * @param {{ active: boolean, logic: { phase: string, speed: number, wantsFade: boolean } }} opts.sendOff
   * @param {THREE.Audio|null} [opts.sound]  Built from the synthesised hum
   *        when left out. Null: silent.
   * @param {THREE.Audio|null} [opts.sand]  Built from the window's sand
   *        when left out, filtered. Null: silent.
   */
  constructor({ sendOff, sound, sand } = {}) {
    super();
    this.sendOff = sendOff;
    this.sound = sound;
    this.sand = sand;
    this._grit = 0;
    this._level = 0;
    this._paused = null;
  }

  onStart() {
    const engine = this.gameObject?.scene?.userData?.engine;
    this._engine = engine;
    if (this.sound === undefined) this.sound = this._buildHum(engine);
    if (this.sand === undefined) this.sand = this._buildSand(engine);
    this._offPause ??= engine?.onPauseChange?.(paused => this._onPause(paused)) ?? null;
  }

  onUpdate(dt) {
    const real = this._engine?.realDt ?? dt;
    const logic = this.sendOff?.logic;
    if (!this.sendOff?.active) {
      // Parked, or gone behind the fade.
      for (const v of this._voices()) if (v.isPlaying) v.stop();
      this._level = 0;
      this._grit = 0;
      return;
    }
    const pace = Math.min(Math.max((logic.speed ?? 0) / BUGGY_DEPARTURE.speed, 0), 1);
    const hum = logic.wantsFade ? 0 : BUGGY_SOUND.idle + (1 - BUGGY_SOUND.idle) * pace;
    const grit = logic.wantsFade ? 0 : pace;
    this._level = this._follow(this._level, hum, real);
    this._grit = this._follow(this._grit, grit, real);
    this._drive(this.sound, hum, BUGGY_SOUND.volume * this._level, BUGGY_SOUND.rate, pace);
    this._drive(this.sand, grit, BUGGY_SOUND.sand * this._grit, BUGGY_SOUND.sandRate, pace);
  }

  _follow(level, target, dt) {
    return level + (target - level) * ease(target < level ? BUGGY_SOUND.fade : BUGGY_SOUND.rise, dt);
  }

  _drive(sound, target, volume, [slow, fast], pace) {
    if (!sound) return;
    if (!sound.isPlaying && target > 0) sound.play();
    sound.setPlaybackRate(slow + (fast - slow) * pace);
    sound.setVolume(volume);
  }

  _voices() {
    return [this.sound, this.sand].filter(Boolean);
  }

  onDestroy() {
    this._offPause?.();
    for (const sound of this._voices()) {
      if (sound.isPlaying) sound.stop();
      try { sound.disconnect?.(); } catch (_) { /* never connected */ }
    }
  }

  _onPause(paused) {
    if (paused) {
      this._paused = this._voices().filter(v => v.isPlaying);
      for (const v of this._paused) v.pause();
    } else {
      for (const v of this._paused ?? []) v.play();
      this._paused = null;
    }
  }

  /** The hum, synthesised into a buffer and looped. Null without audio. */
  _buildHum(engine) {
    const listener = engine?.audioListener;
    if (!listener) return null;
    const ctx = listener.context;
    const samples = synthRoverHum({ sampleRate: ctx.sampleRate });
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    return this._loop(listener, buffer);
  }

  /** The window's sand, looped click-free and filtered to tyres on dust.
   *  Null without audio or the clip. */
  _buildSand(engine) {
    const listener = engine?.audioListener;
    const key = BUGGY_SOUND.sandKey;
    if (!listener || !engine.assets?.has?.(key)) return null;
    const ctx = listener.context;
    const audio = this._loop(listener, loopable(engine.assets.get(key), ctx));
    const f = BUGGY_SOUND.sandFilter;
    const filter = (type, frequency, gain = 0) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = frequency;
      b.gain.value = gain;
      return b;
    };
    audio.setFilters([filter('highpass', f.highpass), filter('lowpass', f.lowpass), filter('peaking', f.crunch, f.crunchGain)]);
    return audio;
  }

  _loop(listener, buffer) {
    const audio = new THREE.Audio(listener);
    audio.setBuffer(buffer);
    audio.setLoop(true);
    audio.setVolume(0);
    return audio;
  }
}
