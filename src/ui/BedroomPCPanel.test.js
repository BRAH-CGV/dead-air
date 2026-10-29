// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { BedroomPCPanel, PC_SCREENS, PC_TEXT } from './BedroomPCPanel.js';
import { colonyMap } from './colonyMap.js';
import { createDefaultNeighbourDishes } from '../gameobjects/DishRig.js';

const MAP = colonyMap({
  neighbours: createDefaultNeighbourDishes(),
  route: [{ x: -7.8, z: 10 }, { x: 8.2, z: 22 }, { x: 22, z: 39 }],
});
const DATA = {
  array: 'ARRAY K-17 · 12°N 40°E',
  map: MAP,
  log: { night: 1, entries: [{ kind: 'storm', hour: -3.5 }, { kind: 'vents', hour: 1.25 }] },
  forecast: { night: 2, tonight: true, kinds: ['storm', 'eyes', 'vents'] },
};

describe('BedroomPCPanel', () => {
  let root, panel;
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => [...root.querySelectorAll(sel)];

  beforeEach(() => {
    document.body.innerHTML = '<div id="bedroom-pc"></div>';
    root = document.getElementById('bedroom-pc');
    panel = new BedroomPCPanel();
  });

  it('starts hidden', () => {
    expect(panel.visible).toBe(false);
  });

  it('opens on the Colony screen, under the array\'s name, with two tabs: the map and the threats', () => {
    panel.show(DATA);
    expect(panel.visible).toBe(true);
    expect(panel.screen).toBe('colony');
    expect($('.pc-array').textContent).toBe('ARRAY K-17 · 12°N 40°E');
    expect(PC_SCREENS).toEqual(['colony', 'threats']);
    expect($$('.pc-tab').map(t => t.dataset.screen)).toEqual(PC_SCREENS);
    expect($('.pc-tab.is-active').dataset.screen).toBe('colony');
  });

  it('names the array with a placeholder when there is no name', () => {
    panel.show({ ...DATA, array: null });
    expect($('.pc-array').textContent).toBe(PC_TEXT.unnamedArray);
  });

  it('the Colony screen: our base in the middle, the six neighbours by bearing, the route and the hub', () => {
    panel.show(DATA);
    const svg = $('svg.pc-map');
    expect(svg).not.toBeNull();
    expect(svg.querySelector('.pc-base')).not.toBeNull();
    expect(svg.querySelectorAll('.pc-neighbour')).toHaveLength(6);
    expect([...svg.querySelectorAll('.pc-neighbour-label')].map(t => t.textContent))
      .toEqual(MAP.neighbours.map(n => `${n.bearing}°`));
    expect(svg.querySelector('.pc-route').getAttribute('points').trim().split(/\s+/)).toHaveLength(MAP.route.length);
    const hub = svg.querySelector('.pc-hub-line');
    expect(+hub.getAttribute('x2')).toBeCloseTo(MAP.hub.to.x);
    expect(+hub.getAttribute('y2')).toBeCloseTo(MAP.hub.to.y);
    expect(svg.querySelector('.pc-hub-label').textContent).toBe(`${PC_TEXT.hub} · ${MAP.hub.bearing}°`);
  });

  it('with no route, no hub is drawn', () => {
    panel.show({ ...DATA, map: colonyMap({ neighbours: createDefaultNeighbourDishes() }) });
    expect($('.pc-hub-line')).toBeNull();
    expect($('.pc-route')).toBeNull();
  });

  describe('the Threats screen', () => {
    const show = (data = DATA) => { panel.show(data); panel.setScreen('threats'); };

    it("last night's log: when each threat first showed, in 24-hour time", () => {
      show();
      expect($('.pc-tab.is-active').dataset.screen).toBe('threats');
      expect($('.pc-log-title').textContent).toBe(PC_TEXT.logTitle(1));
      const rows = $$('.pc-log-entry');
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain('20:30');
      expect(rows[0].textContent).toContain(PC_TEXT.logLabels.storm);
      expect(rows[1].textContent).toContain('01:15');
      expect(rows[1].textContent).toContain(PC_TEXT.logLabels.vents);
    });

    it('a quiet night says so', () => {
      show({ ...DATA, log: { night: 1, entries: [] } });
      expect($$('.pc-log-entry')).toHaveLength(0);
      expect($('.pc-log-empty').textContent).toBe(PC_TEXT.quietNight);
    });

    it('a night with no record (none played, or before this run) says that instead, with no night named', () => {
      show({ ...DATA, log: { night: 0, entries: null } });
      expect($('.pc-log-title').textContent).toBe(PC_TEXT.logTitle(null));
      expect($('.pc-log-empty').textContent).toBe(PC_TEXT.noLog);
      show({ ...DATA, log: null });
      expect($('.pc-log-empty').textContent).toBe(PC_TEXT.noLog);
    });

    it('a threat with no clock time reads --:--', () => {
      show({ ...DATA, log: { night: 1, entries: [{ kind: 'eyes', hour: null }] } });
      expect($('.pc-log-entry').textContent).toContain('--:--');
    });

    it('the forecast for tonight: one vague line per threat due, no times', () => {
      show();
      expect($('.pc-forecast-title').textContent).toBe(PC_TEXT.forecastTitle(2, true));
      const lines = $$('.pc-forecast-item').map(l => l.textContent);
      expect(lines).toEqual(['storm', 'eyes', 'vents'].map(k => PC_TEXT.forecastLines[k]));
      for (const line of lines) expect(line).not.toMatch(/\d:\d\d/);
    });

    it('in the morning it forecasts the next shift', () => {
      show({ ...DATA, forecast: { night: 3, tonight: false, kinds: ['aerial'] } });
      expect($('.pc-forecast-title').textContent).toBe(PC_TEXT.forecastTitle(3, false));
      expect(PC_TEXT.forecastTitle(3, false)).not.toBe(PC_TEXT.forecastTitle(3, true));
    });

    it('nothing due reads as such, and after the last shift there is no forecast', () => {
      show({ ...DATA, forecast: { night: 2, tonight: true, kinds: [] } });
      expect($('.pc-forecast-empty').textContent).toBe(PC_TEXT.nothingDue);
      show({ ...DATA, forecast: null });
      expect($$('.pc-forecast-item')).toHaveLength(0);
      expect($('.pc-forecast-empty').textContent).toBe(PC_TEXT.noShifts);
    });

    it('carries no placeholder note', () => {
      show();
      expect($('.pc-body').textContent).not.toMatch(/placeholder/i);
      expect($$('.pc-body .pc-note')).toHaveLength(0);
    });

    it('has a label and a forecast line for every kind of threat', async () => {
      const { THREAT_KINDS } = await import('../gameplay/ThreatForecast.js');
      for (const kind of THREAT_KINDS) {
        expect(PC_TEXT.logLabels[kind]).toBeTruthy();
        expect(PC_TEXT.forecastLines[kind]).toBeTruthy();
      }
    });
  });

  it('step() walks the two screens either way, round the ends', () => {
    panel.show(DATA);
    panel.step(1);
    expect(panel.screen).toBe('threats');
    panel.step(1);
    expect(panel.screen).toBe('colony');
    panel.step(-1);
    expect(panel.screen).toBe('threats');
  });

  it('ignores a screen it does not have', () => {
    panel.show(DATA);
    panel.setScreen('inbox');
    expect(panel.screen).toBe('colony');
  });

  it('opens again on the screen it was left on', () => {
    panel.show(DATA);
    panel.setScreen('threats');
    panel.hide();
    panel.show(DATA);
    expect(panel.screen).toBe('threats');
  });

  it('says how to switch screens and close it', () => {
    panel.show(DATA);
    expect($('.pc-hint').textContent).toMatch(/\[E\]/);
    expect($('.pc-hint').textContent).toMatch(/\[1\] \[2\]/);
    expect($('.pc-hint').textContent).not.toMatch(/\[3\]/);
  });

  it('sets text, never HTML', () => {
    panel.show({ ...DATA, array: 'ARRAY <b>X</b>' });
    expect($('.pc-array').textContent).toBe('ARRAY <b>X</b>');
    expect($('b')).toBeNull();
  });

  it('hide() hides it', () => {
    panel.show(DATA);
    panel.hide();
    expect(panel.visible).toBe(false);
  });

  it('is a no-op without markup', () => {
    const headless = new BedroomPCPanel(null);
    expect(() => { headless.show(DATA); headless.setScreen('threats'); headless.step(1); headless.hide(); }).not.toThrow();
    expect(headless.visible).toBe(false);
  });

  it('render() draws the screens without opening the panel: its screen in the world shows them (#161)', () => {
    panel.render(DATA);
    expect(root.querySelector('.pc-screen')).not.toBeNull();
    expect(panel.visible).toBe(false);
  });
});
