// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MenuView } from './MenuView.js';

function makeRoot() {
  document.body.innerHTML = '<div id="menu"><div id="menu-status"></div><div id="menu-panel"></div></div>';
  return document.getElementById('menu');
}

const items = (view) => [...view.panel.querySelectorAll('[data-action]')];
const byAction = (view, action) => view.panel.querySelector(`[data-action="${action}"]`);

describe('MenuView', () => {
  let view, intents;
  beforeEach(() => {
    view = new MenuView(makeRoot());
    intents = [];
    view.onIntent((action, data) => intents.push([action, data]));
  });

  it('starts hidden, and show/hide toggle it', () => {
    expect(view.visible).toBe(false);
    view.show('pause', { status: 'NIGHT 1' });
    expect(view.visible).toBe(true);
    expect(view.root.dataset.screen).toBe('pause');
    view.hide();
    expect(view.visible).toBe(false);
  });

  it('is a no-op without a root', () => {
    const headless = new MenuView(null);
    expect(() => {
      headless.show('main', {});
      headless.hide();
      headless.setHint('x');
      headless.setStatus(['a']);
    }).not.toThrow();
    expect(headless.visible).toBe(false);
  });

  describe('main menu', () => {
    const model = { tagline: ['> ONE.', '> TWO.'], version: '0.0.1', continueNight: null };

    it('shows the title, tagline, version and the main buttons — no Quit', () => {
      view.show('main', model);
      const text = view.panel.textContent;
      expect(text).toContain('DEAD AIR');
      expect(text).toContain('> ONE.');
      expect(text).toContain('0.0.1');
      expect(items(view).map(b => b.dataset.action)).toEqual(['newGame', 'nightSelect', 'settings', 'credits']);
      expect(text.toLowerCase()).not.toContain('quit');
    });

    it('credits the menu music, small, in a corner of its own', () => {
      view.show('main', model);
      const credit = view.panel.querySelector('.menu-music-credit');
      expect(credit).not.toBeNull();
      expect(credit.textContent).toContain('Space Ambient');
      expect(credit.textContent).toContain('YuraSoop');
      // Only where the music is introduced: not on the pause screen.
      view.show('pause', { status: 'NIGHT 1' });
      expect(view.panel.querySelector('.menu-music-credit')).toBeNull();
    });

    it('offers the tutorial when the scene has one, after Continue', () => {
      view.show('main', { ...model, continueNight: 2, tutorial: true });
      expect(items(view).map(b => b.dataset.action))
        .toEqual(['newGame', 'continue', 'tutorial', 'nightSelect', 'settings', 'credits']);
      expect(byAction(view, 'tutorial').textContent).toMatch(/tutorial/i);
    });

    it('offers Continue with the saved night', () => {
      view.show('main', { ...model, continueNight: 2 });
      expect(byAction(view, 'continue').textContent).toMatch(/night 2/i);
    });

    it('focuses the first option', () => {
      view.show('main', model);
      expect(document.activeElement).toBe(byAction(view, 'newGame'));
    });

    it('emits the action of a clicked option', () => {
      view.show('main', model);
      byAction(view, 'settings').click();
      expect(intents).toEqual([['settings', expect.any(Object)]]);
    });
  });

  describe('pause', () => {
    it('shows the status and the pause options', () => {
      view.show('pause', { status: 'NIGHT 2 · 03:14 AM · SIGNALS 2/4' });
      expect(view.panel.textContent).toContain('PAUSED');
      expect(view.panel.textContent).toContain('NIGHT 2 · 03:14 AM · SIGNALS 2/4');
      expect(items(view).map(b => b.dataset.action))
        .toEqual(['resume', 'settings', 'restart', 'quit']);
    });

    it('shows a hint line that setHint can change', () => {
      view.show('pause', { status: '' });
      view.setHint('Click RESUME again to continue.');
      expect(view.panel.textContent).toContain('Click RESUME again');
    });
  });

  it('the confirm dialog defaults focus to Cancel', () => {
    view.show('confirm', { message: 'Restart night 2?', confirmLabel: 'Restart night' });
    expect(view.panel.textContent).toContain('Restart night 2?');
    expect(document.activeElement).toBe(byAction(view, 'cancel'));
    byAction(view, 'confirm').click();
    expect(intents[0][0]).toBe('confirm');
  });

  it('the night failed screen reports the night and the drives', () => {
    view.show('nightFailed', { night: 2, saved: 1, required: 4 });
    expect(view.panel.textContent).toContain('SIGNAL LOST');
    expect(view.panel.textContent).toContain('Night 2 failed: 1/4 drives');
    expect(items(view).map(b => b.dataset.action)).toEqual(['retry', 'quit']);
  });

  it('Night failed names the processed drives too, on a night that asks for them', () => {
    view.show('nightFailed', { night: 2, saved: 4, required: 6, processed: 1, processedRequired: 2 });
    expect(view.panel.textContent).toContain('Night 2 failed: 4/6 drives, 1/2 processed');
  });

  it('a settings heading row draws a subheading', () => {
    view.show('settings', { tabs: [], tab: 'controls', rows: [{ type: 'heading', label: 'COMPUTER TERMINAL' }] });
    expect(view.panel.querySelector('.menu-settings h3').textContent).toBe('COMPUTER TERMINAL');
  });

  describe('one highlight at a time (#75)', () => {
    const hover = (el) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

    it('hovering an option moves the focus to it, so the old one stops highlighting', () => {
      view.show('pause', { status: '' });
      expect(document.activeElement).toBe(byAction(view, 'resume'));
      hover(byAction(view, 'settings'));
      expect(document.activeElement).toBe(byAction(view, 'settings'));
    });

    it('arrow keys carry on from the hovered option', () => {
      view.show('pause', { status: '' });
      hover(byAction(view, 'settings'));
      view.handleKey(new KeyboardEvent('keydown', { code: 'ArrowDown' }));
      expect(document.activeElement).toBe(byAction(view, 'restart'));
    });

    it('hovering a disabled option leaves the focus where it is', () => {
      view.show('main', { tagline: [], version: '1', continueNight: null });
      byAction(view, 'settings').disabled = true;
      hover(byAction(view, 'settings'));
      expect(document.activeElement).toBe(byAction(view, 'newGame'));
    });

    it('hovering the gaps between options changes nothing', () => {
      view.show('pause', { status: '' });
      hover(view.panel);
      expect(document.activeElement).toBe(byAction(view, 'resume'));
    });
  });

  describe('keyboard', () => {
    it('ArrowDown and ArrowUp move focus, wrapping', () => {
      view.show('pause', { status: '' });
      const [first, second] = items(view);
      expect(view.handleKey(new KeyboardEvent('keydown', { code: 'ArrowDown' }))).toBe(true);
      expect(document.activeElement).toBe(second);
      view.handleKey(new KeyboardEvent('keydown', { code: 'ArrowUp' }));
      view.handleKey(new KeyboardEvent('keydown', { code: 'ArrowUp' }));
      expect(document.activeElement).toBe(items(view).at(-1));
      view.handleKey(new KeyboardEvent('keydown', { code: 'ArrowDown' }));
      expect(document.activeElement).toBe(first);
    });

    it('skips disabled options', () => {
      view.show('main', { tagline: [], version: '1', continueNight: null });
      byAction(view, 'nightSelect').disabled = true;
      view.handleKey(new KeyboardEvent('keydown', { code: 'ArrowDown' }));
      expect(document.activeElement).toBe(byAction(view, 'settings'));
    });

    it('leaves other keys to the browser', () => {
      view.show('pause', { status: '' });
      expect(view.handleKey(new KeyboardEvent('keydown', { code: 'Enter' }))).toBe(false);
    });
  });

  describe('settings', () => {
    const rows = [
      { type: 'slider', key: 'fov', label: 'FOV', min: 60, max: 100, step: 1, value: 75, format: v => `${v}°` },
      { type: 'choice', key: 'shadows', label: 'SHADOWS', value: 'high',
        options: [{ value: 'off', label: 'OFF' }, { value: 'low', label: 'LOW' }, { value: 'high', label: 'HIGH' }] },
      { type: 'choice', key: 'invertY', label: 'INVERT Y', value: false,
        options: [{ value: false, label: 'OFF' }, { value: true, label: 'ON' }] },
      { type: 'bind', action: 'jump', label: 'Jump', keyText: 'Space', capturing: false },
      { type: 'info', label: 'Fly camera', text: 'V' },
    ];
    const model = (extra = {}) => ({
      tabs: [{ id: 'game', label: 'GAME' }, { id: 'video', label: 'VIDEO' }], tab: 'video', rows, message: '', ...extra,
    });

    it('renders tabs, marking the current one', () => {
      view.show('settings', model());
      const tabs = [...view.panel.querySelectorAll('[data-action="tab"]')];
      expect(tabs.map(t => t.textContent)).toEqual(['GAME', 'VIDEO']);
      expect(tabs[1].getAttribute('aria-selected')).toBe('true');
      tabs[0].click();
      expect(intents.at(-1)).toEqual(['tab', expect.objectContaining({ tab: 'game' })]);
    });

    it('prints a slider value next to it, and updates it live on input', () => {
      view.show('settings', model());
      const slider = view.panel.querySelector('input[data-setting="fov"]');
      expect(view.panel.textContent).toContain('75°');
      slider.value = '90';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      expect(view.panel.textContent).toContain('90°');
      expect(intents.at(-1)).toEqual(['setting', { key: 'fov', value: 90 }]);
    });

    it('marks the selected choice and emits typed values', () => {
      view.show('settings', model());
      const high = view.panel.querySelector('[data-setting="shadows"][aria-pressed="true"]');
      expect(high.textContent).toBe('HIGH');
      view.panel.querySelector('[data-setting="invertY"][aria-pressed="false"]').click();
      expect(intents.at(-1)).toEqual(['setting', { key: 'invertY', value: true }]);
    });

    it('a bind row asks to rebind; while capturing it says so', () => {
      view.show('settings', model());
      view.panel.querySelector('[data-action="rebind"]').click();
      expect(intents.at(-1)).toEqual(['rebind', expect.objectContaining({ bindAction: 'jump' })]);
      view.show('settings', model({ rows: [{ ...rows[3], capturing: true }] }));
      expect(view.panel.textContent).toContain('PRESS A KEY');
    });

    it('shows the message line, and offers Reset tab and Back', () => {
      view.show('settings', model({ message: 'Q is reserved' }));
      expect(view.panel.textContent).toContain('Q is reserved');
      expect(byAction(view, 'resetTab')).not.toBeNull();
      expect(byAction(view, 'back')).not.toBeNull();
    });

    it('keeps focus on the same control across a re-render', () => {
      view.show('settings', model());
      const low = view.panel.querySelector('[data-setting="shadows"][data-value="\\"low\\""]');
      low.focus();
      view.show('settings', model());
      expect(document.activeElement.dataset.setting).toBe('shadows');
      expect(document.activeElement.textContent).toBe('LOW');
    });
  });

  describe('credits', () => {
    const blocks = [
      { heading: 'TEAM', items: [{ parts: [{ text: 'drax9207 (Adrian Draxl): architecture' }] }] },
      { heading: 'MODELS', items: [{ title: 'Crate', parts: [{ text: '"Crate" (' }, { href: 'https://x.test/c', text: 'https://x.test/c' }, { text: ')' }] }] },
    ];

    it('lists every block with links that open in a new tab', () => {
      view.show('credits', { blocks, mode: 'list' });
      expect(view.panel.textContent).toContain('drax9207 (Adrian Draxl)');
      const link = view.panel.querySelector('a[href="https://x.test/c"]');
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener');
      expect(byAction(view, 'back')).not.toBeNull();
    });

    it('a block with no heading draws no heading', () => {
      view.show('credits', { blocks: [{ heading: null, items: [{ parts: [{ text: 'Course line' }] }] }], mode: 'list' });
      expect(view.panel.querySelectorAll('.menu-credits h3').length).toBe(0);
      expect(view.panel.textContent).toContain('Course line');
    });

    it('escapes text rather than parsing it as HTML', () => {
      view.show('credits', { blocks: [{ heading: 'X', items: [{ parts: [{ text: '<img src=x onerror=alert(1)>' }] }] }], mode: 'list' });
      expect(view.panel.querySelector('img')).toBeNull();
    });

    it('run complete rolls the credits with a Main menu button available at once', () => {
      view.show('runComplete', { blocks });
      expect(view.panel.textContent).toContain('You made it through every shift.');
      expect(view.panel.querySelector('.menu-roll')).not.toBeNull();
      expect(byAction(view, 'quit')).not.toBeNull();
    });
  });

  it('setStatus writes the corner status lines', () => {
    view.setStatus(['STATION: STANDBY', 'LINK: OK']);
    expect(view.root.querySelector('#menu-status').textContent).toContain('LINK: OK');
  });

  it('night select lists each night, locked ones disabled, with a Back', () => {
    view.show('nightSelect', { maxNight: 3, highest: 2 });
    const nights = [...view.panel.querySelectorAll('[data-action="selectNight"]')];
    expect(nights.map(b => b.dataset.night)).toEqual(['1', '2', '3']);
    expect(nights.map(b => b.disabled)).toEqual([false, false, true]);
    expect(nights[2].textContent).toMatch(/locked/i);
    expect(view.panel.querySelector('[data-action="back"]')).not.toBeNull();
  });

  it('the main menu offers Select night', () => {
    view.show('main', { tagline: [], version: '1', continueNight: null });
    expect(view.panel.querySelector('[data-action="nightSelect"]')).not.toBeNull();
  });

  describe('dev console', () => {
    const COMMANDS = [
      { name: 'stamina', usage: 'stamina [0–1]', help: 'Show or set stamina' },
      { name: 'storm', usage: 'storm', help: 'Start a sandstorm now' },
      { name: 'suit', usage: 'suit [on|off]', help: 'The EVA suit' },
    ];
    /** DevConsole.suggest's shape: guesses by prefix; past a space, the format line. */
    const suggest = (text) => {
      const t = text.trimStart();
      if (!t) return [];
      if (t.includes(' ')) {
        const command = COMMANDS.find(c => c.name === t.split(' ')[0]);
        return command ? [{ ...command, format: true }] : [];
      }
      return COMMANDS.filter(c => c.name.startsWith(t));
    };
    const LINES = [
      { text: '> stamna', kind: 'input' },
      { text: 'Unknown command "stamna". Did you mean stamina?', kind: 'error' },
      { text: 'Stamina 0.20 (tired)', kind: 'output' },
    ];

    const input = () => view.panel.querySelector('input[data-console]');
    const list = () => view.panel.querySelector('.menu-console-suggest');
    const rows = () => [...list().querySelectorAll('li')];
    const type = (text) => {
      input().focus();
      input().value = text;
      input().dispatchEvent(new Event('input', { bubbles: true }));
    };
    const press = (code) => view.handleKey(new KeyboardEvent('keydown', { code, cancelable: true }));
    const show = (model = {}) => view.show('console', { lines: LINES, draft: '', suggest, ...model });

    it('draws the log, a line each, what was typed and the errors marked', () => {
      show();
      const lines = [...view.panel.querySelectorAll('.menu-console-line')];
      expect(lines.map(l => l.textContent)).toEqual(LINES.map(l => l.text));
      expect(lines[0].classList.contains('is-input')).toBe(true);
      expect(lines[1].classList.contains('is-error')).toBe(true);
      expect(lines[2].className).toBe('menu-console-line');
    });

    it('writes the log as text, never markup', () => {
      show({ lines: [{ text: '<b>bold</b>', kind: 'output' }] });
      expect(view.panel.querySelector('.menu-console-log b')).toBeNull();
      expect(view.panel.querySelector('.menu-console-line').textContent).toBe('<b>bold</b>');
    });

    it('focuses an input showing the ghost text until something is typed', () => {
      show();
      expect(document.activeElement).toBe(input());
      expect(input().placeholder).toBe('Type "help" for a list of commands');
      expect(input().value).toBe('');
      expect(input().getAttribute('autocomplete')).toBe('off');
      expect(input().spellcheck).toBe(false);
    });

    it('holds the draft (a line recalled from the history), the caret at its end', () => {
      show({ draft: 'stamina 0.5' });
      expect(input().value).toBe('stamina 0.5');
      expect(input().selectionStart).toBe('stamina 0.5'.length);
    });

    it('has a Back option', () => {
      show();
      expect(byAction(view, 'back')).not.toBeNull();
    });

    describe('the guesses', () => {
      it('stay hidden until something is typed', () => {
        show({ draft: 'st' });
        expect(list().hidden).toBe(true);
      });

      it('drop down as you type: each command with its format and what it does', () => {
        show();
        type('st');
        expect(list().hidden).toBe(false);
        expect(rows()).toHaveLength(2);
        expect(rows()[0].textContent).toContain('stamina [0–1]');
        expect(rows()[0].textContent).toContain('Show or set stamina');
        expect(rows()[1].textContent).toContain('storm');
        expect(intents).toEqual([]);
      });

      it('go away when the input is emptied or nothing matches', () => {
        show();
        type('st');
        type('');
        expect(list().hidden).toBe(true);
        type('zz');
        expect(list().hidden).toBe(true);
      });

      it('clicking one completes the command, keeps the focus, and shows its format', () => {
        show();
        type('st');
        rows()[0].click();
        expect(input().value).toBe('stamina ');
        expect(document.activeElement).toBe(input());
        expect(rows()).toHaveLength(1);
        expect(rows()[0].classList.contains('is-format')).toBe(true);
        expect(rows()[0].textContent).toContain('stamina [0–1]');
        expect(intents).toEqual([]);
      });

      it('the format line is a reminder, not a guess to pick', () => {
        show();
        type('stamina 0');
        rows()[0].click();
        expect(input().value).toBe('stamina 0');
      });

      it('a redraw (after a line runs) closes them', () => {
        show();
        type('st');
        show();
        expect(list().hidden).toBe(true);
      });
    });

    describe('keys in the input', () => {
      it('↓ / ↑ move a highlight through the guesses, wrapping', () => {
        show();
        type('s');
        expect(press('ArrowDown')).toBe(true);
        expect(rows()[0].getAttribute('aria-selected')).toBe('true');
        press('ArrowDown');
        expect(rows()[1].getAttribute('aria-selected')).toBe('true');
        expect(rows()[0].getAttribute('aria-selected')).toBe('false');
        press('ArrowUp');
        press('ArrowUp');
        expect(rows()[2].getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(input());
        expect(intents).toEqual([]);
      });

      it('Enter takes the highlighted guess', () => {
        show();
        type('st');
        press('ArrowDown');
        expect(press('Enter')).toBe(true);
        expect(input().value).toBe('stamina ');
        expect(intents).toEqual([]);
      });

      it('Enter runs the line when no guess is highlighted', () => {
        show();
        type('stamina 0.2');
        expect(press('Enter')).toBe(true);
        expect(intents).toEqual([['consoleRun', { line: 'stamina 0.2' }]]);
      });

      it('Tab completes the top guess, or the highlighted one', () => {
        show();
        type('st');
        expect(press('Tab')).toBe(true);
        expect(input().value).toBe('stamina ');
        type('st');
        press('ArrowDown');
        press('ArrowDown');
        press('Tab');
        expect(input().value).toBe('storm ');
      });

      it('Tab with nothing to complete is left to the browser', () => {
        show();
        type('stamina 0');
        expect(press('Tab')).toBe(false);
      });

      it('↑ / ↓ walk the history while there are no guesses to move through', () => {
        show();
        input().focus();
        press('ArrowUp');
        press('ArrowDown');
        type('stamina ');
        press('ArrowUp');
        expect(intents).toEqual([
          ['consoleHistory', { dir: 'prev' }],
          ['consoleHistory', { dir: 'next' }],
          ['consoleHistory', { dir: 'prev' }],
        ]);
      });

      it('← / → move the caret, as in any text box', () => {
        show();
        type('st');
        expect(press('ArrowLeft')).toBe(false);
        expect(press('ArrowRight')).toBe(false);
      });
    });

    it('off the input, the arrows move between it and Back as on any screen', () => {
      show();
      byAction(view, 'back').focus();
      press('ArrowDown');
      expect(document.activeElement).toBe(input());
      expect(intents).toEqual([]);
    });
  });
});
