import { Interactable } from './Interactable.js';

// ─────────────────────────────────────────────
// Bed  –  sleep through the day, or nap through part of the night
// ─────────────────────────────────────────────
// The morning after a met quota: the screen fades to black and the
// GameController moves on to the next night (or ends the run after the
// last).
//
// During the shift a tired player can nap (Nap): an hour, maybe two, and
// the Sleep Demon may be waiting. A rested one is told they aren't tired.
// On waking, the prompt says how long they slept for a few seconds.
//
// The room puts it on the bunk; the scene hands it the controller, the
// fade and the nap, since rooms don't know about gameplay:
//
//   rooms.LivingQuarters.bed.controller = gameController;
//   rooms.LivingQuarters.bed.fade       = screenFade;
//   rooms.LivingQuarters.bed.nap        = new Nap({ … });
//
// promptLabel is a data field refreshed every frame — InteractionSystem
// re-shows a label that changes while it's being looked at.
// ─────────────────────────────────────────────

const LABEL = {
  morning: '[E] Sleep',
  playing: "Can't sleep — the shift runs until 6:00 AM",
};
const NAP_LABEL = '[E] Nap — an hour, maybe more';
const NOT_TIRED = 'Not tired enough to sleep';
const WOKE = { 1: 'You slept an hour.', 2: 'You overslept. Two hours gone.' };
/** Seconds the waking note stays up. */
const NOTE_SECONDS = 4;

export class Bed extends Interactable {
  /** @type {import('../gameplay/GameController.js').GameController|null} */
  controller = null;
  /** @type {import('../ui/ScreenFade.js').ScreenFade|null} */
  fade = null;
  /** @type {import('../gameplay/Nap.js').Nap|null} */
  nap = null;

  promptLabel = '';

  _note = '';
  _noteLeft = 0;

  onUpdate(dt) {
    if (this._noteLeft > 0) this._noteLeft -= dt;
    this.promptLabel = this._label();
  }

  onInteract() {
    const state = this.controller?.state;
    if (state === 'morning') {
      // Checked again at black: a second press during the fade must not
      // sleep through a second night.
      this._behindFade(() => {
        if (this.controller.state === 'morning') this.controller.sleep();
      });
    } else if (state === 'playing' && this.nap?.allowed) {
      this._behindFade(() => this._wake(this.nap.take()));
    }
  }

  // ── Private ──

  _label() {
    const state = this.controller?.state;
    if (this._noteLeft > 0 && state !== 'gameOver') return this._note;
    if (state === 'playing' && this.nap) return this.nap.tired ? NAP_LABEL : NOT_TIRED;
    return LABEL[state] ?? '';
  }

  _wake(hours) {
    if (!hours) return;
    this._note = WOKE[hours] ?? `You slept ${hours} hours.`;
    this._noteLeft = NOTE_SECONDS;
  }

  _behindFade(atBlack) {
    if (this.fade) this.fade.play(atBlack);
    else atBlack();
  }
}
