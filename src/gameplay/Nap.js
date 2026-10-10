import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// Nap  –  sleep through part of the night (Component)
// ─────────────────────────────────────────────
// At the bunk during the shift the player can nap: the screen fades to
// black (ScreenFade.cover), the player is frozen, and the whole night runs
// NAP.timeScale times faster (engine.timeScale) — the clock, the signals,
// the storms, the UFO's schedule, the dust eyes. Nothing is skipped, only
// fast-forwarded, so signals that come while you sleep are missed.
//
// It ends at 6 AM (the shift ends) or when something happens: an alarm
// whose test turns true that wasn't true when you lay down — the power
// going out, the UFO on the radar, eyes at the window. Then time runs
// normally again, the screen fades in, and the HUD says what woke you for
// NAP.messageSeconds before the shift's own prompt comes back.
//
// `hooks.restless()` refuses a nap outright (the UFO already on its way).
//
//   const nap = gameplayGO.addComponent(new Nap({
//     controller, engine, fade, hud,
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
};

export class Nap extends Component {
  /** True from start() until woken. */
  napping = false;
  /** What woke the player last, or null (slept to 6 AM). */
  wokeBy = null;

  /**
   * @param {object} opts
   * @param {import('./GameController.js').GameController} opts.controller
   * @param {{ timeScale: number }} opts.engine
   * @param {{ cover: (onDark?: () => void) => boolean, uncover: () => void }} [opts.fade]
   * @param {{ setPrompt: (text: string) => void }} [opts.hud]
   * @param {{ setPlayerLocked?: (locked: boolean) => void, restless?: () => boolean }} [opts.hooks]
   * @param {{ test: () => boolean, message: string }[]} [opts.alarms]
   */
  constructor({ controller, engine, fade = null, hud = null, hooks = {}, alarms = [] }) {
    super();
    Object.assign(this, { controller, engine, fade, hud, hooks, alarms });
    this._armed = alarms.map(() => false);   // which alarms can still go off
    this._messageLeft = 0;                    // real seconds the wake-up line has left
  }

  /** During the shift, awake, with nothing already on its way. */
  get canNap() {
    return this.controller.state === 'playing' && !this.napping && !this.hooks.restless?.();
  }

  /** Lie down. @returns {boolean} whether the nap started */
  start() {
    if (!this.canNap) return false;
    this.napping = true;
    this.wokeBy = null;
    // Only a change wakes you: an alarm already true now is ignored.
    this._armed = this.alarms.map(a => !a.test());
    this.hooks.setPlayerLocked?.(true);
    const fastForward = () => { if (this.napping) this.engine.timeScale = NAP.timeScale; };
    if (!this.fade?.cover(fastForward)) fastForward();
    return true;
  }

  /** Wake up: real time, the screen back, the player free. */
  wake(message = null) {
    if (!this.napping) return;
    this.napping = false;
    this.wokeBy = message;
    this.engine.timeScale = 1;
    this.fade?.uncover();
    this.hooks.setPlayerLocked?.(false);
    if (message) {
      this.hud?.setPrompt(message);
      this._messageLeft = NAP.messageSeconds;
    }
  }

  onUpdate(dt) {
    if (this.napping) {
      if (this.controller.state !== 'playing') return this.wake();
      for (let i = 0; i < this.alarms.length; i++) {
        if (this._armed[i] && this.alarms[i].test()) return this.wake(this.alarms[i].message);
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

  onDestroy() {
    if (this.napping) this.wake();
  }
}
