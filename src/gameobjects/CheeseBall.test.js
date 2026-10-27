import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createCheeseBall, cheeseHoles, CHEESE } from './CheeseBall.js';

/** Every vertex's distance from the middle. */
function radii(geometry) {
  const pos = geometry.getAttribute('position');
  const out = [];
  for (let i = 0; i < pos.count; i++) out.push(Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)));
  return out;
}

describe('cheeseHoles', () => {
  it('is the same set of holes for the same seed, and another for another', () => {
    const a = cheeseHoles(7), b = cheeseHoles(7), c = cheeseHoles(8);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.length).toBe(CHEESE.holes);
  });

  it('puts each hole on the surface, as a unit direction, sized within its range', () => {
    for (const h of cheeseHoles(3)) {
      expect(Math.hypot(...h.dir)).toBeCloseTo(1, 6);
      expect(h.radius).toBeGreaterThanOrEqual(CHEESE.holeRadius[0]);
      expect(h.radius).toBeLessThanOrEqual(CHEESE.holeRadius[1]);
    }
  });
});

describe('createCheeseBall', () => {
  it('is the globe\'s size: nothing sticks out past its radius', () => {
    const ball = createCheeseBall({ radius: 0.143 });
    const r = radii(ball.cheese.geometry);
    expect(Math.max(...r)).toBeLessThanOrEqual(0.143 + 1e-6);
    expect(Math.max(...r)).toBeGreaterThan(0.143 * 0.99);
    ball.dispose();
  });

  it('has holes in it: craters sunk well into the ball, most of the surface still whole', () => {
    const ball = createCheeseBall({ radius: 0.143 });
    const r = radii(ball.cheese.geometry);
    const sunk = r.filter((x) => x < 0.143 * 0.95).length;
    expect(Math.min(...r)).toBeLessThan(0.143 * 0.85);   // a deep one somewhere
    expect(sunk / r.length).toBeGreaterThan(0.05);
    expect(sunk / r.length).toBeLessThan(0.6);
    ball.dispose();
  });

  it('is coloured by vertex, darker down in the holes than on the rind', () => {
    const ball = createCheeseBall({ radius: 0.143 });
    const g = ball.cheese.geometry;
    const pos = g.getAttribute('position'), col = g.getAttribute('color');
    let deep = 0, top = 0, deepN = 0, topN = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      const lum = col.getX(i) + col.getY(i) + col.getZ(i);
      if (r < 0.143 * 0.88) { deep += lum; deepN++; }
      else if (r > 0.143 * 0.999) { top += lum; topN++; }
    }
    expect(deepN).toBeGreaterThan(0);
    expect(deep / deepN).toBeLessThan(top / topN);
    ball.dispose();
  });

  it('is a little toon: banded shading and a thin dark outline that casts no shadow', () => {
    const ball = createCheeseBall();
    expect(ball.cheese.material).toBeInstanceOf(THREE.MeshToonMaterial);
    expect(ball.cheese.material.gradientMap).toBeTruthy();
    expect(ball.cheese.castShadow).toBe(true);
    expect(ball.outline.material.side).toBe(THREE.BackSide);
    expect(ball.outline.castShadow).toBe(false);
    ball.dispose();
  });

  it('takes no fog: it lives indoors, where the building has none', () => {
    const ball = createCheeseBall();
    expect(ball.cheese.material.fog).toBe(false);
    expect(ball.outline.material.fog).toBe(false);
    ball.dispose();
  });
});
