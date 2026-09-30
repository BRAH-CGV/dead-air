import { describe, it, expect } from 'vitest';
import { Oxygen, OXYGEN } from './Oxygen.js';

describe('Oxygen', () => {
  it('is a 90 s tank, full to start', () => {
    const tank = new Oxygen();
    expect(OXYGEN.tankSeconds).toBe(90);
    expect(tank.value).toBe(1);
    tank.drain(45);
    expect(tank.value).toBeCloseTo(0.5);
    tank.drain(45);
    expect(tank.value).toBe(0);
    expect(tank.empty).toBe(true);
  });

  it('never goes below empty or above full', () => {
    const tank = new Oxygen();
    tank.drain(500);
    expect(tank.value).toBe(0);
    tank.refill(500);
    expect(tank.value).toBe(1);
  });

  it('refills in a few seconds, far faster than it drains', () => {
    const tank = new Oxygen();
    tank.drain(90);
    tank.refill(OXYGEN.refillSeconds / 2);
    expect(tank.value).toBeCloseTo(0.5);
    expect(OXYGEN.refillSeconds).toBeLessThan(10);
  });

  it('runs low below a quarter', () => {
    const tank = new Oxygen();
    expect(OXYGEN.lowBelow).toBe(0.25);
    tank.value = 0.26;
    expect(tank.low).toBe(false);
    tank.value = 0.24;
    expect(tank.low).toBe(true);
  });

  it('reset() fills it', () => {
    const tank = new Oxygen();
    tank.drain(60);
    tank.reset();
    expect(tank.value).toBe(1);
    expect(tank.empty).toBe(false);
  });
});
