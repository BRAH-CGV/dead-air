import { describe, it, expect, vi } from 'vitest';
import { CoffeeHarvest, COFFEE_HARVEST } from './CoffeeHarvest.js';

/** A random source that walks a fixed list, so the ripe bushes are known. */
const seq = values => { let i = 0; return () => values[i++ % values.length]; };

const make = (opts = {}) => new CoffeeHarvest({ bushes: 12, random: seq([0.1, 0.5, 0.9]), ...opts });

const ripeOf = h => h.bushes.flatMap((b, i) => (b === 'ripe' ? [i] : []));

describe('CoffeeHarvest', () => {
  it('two bushes a night carry ripe beans, picked at random; the rest are not ripe', () => {
    expect(COFFEE_HARVEST.ripePerNight).toBe(2);
    const h = make();
    expect(ripeOf(h).length).toBe(2);
    expect(h.bushes.filter(b => b === 'unripe').length).toBe(10);
    expect(h.ripeLeft).toBe(2);
  });

  it('never ripens the same bush twice, whatever the random source rolls', () => {
    const h = make({ random: () => 0.5 });
    expect(new Set(ripeOf(h)).size).toBe(2);
  });

  it('picks different bushes on different nights', () => {
    const h = new CoffeeHarvest({ bushes: 12, random: seq([0.05, 0.3, 0.7, 0.95]) });
    const first = ripeOf(h);
    h.newNight();
    expect(ripeOf(h)).not.toEqual(first);
  });

  it('harvesting a ripe bush leaves it bare; an unripe or picked one gives nothing', () => {
    const h = make();
    const [a] = ripeOf(h);
    expect(h.harvest(a)).toBe(true);
    expect(h.bushes[a]).toBe('picked');
    expect(h.ripeLeft).toBe(1);
    expect(h.harvest(a)).toBe(false);
    expect(h.harvest(h.bushes.indexOf('unripe'))).toBe(false);
    expect(h.harvest(99)).toBe(false);
  });

  it('a pile in the hopper waits for start(), is ground for a while, then a batch is ready', () => {
    const h = make();
    const batch = vi.fn();
    h.onBatch(batch);
    expect(h.processor).toBe('idle');
    expect(h.start()).toBe(false);                // nothing in it
    h.load();
    expect(h.processor).toBe('loaded');
    h.update(COFFEE_HARVEST.processSeconds * 2);
    expect(batch).not.toHaveBeenCalled();         // not until it is started
    expect(h.start()).toBe(true);
    expect(h.processor).toBe('processing');
    h.update(COFFEE_HARVEST.processSeconds - 0.1);
    expect(batch).not.toHaveBeenCalled();
    expect(h.processLeft).toBeCloseTo(0.1);
    h.update(0.2);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(h.processor).toBe('idle');
  });

  it('takes nothing in while it grinds', () => {
    const h = make();
    h.load();
    h.start();
    expect(h.load()).toBe(false);
    expect(h.hopper).toBe(0);
    expect(h.start()).toBe(false);
  });

  it('two piles loaded are ground one after the other, a batch each, from one start', () => {
    const h = make();
    const batch = vi.fn();
    h.onBatch(batch);
    h.load();
    h.load();
    h.start();
    h.update(COFFEE_HARVEST.processSeconds + 0.01);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(h.processor).toBe('processing');
    h.update(COFFEE_HARVEST.processSeconds);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(h.processor).toBe('idle');
  });

  it('a long frame grinds everything its time allows', () => {
    const h = make();
    const batch = vi.fn();
    h.onBatch(batch);
    h.load();
    h.load();
    h.start();
    h.update(COFFEE_HARVEST.processSeconds * 5);
    expect(batch).toHaveBeenCalledTimes(2);
  });

  it('a new night ripens two fresh bushes and empties the hopper', () => {
    const h = make();
    for (const i of ripeOf(h)) h.harvest(i);
    h.load();
    h.load();
    h.newNight();
    expect(ripeOf(h).length).toBe(2);
    expect(h.bushes.includes('picked')).toBe(false);
    expect([h.hopper, h.processLeft]).toEqual([0, 0]);
    expect(h.processor).toBe('idle');
  });

  it('tells its listeners whenever anything changes, not on an idle tick', () => {
    const h = make();
    const fn = vi.fn();
    h.onChange(fn);
    h.update(1);
    expect(fn).not.toHaveBeenCalled();
    h.harvest(ripeOf(h)[0]);
    expect(fn).toHaveBeenCalledTimes(1);
    h.load();
    h.start();
    h.update(1);                                  // grinding, nothing new to say
    expect(fn).toHaveBeenCalledTimes(3);
    h.update(COFFEE_HARVEST.processSeconds);
    expect(fn).toHaveBeenCalledTimes(4);
    h.newNight();
    expect(fn).toHaveBeenCalledTimes(5);
  });
});
