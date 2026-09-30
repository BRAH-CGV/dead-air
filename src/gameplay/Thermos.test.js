import { describe, it, expect } from 'vitest';
import { Thermos, THERMOS } from './Thermos.js';
import { Stamina, STAMINA } from './Stamina.js';

function tired() {
  const s = new Stamina();
  s.value = 0.3;
  return s;
}

describe('Thermos', () => {
  it('holds two cups a night', () => {
    expect(THERMOS.cups).toBe(2);
    expect(new Thermos().cups).toBe(2);
  });

  it('a cup gives back a little stamina and caffeinates', () => {
    const t = new Thermos();
    const s = tired();
    expect(t.drink(s)).toBe(true);
    expect(s.value).toBeCloseTo(0.3 + THERMOS.restore);
    expect(s.caffeine).toBe(THERMOS.caffeine);
    expect(t.cups).toBe(1);
    // Less than a ration: coffee buys time, food is what feeds you.
    expect(THERMOS.restore).toBeLessThan(STAMINA.ration);
  });

  it('a sip takes a moment: a second press inside it does nothing', () => {
    const t = new Thermos();
    const s = tired();
    t.drink(s);
    expect(t.drink(s)).toBe(false);
    expect(t.cups).toBe(1);
    t.update(THERMOS.sipSeconds);
    expect(t.drink(s)).toBe(true);
    expect(t.cups).toBe(0);
  });

  it('an empty thermos gives nothing', () => {
    const t = new Thermos({ cups: 1 });
    const s = tired();
    t.drink(s);
    t.update(10);
    expect(t.drink(s)).toBe(false);
    expect(s.value).toBeCloseTo(0.3 + THERMOS.restore);
  });

  it('refill() fills it for a new or retried night', () => {
    const t = new Thermos();
    const s = tired();
    t.drink(s);
    t.refill();
    expect(t.cups).toBe(2);
    expect(t.drink(s)).toBe(true);
  });
});
