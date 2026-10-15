import { describe, it, expect } from 'vitest';
import { BUGGY_CARGO, BuggyCargo } from './BuggyCargo.js';

// ─────────────────────────────────────────────
// BuggyCargo — the boot on the buggy's rear (#98)
// ─────────────────────────────────────────────

/** A stub controller that looks enough like GameController for the cargo. */
const stubController = (overrides = {}) => ({
  state: 'morning',
  dispatched: false,
  delivered: true,
  ...overrides,
});

/** A stub dock that looks enough like DriveBoxDock. */
const stubDock = (overrides = {}) => ({
  depositedBox: { isDriveBox: true },
  isQuotaMet: () => true,
  ...overrides,
});

/** A stub send-off. */
const stubSendOff = (overrides = {}) => ({
  active: false,
  started: false,
  start() { this.started = true; },
  ...overrides,
});

describe('BUGGY_CARGO — the boot\'s dimensions', () => {
  it('has the boot\'s size, top, gap, wall, lidOpen and mount', () => {
    expect(BUGGY_CARGO.size).toEqual([1.0, 0.4, 0.6]);
    expect(BUGGY_CARGO.top).toBe(1.0);
    expect(BUGGY_CARGO.gap).toBe(0.02);
    expect(BUGGY_CARGO.wall).toBe(0.04);
    expect(BUGGY_CARGO.lidOpen).toBeCloseTo(80 * Math.PI / 180, 6);
    expect(BUGGY_CARGO.mount).toBe(0.35);
  });
});

describe('BuggyCargo — labels', () => {
  it('says "Buggy" when there is no controller', () => {
    const c = new BuggyCargo();
    c.onUpdate();
    expect(c.promptLabel).toBe('Buggy');
  });

  it('names the boot during the shift', () => {
    const c = new BuggyCargo();
    c.controller = stubController({ state: 'playing' });
    c.onUpdate();
    expect(c.promptLabel).toBe('Buggy — the drives go in its boot after the shift');
  });

  it('asks for the box in the morning with no box yet', () => {
    const c = new BuggyCargo();
    c.controller = stubController({ state: 'morning' });
    c.dock = stubDock({ depositedBox: null });
    c.onUpdate();
    expect(c.promptLabel).toBe('Buggy — put the drive box in its boot');
  });

  it('says the box is short of the quota', () => {
    const c = new BuggyCargo();
    c.controller = stubController({ state: 'morning' });
    c.dock = stubDock({ isQuotaMet: () => false });
    c.onUpdate();
    expect(c.promptLabel).toBe('Buggy — the box in its boot is short of the quota');
  });

  it('says drives loaded once dispatched', () => {
    const c = new BuggyCargo();
    c.controller = stubController({ dispatched: true });
    c.dock = stubDock();
    c.onUpdate();
    expect(c.promptLabel).toBe('Buggy — drives loaded');
  });

  it('says drives loaded while the cutscene runs', () => {
    const c = new BuggyCargo();
    c.controller = stubController();
    c.dock = stubDock();
    c.sendOff = stubSendOff({ active: true });
    c.onUpdate();
    expect(c.promptLabel).toBe('Buggy — drives loaded');
  });

  it('offers "[E] Send the buggy off" when it can go', () => {
    const c = new BuggyCargo();
    c.controller = stubController();
    c.dock = stubDock();
    c.onUpdate();
    // canSend is true: morning, quota met, not dispatched, no sendOff active
    expect(c.canSend).toBe(true);
    expect(c.promptLabel).toBe('[E] Send the buggy off');
  });
});

describe('BuggyCargo — canSend', () => {
  it('is false outside the morning', () => {
    const c = new BuggyCargo();
    c.controller = stubController({ state: 'playing' });
    c.dock = stubDock();
    expect(c.canSend).toBe(false);
  });

  it('is false when the dock has no box', () => {
    const c = new BuggyCargo();
    c.controller = stubController();
    c.dock = stubDock({ depositedBox: null });
    expect(c.canSend).toBe(false);
  });

  it('is false when the quota is not met', () => {
    const c = new BuggyCargo();
    c.controller = stubController();
    c.dock = stubDock({ isQuotaMet: () => false });
    expect(c.canSend).toBe(false);
  });

  it('is false once dispatched', () => {
    const c = new BuggyCargo();
    c.controller = stubController({ dispatched: true });
    c.dock = stubDock();
    expect(c.canSend).toBe(false);
  });

  it('is false while the send-off runs', () => {
    const c = new BuggyCargo();
    c.controller = stubController();
    c.dock = stubDock();
    c.sendOff = stubSendOff({ active: true });
    expect(c.canSend).toBe(false);
  });

  it('is true when everything is ready', () => {
    const c = new BuggyCargo();
    c.controller = stubController();
    c.dock = stubDock();
    expect(c.canSend).toBe(true);
  });
});

describe('BuggyCargo — onInteract', () => {
  it('starts the send-off when one is wired', () => {
    const c = new BuggyCargo();
    c.controller = stubController();
    c.dock = stubDock();
    const sendOff = stubSendOff();
    c.sendOff = sendOff;
    c.onInteract();
    expect(sendOff.started).toBe(true);
  });

  it('dispatches directly when no send-off is wired', () => {
    const dispatched = { called: false };
    const c = new BuggyCargo();
    c.controller = { ...stubController(), dispatch() { dispatched.called = true; return true; } };
    c.dock = stubDock();
    c.onInteract();
    expect(dispatched.called).toBe(true);
  });

  it('does nothing when canSend is false', () => {
    const c = new BuggyCargo();
    c.controller = stubController({ state: 'playing' });
    c.dock = stubDock();
    const sendOff = stubSendOff();
    c.sendOff = sendOff;
    c.onInteract();
    expect(sendOff.started).toBe(false);
  });
});
