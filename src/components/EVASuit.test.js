import { describe, it, expect, vi } from 'vitest';
import { EVASuit } from './EVASuit.js';
import { Component } from '../core/Component.js';

describe('EVASuit', () => {
  it('is a component, so it can ride on the player', () => {
    expect(new EVASuit()).toBeInstanceOf(Component);
  });

  it('starts off', () => {
    expect(new EVASuit().worn).toBe(false);
  });

  it('putOn and takeOff flip worn', () => {
    const suit = new EVASuit();
    suit.putOn();
    expect(suit.worn).toBe(true);
    suit.takeOff();
    expect(suit.worn).toBe(false);
  });

  it('toggle swaps between the two and returns the new state', () => {
    const suit = new EVASuit();
    expect(suit.toggle()).toBe(true);
    expect(suit.toggle()).toBe(false);
  });

  it('notifies listeners with the new state, only on a real change', () => {
    const suit = new EVASuit();
    const listener = vi.fn();
    suit.onChange(listener);

    suit.putOn();
    suit.putOn();          // already on — no second event
    suit.takeOff();

    expect(listener.mock.calls).toEqual([[true], [false]]);
  });

  it('onChange returns an unsubscribe', () => {
    const suit = new EVASuit();
    const listener = vi.fn();
    const off = suit.onChange(listener);
    off();
    suit.putOn();
    expect(listener).not.toHaveBeenCalled();
  });

  it('a listener that unsubscribes mid-notify does not skip the others', () => {
    const suit = new EVASuit();
    const second = vi.fn();
    const off = suit.onChange(() => off());
    suit.onChange(second);
    suit.putOn();
    expect(second).toHaveBeenCalledWith(true);
  });
});
