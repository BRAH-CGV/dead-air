import { describe, it, expect } from 'vitest';
import { SignalManager } from './SignalManager.js';

const POOL = [
  'assets/signals/signal-1.png',
  'assets/signals/signal-2.png',
  'assets/signals/signal-3.png',
  'assets/signals/signal-4.png',
  'assets/signals/signal-5.png',
  'assets/signals/signal-6.png',
  'assets/signals/signal-7.png',
  'assets/signals/signal-8.png',
];

describe('SignalManager', () => {
  it('generates the configured number of signals per night', () => {
    const mgr = new SignalManager({ signalsPerNight: 5, payloadPool: POOL });
    mgr.startNight(1);
    expect(mgr.signals).toHaveLength(5);
  });

  it('assigns unique IDs starting from 1', () => {
    const mgr = new SignalManager({ signalsPerNight: 3, payloadPool: POOL });
    mgr.startNight(1);
    const ids = mgr.signals.map(s => s.id);
    expect(ids).toEqual([1, 2, 3]);
  });

  it('generates yaw in full circle and pitch in upper hemisphere', () => {
    const mgr = new SignalManager({ signalsPerNight: 50, payloadPool: POOL });
    mgr.startNight(1);

    for (const sig of mgr.signals) {
      expect(sig.yaw).toBeGreaterThanOrEqual(-Math.PI);
      expect(sig.yaw).toBeLessThanOrEqual(Math.PI);
      // Pitch: negative = up in Three.js convention.
      // Upper hemisphere mapped to roughly -10° to -70°.
      expect(sig.pitch).toBeLessThan(0);
      expect(sig.pitch).toBeGreaterThan(-Math.PI / 2);
    }
  });

  it('sets required count scaling with night number', () => {
    const mgr = new SignalManager({ signalsPerNight: 5, payloadPool: POOL });

    mgr.startNight(1);
    expect(mgr.required).toBe(3);

    mgr.startNight(2);
    expect(mgr.required).toBe(4);

    mgr.startNight(3);
    expect(mgr.required).toBe(5);
  });

  it('clamps required to signalsPerNight', () => {
    const mgr = new SignalManager({ signalsPerNight: 3, payloadPool: POOL });
    mgr.startNight(5);  // would want 7, but only 3 available
    expect(mgr.required).toBeLessThanOrEqual(3);
  });

  it('save increments the saved counter, delete does not', () => {
    const mgr = new SignalManager({ signalsPerNight: 5, payloadPool: POOL });
    mgr.startNight(1);

    mgr.saveSignal(1);
    expect(mgr.saved).toBe(1);

    mgr.deleteSignal(2);
    expect(mgr.saved).toBe(1);  // unchanged

    mgr.saveSignal(3);
    expect(mgr.saved).toBe(2);
  });

  it('marks signals as saved or deleted correctly', () => {
    const mgr = new SignalManager({ signalsPerNight: 3, payloadPool: POOL });
    mgr.startNight(1);

    mgr.markScanned(1);
    expect(mgr.signals[0].scanned).toBe(true);

    mgr.saveSignal(1);
    expect(mgr.signals[0].saved).toBe(true);
    expect(mgr.signals[0].deleted).toBe(false);

    mgr.markScanned(2);
    mgr.deleteSignal(2);
    expect(mgr.signals[1].deleted).toBe(true);
    expect(mgr.signals[1].saved).toBe(false);
  });

  it('isComplete returns true when saved >= required', () => {
    const mgr = new SignalManager({ signalsPerNight: 5, payloadPool: POOL });
    mgr.startNight(1);  // required = 3

    expect(mgr.isComplete()).toBe(false);

    mgr.saveSignal(1);
    mgr.saveSignal(2);
    expect(mgr.isComplete()).toBe(false);

    mgr.saveSignal(3);
    expect(mgr.isComplete()).toBe(true);
  });

  it('getProgress returns correct snapshot', () => {
    const mgr = new SignalManager({ signalsPerNight: 5, payloadPool: POOL });
    mgr.startNight(1);  // required = 3

    mgr.saveSignal(1);
    const p = mgr.getProgress();
    expect(p.saved).toBe(1);
    expect(p.required).toBe(3);
    expect(p.remaining).toBe(2);
  });

  it('assigns payload URLs from pool without repeats until exhausted', () => {
    const smallPool = ['a.png', 'b.png', 'c.png'];
    const mgr = new SignalManager({ signalsPerNight: 3, payloadPool: smallPool });
    mgr.startNight(1);

    const urls = mgr.signals.map(s => s.payloadUrl);
    // All three should be different (pool size = signal count)
    expect(new Set(urls).size).toBe(3);
  });

  it('recycles pool when signals exceed pool size', () => {
    const smallPool = ['a.png', 'b.png'];
    const mgr = new SignalManager({ signalsPerNight: 5, payloadPool: smallPool });
    mgr.startNight(1);

    // All signals should have a URL even though pool is smaller
    for (const sig of mgr.signals) {
      expect(sig.payloadUrl).toBeTruthy();
    }
  });

  it('selectSignal sets and clears the active target', () => {
    const mgr = new SignalManager({ signalsPerNight: 3, payloadPool: POOL });
    mgr.startNight(1);

    expect(mgr.active).toBeNull();
    mgr.selectSignal(2);
    expect(mgr.active).toBe(mgr.signals[1]);

    mgr.selectSignal(null);
    expect(mgr.active).toBeNull();
  });

  it('resets state on startNight', () => {
    const mgr = new SignalManager({ signalsPerNight: 3, payloadPool: POOL });
    mgr.startNight(1);
    mgr.saveSignal(1);
    expect(mgr.saved).toBe(1);

    mgr.startNight(2);
    expect(mgr.saved).toBe(0);
    expect(mgr.active).toBeNull();
  });

  it('ignores save/delete for unknown IDs', () => {
    const mgr = new SignalManager({ signalsPerNight: 3, payloadPool: POOL });
    mgr.startNight(1);

    mgr.saveSignal(99);
    expect(mgr.saved).toBe(0);

    mgr.deleteSignal(99);
    expect(mgr.saved).toBe(0);
  });

  it('handles empty payload pool gracefully', () => {
    const mgr = new SignalManager({ signalsPerNight: 3, payloadPool: [] });
    mgr.startNight(1);
    for (const sig of mgr.signals) {
      expect(sig.payloadUrl).toBe('');
    }
  });
});
