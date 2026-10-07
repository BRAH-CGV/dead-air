import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// AirlockSound  –  the pressure release as the airlock cycles
// ─────────────────────────────────────────────
// The airlock is silent while it cycles with both doors shut (the Ambience
// drops both sides' sound). This fills that silence: one hiss of pressure
// as the doors seal, on the way out and on the way back in.
//
//   • Once a cycle, as it begins. A cycle that turns back on itself (the
//     suit changed again mid-cycle) doesn't start it over.
//   • Only for a player in the chamber. A cycle they are not in — a retry
//     takes the suit off with the player back at the spawn — is not heard.
//   • The cycle is as long as the clip is audible (Airlock.cycleTime is
//     AIRLOCK_SOUND.audibleSeconds), so it has rung out as the door ahead
//     opens. If a door opens while it is still sounding, it fades out
//     instead of cutting.
//
// The clip is not placed in the stereo field: it is all around you.
// ─────────────────────────────────────────────

/** Tuning. Seconds unless stated. */
export const AIRLOCK_SOUND = {
  key: 'sfx:pressure-release',
  /** How long the clip can be heard: a burst that has hissed away to nothing
   *  by here. The file runs on to 3.76 s, the rest silence. The airlock's
   *  cycle is set to this. */
  audibleSeconds: 3.1,
  volume: 0.6,
  /** Fade when a door opens with it still sounding. */
  fadeOut: 0.3,
};

const isCycling = state => state === 'depressurising' || state === 'pressurising';

export class AirlockSound extends Component {
  /**
   * @param {object} opts
   * @param {{ state: string, onStateChange: (fn: (state: string) => void) => () => void }} opts.airlock
   * @param {import('three').Audio|null} opts.sound  The pressure release. Null: silent.
   * @param {() => boolean} opts.isInside  Is the listener in the chamber?
   */
  constructor({ airlock, sound, isInside }) {
    super();
    this.airlock = airlock;
    this.sound = sound;
    this.isInside = isInside;

    this._cycling = isCycling(airlock.state);
    /** Seconds of fade left, or null when not fading. */
    this._fade = null;
    this._off = null;
  }

  /** Subscribed on awake, not on the first frame: the scene is built paused
   *  behind the menu, and the airlock can change before anything ticks. */
  onAwake() {
    this._off ??= this.airlock.onStateChange(state => this._onState(state));
  }

  onUpdate(dt) {
    if (this._fade === null) return;
    this._fade -= dt;
    const sound = this.sound;
    if (this._fade > 0 && sound?.isPlaying) {
      sound.setVolume(AIRLOCK_SOUND.volume * this._fade / AIRLOCK_SOUND.fadeOut);
      return;
    }
    if (sound?.isPlaying) sound.stop();
    this._fade = null;
  }

  onDestroy() {
    this._off?.();
    this._off = null;
    if (this.sound?.isPlaying) this.sound.stop();
    this._fade = null;
  }

  _onState(state) {
    const cycling = isCycling(state);
    const was = this._cycling;
    this._cycling = cycling;
    if (cycling === was) return;   // turned back mid-cycle: let it ring on

    if (cycling) this._release();
    else if (this.sound?.isPlaying) this._fade = AIRLOCK_SOUND.fadeOut;
  }

  /** The doors have sealed: the hiss, from its top. */
  _release() {
    const sound = this.sound;
    if (!sound || !this.isInside()) return;
    if (sound.isPlaying) sound.stop();
    this._fade = null;
    sound.setVolume(AIRLOCK_SOUND.volume);
    sound.play();
  }
}
