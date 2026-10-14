import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// Nap  –  sleep through part of the night (Component)
// ─────────────────────────────────────────────
// At the bunk during the shift the player can nap: they lie down on it
// (BedRest: the view goes to the pillow and the lids close), and once the
// eyes are shut the whole night runs NAP.timeScale times faster
// (engine.timeScale) — the clock, the signals, the storms, the UFO's
// schedule, the dust eyes. Nothing is skipped, only fast-forwarded, so
// signals that come while you sleep are missed.
//
// The player sets an alarm: start(hours) wakes them once the clock has run
// on that far (NAP.lengths, chosen at the bunk); start() sleeps to 6 AM.
//
// It ends at 6 AM (the shift ends), when the alarm goes off, when the
// player presses E, or when
// something happens that would really wake a sleeper — something loud: an
// alarm whose test turns true that wasn't true when you lay down (the
// lamps buzzing before a storm outage, the UFO's roar). Silent things — a
// blob on the office radar, eyes at the office window — don't. Then time
// runs normally again, you get up out of bed, and the HUD says what woke you
// for NAP.messageSeconds before the shift's own prompt comes back.
//
// How you get up follows what woke you: calmly for the alarm, the E key or
// the shift ending (6 AM); startled for the alarms (the lamps' buzz, the
// UFO's roar). A night failed under it (not the morning) hands the view
// straight back (BedRest.cancel). Woken while still lying down, you get
// straight back up; the night was never sped up. Without a BedRest the nap
// freezes the player and runs fast at once (tests, a bare scene).
//
// `hooks.restless()` refuses a nap outright (the UFO already on its way).
//
//   const nap = gameplayGO.addComponent(new Nap({
//     controller, engine, hud, rest: bedRest,
//     hooks: { setPlayerLocked, restless },
//     alarms: [{ test: () => !grid.on, message: 'The power went out.' }],
//   }));
// ─────────────────────────────────────────────

export const NAP = {
  /** How much faster the night runs while napping: the rest of a ten-minute
   *  night passes in well under a minute. */
  timeScale: 15,
  /** Real seconds the wake-up line stays up. */
  messageSeconds: 4,
  /** The alarm lengths the bunk offers, in clock hours; null sleeps to 6 AM. */
  lengths: [0.5, 1, 2, 3, null],
  /** What the alarm says. */
  alarmMessage: 'Your alarm went off.',
};

export class Nap extends Component {
  /** True from start() until woken. */
  napping = false;
  /** What woke the player last, or null (slept to 6 AM). */
  wokeBy = null;
  /** The clock hour the alarm is set for, or null (sleep to 6 AM). */
  wakeAt = null;

  /**
   * @param {object} opts
   * @param {import('./GameController.js').GameController} opts.controller
   * @param {{ timeScale: number }} opts.engine
   * @param {{ active: boolean, lieDown(onAsleep: () => void): boolean,
   *           getUp(style: 'calm'|'startled'): boolean, cancel(): void }|null} [opts.rest]
   *        The bed animation (BedRest).
   * @param {{ setPrompt: (text: string) => void }} [opts.hud]
   * @param {{ setPlayerLocked?: (locked: boolean) => void, restless?: () => boolean }} [opts.hooks]
   * @param {{ test: () => boolean, message: string }[]} [opts.alarms]
   */
  constructor({ controller, engine, rest = null, hud = null, hooks = {}, alarms = [] }) {
    super();
    Object.assign(this, { controller, engine, rest, hud, hooks, alarms });
    this._armed = alarms.map(() => false);   // which alarms can still go off
    this._messageLeft = 0;                    // real seconds the wake-up line has left
  }

  /** During the shift, awake and out of bed, with nothing already on its way. */
  get canNap() {
    return this.controller.state === 'playing' && !this.napping && !this.rest?.active && !this.hooks.restless?.();
  }

  /** Lie down, with the alarm set `hours` of clock time ahead (null: sleep
   *  to 6 AM). @param {number|null} [hours]
   *  @returns {boolean} whether the nap started */
  start(hours = null) {
    if (!this.canNap) return false;
    this.napping = true;
    this.wokeBy = null;
    const now = this.controller.nightClock?.currentTime;
    this.wakeAt = hours != null && now != null ? now + hours : null;
    // Only a change wakes you: an alarm already true now is ignored.
    this._armed = this.alarms.map(a => !a.test());
    // The press that lay you down isn't the one that wakes you.
    this.engine.consumeAction?.('interact');
    // Only once the eyes are shut does the night speed up.
    const fastForward = () => { if (this.napping) this.engine.timeScale = NAP.timeScale; };
    if (this.rest) {
      this.rest.lieDown(fastForward);
    } else {
      this.hooks.setPlayerLocked?.(true);
      fastForward();
    }
    return true;
  }

  /** Wake up: real time, and out of bed — `style` 'calm' (the alarm, E,
   *  6 AM) or 'startled' (something loud). */
  wake(message = null, style = 'calm') {
    if (!this.napping) return;
    this._stop();
    this.wokeBy = message;
    if (this.rest) this.rest.getUp(style);
    else this.hooks.setPlayerLocked?.(false);
    if (message) {
      this.hud?.setPrompt(message);
      this._messageLeft = NAP.messageSeconds;
    }
  }

  onUpdate(dt) {
    if (this.napping) {
      const state = this.controller.state;
      // 6 AM: up calmly into the morning. A night failed under it: the view
      // handed straight back.
      if (state === 'morning') return this.wake();
      if (state !== 'playing') return this._abandon();
      if (this.wakeAt !== null && this.controller.nightClock?.currentTime >= this.wakeAt) {
        return this.wake(NAP.alarmMessage);
      }
      if (this.engine.isAction?.('interact')) {
        // Used up, so the bunk doesn't read it as a new nap.
        this.engine.consumeAction?.('interact');
        return this.wake();
      }
      for (let i = 0; i < this.alarms.length; i++) {
        if (this._armed[i] && this.alarms[i].test()) return this.wake(this.alarms[i].message, 'startled');
      }
      return;
    }
    if (this._messageLeft > 0) {
      this._messageLeft -= dt;
      if (this._messageLeft <= 0 && this.controller.state === 'playing') {
        this.hud?.setPrompt('');
        this.controller.refreshPrompt?.();
      }
    }
  }

  /** Real time again, without getting up: the view is handed straight back. */
  _abandon() {
    this._stop();
    if (this.rest) this.rest.cancel();
    else this.hooks.setPlayerLocked?.(false);
  }

  _stop() {
    this.napping = false;
    this.engine.timeScale = 1;
  }

  onDestroy() {
    if (this.napping) this._abandon();
  }
}
