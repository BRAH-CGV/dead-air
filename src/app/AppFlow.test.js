import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppFlow } from './AppFlow.js';

describe('AppFlow', () => {
  let flow;
  beforeEach(() => { flow = new AppFlow(); });

  /** Drive the flow to `playing` the way a first New game does. */
  function play() {
    flow.ready();
    flow.newGame();
  }

  it('starts in loading with no screen; ready() goes to the main menu', () => {
    expect(flow.state).toBe('loading');
    expect(flow.screen).toBe(null);
    flow.ready();
    expect(flow.state).toBe('mainMenu');
    expect(flow.screen).toBe('main');
  });

  describe('new game', () => {
    it('goes from the main menu to playing', () => {
      flow.ready();
      flow.newGame();
      expect(flow.state).toBe('playing');
      expect(flow.screen).toBe(null);
    });

    it('needs no rebuild over the fresh scene the menu sits on', () => {
      flow.ready();
      expect(flow.needsRebuild).toBe(false);
      expect(flow.newGame()).toEqual({ needsRebuild: false });
    });

    it('marks the scene dirty once played, and clean again after markClean()', () => {
      play();
      expect(flow.needsRebuild).toBe(true);
      flow.markClean();
      expect(flow.needsRebuild).toBe(false);
    });

    it('is ignored outside the main menu root', () => {
      play();
      flow.pause();
      flow.newGame();
      expect(flow.state).toBe('paused');
    });
  });

  describe('pause and resume', () => {
    it('pauses only from playing, onto the pause screen', () => {
      play();
      flow.pause();
      expect(flow.state).toBe('paused');
      expect(flow.screen).toBe('pause');
    });

    it('is idempotent', () => {
      play();
      const listener = vi.fn();
      flow.onChange(listener);
      flow.pause();
      flow.pause();
      expect(listener).toHaveBeenCalledOnce();
    });

    it('is ignored in the main menu, the end screens and sub-screens', () => {
      flow.ready();
      flow.pause();
      expect(flow.state).toBe('mainMenu');

      play();
      flow.nightFailed();
      flow.pause();
      expect(flow.screen).toBe('nightFailed');
    });

    it('resumes only from paused', () => {
      flow.ready();
      flow.resume();
      expect(flow.state).toBe('mainMenu');
      flow.newGame();
      flow.pause();
      flow.resume();
      expect(flow.state).toBe('playing');
      expect(flow.screen).toBe(null);
    });

    it('does not resume from a sub-screen of pause', () => {
      play();
      flow.pause();
      flow.openSettings();
      flow.resume();
      expect(flow.screen).toBe('settings');
    });
  });

  describe('sub-screens and back', () => {
    it('settings from pause returns to pause', () => {
      play();
      flow.pause();
      flow.openSettings();
      expect(flow.screen).toBe('settings');
      flow.back();
      expect(flow.screen).toBe('pause');
    });

    it('settings from the main menu returns to the main menu', () => {
      flow.ready();
      flow.openSettings();
      expect(flow.screen).toBe('settings');
      expect(flow.state).toBe('mainMenu');
      flow.back();
      expect(flow.screen).toBe('main');
    });

    it('controls from pause, and from settings, return to the opener', () => {
      play();
      flow.pause();
      flow.openControls();
      flow.back();
      expect(flow.screen).toBe('pause');
      flow.openSettings();
      flow.openControls();
      flow.back();
      expect(flow.screen).toBe('settings');
    });

    it('credits open from the main menu only', () => {
      flow.ready();
      flow.openCredits();
      expect(flow.screen).toBe('credits');
      flow.back();
      play();
      flow.pause();
      flow.openCredits();
      expect(flow.screen).toBe('pause');
    });

    it('a confirm dialog opens from pause, carries its action, and back cancels it', () => {
      play();
      flow.pause();
      flow.openConfirm('restart');
      expect(flow.screen).toBe('confirm');
      expect(flow.confirmAction).toBe('restart');
      flow.back();
      expect(flow.screen).toBe('pause');
      expect(flow.confirmAction).toBe(null);
    });

    it.each([
      ['pause', () => { play(); flow.pause(); }],
      ['main', () => { flow.ready(); }],
      ['nightFailed', () => { play(); flow.nightFailed(); }],
      ['runComplete', () => { play(); flow.runComplete(); }],
    ])('back() on the %s root is a no-op', (screen, setup) => {
      setup();
      const listener = vi.fn();
      flow.onChange(listener);
      flow.back();
      expect(flow.screen).toBe(screen);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('end states', () => {
    it('night failed goes from playing to ended', () => {
      play();
      flow.nightFailed();
      expect(flow.state).toBe('ended');
      expect(flow.screen).toBe('nightFailed');
    });

    it('run complete goes from playing (or paused, mid-fade) to ended', () => {
      play();
      flow.runComplete();
      expect(flow.screen).toBe('runComplete');

      flow.quitToMenu();
      flow.markClean();
      flow.newGame();
      flow.pause();
      flow.runComplete();
      expect(flow.screen).toBe('runComplete');
    });

    it('end states are ignored from the menu', () => {
      flow.ready();
      flow.nightFailed();
      flow.runComplete();
      expect(flow.state).toBe('mainMenu');
    });
  });

  describe('quit and restart', () => {
    it('quits to the main menu from paused or ended', () => {
      play();
      flow.pause();
      flow.quitToMenu();
      expect(flow.state).toBe('mainMenu');
      expect(flow.screen).toBe('main');

      flow.markClean();
      flow.newGame();
      flow.nightFailed();
      flow.quitToMenu();
      expect(flow.state).toBe('mainMenu');
    });

    it('quit is ignored while playing', () => {
      play();
      flow.quitToMenu();
      expect(flow.state).toBe('playing');
    });

    it('restart goes back to playing from paused or ended', () => {
      play();
      flow.pause();
      flow.restart();
      expect(flow.state).toBe('playing');
      flow.nightFailed();
      flow.restart();
      expect(flow.state).toBe('playing');
    });

    it('a restart whose pointer lock was refused can fall back to paused', () => {
      play();
      flow.nightFailed();
      flow.restartPaused();
      expect(flow.state).toBe('paused');
      expect(flow.screen).toBe('pause');
    });
  });

  describe('listeners', () => {
    it('are told once per real change, with the flow', () => {
      const listener = vi.fn();
      flow.onChange(listener);
      flow.ready();
      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(flow);
    });

    it('unsubscribe', () => {
      const listener = vi.fn();
      const off = flow.onChange(listener);
      off();
      flow.ready();
      expect(listener).not.toHaveBeenCalled();
    });
  });

  it('isMenuOpen is true everywhere but loading and playing', () => {
    expect(flow.isMenuOpen).toBe(false);
    flow.ready();
    expect(flow.isMenuOpen).toBe(true);
    flow.newGame();
    expect(flow.isMenuOpen).toBe(false);
    flow.pause();
    expect(flow.isMenuOpen).toBe(true);
  });
});
