import { Component } from '../core/Component.js';
import { Interactable } from './Interactable.js';
import { FirstPersonController } from './FirstPersonController.js';
import { DISH_SLEW_RATE } from '../gameobjects/Satellite.js';
import { cursorToSky } from '../gameobjects/DishRig.js';

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
//   satellite, signalManager, hud, radar, reviewPanel
// ─────────────────────────────────────────────

/** @readonly */
// Cursor movement rate in Cartesian units per second (unit-circle space).
// Paced to the dish: the radius is 90° of sky (zenith to horizon), so the
// cursor sweeps DISH_SLEW_RATE (22.5°/s) — 1/4 unit/s, the full radius in
// 4 s. Any faster and the dish falls further behind the longer a key is
// held. One 60 fps frame moves 0.375° of sky, so a tap can stop inside a
// signal's 12° acceptance.
const CURSOR_RATE = DISH_SLEW_RATE / (Math.PI / 2);

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
  /** @type {import('../ui/HUD.js').SignalReviewPanel|null} */
  reviewPanel = null;
  /** @type {import('../ui/Crosshair.js').Crosshair|null} */
  crosshair = null;

  /** @type {number|null} ID of the currently hovered signal */
  _hoveredSignal = null;

  /** Cursor position in Cartesian unit-circle coords: x -1..+1 (left..right),
   *  y -1..+1 (down..up). The disc's centre (0, 0) is the zenith and its rim
   *  the horizon — straight down from the centre is the horizon out of the
   *  window. Clamped to the unit circle so the cursor stays in the radar. */
  _cursorX = 0;
  _cursorY = 0;

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

  /** Enter the terminal (called when the player interacts with the computer). */
  enter() {
    if (this.state !== 'idle') return;
    this._enterRadar();
  }

  /** Exit the terminal back to IDLE (Q key). */
  exit() {
    if (this.state === 'idle') return;
    // If in review without a choice, leave signal scanned but unresolved.
    if (this.state === 'review') {
      this.reviewPanel?.hide();
    }
    this._cleanupState();
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

  /** Save the currently reviewed signal. */
  saveSignal() {
    if (this.state !== 'review') return;
    const mgr = this.signalManager;
    if (!mgr || !this._hoveredSignal) return;

    mgr.saveSignal(this._hoveredSignal.id);
    this._onSignalResolved();
  }

  /** Delete the currently reviewed signal. */
  deleteSignal() {
    if (this.state !== 'review') return;
    const mgr = this.signalManager;
    if (!mgr || !this._hoveredSignal) return;

    mgr.deleteSignal(this._hoveredSignal.id);
    this._onSignalResolved();
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
    this.radar?.hide();
    this.reviewPanel?.hide();
    this.hud?.setScanProgress(-1);
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
    this.radar?.setHint('WASD: move cursor | Enter: scan (when a dish is aimed) | Q: exit');
    this.radar?.setInfo('');
    this._hoveredSignal = null;
    // Check if a scan completed while terminal was closed
    if (this.satellite?._scanComplete) {
      this._enterReview();
    }
  }

  _enterScanning() {
    this.state = 'scanning';
    if (this.satellite && this._hoveredSignal) {
      // Only reset progress if this is a different target than what we had
      if (this.satellite.scanTarget !== this._hoveredSignal) {
        this.satellite.scanProgress = 0;
      }
      this.satellite.scanTarget = this._hoveredSignal;
      this.satellite.isScanning = true;
      this.satellite._scanComplete = false;
    }
    this.radar?.setInfo('Scanning… keep dish aimed!');
  }

  _enterReview() {
    this.state = 'review';
    if (this.satellite) {
      this.satellite.isScanning = false;
      this.satellite.scanTarget = null;
      this.satellite.scanProgress = 0;
      this.satellite._scanComplete = false;
    }
    this.radar?.hide();
    this.hud?.setScanProgress(-1);

    const sig = this._hoveredSignal;
    if (sig) {
      this.signalManager?.markScanned(sig.id);
      this.reviewPanel?.show(sig.payloadUrl);
    }
    this.radar?.setInfo('');
  }

  /** Called after save or delete in REVIEW — return to RADAR. */
  _onSignalResolved() {
    this.reviewPanel?.hide();
    this._hoveredSignal = null;
    this._enterRadar();
  }

  /** Clean up any in-progress scan state without transitioning. */
  _cleanupState() {
    if (this.satellite) {
      this.satellite.isScanning = false;
      this.satellite.scanTarget = null;
      this.satellite.scanProgress = 0;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Per-frame update
  // ──────────────────────────────────────────────────────────

  onUpdate(dt) {
    const engine = this.gameObject?.scene?.userData?.engine;
    if (!engine) return;

    // ── IDLE: handled by the Interactable component (onInteract hook) ──
    if (this.state === 'idle') return;

    // ── Global: Q exits from any state ──
    if (engine.input.keys['KeyQ']) {
      this.exit();
      return;
    }

    // ── RADAR: cursor movement + hover detection + Enter to scan ──
    if (this.state === 'radar') {
      const keys = engine.input.keys;
      const kb = engine.keyBinds;

      // WASD moves the cursor
      this.moveCursor({
        left:  !!keys[kb.left],
        right: !!keys[kb.right],
        up:    !!keys[kb.forward] || !!keys[kb.jump],
        down:  !!keys[kb.back]    || !!keys[kb.crouch],
      }, dt);

      // Update hover detection
      this._updateHover();

      // Enter key starts scanning if hovering and a dish of the array is aimed
      const enterDown = !!engine.input.keys['Enter'] || !!engine.input.keys['NumpadEnter'];
      if (enterDown && !this._enterHeld && this._hoveredSignal && this.satellite) {
        const sig = this._hoveredSignal;
        const aimed = this.satellite.isAnyDishAimedAt(sig.yaw, sig.pitch, sig.tolerance);
        if (aimed) {
          this._enterScanning();
        } else {
          this.radar?.setInfo('No dish aimed — wait for one to settle');
        }
      }
      this._enterHeld = enterDown;

      // Update radar display
      this._updateRadarDisplay();
      return;
    }

    // ── SCANNING: background scan on Satellite, just check for completion ──
    if (this.state === 'scanning') {
      // Scan accumulation happens in Satellite._update (background)
      // Just check if scan completed
      if (this.satellite?._scanComplete) {
        this._enterReview();
        return;
      }

      // Update HUD with scan progress
      if (this.satellite?.scanTarget) {
        const progress = this.satellite.scanProgress / this.satellite.scanTarget.scanTime;
        this.hud?.setScanProgress(progress);
      }

      // If satellite stopped scanning (dish drifted), go back to radar
      if (this.satellite && !this.satellite.isScanning && this.satellite.scanProgress < this.satellite.scanTarget?.scanTime) {
        this.state = 'radar';
        this.radar?.setInfo('Signal lost — re-aim the dish!');
      }

      this._updateRadarDisplay();
      return;
    }

    // ── REVIEW: handled by SignalReviewPanel callbacks ──
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
    );
  }
}

/** Create a ready-to-attach Interactable that delegates to a ComputerTerminal.
 *  Call this from OfficeScene to wire the computer model. */
export function createComputerInteractable(terminal) {
  const interact = new class extends Interactable {
    promptLabel = terminal.promptLabel;
    interactRange = terminal.interactRange;
    onInteract() { terminal.enter(); }
  }();
  return interact;
}
