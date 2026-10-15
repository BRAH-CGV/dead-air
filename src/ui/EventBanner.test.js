// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BannerTimer, EventBanner, BANNER_FADE, BANNER_DEFAULT_SECONDS } from './EventBanner.js';
import { setInteractKey } from './promptKeys.js';

// ─────────────────────────────────────────────
// BannerTimer — pure timing logic for the event banner
// ─────────────────────────────────────────────
// Fade in, hold, fade out — all on real time. A component on
// GameplaySystems ticks it with engine.realDt, so a nap's 15× timeScale
// doesn't rush it and a pause holds it.
// ─────────────────────────────────────────────

describe('BannerTimer', () => {
  it('starts idle — nothing showing', () => {
    const t = new BannerTimer();
    expect(t.visible).toBe(false);
    expect(t.text).toBe('');
  });

  it('show() makes it visible at once (the fade-in starts)', () => {
    const t = new BannerTimer();
    t.show('Hello', { seconds: 4 });
    expect(t.visible).toBe(true);
    expect(t.text).toBe('Hello');
  });

  it('after the hold time elapses, it goes invisible (fade-out done)', () => {
    const t = new BannerTimer();
    t.show('Hello', { seconds: 2 });
    // Past the fade-in and the hold: fade-in (0.3) + hold (2) + fade-out (0.3)
    t.update(3);
    expect(t.visible).toBe(false);
  });

  it('stays visible through the fade-in and the hold', () => {
    const t = new BannerTimer();
    t.show('Hello', { seconds: 4 });
    // Mid-fade-in
    t.update(0.15);
    expect(t.visible).toBe(true);
    // Mid-hold
    t.update(2);
    expect(t.visible).toBe(true);
  });

  it('a newer show() replaces the one showing, resetting the clock', () => {
    const t = new BannerTimer();
    t.show('First', { seconds: 4 });
    t.update(2);
    t.show('Second', { seconds: 4 });
    expect(t.text).toBe('Second');
    expect(t.visible).toBe(true);
    // The first message's remaining hold should not cut the second short
    t.update(2);
    expect(t.visible).toBe(true);
    expect(t.text).toBe('Second');
  });

  it('clear() hides it at once', () => {
    const t = new BannerTimer();
    t.show('Hello', { seconds: 4 });
    t.clear();
    expect(t.visible).toBe(false);
    expect(t.text).toBe('');
  });

  it('update with no show is a no-op', () => {
    const t = new BannerTimer();
    t.update(10);
    expect(t.visible).toBe(false);
  });

  it('fires onDone when the banner finishes (fade-out complete)', () => {
    const done = vi.fn();
    const t = new BannerTimer({ onDone: done });
    t.show('Hello', { seconds: 1 });
    expect(done).not.toHaveBeenCalled();
    t.update(5);   // well past the end
    expect(done).toHaveBeenCalledOnce();
  });

  it('onDone fires only once, not every update after', () => {
    const done = vi.fn();
    const t = new BannerTimer({ onDone: done });
    t.show('Hello', { seconds: 1 });
    t.update(5);
    t.update(5);
    expect(done).toHaveBeenCalledOnce();
  });

  it('a new show() after onDone does not re-fire the old callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const t = new BannerTimer({ onDone: first });
    t.show('A', { seconds: 1 });
    t.update(5);
    expect(first).toHaveBeenCalledOnce();

    t.onDone = second;
    t.show('B', { seconds: 1 });
    t.update(5);
    expect(first).toHaveBeenCalledOnce();   // not again
    expect(second).toHaveBeenCalledOnce();
  });

  it('holding: through the fade-in and the hold, not the fade-out', () => {
    const t = new BannerTimer();
    t.show('Hello', { seconds: 2 });
    t.update(BANNER_FADE + 1.9);
    expect(t.holding).toBe(true);
    t.update(0.2);
    expect(t.holding).toBe(false);
    expect(t.visible).toBe(true);   // fading out
  });

  it('defaults to BANNER_DEFAULT_SECONDS when no seconds given', () => {
    const t = new BannerTimer();
    t.show('Hello');
    // Still showing at just under the default hold
    t.update(BANNER_FADE + BANNER_DEFAULT_SECONDS - 0.1);
    expect(t.visible).toBe(true);
    // Gone past the end
    t.update(1);
    expect(t.visible).toBe(false);
  });
});

// ─────────────────────────────────────────────
// EventBanner — DOM wrapper
// ─────────────────────────────────────────────

/** Build the #event-banner markup the way index.html would. */
function makeRoot() {
  document.body.innerHTML = '<div id="event-banner"><span id="event-banner-text"></span></div>';
  return document.getElementById('event-banner');
}

describe('EventBanner (DOM)', () => {
  let root;
  beforeEach(() => {
    root = makeRoot();
    setInteractKey('E');
  });

  function banner(opts) {
    return new EventBanner(root, opts);
  }

  it('works with null root (tests)', () => {
    const b = new EventBanner(null);
    expect(() => b.show('Hello')).not.toThrow();
    expect(() => b.clear()).not.toThrow();
  });

  it('show() sets the text and makes the element visible', () => {
    const b = banner();
    b.show('Quota met');
    const span = root.querySelector('#event-banner-text');
    expect(span.textContent).toBe('Quota met');
    expect(root.classList.contains('is-shown')).toBe(true);
  });

  it('text goes through withKeys — [E] shows the bound key', () => {
    setInteractKey('F');
    const b = banner();
    b.show('[E] Wake up');
    const span = root.querySelector('#event-banner-text');
    expect(span.textContent).toBe('[F] Wake up');
  });

  it('uses an injected keyLabel', () => {
    const b = banner({ keyLabel: (t) => t.replace('[E]', '[X]') });
    b.show('[E] to retry');
    const span = root.querySelector('#event-banner-text');
    expect(span.textContent).toBe('[X] to retry');
  });

  it('tone sets a data attribute for the CSS colour accent', () => {
    const b = banner();
    b.show('Danger!', { tone: 'danger' });
    expect(root.dataset.tone).toBe('danger');
  });

  it('defaults to info tone', () => {
    const b = banner();
    b.show('Hello');
    expect(root.dataset.tone).toBe('info');
  });

  it('clear() hides the element', () => {
    const b = banner();
    b.show('Hello');
    b.clear();
    const span = root.querySelector('#event-banner-text');
    expect(span.textContent).toBe('');
    expect(root.classList.contains('is-shown')).toBe(false);
  });

  it('update() takes it down once the hold is up, so the CSS fades it out', () => {
    const b = banner();
    b.show('Hello', { seconds: 2 });
    b.update(BANNER_FADE + 1.9);
    expect(root.classList.contains('is-shown')).toBe(true);
    b.update(0.2);
    expect(root.classList.contains('is-shown')).toBe(false);
  });

  it('a newer show() replaces the text at once', () => {
    const b = banner();
    b.show('First');
    b.show('Second');
    const span = root.querySelector('#event-banner-text');
    expect(span.textContent).toBe('Second');
  });
});
