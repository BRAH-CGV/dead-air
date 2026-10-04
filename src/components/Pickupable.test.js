import { describe, it, expect } from 'vitest';
import { Pickupable } from './Pickupable.js';

describe('Pickupable', () => {
  it('starts not held', () => {
    const p = new Pickupable();
    expect(p.held).toBe(false);
  });

  it('has sensible default hold distance', () => {
    const p = new Pickupable();
    expect(p.holdDistance).toBe(1.0);
    expect(p.minHoldDistance).toBe(0.5);
    expect(p.maxHoldDistance).toBe(2.0);
  });

  it('has a default interact range', () => {
    const p = new Pickupable();
    expect(p.interactRange).toBe(3);
  });

  it('has a default pickup prompt label', () => {
    const p = new Pickupable();
    expect(p.promptLabel).toBe('[E] Pick up');
  });

  it('can be marked as held', () => {
    const p = new Pickupable();
    p.held = true;
    expect(p.held).toBe(true);
  });

  it('hold distance can be adjusted within bounds', () => {
    const p = new Pickupable();
    p.holdDistance = 1.5;
    expect(p.holdDistance).toBe(1.5);
    p.holdDistance = p.minHoldDistance;
    expect(p.holdDistance).toBe(0.5);
    p.holdDistance = p.maxHoldDistance;
    expect(p.holdDistance).toBe(2.0);
  });
});
