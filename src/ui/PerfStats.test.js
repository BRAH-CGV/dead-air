// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { PerfStats } from './PerfStats.js';

/** Shape of THREE.WebGLRenderer.info that the readout reads. */
function info({ calls = 0, triangles = 0, geometries = 0, textures = 0 } = {}) {
  return { render: { calls, triangles }, memory: { geometries, textures } };
}

describe('PerfStats', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('creates a #perf-stats element, hidden by default', () => {
    const stats = new PerfStats();
    expect(document.getElementById('perf-stats')).toBe(stats.root);
    expect(stats.visible).toBe(false);
  });

  it('reuses an existing #perf-stats element', () => {
    const el = document.createElement('div');
    el.id = 'perf-stats';
    document.body.appendChild(el);
    expect(new PerfStats().root).toBe(el);
  });

  it('toggle shows and hides it', () => {
    const stats = new PerfStats();
    stats.toggle();
    expect(stats.visible).toBe(true);
    stats.toggle();
    expect(stats.visible).toBe(false);
  });

  it('refreshes the text once per interval, averaging FPS over it', () => {
    const stats = new PerfStats(undefined, { interval: 0.5 });
    stats.toggle();
    // 30 frames at 1/60 s = 0.5 s → one refresh, 60 FPS
    for (let i = 0; i < 30; i++) {
      stats.update(1 / 60, info({ calls: 1234, triangles: 56789, geometries: 12, textures: 34 }));
    }
    const text = stats.root.textContent;
    expect(text).toMatch(/FPS\s+60/);
    expect(text).toMatch(/16\.7 ms/);
    expect(text).toMatch(/Draw calls\s+1,?234/);
    expect(text).toMatch(/Triangles\s+56,?789/);
    expect(text).toMatch(/Geometries\s+12/);
    expect(text).toMatch(/Textures\s+34/);
  });

  it('does not refresh before the interval has passed', () => {
    const stats = new PerfStats(undefined, { interval: 0.5 });
    stats.toggle();
    stats.update(0.1, info({ calls: 5 }));
    expect(stats.root.textContent).not.toMatch(/Draw calls\s+5/);
  });

  it('reports the worst frame in the interval (stutters hide in an average)', () => {
    const stats = new PerfStats(undefined, { interval: 0.5 });
    stats.toggle();
    for (let i = 0; i < 9; i++) stats.update(0.05, info());
    stats.update(0.05 + 0.1, info());   // one 150 ms hitch
    expect(stats.root.textContent).toMatch(/worst 150\.0 ms/);
  });

  it('skips the work while hidden', () => {
    const stats = new PerfStats(undefined, { interval: 0.5 });
    for (let i = 0; i < 60; i++) stats.update(1 / 60, info({ calls: 9 }));
    expect(stats.root.textContent).toBe('');
  });

  it('is a no-op without an element', () => {
    const stats = new PerfStats(null);
    expect(() => { stats.toggle(); stats.update(1, info()); }).not.toThrow();
    expect(stats.visible).toBe(false);
  });
});
