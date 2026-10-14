// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DeleteWarning } from './DeleteWarning.js';

// ─────────────────────────────────────────────
// DeleteWarning — flashing "DELETE" screen effect
// ─────────────────────────────────────────────

describe('DeleteWarning', () => {
  it('is a no-op when there is no DOM root', () => {
    const warning = new DeleteWarning(null);
    expect(warning.active).toBe(false);

    // show/hide should not throw.
    warning.show();
    expect(warning.active).toBe(true);

    warning.hide();
    expect(warning.active).toBe(false);
  });

  it('creates text elements and toggles the active class on show/hide', () => {
    const root = document.createElement('div');
    const warning = new DeleteWarning(root);

    warning.show();
    expect(warning.active).toBe(true);
    expect(root.classList.contains('is-active')).toBe(true);
    expect(root.querySelectorAll('.delete-text').length).toBe(8);

    warning.hide();
    expect(warning.active).toBe(false);
    expect(root.classList.contains('is-active')).toBe(false);
    // All texts should be hidden.
    for (const el of root.querySelectorAll('.delete-text')) {
      expect(el.style.opacity).toBe('0');
    }
  });

  it('hide clears all timers', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const warning = new DeleteWarning(root);

    warning.show();
    expect(warning._items.length).toBe(8);
    // Each item should have a timer scheduled.
    const hadTimers = warning._items.some(item => item.timer !== null);
    expect(hadTimers).toBe(true);

    warning.hide();
    for (const item of warning._items) {
      expect(item.timer).toBeNull();
    }

    vi.useRealTimers();
  });

  afterEach(() => vi.useRealTimers());
});
