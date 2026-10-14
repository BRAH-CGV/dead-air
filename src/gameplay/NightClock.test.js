import { describe, it, expect, vi } from 'vitest';
import { NightClock, NIGHT_SECONDS, SHIFT } from './NightClock.js';

describe('NightClock', () => {
  it('starts at startHour with zero elapsed', () => {
    const clock = new NightClock({ startHour: 0, endHour: 6, nightDuration: 300 });
    expect(clock.currentTime).toBe(0);
    expect(clock.elapsed).toBe(0);
    expect(clock.finished).toBe(false);
    expect(clock.paused).toBe(false);
  });

  it('accumulates elapsed time and maps it to in-game hours', () => {
    // 300 real seconds = 6 in-game hours → 50 s per hour
    const clock = new NightClock({ startHour: 0, nightDuration: 300 });
    clock.update(50);  // one in-game hour
    expect(clock.elapsed).toBeCloseTo(50);
    expect(clock.currentTime).toBeCloseTo(1.0);

    clock.update(50);  // two in-game hours
    expect(clock.currentTime).toBeCloseTo(2.0);
  });

  it('clamps currentTime to endHour and sets finished', () => {
    const clock = new NightClock({ startHour: 0, nightDuration: 300, endHour: 6 });
    clock.update(999);  // way past 6 hours
    expect(clock.currentTime).toBe(6);
    expect(clock.finished).toBe(true);
  });

  it('does not advance while paused', () => {
    const clock = new NightClock({ startHour: 0, nightDuration: 300 });
    clock.update(25);
    clock.pause();
    expect(clock.paused).toBe(true);

    clock.update(100);
    expect(clock.elapsed).toBeCloseTo(25);
    expect(clock.currentTime).toBeCloseTo(0.5);

    clock.resume();
    clock.update(25);
    expect(clock.elapsed).toBeCloseTo(50);
    expect(clock.currentTime).toBeCloseTo(1.0);
  });

  it('resets to initial state', () => {
    const clock = new NightClock({ startHour: 0, nightDuration: 300 });
    clock.update(100);
    expect(clock.elapsed).toBeGreaterThan(0);

    clock.reset();
    expect(clock.elapsed).toBe(0);
    expect(clock.currentTime).toBe(0);
    expect(clock.finished).toBe(false);
    expect(clock.paused).toBe(false);
  });

  it('fires onHourChange exactly once per integer hour crossed', () => {
    const onHour = vi.fn();
    const clock = new NightClock({ startHour: 0, nightDuration: 300 });
    clock.onHourChange = onHour;

    // 50 s = 1 hour.  Split into two updates: 30s + 20s.
    clock.update(30);  // 0.6 h — no crossing yet
    expect(onHour).not.toHaveBeenCalled();

    clock.update(20);  // 1.0 h — crosses hour 1
    expect(onHour).toHaveBeenCalledTimes(1);
    expect(onHour).toHaveBeenCalledWith(1);

    clock.update(50);  // 2.0 h — crosses hour 2
    expect(onHour).toHaveBeenCalledTimes(2);
    expect(onHour).toHaveBeenLastCalledWith(2);
  });

  it('fires onNightEnd when finished becomes true', () => {
    const onEnd = vi.fn();
    const clock = new NightClock({ startHour: 0, nightDuration: 300 });
    clock.onNightEnd = onEnd;

    clock.update(200);  // 4 hours — not done
    expect(onEnd).not.toHaveBeenCalled();

    clock.update(200);  // past 6 hours — done
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('fires onNightEnd only once even with overshoot', () => {
    const onEnd = vi.fn();
    const clock = new NightClock({ startHour: 0, nightDuration: 300 });
    clock.onNightEnd = onEnd;

    clock.update(999);  // way past
    clock.update(10);   // more time
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('fires onTick every update with currentTime', () => {
    const onTick = vi.fn();
    const clock = new NightClock({ startHour: 0, nightDuration: 300 });
    clock.onTick = onTick;

    clock.update(10);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenCalledWith(clock.currentTime);

    clock.update(10);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it('does not fire onTick while paused', () => {
    const onTick = vi.fn();
    const clock = new NightClock({ startHour: 0, nightDuration: 300 });
    clock.onTick = onTick;

    clock.pause();
    clock.update(10);
    expect(onTick).not.toHaveBeenCalled();
  });

  describe('formatTime', () => {
    it('formats midnight as 12:00 AM', () => {
      expect(NightClock.formatTime(0)).toBe('12:00 AM');
    });

    it('formats 6 as 6:00 AM', () => {
      expect(NightClock.formatTime(6)).toBe('6:00 AM');
    });

    it('formats fractional hours with minutes', () => {
      expect(NightClock.formatTime(2.5)).toBe('2:30 AM');
      expect(NightClock.formatTime(1.25)).toBe('1:15 AM');
      expect(NightClock.formatTime(3.75)).toBe('3:45 AM');
    });

    it('formats 12 as 12:00 PM', () => {
      expect(NightClock.formatTime(12)).toBe('12:00 PM');
    });

    it('formats afternoon hours as PM', () => {
      expect(NightClock.formatTime(14.5)).toBe('2:30 PM');
    });

    it('never shows :60 in the last moments of an hour (#61)', () => {
      expect(NightClock.formatTime(1.9999)).toBe('1:59 AM');
      expect(NightClock.formatTime(0.995)).toBe('12:59 AM');
      expect(NightClock.formatTime(11.9999)).toBe('11:59 AM');
      expect(NightClock.formatTime(23.9999)).toBe('11:59 PM');
    });

    it('never shows a minute ahead of the clock', () => {
      expect(NightClock.formatTime(2 + 29.6 / 60)).toBe('2:29 AM');
    });

    it('lands on the exact minute despite float error', () => {
      expect(NightClock.formatTime(0.1 + 0.2)).toBe('12:18 AM');
      expect(NightClock.formatTime(3 + 7 / 60)).toBe('3:07 AM');
    });
  });

  it('exposes a formatted timeString', () => {
    const clock = new NightClock({ startHour: 0, nightDuration: 300 });
    expect(clock.timeString).toBe('12:00 AM');

    clock.update(75);  // 1.5 hours → 1:30 AM
    expect(clock.timeString).toBe('1:30 AM');
  });
});

describe('shift length', () => {
  it('is ten real minutes by default (NIGHT_SECONDS)', () => {
    expect(NIGHT_SECONDS).toBe(600);
    expect(new NightClock().nightDuration).toBe(NIGHT_SECONDS);
  });
});

describe('the shift runs from dusk to dawn', () => {
  it('starts at sunset, 6:00 PM, and ends at 6:00 AM', () => {
    const clock = new NightClock();
    expect(clock.startHour).toBe(SHIFT.startHour);
    expect(clock.endHour).toBe(SHIFT.endHour);
    expect(clock.timeString).toBe('6:00 PM');
    clock.update(NIGHT_SECONDS / 2);
    expect(clock.timeString).toBe('12:00 AM');
    clock.update(NIGHT_SECONDS / 2);
    expect(clock.timeString).toBe('6:00 AM');
    expect(clock.finished).toBe(true);
  });

  it('keeps the old pace: 50 real seconds an hour', () => {
    expect(NIGHT_SECONDS / (SHIFT.endHour - SHIFT.startHour)).toBe(50);
  });

  it('is dark an hour after sunset', () => {
    expect(SHIFT.darkHour).toBe(SHIFT.startHour + 1);
  });

  it('crosses midnight without losing an hour', () => {
    const clock = new NightClock();
    const hours = [];
    clock.onHourChange = h => hours.push(h);
    clock.update(NIGHT_SECONDS);
    expect(hours).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('one twelve-hour shift', () => {
  it('runs sunset to sunrise with no overtime: one shift, 6:00 PM to 6:00 AM', () => {
    expect(SHIFT.endHour - SHIFT.startHour).toBe(12);
    expect(SHIFT.shiftEndHour).toBeUndefined();
    const clock = new NightClock();
    expect(clock.overtime).toBeUndefined();
    clock.update(NIGHT_SECONDS - 1);
    expect(clock.finished).toBe(false);
    clock.update(1);
    expect(clock.finished).toBe(true);
  });
});
