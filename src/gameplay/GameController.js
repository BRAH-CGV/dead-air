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
// One twelve-hour shift, 6 PM to 6 AM. Meeting the quota early doesn't end
// it: the player still has to hold out until 6 AM. The day is for sleeping — the Sun drowns the faint
// signals and heats up the dust storms — so nothing happens in the morning
// until the player goes to bed.
//
// With a cargo bay wired (the buggy's boot, a second DriveBoxDock), the
// morning has one job first: carry the night's drive box out to the buggy,
// load it (`delivered`: the boot holds a box with the night's quota in it)
// and send the buggy off (`dispatch()`). The bed stays shut (canSleep)
// until it has gone. Every night start brings it back.
//
// State: 'idle' | 'playing' | 'morning' | 'gameOver' | 'finished'
//
// External references (set by the scene during wiring):
//   nightClock, signalManager, satellite, terminal, hud, quotaDock, cargo
// and the night counter through bindNights(nights).
// ─────────────────────────────────────────────

const PROMPT = {
  quotaMet: 'Hold out until 6:00 AM',
  morning:  'Get some sleep (bedroom)',
  deliver:  'Load the drive box into the buggy outside',
  send:     'Drives loaded — send the buggy off',
  delivered: 'Buggy away — get some sleep (bedroom)',
  failed:   'Night failed.',
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
  /** @type {import('../ui/EventBanner.js').EventBanner|null} */
  banner = null;
  /** Which night it is — set through bindNights().
   *  @type {import('../systems/NightManager.js').NightManager|null} */
  nights = null;
  /** The drive box dock — counts saved drives seated in the docked box.
   *  @type {import('./DriveBoxDock.js').DriveBoxDock|null} */
  quotaDock = null;
  /** The buggy's cargo bay — where the night's box goes before bed. Null:
   *  the morning goes straight to bed.
   *  @type {import('./DriveBoxDock.js').DriveBoxDock|null} */
  cargo = null;
  /** Whether this morning's buggy has been sent off with the drives. */
  dispatched = false;

  /** Which shift prompt is up (a PROMPT key), so it is set once, on change. */
  _shiftPrompt = null;

  /** Whether to auto-start the first night on first update. */
  autoStart = true;
  /** Seconds before a failed night's prompt shows and [E] retries. */
  _retryLock = 0;
  _heldPrompt = null;

  /** @type {Set<(state: string, previous: string) => void>} */
  _stateListeners = new Set();
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
    this._shiftPrompt = null;
    this.dispatched = false;
    this._setState('playing');

    this.nightClock?.reset();
    this.signalManager?.startNight(nightNumber);

    // Sync the dock's required count with the signal manager's night
    // requirement. signalManager.required is computed by startNight(),
    // so we sync AFTER it runs.
    if (this.quotaDock && this.signalManager) {
      this.quotaDock.requiredCount = this.signalManager.required;
    }
    if (this.cargo) {
      this.cargo.requiredCount = this.quotaDock?.requiredCount ?? this.signalManager?.required ?? 0;
    }

    // Night 3 only counts drives processed to level 2 (cyan).
    if (this.quotaDock) {
      this.quotaDock.minSignalLevel = nightNumber >= 3 ? 2 : 1;
    }

    this.hud?.show();
    this.hud?.setNight(nightNumber);
    this.hud?.setSignals(
      this.quotaDock?.collectedCount ?? 0,
      this.quotaDock?.requiredCount ?? this.signalManager?.required ?? 0,
      { minSignalLevel: this.quotaDock?.minSignalLevel ?? 1 },
    );
    this.hud?.setTime(this.nightClock?.timeString ?? '6:00 PM');
    this.hud?.setScanProgress(-1);
    this.hud?.setPrompt('');
    this.banner?.clear();

    for (const fn of this._nightStartListeners) fn(nightNumber, { retry });
  }

  /** Hear about every night that starts — a new night, a skip or a retry.
   *  The scene resets drives and captures its snapshot here; threats
   *  reschedule here; a retry also respawns the player.
   *  @param {(night: number, info: { retry: boolean }) => void} fn
   *  @returns {() => void} unsubscribe */
  onNightStart(fn) {
    this._nightStartListeners.add(fn);
    return () => this._nightStartListeners.delete(fn);
  }

  /** Something killed the player: end the shift as a game over, with its
   *  own prompt. Only a shift in progress can be failed.
   *  @param {string} [prompt]
   *  @param {{ retryAfter?: number }} [opts]  Seconds before the prompt shows
   *         and [E] retries — a death screen that has to play out first. */
  fail(prompt = PROMPT.failed, { retryAfter = 0 } = {}) {
    if (this.state !== 'playing') return;
    this._endShift('gameOver', retryAfter > 0 ? '' : prompt);
    this._retryLock = retryAfter;
    this._heldPrompt = retryAfter > 0 ? prompt : null;
  }

  /** Follow a NightManager: start the night it is on now, and every night
   *  it moves to after — sleeping, or the console's `night`. One night number for
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

  /** Subscribe to state changes: `listener(state, previous)`. The app layer
   *  uses it to put up the Night failed and Run complete screens.
   *  @param {(state: string, previous: string) => void} listener
   *  @returns {() => void} unsubscribe */
  onStateChange(listener) {
    this._stateListeners.add(listener);
    return () => this._stateListeners.delete(listener);
  }

  /** Whether the bed takes the player: the morning after a met quota, once
   *  the drives are loaded into the buggy and it has gone. */
  get canSleep() {
    if (this.state !== 'morning') return false;
    return this.cargo ? this.dispatched : true;
  }

  /** Send the loaded buggy off: the morning, with the night's quota in its
   *  boot, once. The drive-away itself is BuggyDeparture's; this is the
   *  rule it asks.
   *  @returns {boolean} false if it can't go (yet, or again) */
  dispatch() {
    if (this.state !== 'morning' || !this.cargo || this.dispatched || !this.delivered) return false;
    this.dispatched = true;
    this._updateMorningPrompt();
    return true;
  }

  /** Whether the buggy's cargo bay holds a box with the night's quota in it.
   *  An empty bay is never a delivery. Always true with no bay wired. */
  get delivered() {
    if (!this.cargo) return true;
    return !!this.cargo.depositedBox && this.cargo.isQuotaMet();
  }

  /** Put the shift's prompt back up, after something else wrote over it
   *  (a nap's wake-up line). */
  refreshPrompt() {
    if (this.state === 'playing') this.hud?.setPrompt(this.quotaDock?.isQuotaMet() ? PROMPT.quotaMet : '');
    else if (this.state === 'morning') this.hud?.setPrompt(PROMPT[this._morningKey()]);
  }

  /** Called when a signal is saved by the terminal. Scanning no longer
   *  affects the quota directly — the drive box dock counts saved drives
   *  seated in the docked box. Kept for backward compatibility (HUD refresh). */
  onSignalSaved() {
    this._updateHUD();
    if (this.state === 'playing') this._updateShiftPrompt();
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

  /** Go to bed. Only the morning after a successful shift (canSleep):
   *  moves to the next night, or ends the run after the last one.
   *  @returns {boolean} whether the player slept */
  sleep() {
    if (!this.canSleep) return false;
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

    // A death screen still playing: no prompt and no retry until it has.
    if (this.state === 'gameOver' && this._retryLock > 0) {
      this._retryLock -= dt;
      if (this._retryLock > 0) return;
      if (this._heldPrompt !== null) this.hud?.setPrompt(this._heldPrompt);
      this._heldPrompt = null;
      this.scene?.userData?.engine?.consumeAction?.('interact');   // a press held through it doesn't count
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

    if (this.state === 'morning') {
      this._updateMorningPrompt();
      return;
    }

    if (this.state !== 'playing') return;

    // Advance the clock
    this.nightClock?.update(dt);

    // Signals appear on their own schedule through the night
    this.signalManager?.update(dt, this.nightClock);

    // Update HUD every frame
    this._updateHUD();
    this._updateShiftPrompt();

    // Check shift end — quota is counted by the drive box dock (saved
    // drives seated in the docked box), not by signals scanned.
    if (this.nightClock?.finished) {
      if (this.quotaDock?.isQuotaMet()) this._morning();
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

  /** The prompt for where the shift stands — the quota met, or not yet —
   *  set only when that changes. When the quota is first met, the banner
   *  announces the event; the HUD shows the standing objective. */
  _updateShiftPrompt() {
    const key = this.quotaDock?.isQuotaMet() ? 'quotaMet' : null;
    if (key === this._shiftPrompt) return;
    this._shiftPrompt = key;
    if (key) {
      this.banner?.show('Quota met', { tone: 'info' });
    }
    this.hud?.setPrompt(key ? PROMPT[key] : '');
  }

  /** The morning's prompt key: load the buggy, send it, then bed. */
  _morningKey() {
    if (!this.cargo) return 'morning';
    if (this.dispatched) return 'delivered';
    return this.delivered ? 'send' : 'deliver';
  }

  /** The morning's prompt, set only when it changes (the box loaded, or
   *  taken back out). */
  _updateMorningPrompt() {
    const key = this._morningKey();
    if (key === this._shiftPrompt) return;
    this._shiftPrompt = key;
    this.hud?.setPrompt(PROMPT[key]);
  }

  _updateHUD() {
    if (!this.hud) return;
    this.hud.setTime(this.nightClock?.timeString ?? '6:00 PM');

    // Quota progress comes from the drive box dock (saved drives in the
    // docked box), falling back to the signal manager's required count
    // for the denominator.
    const collected = this.quotaDock?.collectedCount ?? 0;
    const required  = this.quotaDock?.requiredCount ?? this.signalManager?.required ?? 0;
    this.hud.setSignals(collected, required, {
      minSignalLevel: this.quotaDock?.minSignalLevel ?? 1,
    });

    // Scan bar — driven by satellite state (works even when terminal is closed)
    if (this.satellite?.isScanning && this.satellite?.scanTarget) {
      this.hud.setScanProgress(this.satellite.scanProgress / this.satellite.scanTarget.scanTime);
    } else if (!this.satellite?.isScanning) {
      this.hud.setScanProgress(-1);
    }
  }

  /** The one place `state` changes, so every change is announced. Iterates
   *  a copy: a listener may unsubscribe (or rebuild the scene) mid-call. */
  _setState(state) {
    const previous = this.state;
    if (state === previous) return;
    this.state = state;
    for (const listener of [...this._stateListeners]) listener(state, previous);
  }

  _endShift(state, prompt) {
    this.nightClock?.pause();
    this.hud?.setPrompt(prompt);
    this.hud?.setScanProgress(-1);
    // Last: a listener sees the shift fully ended (clock stopped, prompt up).
    this._setState(state);
  }

  _morning() {
    this.banner?.show('6:00 AM — shift over', { tone: 'info' });
    this._shiftPrompt = this._morningKey();
    this._endShift('morning', PROMPT[this._shiftPrompt]);
  }
  _gameOver() { this._endShift('gameOver', PROMPT.failed); }
  _finish()   { this._endShift('finished', PROMPT.finished); }
}
