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
      expect(items(view).map(b => b.dataset.action)).toEqual(['newGame', 'settings', 'credits']);
      expect(text.toLowerCase()).not.toContain('quit');
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
        .toEqual(['resume', 'settings', 'controls', 'restart', 'quit']);
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

  it('the night failed screen reports the night and the signals', () => {
    view.show('nightFailed', { night: 2, saved: 1, required: 4 });
    expect(view.panel.textContent).toContain('SIGNAL LOST');
    expect(view.panel.textContent).toContain('Night 2 failed: 1/4 signals');
    expect(items(view).map(b => b.dataset.action)).toEqual(['retry', 'quit']);
  });

  it('the controls screen lists its groups read-only, with a Back', () => {
    view.show('controls', { groups: [{ title: 'PLAYER', rows: [{ label: 'Jump', keys: 'Space' }] }] });
    expect(view.panel.textContent).toContain('PLAYER');
    expect(view.panel.textContent).toContain('Jump');
    expect(view.panel.textContent).toContain('Space');
    expect(items(view).map(b => b.dataset.action)).toEqual(['back']);
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
      byAction(view, 'settings').disabled = true;
      view.handleKey(new KeyboardEvent('keydown', { code: 'ArrowDown' }));
      expect(document.activeElement).toBe(byAction(view, 'credits'));
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
});
