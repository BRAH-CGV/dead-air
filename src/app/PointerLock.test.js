// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PointerLock } from './PointerLock.js';

/** jsdom has no pointer lock: fake `document.pointerLockElement` and the
 *  element's requestPointerLock, and fire the events by hand. */
function setup() {
  const canvas = document.createElement('canvas');
  let lockedEl = null;
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true, get: () => lockedEl,
  });
  const fire = (type) => document.dispatchEvent(new Event(type));
  const lockNow = () => { lockedEl = canvas; fire('pointerlockchange'); };
  const unlockNow = () => { lockedEl = null; fire('pointerlockchange'); };
  document.exitPointerLock = vi.fn(() => unlockNow());
  return { canvas, fire, lockNow, unlockNow };
}

describe('PointerLock', () => {
  let env, lock;
  beforeEach(() => {
    vi.useFakeTimers();
    env = setup();
    lock = new PointerLock(env.canvas, { timeoutMs: 1000 });
  });
  afterEach(() => vi.useRealTimers());

  it('reports locked from document.pointerLockElement', () => {
    expect(lock.locked).toBe(false);
    env.lockNow();
    expect(lock.locked).toBe(true);
  });

  it('request() resolves true when pointerlockchange reports the element', async () => {
    env.canvas.requestPointerLock = vi.fn(() => { setTimeout(env.lockNow, 10); });
    const p = lock.request();
    vi.advanceTimersByTime(10);
    await expect(p).resolves.toBe(true);
  });

  it('works with a promise-returning requestPointerLock', async () => {
    env.canvas.requestPointerLock = vi.fn(() => {
      setTimeout(env.lockNow, 5);
      return Promise.resolve();
    });
    const p = lock.request();
    vi.advanceTimersByTime(5);
    await expect(p).resolves.toBe(true);
  });

  it('resolves false when the promise rejects (SecurityError right after Esc)', async () => {
    env.canvas.requestPointerLock = vi.fn(() => Promise.reject(new DOMException('too soon', 'SecurityError')));
    await expect(lock.request()).resolves.toBe(false);
  });

  it('resolves false on pointerlockerror', async () => {
    env.canvas.requestPointerLock = vi.fn(() => { setTimeout(() => env.fire('pointerlockerror'), 5); });
    const p = lock.request();
    vi.advanceTimersByTime(5);
    await expect(p).resolves.toBe(false);
  });

  it('resolves false on a timeout with no event', async () => {
    env.canvas.requestPointerLock = vi.fn();
    const p = lock.request();
    vi.advanceTimersByTime(1000);
    await expect(p).resolves.toBe(false);
  });

  it('never throws, even when requestPointerLock does or is missing', async () => {
    env.canvas.requestPointerLock = vi.fn(() => { throw new Error('nope'); });
    await expect(lock.request()).resolves.toBe(false);
    delete env.canvas.requestPointerLock;
    await expect(lock.request()).resolves.toBe(false);
  });

  it('resolves true at once when already locked', async () => {
    env.lockNow();
    env.canvas.requestPointerLock = vi.fn();
    await expect(lock.request()).resolves.toBe(true);
    expect(env.canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it('exit() releases the lock', () => {
    env.lockNow();
    lock.exit();
    expect(document.exitPointerLock).toHaveBeenCalled();
    expect(lock.locked).toBe(false);
  });

  it('exit() is safe when not locked', () => {
    expect(() => lock.exit()).not.toThrow();
    expect(document.exitPointerLock).not.toHaveBeenCalled();
  });

  it('onChange fires on lock and unlock, and unsubscribes', () => {
    const listener = vi.fn();
    const off = lock.onChange(listener);
    env.lockNow();
    env.unlockNow();
    expect(listener.mock.calls).toEqual([[true], [false]]);
    off();
    env.lockNow();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
