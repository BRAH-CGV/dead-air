// ─────────────────────────────────────────────
// BedroomPCPanel  –  the bedroom computer's screens (#114)
// ─────────────────────────────────────────────
// Wraps #bedroom-pc in index.html (the look lives there, like the other
// overlays). Three screens, switched by BedroomPC from the keyboard:
//
//   Colony    a top-down map (colonyMap): our base and its array name, the
//             six neighbouring arrays by bearing, the buggy's route out and
//             the way on to the central hub
//   Findings  one entry per processed signal the hub has sent back
//             (RunRecord.findings). Placeholder text, clearly marked, until
//             the story has words for them
//   Forecast  an empty slot: insufficient data
//
// Text is set with textContent, never as HTML; the map is SVG built with
// createElementNS. Without markup every call is a no-op.
// ─────────────────────────────────────────────

import { withKeys } from './promptKeys.js';
import { COLONY_MAP } from './colonyMap.js';

export const PC_SCREENS = Object.freeze(['colony', 'findings', 'forecast']);

/** Every word the PC shows: one-line edits. The placeholders are marked as
 *  such; the story's words go here when there are some (docs/STORY.md). */
export const PC_TEXT = Object.freeze({
  unnamedArray: 'YOUR ARRAY',
  tabs: Object.freeze({ colony: 'COLONY', findings: 'FINDINGS', forecast: 'FORECAST' }),
  hub: 'CENTRAL HUB',
  mapNote: 'Top: the window side. Neighbours at their radar bearings.',
  placeholder: '[PLACEHOLDER]',
  findingTitle: (f) => `Night ${f.night} · signal ${f.index}`,
  findingBody: "The hub's result for this signal goes here.",
  findingsNote: 'Processed signals the buggy takes to the hub come back the evening after.',
  noFindings: 'Nothing back from the hub yet.',
  forecast: 'FORECAST — insufficient data',
  hint: '[1] [2] [3] or [←] [→] to switch · [E] or [Q] to close',
});

const SVG = 'http://www.w3.org/2000/svg';

export class BedroomPCPanel {
  /** The screen showing, kept when the panel is closed. */
  screen = 'colony';
  /** What show() was last handed. */
  _data = null;

  /** @param {HTMLElement|null} [root]  Defaults to the page's #bedroom-pc. */
  constructor(root = typeof document !== 'undefined' ? document.getElementById('bedroom-pc') : null) {
    this.root = root;
  }

  get visible() { return !!this.root && this.root.classList.contains('is-open'); }

  /**
   * @param {object} data
   * @param {string|null} data.array  The array's name, or null
   * @param {ReturnType<import('./colonyMap.js').colonyMap>} data.map
   * @param {{night: number, index: number}[]} data.findings
   */
  show(data) {
    this._data = data;
    if (!this.root) return;
    this._render();
    this.root.classList.add('is-open');
  }

  hide() {
    this.root?.classList.remove('is-open');
  }

  setScreen(name) {
    if (!PC_SCREENS.includes(name) || name === this.screen) return;
    this.screen = name;
    if (this.root && this._data) this._render();
  }

  /** The next screen ([dir] 1) or the one before (-1), round the ends. */
  step(dir) {
    const n = PC_SCREENS.length;
    const i = PC_SCREENS.indexOf(this.screen);
    this.setScreen(PC_SCREENS[(i + dir + n) % n]);
  }

  _render() {
    const { array, map, findings } = this._data;
    const header = el('div', 'pc-header');
    header.append(el('div', 'pc-array', array || PC_TEXT.unnamedArray));
    const tabs = el('div', 'pc-tabs');
    PC_SCREENS.forEach((name, i) => {
      const tab = el('div', 'pc-tab', `[${i + 1}] ${PC_TEXT.tabs[name]}`);
      tab.dataset.screen = name;
      if (name === this.screen) tab.classList.add('is-active');
      tabs.append(tab);
    });
    header.append(tabs);

    const body = el('div', 'pc-body');
    if (this.screen === 'colony') body.append(colonySvg(map, array), el('p', 'pc-note', PC_TEXT.mapNote));
    else if (this.screen === 'findings') body.append(...findingsList(findings));
    else body.append(el('p', 'pc-empty', PC_TEXT.forecast));

    const screen = el('div', 'pc-screen');
    screen.append(header, body, el('div', 'pc-hint', withKeys(PC_TEXT.hint)));
    this.root.replaceChildren(screen);
  }
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(tag, attrs, text) {
  const node = document.createElementNS(SVG, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (text !== undefined) node.textContent = text;
  return node;
}

function findingsList(findings) {
  if (!findings?.length) return [el('p', 'pc-empty', PC_TEXT.noFindings), el('p', 'pc-note', PC_TEXT.findingsNote)];
  const list = el('ol', 'pc-findings');
  for (const f of findings) {
    const item = el('li', 'pc-finding');
    item.append(
      el('div', 'pc-finding-title', PC_TEXT.findingTitle(f)),
      el('div', 'pc-finding-body', `${PC_TEXT.placeholder} ${PC_TEXT.findingBody}`),
    );
    list.append(item);
  }
  return [list, el('p', 'pc-note', PC_TEXT.findingsNote)];
}

function colonySvg(map, array) {
  const { size, centre: c } = COLONY_MAP;
  const root = svg('svg', { class: 'pc-map', viewBox: `0 0 ${size} ${size}`, role: 'img' });
  const defs = svg('defs', {});
  const marker = svg('marker', {
    id: 'pc-hub-arrow', viewBox: '0 0 10 10', refX: '8', refY: '5',
    markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse',
  });
  marker.append(svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'pc-hub-head' }));
  defs.append(marker);
  root.append(defs);

  // The ring the neighbours sit on: the radar's rim.
  root.append(svg('circle', { class: 'pc-ring', cx: c, cy: c, r: COLONY_MAP.ring }));

  if (map.hub) {
    const { from, to } = map.hub;
    root.append(svg('line', {
      class: 'pc-hub-line', x1: from.x, y1: from.y, x2: to.x, y2: to.y,
      'marker-end': 'url(#pc-hub-arrow)',
    }));
    // The label sits past the arrowhead, outward from the middle, so it
    // clears the neighbours' labels on the ring.
    const anchor = to.x > c + 1 ? 'end' : to.x < c - 1 ? 'start' : 'middle';
    const ly = to.y + (to.y > c ? 11 : -7);
    root.append(svg('text', { class: 'pc-hub-label', x: to.x, y: ly, 'text-anchor': anchor },
      `${PC_TEXT.hub} · ${map.hub.bearing}°`));
  }
  if (map.route.length) {
    root.append(svg('polyline', {
      class: 'pc-route',
      points: map.route.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    }));
  }

  for (const n of map.neighbours) {
    root.append(svg('circle', { class: 'pc-neighbour', cx: n.x, cy: n.y, r: 4 }));
    const below = n.y >= c;
    root.append(svg('text', {
      class: 'pc-neighbour-label', x: n.x, y: n.y + (below ? 13 : -8), 'text-anchor': 'middle',
    }, `${n.bearing}°`));
  }

  root.append(svg('rect', { class: 'pc-base', x: c - 4, y: c - 4, width: 8, height: 8 }));
  root.append(svg('text', { class: 'pc-base-label', x: c, y: c - 8, 'text-anchor': 'middle' },
    array || PC_TEXT.unnamedArray));
  return root;
}
