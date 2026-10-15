import { describe, it, expect } from 'vitest';
import { CameraTransition, SIGNAL } from './CameraTransition.js';

// ─────────────────────────────────────────────
// CameraTransition  –  one timeline for the picture and the hiss of a
// camera switch: the old frame freezes and degrades, holds while the new
// camera loads, and the live picture resolves out of the noise.
// ─────────────────────────────────────────────

const DT = 1 / 60;
function run(t, seconds, live) {
  for (let s = 0; s < seconds - 1e-9; s += DT) t.update(DT, live);
}

describe('CameraTransition', () => {
  it('is idle until a cut, drawing nothing and silent', () => {
    const t = new CameraTransition();
    run(t, 1, true);
    expect(t.phase).toBe('idle');
    expect(t.active).toBe(false);
    expect(t.frozen).toBe(false);
    expect(t.noise).toBe(0);
    expect(t.hiss).toBe(0);
  });

  it('a cut freezes the old frame and degrades it in over the drop', () => {
    const t = new CameraTransition();
    t.cut();
    expect(t.phase).toBe('drop');
    expect(t.active).toBe(true);
    expect(t.frozen).toBe(true);
    t.update(DT, false);
    const early = { noise: t.noise, desat: t.desat };
    run(t, SIGNAL.drop, false);
    expect(t.phase).toBe('wait');
    expect(t.noise).toBeGreaterThan(early.noise);
    expect(t.desat).toBeGreaterThan(early.desat);
    expect(t.tear).toBeGreaterThan(0);
  });

  it('holds the frozen frame for as long as the picture is not live, however long', () => {
    const t = new CameraTransition();
    t.cut();
    run(t, 10, false);
    expect(t.phase).toBe('wait');
    expect(t.frozen).toBe(true);
    expect(t.noise).toBeCloseTo(SIGNAL.waitNoise);
  });

  it('never resolves before the drop has played, even if the picture is live at once', () => {
    const t = new CameraTransition();
    t.cut();
    run(t, SIGNAL.drop * 0.5, true);
    expect(t.phase).toBe('drop');
    expect(t.frozen).toBe(true);
  });

  it('once live, resolves: the live picture shows through noise that dies away, then idle', () => {
    const t = new CameraTransition();
    t.cut();
    run(t, SIGNAL.drop + 0.2, false);
    t.update(DT, true);
    expect(t.phase).toBe('resolve');
    expect(t.frozen).toBe(false);
    const start = t.noise;
    expect(start).toBeGreaterThan(0);
    run(t, SIGNAL.resolve * 0.5, true);
    expect(t.noise).toBeLessThan(start);
    expect(t.band).toBeGreaterThan(0);
    run(t, SIGNAL.resolve, true);
    expect(t.phase).toBe('idle');
    expect(t.active).toBe(false);
    expect(t.noise).toBe(0);
  });

  it('drops straight back to the wait if the picture stops being live mid-resolve', () => {
    // Can't happen through CameraFeed today, but the frozen frame is gone
    // by then: it must not show an unready picture, so it goes back to grain.
    const t = new CameraTransition();
    t.cut();
    run(t, SIGNAL.drop + 0.05, true);
    expect(t.phase).toBe('resolve');
    t.update(DT, false);
    expect(t.phase).toBe('wait');
  });

  it('says when a wait has run long, for a CONNECTING label', () => {
    const t = new CameraTransition();
    t.cut();
    run(t, SIGNAL.drop + SIGNAL.longWait * 0.8, false);
    expect(t.waitingLong).toBe(false);
    run(t, SIGNAL.longWait * 0.4, false);
    expect(t.waitingLong).toBe(true);
    t.update(DT, true);
    expect(t.waitingLong).toBe(false);
  });

  it('a cut mid-wait or mid-resolve starts over from the drop', () => {
    for (const live of [false, true]) {
      const t = new CameraTransition();
      t.cut();
      run(t, SIGNAL.drop + 0.04, live);
      t.cut();
      expect(t.phase).toBe('drop');
      expect(t.frozen).toBe(true);
      expect(t.waitingLong).toBe(false);
    }
  });

  it('the hiss is at full from the cut: no swell in', () => {
    const t = new CameraTransition();
    t.cut();
    expect(t.hiss).toBe(1);
    t.update(DT, false);
    expect(t.hiss).toBe(1);
    run(t, SIGNAL.drop + 0.3, false);
    expect(t.hiss).toBe(1);
  });

  it('the hiss drops out quickly once the picture is live, well before the grain is gone', () => {
    const t = new CameraTransition();
    t.cut();
    run(t, SIGNAL.drop + 0.1, false);
    t.update(DT, true);
    expect(t.hiss).toBeGreaterThan(0);
    run(t, SIGNAL.hissOut + DT, true);
    expect(t.hiss).toBe(0);
    expect(t.noise).toBeGreaterThan(0);              // the picture is still resolving
    expect(SIGNAL.hissOut).toBeLessThanOrEqual(0.06);
  });

  it('the hiss is silent when idle', () => {
    const t = new CameraTransition();
    t.cut();
    run(t, SIGNAL.drop + SIGNAL.resolve + 0.1, true);
    expect(t.hiss).toBe(0);
  });

  it('the frozen frame rolls on through the wait', () => {
    const t = new CameraTransition();
    t.cut();
    run(t, SIGNAL.drop + 0.1, false);
    const a = t.roll;
    run(t, 0.5, false);
    expect(t.roll).not.toBe(a);
    expect(t.roll).toBeGreaterThanOrEqual(0);
    expect(t.roll).toBeLessThan(1);
  });

  it('with reduced motion: no tear, no roll — the grain fades and the picture cuts', () => {
    const t = new CameraTransition({ reducedMotion: true });
    t.cut();
    for (let s = 0; s < 2; s += DT) {
      t.update(DT, s > 0.5);
      expect(t.tear).toBe(0);
      expect(t.roll).toBe(0);
    }
  });

  it('a blank cut (sitting down) has no old picture to freeze: grain over black', () => {
    const t = new CameraTransition();
    t.cut({ blank: true });
    expect(t.blank).toBe(true);
    expect(t.frozen).toBe(true);           // still an opaque cover over the frame
    run(t, SIGNAL.drop + 0.3, false);
    expect(t.blank).toBe(true);
    t.cut();                               // a switch afterwards freezes the picture
    expect(t.blank).toBe(false);
  });

  it('reset() puts it back to idle at once (leaving the monitor)', () => {
    const t = new CameraTransition();
    t.cut();
    run(t, 0.2, false);
    t.reset();
    expect(t.phase).toBe('idle');
    expect(t.hiss).toBe(0);
    expect(t.waitingLong).toBe(false);
  });
});
