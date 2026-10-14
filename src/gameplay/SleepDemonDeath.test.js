import { describe, it, expect, vi } from 'vitest';
import { SleepDemonDeath, SLEEP_DEMON_DEATH as D } from './SleepDemonDeath.js';

const TOTAL = D.passOut + D.black + D.loom + D.cut;

function run(death, seconds, dt = 0.05) {
  for (let t = 0; t < seconds - 1e-9; t += dt) death.update(dt);
}

describe('SleepDemonDeath', () => {
  it('waits idle until started', () => {
    const onDone = vi.fn();
    const death = new SleepDemonDeath({ onDone });
    run(death, 10);
    expect(death.phase).toBe('idle');
    expect(death.active).toBe(false);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('runs the beats in order: pass out, black, the eyes flare open, the cut to black, then over', () => {
    const phases = [];
    const death = new SleepDemonDeath({ onPhase: p => phases.push(p) });
    death.start();
    expect(death.phase).toBe('passOut');
    run(death, D.passOut - 0.1);
    expect(death.phase).toBe('passOut');
    run(death, 0.2);
    expect(death.phase).toBe('black');
    run(death, D.black);
    expect(death.phase).toBe('flare');
    run(death, D.loom);
    expect(death.phase).toBe('cut');
    run(death, D.cut);
    expect(death.phase).toBe('over');
    expect(phases).toEqual(['passOut', 'black', 'flare', 'cut', 'over']);
  });

  it('is done exactly once, and only after every beat has run', () => {
    const onDone = vi.fn();
    const death = new SleepDemonDeath({ onDone });
    death.start();
    run(death, TOTAL - 0.1);
    expect(onDone).not.toHaveBeenCalled();
    run(death, 0.2);
    expect(onDone).toHaveBeenCalledTimes(1);
    run(death, 10);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(death.active).toBe(true);           // holds until called off
    expect(death.running).toBe(false);
  });

  it('a long frame runs through every beat it covers, each announced once', () => {
    const phases = [];
    const onDone = vi.fn();
    const death = new SleepDemonDeath({ onPhase: p => phases.push(p), onDone });
    death.start();
    death.update(TOTAL + 1);
    expect(phases).toEqual(['passOut', 'black', 'flare', 'cut', 'over']);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('will not start again while it runs, or once over', () => {
    const onPhase = vi.fn();
    const death = new SleepDemonDeath({ onPhase });
    expect(death.start()).toBe(true);
    run(death, D.passOut + 0.1);
    expect(death.start()).toBe(false);
    expect(death.phase).toBe('black');
    run(death, TOTAL);
    expect(death.start()).toBe(false);
    expect(onPhase.mock.calls.filter(([p]) => p === 'passOut')).toHaveLength(1);
  });

  it('the lids close as the body slumps, slamming shut at the end; shut through the black; snapping open at the flare', () => {
    const death = new SleepDemonDeath();
    expect(death.lid).toBe(0);
    death.start();
    run(death, D.passOut * 0.5);
    const half = death.lid;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(0.3);            // slow at first …
    expect(death.slump).toBeGreaterThan(0);
    run(death, D.passOut * 0.5 - 0.05);
    expect(death.lid).toBeGreaterThan(0.8);    // … then slammed
    run(death, 0.1);
    expect(death.phase).toBe('black');
    expect(death.lid).toBe(1);
    expect(death.slump).toBe(1);
    run(death, D.black);
    expect(death.phase).toBe('flare');
    run(death, D.lidSnap + 0.05);
    expect(death.lid).toBe(0);                 // eyes wide open
    expect(death.flare).toBeGreaterThan(0.5);
    expect(death.slump).toBe(1);               // still on the floor
  });

  it('called off, it is idle again: eyes open, standing, and it can start over', () => {
    const onDone = vi.fn();
    const death = new SleepDemonDeath({ onDone });
    death.start();
    run(death, D.passOut + D.black / 2);
    death.cancel();
    expect(death.phase).toBe('idle');
    expect(death.active).toBe(false);
    expect(death.lid).toBe(0);
    expect(death.slump).toBe(0);
    run(death, TOTAL);
    expect(onDone).not.toHaveBeenCalled();
    expect(death.start()).toBe(true);
  });

  it('the beats add up to a few seconds: a quick death, not a cutscene', () => {
    expect(TOTAL).toBeGreaterThan(2.5);
    expect(TOTAL).toBeLessThan(5);
    expect(D.passOut).toBeCloseTo(1, 1);
    expect(D.black).toBeGreaterThanOrEqual(0.5);
    expect(D.black).toBeLessThanOrEqual(1);
    expect(D.loom).toBeGreaterThanOrEqual(1);
    expect(D.loom).toBeLessThanOrEqual(1.5);
  });
});
