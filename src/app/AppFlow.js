// ─────────────────────────────────────────────
// AppFlow  –  the menus' state machine (pure: no DOM, no engine)
// ─────────────────────────────────────────────
// Which top-level state the app is in, and which screen is on top:
//
//   loading ─▶ mainMenu ─newGame─▶ playing ─pause─▶ paused ─resume─▶ playing
//                 ▲                   │                │
//                 │                   ├─nightFailed / runComplete─▶ ended
//                 └────quitToMenu─────┴────────────────┘ (from paused / ended)
//
// Each menu state keeps a stack of screens. Its root ('main', 'pause',
// 'nightFailed', 'runComplete') is where back() stops; Settings, Controls,
// Credits and the confirm dialog push over it, so Back always returns to
// whichever screen opened them.
//
// Invariant the App builds on: the main menu always sits over a freshly
// built scene that has never ticked. `needsRebuild` says when that's no
// longer true (the scene has been played) and the App has to rebuild.
// ─────────────────────────────────────────────

/** @typedef {'loading'|'mainMenu'|'playing'|'paused'|'ended'} AppState */
/** @typedef {'main'|'pause'|'settings'|'controls'|'credits'|'confirm'|'nightFailed'|'runComplete'} Screen */

export class AppFlow {
  /** @type {AppState} */
  state = 'loading';
  /** What the open confirm dialog will do: 'restart' | 'quit'. */
  confirmAction = null;

  /** @type {Screen[]} */
  _stack = [];
  _dirty = false;
  _listeners = new Set();

  /** The screen on top, or null while loading or playing. @returns {Screen|null} */
  get screen() { return this._stack.at(-1) ?? null; }

  /** True while any menu covers the game. */
  get isMenuOpen() { return this.state !== 'loading' && this.state !== 'playing'; }

  /** True once the scene behind the menu has been played. */
  get needsRebuild() { return this._dirty; }

  /** The App rebuilt the scene: the menu sits over a fresh one again. */
  markClean() { this._dirty = false; }

  /** Subscribe to changes: `listener(flow)`, once per real change.
   *  @returns {() => void} unsubscribe */
  onChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  // ── Top-level transitions ─────────────────

  /** Loading finished. */
  ready() {
    if (this.state !== 'loading') return;
    this._go('mainMenu', ['main']);
  }

  /** Start playing from the main menu.
   *  @returns {{ needsRebuild: boolean }} whether the scene must be rebuilt first */
  newGame() {
    const needsRebuild = this._dirty;
    if (this.state !== 'mainMenu' || this.screen !== 'main') return { needsRebuild };
    this._play();
    return { needsRebuild };
  }

  /** Esc, a lost pointer lock, a hidden tab. Only while playing. */
  pause() {
    if (this.state !== 'playing') return;
    this._go('paused', ['pause']);
  }

  /** Back into the game — only from the pause screen itself. */
  resume() {
    if (this.state !== 'paused' || this.screen !== 'pause') return;
    this._play();
  }

  /** The shift ended short of the quota, or a threat got the player. A
   *  catch shows its own white-out first, so a pause may slip in before. */
  nightFailed() {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    this._go('ended', ['nightFailed']);
  }

  /** The last night slept through. It lands during the sleep fade, so a
   *  pause that slipped in just before is allowed too. */
  runComplete() {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    this._go('ended', ['runComplete']);
  }

  /** To the main menu, from the pause menu or an end screen. */
  quitToMenu() {
    if (this.state !== 'paused' && this.state !== 'ended') return;
    this._go('mainMenu', ['main']);
  }

  /** Restart (or retry) the night and play straight away. */
  restart() {
    if (this.state !== 'paused' && this.state !== 'ended') return;
    this._play();
  }

  /** Restart the night but stay paused — the pointer lock was refused, so
   *  the player has to click Resume. */
  restartPaused() {
    if (this.state !== 'paused' && this.state !== 'ended') return;
    this._go('paused', ['pause']);
  }

  // ── Screens ───────────────────────────────

  openSettings() {
    if (this.screen === 'main' || this.screen === 'pause') this._push('settings');
  }

  openControls() {
    if (this.screen === 'pause' || this.screen === 'settings') this._push('controls');
  }

  openCredits() {
    if (this.screen === 'main') this._push('credits');
  }

  /** @param {'restart'|'quit'} action */
  openConfirm(action) {
    if (this.screen !== 'pause') return;
    this.confirmAction = action;
    this._push('confirm');
  }

  /** Esc / Back: close the top screen. A no-op on a root screen. */
  back() {
    if (this._stack.length <= 1) return;
    if (this._stack.pop() === 'confirm') this.confirmAction = null;
    this._emit();
  }

  // ── Internals ─────────────────────────────

  _play() {
    this._dirty = true;
    this._go('playing', []);
  }

  _push(screen) {
    this._stack.push(screen);
    this._emit();
  }

  _go(state, stack) {
    const same = state === this.state
      && stack.length === this._stack.length
      && stack.every((s, i) => s === this._stack[i]);
    if (same) return;
    this.state = state;
    this._stack = stack;
    this.confirmAction = null;
    this._emit();
  }

  _emit() {
    for (const listener of [...this._listeners]) listener(this);
  }
}
