import { describe, it, expect } from 'vitest';
import { GeneratorSwitch, CUT_POWER, RESTORE_POWER } from './GeneratorSwitch.js';
import { Power } from '../gameplay/Power.js';

describe('GeneratorSwitch', () => {
  it('cuts the power, then restores it, and says which it will do next', () => {
    const power = new Power();
    const lever = new GeneratorSwitch();
    lever.bind(power);
    expect(lever.promptLabel).toBe(CUT_POWER);
    lever.onInteract({});
    expect(power.on).toBe(false);
    expect(lever.promptLabel).toBe(RESTORE_POWER);
    lever.onInteract({});
    expect(power.on).toBe(true);
    expect(lever.promptLabel).toBe(CUT_POWER);
  });

  it('follows the power however it changes, not only through the lever', () => {
    const power = new Power();
    const lever = new GeneratorSwitch();
    lever.bind(power);
    power.set(false);
    expect(lever.promptLabel).toBe(RESTORE_POWER);
    power.reset();
    expect(lever.promptLabel).toBe(CUT_POWER);
  });

  it('uses the labels the handoff asks for', () => {
    expect(CUT_POWER).toBe('[E] Cut power');
    expect(RESTORE_POWER).toBe('[E] Restore power');
  });

  it('does nothing unbound, and lets go on destroy', () => {
    const lever = new GeneratorSwitch();
    expect(() => lever.onInteract({})).not.toThrow();
    const power = new Power();
    lever.bind(power);
    lever.onDestroy();
    power.set(false);
    expect(lever.promptLabel).toBe(CUT_POWER);
  });
});
