import { describe, it, expect } from 'vitest';
import { SignalTarget } from './SignalTarget.js';

function makeTarget(overrides = {}) {
  return new SignalTarget({ id: 1, yaw: 0.5, pitch: -0.5, ...overrides });
}

describe('SignalTarget appearance state', () => {
  /** fadeSeconds 2 + visibleSeconds 10 + fadeSeconds 2 → 14 s life. */
  const makeLifecycle = (overrides = {}) =>
    makeTarget({ fadeSeconds: 2, visibleSeconds: 10, ...overrides });

  it('starts un-appeared with zero opacity', () => {
    const sig = makeTarget();
    expect(sig.appeared).toBe(false);
    expect(sig.opacity).toBe(0);
    expect(sig.revealed).toBe(false);
    expect(sig.expired).toBe(false);
  });

  it('ramps opacity in with fadeElapsed once appeared', () => {
    const sig = makeLifecycle();
    sig.appeared = true;

    sig.fadeElapsed = 0.5;
    expect(sig.opacity).toBeCloseTo(0.25);

    sig.fadeElapsed = 1;
    expect(sig.opacity).toBeCloseTo(0.5);
    expect(sig.revealed).toBe(false);
  });

  it('holds at full opacity through the visible window', () => {
    const sig = makeLifecycle();
    sig.appeared = true;

    for (const t of [2, 2.5, 11.9, 12]) {   // out starts at 2 + 10 = 12
      sig.fadeElapsed = t;
      expect(sig.opacity).toBe(1);
      expect(sig.revealed).toBe(true);
      expect(sig.expired).toBe(false);
    }
  });

  it('fades back out after the visible window', () => {
    const sig = makeLifecycle();
    sig.appeared = true;

    sig.fadeElapsed = 13;    // one second into the 2 s fade-out
    expect(sig.opacity).toBeCloseTo(0.5);
    expect(sig.revealed).toBe(false);

    sig.fadeElapsed = 14;
    expect(sig.opacity).toBe(0);
  });

  it('expires once fully faded out, and never comes back', () => {
    const sig = makeLifecycle();
    sig.appeared = true;

    sig.fadeElapsed = 99;
    expect(sig.opacity).toBe(0);
    expect(sig.expired).toBe(true);
    expect(sig.revealed).toBe(false);
  });

  it('is not expired while it is still visible, even late in the fade-out', () => {
    const sig = makeLifecycle();
    sig.appeared = true;

    sig.fadeElapsed = 13.9;
    expect(sig.opacity).toBeGreaterThan(0);
    expect(sig.expired).toBe(false);
  });

  it('keeps opacity at 0 before appearing regardless of fadeElapsed', () => {
    const sig = makeTarget({ fadeSeconds: 3 });
    sig.fadeElapsed = 99;   // manager never does this, but the getter is safe
    expect(sig.opacity).toBe(0);
    expect(sig.revealed).toBe(false);
    expect(sig.expired).toBe(false);   // never appeared ≠ expired
  });

  it('resolution state is independent of appearance state', () => {
    const sig = makeTarget();
    expect(sig.resolved).toBe(false);
    sig.saved = true;
    expect(sig.resolved).toBe(true);
    expect(sig.revealed).toBe(false);   // saved ≠ appeared
  });
});
