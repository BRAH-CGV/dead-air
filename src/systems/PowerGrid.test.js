import * as THREE from 'three';
import { describe, it, expect, vi } from 'vitest';
import { PowerGrid } from './PowerGrid.js';

// ─────────────────────────────────────────────
// PowerGrid — the base's lights on one switch at the generator
// ─────────────────────────────────────────────

const lamp = (intensity = 4) => new THREE.PointLight(0xffffff, intensity);
const glow = (emissiveIntensity = 2) => new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity });

describe('PowerGrid', () => {
  it('starts on, unbroken, at full level', () => {
    const grid = new PowerGrid();
    expect(grid.on).toBe(true);
    expect(grid.broken).toBe(false);
    expect(grid.lit).toBe(true);
    grid.update(0.016);
    expect(grid.level).toBe(1);
  });

  it('keeps each light at the intensity it was built with while on', () => {
    const grid = new PowerGrid();
    const light = lamp(6);
    grid.addLight(light);
    grid.update(0.016);
    expect(light.intensity).toBe(6);
  });

  it('zeroes lights and emissive fittings when switched off, and brings them back', () => {
    const grid = new PowerGrid();
    const light = lamp(6);
    const material = glow(1.8);
    grid.addLight(light);
    grid.addMaterial(material);

    grid.setOn(false);
    grid.update(0.016);
    expect(light.intensity).toBe(0);
    expect(material.emissiveIntensity).toBe(0);
    // Never hidden: hiding a light recompiles every lit shader (AGENTS.md).
    expect(light.visible).toBe(true);

    grid.setOn(true);
    grid.update(0.016);
    expect(light.intensity).toBe(6);
    expect(material.emissiveIntensity).toBe(1.8);
  });

  it('dims an unlit (Basic) material through its colour', () => {
    const grid = new PowerGrid();
    const material = new THREE.MeshBasicMaterial({ color: 0x35ff7a });
    grid.addMaterial(material);
    grid.setOn(false);
    grid.update(0.016);
    expect(material.color.getHex()).toBe(0x000000);
    grid.setOn(true);
    grid.update(0.016);
    expect(material.color.getHex()).toBe(0x35ff7a);
  });

  it('hands its level to consumers that drive their own brightness', () => {
    const grid = new PowerGrid();
    const consumer = { powerLevel: 1 };
    grid.addConsumer(consumer);
    grid.setOn(false);
    grid.update(0.016);
    expect(consumer.powerLevel).toBe(0);
  });

  it('broken lights stay dark with the power back on — until repaired', () => {
    const grid = new PowerGrid();
    const light = lamp(6);
    grid.addLight(light);

    grid.breakLights();
    expect(grid.broken).toBe(true);
    expect(grid.on).toBe(false);   // the surge trips the generator too
    grid.resetBreakers();
    grid.setOn(true);
    grid.update(0.016);
    expect(grid.on).toBe(true);    // vital functions are back…
    expect(grid.lit).toBe(false);  // …the lights are not
    expect(light.intensity).toBe(0);

    grid.repair();
    grid.update(0.016);
    expect(light.intensity).toBe(6);
  });

  it('a surge drives the lights far past their normal brightness, flickering', () => {
    // Each reroll draws twice (hold time, then state): alternate the state
    // draw so the flicker shows both a drop and a flare.
    const dice = [0.5, 0.05, 0.5, 0.95];
    let n = 0;
    const grid = new PowerGrid({ random: () => dice[n++ % dice.length] });
    const light = lamp(2);
    grid.addLight(light);
    grid.surge = 1;

    const seen = [];
    for (let i = 0; i < 120; i++) {
      grid.update(1 / 60);
      seen.push(light.intensity);
    }
    expect(Math.max(...seen)).toBeGreaterThan(2 * 2);   // well over normal
    expect(Math.min(...seen)).toBeLessThan(2 * 0.5);    // and dropping out
  });

  it('a surge does nothing to a dark grid', () => {
    const grid = new PowerGrid({ random: () => 0.99 });
    const light = lamp(2);
    grid.addLight(light);
    grid.setOn(false);
    grid.surge = 1;
    grid.update(0.5);
    expect(light.intensity).toBe(0);
  });

  it('tells listeners when the switch or the bulbs change, and stops when unsubscribed', () => {
    const grid = new PowerGrid();
    const fn = vi.fn();
    const off = grid.onChange(fn);
    grid.setOn(false);
    grid.setOn(false);   // no change, no call
    grid.breakLights();
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    grid.repair();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('collect() takes every light and glowing material under a root, skipping off-grid subtrees', () => {
    const root = new THREE.Group();
    const light = lamp(3);
    const fixture = new THREE.Mesh(new THREE.BoxGeometry(), glow(1.5));
    const plain = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const battery = new THREE.Group();
    battery.userData.offGrid = true;
    const beacon = lamp(2);
    battery.add(beacon);
    root.add(light, fixture, plain, battery);

    const grid = new PowerGrid();
    grid.collect(root);
    grid.setOn(false);
    grid.update(0.016);

    expect(light.intensity).toBe(0);
    expect(fixture.material.emissiveIntensity).toBe(0);
    expect(beacon.intensity).toBe(2);   // emergency battery
  });

  it('collect() registers a shared material once', () => {
    const shared = glow(1.4);
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), shared), new THREE.Mesh(new THREE.BoxGeometry(), shared));
    const grid = new PowerGrid();
    grid.collect(root);
    grid.surge = 0;
    grid.update(0.016);
    expect(shared.emissiveIntensity).toBe(1.4);
  });
});

describe('PowerGrid — unbreakable lamps', () => {
  it('keeps unbreakable lamps lit through a blow-out once the power is back, but on the switch', () => {
    const grid = new PowerGrid();
    const bulb = lamp(4);
    const flood = lamp(6);
    grid.addLight(bulb);
    grid.addLight(flood, { breakable: false });

    grid.breakLights();          // trips the generator too
    grid.update(0.016);
    expect(flood.intensity).toBe(0);

    grid.resetBreakers();
    grid.setOn(true);
    grid.update(0.016);
    expect(bulb.intensity).toBe(0);
    expect(flood.intensity).toBe(6);
  });

  it('collect() reads unbreakable from the option or from userData on a subtree', () => {
    const root = new THREE.Group();
    const screen = new THREE.Group();
    screen.userData.unbreakable = true;
    const glowLight = lamp(0.5);
    screen.add(glowLight);
    const ceiling = lamp(14);
    root.add(screen, ceiling);
    const pad = new THREE.Group();
    const padLight = lamp(8);
    pad.add(padLight);

    const grid = new PowerGrid();
    grid.collect(root);
    grid.collect(pad, { breakable: false });
    grid.breakLights();
    grid.resetBreakers();
    grid.setOn(true);
    grid.update(0.016);

    expect(ceiling.intensity).toBe(0);
    expect(glowLight.intensity).toBe(0.5);
    expect(padLight.intensity).toBe(8);
  });
});

describe('PowerGrid — tripped breakers', () => {
  it('a blow-out trips the breakers: the switch alone cannot bring the power back', () => {
    const grid = new PowerGrid();
    grid.breakLights();
    expect(grid.tripped).toBe(true);
    grid.setOn(true);
    expect(grid.on).toBe(false);
    grid.resetBreakers();
    expect(grid.tripped).toBe(false);
    grid.setOn(true);
    expect(grid.on).toBe(true);
  });

  it('cutting the power by hand never trips anything', () => {
    const grid = new PowerGrid();
    grid.setOn(false);
    expect(grid.tripped).toBe(false);
    grid.setOn(true);
    expect(grid.on).toBe(true);
  });

  it('a new night (repair) resets the breakers along with the bulbs', () => {
    const grid = new PowerGrid();
    grid.breakLights();
    grid.repair();
    expect(grid.tripped).toBe(false);
    grid.setOn(true);
    expect(grid.on).toBe(true);
  });

  it('tells listeners when the breakers are reset', () => {
    const grid = new PowerGrid();
    grid.breakLights();
    const fn = vi.fn();
    grid.onChange(fn);
    grid.resetBreakers();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('PowerGrid — brown-out', () => {
  it('a brown-out makes the lamps gutter and dim, never flare', () => {
    const dice = [0.5, 0.05, 0.5, 0.95];
    let n = 0;
    const grid = new PowerGrid({ random: () => dice[n++ % dice.length] });
    const light = lamp(2);
    grid.addLight(light);
    grid.brownout = 1;
    const seen = [];
    for (let i = 0; i < 120; i++) {
      grid.update(1 / 60);
      seen.push(light.intensity);
    }
    expect(Math.max(...seen)).toBeLessThanOrEqual(2);   // never past normal
    expect(Math.min(...seen)).toBeLessThan(2 * 0.3);    // guttering out
    grid.brownout = 0;
    grid.update(1 / 60);
    expect(light.intensity).toBe(2);
  });
});

describe('PowerGrid — dim factors', () => {
  it('dims every lamp and fitting by a named factor, unbreakable ones too', () => {
    const grid = new PowerGrid();
    const light = lamp(6);
    const screen = lamp(2);
    const material = glow(1.8);
    grid.addLight(light);
    grid.addLight(screen, { breakable: false });
    grid.addMaterial(material);

    grid.setFactor('fatigue', 0.5);
    grid.update(0.016);
    expect(light.intensity).toBeCloseTo(3);
    expect(screen.intensity).toBeCloseTo(1);
    expect(material.emissiveIntensity).toBeCloseTo(0.9);
  });

  it('multiplies factors together, and every factor back at 1 restores the built values', () => {
    const grid = new PowerGrid();
    const light = lamp(4);
    grid.addLight(light);
    grid.setFactor('fatigue', 0.6);
    grid.setFactor('dread', 0.5);
    expect(grid.dim).toBeCloseTo(0.3);
    grid.update(0.016);
    expect(light.intensity).toBeCloseTo(1.2);

    grid.setFactor('fatigue', 1);
    grid.setFactor('dread', 1);
    grid.update(0.016);
    expect(light.intensity).toBe(4);
  });

  it('composes with the switch: off is still off', () => {
    const grid = new PowerGrid();
    const light = lamp(4);
    grid.addLight(light);
    grid.setFactor('fatigue', 0.6);
    grid.setOn(false);
    grid.update(0.016);
    expect(light.intensity).toBe(0);
  });

  it('dims an unlit (Basic) fitting through its colour', () => {
    const grid = new PowerGrid();
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    grid.addMaterial(material);
    grid.setFactor('fatigue', 0.5);
    grid.update(0.016);
    expect(material.color.r).toBeCloseTo(0.5);
  });

  it('leaves the electrical level and the consumers alone: dimming is what the player sees', () => {
    const grid = new PowerGrid();
    const strip = { powerLevel: 1 };
    grid.addConsumer(strip);
    grid.setFactor('fatigue', 0.5);
    grid.update(0.016);
    expect(grid.level).toBe(1);
    expect(strip.powerLevel).toBe(1);
  });

  it('reads 1 for a factor never set, and never goes below 0', () => {
    const grid = new PowerGrid();
    expect(grid.getFactor('dread')).toBe(1);
    grid.setFactor('dread', -2);
    expect(grid.getFactor('dread')).toBe(0);
  });
});
