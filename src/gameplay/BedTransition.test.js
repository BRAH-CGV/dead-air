import { describe, it, expect, vi } from 'vitest';
import { BedTransition, BED_TRANSITION } from './BedTransition.js';

// ─────────────────────────────────────────────
// BedTransition — getting into and out of the bunk, and the half-open
// peeks while asleep, as pure steps on whatever clock it is handed
// ─────────────────────────────────────────────

const T = BED_TRANSITION;

/** Run `seconds` in frames of `step`. */
function run(bed, seconds, step = 1 / 60) {
  for (let t = 0; t < seconds - 1e-9; t += step) bed.update(Math.min(step, seconds - t));
}

/** A transition whose peeks never come (unless asked), with spies. */
function make({ rand = () => 0.5, peeks = false } = {}) {
  const onPhase = vi.fn();
  const onAsleep = vi.fn();
  const onUp = vi.fn();
  const tuning = peeks ? T : { ...T, peek: { ...T.peek, first: [1e9, 1e9], every: [1e9, 1e9] } };
  const bed = new BedTransition({ onPhase, onAsleep, onUp, rand, tuning });
  return { bed, onPhase, onAsleep, onUp };
}

const total = style => T[style].open + T[style].sitUp + T[style].standUp;

describe('BedTransition', () => {
  it('starts idle: eyes open, nothing to drive', () => {
    const { bed } = make();
    expect(bed.phase).toBe('idle');
    expect(bed.active).toBe(false);
    expect(bed.lid).toBe(0);
  });

  describe('getting in', () => {
    it('takes about two seconds, from where you stand to the pillow', () => {
      expect(T.lieDown).toBeGreaterThanOrEqual(1.5);
      expect(T.lieDown).toBeLessThanOrEqual(2.5);
      const { bed } = make();
      expect(bed.lieDown()).toBe(true);
      expect(bed.phase).toBe('lyingDown');
      expect(bed.pose).toEqual({ from: 'here', to: 'lie', t: 0 });
      run(bed, T.lieDown / 2);
      expect(bed.pose.t).toBeGreaterThan(0.2);
      expect(bed.pose.t).toBeLessThan(0.8);
    });

    it('the lids close slowly, and only once they are shut is it asleep', () => {
      const { bed, onAsleep } = make();
      bed.lieDown();
      run(bed, T.lieDown * T.lidsFrom * 0.9);
      expect(bed.lid).toBe(0);                     // still looking about
      let last = 0;
      for (let i = 0; i < 20; i++) {
        bed.update(T.lieDown / 40);
        expect(bed.lid).toBeGreaterThanOrEqual(last);
        last = bed.lid;
      }
      expect(onAsleep).not.toHaveBeenCalled();
      run(bed, T.lieDown);
      expect(bed.lid).toBe(1);
      expect(bed.phase).toBe('asleep');
      expect(bed.asleep).toBe(true);
      expect(bed.pose).toEqual({ from: 'lie', to: 'lie', t: 1 });
      expect(onAsleep).toHaveBeenCalledOnce();
    });

    it('once at a time', () => {
      const { bed } = make();
      bed.lieDown();
      expect(bed.lieDown()).toBe(false);
    });

    it('a long frame runs through to asleep, and calls it once', () => {
      const { bed, onAsleep } = make();
      bed.lieDown();
      bed.update(10);
      expect(bed.phase).toBe('asleep');
      expect(onAsleep).toHaveBeenCalledOnce();
    });
  });

  describe('getting out', () => {
    function asleep(opts) {
      const rig = make(opts);
      rig.bed.lieDown();
      rig.bed.update(T.lieDown + 0.01);
      return rig;
    }

    it('calm (the alarm, E, 6 AM): the eyes open slowly onto the ceiling, then sit up, then stand — about two seconds', () => {
      expect(total('calm')).toBeGreaterThanOrEqual(1.5);
      expect(total('calm')).toBeLessThanOrEqual(2.5);
      const { bed, onUp } = asleep();
      expect(bed.getUp('calm')).toBe(true);
      expect(bed.phase).toBe('opening');
      expect(bed.style).toBe('calm');
      expect(bed.pose).toEqual({ from: 'here', to: 'here', t: 0 });   // still lying
      run(bed, T.calm.open / 2);
      expect(bed.lid).toBeGreaterThan(0.2);                            // slowly
      expect(bed.lid).toBeLessThan(0.8);
      run(bed, T.calm.open / 2 + 0.01);
      expect(bed.lid).toBe(0);
      expect(bed.phase).toBe('sittingUp');
      expect(bed.pose.from).toBe('here');
      expect(bed.pose.to).toBe('sit');
      run(bed, T.calm.sitUp);
      expect(bed.phase).toBe('standingUp');
      expect(bed.pose.from).toBe('sit');
      expect(bed.pose.to).toBe('out');
      expect(onUp).not.toHaveBeenCalled();
      run(bed, T.calm.standUp);
      expect(bed.phase).toBe('idle');
      expect(bed.active).toBe(false);
      expect(onUp).toHaveBeenCalledOnce();
    });

    it('startled (the buzz, the roar): the eyes snap open and you sit up sharply — under a second', () => {
      expect(total('startled')).toBeLessThan(1);
      const { bed, onUp } = asleep();
      bed.getUp('startled');
      bed.update(T.startled.open + 0.001);
      expect(bed.lid).toBe(0);                     // snapped
      expect(bed.phase).toBe('sittingUp');
      // Sharp: most of the sit-up is done in the first third of it.
      bed.update(T.startled.sitUp / 3);
      expect(bed.pose.t).toBeGreaterThan(0.6);
      run(bed, total('startled'));
      expect(onUp).toHaveBeenCalledOnce();
    });

    it('the calm sit-up eases in: slower to start than the startled one', () => {
      const calm = asleep().bed;
      calm.getUp('calm');
      calm.update(T.calm.open + T.calm.sitUp / 3);
      const startled = asleep().bed;
      startled.getUp('startled');
      startled.update(T.startled.open + T.startled.sitUp / 3);
      expect(calm.pose.t).toBeLessThan(startled.pose.t);
    });

    it('woken while still getting in: turns straight into getting out, from wherever it got to', () => {
      const { bed, onAsleep, onUp } = make();
      bed.lieDown();
      run(bed, T.lieDown * 0.8);
      const lid = bed.lid;
      expect(lid).toBeGreaterThan(0);
      expect(bed.getUp('calm')).toBe(true);
      expect(bed.phase).toBe('opening');
      expect(bed.lid).toBeCloseTo(lid);            // no jump in the lids
      run(bed, total('calm') + 0.1);
      expect(onAsleep).not.toHaveBeenCalled();     // never fell asleep
      expect(onUp).toHaveBeenCalledOnce();
    });

    it('woken with the eyes open already: no time spent opening them', () => {
      const { bed } = make();
      bed.lieDown();
      bed.getUp('calm');
      bed.update(0.001);
      expect(bed.phase).toBe('sittingUp');
    });

    it('only from bed: not idle, and not twice', () => {
      const { bed } = asleep();
      expect(new BedTransition().getUp('calm')).toBe(false);
      bed.getUp('calm');
      expect(bed.getUp('startled')).toBe(false);
      expect(bed.style).toBe('calm');
    });

    it('cancel() drops it back to idle at once, without a word', () => {
      const { bed, onUp, onPhase } = asleep();
      onPhase.mockClear();
      bed.cancel();
      expect(bed.phase).toBe('idle');
      expect(bed.lid).toBe(0);
      expect(onUp).not.toHaveBeenCalled();
      expect(onPhase).not.toHaveBeenCalled();
    });

    it('tells each phase as it begins', () => {
      const { bed, onPhase } = make();
      bed.lieDown();
      bed.update(T.lieDown + 0.01);
      bed.getUp('startled');
      run(bed, 2);
      expect(onPhase.mock.calls.map(c => c[0]))
        .toEqual(['lyingDown', 'asleep', 'opening', 'sittingUp', 'standingUp', 'idle']);
    });
  });

  describe('peeks while asleep', () => {
    function asleep(rand = () => 0.5) {
      const rig = make({ peeks: true, rand });
      rig.bed.lieDown();
      rig.bed.update(T.lieDown + 0.001);
      return rig;
    }

    it('every now and again the eyes come half open, hold, and shut again completely', () => {
      const { bed } = asleep();
      expect(bed.peeking).toBe(false);
      const first = T.peek.first[0] + (T.peek.first[1] - T.peek.first[0]) * 0.5;
      run(bed, first + T.peek.open + 0.01, 0.01);
      expect(bed.peeking).toBe(true);
      expect(bed.lid).toBeCloseTo(T.peek.lid, 2);  // half open, no more
      expect(bed.lid).toBeGreaterThan(0.3);
      const hold = T.peek.hold[0] + (T.peek.hold[1] - T.peek.hold[0]) * 0.5;
      run(bed, hold + T.peek.close + 0.02, 0.01);
      expect(bed.lid).toBe(1);
      expect(bed.peeking).toBe(false);
      expect(bed.phase).toBe('asleep');            // still asleep
    });

    it('the first comes soon after the eyes shut, so even a short nap (a 30-minute one is ~1.7 s) gets one', () => {
      expect(T.peek.first[1]).toBeLessThanOrEqual(1.5);
      expect(T.peek.first[0]).toBeGreaterThan(0.3);     // a moment of black first
    });

    it('comes again, and again', () => {
      const { bed } = asleep();
      let opened = 0;
      let was = false;
      for (let t = 0; t < 60; t += 0.01) {
        bed.update(0.01);
        if (bed.peeking && !was) opened++;
        was = bed.peeking;
      }
      expect(opened).toBeGreaterThanOrEqual(3);
    });

    it('woken mid-peek, the eyes open the rest of the way from where they are', () => {
      const { bed } = asleep(() => 0);
      run(bed, T.peek.first[0] + T.peek.open + 0.01, 0.01);
      expect(bed.peeking).toBe(true);
      const lid = bed.lid;
      bed.getUp('calm');
      expect(bed.lid).toBeCloseTo(lid);
      expect(bed.peeking).toBe(false);
    });

    it('none while getting in or out', () => {
      const { bed } = make({ peeks: true });
      bed.lieDown();
      expect(bed.peeking).toBe(false);
    });
  });
});
