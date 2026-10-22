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
  findings: [{ night: 1, index: 1 }, { night: 1, index: 2 }, { night: 2, index: 1 }],
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

  it('opens on the Colony screen, under the array\'s name, with three tabs', () => {
    panel.show(DATA);
    expect(panel.visible).toBe(true);
    expect(panel.screen).toBe('colony');
    expect($('.pc-array').textContent).toBe('ARRAY K-17 · 12°N 40°E');
    expect(PC_SCREENS).toEqual(['colony', 'findings', 'forecast']);
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

  it('the Findings screen: one entry per processed signal, each marked as a placeholder', () => {
    panel.show(DATA);
    panel.setScreen('findings');
    expect($('.pc-tab.is-active').dataset.screen).toBe('findings');
    const entries = $$('.pc-finding');
    expect(entries).toHaveLength(3);
    expect(entries[0].textContent).toMatch(/night 1/i);
    expect(entries[2].textContent).toMatch(/night 2/i);
    for (const e of entries) expect(e.textContent).toContain(PC_TEXT.placeholder);
  });

  it('with nothing back from the hub, Findings says so', () => {
    panel.show({ ...DATA, findings: [] });
    panel.setScreen('findings');
    expect($$('.pc-finding')).toHaveLength(0);
    expect($('.pc-empty').textContent).toBe(PC_TEXT.noFindings);
  });

  it('the Forecast screen reads "insufficient data"', () => {
    panel.show(DATA);
    panel.setScreen('forecast');
    expect($('.pc-body').textContent).toMatch(/insufficient data/i);
  });

  it('step() walks the screens either way, round the ends', () => {
    panel.show(DATA);
    panel.step(1);
    expect(panel.screen).toBe('findings');
    panel.step(1);
    panel.step(1);
    expect(panel.screen).toBe('colony');
    panel.step(-1);
    expect(panel.screen).toBe('forecast');
  });

  it('ignores a screen it does not have', () => {
    panel.show(DATA);
    panel.setScreen('inbox');
    expect(panel.screen).toBe('colony');
  });

  it('opens again on the screen it was left on', () => {
    panel.show(DATA);
    panel.setScreen('forecast');
    panel.hide();
    panel.show(DATA);
    expect(panel.screen).toBe('forecast');
  });

  it('says how to switch screens and close it', () => {
    panel.show(DATA);
    expect($('.pc-hint').textContent).toMatch(/\[E\]/);
    expect($('.pc-hint').textContent).toMatch(/\[1\]/);
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
    expect(() => { headless.show(DATA); headless.setScreen('findings'); headless.step(1); headless.hide(); }).not.toThrow();
    expect(headless.visible).toBe(false);
  });
});
