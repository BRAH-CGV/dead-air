import { describe, it, expect, vi } from 'vitest';
import * as NightModule from './NightManager.js';
import { NightManager } from './NightManager.js';

describe('NightManager', () => {
  it('starts at night 1', () => {
    expect(new NightManager().currentNight).toBe(1);
  });

  it('runs three nights by default', () => {
    expect(new NightManager().maxNight).toBe(3);
  });

  it('accepts a custom night count and start', () => {
    const nights = new NightManager({ maxNight: 5, startNight: 4 });
    expect(nights.maxNight).toBe(5);
    expect(nights.currentNight).toBe(4);
  });

  it('advance() increments the night and returns it', () => {
    const nights = new NightManager();
    expect(nights.advance()).toBe(2);
    expect(nights.currentNight).toBe(2);
  });

  it('advance() stops at the last night', () => {
    const nights = new NightManager({ startNight: 3 });
    expect(nights.advance()).toBe(3);
    expect(nights.maxNight).toBe(3);
  });

  it('isLastNight reports the final night', () => {
    const nights = new NightManager();
    expect(nights.isLastNight()).toBe(false);
    nights.setNight(3);
    expect(nights.isLastNight()).toBe(true);
  });

  it('emits a change (night, previous) on advance, not when clamped', () => {
    const nights = new NightManager({ startNight: 2 });
    const listener = vi.fn();
    const off = nights.onChange(listener);
    nights.advance();
    nights.advance();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(3, 2);

    off();
    nights.setNight(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('setNight rejects a night out of range', () => {
    expect(() => new NightManager().setNight(7)).toThrow(/night 7/);
    expect(() => new NightManager({ startNight: 0 })).toThrow(/night 0/);
    expect(() => new NightManager().setNight(1.5)).toThrow(/night 1.5/);
  });

  // Doors no longer open by night — the base is walkable from night 1, and
  // only the airlock gates the outside (on the EVA suit, not the calendar).
  it('no longer knows about rooms or doors', () => {
    const nights = new NightManager();
    expect(nights.applyTo).toBeUndefined();
    expect(nights.getOpenRooms).toBeUndefined();
    expect(nights.isOpen).toBeUndefined();
    expect(NightModule.DEFAULT_NIGHTS).toBeUndefined();
  });
});
