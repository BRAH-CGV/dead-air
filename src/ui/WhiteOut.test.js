// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WhiteOut } from './WhiteOut.js';

describe('WhiteOut', () => {
  let root, whiteOut;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    root.innerHTML = '<div class="whiteout-message"></div>';
    whiteOut = new WhiteOut(root, { fadeMs: 2000, messageDelayMs: 3000 });
  });

  afterEach(() => vi.useRealTimers());

  const white = () => root.classList.contains('is-white');
  const message = () => root.querySelector('.whiteout-message');

  it('starts clear', () => {
    expect(white()).toBe(false);
    expect(whiteOut.active).toBe(false);
  });

  it('fades to white over its own duration and holds there', () => {
    whiteOut.play('You were taken. [E] to retry');
    expect(white()).toBe(true);
    expect(whiteOut.active).toBe(true);
    expect(root.style.transitionDuration).toBe('2000ms');
    vi.advanceTimersByTime(60_000);
    expect(white()).toBe(true);   // no fade back on its own — game over waits
  });

  it('shows its message only once the screen has gone white', () => {
    whiteOut.play('You were taken. [E] to retry');
    expect(message().classList.contains('is-shown')).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(message().textContent).toBe('You were taken. [E] to retry');
    expect(message().classList.contains('is-shown')).toBe(true);
  });

  it('clear() takes it away, message and all, even mid-fade', () => {
    whiteOut.play('gone');
    whiteOut.clear();
    vi.advanceTimersByTime(5000);
    expect(white()).toBe(false);
    expect(message().classList.contains('is-shown')).toBe(false);
    expect(whiteOut.active).toBe(false);
  });

  it('is a no-op without a DOM', () => {
    const headless = new WhiteOut(null);
    expect(() => { headless.play('x'); headless.clear(); }).not.toThrow();
  });
});
