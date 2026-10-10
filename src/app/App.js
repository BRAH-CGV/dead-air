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
import { MenuMusic } from './MenuMusic.js';
import { TAGLINE, TEAM, SHOW_ROLES, COPY } from '../ui/menu/text.js';
import { ASSETS } from '../assets/manifest.js';
import { buildCreditBlocks, creditWarnings } from '../ui/menu/credits.js';
import attributionsMd from '../../ATTRIBUTIONS.md?raw';
import { version as PACKAGE_VERSION } from '../../package.json';

/** body[data-app] per flow state — index.html hides the gameplay overlays
 *  whenever it isn't 'playing'. */
const DATA_APP = { mainMenu: 'menu', playing: 'playing', paused: 'paused', ended: 'ended' };

/** Where Continue and Select night remember progress: `{ night, highest }`. */
export const PROGRESS_KEY = 'dead-air.progress.v1';

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
   * @param {boolean} [deps.devToolsDefault]  Debug keys: on in `npm run dev`, off in the build
   * @param {SettingsStore} [deps.settings]
   * @param {boolean} [deps.dev]  Dev build: unconfirmed credits show, and warn
   * @param {Document} [deps.doc]
   * @param {Window} [deps.win]
   * @param {{ load: () => void, setPlaying: (on: boolean) => void, dispose: () => void }} [deps.music]
   *        The main menu's music.
   */
  constructor(engine, {
    pointerLock = new PointerLock(engine.renderer?.domElement),
    view = new MenuView(),
    fade = engine.screenFade ?? new ScreenFade(),
    version = PACKAGE_VERSION,
    storage = safeLocalStorage(),
    devToolsDefault = !!import.meta.env?.DEV,
    settings = null,
    dev = !!import.meta.env?.DEV,
    doc = document,
    win = window,
    music = new MenuMusic({ engine }),
  } = {}) {
    this.engine = engine;
    this.music = music;
    this.flow = new AppFlow();
    this.pointerLock = pointerLock;
    this.view = view;
    this.fade = fade;
    this.version = version;
    this.doc = doc;
    this.win = win;
    this.storage = storage;
    // The engine's binds at boot are the defaults the CONTROLS tab resets to.
    this.settings = settings ?? new SettingsStore({
      storage,
      defaults: { keyBinds: Object.fromEntries(REBINDABLE.map(a => [a, engine.keyBinds[a]])) },
    });
    // Not a setting: the debug keys go before release, so they simply follow
    // the build — on in `npm run dev`, off in the production bundle.
    this.devTools = devToolsDefault;
    this.dev = dev;
    // Parsed once: ATTRIBUTIONS.md is inlined at build time (?raw), so a new
    // entry there reaches the credits on the next build.
    this._creditBlocks = buildCreditBlocks({
      markdown: attributionsMd, team: TEAM, dev, showRoles: SHOW_ROLES,
      assetKeys: new Set(Object.keys(ASSETS)),
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
    engine.devTools = this.devTools;
    if (this.dev) {
      console.warn(`[credits] Not credited yet, needs a source in ATTRIBUTIONS.md:\n  ${creditWarnings(attributionsMd).join('\n  ')}`);
    }

    this._offs.push(flow.onChange(() => this._render()));
    this.view.onIntent((action, data) => this._onIntent(action, data));

    // Music under the main menu (and the screens opened from it), faded out
    // for the game. It can only sound once the audio is awake, and the
    // menu's buttons aren't the canvas whose click wakes it — so the first
    // click or key anywhere does. Listed before the listener below, which
    // swallows keys while a menu is open.
    this.music.load();
    this._offs.push(flow.onChange(() => this.music.setPlaying(flow.state === 'mainMenu')));
    this._listen(win, 'pointerdown', () => this._wakeAudio(), { capture: true });
    this._listen(win, 'keydown', () => this._wakeAudio(), { capture: true });

    this._listen(win, 'keydown', this._onKeyDownCapture, { capture: true });
    this._listen(win, 'keydown', this._onKeyDown);
    this._listen(win, 'blur', () => this.pause());
    this._listen(doc, 'visibilitychange', () => { if (doc.hidden) this.pause(); });
    this._offs.push(this.pointerLock.onChange((locked) => { if (!locked) this._pauseForInput(); }));

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
    this.music.dispose();
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

  /** A lost lock or Escape: a pause, unless a DOM panel (the breaker
   *  panel) took the mouse on purpose — Escape is how it closes. A hidden
   *  tab or blur still pauses through pause(). */
  _pauseForInput() {
    if (!this.engine.uiHasMouse) this.pause();
  }

  /** Throw the current scene away and build a fresh one. Every path back to
   *  a clean night goes through here: Main menu, Retry, Restart night. */
  rebuild() {
    const { engine } = this;
    // Both hang state off the scene graph that loadScene is about to drop:
    // the fly camera reparents the game camera, fullbright swaps materials.
    if (engine.debugCamera?.active) engine.debugCamera.disable();
    if (engine.fullbright?.active) engine.fullbright.disable();
    clearTimeout(this._failTimer);
    engine.uiHasMouse = false;
    this._offController?.();
    this._offController = null;
    engine.loadScene(engine.activeScene.constructor);
    // The camera outlives the scene, and nothing ticks under the menu to
    // turn it back: face the way the fresh player does (beside the bunk,
    // looking at the desk — not world forward).
    const ctrl = engine.playerController;
    engine.camera?.rotation?.set(ctrl?.pitch ?? 0, ctrl?.yaw ?? 0, 0);
    this.flow.markClean();
  }

  async _newGame() {
    this._wakeAudio();
    const lock = this.pointerLock.request();   // inside the click, or it's refused
    await this._run(async () => {
      if (this.flow.needsRebuild) await this._fadeRebuild();
      if (await this._lockHeld(lock)) {
        this._saveNight(null);   // a new run: Continue returns from night 2
        this.flow.newGame();
        this.engine.setPaused(false);
      } else {
        this._setHint(COPY.lockRefused);
      }
    });
  }

  /** Continue: the night saved last time, on the fresh scene the menu sits
   *  over — no rebuild, just the night set (like the N key) once the lock
   *  is ours. Set any earlier and a refused lock would leave New game
   *  starting on that night. */
  async _continue() {
    const night = this._savedNight();
    if (night) await this._startAtNight(night);
  }

  /** Play from `night` on the fresh scene the menu sits over — Continue and
   *  Select night (#18). Night 1 is New game's own path. */
  async _startAtNight(night) {
    if (!Number.isInteger(night) || night < 1 || night > this._highestNight()) return;
    this._wakeAudio();
    const lock = this.pointerLock.request();
    await this._run(async () => {
      if (this.flow.needsRebuild) await this._fadeRebuild();
      if (await this._lockHeld(lock)) {
        this.engine.activeScene?.nights?.setNight(night);
        this._saveNight(null);   // a new run from here: Continue comes back as it's played
        this.flow.newGame();
        this.engine.setPaused(false);
      } else {
        this._setHint(COPY.lockRefused);
      }
    });
  }

  async _resume() {
    // A panel still has the mouse: back to it, without taking the lock.
    if (this.engine.uiHasMouse) {
      this.flow.resume();
      this.engine.setPaused(false);
      return;
    }
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
    if (state === 'playing') {
      this._saveNight(this._currentNight());
      return;
    }
    if (state === 'gameOver') {
      // A UFO catch fails the shift and then burns the screen white with
      // "You were taken" — let that play (it has its own [E] retry) before
      // the menu covers it. A missed quota has no white-out: shown at once.
      // _catch() starts the white-out right after fail(), in the same call:
      // a microtask sees whether it did.
      clearTimeout(this._failTimer);
      const scene = this.engine.activeScene;
      const stillFailed = () => scene === this.engine.activeScene && scene?.gameController?.state === 'gameOver';
      queueMicrotask(() => {
        if (!stillFailed()) return;
        const whiteOut = scene.whiteOut;
        if (!whiteOut?.active) return this._showNightFailed();
        this._failTimer = setTimeout(() => {
          if (stillFailed()) this._showNightFailed();
        }, (whiteOut.messageDelayMs ?? 3000) + 1500);
      });
      return;
    } else if (state === 'finished') {
      // Lands mid sleep-fade, while the screen is black: the screen is up by
      // the time the fade clears.
      this._saveNight(null, { highest: this._maxNight() });   // the whole run: every night open
      this.flow.runComplete();
    } else {
      return;
    }
    this.engine.setPaused(true);
    this.pointerLock.exit();
  }

  _showNightFailed() {
    const dock = this.engine.activeScene?.gameController?.quotaDock;
    this._failed = {
      night: this._currentNight(),
      saved: dock?.collectedCount ?? 0,
      required: dock?.requiredCount ?? 0,
    };
    this.flow.nightFailed();
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
    if (e.code === 'Escape') this._pauseForInput();
  };

  _onIntent(action, data) {
    if (this._busy) return;
    const { flow } = this;
    switch (action) {
      case 'newGame':  return this._newGame();
      case 'continue': return this._continue();
      case 'nightSelect': return flow.openNightSelect();
      case 'selectNight': return this._startAtNight(Number(data.night));
      case 'resume':   return this._resume();
      case 'settings': return flow.openSettings();
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
        return { tagline: TAGLINE, version: this.version, continueNight: this._savedNight(), hint: this._hint };
      case 'nightSelect':
        return { maxNight: this._maxNight(), highest: this._highestNight(), hint: this._hint };
      case 'pause':
        return { status: this._statusLine(), hint: this._hint };
      case 'confirm':
        return this.flow.confirmAction === 'restart'
          ? { message: COPY.restartConfirm(this._currentNight()), confirmLabel: 'Restart night' }
          : { message: COPY.quitConfirm, confirmLabel: 'Main menu' };
      case 'nightFailed':
        return { ...this._failed };
      case 'settings':
        return this._settingsModel();
      case 'credits':
        return { blocks: this._creditBlocks, mode: 'list' };
      case 'runComplete':
        return { blocks: this._creditBlocks };
      default:
        return {};
    }
  }

  /** Rows for the current settings tab, from SCHEMA plus the extras each
   *  tab carries: the rebind rows and the fixed keys on CONTROLS. */
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
      // What can't be rebound, under the rows that can: one place for controls.
      for (const group of controlsList(values.keyBinds)) {
        rows.push({ type: 'heading', label: group.title });
        for (const r of group.rows) rows.push({ type: 'info', label: r.label, text: r.keys });
      }
    }
    this._flash = new Set();
    return { tabs: TABS, tab, rows, message: this._settingsMessage };
  }

  /** `NIGHT 2 · 03:14 AM · DRIVES 2/4`, read when the pause menu opens. */
  _statusLine() {
    const scene = this.engine.activeScene;
    const dock = scene?.gameController?.quotaDock;
    const parts = [`NIGHT ${this._currentNight()}`];
    if (scene?.nightClock) parts.push(scene.nightClock.timeString.toUpperCase());
    if (dock) parts.push(`DRIVES ${dock.collectedCount}/${dock.requiredCount}`);
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

  /** The save: `{ night, highest }` — the night Continue starts (null for
   *  none) and the furthest night ever reached, which Select night unlocks
   *  up to. Corrupt or out-of-range values are dropped; an old `{ night }`
   *  save reads as reached that far. */
  _progress() {
    const max = this._maxNight();
    const valid = (n) => Number.isInteger(n) && n >= 1 && n <= max;
    try {
      const saved = JSON.parse(this.storage?.getItem(PROGRESS_KEY) ?? 'null') ?? {};
      const night = valid(saved.night) ? saved.night : null;
      const highest = Math.max(1, valid(saved.highest) ? saved.highest : 1, night ?? 1);
      return { night, highest };
    } catch {
      return { night: null, highest: 1 };
    }
  }

  _maxNight() {
    return this.engine.activeScene?.nights?.maxNight ?? 3;
  }

  /** The night Continue would start, or null — night 1 isn't worth a button. */
  _savedNight() {
    const { night } = this._progress();
    return night && night >= 2 ? night : null;
  }

  /** The furthest night Select night offers. */
  _highestNight() {
    return this._progress().highest;
  }

  /** Remember the night being played (null: no Continue). The furthest night
   *  reached only ever grows. Never throws. */
  _saveNight(night, { highest } = {}) {
    try {
      const progress = this._progress();
      const next = {
        night,
        highest: Math.max(progress.highest, night ?? 1, highest ?? 1),
      };
      this.storage?.setItem(PROGRESS_KEY, JSON.stringify(next));
    } catch { /* blocked or full: Continue and the unlocks just won't be offered */ }
  }

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

  /** Chrome keeps audio suspended until a user gesture: New game is one, and
   *  so is the first click or key on the menu. */
  _wakeAudio() {
    const context = this.engine.audioListener?.context;
    if (context?.state === 'suspended') context.resume?.();
  }

  _listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this._offs.push(() => target.removeEventListener(type, handler, options));
  }
}
