// ─────────────────────────────────────────────
// BedroomPCPanel  –  the bedroom computer's screens (#114)
// ─────────────────────────────────────────────
// Wraps #bedroom-pc in index.html (the look lives there, like the other
// overlays). Two screens, switched by BedroomPC from the keyboard:
//
//   Colony   a top-down map (colonyMap): our base and its array name, the
//            six neighbouring arrays by bearing, the buggy's route out and
//            the way on to the central hub
//   Threats  last night's log (ThreatWatch, through the RunRecord): each
//            kind of threat and the hour it first showed, in 24-hour time;
//            then the forecast for tonight (the next shift, in the
//            morning), vague: the kinds due, no times (threatForecast).
//            The wording is placeholder, clearly marked, until the story
//            has words for it
//
// Text is set with textContent, never as HTML; the map is SVG built with
// createElementNS. Without markup every call is a no-op.
// ─────────────────────────────────────────────

import { withKeys } from './promptKeys.js';
import { COLONY_MAP } from './colonyMap.js';
import { clockDigits } from '../gameobjects/DigitalClock.js';

export const PC_SCREENS = Object.freeze(['colony', 'threats']);

/** Every word the PC shows: one-line edits. The placeholders are marked as
 *  such; the story's words go here when there are some (docs/STORY.md). */
export const PC_TEXT = Object.freeze({
  unnamedArray: 'YOUR ARRAY',
  tabs: Object.freeze({ colony: 'COLONY', threats: 'THREATS' }),
  hub: 'CENTRAL HUB',
  mapNote: 'Top: the window side. Neighbours at their radar bearings.',
  placeholder: '[PLACEHOLDER]',
  logTitle: (night) => (night == null ? 'LAST NIGHT' : `LAST NIGHT · NIGHT ${night}`),
  /** One per ThreatForecast kind, as the log lists it. */
  logLabels: Object.freeze({
    storm: 'Dust storm',
    outage: 'Power cut by the storm',
    eyes: 'Movement in the storm',
    prowler: 'Movement at the treeline',
    vents: 'Something in the vents',
    aerial: 'Aerial anomaly',
    corrupt: 'Corrupted transmission',
  }),
  quietNight: 'Nothing logged.',
  noLog: 'No record.',
  forecastTitle: (night, tonight) => (tonight ? `TONIGHT · NIGHT ${night}` : `NEXT SHIFT · NIGHT ${night}`),
  /** One per ThreatForecast kind, as the forecast words it: no times. */
  forecastLines: Object.freeze({
    storm: 'Dust storm likely',
    outage: 'Power at risk in the storm',
    eyes: 'Movement reported in storms',
    prowler: 'Movement at the treeline',
    vents: 'Something in the vents',
    aerial: 'Aerial anomaly expected',
    corrupt: 'Corrupted transmissions expected',
  }),
  nothingDue: 'Nothing expected.',
  noShifts: 'No further shifts scheduled.',
  threatsNote: 'Log labels and forecast wording, until the story has some.',
  hint: '[1] [2] or [←] [→] to switch · [E] or [Q] to close',
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
   * @param {{night: number, entries: {kind: string, hour: number|null}[]|null}|null} data.log
   *   Last night's log: entries [] for a quiet night, null for none kept
   * @param {{night: number, tonight: boolean, kinds: string[]}|null} data.forecast
   *   The shift ahead, or null after the last one
   */
  show(data) {
    this.render(data);
    this.root?.classList.add('is-open');
  }

  /** Draw the screens for `data` without opening the panel: the PC's
   *  screen in the world shows them whether or not anyone is at it (#161). */
  render(data) {
    this._data = data;
    if (this.root) this._render();
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
    const { array, map, log, forecast } = this._data;
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
    else body.append(logSection(log), forecastSection(forecast),
      el('p', 'pc-note', `${PC_TEXT.placeholder} ${PC_TEXT.threatsNote}`));

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

function logSection(log) {
  const entries = log?.entries ?? null;
  const section = el('section', 'pc-section');
  section.append(el('h3', 'pc-section-title pc-log-title', PC_TEXT.logTitle(entries ? log.night : null)));
  if (!entries?.length) {
    section.append(el('p', 'pc-empty pc-log-empty', entries ? PC_TEXT.quietNight : PC_TEXT.noLog));
    return section;
  }
  const list = el('ul', 'pc-list');
  for (const e of entries) {
    const row = el('li', 'pc-log-entry');
    row.append(el('span', 'pc-log-time', clockText(e.hour)), PC_TEXT.logLabels[e.kind] ?? e.kind);
    list.append(row);
  }
  section.append(list);
  return section;
}

function forecastSection(forecast) {
  const section = el('section', 'pc-section');
  if (!forecast) {
    section.append(el('p', 'pc-empty pc-forecast-empty', PC_TEXT.noShifts));
    return section;
  }
  section.append(el('h3', 'pc-section-title pc-forecast-title', PC_TEXT.forecastTitle(forecast.night, forecast.tonight)));
  if (!forecast.kinds.length) {
    section.append(el('p', 'pc-empty pc-forecast-empty', PC_TEXT.nothingDue));
    return section;
  }
  const list = el('ul', 'pc-list');
  for (const kind of forecast.kinds) list.append(el('li', 'pc-forecast-item', PC_TEXT.forecastLines[kind] ?? kind));
  section.append(list);
  return section;
}

/** A clock hour (-1.5 for 22:30) as the desk clock reads it. */
function clockText(hour) {
  if (hour == null) return '--:--';
  const [a, b, c, d] = clockDigits(hour);
  return `${a}${b}:${c}${d}`;
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
