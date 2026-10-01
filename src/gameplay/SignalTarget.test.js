import { describe, it, expect } from 'vitest';
import { SignalTarget } from './SignalTarget.js';

function makeTarget(overrides = {}) {
  return new SignalTarget({ id: 1, yaw: 0.5, pitch: -0.5, ...overrides });
}

describe('SignalTarget appearance state', () => {
  it('starts un-appeared with zero opacity', () => {
    const sig = makeTarget();
    expect(sig.appeared).toBe(false);
    expect(sig.opacity).toBe(0);
    expect(sig.revealed).toBe(false);
  });

  it('ramps opacity with fadeElapsed once appeared', () => {
    const sig = makeTarget({ fadeSeconds: 2 });
    sig.appeared = true;

    sig.fadeElapsed = 0.5;
    expect(sig.opacity).toBeCloseTo(0.25);

    sig.fadeElapsed = 1;
    expect(sig.opacity).toBeCloseTo(0.5);
  });

  it('clamps opacity at 1 past the fade window', () => {
    const sig = makeTarget({ fadeSeconds: 2 });
    sig.appeared = true;

    sig.fadeElapsed = 2;
    expect(sig.opacity).toBe(1);
    expect(sig.revealed).toBe(true);

    sig.fadeElapsed = 99;
    expect(sig.opacity).toBe(1);
  });

  it('is not revealed while the fade is still running', () => {
    const sig = makeTarget({ fadeSeconds: 3 });
    sig.appeared = true;
    sig.fadeElapsed = 2.9;
    expect(sig.opacity).toBeLessThan(1);
    expect(sig.revealed).toBe(false);
  });

  it('keeps opacity at 0 before appearing regardless of fadeElapsed', () => {
    const sig = makeTarget({ fadeSeconds: 3 });
    sig.fadeElapsed = 99;   // manager never does this, but the getter is safe
    expect(sig.opacity).toBe(0);
    expect(sig.revealed).toBe(false);
  });

  it('resolution state is independent of appearance state', () => {
    const sig = makeTarget();
    expect(sig.resolved).toBe(false);
    sig.saved = true;
    expect(sig.resolved).toBe(true);
    expect(sig.revealed).toBe(false);   // saved ≠ appeared
  });
});
