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
//      └──fail(reason)─────────▶ gameOver   (a threat caught the player)
//
// nap(hours) jumps the shift's clock; a nap through 6 AM ends the shift
// there and then, on the same quota check.
//
// Meeting the quota early doesn't end the shift: the player still has to
// hold out until 6 AM. From night 3 a saved signal only counts once it is
// stored at the server console (SignalManager storage): the quota is met by
// onSignalsStored, and a full terminal says where to go.
//
// The day is for sleeping — the Sun drowns the faint signals and heats up
// the dust storms — so nothing happens in the morning until the player goes
// to bed.
//
// State: 'idle' | 'playing' | 'morning' | 'gameOver' | 'finished'
//
// External references (set by the scene during wiring):
//   nightClock, signalManager, satellite, terminal, hud
// and the night counter through bindNights(nights).
// ─────────────────────────────────────────────

const PROMPT = {
  quotaMet: 'Quota met — hold out until 6:00 AM',
  storageFull: 'Terminal full — store signals at the server console',
  morning:  'Shift over — get some sleep (bedroom)',
  failed:   'Night failed. [E] to retry',
  finished: 'You made it through every shift.',
};

export class GameController extends Component {
  /** @type {'idle'|'playing'|'morning'|'gameOver'|'finished'} */
  state = 'idle';

  /** Current night number (1-based). */
  nightNumber = 0;

  /** Why the night failed, when a threat ended it (fail()); null for a
   *  missed quota, and cleared when a night starts. The failed screen can
   *  show it. @type {string|null} */
  failReason = null;

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

  /** Whether to auto-start the first night on first update. */
  autoStart = true;

  // ──────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────

  /** Begin a new night. Resets clock and signals. */
  startNight(nightNumber) {
    this.nightNumber = nightNumber;
    this.state = 'playing';
    this.failReason = null;

    this.nightClock?.reset();
    this.signalManager?.startNight(nightNumber);

    this.hud?.show();
    this.hud?.setNight(nightNumber);
    this.hud?.setSignals(0, this.signalManager?.required ?? 0);
    this.hud?.setTime(this.nightClock?.timeString ?? '12:00 AM');
    this.hud?.setScanProgress(-1);
    this.hud?.setPrompt('');
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

  /** Called when a signal is saved by the terminal. */
  onSignalSaved() {
    this._updateHUD();
    if (this.state !== 'playing') return;
    if (this.signalManager?.isComplete()) this.hud?.setPrompt(PROMPT.quotaMet);
    else if (this.signalManager?.canSave() === false) this.hud?.setPrompt(PROMPT.storageFull);
  }

  /** Called when the server console stores the waiting signals (night 3
   *  on) — the moment they start to count. */
  onSignalsStored() {
    this._updateHUD();
    if (this.state !== 'playing') return;
    this.hud?.setPrompt(this.signalManager?.isComplete() ? PROMPT.quotaMet : '');
  }

  /** Called when a signal is deleted by the terminal. */
  onSignalDeleted() {
    this._updateHUD();
  }

  /** End the night early: a threat caught the player. Only a running shift
   *  can fail — from any other state this does nothing, so a threat that
   *  fires after 6 AM, or twice in one frame, can't kill.
   *  @param {string} reason  One sentence, shown before the retry key. */
  fail(reason) {
    if (this.state !== 'playing') return;
    this.failReason = reason;
    this._endShift('gameOver', `${reason} [E] to retry`);
  }

  /** Retry the current night (from gameOver). */
  retryNight() {
    if (this.state !== 'gameOver') return;
    this.startNight(this.nightNumber);
  }

  /** Sleep `hours` of the shift away (a nap on the bunk). Only during the
   *  shift. Waking at or past 6 AM ends it at once, on the quota.
   *  @returns {boolean} whether the player napped */
  nap(hours) {
    if (this.state !== 'playing') return false;
    this.nightClock?.advanceHours(hours);
    this._updateHUD();
    this._checkShiftEnd();
    return true;
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
      this.retryNight();
      return;
    }

    if (this.state !== 'playing') return;

    // Advance the clock
    this.nightClock?.update(dt);

    // Update HUD every frame
    this._updateHUD();
    this._checkShiftEnd();
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

    const progress = this.signalManager?.getProgress();
    if (progress) {
      this.hud.setSignals(progress.counted, progress.required, progress.pending);
    }

    // Scan bar — driven by satellite state (works even when terminal is closed)
    if (this.satellite?.isScanning && this.satellite?.scanTarget) {
      this.hud.setScanProgress(this.satellite.scanProgress / this.satellite.scanTarget.scanTime);
    } else if (!this.satellite?.isScanning) {
      this.hud.setScanProgress(-1);
    }
  }

  /** 6 AM: morning with the quota met, a failed night without it. */
  _checkShiftEnd() {
    if (!this.nightClock?.finished) return;
    if (this.signalManager?.isComplete()) this._morning();
    else this._gameOver();
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
