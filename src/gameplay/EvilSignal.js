import { Component } from '../core/Component.js';
import { SignalTarget } from './SignalTarget.js';
import { PITCH_MIN, PITCH_MAX, VISIBLE_SECONDS } from './SignalManager.js';
import { skyToCursor } from '../gameobjects/DishRig.js';
import { DriveSparks, SPARKS } from './DriveSparks.js';

// ─────────────────────────────────────────────
// EvilSignal  –  the red one that is not a signal
// ─────────────────────────────────────────────
// For testing, summon() — the G key — puts it in the sky. It has no night
// of its own yet; EVIL.nights is where that will go.
//
// It reads as an ordinary blip except that it is red. The moment the radar
// cursor is on it, it scans itself — no Enter, no wait, no dish to settle —
// and then the dish is locked. During the entire lockout (pull-in + lock),
// any drive inserted into the reader is infected immediately: the evil
// signal is saved to it (turning it RED/corrupted), the drive is ejected,
// and the player must wipe it at the ServerRoom console within
// EVIL.silenceSeconds (15 s) or the shift ends: "You were silenced."
// If no drive is inserted during the lock, the signal disappears but
// respawns later in the night (after EVIL.respawnDelaySeconds).
//
// Rooms don't know about gameplay: the scene hands it the signal manager,
// the terminal, the drive reader and the array, and it drives itself.
// The terminal reports the radar cursor through hover() every frame it is
// open; everything else is decided here.
// ─────────────────────────────────────────────

/** Game-over prompt when the corrupted drive is not wiped in time. */
const CAUGHT_PROMPT = 'You were silenced. [E] to retry';

/** White-out config: instant black, slow fade to blood red, message once
 *  it has settled — same pattern as DustEyes. */
const CAUGHT_SCREEN = { tone: 'blood', fadeMs: 0, redMs: 2500, messageDelayMs: 2200 };

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
  /** Seconds the player has to wipe a corrupted drive at the ServerRoom
   *  console before the shift ends ("You were silenced").
   *  TEMP: 15 s for debugging. Restore before release. */
  silenceSeconds: 15,
  /** Seconds between random hops of the corrupted drive while the silence
   *  timer runs. The drive jumps in a random direction every interval. */
  driveHopSeconds: 1,
  /** Seconds the cursor and dish are dragged to the evil signal's centre
   *  before the normal engage logic fires. */
  pullInSeconds: 0.8,
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
  /** @type {import('../ui/WhiteOut.js').WhiteOut|null} */
  whiteOut = null;
  /** @type {import('../ui/DeleteWarning.js').DeleteWarning|null} */
  deleteWarning = null;
  /** @type {import('../core/RedOut.js').RedOut|null} */
  redOut = null;
  /** @type {{ setPlayerLocked: (locked: boolean) => void }|null} */
  hooks = null;

  /** True while the cursor is being dragged to the signal centre.
   *  ComputerTerminal checks this to freeze WASD input. */
  pullingIn = false;

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
  /** The signal target being pulled toward during the pull-in animation.
   *  @type {SignalTarget|null} */
  _pullTarget = null;
  /** Seconds remaining on the pull-in animation. @type {number} */
  _pullTimer = 0;
  /** Cursor position at pull-in start (lerp origin). @type {{x:number,y:number}|null} */
  _pullStartCursor = null;
  /** Cursor position at pull-in end (lerp target). @type {{x:number,y:number}|null} */
  _pullTargetCursor = null;
  /** Seconds until the evil signal respawns after a no-drive lock, or null
   *  when not counting down. @type {number|null} */
  _respawnTimer = null;
  /** Seconds left to wipe the corrupted drive before game over, or null
   *  when no corrupted drive is outstanding. @type {number|null} */
  _silenceTimer = null;
  /** Seconds until the corrupted drive next hops in a random direction.
   *  Counts down from EVIL.driveHopSeconds while the silence timer runs.
   *  @type {number|null} */
  _driveHopTimer = null;
  /** The drive currently showing the doom glow, so we can clear it when
   *  the timer ends or the night resets. @type {object|null} */
  _lastCorruptedDrive = null;
  /** True after the silence timer expires — the player is locked until
   *  the night resets (retry or next night). @type {boolean} */
  _caught = false;
  /** True once a drive has been infected during this lockout — prevents
   *  re-infecting if another drive is inserted after the first was wiped.
   *  @type {boolean} */
  _driveInfected = false;
  /** Sparks flying from the corrupted drive while the silence timer runs.
   *  @type {import('./DriveSparks.js').DriveSparks|null} */
  _sparks = null;

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
    if (this.locked || this._mustLeave || this.pullingIn) return;
    // Start the pull-in: the cursor and dish are dragged to the signal's
    // centre before the normal engage logic fires.
    this._startPullIn(sig);
  }

  onUpdate(dt) {
    // The shift ended mid-hold: let go, whatever the terminal is doing.
    if (this.controller && this.controller.state !== 'playing') {
      if (this.locked) this._release();
      return;
    }

    // The pull-in: the cursor and dish are dragged to the signal's centre
    // before the normal engage logic fires. WASD is frozen during this.
    if (this.pullingIn) {
      this._pullTimer -= dt;
      const t = 1 - Math.max(0, this._pullTimer) / EVIL.pullInSeconds;  // 0→1
      const x = this._pullStartCursor.x + (this._pullTargetCursor.x - this._pullStartCursor.x) * t;
      const y = this._pullStartCursor.y + (this._pullTargetCursor.y - this._pullStartCursor.y) * t;
      this.terminal?.setCursorPosition?.(x, y);
      // The UFO-style glitch fades in during the pull-in.
      const sig = this._pullTarget;
      if (sig && this.terminal?.radar) {
        this.terminal.radar.evilLock = {
          active: true,
          yaw: sig.yaw,
          pitch: sig.pitch,
          intensity: t * 0.8,  // fade in from 0 to full
          time: Date.now() / 1000,
        };
      }
      if (this._pullTimer <= 0) {
        this.pullingIn = false;
        this._engage(this._pullTarget);
        this._pullTarget = null;
      }
      return;  // skip the rest while pulling
    }

    // The respawn timer ticks even when not locked.
    if (this._respawnTimer !== null) {
      this._respawnTimer -= dt;
      if (this._respawnTimer <= 0) {
        this._respawnTimer = null;
        this.summon();   // a new red signal at a new random position
      }
    }

    // The silence timer ticks even when not locked — the corrupted drive
    // must be wiped at the ServerRoom console before it runs out.
    if (this._silenceTimer !== null) {
      const corrupted = this._findCorruptedDrive();
      if (!corrupted) {
        // The drive was wiped (or lost): no more threat.
        this._disposeSparks();
        this._silenceTimer = null;
        this._driveHopTimer = null;
        this.deleteWarning?.hide();
        // The doom glow fades out on the drive over a few seconds rather
        // than cutting — the drive owns the fade now.
        this._lastCorruptedDrive?.startDoomFadeOut?.();
        this._lastCorruptedDrive = null;
      } else {
        this._silenceTimer -= dt;

        // Ramp the doom glow: 0 at the start, 1 when the timer expires.
        const doomFraction = 1 - (this._silenceTimer / EVIL.silenceSeconds);
        corrupted.setDoomGlow?.(doomFraction);
        this._lastCorruptedDrive = corrupted;

        // Sparks: fly out of the corrupted drive, rate scaling with doom.
        this._sparks?.tick(dt, corrupted, doomFraction);

        // Red filter: fades in over the last 0.5 s before the player dies.
        if (this.redOut) {
          const REDOUT_WINDOW = 0.5;
          const lastWindow = this._silenceTimer < REDOUT_WINDOW
            ? 1 - this._silenceTimer / REDOUT_WINDOW   // 0 → 1 over the final 0.5 s
            : 0;
          this.redOut.setIntensity(lastWindow);
        }

        // The corrupted drive hops in a random direction every interval.
        // The kick strength scales from 1× to 3× as the timer runs out.
        if (this._driveHopTimer !== null) {
          this._driveHopTimer -= dt;
          if (this._driveHopTimer <= 0) {
            this._driveHopTimer = EVIL.driveHopSeconds;
            const kickStrength = 1 + doomFraction * 2;  // 1 → 3
            this._kickDrive(corrupted, kickStrength);
            this._sparks?.burst(
              SPARKS.burstCount[0] + (Math.random() * (SPARKS.burstCount[1] - SPARKS.burstCount[0])) | 0,
            );
          }
        }

        if (this._silenceTimer <= 0) {
          this._disposeSparks();
          this._silenceTimer = null;
          this._driveHopTimer = null;
          this._caught = true;
          this.controller?.fail(CAUGHT_PROMPT, {
            retryAfter: CAUGHT_SCREEN.messageDelayMs / 1000,
          });
          this.terminal?.exit?.();
          this.whiteOut?.play(CAUGHT_PROMPT, CAUGHT_SCREEN);
          this.hooks?.setPlayerLocked?.(true);
          return;
        }
        // Warn the player while the lock is not showing its own message.
        if (!this.locked) {
          this.terminal?.radar?.setInfo?.(
            `ANOMALOUS SIGNAL ON DRIVE — wipe in ${Math.ceil(this._silenceTimer)} s`,
          );
        }
      }
    }

    if (!this.locked) return;

    // The array stays physically on it — even if the player walks away
    // from the terminal — until the time is up. The signal may already be
    // resolved (saved to a drive), but the lock still runs.
    const sig = this._target;
    if (!sig) { this._release(); return; }
    this.satellite?.aimAll(sig.yaw, sig.pitch);

    // Infect any drive inserted during the lock phase.
    this._infectDrive();

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

  /** Start the pull-in animation: the cursor and dish are dragged from
   *  their current position to the signal's centre on the radar disc.
   *  Once the animation completes, _engage() fires normally. */
  _startPullIn(sig) {
    const cursor = this.terminal?.cursorPosition;
    if (!cursor) { this._engage(sig); return; }  // no terminal — skip
    this._pullStartCursor = { x: cursor.x, y: cursor.y };
    this._pullTargetCursor = skyToCursor(sig.yaw, sig.pitch);
    this._pullTarget = sig;
    this._pullTimer = EVIL.pullInSeconds;
    this.pullingIn = true;
  }

  /** Hovered: it scans itself at once, then locks the dish. The lock runs
   *  for a single duration; during the lock, any inserted drive is
   *  infected immediately. */
  _engage(sig) {
    this.signalManager?.markScanned(sig.id);
    this.locked = true;
    this._remain = EVIL.lockWithDriveSeconds;
    this._showLock();
    // Infect any drive that's already inserted right as the lock starts.
    this._infectDrive();
  }

  /** Infect any drive currently inserted in the reader. Called continuously
   *  during the lockout phase (pull-in + lock) so a drive inserted mid-way
   *  is caught immediately. Only infects once per lockout. */
  _infectDrive() {
    // Already infected a drive this lockout — nothing more to do.
    if (this._driveInfected) return;
    const drive = this.driveManager;
    if (!drive?.driveInserted) return;
    // A drive is in the reader: save the evil signal to it right away
    // (overwriting any existing signal), then start the silence timer.
    this.signalManager?.saveSignal(this._target?.id);
    drive.saveEvilToDrive();
    // Shoot the corrupted drive out of the reader in a random direction.
    drive.ejectInsertedDrive?.();
    this.terminal?.radar?.setInfo?.('Anomalous signal copied — the drive reads RED');
    // Force the player out of the computer screen so they must chase the
    // corrupted drive and wipe it at the ServerRoom console.
    this.terminal?.exit?.();
    this._silenceTimer = EVIL.silenceSeconds;
    this._driveHopTimer = EVIL.driveHopSeconds;
    this._driveInfected = true;
    this.deleteWarning?.show();
    // Sparks: fly out of the corrupted drive at an increasing rate.
    this._sparks = new DriveSparks();
    this.scene?.add(this._sparks.points);
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

  /** Apply a random kick to the corrupted drive — same direction profile
   *  as the ejection launch, but scaled by `strength` (1 = baseline half-
   *  strength, 3 = triple that). The kick and rotation both grow linearly
   *  as the silence timer runs out, matching the doom glow intensity. */
  _kickDrive(drive, strength = 1) {
    const body = drive.rigidBody;
    if (!body) return;
    const angle = Math.random() * Math.PI * 2;
    const hSpeed = (0.75 + Math.random() * 1) * strength;
    body.setLinvel({
      x: Math.cos(angle) * hSpeed,
      y: (1.25 + Math.random() * 0.75) * strength,
      z: Math.sin(angle) * hSpeed,
    }, true);
    body.setAngvel({
      x: (Math.random() - 0.5) * 20 * strength,
      y: (Math.random() - 0.5) * 20 * strength,
      z: (Math.random() - 0.5) * 20 * strength,
    }, true);
  }

  /** Dispose the sparks system and remove its Points from the scene. */
  _disposeSparks() {
    if (this._sparks) {
      this._sparks.dispose();
      this._sparks.points.removeFromParent();
      this._sparks = null;
    }
  }

  /** First drive in the manager's pool whose signal is corrupted, or null.
   *  @returns {object|null} */
  _findCorruptedDrive() {
    const drives = this.driveManager?.drives;
    if (!drives) return null;
    for (const d of drives) {
      if (d.corrupted) return d;
    }
    return null;
  }

  /** A new night: the manager rebuilds its signals, so drop the old target
   *  and any hold. (When it gets a night of its own, the scheduled spawn
   *  goes here.) */
  _reset() {
    this._release();
    this._target = null;
    this._hover = null;
    this._mustLeave = false;
    this.pullingIn = false;
    this._pullTarget = null;
    this._pullTimer = 0;
    this._pullStartCursor = null;
    this._pullTargetCursor = null;
    this._respawnTimer = null;
    this._silenceTimer = null;
    this._driveHopTimer = null;
    this._driveInfected = false;
    this.deleteWarning?.hide();
    this.redOut?.clear();
    this._disposeSparks();
    // Clear the doom glow from whatever drive was showing it.
    this._lastCorruptedDrive?.clearDoomGlow?.();
    this._lastCorruptedDrive = null;
    if (this._caught) {
      this._caught = false;
      this.hooks?.setPlayerLocked?.(false);
      this.whiteOut?.clear();
    }
  }
}
