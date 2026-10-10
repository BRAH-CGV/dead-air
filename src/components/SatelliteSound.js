import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { loopable } from './GeneratorSound.js';

// ─────────────────────────────────────────────
// SatelliteSound  –  the dish's drive, and the click as it settles
// ─────────────────────────────────────────────
// Rides on the Satellite and is the sound of it slewing:
//
//   loop     the drive, for as long as the dish is moving. It fades in as a
//            movement starts and out as it ends, 30 ms each way — long
//            enough not to click, short enough to still start and stop.
//            Played a few semitones down (loopDetune), so it is deeper.
//   ending   once after each movement: the dish settling on its mount.
//
// "Moving" is read off the dish's own angular velocity, either axis. It
// has to be clearly moving to start (startSpeed) and clearly stopped to end
// (stopSpeed), so a dish creeping at one threshold doesn't chatter.
//
// The fades are gain ramps scheduled on the audio clock, not volume steps a
// frame at a time: 30 ms is two frames, and two steps is a click. Between
// movements the loop runs on at zero rather than being stopped, so there is
// only ever one copy, and nothing to cut.
//
// Paused, the game stops but the audio clock doesn't, so the drive would
// run on under the pause menu. The engine says when it pauses: the loop is
// faded out and a click still sounding is cut, and on resume the loop comes
// back if the dish is still mid-movement.
//
// Neither clip is placed in the stereo field: the loop was recorded as the
// dish heard from a distance, which is where the player sits to steer it.
// ─────────────────────────────────────────────

/** Tuning. Seconds unless stated. */
export const SATELLITE_SOUND = {
  loop:   'sfx:dish-main-loop-distant',
  ending: 'sfx:movement-ending',
  /** Of each clip's own level. */
  loopVolume: 0.3,
  endingVolume: 1,
  /** Cents the drive is played below the recording's own pitch (100 to a
   *  semitone). At its own pitch it whines; a dish this size is a deeper,
   *  slower machine. It runs that much slower too: 0.79× at −400. */
  loopDetune: -400,
  /** The loop's fade in and out. */
  fade: 0.03,
  /** Angular speed (rad/s, either axis) above which a movement has begun,
   *  and below which it is over. The dish's top speed is π/8 ≈ 0.39. */
  startSpeed: 0.05,
  stopSpeed: 0.02,
};

export class SatelliteSound extends Component {
  /** Is the dish in a movement right now? */
  moving = false;

  /**
   * @param {object} [opts]
   * @param {{ velYaw: number, velPitch: number }} [opts.satellite]  Left
   *        out, the GameObject this rides on.
   * @param {{ loop?: THREE.Audio, ending?: THREE.Audio }} [opts.sounds]
   *        Built from SATELLITE_SOUND's keys when left out.
   */
  constructor({ satellite = null, sounds = null } = {}) {
    super();
    this.satellite = satellite;
    this.sounds = sounds;
    this._offPause = null;
  }

  onStart() {
    this.satellite ??= this.gameObject;
    this.sounds ??= this._buildSounds();
    this.sounds.loop?.setDetune?.(SATELLITE_SOUND.loopDetune);
    const engine = this.gameObject?.scene?.userData?.engine;
    this._offPause ??= engine?.onPauseChange?.(paused => this._onPause(paused)) ?? null;
  }

  onUpdate(_dt) {
    const dish = this.satellite;
    if (!dish) return;
    const speed = Math.max(Math.abs(dish.velYaw ?? 0), Math.abs(dish.velPitch ?? 0));

    if (!this.moving && speed > SATELLITE_SOUND.startSpeed) {
      this.moving = true;
      this._fadeLoop(SATELLITE_SOUND.loopVolume);
    } else if (this.moving && speed < SATELLITE_SOUND.stopSpeed) {
      this.moving = false;
      this._fadeLoop(0);
      this._settle();
    }
  }

  onDestroy() {
    this._offPause?.();
    this._offPause = null;
    for (const sound of Object.values(this.sounds ?? {})) {
      if (sound?.isPlaying) sound.stop();
      try { sound?.disconnect?.(); } catch (_) { /* never connected */ }
    }
  }

  // ── Internals ─────────────────────────────

  /** The game paused or resumed. `moving` is left as it is: the movement
   *  carries on from where it was, so a pause is no reason for the click. */
  _onPause(paused) {
    if (paused) {
      this._fadeLoop(0);
      const ending = this.sounds?.ending;
      if (ending?.isPlaying) ending.stop();
    } else if (this.moving) {
      this._fadeLoop(SATELLITE_SOUND.loopVolume);
    }
  }

  /** Ramp the loop to `target` over the fade, from where its gain is now. */
  _fadeLoop(target) {
    const loop = this.sounds?.loop;
    if (!loop) return;
    if (target > 0 && !loop.isPlaying) loop.play();
    const gain = loop.gain.gain;
    const now = loop.context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(target, now + SATELLITE_SOUND.fade);
  }

  /** The click of the dish coming to rest, from its top. */
  _settle() {
    const ending = this.sounds?.ending;
    if (!ending) return;
    if (ending.isPlaying) ending.stop();
    ending.setVolume(SATELLITE_SOUND.endingVolume);
    ending.play();
  }

  /** One THREE.Audio per clip from the preloaded buffers; the loop gets a
   *  click-free looping copy and starts at zero. Missing buffers are left out. */
  _buildSounds() {
    const engine = this.gameObject?.scene?.userData?.engine;
    const sounds = {};
    if (!engine?.audioListener || !engine.assets?.has) return sounds;
    const { loop, ending } = SATELLITE_SOUND;

    if (engine.assets.has(loop)) {
      const audio = new THREE.Audio(engine.audioListener);
      audio.setBuffer(loopable(engine.assets.get(loop), engine.audioListener.context));
      audio.setLoop(true);
      audio.gain.gain.value = 0;
      sounds.loop = audio;
    }
    if (engine.assets.has(ending)) {
      const audio = new THREE.Audio(engine.audioListener);
      audio.setBuffer(engine.assets.get(ending));
      sounds.ending = audio;
    }
    return sounds;
  }
}
