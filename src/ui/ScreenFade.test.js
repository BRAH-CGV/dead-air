// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScreenFade } from './ScreenFade.js';

describe('ScreenFade', () => {
  let root, fade;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    fade = new ScreenFade(root, { fadeMs: 600, holdMs: 400 });
  });

  afterEach(() => vi.useRealTimers());

  const dark = () => root.classList.contains('is-dark');

  it('starts clear', () => {
    expect(dark()).toBe(false);
    expect(fade.playing).toBe(false);
  });

  it('fades to black, runs the callback once it is black, then fades back', () => {
    const onDark = vi.fn();
    expect(fade.play(onDark)).toBe(true);

    expect(dark()).toBe(true);
    expect(onDark).not.toHaveBeenCalled();     // still fading out

    vi.advanceTimersByTime(600);
    expect(onDark).toHaveBeenCalledOnce();     // fully black: swap the world now
    expect(dark()).toBe(true);

    vi.advanceTimersByTime(400);               // held
    expect(dark()).toBe(false);                // fading back in
    expect(fade.playing).toBe(true);

    vi.advanceTimersByTime(600);
    expect(fade.playing).toBe(false);
  });

  it('ignores a second play while one is running', () => {
    const onDark = vi.fn();
    fade.play(onDark);
    expect(fade.play(onDark)).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(onDark).toHaveBeenCalledOnce();
  });

  it('drives the CSS transition from fadeMs, so the timings cannot drift apart', () => {
    expect(root.style.transitionDuration).toBe('600ms');
  });

  it('with no element (no DOM), runs the callback at once', () => {
    const headless = new ScreenFade(null);
    const onDark = vi.fn();
    expect(headless.play(onDark)).toBe(true);
    expect(onDark).toHaveBeenCalledOnce();
    expect(headless.playing).toBe(false);
  });

  it('finds #fade on the page by default', () => {
    const el = document.createElement('div');
    el.id = 'fade';
    document.body.appendChild(el);
    expect(new ScreenFade().root).toBe(el);
    el.remove();
  });
});

describe('ScreenFade.fadeIn', () => {
  let root, fade;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    fade = new ScreenFade(root, { fadeMs: 600, holdMs: 400 });
  });

  afterEach(() => vi.useRealTimers());

  it('cuts to black at once, then fades to clear over the given time', () => {
    fade.fadeIn(1500);
    expect(root.classList.contains('is-dark')).toBe(true);
    expect(root.style.transitionDuration).toBe('0ms');      // the cut is instant

    vi.advanceTimersByTime(50);
    expect(root.classList.contains('is-dark')).toBe(false);  // fading up
    expect(root.style.transitionDuration).toBe('1500ms');
    expect(fade.playing).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(fade.playing).toBe(false);
    expect(root.style.transitionDuration).toBe('600ms');     // back to its own timing for play()
  });

  it('calls back once the scene is fully clear', () => {
    const done = vi.fn();
    fade.fadeIn(1000, done);
    vi.advanceTimersByTime(900);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(done).toHaveBeenCalledOnce();
  });

  it('with no element (no DOM), finishes at once', () => {
    const done = vi.fn();
    new ScreenFade(null).fadeIn(1000, done);
    expect(done).toHaveBeenCalledOnce();
  });
});
