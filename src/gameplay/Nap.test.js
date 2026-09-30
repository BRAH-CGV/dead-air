import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Nap, NAP, napHours } from './Nap.js';
import { Stamina } from './Stamina.js';

describe('napHours(stamina, r)', () => {
  it('an hour, or two when you oversleep — likelier the more tired you lay down', () => {
    const chance = s => NAP.oversleepChance + NAP.oversleepPerFatigue * (1 - s);
    expect(napHours(0.4, chance(0.4) - 0.01)).toBe(NAP.oversleptHours);
    expect(napHours(0.4, chance(0.4))).toBe(NAP.hours);
    expect(chance(0.05)).toBeGreaterThan(chance(0.45));
    expect(NAP.hours).toBe(1);
    expect(NAP.oversleptHours).toBe(2);
  });
});

describe('Nap', () => {
  let controller, stamina, threats, nap, roll;

  beforeEach(() => {
    controller = { state: 'playing', nap: vi.fn(() => true) };
    stamina = new Stamina();
    stamina.value = 0.3;
    threats = { onNap: vi.fn(() => false) };
    roll = 0.99;                               // never oversleeps
    nap = new Nap({ controller, stamina, threats, rand: () => roll });
  });

  it('is only allowed during the shift, and only when tired', () => {
    expect(nap.allowed).toBe(true);
    stamina.value = 0.8;
    expect(nap.allowed).toBe(false);
    expect(nap.tired).toBe(false);
    stamina.value = 0.3;
    controller.state = 'morning';
    expect(nap.allowed).toBe(false);
  });

  it('sleeps an hour away and wakes rested', () => {
    expect(nap.take()).toBe(1);
    expect(controller.nap).toHaveBeenCalledWith(1);
    expect(stamina.value).toBe(1);
    expect(nap.lastHours).toBe(1);
  });

  it('can oversleep', () => {
    roll = 0;
    expect(nap.take()).toBe(2);
    expect(controller.nap).toHaveBeenCalledWith(2);
  });

  it("asks tonight's threats first: one that takes you ends it there", () => {
    threats.onNap = vi.fn(() => true);
    expect(nap.take()).toBe(0);
    expect(threats.onNap).toHaveBeenCalledOnce();
    expect(controller.nap).not.toHaveBeenCalled();
    expect(stamina.value).toBe(0.3);
  });

  it('does nothing when not allowed', () => {
    stamina.value = 0.9;
    expect(nap.take()).toBe(0);
    expect(threats.onNap).not.toHaveBeenCalled();
    expect(controller.nap).not.toHaveBeenCalled();
  });
});
