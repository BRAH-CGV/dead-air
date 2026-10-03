// ─────────────────────────────────────────────
// App  –  the menus around the game: boot, pause, restart, end screens
// ─────────────────────────────────────────────
// Glue between AppFlow (what state we're in), the Engine (paused or not,
// which scene), MenuView (what's drawn) and PointerLock (whether the mouse
// is ours). All the decisions live here or in AppFlow, so Engine stays a
// few lines bigger and MenuView stays dumb.
//
// Rules worth knowing before changing anything (see AGENTS.md → App flow):
//   • Pause on: lost pointer lock, Escape, hidden tab, window blur — only
//     while playing, and never while the level editor is open (it drops
//     the lock on purpose).
//   • Resume only from a click on Resume: requestPointerLock needs a user
//     gesture, and Esc isn't one. Never go back to playing before the lock
//     is confirmed — that's playing with a dead mouse.
//   • Esc inside menus means Back. On a root screen it does nothing.
//   • The main menu always sits over a freshly built scene that hasn't
//     ticked, so New game is just "unpause". Leaving a game rebuilds under
//     a fade.
//   • While a menu is open, a capture-phase keydown listener eats every
//     keydown (never keyup) so the debug keys and the review panel's S / D
//     can't fire behind it.
// ─────────────────────────────────────────────

import { AppFlow } from './AppFlow.js';
import { PointerLock } from './PointerLock.js';
import { controlsList } from './controlsList.js';
import { SettingsStore, SCHEMA, TABS } from './SettingsStore.js';
import { applySettings } from './applySettings.js';
import { REBINDABLE, ACTION_LABELS, keyName, rebind } from './keyNames.js';
import { setInteractKey } from '../ui/promptKeys.js';
import { MenuView } from '../ui/menu/MenuView.js';
import { ScreenFade } from '../ui/ScreenFade.js';
import { TAGLINE, COPY } from '../ui/menu/text.js';
import { version as PACKAGE_VERSION } from '../../package.json';

/** body[data-app] per flow state — index.html hides the gameplay overlays
 *  whenever it isn't 'playing'. */
const DATA_APP = { mainMenu: 'menu', playing: 'playing', paused: 'paused', ended: 'ended' };

/** localStorage, or null where touching it throws (blocked site data). */
function safeLocalStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export class App {
  /**
   * @param {import('../core/Engine.js').Engine} engine
   * @param {object} [deps]  Injected in tests
   * @param {PointerLock} [deps.pointerLock]
   * @param {MenuView} [deps.view]
   * @param {ScreenFade} [deps.fade]
   * @param {string} [deps.version]
   * @param {Storage|null} [deps.storage]  Where settings persist
   * @param {boolean} [deps.devToolsDefault]  On in `npm run dev`, off in the build
   * @param {SettingsStore} [deps.settings]
   * @param {Document} [deps.doc]
   * @param {Window} [deps.win]
   */
  constructor(engine, {
    pointerLock = new PointerLock(engine.renderer?.domElement),
    view = new MenuView(),
    fade = engine.screenFade ?? new ScreenFade(),
    version = PACKAGE_VERSION,
    storage = safeLocalStorage(),
    devToolsDefault = !!import.meta.env?.DEV,
    settings = null,
    doc = document,
    win = window,
  } = {}) {
    this.engine = engine;
    this.flow = new AppFlow();
    this.pointerLock = pointerLock;
    this.view = view;
    this.fade = fade;
    this.version = version;
    this.doc = doc;
    this.win = win;
    // The engine's binds at boot are the defaults the CONTROLS tab resets to.
    this.settings = settings ?? new SettingsStore({
      storage,
      defaults: {
        keyBinds: Object.fromEntries(REBINDABLE.map(a => [a, engine.keyBinds[a]])),
        devTools: devToolsDefault,
      },
    });
    this._settingsTab = 'game';
    this._settingsMessage = '';
    /** The action waiting for a key on the CONTROLS tab, or null. */
    this._capturing = null;
    /** Rows to flash once on the next draw (a rebind swap). */
    this._flash = new Set();

    /** True while a lock request or a rebuild is in flight: menu input is
     *  ignored, so a double click can't queue two rebuilds. */
    this._busy = false;
    this._hint = '';
    /** What the Night failed screen reports, captured when the night ends. */
    this._failed = { night: 1, saved: 0, required: 0 };
    this._offController = null;
    this._offs = [];
  }

  /** Wire everything up and show the main menu once the game is revealed.
   *  @returns {Promise<void>} */
  async start() {
    const { engine, flow, win, doc } = this;
    engine.setPaused(true);

    this._offs.push(flow.onChange(() => this._render()));
    this.view.onIntent((action, data) => this._onIntent(action, data));

    this._listen(win, 'keydown', this._onKeyDownCapture, { capture: true });
    this._listen(win, 'keydown', this._onKeyDown);
    this._listen(win, 'blur', () => this.pause());
    this._listen(doc, 'visibilitychange', () => { if (doc.hidden) this.pause(); });
    this._offs.push(this.pointerLock.onChange((locked) => { if (!locked) this.pause(); }));

    this._offs.push(this.settings.onChange((values, keys) => this._onSettingsChanged(values, keys)));
    this._offs.push(engine.onSceneLoaded((scene) => this._onSceneLoaded(scene)));
    this._onSceneLoaded(engine.activeScene);

    await engine.revealed;
    flow.ready();
  }

  /** Remove every listener App added. */
  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    this._offController?.();
    this._offController = null;
  }

  // ──────────────────────────────────────────
  // Transitions
  // ──────────────────────────────────────────

  /** Every pause trigger lands here. Idempotent. */
  pause() {
    if (this.flow.state !== 'playing' || this.engine.levelEditor?.enabled) return;
    this.flow.pause();
    this.engine.setPaused(true);
  }

  /** Throw the current scene away and build a fresh one. Every path back to
   *  a clean night goes through here: Main menu, Retry, Restart night. */
  rebuild() {
    const { engine } = this;
    // Both hang state off the scene graph that loadScene is about to drop:
    // the fly camera reparents the game camera, fullbright swaps materials.
    if (engine.debugCamera?.active) engine.debugCamera.disable();
    if (engine.fullbright?.active) engine.fullbright.disable();
    this._offController?.();
    this._offController = null;
    engine.loadScene(engine.activeScene.constructor);
    this.flow.markClean();
  }

  async _newGame() {
    this._wakeAudio();
    const lock = this.pointerLock.request();   // inside the click, or it's refused
    await this._run(async () => {
      if (this.flow.needsRebuild) await this._fadeRebuild();
      if (await this._lockHeld(lock)) {
        this.flow.newGame();
        this.engine.setPaused(false);
      } else {
        this._setHint(COPY.lockRefused);
      }
    });
  }

  async _resume() {
    const lock = this.pointerLock.request();
    await this._run(async () => {
      if (await this._lockHeld(lock)) {
        this.flow.resume();
        this.engine.setPaused(false);
      } else {
        this._setHint(COPY.resumeRetry);
      }
    });
  }

  /** Restart (from pause) or Retry (from Night failed): a full rebuild, then
   *  back to the night that was being played — the same path as the N key.
   *  GameController.retryNight() only resets the clock and signals; this
   *  puts the player back at spawn with the world reset. */
  async _restartNight() {
    const night = this._currentNight();
    const lock = this.pointerLock.request();
    await this._run(async () => {
      await this._fadeRebuild(() => this.engine.activeScene?.nights?.setNight(night));
      if (await this._lockHeld(lock)) {
        this.flow.restart();
        this.engine.setPaused(false);
      } else {
        this.flow.restartPaused();
        this._setHint(COPY.resumeRetry);
      }
    });
  }

  async _quitToMenu() {
    await this._run(async () => {
      this.pointerLock.exit();
      await this._fadeRebuild(() => this.flow.quitToMenu());
    });
  }

  /** The shift ended: `gameOver` or `finished`. The flow moves first, so
   *  the lock released after it isn't read as a pause. */
  _onGameState(state) {
    if (state === 'gameOver') {
      const progress = this.engine.activeScene?.signalManager?.getProgress?.();
      this._failed = {
        night: this._currentNight(),
        saved: progress?.saved ?? 0,
        required: progress?.required ?? 0,
      };
      this.flow.nightFailed();
    } else if (state === 'finished') {
      // Lands mid sleep-fade, while the screen is black: the screen is up by
      // the time the fade clears.
      this.flow.runComplete();
    } else {
      return;
    }
    this.engine.setPaused(true);
    this.pointerLock.exit();
  }

  // ──────────────────────────────────────────
  // Scene hooks
  // ──────────────────────────────────────────

  /** After every scene load, App's or not (F4, the editor's switcher):
   *  re-apply the settings (buildPlayer and the scene's moon light come
   *  back with hard-coded values) and follow the new GameController. */
  _onSceneLoaded(scene) {
    this._applySettings();
    this._offController?.();
    this._offController = scene?.gameController?.onStateChange?.((state) => this._onGameState(state)) ?? null;
  }

  _applySettings(values = this.settings.values) {
    applySettings(this.engine, values);
    setInteractKey(keyName(values.keyBinds.interact));
  }

  /** Live: applied the moment a value changes, behind the menu. A slider
   *  isn't redrawn (that would drop it mid-drag); everything else is. */
  _onSettingsChanged(values, keys) {
    this._applySettings(values);
    const sliderOnly = keys.length === 1 && SCHEMA[keys[0]]?.type === 'number';
    if (this.flow.screen === 'settings' && !sliderOnly) this._render();
  }

  // ──────────────────────────────────────────
  // Input
  // ──────────────────────────────────────────

  /** Capture phase, so it runs before the Engine's and the review panel's
   *  window listeners. Only keydown: swallowing a keyup would stick a key. */
  _onKeyDownCapture = (e) => {
    if (!this.flow.isMenuOpen) return;
    if (this._capturing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this._captureKey(e.code);
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      if (!this._busy) this.flow.back();
    } else if (this.view.handleKey(e)) {
      e.preventDefault();
    }
    e.stopImmediatePropagation();
  };

  /** Bubble phase, while playing: Escape when the lock never took (the
   *  browser handles Esc itself when it did — pointerlockchange covers it). */
  _onKeyDown = (e) => {
    if (e.code === 'Escape') this.pause();
  };

  _onIntent(action, data) {
    if (this._busy) return;
    const { flow } = this;
    switch (action) {
      case 'newGame':  return this._newGame();
      case 'resume':   return this._resume();
      case 'settings': return flow.openSettings();
      case 'controls': return flow.openControls();
      case 'credits':  return flow.openCredits();
      case 'back':
      case 'cancel':
        this._capturing = null;
        return flow.back();
      case 'restart':  return flow.openConfirm('restart');
      case 'retry':    return this._restartNight();
      case 'quit':
        // From the pause menu it needs confirming; from an end screen the
        // night is already over.
        return flow.screen === 'pause' ? flow.openConfirm('quit') : this._quitToMenu();
      case 'confirm':
        return flow.confirmAction === 'restart' ? this._restartNight() : this._quitToMenu();
      default:
        return this._onExtraIntent(action, data);
    }
  }

  /** The settings screen's own intents. */
  _onExtraIntent(action, data) {
    switch (action) {
      case 'tab':
        this._settingsTab = data.tab;
        this._settingsMessage = '';
        this._capturing = null;
        return this._render();
      case 'setting':
        return this.settings.set(data.key, data.value);
      case 'resetTab':
        this._settingsMessage = '';
        this._capturing = null;
        this.settings.resetTab(this._settingsTab);
        return this._render();
      case 'rebind':
        this._capturing = data.bindAction;
        this._settingsMessage = '';
        return this._render();
      default:
    }
  }

  /** The key pressed while a bind row waits for one. Esc cancels; a
   *  reserved key is refused with a reason; a key another action has is
   *  swapped, and both rows flash. */
  _captureKey(code) {
    const action = this._capturing;
    this._capturing = null;
    if (code === 'Escape') {
      this._settingsMessage = '';
    } else {
      const result = rebind(this.settings.values.keyBinds, action, code, { devTools: this.engine.devTools });
      if (result.ok) {
        this._settingsMessage = result.swappedWith
          ? `Swapped with ${ACTION_LABELS[result.swappedWith]}.`
          : '';
        this._flash = new Set([action, result.swappedWith].filter(Boolean));
        this.settings.setBinds(result.changes);
      } else {
        this._settingsMessage = `${result.reason}.`;
      }
    }
    this._render();
  }

  // ──────────────────────────────────────────
  // Drawing
  // ──────────────────────────────────────────

  _render() {
    const { flow, view } = this;
    const body = this.doc.body;
    if (DATA_APP[flow.state]) body.dataset.app = DATA_APP[flow.state];
    else delete body.dataset.app;

    if (view.screen !== flow.screen) this._hint = '';
    if (!flow.isMenuOpen) {
      view.hide();
      return;
    }
    view.show(flow.screen, this._model(flow.screen));
    view.setStatus(this._statusLines());
  }

  /** The data each screen is drawn from. */
  _model(screen) {
    switch (screen) {
      case 'main':
        return { tagline: TAGLINE, version: this.version, continueNight: null, hint: this._hint };
      case 'pause':
        return { status: this._statusLine(), hint: this._hint };
      case 'confirm':
        return this.flow.confirmAction === 'restart'
          ? { message: COPY.restartConfirm(this._currentNight()), confirmLabel: 'Restart night' }
          : { message: COPY.quitConfirm, confirmLabel: 'Main menu' };
      case 'controls':
        return { groups: controlsList(this.engine.keyBinds, { devTools: this.engine.devTools }) };
      case 'nightFailed':
        return { ...this._failed };
      case 'settings':
        return this._settingsModel();
      default:
        return {};
    }
  }

  /** Rows for the current settings tab, from SCHEMA plus the extras each
   *  tab carries: the rebind rows on CONTROLS, the debug keys on DEVELOPER. */
  _settingsModel() {
    const values = this.settings.values;
    const tab = this._settingsTab;
    const rows = [];
    for (const [key, spec] of Object.entries(SCHEMA)) {
      if (spec.tab !== tab || spec.type === 'binds') continue;
      if (spec.type === 'number') {
        rows.push({ type: 'slider', key, label: spec.label, min: spec.min, max: spec.max, step: spec.step,
          value: values[key], format: spec.format });
      } else {
        const options = spec.type === 'bool'
          ? [{ value: false, label: 'OFF' }, { value: true, label: 'ON' }]
          : spec.options;
        rows.push({ type: 'choice', key, label: spec.label, value: values[key], options });
      }
    }
    if (tab === 'controls') {
      for (const action of REBINDABLE) {
        rows.push({
          type: 'bind', action, label: ACTION_LABELS[action],
          keyText: keyName(values.keyBinds[action]),
          capturing: this._capturing === action,
          flash: this._flash.has(action),
        });
      }
      rows.push({ type: 'button', action: 'controls', label: 'View all controls' });
    }
    if (tab === 'developer') {
      const dev = controlsList(this.engine.keyBinds, { devTools: true }).find(g => g.title === 'DEVELOPER');
      for (const r of dev.rows) rows.push({ type: 'info', label: r.label, text: r.keys });
    }
    this._flash = new Set();
    return { tabs: TABS, tab, rows, message: this._settingsMessage };
  }

  /** `NIGHT 2 · 03:14 AM · SIGNALS 2/4`, read when the pause menu opens. */
  _statusLine() {
    const scene = this.engine.activeScene;
    const progress = scene?.signalManager?.getProgress?.();
    const parts = [`NIGHT ${this._currentNight()}`];
    if (scene?.nightClock) parts.push(scene.nightClock.timeString.toUpperCase());
    if (progress) parts.push(`SIGNALS ${progress.saved}/${progress.required}`);
    return parts.join(' · ');
  }

  _statusLines() {
    const state = this.flow.state;
    const station = { mainMenu: 'STANDBY', paused: 'HOLD', ended: 'OFFLINE' }[state] ?? 'ONLINE';
    const link = this.flow.screen === 'nightFailed' ? 'LOST' : 'OK';
    const max = this.engine.activeScene?.nights?.maxNight;
    return [
      `STATION: ${station}`,
      `LINK: ${link}`,
      max ? `NIGHT ${this._currentNight()}/${max}` : null,
    ].filter(Boolean);
  }

  _setHint(text) {
    this._hint = text;
    this.view.setHint(text);
  }

  // ──────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────

  _currentNight() {
    const scene = this.engine.activeScene;
    return scene?.nights?.currentNight ?? scene?.gameController?.nightNumber ?? 1;
  }

  /** Whether a lock request came good and the lock is still held — the
   *  player may have pressed Esc again while a fade was running. */
  async _lockHeld(request) {
    return (await request) && this.pointerLock.locked;
  }

  /** Run one menu action at a time. */
  async _run(task) {
    this._busy = true;
    try {
      await task();
    } finally {
      this._busy = false;
    }
  }

  /** Rebuild at full black, run `then` there too, and resolve. */
  _fadeRebuild(then) {
    return new Promise((resolve) => {
      const atBlack = () => {
        this.rebuild();
        then?.();
        resolve();
      };
      // Another fade already running (the bed's): rebuild without one
      // rather than not at all.
      if (!this.fade?.play?.(atBlack)) atBlack();
    });
  }

  /** Chrome keeps audio suspended until a user gesture; New game is one. */
  _wakeAudio() {
    const context = this.engine.audioListener?.context;
    if (context?.state === 'suspended') context.resume?.();
  }

  _listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this._offs.push(() => target.removeEventListener(type, handler, options));
  }
}
