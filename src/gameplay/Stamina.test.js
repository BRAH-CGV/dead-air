import { describe, it, expect } from 'vitest';
import { Stamina, STAMINA } from './Stamina.js';

describe('Stamina', () => {
  it('starts full and ok', () => {
    const s = new Stamina();
    expect(s.value).toBe(1);
    expect(s.level).toBe('ok');
  });

  it('drains over the night: empty by 4:48 AM of a 300 s shift with no food', () => {
    const s = new Stamina();
    expect(STAMINA.drainPerSecond).toBeCloseTo(1 / 240);
    s.update(120);
    expect(s.value).toBeCloseTo(0.5);
    s.update(119);
    expect(s.value).toBeGreaterThan(0);
    s.update(1);
    expect(s.value).toBe(0);
  });

  it('clamps at 0 and at 1', () => {
    const s = new Stamina({ drainPerSecond: 0.1 });
    s.update(50);
    expect(s.value).toBe(0);
    s.restore(5);
    expect(s.value).toBe(1);
  });

  it('restore adds an amount', () => {
    const s = new Stamina({ drainPerSecond: 0.1 });
    s.update(5);                        // 0.5
    s.restore(0.35);
    expect(s.value).toBeCloseTo(0.85);
  });

  it('levels: ok from 0.5, tired from 0.2, critical below', () => {
    const s = new Stamina();
    s.value = 0.5;
    expect(s.level).toBe('ok');
    s.value = 0.49;
    expect(s.level).toBe('tired');
    s.value = 0.2;
    expect(s.level).toBe('tired');
    s.value = 0.19;
    expect(s.level).toBe('critical');
  });

  it('reset() fills it again for a new or retried night', () => {
    const s = new Stamina();
    s.update(200);
    s.reset();
    expect(s.value).toBe(1);
  });
});
