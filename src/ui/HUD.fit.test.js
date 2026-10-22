// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { RadarOverlay } from './HUD.js';

// On the office computer's screen (#161) the radar is laid out in a box the
// size of the screen, not the window: ScreenView tells it the box.

function makeRadar() {
  const root = document.createElement('div');
  root.innerHTML = '<canvas id="radar-canvas"></canvas><div id="radar-telemetry"></div><div id="radar-scan-progress"></div><div id="radar-info"></div><div id="radar-hint"></div><div id="radar-warning"></div>';
  return new RadarOverlay(root);
}

describe('RadarOverlay.fit', () => {
  it('sizes the disc to the box, leaving room for the lines under it', () => {
    const radar = makeRadar();
    radar.fit(1200, 700);
    expect(radar._canvas.width).toBe(radar._canvas.height);
    expect(radar._canvas.width).toBeLessThan(700);
    expect(radar._canvas.width).toBeGreaterThan(500);
    expect(radar._radius).toBe(radar._canvas.width / 2);
  });

  it('a narrow box is held by its width', () => {
    const radar = makeRadar();
    radar.fit(400, 900);
    expect(radar._canvas.width).toBeLessThanOrEqual(400);
  });

  it('keeps the box through a window resize, until let go', () => {
    const radar = makeRadar();
    radar.fit(1200, 700);
    const fitted = radar._canvas.width;
    window.dispatchEvent(new Event('resize'));
    expect(radar._canvas.width).toBe(fitted);
    radar.fit(null);
    window.dispatchEvent(new Event('resize'));
    expect(radar._canvas.width).not.toBe(fitted);
    radar.dispose();
  });
});


// The radar is painted onto the computer's screen from its DOM (paintDom),
// and any change to that DOM is a fresh read of its layout: lines set every
// frame (the evil signal's countdown) are written only when they change.
describe('RadarOverlay lines', () => {
  it('writes the info and hint lines only when they change', () => {
    const radar = makeRadar();
    const observer = new MutationObserver(() => {});
    observer.observe(radar.root, { subtree: true, childList: true, characterData: true });
    radar.setInfo('Silenced in 9 s');
    radar.setHint('Q: exit');
    observer.takeRecords();
    radar.setInfo('Silenced in 9 s');
    radar.setHint('Q: exit');
    expect(observer.takeRecords()).toHaveLength(0);
    radar.setInfo('Silenced in 8 s');
    expect(observer.takeRecords().length).toBeGreaterThan(0);
    observer.disconnect();
  });
});
