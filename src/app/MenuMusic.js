import * as THREE from 'three';
import { loopSeam } from '../components/Ambience.js';

// ─────────────────────────────────────────────
// MenuMusic  –  the track under the main menu
// ─────────────────────────────────────────────
// One loop that fades in on the main menu (and the Settings and Credits
// opened from it) and fades out when the game starts. App tells it which.
//
// It lives with the app, not in the scene: the scene sits paused under the
// menu, so nothing in it is updated and nothing there could run a fade. The
// fades here are scheduled on the audio clock instead (a gain ramp), which
// needs no frames at all.
//
// Once started it is never stopped: out of the menu it loops on at zero, so
// coming back fades it up from wherever it has got to, and there is never a
// second copy to overlap the first. A silent loop costs next to nothing.
//
// Chrome keeps audio suspended until the player's first click or key press.
// The music is started regardless and simply waits; App wakes the audio on
// the first gesture on the menu. If that first gesture is New game, the
// music is already on its way out and is not heard that time.
// ─────────────────────────────────────────────

/** Tuning. Seconds unless stated. */
export const MENU_MUSIC = {
  key: 'sfx:interior-base-ambient-music',
  /** Of the clip's file level: the same trim it plays at in game. The file
   *  is far hotter than the rest of the game's sound. */
  volume: 0.07,
  fadeIn: 3,
  fadeOut: 2,
};

function makeSound(listener, buffer) {
  const sound = new THREE.Audio(listener);
  sound.setBuffer(buffer);
  return sound;
}

export class MenuMusic {
  /**
   * @param {object} opts
   * @param {{ audioListener?: THREE.AudioListener, assets?: { load: (key: string) => Promise<AudioBuffer> } }} opts.engine
   * @param {(listener: THREE.AudioListener, buffer: AudioBuffer) => THREE.Audio} [opts.createSound]  Injected in tests.
   */
  constructor({ engine, createSound = makeSound }) {
    this.engine = engine;
    this.createSound = createSound;
    /** @type {THREE.Audio|null} */
    this.sound = null;
    /** What the app last asked for, and what was last scheduled. */
    this._wanted = false;
    this._scheduled = null;
    this._disposed = false;
  }

  /** Fetch the clip. Safe to call with no audio at all. */
  load() {
    const { audioListener, assets } = this.engine ?? {};
    if (!audioListener || !assets?.load) return;
    assets.load(MENU_MUSIC.key).then((buffer) => {
      if (this._disposed) return;
      const sound = this.createSound(audioListener, buffer);
      sound.setLoop(true);
      sound.setLoopStart(loopSeam(buffer));
      sound.gain.gain.value = 0;
      this.sound = sound;
      this._apply();
    }).catch(err => console.warn(`[MenuMusic] no menu music — ${err.message}`));
  }

  /** Wanted (the main menu) or not (anything else). Fades either way. */
  setPlaying(on) {
    this._wanted = !!on;
    this._apply();
  }

  dispose() {
    this._disposed = true;
    const sound = this.sound;
    if (!sound) return;
    if (sound.isPlaying) sound.stop();
    try { sound.disconnect?.(); } catch (_) { /* never connected */ }
    this.sound = null;
  }

  /** Schedule the fade toward what is wanted, from where the gain is now. */
  _apply() {
    const sound = this.sound;
    if (!sound || this._scheduled === this._wanted) return;
    // Never started and not wanted: nothing to fade.
    if (!this._wanted && !sound.isPlaying) return;
    this._scheduled = this._wanted;

    if (this._wanted && !sound.isPlaying) sound.play();
    const gain = sound.gain.gain;
    const now = sound.context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(
      this._wanted ? MENU_MUSIC.volume : 0,
      now + (this._wanted ? MENU_MUSIC.fadeIn : MENU_MUSIC.fadeOut),
    );
  }
}
