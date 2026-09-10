import { Component } from '../core/Component.js';
import { Interactable } from './Interactable.js';
import { FirstPersonController } from './FirstPersonController.js';

// ─────────────────────────────────────────────
// ComputerTerminal  –  Component (attach to the retro-computer)
// ─────────────────────────────────────────────
// Drives the signal-collection gameplay from the computer desk.
//
// State machine:
//   IDLE → RADAR → AIMING → SCANNING → REVIEW → RADAR → …
//
// While active, the player's movement is frozen (FirstPersonController
// disabled) and WASD steers the satellite dish instead.
//
// External references (set by OfficeScene during wiring):
//   satellite, signalManager, hud, radar, reviewPanel
// ─────────────────────────────────────────────

/** @readonly */
// Matches Satellite.maxRotationSpeed so the steered target never outruns
// the dish — held keys move both in sync, taps give fine control inside
// the scan tolerance.
const STEER_RATE = Math.PI / 8;  // rad/s — dish steering speed from keyboard

export class ComputerTerminal extends Component {
  // ── State ─────────────────────────────────────────────────
  /** 'idle' | 'radar' | 'aiming' | 'scanning' | 'review' */
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

  /** @type {number|null} ID of the currently selected signal */
  _selectedId = null;

  /** Edge-trigger for the interact key (prevent re-entry while held). */
  _interactHeld = false;
  /** Edge-trigger for Tab. */
  _tabHeld = false;

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

  /** Exit the terminal back to IDLE (Escape / E). */
  exit() {
    if (this.state === 'idle') return;
    // If in review without a choice, leave signal scanned but unresolved.
    if (this.state === 'review') {
      this.reviewPanel?.hide();
    }
    this._cleanupState();
    this._enterIdle();
  }

  /** Cycle to the next unresolved signal. */
  selectNextSignal() {
    if (this.state !== 'radar' && this.state !== 'aiming') return;
    const mgr = this.signalManager;
    if (!mgr) return;

    const unresolved = mgr.signals.filter(s => !s.resolved);
    if (unresolved.length === 0) {
      this._selectedId = null;
      mgr.selectSignal(null);
      return;
    }

    // Find the next unresolved signal after the current selection.
    const curIdx = unresolved.findIndex(s => s.id === this._selectedId);
    const nextIdx = (curIdx + 1) % unresolved.length;
    const next = unresolved[nextIdx];

    this._selectedId = next.id;
    mgr.selectSignal(next.id);
    this._enterAiming();
  }

  /** Select a specific signal by ID (e.g. from number key 1-5). */
  selectSignalById(id) {
    if (this.state !== 'radar' && this.state !== 'aiming') return;
    const mgr = this.signalManager;
    if (!mgr) return;

    const sig = mgr.signals.find(s => s.id === id && !s.resolved);
    if (!sig) return;

    this._selectedId = sig.id;
    mgr.selectSignal(sig.id);
    this._enterAiming();
  }

  /** Steer the dish in a direction. Called each frame in AIMING.
   *  Pitch clamps to the sky hemisphere: horizon (0) to zenith (-π/2).
   *  @param {{ left: boolean, right: boolean, up: boolean, down: boolean }} dir
   *  @param {number} dt  seconds */
  steerDish(dir, dt) {
    if (!this.satellite) return;
    const step = STEER_RATE * dt;
    if (dir.left)  this.satellite.targetYaw -= step;
    if (dir.right) this.satellite.targetYaw += step;
    if (dir.up)    this.satellite.targetPitch -= step;
    if (dir.down)  this.satellite.targetPitch += step;
    this.satellite.targetPitch = Math.min(0, Math.max(-Math.PI / 2, this.satellite.targetPitch));
  }

  /** Save the currently reviewed signal. */
  saveSignal() {
    if (this.state !== 'review') return;
    const mgr = this.signalManager;
    if (!mgr || !this._selectedId) return;

    mgr.saveSignal(this._selectedId);
    this._onSignalResolved();
  }

  /** Delete the currently reviewed signal. */
  deleteSignal() {
    if (this.state !== 'review') return;
    const mgr = this.signalManager;
    if (!mgr || !this._selectedId) return;

    mgr.deleteSignal(this._selectedId);
    this._onSignalResolved();
  }

  // ──────────────────────────────────────────────────────────
  // State transitions (private, but exposed for testability)
  // ──────────────────────────────────────────────────────────

  _enterIdle() {
    this.state = 'idle';
    this._selectedId = null;
    this.signalManager?.selectSignal(null);
    this._freezePlayer(false);
    this.radar?.hide();
    this.reviewPanel?.hide();
    this.hud?.setScanProgress(-1);
    this.hud?.setPrompt('');
  }

  _enterRadar() {
    this.state = 'radar';
    this._freezePlayer(true);
    this.radar?.show();
    this.radar?.setHint('Tab: cycle signals  |  1-5: select  |  ESC: exit');
    this.radar?.setInfo('');
    this._selectedId = null;
    this.signalManager?.selectSignal(null);
    // Reset scan state on the satellite.
    if (this.satellite) {
      this.satellite.scanProgress = 0;
      this.satellite.scanTarget = null;
      this.satellite.isScanning = false;
    }
  }

  _enterAiming() {
    this.state = 'aiming';
    const sig = this.signalManager?.active;
    if (!sig || !this.satellite) return;

    // Reset scan progress for this new target.
    this.satellite.scanProgress = 0;
    this.satellite.scanTarget = sig;
    this.satellite.isScanning = false;

    this.radar?.setInfo(`Signal #${sig.id} — aim the dish toward the blip`);
    this.radar?.setHint('A/D: sweep | W/S: elevate | ESC: exit');
    this.hud?.setScanProgress(0);
  }

  _enterScanning() {
    this.state = 'scanning';
    if (this.satellite) this.satellite.isScanning = true;
    this.radar?.setInfo('Scanning… keep the dish aimed!');
  }

  _enterReview() {
    this.state = 'review';
    if (this.satellite) {
      this.satellite.isScanning = false;
      this.satellite.scanTarget = null;
      this.satellite.scanProgress = 0;
    }
    this.radar?.hide();
    this.hud?.setScanProgress(-1);

    const sig = this.signalManager?.active;
    if (sig) {
      this.signalManager?.markScanned(sig.id);
      this.reviewPanel?.show(sig.payloadUrl);
    }
    this.radar?.setInfo('');
  }

  /** Called after save or delete in REVIEW — return to RADAR. */
  _onSignalResolved() {
    this.reviewPanel?.hide();
    this._selectedId = null;
    this.signalManager?.selectSignal(null);
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
  // Player freeze (same pattern as DebugCamera)
  // ──────────────────────────────────────────────────────────

  _freezePlayer(frozen) {
    if (!this.gameObject?.scene) return;
    const engine = this.gameObject.scene.userData?.engine;
    if (!engine?.player) return;

    const ctrl = engine.player.getComponent(FirstPersonController);
    if (ctrl) ctrl.enabled = !frozen;
  }

  // ──────────────────────────────────────────────────────────
  // Per-frame update
  // ──────────────────────────────────────────────────────────

  onUpdate(dt) {
    const engine = this.gameObject?.scene?.userData?.engine;
    if (!engine) return;

    // ── IDLE: handled by the Interactable component (onInteract hook) ──
    if (this.state === 'idle') return;

    // ── Global: ESC exits from any state ──
    if (engine.input.keys['Escape']) {
      this.exit();
      return;
    }

    // ── RADAR: signal selection ──
    if (this.state === 'radar') {
      // Tab cycles signals
      const tabDown = !!engine.input.keys['Tab'];
      if (tabDown && !this._tabHeld) {
        this.selectNextSignal();
      }
      this._tabHeld = tabDown;

      // Number keys 1-9 select specific signals
      for (let i = 1; i <= 9; i++) {
        if (engine.input.keys[`Digit${i}`]) {
          this.selectSignalById(i);
          break;
        }
      }

      // Update radar display
      this._updateRadarDisplay();
      return;
    }

    // ── AIMING: dish steering + scan check ──
    if (this.state === 'aiming') {
      const keys = engine.input.keys;
      const kb = engine.keyBinds;

      // WASD steers the dish (A/D yaw, W/S pitch). Space/C as alternative
      // vertical.  Single steerDish call so no axis is double-counted.
      this.steerDish({
        left:  !!keys[kb.left],
        right: !!keys[kb.right],
        up:    !!keys[kb.forward] || !!keys[kb.jump],
        down:  !!keys[kb.back]    || !!keys[kb.crouch],
      }, dt);

      // Check if aimed at the active signal
      const sig = this.signalManager?.active;
      if (sig && this.satellite) {
        const aimed = this.satellite.isAimedAt(sig.yaw, sig.pitch, sig.tolerance);
        if (aimed) {
          this._enterScanning();
        }
      }

      this._updateRadarDisplay();
      return;
    }

    // ── SCANNING: progress accumulation ──
    if (this.state === 'scanning') {
      const sig = this.signalManager?.active;
      if (sig && this.satellite) {
        const aimed = this.satellite.isAimedAt(sig.yaw, sig.pitch, sig.tolerance);
        if (aimed) {
          this.satellite.scanProgress += dt;
          this.hud?.setScanProgress(this.satellite.scanProgress / sig.scanTime);

          if (this.satellite.scanProgress >= sig.scanTime) {
            this._enterReview();
            return;
          }
        } else {
          // Dish drifted — pause scanning (don't reset)
          this.satellite.isScanning = false;
          this.state = 'aiming';
          this.radar?.setInfo('Signal lost — re-aim the dish!');
        }
      }

      this._updateRadarDisplay();
      return;
    }

    // ── REVIEW: handled by SignalReviewPanel callbacks ──
  }

  /** Refresh the radar canvas with current state. */
  _updateRadarDisplay() {
    if (!this.radar || !this.signalManager || !this.satellite) return;
    const dishYaw   = this.satellite.neck?.object3d?.rotation?.y ?? 0;
    const dishPitch = this.satellite.dish?.object3d?.rotation?.x ?? 0;
    // The slew target rides along so the radar can show where the dish is
    // heading while it lags behind steering.
    this.radar.update(
      this.signalManager.signals,
      dishYaw,
      dishPitch,
      this._selectedId,
      this.satellite.targetYaw,
      this.satellite.targetPitch,
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
