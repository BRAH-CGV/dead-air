import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// GameController  –  Top-level game state machine (Component)
// ─────────────────────────────────────────────
// Orchestrates the signal-collection gameplay loop. Drives the night
// clock, updates the HUD, and manages night transitions.
//
// State: 'idle' | 'playing' | 'nightComplete' | 'gameOver'
//
// External references (set by OfficeScene during wiring):
//   nightClock, signalManager, satellite, terminal, hud
// ─────────────────────────────────────────────

export class GameController extends Component {
  /** @type {'idle'|'playing'|'nightComplete'|'gameOver'} */
  state = 'idle';

  /** Current night number (1-based). */
  nightNumber = 0;

  // ── External references ──
  /** @type {import('./NightClock.js').NightClock|null} */
  nightClock = null;
  /** @type {import('./SignalManager.js').SignalManager|null} */
  signalManager = null;
  /** @type {import('../gameobjects/Satellite.js').Satellite|null} */
  satellite = null;
  /** @type {import('../components/ComputerTerminal.js').ComputerTerminal|null} */
  terminal = null;
  /** @type {import('../ui/HUD.js').HUD|null} */
  hud = null;

  /** Whether to auto-start the first night on first update. */
  autoStart = true;

  // ──────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────

  /** Begin a new night. Resets clock and signals. */
  startNight(nightNumber) {
    this.nightNumber = nightNumber;
    this.state = 'playing';

    this.nightClock?.reset();
    this.signalManager?.startNight(nightNumber);

    this.hud?.show();
    this.hud?.setNight(nightNumber);
    this.hud?.setSignals(0, this.signalManager?.required ?? 0);
    this.hud?.setTime(this.nightClock?.timeString ?? '12:00 AM');
    this.hud?.setScanProgress(-1);
    this.hud?.setPrompt('');
  }

  /** Called when a signal is saved by the terminal. */
  onSignalSaved() {
    this._updateHUD();
    if (this.signalManager?.isComplete()) {
      this._nightComplete();
    }
  }

  /** Called when a signal is deleted by the terminal. */
  onSignalDeleted() {
    this._updateHUD();
  }

  /** Retry the current night (from gameOver). */
  retryNight() {
    if (this.state !== 'gameOver') return;
    this.startNight(this.nightNumber);
  }

  /** Advance to the next night (from nightComplete). */
  nextNight() {
    if (this.state !== 'nightComplete') return;
    this.startNight(this.nightNumber + 1);
  }

  // ──────────────────────────────────────────────────────────
  // Component lifecycle
  // ──────────────────────────────────────────────────────────

  onUpdate(dt) {
    // Auto-start on first tick
    if (this.state === 'idle' && this.autoStart) {
      this.startNight(1);
      return;
    }

    if (this.state !== 'playing') return;

    // Advance the clock
    this.nightClock?.update(dt);

    // Check night end
    if (this.nightClock?.finished) {
      if (!this.signalManager?.isComplete()) {
        this._gameOver();
      }
    }

    // Update HUD every frame
    this._updateHUD();
  }

  // ──────────────────────────────────────────────────────────
  // Private
  // ──────────────────────────────────────────────────────────

  _updateHUD() {
    if (!this.hud) return;
    this.hud.setTime(this.nightClock?.timeString ?? '12:00 AM');

    const progress = this.signalManager?.getProgress();
    if (progress) {
      this.hud.setSignals(progress.saved, progress.required);
    }

    // Scan bar
    if (this.satellite?.isScanning && this.signalManager?.active) {
      const sig = this.signalManager.active;
      this.hud.setScanProgress(this.satellite.scanProgress / sig.scanTime);
    } else {
      this.hud.setScanProgress(-1);
    }
  }

  _nightComplete() {
    this.state = 'nightComplete';
    this.nightClock?.pause();
    this.hud?.setPrompt(`Night ${this.nightNumber} complete! [E] to continue`);
    this.hud?.setScanProgress(-1);
  }

  _gameOver() {
    this.state = 'gameOver';
    this.nightClock?.pause();
    this.hud?.setPrompt('Night failed. [E] to retry');
    this.hud?.setScanProgress(-1);
  }
}
