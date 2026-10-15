import * as THREE from 'three';
import { Interactable } from './Interactable.js';
import { NAP } from '../gameplay/Nap.js';
import { NightClock } from '../gameplay/NightClock.js';
import { keyName } from '../app/keyNames.js';

// ─────────────────────────────────────────────
// Bed  –  sleep through the day to the next night
// ─────────────────────────────────────────────
// In the morning after a met quota, once the drive box is loaded into the
// buggy (controller.canSleep; until then it says so): the screen fades
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
// With a BedRest handed in (`bed.rest`), the morning sleep is the bed
// animation instead of the fade: lie down, sleep once the eyes are shut,
// then get up into the next night (or hand the view straight back when the
// run is over).
//
// The bunk's poses for that animation are here, in the bunk's own frame
// (BUNK_POSES), so they follow the bunk wherever the room puts it:
// pillowPose(), sitPose() and getOutSpot().
//
// promptLabel is a data field refreshed every frame — InteractionSystem
// re-shows a label that changes while it's being looked at.
// ─────────────────────────────────────────────

/**
 * The bed animation's views, in the bunk's frame: metres from its origin
 * (on the floor under its centre; its long side along z, the pillow at −z,
 * the open side +x), angles in radians. Yaw turns the forward view (−z)
 * about +Y; pitch up is positive.
 *
 *   pillow  the eye lying on the lower bunk, looking up toward its foot and
 *           out into the room, tipped onto its side
 *   sit     the eye sitting on its edge, legs out, facing the room
 *   out     the feet standing beside it, clear of its collider by more than
 *           the player's radius, facing the room — where you get up to
 */
export const BUNK_POSES = Object.freeze({
  pillow: Object.freeze({ position: [-0.05, 0.62, -0.68], yaw: -2.53, pitch: 0.55, roll: -0.22 }),
  sit: Object.freeze({ position: [0.4, 1.0, 0.15], yaw: -Math.PI / 2, pitch: -0.15, roll: 0 }),
  out: Object.freeze({ position: [1.0, 0, 0.35], yaw: -Math.PI / 2 }),
});

const _q = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/** The alarm length the bunk starts on: an hour. */
const DEFAULT_LENGTH = NAP.lengths.indexOf(1);

const LABEL = {
  sleep: '[E] Sleep',
  shift: "Can't sleep — the shift runs until 6:00 AM",
  uneasy: "Can't sleep now",
  deliver: 'Load the drive box into the buggy first',
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
  /** The bed animation (BedRest); without one the morning sleep fades. */
  rest = null;

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
    if (this.rest?.active) return;
    if (!this.controller?.canSleep) {
      if (this.nap?.canNap) this.nap.start(NAP.lengths[this.napLength]);
      return;
    }
    // Checked again at black: a second press during the fade must not sleep
    // through a second night.
    const sleep = () => {
      if (this.controller.canSleep) this.controller.sleep();
    };
    if (this.rest) {
      // Asleep, the next night begins: up out of bed into it. The run over
      // (the last night), the view is handed straight back.
      this.rest.lieDown(() => {
        sleep();
        if (this.controller.state === 'playing') this.rest.getUp('calm');
        else this.rest.cancel();
      });
    } else if (this.fade) this.fade.play(sleep);
    else sleep();
  }

  _label() {
    const c = this.controller;
    if (!c || this.rest?.active) return '';
    if (c.canSleep) return LABEL.sleep;
    if (c.state === 'morning') return LABEL.deliver;
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

  /** The eye lying on the pillow: { position, yaw, pitch, roll }, world. */
  pillowPose() {
    return this._view(BUNK_POSES.pillow);
  }

  /** The eye sitting on the bunk's edge: { position, yaw, pitch, roll }, world. */
  sitPose() {
    return this._view(BUNK_POSES.sit);
  }

  /** Where you get up to: { position (the feet, world), yaw }. */
  getOutSpot() {
    const { position, yaw } = this._view(BUNK_POSES.out);
    return { position, yaw };
  }

  /** The bunk's object, its world matrix fresh, or null off a bunk. */
  _bunk() {
    const o = this.gameObject?.object3d ?? null;
    o?.updateWorldMatrix(true, false);
    return o;
  }

  /** A view from the bunk's frame into the world: the position through its
   *  matrix, the yaw turned by its own. */
  _view({ position, yaw = 0, pitch = 0, roll = 0 }) {
    const o = this._bunk();
    const p = new THREE.Vector3(...position);
    let turn = 0;
    if (o) {
      o.localToWorld(p);
      _euler.setFromQuaternion(o.getWorldQuaternion(_q), 'YXZ');
      turn = _euler.y;
    }
    return { position: p, yaw: yaw + turn, pitch, roll };
  }

  _engine() {
    return this.engine ?? this.gameObject?.scene?.userData?.engine ?? null;
  }
}
