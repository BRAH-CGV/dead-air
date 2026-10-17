import * as THREE from 'three';
import { Interactable } from './Interactable.js';
import { NAP } from '../gameplay/Nap.js';
import { NightClock } from '../gameplay/NightClock.js';
import { keyName } from '../app/keyNames.js';

// ─────────────────────────────────────────────
// Bed  –  sleep through the day to the next night
// ─────────────────────────────────────────────
// In the morning after a met quota, once the drive box is loaded into the
// buggy and it has been sent off (controller.canSleep; until then it says
// which is left): the screen fades
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
// pillowPose(), sitPose(), getOutSpot() and the demon's watchSpots().
//
// Between nights (#101) the scene hands it `bed.dream(night)`: on any night
// but the last, falling asleep dreams (DreamScene) instead of waking
// straight into the next night — the dream wakes you into it. It returns
// false when there's no dream to be had, and the sleep goes on as before.
// Naps never dream.
//
// On night 0, until the tutorial's nap step (`bed.tutorial`, Tutorial), the
// bunk is the way out of it: "[E] Sleep until 6:00 AM — skip the tutorial"
// lies you down and wakes you into night 1, no quota, buggy or dream needed.
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
 *   pillow  the eye lying on the bed's pillow, on its side facing the side
 *           table (where the bedside clock stands), the clock well in view
 *   sit     the eye sitting on its edge, legs out, facing the room
 *   out     the feet standing beside it, clear of its collider by more than
 *           the player's radius, facing the room — where you get up to
 *   watch   where the Sleep Demon stands to watch a sleeper: across the
 *           bedroom in front of the pillow, in its view, clear of the lockers
 *
 * Fitted to bed.glb (0.9 × 2 m, mattress top 0.45 m, the pillow at
 * z −0.92 … −0.70); LivingQuarters.test.js reads the file to keep them so.
 */
export const BUNK_POSES = Object.freeze({
  pillow: Object.freeze({ position: [0.03, 0.6, -0.8], yaw: -1.68, pitch: 0.1, roll: 0.22 }),
  sit: Object.freeze({ position: [0.32, 1.0, 0.15], yaw: -Math.PI / 2, pitch: -0.15, roll: 0 }),
  out: Object.freeze({ position: [0.85, 0, 0.35], yaw: -Math.PI / 2 }),
  watch: Object.freeze([[2.02, 0, -0.28], [2.82, 0, 0.27], [2.72, 0, 1.27]]),
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
  send: 'Send the buggy off first',
  skip: '[E] Sleep until 6:00 AM — skip the tutorial',
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
  /** Between nights: `(night) => boolean`, dream instead of waking into the
   *  next night; false if there's no dream (#101). Set by the scene. */
  dream = null;
  /** Night 0's Tutorial: while it `canSkip`, the bunk skips it. Set by the scene. */
  tutorial = null;

  promptLabel = '';

  onUpdate() {
    this.promptLabel = this._label();
  }

  /** Looked at: the rotate key steps the alarm, once per press. */
  onHover() {
    if (this.tutorial?.canSkip) return;   // no alarm to set
    const engine = this._engine();
    if (!this.nap?.canNap || !engine?.isAction?.('rotateHeld')) return;
    engine.consumeAction?.('rotateHeld');
    this.napLength = (this.napLength + 1) % NAP.lengths.length;
  }

  onInteract() {
    if (this.rest?.active) return;
    if (this.tutorial?.canSkip) {
      this._skipTutorial();
      return;
    }
    if (!this.controller?.canSleep) {
      if (this.nap?.canNap) this.nap.start(NAP.lengths[this.napLength]);
      return;
    }
    // Checked again at black: a second press during the fade must not sleep
    // through a second night. Returns true when it went into a dream — the
    // scene is about to be swapped for it, so nothing more happens here.
    const sleep = () => {
      if (!this.controller.canSleep) return false;
      const last = this.controller.nights?.isLastNight?.() ?? false;
      if (!last && this.dream?.(this.controller.nightNumber)) return true;
      this.controller.sleep();
      return false;
    };
    if (this.rest) {
      // Asleep, the next night begins: up out of bed into it. The run over
      // (the last night), the view is handed straight back. Dreaming, the
      // dream takes the view.
      this.rest.lieDown(() => {
        if (sleep()) return;
        if (this.controller.state === 'playing') this.rest.getUp('calm');
        else this.rest.cancel();
      });
    } else if (this.fade) this.fade.play(sleep);
    else sleep();
  }

  /** Lie down, skip to night 1 once the eyes are shut, and get up into it. */
  _skipTutorial() {
    const skip = () => this.tutorial.skip();
    if (this.rest) {
      this.rest.lieDown(() => {
        skip();
        if (this.controller.state === 'playing') this.rest.getUp('calm');
        else this.rest.cancel();
      });
    } else if (this.fade) this.fade.play(skip);
    else skip();
  }

  _label() {
    const c = this.controller;
    if (!c || this.rest?.active) return '';
    if (c.canSleep) return LABEL.sleep;
    if (c.state === 'morning') return c.delivered ? LABEL.send : LABEL.deliver;
    if (c.state !== 'playing' || this.nap?.napping) return '';
    if (this.tutorial?.canSkip) return LABEL.skip;
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

  /** Where the Sleep Demon stands to watch a sleeper: floor points, world. */
  watchSpots() {
    const o = this._bunk();
    return BUNK_POSES.watch.map(p => {
      const v = new THREE.Vector3(...p);
      return o ? o.localToWorld(v) : v;
    });
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
