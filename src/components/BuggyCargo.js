import { Interactable } from './Interactable.js';

// ─────────────────────────────────────────────
// BuggyCargo  –  the buggy's boot, where the drives go before bed
// ─────────────────────────────────────────────
// The boot on the buggy's rear (#98). In the morning the player carries the
// night's drive box out of the airlock and sets it down here; the
// GameController keeps the bed shut until it is in (GameController.delivered)
// and the buggy has been sent off (GameController.dispatched). Mid-shift the
// boot refuses the box, so the quota is still counted at the airlock's dock
// all night.
//
// Once the box is in and the quota is met, the label switches to
// '[E] Send the buggy off'. Pressing E either starts the send-off cutscene
// (sendOff.start()) or, if no cutscene is wired, dispatches directly
// (controller.dispatch()).
//
// The scene builds the boot on the buggy and hands this the controller and
// the bay's DriveBoxDock; the bay's SnapSocket asks accepts() before seating
// a box:
//
//   const socket = go.addComponent(new SnapSocket({ canAccept: item => cargo.accepts(item), … }));
//   cargo.dock = go.addComponent(new DriveBoxDock({ socket }));
//   cargo.controller = gameController;
//
// promptLabel is a data field refreshed every frame — InteractionSystem
// re-shows a label that changes while it's being looked at.
// ─────────────────────────────────────────────

/** The boot, in metres: `size` is [across, height, along]; `top` is the
 *  world y of the rim; `gap` keeps it clear of the buggy's body; `wall`
 *  is the steel thickness; `lidOpen` is how far the lid swings (radians);
 *  `mount` is how far the mount plate reaches forward into the body. */
export const BUGGY_CARGO = Object.freeze({
  size: Object.freeze([1.0, 0.4, 0.6]),
  top: 1.0,
  gap: 0.02,
  wall: 0.04,
  lidOpen: 80 * Math.PI / 180,
  mount: 0.35,
});

const LABEL = {
  name: 'Buggy',
  shift: 'Buggy — the drives go in its boot after the shift',
  bring: 'Buggy — put the drive box in its boot',
  short: 'Buggy — the box in its boot is short of the quota',
  send: '[E] Send the buggy off',
  loaded: 'Buggy — drives loaded',
};

export class BuggyCargo extends Interactable {
  /** @type {import('../gameplay/GameController.js').GameController|null} */
  controller = null;
  /** The bay's own dock, counting the drives in the box set down here.
   *  @type {import('../gameplay/DriveBoxDock.js').DriveBoxDock|null} */
  dock = null;
  /** The send-off cutscene (BuggySendOff); null dispatches directly.
   *  @type {{ active: boolean, start(): void }|null} */
  sendOff = null;

  promptLabel = LABEL.name;

  /** Whether the bay takes this item: a whole drive box, in the morning. */
  accepts(item) {
    return item?.isDriveBox === true && this.controller?.state === 'morning';
  }

  /** Whether the buggy can be sent off: morning, the dock holds a box that
   *  meets the quota, not yet dispatched, and the cutscene isn't running. */
  get canSend() {
    if (this.controller?.state !== 'morning') return false;
    if (!this.dock?.depositedBox || !this.dock.isQuotaMet()) return false;
    if (this.controller.dispatched) return false;
    if (this.sendOff?.active) return false;
    return true;
  }

  onUpdate() {
    this.promptLabel = this._label();
  }

  onInteract() {
    if (!this.canSend) return;
    if (this.sendOff) this.sendOff.start();
    else this.controller.dispatch();
  }

  _label() {
    if (this.canSend) return LABEL.send;
    const state = this.controller?.state;
    if (state === 'playing') return LABEL.shift;
    if (state !== 'morning') return LABEL.name;
    // Dispatched or the cutscene running: drives loaded.
    if (this.controller.dispatched || this.sendOff?.active) return LABEL.loaded;
    if (!this.dock?.depositedBox) return LABEL.bring;
    return this.dock.isQuotaMet() ? LABEL.loaded : LABEL.short;
  }
}
