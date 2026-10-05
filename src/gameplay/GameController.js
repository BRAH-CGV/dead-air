import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// GameController  –  Top-level game state machine (Component)
// ─────────────────────────────────────────────
// Orchestrates the signal-collection gameplay loop. Drives the night
// clock, updates the HUD, and runs the day around the shift:
//
//   playing ──6 AM, quota met──▶ morning ──sleep()──▶ playing (next night)
//      │                            └──sleep() on the last night──▶ finished
//      ├──6 AM, quota missed──▶ gameOver ──[E] / retryNight()──▶ playing
//      └──fail() (a threat got the player)──▶ gameOver
//
// Meeting the quota early doesn't end the shift: the player still has to
// hold out until 6 AM. The day is for sleeping — the Sun drowns the faint
// signals and heats up the dust storms — so nothing happens in the morning
// until the player goes to bed.
//
// State: 'idle' | 'playing' | 'morning' | 'gameOver' | 'finished'
//
// External references (set by the scene during wiring):
//   nightClock, signalManager, satellite, terminal, hud, quotaBox
// and the night counter through bindNights(nights).
// ─────────────────────────────────────────────

const PROMPT = {
  quotaMet: 'Quota met — hold out until 6:00 AM',
  morning:  'Shift over — get some sleep (bedroom)',
  failed:   'Night failed. [E] to retry',
  finished: 'You made it through every shift.',
};

export class GameController extends Component {
  /** @type {'idle'|'playing'|'morning'|'gameOver'|'finished'} */
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
  /** Which night it is — set through bindNights().
   *  @type {import('../systems/NightManager.js').NightManager|null} */
  nights = null;
  /** The quota box — counts drives deposited for the night.
   *  @type {import('./QuotaBox.js').QuotaBox|null} */
  quotaBox = null;

  /** Called at the start of each night (for drive reset, etc.).
   *  @type {(() => void)|null} */
  onNightStart = null;

  /** Whether to auto-start the first night on first update. */
  autoStart = true;

  /** @type {Set<(night: number) => void>} */
  _nightStartListeners = new Set();

  // ──────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────

  /** Begin a new night. Resets clock and signals.
   *  @param {number} nightNumber
   *  @param {{ retry?: boolean }} [opts]  A retry of the same night after a
   *         game over — listeners put the player back at the start. */
  startNight(nightNumber, { retry = false } = {}) {
    this.nightNumber = nightNumber;
    this.state = 'playing';

    this.nightClock?.reset();
    this.signalManager?.startNight(nightNumber);

    // Sync quota box required count with the signal manager's night requirement.
    // signalManager.required is computed by startNight(), so we sync AFTER it runs.
    if (this.quotaBox && this.signalManager) {
      this.quotaBox.requiredCount = this.signalManager.required;
    }

    // Notify the scene (if it registered a callback) so it can reset drives, etc.
    this.onNightStart?.();

    this.hud?.show();
    this.hud?.setNight(nightNumber);
    this.hud?.setSignals(
      this.quotaBox?.collectedCount ?? 0,
      this.quotaBox?.requiredCount ?? this.signalManager?.required ?? 0,
    );
    this.hud?.setTime(this.nightClock?.timeString ?? '12:00 AM');
    this.hud?.setScanProgress(-1);
    this.hud?.setPrompt('');

    for (const fn of this._nightStartListeners) fn(nightNumber, { retry });
  }

  /** Hear about every night that starts — a new night, a skip or a retry.
   *  Threats reschedule here; a retry also respawns the player.
   *  @param {(night: number, info: { retry: boolean }) => void} fn
   *  @returns {() => void} unsubscribe */
  onNightStart(fn) {
    this._nightStartListeners.add(fn);
    return () => this._nightStartListeners.delete(fn);
  }

  /** Something killed the player: end the shift as a game over, with its
   *  own prompt. Only a shift in progress can be failed.
   *  @param {string} [prompt] */
  fail(prompt = PROMPT.failed) {
    if (this.state !== 'playing') return;
    this._endShift('gameOver', prompt);
  }

  /** Follow a NightManager: start the night it is on now, and every night
   *  it moves to after — sleeping, or the debug key. One night number for
   *  the whole scene.
   *  @param {import('../systems/NightManager.js').NightManager} nights
   *  @returns {() => void} unsubscribe */
  bindNights(nights) {
    this._offNights?.();
    this.nights = nights;
    this._offNights = nights.onChange(night => this.startNight(night));
    this.startNight(nights.currentNight);
    return () => {
      this._offNights?.();
      this._offNights = null;
    };
  }

  /** Called when a signal is saved by the terminal. Scanning no longer
   *  affects the quota directly — the QuotaBox counts deposited drives.
   *  Kept for backward compatibility (HUD refresh). */
  onSignalSaved() {
    this._updateHUD();
    if (this.state === 'playing' && this.quotaBox?.isQuotaMet()) {
      this.hud?.setPrompt(PROMPT.quotaMet);
    }
  }

  /** Called when a signal is deleted by the terminal. */
  onSignalDeleted() {
    this._updateHUD();
  }

  /** Retry the current night (from gameOver). */
  retryNight() {
    if (this.state !== 'gameOver') return;
    this.startNight(this.nightNumber, { retry: true });
  }

  /** Go to bed. Only the morning after a successful shift: moves to the next
   *  night, or ends the run after the last one.
   *  @returns {boolean} whether the player slept */
  sleep() {
    if (this.state !== 'morning') return false;
    if (this.nights?.isLastNight()) {
      this._finish();
    } else if (this.nights) {
      this.nights.advance();              // the bound listener starts the night
    } else {
      this.startNight(this.nightNumber + 1);
    }
    return true;
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

    if (this.state === 'gameOver' && this._interactPressed()) {
      // This press is the retry's alone: left live, the interaction system
      // would also use whatever the player died looking at (the generator's
      // switch, which turned the freshly restored power straight off).
      this.scene?.userData?.engine?.consumeAction?.('interact');
      this.retryNight();
      return;
    }

    if (this.state !== 'playing') return;

    // Advance the clock
    this.nightClock?.update(dt);

    // Signals appear on their own schedule through the night
    this.signalManager?.update(dt, this.nightClock);

    // Update HUD every frame
    this._updateHUD();

    // Check shift end — quota is counted by the QuotaBox (drives deposited),
    // not by signals scanned.
    if (this.nightClock?.finished) {
      if (this.quotaBox?.isQuotaMet()) this._morning();
      else this._gameOver();
    }
  }

  onDestroy() {
    this._offNights?.();
    this._offNights = null;
  }

  // ──────────────────────────────────────────────────────────
  // Private
  // ──────────────────────────────────────────────────────────

  /** The interact key's one-frame press, if a scene engine is reachable. */
  _interactPressed() {
    const engine = this.scene?.userData?.engine;
    if (!engine) return false;
    return !!engine.input?.pressed?.[engine.keyBinds?.interact];
  }

  _updateHUD() {
    if (!this.hud) return;
    this.hud.setTime(this.nightClock?.timeString ?? '12:00 AM');

    // Quota progress comes from the QuotaBox (deposited drives), falling
    // back to the signal manager's required count for the denominator.
    const collected = this.quotaBox?.collectedCount ?? 0;
    const required  = this.quotaBox?.requiredCount ?? this.signalManager?.required ?? 0;
    this.hud.setSignals(collected, required);

    // Scan bar — driven by satellite state (works even when terminal is closed)
    if (this.satellite?.isScanning && this.satellite?.scanTarget) {
      this.hud.setScanProgress(this.satellite.scanProgress / this.satellite.scanTarget.scanTime);
    } else if (!this.satellite?.isScanning) {
      this.hud.setScanProgress(-1);
    }
  }

  _endShift(state, prompt) {
    this.state = state;
    this.nightClock?.pause();
    this.hud?.setPrompt(prompt);
    this.hud?.setScanProgress(-1);
  }

  _morning()  { this._endShift('morning',  PROMPT.morning); }
  _gameOver() { this._endShift('gameOver', PROMPT.failed); }
  _finish()   { this._endShift('finished', PROMPT.finished); }
}
