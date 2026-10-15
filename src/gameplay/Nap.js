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
// runs normally again, you get up out of bed, and the banner says what woke
// you (scene.banner, fading out on its own).
//
// How you get up follows what woke you: calmly for the alarm, the E key or
// the shift ending (6 AM); startled for the alarms (the lamps' buzz, the
// UFO's roar). A night failed under it (not the morning) hands the view
// straight back (BedRest.cancel). Woken while still lying down, you get
// straight back up; the night was never sped up. Without a BedRest the nap
// freezes the player and runs fast at once (tests, a bare scene).
//
// Sleep is rest: while napping, stamina doesn't drain (StaminaDrain's
// isResting) and NAP.staminaPerHour comes back for every clock hour slept,
// frame by frame, so a longer nap restores more and one cut short gives
// back only what was slept.
//
// Asleep, the view is darkened, not shut: the bedside clock races at
// NAP.timeScale. While the Sleep Demon stands watching (hooks.watched) the
// night holds to real time, so the scene plays at the speed it is seen and
// an alarm can't cut it short; the digits slow to a crawl while it is there.
//
// The lids black the screen out, HUD and all, so for the whole nap a line
// over them (`hint`, NAP.wakeHint) says E wakes you.
//
// `hooks.restless()` refuses a nap outright (the UFO already on its way).
//
//   const nap = gameplayGO.addComponent(new Nap({
//     controller, engine, banner, stamina, rest: bedRest,
//     hooks: { setPlayerLocked, restless },
//     alarms: [{ test: () => !grid.on, message: 'The power went out.' }],
//   }));
// ─────────────────────────────────────────────

export const NAP = {
  /** How much faster the night runs while napping: the rest of a ten-minute
   *  night passes in well under a minute. */
  timeScale: 15,
  /** The alarm lengths the bunk offers, in clock hours; null sleeps to 6 AM. */
  lengths: [0.5, 1, 2, 3, null],
  /** What the alarm says. */
  alarmMessage: 'Your alarm went off.',
  /** Shown over the closed lids for the whole nap: the way out. */
  wakeHint: '[E] Wake up',
  /** Stamina given back per clock hour slept: 30 min 0.125, 1 h 0.25,
   *  3 h 0.75. */
  staminaPerHour: 0.25,
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
   * @param {{ show(text: string, opts?: object): void }|null} [opts.banner]
   *        The event banner: what woke you.
   * @param {{ setPlayerLocked?: (locked: boolean) => void, restless?: () => boolean, watched?: () => boolean }} [opts.hooks]
   * @param {{ test: () => boolean, message: string, tone?: string }[]} [opts.alarms]
   * @param {{ show(text: string): void, hide(): void }|null} [opts.hint]  Over the lids: "[E] Wake up".
   * @param {{ restore(amount: number): void }|null} [opts.stamina]  Topped up while asleep.
   */
  constructor({ controller, engine, rest = null, banner = null, hooks = {}, alarms = [], stamina = null, hint = null }) {
    super();
    Object.assign(this, { controller, engine, rest, banner, hooks, alarms, stamina, hint });
    this._sleptTo = null;                     // the clock hour slept up to
    this._armed = alarms.map(() => false);   // which alarms can still go off
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
    this._sleptTo = now ?? null;
    // Only a change wakes you: an alarm already true now is ignored.
    this._armed = this.alarms.map(a => !a.test());
    // The press that lay you down isn't the one that wakes you.
    this.engine.consumeAction?.('interact');
    this.hint?.show(NAP.wakeHint);
    // Only once the eyes are shut does the night speed up.
    this._asleep = false;
    const fastForward = () => {
      if (!this.napping) return;
      this._asleep = true;
      this.engine.timeScale = NAP.timeScale;
    };
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
  wake(message = null, style = 'calm', tone = 'info') {
    if (!this.napping) return;
    this._stop();
    this.wokeBy = message;
    if (this.rest) this.rest.getUp(style);
    else this.hooks.setPlayerLocked?.(false);
    if (message) this.banner?.show(message, { tone });
  }

  onUpdate(dt) {
    if (this.napping) {
      const state = this.controller.state;
      // 6 AM: up calmly into the morning. A night failed under it: the view
      // handed straight back.
      if (state === 'morning') return this.wake();
      if (state !== 'playing') return this._abandon();
      // The demon standing there holds the night to real time; otherwise
      // it races.
      if (this._asleep) this.engine.timeScale = this.hooks.watched?.() ? 1 : NAP.timeScale;
      this._rest();
      if (this.wakeAt !== null && this.controller.nightClock?.currentTime >= this.wakeAt) {
        return this.wake(NAP.alarmMessage);
      }
      if (this.engine.isAction?.('interact')) {
        // Used up, so the bunk doesn't read it as a new nap.
        this.engine.consumeAction?.('interact');
        return this.wake();
      }
      for (let i = 0; i < this.alarms.length; i++) {
        if (this._armed[i] && this.alarms[i].test()) return this.wake(this.alarms[i].message, 'startled', this.alarms[i].tone ?? 'warning');
      }
      return;
    }
  }

  /** Give back stamina for the clock time slept since the last frame. */
  _rest() {
    const now = this.controller.nightClock?.currentTime;
    if (now == null || this._sleptTo == null) return;
    if (now > this._sleptTo) this.stamina?.restore((now - this._sleptTo) * NAP.staminaPerHour);
    this._sleptTo = now;
  }

  /** Real time again, without getting up: the view is handed straight back. */
  _abandon() {
    this._stop();
    if (this.rest) this.rest.cancel();
    else this.hooks.setPlayerLocked?.(false);
  }

  _stop() {
    this.napping = false;
    this._asleep = false;
    this.engine.timeScale = 1;
    this.hint?.hide();
  }

  onDestroy() {
    if (this.napping) this._abandon();
  }
}
