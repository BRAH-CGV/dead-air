import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

import { createSignalMast, SIGNAL_MAST } from './SignalMast.js';

// ─────────────────────────────────────────────
// SignalMast: a small lattice tower on the bunker's roof, a red lamp on top.
// ─────────────────────────────────────────────

describe('SignalMast', () => {
  const lit = mast => mast.blink.level;

  it('stands its full height, the lamp on the top', () => {
    const mast = createSignalMast();
    mast.object3d.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mast.object3d.getObjectByName('SignalMastFrame'));
    expect(box.min.y).toBeCloseTo(0, 1);
    expect(box.max.y).toBeGreaterThan(SIGNAL_MAST.height - 0.05);
    const lamp = mast.object3d.getObjectByName('SignalMastLamp');
    expect(lamp.position.y).toBeGreaterThan(SIGNAL_MAST.height);
  });

  it('flashes red: lit for a moment, then dark for the rest of the period', () => {
    const mast = createSignalMast();
    const { period, duty } = SIGNAL_MAST.beacon;
    mast.blink.onUpdate(period * duty * 0.5);
    expect(lit(mast)).toBeGreaterThan(0.9);
    expect(mast.glow.material.opacity).toBeGreaterThan(0.9);
    expect(mast.glow.material.color.getHex()).toBe(SIGNAL_MAST.beacon.color);
    mast.blink.onUpdate(period * 0.5);
    expect(lit(mast)).toBe(0);
    expect(mast.glow.material.opacity).toBe(0);
    // And again on the next period.
    mast.blink.onUpdate(period * 0.5);
    expect(lit(mast)).toBeGreaterThan(0.5);
  });

  it('is on its own battery, off the power grid, and adds no light to the scene', () => {
    const mast = createSignalMast();
    expect(mast.object3d.userData.offGrid).toBe(true);
    let lights = 0;
    mast.object3d.traverse(o => { if (o.isLight) lights++; });
    expect(lights).toBe(0);
  });

  it('frees everything it made', () => {
    const mast = createSignalMast();
    const made = [...mast.resources];
    expect(made.length).toBeGreaterThan(0);
    let freed = 0;
    for (const r of made) { const d = r.dispose.bind(r); r.dispose = () => { freed++; d(); }; }
    for (const r of made) r.dispose();
    expect(freed).toBe(made.length);
  });
});
