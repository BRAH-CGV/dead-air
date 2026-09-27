import { Interactable } from './Interactable.js';

// ─────────────────────────────────────────────
// Bed  –  sleep through the day to the next night
// ─────────────────────────────────────────────
// Only the morning after a met quota: the screen fades to black and the
// GameController moves on to the next night (or ends the run after the
// last). During the shift the prompt says why not.
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
  morning: '[E] Sleep',
  playing: "Can't sleep — the shift runs until 6:00 AM",
};

export class Bed extends Interactable {
  /** @type {import('../gameplay/GameController.js').GameController|null} */
  controller = null;
  /** @type {import('../ui/ScreenFade.js').ScreenFade|null} */
  fade = null;

  promptLabel = '';

  onUpdate() {
    this.promptLabel = LABEL[this.controller?.state] ?? '';
  }

  onInteract() {
    if (this.controller?.state !== 'morning') return;
    // Checked again at black: a second press during the fade must not sleep
    // through a second night.
    const sleep = () => {
      if (this.controller.state === 'morning') this.controller.sleep();
    };
    if (this.fade) this.fade.play(sleep);
    else sleep();
  }
}
