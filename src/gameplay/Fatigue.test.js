import { describe, it, expect } from 'vitest';
import { FatigueLogic, FATIGUE, tunnel, heartbeat } from './Fatigue.js';
import { STAMINA } from './Stamina.js';
import { DARK_LEVEL } from './BaseLights.js';
import { FATIGUE_DIM_MIN } from '../components/StaminaDrain.js';

/** rand() → 0 always takes the short end of every range. */
const low = () => 0;

function run(logic, seconds, stamina, step = 0.05) {
  for (let t = 0; t < seconds - 1e-9; t += step) logic.update(step, stamina);
}

describe('tunnel(stamina)', () => {
  it('is 0 until the player is tired, and tunnelMax at empty', () => {
    expect(tunnel(1)).toBe(0);
    expect(tunnel(STAMINA.tiredBelow)).toBe(0);
    expect(tunnel(0)).toBeCloseTo(FATIGUE.tunnelMax);
  });

  it('closes in smoothly as stamina falls', () => {
    let last = 0;
    for (let s = 0.5; s >= 0; s -= 0.05) {
      expect(tunnel(s)).toBeGreaterThanOrEqual(last);
      last = tunnel(s);
    }
    expect(tunnel(0.49)).toBeLessThan(0.01);      // eased: it creeps in
  });
});

describe('heartbeat(stamina)', () => {
  it('is silent until critical, then rises to 1 at empty', () => {
    expect(heartbeat(1)).toBe(0);
    expect(heartbeat(STAMINA.criticalBelow)).toBe(0);
    expect(heartbeat(STAMINA.criticalBelow / 2)).toBeCloseTo(0.5);
    expect(heartbeat(0)).toBe(1);
  });
});

describe('FatigueLogic', () => {
  it('a rested player gets nothing: no yawn, no blink, no flicker', () => {
    let yawns = 0;
    const f = new FatigueLogic({ rand: low, onYawn: () => yawns++ });
    for (let i = 0; i < 1200; i++) {
      f.update(0.05, 0.8);
      expect(f.eyelid).toBe(0);
      expect(f.dread).toBe(1);
    }
    expect(yawns).toBe(0);
  });

  it('the first yawn comes a few seconds after tiredness sets in, then every 20–35 s', () => {
    let yawns = 0;
    const f = new FatigueLogic({ rand: low, onYawn: () => yawns++ });
    run(f, FATIGUE.firstYawn[0] - 0.1, 0.4);
    expect(yawns).toBe(0);
    run(f, 0.2, 0.4);
    expect(yawns).toBe(1);
    run(f, FATIGUE.yawnGap.tired[0] - 0.2, 0.4);
    expect(yawns).toBe(1);
    run(f, 0.2, 0.4);
    expect(yawns).toBe(2);
  });

  it('yawns come faster once critical', () => {
    let yawns = 0;
    const f = new FatigueLogic({ rand: low, onYawn: () => yawns++ });
    run(f, 60, 0.15);
    const gap = FATIGUE.yawnGap.critical[0];
    expect(yawns).toBe(1 + Math.floor((60 - FATIGUE.firstYawn[0]) / gap));
  });

  it('eating back to ok stops the yawns', () => {
    let yawns = 0;
    const f = new FatigueLogic({ rand: low, onYawn: () => yawns++ });
    run(f, 1, 0.4);
    run(f, 120, 0.9);
    expect(yawns).toBe(0);
  });

  it('blinks only when critical: the lids shut and open again in blinkSeconds', () => {
    const tired = new FatigueLogic({ rand: low });
    run(tired, 60, 0.3);
    expect(tired.eyelid).toBe(0);

    const f = new FatigueLogic({ rand: low });
    run(f, FATIGUE.blinkGap[0] - 0.01, 0.15, 0.01);
    expect(f.eyelid).toBe(0);
    let peak = 0;
    for (let t = 0; t < FATIGUE.blinkSeconds + 0.02; t += 0.01) {
      f.update(0.01, 0.15);
      peak = Math.max(peak, f.eyelid);
    }
    expect(peak).toBeGreaterThan(0.95);
    expect(f.eyelid).toBe(0);
  });

  it('near empty it nods off: the lids stay shut for a moment', () => {
    const f = new FatigueLogic({ rand: low });
    let shut = 0;
    for (let t = 0; t < FATIGUE.microsleepGap[0] + FATIGUE.microsleepSeconds; t += 0.01) {
      f.update(0.01, 0.05);
      if (f.eyelid >= 0.999) shut += 0.01;
    }
    expect(shut).toBeGreaterThan(0.4);
    expect(FATIGUE.microsleepBelow).toBeLessThan(STAMINA.criticalBelow);
  });

  it('critical makes the lights stutter, never so far the base goes dark', () => {
    const f = new FatigueLogic({ rand: low });
    let lowest = 1;
    let dips = 0;
    let wasDim = false;
    for (let t = 0; t < 60; t += 0.01) {
      f.update(0.01, 0.1);
      lowest = Math.min(lowest, f.dread);
      const dim = f.dread < 1;
      if (dim && !wasDim) dips++;
      wasDim = dim;
    }
    expect(lowest).toBe(FATIGUE.dreadMin);
    expect(dips).toBeGreaterThan(4);
    expect(f.dread === 1 || f.dread === FATIGUE.dreadMin).toBe(true);
    // Stacked on the full fatigue dim it still isn't `dark`, so the Window
    // Watchers' power-cut rule can't be tripped by being tired.
    expect(FATIGUE.dreadMin * FATIGUE_DIM_MIN).toBeGreaterThanOrEqual(DARK_LEVEL);
  });

  it('a lid or flicker already under way finishes after eating', () => {
    const f = new FatigueLogic({ rand: low });
    run(f, FATIGUE.blinkGap[0] + 0.05, 0.15, 0.01);
    expect(f.eyelid).toBeGreaterThan(0);
    run(f, 1, 0.9, 0.01);
    expect(f.eyelid).toBe(0);
    expect(f.dread).toBe(1);
  });

  it('reset() opens the eyes, steadies the lights and restarts the clocks', () => {
    let yawns = 0;
    const f = new FatigueLogic({ rand: low, onYawn: () => yawns++ });
    run(f, 30, 0.05, 0.01);
    f.reset();
    expect(f.eyelid).toBe(0);
    expect(f.dread).toBe(1);
    const before = yawns;
    run(f, FATIGUE.firstYawn[0] - 0.1, 0.4);
    expect(yawns).toBe(before);
  });
});
