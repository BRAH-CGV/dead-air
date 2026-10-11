import { Interactable } from './Interactable.js';
import { NAP } from '../gameplay/Nap.js';
import { NightClock } from '../gameplay/NightClock.js';
import { keyName } from '../app/keyNames.js';

// ─────────────────────────────────────────────
// Bed  –  sleep through the day to the next night
// ─────────────────────────────────────────────
// In the morning after a met quota (controller.canSleep): the screen fades
// to black and the GameController moves on to the next night (or ends the
// run after the last). During the shift it offers a nap instead (Nap.js):
// the night fast-forwarded until the alarm, 6 AM, or something wakes you.
// While looking at it, the rotate key (R) steps the alarm through
// NAP.lengths; the prompt says when you would wake.
//
// The room puts it on the bunk; the scene hands it the controller and the
// fade, since rooms don't know about gameplay:
//
//   rooms.LivingQuarters.bed.controller = gameController;
//   rooms.LivingQuarters.bed.fade       = screenFade;
//
// promptLabel is a data field refreshed every frame — InteractionSystem
// re-shows a label that changes while it's being looked at.
// ─────────────────────────────────────────────

/** The alarm length the bunk starts on: an hour. */
const DEFAULT_LENGTH = NAP.lengths.indexOf(1);

const LABEL = {
  sleep: '[E] Sleep',
  shift: "Can't sleep — the shift runs until 6:00 AM",
  uneasy: "Can't sleep now",
};

export class Bed extends Interactable {
  /** @type {import('../gameplay/GameController.js').GameController|null} */
  controller = null;
  /** @type {import('../ui/ScreenFade.js').ScreenFade|null} */
  fade = null;
  /** @type {import('../gameplay/Nap.js').Nap|null} */
  nap = null;
  /** The engine, for the rotate key; found through the scene when unset. */
  engine = null;
  /** Which of NAP.lengths the alarm is set to. */
  napLength = DEFAULT_LENGTH;

  promptLabel = '';

  onUpdate() {
    this.promptLabel = this._label();
  }

  /** Looked at: the rotate key steps the alarm, once per press. */
  onHover() {
    const engine = this._engine();
    if (!this.nap?.canNap || !engine?.isAction?.('rotateHeld')) return;
    engine.consumeAction?.('rotateHeld');
    this.napLength = (this.napLength + 1) % NAP.lengths.length;
  }

  onInteract() {
    if (!this.controller?.canSleep) {
      if (this.nap?.canNap) this.nap.start(NAP.lengths[this.napLength]);
      return;
    }
    // Checked again at black: a second press during the fade must not sleep
    // through a second night.
    const sleep = () => {
      if (this.controller.canSleep) this.controller.sleep();
    };
    if (this.fade) this.fade.play(sleep);
    else sleep();
  }

  _label() {
    const c = this.controller;
    if (!c) return '';
    if (c.canSleep) return LABEL.sleep;
    if (c.state !== 'playing' || this.nap?.napping) return '';
    if (!this.nap) return LABEL.shift;
    return this.nap.canNap ? this._napLabel() : LABEL.uneasy;
  }

  /** '[E] Nap 1 h (until 2:15 AM) · [R] change' — or 'until 6:00 AM' when
   *  the alarm is off, or would only go off after the shift has ended. */
  _napLabel() {
    const hours = NAP.lengths[this.napLength];
    const clock = this.controller.nightClock;
    const key = keyName(this._engine()?.keyBinds?.rotateHeld ?? 'KeyR');
    const end = clock?.endHour ?? 6;
    const wake = hours == null || !clock ? null : clock.currentTime + hours;
    const what = wake == null || wake >= end
      ? `until ${NightClock.formatTime(end)}`
      : `${hours < 1 ? `${hours * 60} min` : `${hours} h`} (until ${NightClock.formatTime(wake)})`;
    return `[E] Nap ${what} · [${key}] change`;
  }

  _engine() {
    return this.engine ?? this.gameObject?.scene?.userData?.engine ?? null;
  }
}
