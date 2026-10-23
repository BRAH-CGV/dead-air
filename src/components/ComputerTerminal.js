import * as THREE from 'three';
import { Component } from '../core/Component.js';
import { Interactable } from './Interactable.js';
import { FirstPersonController } from './FirstPersonController.js';
import { DISH_SLEW_RATE } from '../gameobjects/Satellite.js';
import { cursorToSky, skyToCursor } from '../gameobjects/DishRig.js';
import { paintDom } from '../ui/paintDom.js';
import { SCANNER_ALERT } from './ScannerAlertSound.js';

// ─────────────────────────────────────────────
// ComputerTerminal  –  Component (attach to the retro-computer)
// ─────────────────────────────────────────────
// Drives the signal-collection gameplay from the computer desk.
//
// State machine:
//   IDLE → RADAR → SCANNING → REVIEW → RADAR → …
//
// While active, the player's input is locked (no mouse look or WASD) but
// physics still applies — gravity and momentum continue. WASD moves a
// cursor that the satellite dish "chases" with momentum.
//
// External references (set by OfficeScene during wiring):
//   satellite, signalManager, hud, radar, driveManager, evilSignal
// ─────────────────────────────────────────────

/** @readonly */
// Cursor movement rate in Cartesian units per second (unit-circle space).
// Paced to the dish: the radius is 90° of sky (zenith to horizon), so the
// cursor sweeps DISH_SLEW_RATE (22.5°/s) — 1/4 unit/s, the full radius in
// 4 s. Any faster and the dish falls further behind the longer a key is
// held. One 60 fps frame moves 0.375° of sky, so a tap can stop inside a
// signal's 12° acceptance.
const CURSOR_RATE = DISH_SLEW_RATE / (Math.PI / 2);

/** The dish's parked pose — the cursor starts here so opening the computer
 *  for the first time doesn't slew the tower. Must match BaseScene's park
 *  angles. */
const PARK_YAW   = Math.PI / 4;          // 45°
const PARK_PITCH = -55 * Math.PI / 180;  // −55°
const _parkCursor = skyToCursor(PARK_YAW, PARK_PITCH);

/** Shown while the radar cursor sits on the UFO's blob. */
export const ANOMALY_WARNING = '⚠ EXTREME ELECTRICAL ANOMALY DETECTED — turn off power to avoid further damage';

/** The desk's prompt while the generator is off. */
const NO_POWER_LABEL = 'No power — restore it at the generator outside';

/** Base seconds the lock-on phase takes before scanning begins (randomised ±25%). */
const LOCK_ON_BASE_SECONDS = 3;

/** Seconds the dish takes to slew to the signal centre before lock-on. */
const PULL_IN_SECONDS = 0.5;

/** Randomise a duration within ±25% of its base value. */
function randomiseDuration(base) {
  return base * (0.75 + Math.random() * 0.5);
}

export class ComputerTerminal extends Component {
  // ── State ─────────────────────────────────────────────────
  /** 'idle' | 'radar' | 'scanning' | 'review' */
  state = 'idle';

  // ── External references (set before first use) ──
  /** @type {import('../gameobjects/Satellite.js').Satellite|null} */
  satellite = null;
  /** @type {import('../gameplay/SignalManager.js').SignalManager|null} */
  signalManager = null;
  /** @type {import('../ui/HUD.js').HUD|null} */
  hud = null;
  /** @type {import('../ui/HUD.js').RadarOverlay|null} */
  radar = null;

  /** @type {import('../gameplay/DriveManager.js').DriveManager|null} */
  driveManager = null;
  /** The red signal: hovering it scans it instantly (EvilSignal owns what
   *  happens next — a save to the drive, or the dish pinned to it).
   *  @type {import('../gameplay/EvilSignal.js').EvilSignal|null} */
  evilSignal = null;
  /** @type {import('../gameplay/GameController.js').GameController|null} */
  gameController = null;
  /** @type {import('../ui/Crosshair.js').Crosshair|null} */
  crosshair = null;
  /** Leans the view in to the computer's screen and draws the radar on it
   *  (#161). Without one (tests, other scenes) the radar goes over the
   *  whole view. @type {import('./ScreenView.js').ScreenView|null} */
  screenView = null;
  /** The computer's screen, for screenView.
   *  @type {ReturnType<typeof import('./ScreenView.js').screenSurface>|null} */
  screen = null;

  /** @type {number|null} ID of the currently hovered signal */
  _hoveredSignal = null;

  /** Accumulated lock-on progress in seconds (0.._lockOnDuration).
   *  Phase 1 fills this bar; phase 2 (scan) only starts after it completes. */
  _lockOnProgress = 0;

  /** The randomised lock-on duration for the current attempt. */
  _lockOnDuration = LOCK_ON_BASE_SECONDS;

  /** The signal currently being locked on (null when not in lock-on). */
  _lockOnTarget = null;

  /** True while the dish is being pulled to a signal's centre before
   *  lock-on begins.  WASD and Enter are frozen during this. */
  _pullingIn = false;
  /** Seconds remaining on the dish pull-in animation. */
  _pullTimer = 0;
  /** Cursor position at pull-in start (lerp origin). */
  _pullStartCursor = null;
  /** Cursor position at pull-in end (signal centre). */
  _pullTargetCursor = null;
  /** The signal the dish is being pulled toward. */
  _pullSignal = null;

  /** Cursor position in Cartesian unit-circle coords: x -1..+1 (left..right),
   *  y -1..+1 (down..up). The disc's centre (0, 0) is the zenith and its rim
   *  the horizon — straight down from the centre is the horizon out of the
   *  window. Clamped to the unit circle so the cursor stays in the radar. */
  _cursorX = _parkCursor.x;
  _cursorY = _parkCursor.y;

  /** Edge-trigger for the interact key (prevent re-entry while held). */
  _interactHeld = false;
  /** Edge-trigger for Enter key (scan initiation). */
  _enterHeld = false;

  // ── Prompt label for the Interactable ──
  promptLabel = '[E] Use Computer';
  interactRange = 4;

  // ──────────────────────────────────────────────────────────
  // Public API — also callable from tests
  // ──────────────────────────────────────────────────────────

  /** Whether the generator is feeding the terminal — it's a vital function,
   *  so it comes back with the power even when the lights stay broken.
   *  Change it through setPowered(). */
  powered = true;

  /** The Interactable on the desk, so its prompt can say there's no power.
   *  Set by createComputerInteractable(). @type {Interactable|null} */
  _interactable = null;

  /** Enter the terminal (called when the player interacts with the computer). */
  enter() {
    if (this.state !== 'idle' || !this.powered) return;
    // Background scan still running on the satellite — resume the scanning UI.
    if (this.satellite?.isScanning && this.satellite?.scanTarget) {
      // Drive removed during background scan — reset without saving.
      if (this._driveRemovedDuringScan()) {
        this._cleanupState();
        this._enterRadar();
        return;
      }
      this._hoveredSignal = this.satellite.scanTarget;
      this.state = 'scanning';
      this._setInputLocked(true);
      this.crosshair?.hide();
      this.radar?.show();
      if (this.screenView && this.screen) this.screenView.open(this.screen, this.radar?.root ?? null);
      this.radar?.setInfo('Scanning… keep dish aimed!');
      return;
    }
    this._enterRadar();
  }

  /** The power came or went. Losing it shuts the screen and drops any scan
   *  in progress. @param {boolean} powered */
  setPowered(powered) {
    this.powered = powered;
    if (this._interactable) this._interactable.promptLabel = powered ? this.promptLabel : NO_POWER_LABEL;
    if (powered) return;
    this.exit();
    this._cleanupState();
  }

  /** Exit the terminal back to IDLE (Q key). */
  exit() {
    if (this.state === 'idle') return;
    // Cancel any in-progress dish pull-in.
    this._pullingIn = false;
    this._pullSignal = null;
    // Exiting during lock-on: clear the satellite's scan state (it was
    // set by _enterScanning but lock-on never completed) but keep the
    // lock-on fields so the bar stays frozen at its current progress
    // on the visible radar overlay.
    if (this._lockOnTarget && this._lockOnProgress < this._lockOnDuration) {
      if (this.satellite) {
        this.satellite.scanTarget = null;
        this.satellite.scanProgress = 0;
      }
    }
    // Exiting mid-scan: let the satellite keep scanning in the background.
    if (this.state !== 'scanning') this._cleanupState();
    this._enterIdle();
  }

  /** Move the cursor in Cartesian unit-circle space. WASD maps directly
   *  to x/y, clamped to the unit circle. No speed correction needed —
   *  the cursor moves at a uniform rate regardless of position. */
  moveCursor(dir, dt) {
    const step = CURSOR_RATE * dt;
    if (dir.left)  this._cursorX -= step;
    if (dir.right) this._cursorX += step;
    if (dir.down)  this._cursorY -= step;
    if (dir.up)    this._cursorY += step;
    // Clamp to unit circle
    const r = Math.sqrt(this._cursorX * this._cursorX + this._cursorY * this._cursorY);
    if (r > 1) {
      this._cursorX /= r;
      this._cursorY /= r;
    }
    // Convert to sky coords and aim the whole array — every dish whose
    // section contains the point follows the cursor.
    const sky = this._cursorToSky();
    if (this.satellite) {
      this.satellite.aimAll(sky.yaw, sky.pitch);
    }
  }

  /** Current cursor position in Cartesian unit-circle coords.
   *  @returns {{x: number, y: number}} */
  get cursorPosition() { return { x: this._cursorX, y: this._cursorY }; }

  /** Set the cursor position directly (used by the evil signal's pull-in
   *  animation). Clamps to the unit circle and aims the dish. */
  setCursorPosition(x, y) {
    this._cursorX = x;
    this._cursorY = y;
    const r = Math.sqrt(x * x + y * y);
    if (r > 1) { this._cursorX /= r; this._cursorY /= r; }
    const sky = this._cursorToSky();
    if (this.satellite) this.satellite.aimAll(sky.yaw, sky.pitch);
  }

  /** Convert Cartesian cursor position to sky coordinates (yaw/pitch).
   *  The disc's centre is the zenith (pitch −π/2), its rim the horizon.
   *  The one conversion lives in DishRig — the same coordinates the
   *  array's coverage sections are measured in. */
  _cursorToSky() {
    return cursorToSky(this._cursorX, this._cursorY);
  }

  /** Check if cursor is hovering over any unresolved signal. */
  _updateHover() {
    if (!this.signalManager) return;
    const sky = this._cursorToSky();
    const signals = this.signalManager.signals;
    let closest = null;
    let closestDist = Infinity;

    for (const sig of signals) {
      if (sig.resolved || sig.opacity <= 0) continue;   // hidden / fully faded out
      // Compute angular distance from cursor (in sky coords) to signal
      const dyaw = sig.yaw - sky.yaw;
      const dpitch = sig.pitch - sky.pitch;
      const dist = Math.sqrt(dyaw * dyaw + dpitch * dpitch);
      if (dist <= sig.tolerance && dist < closestDist) {
        closest = sig;
        closestDist = dist;
      }
    }
    this._hoveredSignal = closest;
  }

  /** Save the currently scanned signal. Marks the signal as resolved and
   *  the drive as saved (green). The quota is NOT incremented here — it is
   *  counted by the drive box dock when the player docks the drive box. */
  saveSignal() {
    const mgr = this.signalManager;
    if (!mgr || !this._hoveredSignal) return;

    mgr.saveSignal(this._hoveredSignal.id);
    this.driveManager?.saveToDrive(this._hoveredSignal.name);
  }

  // ──────────────────────────────────────────────────────────
  // State transitions (private, but exposed for testability)
  // ──────────────────────────────────────────────────────────

  /**
   * Lock or unlock player input. When locked, the player can't look around
   * or move, but physics (gravity, momentum) still applies.
   */
  _setInputLocked(locked) {
    if (!this.gameObject?.scene) return;
    const engine = this.gameObject.scene.userData?.engine;
    if (!engine?.player) return;
    const ctrl = engine.player.getComponent(FirstPersonController);
    if (ctrl) ctrl.inputLocked = locked;
  }

  _enterIdle() {
    this.state = 'idle';
    this._hoveredSignal = null;
    this._setInputLocked(false);
    this.radar?.setWarning?.('');
    // On the screen, the radar stays up while the view leans back out.
    if (this.screenView && this.screen) {
      this.screenView.close();
    }
    this.hud?.setPrompt('');
    // Restore the first-person reticle now that the terminal is closed.
    this.crosshair?.show();
  }

  _enterRadar() {
    this.state = 'radar';
    this._setInputLocked(true);
    // Hide the first-person reticle while the terminal is open — the radar
    // overlay has its own cursor.
    this.crosshair?.hide();
    this.radar?.show();
    // Lean in to the screen the radar is drawn on.
    if (this.screenView && this.screen) this.screenView.open(this.screen, this.radar?.root ?? null);
    this.radar?.setHint('WASD: move cursor | Enter: scan (when a dish is aimed) | Q: exit');
    this.radar?.setInfo('');
    this._hoveredSignal = null;
  }

  // ── Dish pull-in (slew to signal centre before lock-on) ─────────

  /** Start the pull-in animation: the cursor and dish are dragged from
   *  their current position to the signal's centre on the radar disc.
   *  When the animation completes, _enterScanning() fires normally. */
  _startDishPullIn(sig) {
    this._pullStartCursor = { x: this._cursorX, y: this._cursorY };
    this._pullTargetCursor = skyToCursor(sig.yaw, sig.pitch);
    this._pullSignal = sig;
    this._pullTimer = PULL_IN_SECONDS;
    this._pullingIn = true;
  }

  /** Advance the pull-in animation by `dt` seconds.  When the timer
   *  expires, transitions to scanning (lock-on begins). */
  _stepPullIn(dt) {
    if (!this._pullingIn || !this._pullSignal) return;
    this._pullTimer -= dt;
    const t = 1 - Math.max(0, this._pullTimer) / PULL_IN_SECONDS;  // 0→1
    const x = this._pullStartCursor.x + (this._pullTargetCursor.x - this._pullStartCursor.x) * t;
    const y = this._pullStartCursor.y + (this._pullTargetCursor.y - this._pullStartCursor.y) * t;
    this.setCursorPosition(x, y);
    if (this._pullTimer <= 0) {
      this._pullingIn = false;
      const sig = this._pullSignal;
      this._pullSignal = null;
      if (sig) this._enterScanning();
    }
  }

  _enterScanning() {
    this.state = 'scanning';
    if (this.satellite && this._hoveredSignal) {
      this._lockOnTarget = this._hoveredSignal;
      this._lockOnProgress = 0;
      // Randomise the lock-on duration for this attempt (±25% of base).
      this._lockOnDuration = randomiseDuration(LOCK_ON_BASE_SECONDS);
      // Randomise the scan duration for this signal (±25% of base).
      this._hoveredSignal.scanTime = randomiseDuration(this._hoveredSignal.scanTime);
      // Satellite does NOT start scanning yet — lock-on must complete first.
      this.satellite.scanTarget = this._hoveredSignal;
      this.satellite.isScanning = false;
      this.satellite._scanComplete = false;
    }
    this.radar?.setInfo('Locking on… keep dish aimed!');
  }

  /** Called after auto-save — clear hover and close the terminal: the
   *  drive is full, so there is nothing left to scan from this seat. */
  _onSignalResolved() {
    this._hoveredSignal = null;
    this._cleanupState();   // scan is done — release the satellite.
    // Clear the progress bars — exit() returns early so the scanning
    // handler's display update never runs.
    this.radar?.setLockOnProgress?.(0);
    this.radar?.setScanProgress?.(0);
    this.exit();
  }

  /** Clean up any in-progress scan state without transitioning. */
  _cleanupState() {
    this._lockOnTarget = null;
    this._lockOnProgress = 0;
    if (this.satellite) {
      this.satellite.isScanning = false;
      this.satellite.scanTarget = null;
      this.satellite.scanProgress = 0;
      this.satellite._scanComplete = false;
    }
  }

  /** True when a driveManager is wired and its drive was removed during an
   *  active lock-on or scan — the signal must NOT be saved; the process
   *  resets so the player can re-insert and try again. */
  _driveRemovedDuringScan() {
    return this.driveManager && !this.driveManager.driveInserted;
  }

  // ──────────────────────────────────────────────────────────
  // Per-frame update
  // ──────────────────────────────────────────────────────────

  onUpdate(dt) {
    const engine = this.gameObject?.scene?.userData?.engine;
    if (!engine) return;

    // ── IDLE: handled by the Interactable component (onInteract hook) ──
    if (this.state === 'idle') {
      // Drive removed during a background scan or lock-on — stop immediately.
      const backgroundActive = this.satellite?.isScanning || this.satellite?._scanComplete || this._lockOnTarget;
      if (backgroundActive && this._driveRemovedDuringScan()) {
        this._cleanupState();
        if (!this.screen) this._updateRadarDisplay();
        return;
      }
      // Background scan completed while the terminal was closed.
      if (this.satellite?._scanComplete) {
        this._hoveredSignal = this.satellite.scanTarget;
        this.saveSignal();
        this._cleanupState();
        // _cleanupState cleared _scanComplete, so the display condition
        // below won't trigger — update now to reset the bars to 0.
        if (!this.screen) this._updateRadarDisplay();
      }
      // Background lock-on: keep advancing the lock-on progress while the
      // terminal is closed — the dish was already aimed when the player
      // exited, so the lock-on continues on its own.
      if (this._lockOnTarget && this._lockOnProgress < this._lockOnDuration) {
        this._lockOnProgress += dt;
        if (this._lockOnProgress >= this._lockOnDuration && this.satellite) {
          this.satellite.scanTarget = this._lockOnTarget;
          this.satellite.scanProgress = 0;
          this.satellite.isScanning = true;
        }
      }
      // Keep the radar display alive while a background scan or lock-on
      // runs — the overlay stays visible after exit so the player can
      // watch the progress bars from outside the terminal.
      if (this.satellite?.isScanning || this.satellite?._scanComplete || this._lockOnTarget) {
        if (!this.screen) this._updateRadarDisplay();
      }
      return;
    }

    // ── Global: Q exits from any state ──
    if (engine.input.keys['KeyQ']) {
      this.exit();
      return;
    }

    // ── RADAR: cursor movement + hover detection + Enter to scan ──
    if (this.state === 'radar') {
      const keys = engine.input.keys;
      const kb = engine.keyBinds;

      // WASD moves the cursor — unless the evil signal has the dish held
      // (EvilSignal.locked), is pulling the cursor in (EvilSignal.pullingIn),
      // or the terminal's own dish pull-in is running.
      if (!this.evilSignal?.locked && !this.evilSignal?.pullingIn && !this._pullingIn) {
        this.moveCursor({
          left:  !!keys[kb.left],
          right: !!keys[kb.right],
          up:    !!keys[kb.forward] || !!keys[kb.jump],
          down:  !!keys[kb.back]    || !!keys[kb.crouch],
        }, dt);
      }

      // Update hover detection
      this._updateHover();

      // Tell the evil signal what the cursor is on: it scans itself, then
      // either saves to the drive (red) or pins the dish to it for a while.
      this.evilSignal?.hover(this._hoveredSignal?.evil ? this._hoveredSignal : null);

      // Dish pull-in: slew the cursor and dish to the signal's centre
      // before lock-on begins.  Runs before hover/Enter so the cursor
      // arrives and the scanning phase can start on the same frame.
      if (this._pullingIn) {
        this._stepPullIn(dt);
        this._updateHover();
        this.evilSignal?.hover(this._hoveredSignal?.evil ? this._hoveredSignal : null);
        if (!this.screen) this._updateRadarDisplay();
        return;
      }

      // Enter key starts scanning if hovering and a dish of the array is
      // aimed. The evil signal scans itself — Enter ignores it.
      const enterDown = !!engine.input.keys['Enter'] || !!engine.input.keys['NumpadEnter'];
      if (enterDown && !this._enterHeld && !this._pullingIn && this._hoveredSignal && !this._hoveredSignal.evil && this.satellite) {
        // Scanning requires a drive in the reader, and the drive must not
        // already have a signal on it.
        if (this.driveManager && !this.driveManager.driveInserted) {
          this.radar?.flashIndicator?.('drive');
        } else if (this.driveManager?.insertedDriveHasSignal) {
          this.radar?.flashIndicator?.('signal');
        } else {
          const sig = this._hoveredSignal;
          const aimed = this.satellite.isAnyDishAimedAt(sig.yaw, sig.pitch, sig.tolerance);
          if (aimed) {
            this._startDishPullIn(sig);
          } else {
            this.radar?.setInfo('No dish aimed — wait for one to settle');
          }
        }
      }
      this._enterHeld = enterDown;

      // On a screen, the radar is drawn as its picture is painted
      // (paintScreen), not every frame.
      if (!this.screen) this._updateRadarDisplay();
      return;
    }

    // ── SCANNING: two phases — lock-on (dish focuses) then scan ──
    if (this.state === 'scanning') {

      // Drive removed during scanning — reset to radar without saving.
      if (this._driveRemovedDuringScan()) {
        this._cleanupState();
        this.state = 'radar';
        this.radar?.setInfo('Drive removed — insert a drive to scan');
        if (!this.screen) this._updateRadarDisplay();
        return;
      }

      // ── Phase 1: Lock-on ──
      if (this._lockOnTarget && this._lockOnProgress < this._lockOnDuration) {
        const sig = this._lockOnTarget;
        const aimed = this.satellite?.isAnyDishAimedAt(sig.yaw, sig.pitch, sig.tolerance);
        if (!aimed) {
          // Lost aim — back to radar, reset lock-on.
          this._lockOnProgress = 0;
          this._lockOnTarget = null;
          this.state = 'radar';
          this.radar?.setInfo('Lock lost — re-aim the dish!');
          return;
        }
        this._lockOnProgress += dt;
        this.radar?.setLockOnProgress?.(this._lockOnProgress / this._lockOnDuration);
        this.radar?.setScanProgress?.(0);
        if (!this.screen) this._updateRadarDisplay();
        return;
      }

      // ── Lock-on complete → transition to Phase 2 ──
      if (this._lockOnTarget && this._lockOnProgress >= this._lockOnDuration && !this.satellite?.isScanning) {
        this.satellite.scanProgress = 0;
        this.satellite.isScanning = true;
        this.radar?.setInfo('Scanning… keep dish aimed!');
      }

      // ── Phase 2: Scan (accumulation on Satellite, check completion) ──
      if (this.satellite?._scanComplete) {
        this.saveSignal();
        this._onSignalResolved();
        return;
      }

      // Update HUD with scan progress
      if (this.satellite?.scanTarget) {
        const progress = this.satellite.scanProgress / this.satellite.scanTarget.scanTime;
        this.radar?.setScanProgress?.(progress);
      }

      // Lock-on bar stays full during scan phase
      this.radar?.setLockOnProgress?.(1);

      // If satellite stopped scanning (dish drifted), go back to radar
      if (this.satellite && !this.satellite.isScanning && this.satellite.scanProgress < this.satellite.scanTarget?.scanTime) {
        this.state = 'radar';
        this.radar?.setInfo('Signal lost — re-aim the dish!');
      }

      if (!this.screen) this._updateRadarDisplay();
      return;
    }

  }

  /** The computer's screen (ScreenCanvas, #161): the radar drawn, then its
   *  own DOM painted into a 2D canvas — the same leaned in to it or not.
   *  The radar is drawn here only, as often as the screen is repainted, not
   *  every frame. Dark without power. */
  paintScreen(ctx, w, h) {
    if (!this.powered || !this.radar?.root) {
      ctx.fillStyle = '#020304';
      ctx.fillRect(0, 0, w, h);
      return;
    }
    this._updateRadarDisplay();
    paintDom(this.radar.root, ctx, w, h);
  }

  /** Refresh the radar canvas with current state. */
  _updateRadarDisplay() {
    if (!this.radar || !this.signalManager || !this.satellite) return;
    // Game angles, straight from the rig — the model's neck rotation
    // mirrors game yaw (see Satellite), so raw rotations would draw the
    // dish indicator on the wrong side of the disc.
    const dishYaw   = this.satellite.currentYaw ?? 0;
    const dishPitch = this.satellite.currentPitch ?? 0;

    // Compute scan progress for the ring display
    let scanProgress = -1;
    if (this.satellite.isScanning && this.satellite.scanTarget) {
      scanProgress = this.satellite.scanProgress / this.satellite.scanTarget.scanTime;
    }

    // Compute lock-on fraction for the X overlay and bar (0..1, or -1 when
    // inactive).  After exit() auto-completes lock-on, _lockOnTarget is null
    // but the satellite keeps scanning — the bar must stay full in that case
    // so _updateRadarDisplay() doesn't wipe the scanning handler's value.
    let lockOnFraction = -1;
    if (this._lockOnTarget && this._lockOnProgress < this._lockOnDuration) {
      lockOnFraction = this._lockOnProgress / this._lockOnDuration;
    } else if (this._lockOnTarget) {
      lockOnFraction = 1;   // lock-on complete, X stays fully visible
    } else if (this.satellite?.isScanning || this.satellite?._scanComplete) {
      lockOnFraction = 1;   // background scan running — lock-on was completed
    }

    this.radar.update(
      this.signalManager.signals,
      dishYaw,
      dishPitch,
      this._cursorX,
      this._cursorY,
      this._hoveredSignal,
      scanProgress,
      this.satellite.neighbours ?? [],
      this.satellite.rig ?? null,
      lockOnFraction,
      this._lockOnTarget,
    );

    // Telemetry readouts — dish pose, cursor pose, dish state.
    const cursorSky = this._cursorToSky();
    const cursorR   = Math.hypot(this._cursorX, this._cursorY);
    this.radar.setTelemetry?.({
      dishAz:     dishYaw,
      dishEl:     dishPitch,
      dishStatus: this.satellite.isRotating() ? 'SLEWING' : 'LOCKED',
      cursorAz:   cursorSky.yaw,
      cursorEl:   cursorSky.pitch,
      cursorR,
    });

    // Scan progress bar on the right.
    this.radar.setScanProgress?.(scanProgress >= 0 ? scanProgress : 0);

    // Lock-on progress bar (left of the scan bar).
    this.radar.setLockOnProgress?.(lockOnFraction >= 0 ? lockOnFraction : 0);

    // Drive indicator lights (left of the progress bars).
    // setDriveIndicators returns true on each flash phase transition,
    // so the caller can play a beep in sync with each blink.
    const flashBeep = this.radar.setDriveIndicators?.(
      this.driveManager?.driveInserted ?? false,
      this.driveManager?.insertedDriveHasSignal ?? false,
    );
    if (flashBeep) this._playScanBlockedBeep();

    // Parking the cursor on the UFO's blob reads it out.
    const onThreat = this.radar.threatAt?.(this._cursorX, this._cursorY) ?? false;
    this.radar.setWarning?.(onThreat ? ANOMALY_WARNING : '');
  }

  // ── Audio feedback for blocked scans ────────────────────────

  /** Play a short beep pitched up from the scanner-alert asset.
   *  Called once per flash phase transition so the player hears a beep
   *  each time the indicator light blinks red. */
  _playScanBlockedBeep() {
    if (!this._beepSound) this._beepSound = this._buildBeepSound();
    const s = this._beepSound;
    if (!s) return;
    if (s.isPlaying) s.stop();
    s.setDetune(500);
    s.setVolume(0.4);
    s.play();
  }

  /** Build a non-positional Audio from the scanner-alert buffer. */
  _buildBeepSound() {
    const engine = this.gameObject?.scene?.userData?.engine;
    if (!engine?.audioListener || !engine.assets?.has?.(SCANNER_ALERT.key)) return null;
    const audio = new THREE.Audio(engine.audioListener);
    audio.setBuffer(engine.assets.get(SCANNER_ALERT.key));
    return audio;
  }

  onDestroy() {
    if (this._beepSound) {
      if (this._beepSound.isPlaying) this._beepSound.stop();
      try { this._beepSound.disconnect?.(); } catch (_) { /* not connected */ }
      this._beepSound = null;
    }
  }
}

/** Create a ready-to-attach Interactable that delegates to a ComputerTerminal.
 *  Call this from OfficeScene to wire the computer model. */
export function createComputerInteractable(terminal) {
  const interact = new class extends Interactable {
    promptLabel = terminal.powered ? terminal.promptLabel : NO_POWER_LABEL;
    interactRange = terminal.interactRange;
    onInteract() { terminal.enter(); }
  }();
  terminal._interactable = interact;
  return interact;
}
