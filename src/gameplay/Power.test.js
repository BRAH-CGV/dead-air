import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Power, EMERGENCY_LEVEL, FLICKER_TIME } from './Power.js';

describe('Power', () => {
  let lights, power;

  const run = (seconds, dt = 1 / 60) => {
    const seen = [];
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      power.onUpdate(dt);
      seen.push(lights.getFactor('power'));
    }
    return seen;
  };

  beforeEach(() => {
    const factors = new Map();
    lights = {
      setFactor: vi.fn((key, v) => factors.set(key, v)),
      getFactor: key => factors.get(key) ?? 1,
    };
    power = new Power({ lights });
  });

  it('starts on, the lights at full', () => {
    expect(power.on).toBe(true);
    expect(power.level).toBe(1);
    run(1);
    expect(lights.getFactor('power')).toBe(1);
  });

  it('a cut stutters the lights, then leaves only the emergency glow', () => {
    power.set(false);
    expect(power.on).toBe(false);
    const seen = run(FLICKER_TIME + 0.2);
    // A flicker, not a fade: it comes back up at least once on the way down.
    const rises = seen.filter((v, i) => i > 0 && v > seen[i - 1] + 0.1).length;
    expect(rises).toBeGreaterThan(0);
    expect(lights.getFactor('power')).toBeCloseTo(EMERGENCY_LEVEL);
    expect(EMERGENCY_LEVEL).toBeCloseTo(0.08);
  });

  it('restoring it flickers back up to full', () => {
    power.set(false);
    run(FLICKER_TIME + 0.2);
    power.set(true);
    const seen = run(FLICKER_TIME + 0.2);
    expect(Math.min(...seen)).toBeLessThan(0.9);
    expect(lights.getFactor('power')).toBe(1);
  });

  it('toggle() flips it, and tells whoever is listening', () => {
    const heard = vi.fn();
    const off = power.onChange(heard);
    power.toggle();
    power.toggle();
    expect(heard.mock.calls).toEqual([[false], [true]]);
    off();
    power.toggle();
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('setting it to what it already is does nothing', () => {
    const heard = vi.fn();
    power.onChange(heard);
    power.set(true);
    expect(heard).not.toHaveBeenCalled();
  });

  it('reset() is a new night: on at once, no flicker', () => {
    power.set(false);
    run(FLICKER_TIME + 0.2);
    const heard = vi.fn();
    power.onChange(heard);
    power.reset();
    expect(power.on).toBe(true);
    expect(lights.getFactor('power')).toBe(1);
    expect(heard).toHaveBeenCalledWith(true);
    run(0.5);
    expect(lights.getFactor('power')).toBe(1);
  });

  it('works with no lights to drive', () => {
    power = new Power();
    power.set(false);
    expect(() => run(1)).not.toThrow();
    expect(power.level).toBeCloseTo(EMERGENCY_LEVEL);
  });
});
