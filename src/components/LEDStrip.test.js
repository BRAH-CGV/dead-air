import { describe, it, expect } from 'vitest';
import { LEDStrip } from './LEDStrip.js';

function fakeLed() {
  return { material: { emissiveIntensity: 0 } };
}

describe('LEDStrip', () => {
  it('starts each LED at an evenly-spread phase, so they read as on/off at t=0', () => {
    const leds = [fakeLed(), fakeLed(), fakeLed()];
    const strip = new LEDStrip(leds, { period: 1, onIntensity: 2, offIntensity: 0.2 });
    strip.onUpdate(0);

    // phases: 0, 1/3, 2/3 — first two are < period/2 (on), the third isn't.
    expect(leds[0].material.emissiveIntensity).toBe(2);
    expect(leds[1].material.emissiveIntensity).toBe(2);
    expect(leds[2].material.emissiveIntensity).toBe(0.2);
  });

  it('blinks independently — not every LED flips on the same frame', () => {
    const leds = [fakeLed(), fakeLed(), fakeLed()];
    const strip = new LEDStrip(leds, { period: 1, onIntensity: 2, offIntensity: 0.2 });

    strip.onUpdate(0.4);
    // phases after +0.4: 0.4 (on), 0.733 (off), 0.0667 (on)
    expect(leds[0].material.emissiveIntensity).toBe(2);
    expect(leds[1].material.emissiveIntensity).toBe(0.2);
    expect(leds[2].material.emissiveIntensity).toBe(2);
  });

  it('wraps the phase around the period', () => {
    const leds = [fakeLed()];
    const strip = new LEDStrip(leds, { period: 1, onIntensity: 2, offIntensity: 0.2 });

    strip.onUpdate(1.5);
    // phase starts at 0, +1.5 wraps to 0.5 — right at the on/off boundary, so off.
    expect(leds[0].material.emissiveIntensity).toBe(0.2);
  });
});
