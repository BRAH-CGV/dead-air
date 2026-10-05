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

  it('blood: black at once, then slowly red — the message once it has turned', () => {
    whiteOut.play('You have been eaten. Press [E] to try again', { tone: 'blood', redMs: 2500, messageDelayMs: 2200 });
    expect(white()).toBe(true);
    expect(root.classList.contains('is-blood')).toBe(true);
    expect(root.style.transition).toMatch(/opacity 0ms/);          // no fade in: black now
    expect(root.style.backgroundColor).toMatch(/rgb\(0, 0, 0\)|#000/);
    vi.advanceTimersByTime(50);
    expect(root.style.backgroundColor).not.toMatch(/rgb\(0, 0, 0\)|#000/); // turning red…
    expect(root.style.transition).toMatch(/background-color 2500ms/); // …slowly
    vi.advanceTimersByTime(2100);
    expect(message().classList.contains('is-shown')).toBe(false);
    vi.advanceTimersByTime(100);
    expect(message().classList.contains('is-shown')).toBe(true);
  });

  it('the next plain white-out is white again', () => {
    whiteOut.play('x', { tone: 'blood' });
    vi.advanceTimersByTime(5000);
    whiteOut.clear();
    whiteOut.play('You were taken. [E] to retry');
    expect(root.classList.contains('is-blood')).toBe(false);
    expect(root.style.backgroundColor).toBe('');
  });

  it('can fade quicker for one play, and show its message sooner', () => {
    whiteOut.play('Gone.', { fadeMs: 400, messageDelayMs: 700 });
    expect(root.style.transitionDuration).toBe('400ms');
    vi.advanceTimersByTime(700);
    expect(message().classList.contains('is-shown')).toBe(true);
    whiteOut.clear();
    whiteOut.play('You were taken. [E] to retry');
    expect(root.style.transitionDuration).toBe('2000ms');   // back to its own
  });

  it('is a no-op without a DOM', () => {
    const headless = new WhiteOut(null);
    expect(() => { headless.play('x'); headless.clear(); }).not.toThrow();
  });
});
