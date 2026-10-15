import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wakeInto } from './dreamWake.js';

class Home {}

function setup() {
  let finish;
  const compiled = new Promise((r) => { finish = r; });
  const order = [];
  const engine = {
    screenFade: { caption: vi.fn(), uncover: vi.fn(() => order.push('uncover')) },
    loadScene: vi.fn(() => {
      order.push('load');
      engine.activeScene = { nights: { setNight: vi.fn(() => order.push('night')) } };
    }),
    compileScene: vi.fn(() => { order.push('compile'); return compiled; }),
  };
  return { engine, finish, order };
}

describe('wakeInto (both dreams wake through it)', () => {
  let engine, finish, order;
  beforeEach(() => ({ engine, finish, order } = setup()));

  it('says which night it is waking into, on the black', async () => {
    const waking = wakeInto(engine, Home, { night: 3 });
    expect(engine.screenFade.caption).toHaveBeenCalledWith('NIGHT 3');
    finish();
    await waking;
  });

  it('builds the scene (no background compile), puts it on the night, compiles, then lifts the black', async () => {
    const waking = wakeInto(engine, Home, { night: 2 });
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.loadScene).toHaveBeenCalledWith(Home, { compile: false });
    expect(engine.screenFade.uncover).not.toHaveBeenCalled();
    finish();
    await waking;
    expect(order).toEqual(['load', 'night', 'compile', 'uncover']);
  });

  it('night 1 is where a fresh scene starts: no setNight', async () => {
    finish();
    await wakeInto(engine, Home, { night: 1 });
    expect(order).toEqual(['load', 'compile', 'uncover']);
  });

  it('runs beforeLoad just before the build (the crater\'s stamina penalty)', async () => {
    const beforeLoad = vi.fn(() => order.push('before'));
    finish();
    await wakeInto(engine, Home, { night: 1, beforeLoad });
    expect(order[0]).toBe('before');
  });

  it('a failed compile still lifts the black — never stuck', async () => {
    engine.compileScene = vi.fn(() => Promise.reject(new Error('lost context')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await wakeInto(engine, Home, { night: 1 });
    expect(engine.screenFade.uncover).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('works with no fade at all', async () => {
    engine.screenFade = null;
    finish();
    await expect(wakeInto(engine, Home, { night: 2 })).resolves.toBeUndefined();
    expect(engine.loadScene).toHaveBeenCalled();
  });
});
