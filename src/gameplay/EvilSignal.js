import { Component } from '../core/Component.js';
import { SignalTarget } from './SignalTarget.js';
import { PITCH_MIN, PITCH_MAX, VISIBLE_SECONDS } from './SignalManager.js';

// ─────────────────────────────────────────────
// EvilSignal  –  the red one that is not a signal
// ─────────────────────────────────────────────
// For testing, summon() — the G key — puts it in the sky. It has no night
// of its own yet; EVIL.nights is where that will go.
//
// It reads as an ordinary blip except that it is red. The moment the radar
// cursor is on it, it scans itself — no Enter, no wait, no dish to settle —
// and then one of two things happens:
//
//   no drive       the array is pinned to it for EVIL.lockSeconds (10 s):
//                  the cursor is frozen, the dish holds the bearing, and
//                  the night is that much shorter. When the hold ends, the
//                  signal disappears — but respawns later in the night
//                  (after EVIL.respawnDelaySeconds), so the player must
//                  deal with it again.
//   drive inserted the evil signal is saved to the drive immediately
//                  (overwriting any existing signal), turning it RED
//                  (corrupted). The array is then pinned for
//                  EVIL.lockWithDriveSeconds (5 s). A red drive never
//                  counts towards the night quota — it has to be wiped at
//                  the ServerRoom console like any deleted signal.
//                  No respawn: the drive carries the consequence.
//
// Rooms don't know about gameplay: the scene hands it the signal manager,
// the terminal, the drive reader and the array, and it drives itself.
// The terminal reports the radar cursor through hover() every frame it is
// open; everything else is decided here.
// ─────────────────────────────────────────────

/** Tuning. Seconds and radians unless stated. */
export const EVIL = {
  /** The nights it appears on — none yet: until the run grows a night for
   *  it, the G debug key is the only way in. */
  nights: [],
  /** Where it fades in (clock hours after midnight), once scheduled. */
  spawnHours: [1, 4],
  /** Real seconds the dot takes to fade in, like an ordinary signal. */
  fadeSeconds: 3,
  /** Real seconds the dot holds before fading out. 1.5× an ordinary
   *  signal (VISIBLE_SECONDS = 15 s), so the red dot lingers longer but
   *  doesn't outlive the shift — it must be dealt with before it fades. */
  visibleSeconds: Math.round(1.5 * VISIBLE_SECONDS),
  /** The no-drive penalty: seconds the array is pinned to it.
   *  TEMP: 10 s for debugging (was 30). Restore before release. */
  lockSeconds: 10,
  /** The drive-inserted penalty: seconds the array is pinned when a drive
   *  is in the reader (blank or with a signal). Shorter than no-drive.
   *  TEMP: 5 s for debugging. Restore before release. */
  lockWithDriveSeconds: 5,
  /** Seconds after a no-drive lock before the evil signal respawns at a
   *  new random position. The player dealt with it, but it comes back.
   *  TEMP: 30 s for debugging. Restore before release. */
  respawnDelaySeconds: 30,
  /** Angular acceptance — the same 12° an ordinary signal demands. */
  tolerance: 12 * (Math.PI / 180),
  /** Its id in the signal list — out of the 1..signalsPerNight range. */
  id: -1,
};

export class EvilSignal extends Component {
  // ── External references (set by BaseScene during wiring) ──
  /** @type {import('./GameController.js').GameController|null} */
  controller = null;
  /** @type {import('./SignalManager.js').SignalManager|null} */
  signalManager = null;
  /** @type {import('../components/ComputerTerminal.js').ComputerTerminal|null} */
  terminal = null;
  /** @type {import('./DriveManager.js').DriveManager|null} */
  driveManager = null;
  /** @type {import('../gameobjects/Satellite.js').Satellite|null} */
  satellite = null;

  /** True while the array is pinned to the red signal (the no-drive
   *  penalty). The terminal freezes its cursor while this is set. */
  locked = false;

  /** Seconds left on the lock. @type {number} */
  _remain = 0;
  /** The red target in the manager's list, or null. @type {SignalTarget|null} */
  _target = null;
  /** Set when a lock ends: no re-engaging until the cursor leaves the
   *  signal (the cursor is still parked on it when the hold expires). */
  _mustLeave = false;
  /** What the radar cursor is on right now (the evil target, or null). */
  _hover = null;
  /** @type {(() => void)|null} */
  _offNight = null;
  /** Seconds until the evil signal respawns after a no-drive lock, or null
   *  when not counting down. @type {number|null} */
  _respawnTimer = null;

  /**
   * @param {object} [opts]
   * @param {import('./GameController.js').GameController} [opts.controller]
   * @param {import('./SignalManager.js').SignalManager} [opts.signalManager]
   * @param {import('../components/ComputerTerminal.js').ComputerTerminal} [opts.terminal]
   * @param {import('./DriveManager.js').DriveManager} [opts.driveManager]
   * @param {import('../gameobjects/Satellite.js').Satellite} [opts.satellite]
   * @param {() => number} [opts.random]
   */
  constructor({
    controller = null, signalManager = null, terminal = null,
    driveManager = null, satellite = null, random = Math.random,
  } = {}) {
    super();
    Object.assign(this, { controller, signalManager, terminal, driveManager, satellite, random });
  }

  onStart() {
    this._offNight = this.controller?.onNightStart?.(() => this._reset()) ?? null;
  }

  onDestroy() {
    this._release();
    this._offNight?.();
    this._offNight = null;
  }

  /**
   * Put the red signal in the sky now rather than at its time — the G debug
   * key. Refused while the previous one is still unresolved, or outside a
   * shift.
   * @returns {boolean} whether it appeared
   */
  summon() {
    if (this.controller?.state !== 'playing') return false;
    if (this._target && !this._target.resolved && !this._target.expired) return false;

    // Drop a spent target first, so re-summoning never stacks them.
    if (this._target) {
      const sigs = this.signalManager?.signals;
      const i = sigs ? sigs.indexOf(this._target) : -1;
      if (i !== -1) sigs.splice(i, 1);
    }

    // Anywhere a dish can see it — the manager's own band, its own numbers.
    const yaw = (this.random() * 2 - 1) * Math.PI;
    const pitch = PITCH_MIN + this.random() * (PITCH_MAX - PITCH_MIN);
    const target = new SignalTarget({
      id: EVIL.id,
      yaw,
      pitch,
      tolerance: EVIL.tolerance,
      scanTime: 0,                    // it never runs through a scan
      payloadUrl: '',
      appearAt: 0,
      fadeSeconds: EVIL.fadeSeconds,
      visibleSeconds: EVIL.visibleSeconds,
      evil: true,
    });
    this.signalManager?.signals.push(target);
    this._target = target;
    this._hover = null;
    this._mustLeave = false;
    return true;
  }

  /**
   * The terminal reports what the radar cursor is on each open frame — the
   * evil target, or null. On it, the signal scans itself and is dealt with
   * (see the header); off it, a finished lock may engage again.
   * @param {SignalTarget|null} sig
   */
  hover(sig) {
    this._hover = sig;
    // The cursor left — a lock that has run its course may engage anew.
    if (sig !== this._target) this._mustLeave = false;
    if (!sig || sig !== this._target || sig.resolved) return;
    if (this.locked || this._mustLeave) return;
    this._engage(sig);
  }

  onUpdate(dt) {
    // The shift ended mid-hold: let go, whatever the terminal is doing.
    if (this.controller && this.controller.state !== 'playing') {
      if (this.locked) this._release();
      return;
    }

    // The respawn timer ticks even when not locked.
    if (this._respawnTimer !== null) {
      this._respawnTimer -= dt;
      if (this._respawnTimer <= 0) {
        this._respawnTimer = null;
        this.summon();   // a new red signal at a new random position
      }
    }

    if (!this.locked) return;

    // The array stays physically on it — even if the player walks away
    // from the terminal — until the time is up. The signal may already be
    // resolved (saved to a drive), but the lock still runs.
    const sig = this._target;
    if (!sig) { this._release(); return; }
    this.satellite?.aimAll(sig.yaw, sig.pitch);

    // The radar shows the same glitchy effect as the UFO, centered on the
    // locked signal, while the dish is held.
    if (this.terminal?.radar) {
      this.terminal.radar.evilLock = {
        active: true,
        yaw: sig.yaw,
        pitch: sig.pitch,
        intensity: 0.8,
        time: Date.now() / 1000,
      };
    }

    this._remain -= dt;
    if (this._remain <= 0) {
      this._release();
      this._mustLeave = true;   // don't re-grab while the cursor sits on it
      return;
    }
    this._showLock();
  }

  // ── Private ──────────────────────────────

  /** Hovered: it scans itself at once, then either locks the dish (with or
   *  without a drive). If a drive is inserted, the evil signal is saved to
   *  it immediately (overwriting any existing signal), but the lock still
   *  runs for the full duration. */
  _engage(sig) {
    this.signalManager?.markScanned(sig.id);

    const drive = this.driveManager;
    if (drive?.driveInserted) {
      // A drive is in the reader (blank or with a signal): save the evil
      // signal to it right away (overwriting any existing signal), then
      // lock for the shorter duration.
      this.signalManager?.saveSignal(sig.id);
      drive.saveEvilToDrive();
      this.terminal?.radar?.setInfo?.('Anomalous signal copied — the drive reads RED');
      this.locked = true;
      this._remain = EVIL.lockWithDriveSeconds;
      this._showLock();
      return;
    }

    // No drive: longer lock, no save.
    this.locked = true;
    this._remain = EVIL.lockSeconds;
    this._showLock();
  }

  /** The radar info line while the dish is held — seconds remaining. */
  _showLock() {
    this.terminal?.radar?.setInfo?.(
      `SIGNAL LOCKED — the dish is held for ${Math.ceil(this._remain)} s`,
    );
  }

  /** Let go of the dish: the hold is over, or the shift ended. The signal
   *  disappears — it's been dealt with. If no drive was inserted (the
   *  signal wasn't saved), it will respawn later in the night. */
  _release() {
    if (!this.locked) return;
    this.locked = false;
    this._remain = 0;
    this.terminal?.radar?.setInfo?.('');
    if (this.terminal?.radar) {
      this.terminal.radar.evilLock = null;
    }
    // No drive was used: the signal will respawn later so the player must
    // deal with it again. With a drive, the consequence is on the drive —
    // no respawn. Check before marking deleted (which makes resolved true).
    const noDrive = !this._target?.resolved;
    // The signal has been dealt with — make it disappear from the radar.
    if (this._target && !this._target.resolved) {
      this._target.deleted = true;
    }
    if (noDrive) {
      this._respawnTimer = EVIL.respawnDelaySeconds;
    }
  }

  /** A new night: the manager rebuilds its signals, so drop the old target
   *  and any hold. (When it gets a night of its own, the scheduled spawn
   *  goes here.) */
  _reset() {
    this._release();
    this._target = null;
    this._hover = null;
    this._mustLeave = false;
    this._respawnTimer = null;
  }
}
