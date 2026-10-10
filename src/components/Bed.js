import { Interactable } from './Interactable.js';

// ─────────────────────────────────────────────
// Bed  –  sleep through the day to the next night
// ─────────────────────────────────────────────
// In the morning after a met quota (controller.canSleep): the screen fades
// to black and the GameController moves on to the next night (or ends the
// run after the last). During the shift it offers a nap instead (Nap.js):
// the night fast-forwarded until 6 AM or until something wakes you.
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

const LABEL = {
  sleep: '[E] Sleep',
  nap:   '[E] Nap — until 6:00 AM, or until something wakes you',
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

  promptLabel = '';

  onUpdate() {
    this.promptLabel = this._label();
  }

  onInteract() {
    if (!this.controller?.canSleep) {
      if (this.nap?.canNap) this.nap.start();
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
    return this.nap.canNap ? LABEL.nap : LABEL.uneasy;
  }
}
