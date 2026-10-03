// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { App } from './App.js';
import { MenuView } from '../ui/menu/MenuView.js';

// ── Fakes: no WebGL, no Rapier, no real pointer lock ──

/** A scene with just what App reads: the controller, nights, clock, signals. */
function makeScene() {
  const listeners = new Set();
  const gameController = {
    state: 'playing', nightNumber: 1,
    onStateChange: vi.fn((cb) => { listeners.add(cb); return () => listeners.delete(cb); }),
    /** Test helper: move the controller to `state` and tell its listeners. */
    fire(state) {
      const previous = this.state;
      this.state = state;
      for (const l of [...listeners]) l(state, previous);
    },
    get listenerCount() { return listeners.size; },
  };
  const nights = {
    currentNight: 1, maxNight: 3,
    setNight: vi.fn((n) => { nights.currentNight = n; gameController.nightNumber = n; }),
  };
  return {
    gameController, nights,
    nightClock: { timeString: '3:14 AM' },
    signalManager: { getProgress: () => ({ saved: 2, required: 4 }) },
  };
}

function makeEngine() {
  const sceneListeners = new Set();
  const engine = {
    paused: false,
    setPaused: vi.fn((p) => { engine.paused = p; }),
    devTools: true,
    keyBinds: {
      forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
      jump: 'Space', crouch: 'KeyC', interact: 'KeyE', flashlight: 'KeyF',
      debugFly: 'KeyV', fullbright: 'KeyB', nextNight: 'KeyN', perfStats: 'KeyI',
    },
    revealed: Promise.resolve(),
    levelEditor: { enabled: false },
    debugCamera: { active: false, disable: vi.fn(() => { engine.debugCamera.active = false; }) },
    fullbright: { active: false, disable: vi.fn(() => { engine.fullbright.active = false; }) },
    audioListener: { context: { state: 'suspended', resume: vi.fn() } },
    activeScene: makeScene(),
    onSceneLoaded: vi.fn((cb) => { sceneListeners.add(cb); return () => sceneListeners.delete(cb); }),
    loadScene: vi.fn(() => {
      engine.activeScene = makeScene();
      for (const l of [...sceneListeners]) l(engine.activeScene);
    }),
  };
  return engine;
}

/** Pointer lock that grants or refuses on request, and reports changes. */
function makeLock() {
  const listeners = new Set();
  const lock = {
    locked: false,
    grant: true,
    request: vi.fn(async () => {
      if (lock.grant) lock._set(true);
      return lock.grant;
    }),
    exit: vi.fn(() => { if (lock.locked) lock._set(false); }),
    onChange: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    _set(v) { lock.locked = v; for (const l of [...listeners]) l(v); },
    /** Test helper: the browser drops the lock (Esc, alt-tab). */
    lose() { lock._set(false); },
  };
  return lock;
}

/** A fade that goes black at once. */
const makeFade = () => ({ playing: false, play: vi.fn((cb) => { cb(); return true; }) });

function makeDom() {
  document.body.innerHTML = '<div id="menu"><div id="menu-status"></div><div id="menu-panel"></div></div>';
  delete document.body.dataset.app;
  return new MenuView(document.getElementById('menu'));
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const click = async (action) => {
  const el = document.querySelector(`#menu-panel [data-action="${action}"]`);
  if (!el) throw new Error(`no [data-action="${action}"] on screen ${document.getElementById('menu').dataset.screen}`);
  el.click();
  await flush();
};
const key = (code, type = 'keydown') => {
  const e = new KeyboardEvent(type, { code, bubbles: true, cancelable: true });
  window.dispatchEvent(e);
  return e;
};

describe('App', () => {
  let engine, lock, view, fade, app;

  beforeEach(async () => {
    engine = makeEngine();
    lock = makeLock();
    view = makeDom();
    fade = makeFade();
    app = new App(engine, { pointerLock: lock, view, fade, version: '9.9.9', storage: new Map() });
    await app.start();
  });

  afterEach(() => app.dispose());

  /** Main menu → playing. */
  async function startGame() {
    await click('newGame');
    expect(app.flow.state).toBe('playing');
  }

  describe('boot', () => {
    it('keeps the engine paused under the main menu', () => {
      expect(engine.paused).toBe(true);
      expect(document.body.dataset.app).toBe('menu');
      expect(view.visible).toBe(true);
      expect(view.screen).toBe('main');
      expect(document.getElementById('menu-panel').textContent).toContain('v9.9.9');
    });

    it('waits for the reveal before showing the menu', async () => {
      let reveal;
      const e2 = makeEngine();
      e2.revealed = new Promise((r) => { reveal = r; });
      const v2 = makeDom();
      const a2 = new App(e2, { pointerLock: makeLock(), view: v2, fade: makeFade(), storage: new Map() });
      const started = a2.start();
      await flush();
      expect(v2.visible).toBe(false);
      expect(document.body.dataset.app).toBeUndefined();
      reveal();
      await started;
      expect(v2.visible).toBe(true);
      a2.dispose();
    });

    it('writes station status lines in the corner', () => {
      expect(document.getElementById('menu-status').textContent).toContain('STATION: STANDBY');
    });
  });

  describe('new game', () => {
    it('requests the lock in the click, then unpauses once it is granted', async () => {
      await startGame();
      expect(lock.request).toHaveBeenCalledOnce();
      expect(engine.paused).toBe(false);
      expect(document.body.dataset.app).toBe('playing');
      expect(view.visible).toBe(false);
    });

    it('wakes the audio context on the click', async () => {
      await startGame();
      expect(engine.audioListener.context.resume).toHaveBeenCalled();
    });

    it('stays in the menu with a message when the lock is refused', async () => {
      lock.grant = false;
      await click('newGame');
      expect(app.flow.state).toBe('mainMenu');
      expect(engine.paused).toBe(true);
      expect(document.getElementById('menu-panel').textContent).toMatch(/click again/i);
    });

    it('does not rebuild the fresh scene it starts on', async () => {
      await startGame();
      expect(engine.loadScene).not.toHaveBeenCalled();
    });
  });

  describe('pausing', () => {
    beforeEach(startGame);

    it('losing the lock pauses and shows the pause menu', () => {
      lock.lose();
      expect(app.flow.state).toBe('paused');
      expect(engine.paused).toBe(true);
      expect(view.screen).toBe('pause');
      expect(document.body.dataset.app).toBe('paused');
    });

    it('losing the lock to the level editor does not pause', () => {
      engine.levelEditor.enabled = true;
      lock.lose();
      expect(app.flow.state).toBe('playing');
      expect(engine.paused).toBe(false);
    });

    it('Escape pauses (when the lock never took)', () => {
      key('Escape');
      expect(app.flow.state).toBe('paused');
    });

    it('a hidden tab pauses', () => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(app.flow.state).toBe('paused');
      delete document.hidden;
    });

    it('window blur pauses', () => {
      window.dispatchEvent(new Event('blur'));
      expect(app.flow.state).toBe('paused');
    });

    it('the status block reads night, clock and signals when it opens', () => {
      lock.lose();
      expect(document.getElementById('menu-panel').textContent).toContain('NIGHT 1 · 3:14 AM · SIGNALS 2/4');
    });

    it('Escape on the pause root does nothing', () => {
      lock.lose();
      key('Escape');
      expect(app.flow.state).toBe('paused');
      expect(view.screen).toBe('pause');
    });
  });

  describe('resume', () => {
    beforeEach(async () => { await startGame(); lock.lose(); });

    it('unpauses only after the lock is granted', async () => {
      engine.setPaused.mockClear();
      await click('resume');
      expect(engine.setPaused).toHaveBeenCalledWith(false);
      expect(app.flow.state).toBe('playing');
    });

    it('stays paused with a retry hint when the lock is refused', async () => {
      lock.grant = false;
      await click('resume');
      expect(app.flow.state).toBe('paused');
      expect(engine.paused).toBe(true);
      expect(document.getElementById('menu-panel').textContent).toContain('Click RESUME again');
    });
  });

  describe('menus over the game', () => {
    beforeEach(async () => { await startGame(); lock.lose(); });

    it('controls opens from pause and Escape goes back', async () => {
      await click('controls');
      expect(view.screen).toBe('controls');
      expect(document.getElementById('menu-panel').textContent).toContain('Interact');
      key('Escape');
      expect(view.screen).toBe('pause');
    });

    it('swallows keydowns behind an open menu, but never keyups', () => {
      const behind = vi.fn();
      window.addEventListener('keydown', behind);
      window.addEventListener('keyup', behind);
      key('KeyS');
      key('Backquote');
      expect(behind).not.toHaveBeenCalled();
      key('KeyS', 'keyup');
      expect(behind).toHaveBeenCalledOnce();
      window.removeEventListener('keydown', behind);
      window.removeEventListener('keyup', behind);
    });

    it('lets keydowns through while playing', async () => {
      await click('resume');
      const behind = vi.fn();
      window.addEventListener('keydown', behind);
      key('KeyW');
      expect(behind).toHaveBeenCalledOnce();
      window.removeEventListener('keydown', behind);
    });
  });

  describe('restart night', () => {
    beforeEach(async () => {
      await startGame();
      engine.activeScene.nights.setNight(2);
      lock.lose();
    });

    it('asks for confirmation, with Cancel focused', async () => {
      await click('restart');
      expect(view.screen).toBe('confirm');
      expect(document.getElementById('menu-panel').textContent).toContain('Restart night 2?');
      expect(document.activeElement.dataset.action).toBe('cancel');
      await click('cancel');
      expect(view.screen).toBe('pause');
      expect(engine.loadScene).not.toHaveBeenCalled();
    });

    it('rebuilds once under a fade, returns to the same night and plays', async () => {
      await click('restart');
      await click('confirm');
      expect(fade.play).toHaveBeenCalledOnce();
      expect(engine.loadScene).toHaveBeenCalledOnce();
      expect(engine.activeScene.nights.setNight).toHaveBeenCalledWith(2);
      expect(app.flow.state).toBe('playing');
      expect(engine.paused).toBe(false);
    });

    it('turns the debug camera and fullbright off before rebuilding', async () => {
      engine.debugCamera.active = true;
      engine.fullbright.active = true;
      engine.loadScene.mockImplementationOnce(function () {
        expect(engine.debugCamera.disable).toHaveBeenCalled();
        expect(engine.fullbright.disable).toHaveBeenCalled();
        engine.activeScene = makeScene();
      });
      await click('restart');
      await click('confirm');
      expect(engine.loadScene).toHaveBeenCalledOnce();
    });

    it('falls back to paused when the lock is refused', async () => {
      lock.grant = false;
      await click('restart');
      await click('confirm');
      expect(engine.loadScene).toHaveBeenCalledOnce();
      expect(app.flow.state).toBe('paused');
      expect(engine.paused).toBe(true);
    });

    it('ignores a double click while the rebuild is running', async () => {
      fade.play.mockImplementation((cb) => { setTimeout(cb, 5); return true; });
      await click('restart');
      document.querySelector('[data-action="confirm"]').click();
      document.querySelector('[data-action="confirm"]').click();
      await new Promise((r) => setTimeout(r, 20));
      expect(engine.loadScene).toHaveBeenCalledOnce();
    });
  });

  describe('main menu from pause', () => {
    beforeEach(async () => { await startGame(); lock.lose(); });

    it('rebuilds, stays paused, and the next New game does not rebuild again', async () => {
      await click('quit');
      expect(view.screen).toBe('confirm');
      await click('confirm');
      expect(engine.loadScene).toHaveBeenCalledOnce();
      expect(app.flow.state).toBe('mainMenu');
      expect(view.screen).toBe('main');
      expect(engine.paused).toBe(true);

      await click('newGame');
      expect(engine.loadScene).toHaveBeenCalledOnce();
      expect(app.flow.state).toBe('playing');
    });
  });

  describe('game controller events', () => {
    beforeEach(startGame);

    it('gameOver shows Night failed, pauses, and exits the lock after the state change', async () => {
      const exitSpy = lock.exit;
      exitSpy.mockImplementation(() => {
        expect(app.flow.state).toBe('ended');
        lock._set(false);
      });
      engine.activeScene.gameController.fire('gameOver');
      expect(view.screen).toBe('nightFailed');
      expect(engine.paused).toBe(true);
      expect(exitSpy).toHaveBeenCalled();
      expect(app.flow.state).toBe('ended');   // not paused by the lost lock
      expect(document.getElementById('menu-panel').textContent).toContain('Night 1 failed: 2/4 signals');
    });

    it('Retry from Night failed rebuilds the same night', async () => {
      engine.activeScene.nights.setNight(3);
      engine.activeScene.gameController.fire('gameOver');
      await click('retry');
      expect(engine.loadScene).toHaveBeenCalledOnce();
      expect(engine.activeScene.nights.setNight).toHaveBeenCalledWith(3);
      expect(app.flow.state).toBe('playing');
    });

    it('finished shows Run complete; Main menu rebuilds', async () => {
      engine.activeScene.gameController.fire('finished');
      expect(view.screen).toBe('runComplete');
      expect(document.body.dataset.app).toBe('ended');
      await click('quit');
      expect(engine.loadScene).toHaveBeenCalledOnce();
      expect(view.screen).toBe('main');
    });

    it('follows the new controller after a rebuild, and drops the old one', async () => {
      const old = engine.activeScene.gameController;
      lock.lose();
      await click('restart');
      await click('confirm');
      expect(old.listenerCount).toBe(0);
      engine.activeScene.gameController.fire('gameOver');
      expect(view.screen).toBe('nightFailed');
    });
  });
});
