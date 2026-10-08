// ─────────────────────────────────────────────
// MenuView  –  draws the current menu screen into #menu
// ─────────────────────────────────────────────
// Every screen (main, pause, settings, credits, confirm, night
// failed, run complete) is drawn from a plain model into #menu-panel. The
// markup shell and all the styling live in index.html, like the other
// overlays. This class decides nothing: clicks and edits come out of
// onIntent(action, data), and App works out what they mean.
//
// Options are real <button>s, so Enter / Space / Tab behave natively;
// handleKey() adds the arrow keys on top. Text is set with textContent, never
// innerHTML: credits come from ATTRIBUTIONS.md.
//
// Every method is a no-op without a root (tests, scenes without the markup).
// ─────────────────────────────────────────────

import { TAGLINE, COPY } from './text.js';

/** Build an element: `h('button', { class: 'x', dataset: { action } }, 'Label')`. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/** A text-row option. `focusKey` lets focus survive a re-render. */
function option(action, label, { danger = false, data = {}, focusKey, defaultFocus = false } = {}) {
  return h('button', {
    type: 'button',
    class: `menu-item${danger ? ' is-danger' : ''}`,
    dataset: { action, focusKey: focusKey ?? action, ...data, ...(defaultFocus ? { defaultFocus: '' } : {}) },
  }, label);
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href]';

export class MenuView {
  /** @param {HTMLElement|null} [root]  Defaults to the page's #menu */
  constructor(root = typeof document !== 'undefined' ? document.getElementById('menu') : null) {
    this.root = root;
    this.panel  = root?.querySelector('#menu-panel')  ?? null;
    this.status = root?.querySelector('#menu-status') ?? null;
    this._intent = null;
    this._hint = null;
    this._formats = new Map();   // slider key → value formatter, for live labels
    this.screen = null;

    if (!this.panel) return;
    this.panel.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled || !this.panel.contains(el)) return;
      if (el.dataset.action === 'setting') {
        this._emit('setting', { key: el.dataset.setting, value: JSON.parse(el.dataset.value) });
      } else {
        this._emit(el.dataset.action, { ...el.dataset });
      }
    });
    this.panel.addEventListener('input', (e) => {
      const input = e.target;
      if (!input.matches?.('input[type="range"][data-setting]')) return;
      const key = input.dataset.setting;
      const value = Number(input.value);
      const label = this.panel.querySelector(`[data-value-for="${key}"]`);
      if (label) label.textContent = (this._formats.get(key) ?? String)(value);
      this._emit('setting', { key, value });
    });
  }

  /** @param {(action: string, data: object) => void} callback */
  onIntent(callback) { this._intent = callback; }

  get visible() { return !!this.root && this.root.classList.contains('is-open'); }

  /**
   * Draw a screen and open the menu.
   * @param {string} screen
   * @param {object} model  The screen's data — see each _draw* method
   */
  show(screen, model = {}) {
    if (!this.panel) return;
    const focusKey = this.screen === screen ? document.activeElement?.dataset?.focusKey : null;
    const focusValue = this.screen === screen ? document.activeElement?.dataset?.value : null;

    this.screen = screen;
    this._formats.clear();
    this._hint = null;
    const draw = {
      main: this._drawMain, pause: this._drawPause, confirm: this._drawConfirm,
      settings: this._drawSettings, credits: this._drawCredits,
      nightFailed: this._drawNightFailed, runComplete: this._drawRunComplete,
    }[screen];
    this.panel.replaceChildren(...(draw ? draw.call(this, model) : []));
    this.root.dataset.screen = screen;
    this.root.classList.add('is-open');
    this._restoreFocus(focusKey, focusValue);
  }

  hide() {
    if (!this.root) return;
    this.root.classList.remove('is-open');
    this.screen = null;
    // Focus left on a hidden button would eat the next Space press.
    if (this.root.contains(document.activeElement)) document.activeElement.blur();
  }

  /** The one-line message under the options (pause, main). */
  setHint(text) {
    if (this._hint) this._hint.textContent = text ?? '';
  }

  /** Corner status lines, e.g. `STATION: STANDBY`. */
  setStatus(lines) {
    if (this.status) this.status.replaceChildren(...lines.map(l => h('div', {}, l)));
  }

  /**
   * Arrow-key navigation. Up / Down move between options (wrapping); Left /
   * Right step through a row of choices. A slider keeps its own arrows.
   * @param {KeyboardEvent} e
   * @returns {boolean} whether the key was used
   */
  handleKey(e) {
    if (!this.panel || !this.visible) return false;
    const active = document.activeElement;
    const onSlider = active?.matches?.('input[type="range"]');
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      this.moveFocus(e.code === 'ArrowDown' ? 1 : -1);
      return true;
    }
    if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && !onSlider) {
      const group = active?.closest?.('.menu-choices, .menu-tabs');
      if (!group) return false;
      const siblings = [...group.querySelectorAll(FOCUSABLE)];
      const i = siblings.indexOf(active);
      const next = siblings[i + (e.code === 'ArrowRight' ? 1 : -1)];
      next?.focus();
      return true;
    }
    return false;
  }

  /** Move focus by `delta` options, wrapping at the ends. */
  moveFocus(delta) {
    const list = this._focusables();
    if (list.length === 0) return;
    const i = list.indexOf(document.activeElement);
    const next = i === -1 ? (delta > 0 ? 0 : list.length - 1) : (i + delta + list.length) % list.length;
    list[next].focus();
  }

  // ── Screens ───────────────────────────────

  /** @param {{ tagline?: string[], version?: string, continueNight?: number|null, hint?: string }} m */
  _drawMain({ tagline = TAGLINE, version = '', continueNight = null, hint = '' }) {
    this._hint = h('div', { class: 'menu-hint', role: 'status' }, hint);
    return [
      h('h1', { class: 'menu-title' }, COPY.title, h('span', { class: 'menu-cursor', 'aria-hidden': 'true' })),
      h('div', { class: 'menu-tagline' }, tagline.map((line, i) =>
        h('div', { class: 'menu-type', style: `--i:${i}; --chars:${line.length}` }, line))),
      h('nav', { class: 'menu-list' },
        option('newGame', 'New game'),
        continueNight ? option('continue', `Continue — Night ${continueNight}`) : null,
        option('settings', 'Settings'),
        option('credits', 'Credits'),
      ),
      this._hint,
      h('div', { class: 'menu-footer' }, version ? `v${version}` : ''),
      h('div', { class: 'menu-music-credit' }, COPY.menuMusic),
    ];
  }

  /** @param {{ status?: string, hint?: string }} m */
  _drawPause({ status = '', hint = '' }) {
    this._hint = h('div', { class: 'menu-hint', role: 'status' }, hint);
    return [
      h('h2', { class: 'menu-heading' }, COPY.paused),
      h('div', { class: 'menu-status-line' }, status),
      h('nav', { class: 'menu-list' },
        option('resume', 'Resume'),
        option('settings', 'Settings'),
        option('restart', 'Restart night', { danger: true }),
        option('quit', 'Main menu', { danger: true }),
      ),
      this._hint,
    ];
  }

  /** @param {{ message: string, confirmLabel: string }} m */
  _drawConfirm({ message = '', confirmLabel = 'Confirm' }) {
    return [
      h('h2', { class: 'menu-heading' }, 'CONFIRM'),
      h('p', { class: 'menu-text' }, message),
      h('nav', { class: 'menu-list' },
        option('cancel', 'Cancel', { defaultFocus: true }),
        option('confirm', confirmLabel, { danger: true }),
      ),
    ];
  }

  /**
   * @param {{ tabs: {id: string, label: string}[], tab: string, rows: object[], message?: string }} m
   *   rows: { type: 'slider', key, label, min, max, step, value, format? }
   *       | { type: 'choice', key, label, value, options: {value, label}[] }
   *       | { type: 'bind', action, label, keyText, capturing?, flash? }
   *       | { type: 'info', label, text }
   *       | { type: 'heading', label }
   *       | { type: 'button', action, label, data? }
   */
  _drawSettings({ tabs = [], tab, rows = [], message = '' }) {
    return [
      h('h2', { class: 'menu-heading' }, 'SETTINGS'),
      h('div', { class: 'menu-tabs', role: 'tablist' }, tabs.map(t => h('button', {
        type: 'button', class: 'menu-tab', role: 'tab', 'aria-selected': String(t.id === tab),
        dataset: { action: 'tab', tab: t.id, focusKey: 'tab', value: JSON.stringify(t.id) },
      }, t.label))),
      h('div', { class: 'menu-scroll menu-settings' }, rows.map(r => this._settingRow(r))),
      h('div', { class: 'menu-hint', role: 'status' }, message),
      h('nav', { class: 'menu-list menu-list-inline' },
        option('resetTab', 'Reset tab to defaults'),
        option('back', 'Back'),
      ),
    ];
  }

  _settingRow(r) {
    const row = (control) => h('div', { class: `menu-row${r.flash ? ' is-flash' : ''}` },
      h('span', { class: 'menu-row-label' }, r.label),
      h('span', { class: 'menu-row-dots', 'aria-hidden': 'true' }),
      control);

    if (r.type === 'slider') {
      const format = r.format ?? String;
      this._formats.set(r.key, format);
      return row(h('span', { class: 'menu-slider' },
        h('input', {
          type: 'range', min: r.min, max: r.max, step: r.step, value: r.value,
          'aria-label': r.label, dataset: { setting: r.key, focusKey: `s:${r.key}` },
        }),
        h('span', { class: 'menu-value', dataset: { valueFor: r.key } }, format(r.value))));
    }
    if (r.type === 'choice') {
      return row(h('span', { class: 'menu-choices', role: 'group', 'aria-label': r.label },
        r.options.map(o => h('button', {
          type: 'button', class: 'menu-choice', 'aria-pressed': String(o.value === r.value),
          dataset: { action: 'setting', setting: r.key, value: JSON.stringify(o.value), focusKey: `s:${r.key}` },
        }, o.label))));
    }
    if (r.type === 'bind') {
      return row(h('button', {
        type: 'button', class: `menu-bind${r.capturing ? ' is-capturing' : ''}`,
        dataset: { action: 'rebind', bindAction: r.action, focusKey: `b:${r.action}` },
      }, r.capturing ? 'PRESS A KEY… (Esc to cancel)' : r.keyText));
    }
    if (r.type === 'heading') {
      return h('h3', { class: 'menu-subheading' }, r.label);
    }
    if (r.type === 'button') {
      return h('div', { class: 'menu-row' },
        option(r.action, r.label, { data: r.data ?? {}, focusKey: `a:${r.action}` }));
    }
    return row(h('span', { class: 'menu-key' }, r.text));
  }

  /** @param {{ blocks: object[], mode?: 'list'|'roll' }} m */
  _drawCredits({ blocks = [] }) {
    return [
      h('h2', { class: 'menu-heading' }, 'CREDITS'),
      h('div', { class: 'menu-scroll menu-credits' }, this._creditBlocks(blocks)),
      h('nav', { class: 'menu-list' }, option('back', 'Back')),
    ];
  }

  /** @param {{ night: number, saved: number, required: number }} m */
  _drawNightFailed({ night = 1, saved = 0, required = 0 }) {
    return [
      h('h2', { class: 'menu-heading is-danger' }, COPY.nightFailedTitle),
      h('p', { class: 'menu-text' }, `Night ${night} failed: ${saved}/${required} drives`),
      h('nav', { class: 'menu-list' },
        option('retry', 'Retry night'),
        option('quit', 'Main menu'),
      ),
    ];
  }

  /** @param {{ blocks: object[] }} m */
  _drawRunComplete({ blocks = [] }) {
    return [
      h('h2', { class: 'menu-heading is-ok' }, COPY.runCompleteTitle),
      h('div', { class: 'menu-roll-window' },
        h('div', { class: 'menu-roll menu-credits' }, this._creditBlocks(blocks))),
      h('nav', { class: 'menu-list' }, option('quit', 'Main menu')),
    ];
  }

  /** blocks: { heading, items: { title?, parts: ({text}|{href,text})[], note?, todo? }[] }[] */
  _creditBlocks(blocks) {
    return blocks.map(b => h('section', { class: 'menu-group' },
      b.heading ? h('h3', { class: 'menu-subheading' }, b.heading) : null,
      b.items.map(item => h('div', { class: `menu-credit${item.todo ? ' is-todo' : ''}` },
        item.title ? h('div', { class: 'menu-credit-title' }, item.title) : null,
        h('div', { class: 'menu-credit-text' }, item.parts.map(p => p.href
          ? h('a', { href: p.href, target: '_blank', rel: 'noopener' }, p.text)
          : p.text)),
        item.note ? h('div', { class: 'menu-credit-note' }, item.note) : null,
      )),
    ));
  }

  // ── Internals ─────────────────────────────

  _focusables() {
    return [...this.panel.querySelectorAll(FOCUSABLE)];
  }

  _restoreFocus(focusKey, focusValue) {
    const list = this._focusables();
    const same = focusKey && list.filter(el => el.dataset.focusKey === focusKey);
    const target = (same?.length && (same.find(el => el.dataset.value === focusValue) ?? same[0]))
      || this.panel.querySelector('[data-default-focus]')
      || list.find(el => el.classList.contains('menu-item'))
      || list[0];
    target?.focus();
  }

  _emit(action, data) {
    this._intent?.(action, data);
  }
}
