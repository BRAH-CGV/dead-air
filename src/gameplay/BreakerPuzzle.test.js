import { describe, it, expect } from 'vitest';
import { BreakerPuzzle, WIRE_COLORS } from './BreakerPuzzle.js';
import { makeRandom } from '../core/Random.js';

// ─────────────────────────────────────────────
// BreakerPuzzle — what the UFO's surge did to the generator panel
// ─────────────────────────────────────────────

/** Connect every wire to its matching terminal. */
function wireUp(p) {
  for (let l = 0; l < p.left.length; l++) p.connect(l, p.right.indexOf(p.left[l]));
}
/** Throw every breaker back on. */
function switchUp(p) {
  p.switches.forEach((on, i) => { if (!on) p.toggle(i); });
}

describe('BreakerPuzzle', () => {
  it('starts with most breakers thrown and every wire hanging loose', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const p = new BreakerPuzzle({ random: makeRandom(seed) });
      expect(p.switches).toHaveLength(6);
      expect(p.switches.filter(on => !on).length).toBeGreaterThanOrEqual(3);
      expect(p.links.every(l => l === null)).toBe(true);
      expect(p.solved).toBe(false);
    }
  });

  it('shuffles the far side so no wire runs straight across', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const p = new BreakerPuzzle({ random: makeRandom(seed) });
      expect([...p.left].sort()).toEqual([...p.right].sort());
      for (let i = 0; i < p.left.length; i++) expect(p.right[i]).not.toBe(p.left[i]);
    }
  });

  it('uses distinct, named wire colours', () => {
    const p = new BreakerPuzzle({ random: makeRandom(3) });
    expect(new Set(p.left).size).toBe(p.left.length);
    for (const c of p.left) expect(WIRE_COLORS[c].name).toBeTruthy();
  });

  it('flicks a switch both ways', () => {
    const p = new BreakerPuzzle({ random: makeRandom(4) });
    const before = p.switches[0];
    p.toggle(0);
    expect(p.switches[0]).toBe(!before);
    p.toggle(0);
    expect(p.switches[0]).toBe(before);
  });

  it('only joins a wire to the terminal of its own colour', () => {
    const p = new BreakerPuzzle({ random: makeRandom(5) });
    const wrong = p.right.findIndex(c => c !== p.left[0]);
    expect(p.connect(0, wrong)).toBe(false);
    expect(p.links[0]).toBeNull();
    const right = p.right.indexOf(p.left[0]);
    expect(p.connect(0, right)).toBe(true);
    expect(p.links[0]).toBe(right);
  });

  it('a wire can be pulled off again', () => {
    const p = new BreakerPuzzle({ random: makeRandom(6) });
    p.connect(1, p.right.indexOf(p.left[1]));
    p.disconnect(1);
    expect(p.links[1]).toBeNull();
  });

  it('is solved with every breaker on and every wire home — not before', () => {
    const p = new BreakerPuzzle({ random: makeRandom(7) });
    switchUp(p);
    expect(p.switchesOn).toBe(6);
    expect(p.solved).toBe(false);
    wireUp(p);
    expect(p.wiresConnected).toBe(p.left.length);
    expect(p.solved).toBe(true);
    p.toggle(2);
    expect(p.solved).toBe(false);
  });

  it('switching on normally: every breaker down, every lead already home — flick them all up', () => {
    const p = new BreakerPuzzle({ flick: 'on', random: makeRandom(9) });
    expect(p.switches.every(on => !on)).toBe(true);
    expect(p.wiresConnected).toBe(p.left.length);
    p.links.forEach((r, l) => expect(p.right[r]).toBe(p.left[l]));
    expect(p.solved).toBe(false);
    switchUp(p);
    expect(p.switchesDone).toBe(p.switches.length);
    expect(p.solved).toBe(true);
  });

  it('switching off normally: every breaker up, every lead home — flick them all down', () => {
    const p = new BreakerPuzzle({ flick: 'off', random: makeRandom(9) });
    expect(p.switches.every(on => on)).toBe(true);
    expect(p.wiresConnected).toBe(p.left.length);
    expect(p.solved).toBe(false);
    p.switches.forEach((_, i) => p.toggle(i));
    expect(p.switchesDone).toBe(p.switches.length);
    expect(p.solved).toBe(true);
    p.toggle(0);
    expect(p.solved).toBe(false);
  });
});
