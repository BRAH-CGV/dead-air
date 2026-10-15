import { Interactable } from './Interactable.js';

// ─────────────────────────────────────────────
// BuggyCargo  –  the buggy's cargo bay, where the drives go before bed
// ─────────────────────────────────────────────
// A crate on the ground at the buggy's end nearest the hatch. In the
// morning the player carries the night's drive box out of the airlock and
// sets it down here; the GameController keeps the bed shut until it is in
// (GameController.delivered). Mid-shift the bay refuses the box, so the
// quota is still counted at the airlock's dock all night.
//
// The scene builds the crate and hands this the controller and the bay's
// DriveBoxDock; the bay's SnapSocket asks accepts() before seating a box:
//
//   const socket = go.addComponent(new SnapSocket({ canAccept: item => cargo.accepts(item), … }));
//   cargo.dock = go.addComponent(new DriveBoxDock({ socket }));
//   cargo.controller = gameController;
//
// promptLabel is a data field refreshed every frame — InteractionSystem
// re-shows a label that changes while it's being looked at.
// ─────────────────────────────────────────────

/** The crate, in metres: `size` is [along the buggy, height, across it];
 *  `gap` keeps it clear of the buggy's collider. */
export const BUGGY_CARGO = Object.freeze({
  size: Object.freeze([0.9, 0.85, 1.1]),
  gap: 0.3,
});

const LABEL = {
  name: 'Buggy cargo',
  shift: 'Buggy cargo — the drives go in after the shift',
  bring: 'Buggy cargo — set the drive box down here',
  short: 'Buggy cargo — the box is short of the quota',
  loaded: 'Buggy cargo — drives loaded',
};

export class BuggyCargo extends Interactable {
  /** @type {import('../gameplay/GameController.js').GameController|null} */
  controller = null;
  /** The bay's own dock, counting the drives in the box set down here.
   *  @type {import('../gameplay/DriveBoxDock.js').DriveBoxDock|null} */
  dock = null;

  promptLabel = LABEL.name;

  /** Whether the bay takes this item: a whole drive box, in the morning. */
  accepts(item) {
    return item?.isDriveBox === true && this.controller?.state === 'morning';
  }

  onUpdate() {
    this.promptLabel = this._label();
  }

  _label() {
    const state = this.controller?.state;
    if (state === 'playing') return LABEL.shift;
    if (state !== 'morning') return LABEL.name;
    if (!this.dock?.depositedBox) return LABEL.bring;
    return this.dock.isQuotaMet() ? LABEL.loaded : LABEL.short;
  }
}
