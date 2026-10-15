import { describe, it, expect } from 'vitest';
import {
  windowEdgePoint, inWindowView, approachRoute, climbRoute, slopeOut, ventIntake,
  NavGraph, RAGNO_PATHS,
} from './RagnoPaths.js';

// The base as built (BaseScene): the office at the origin, 12 × 10 inside a
// 0.2 m wall, its window 8.5 m wide in the back (−z) wall; the wings either
// side, 6 × 8, their end walls' outer faces at x ±16.3; the slopes 1.5 m out
// at the ground, 0.15 m under a roof at 3.1 m.
const WIN = { x0: -4.25, x1: 4.25, z: -4.9, sill: 0.475, top: 2.825 };
const EYE = { x: 0, y: 1.24, z: -1.3 };
const SLOPE = { batter: 1.5, shoulder: 0.15, height: 3.1 };
const SIDE = sign => ({
  sign,
  endX: 16.3 * sign,
  back: -3.1,            // the wing's window-side wall face
  front: 5.1,            // its yard-side wall face
  vent: { z: sign < 0 ? 1.5 : 3.7, y: 2.2 },
});
const FENCE = { minX: -16.5, maxX: 16.5, minZ: 4.1, maxZ: 22 };
const LAYOUT = { window: WIN, eye: EYE, slope: SLOPE, fence: FENCE, ground: () => 0 };

describe('the window\'s view from the desk', () => {
  it('a point on the glass\'s edge, pushed in, is in view; pushed out, is not', () => {
    for (const side of [-1, 1]) {
      expect(inWindowView(windowEdgePoint(LAYOUT, side, 20, 3), EYE, WIN)).toBe(true);
      expect(inWindowView(windowEdgePoint(LAYOUT, side, 20, -3), EYE, WIN)).toBe(false);
    }
  });

  it('nothing behind the window\'s plane is in view', () => {
    expect(inWindowView({ x: 0, z: -4 }, EYE, WIN)).toBe(false);
    expect(inWindowView({ x: -20, z: -4.5 }, EYE, WIN)).toBe(false);
  });

  it('the edge point is that far from the eye, out past the glass', () => {
    const p = windowEdgePoint(LAYOUT, -1, 20, 2);
    expect(Math.hypot(p.x - EYE.x, p.z - EYE.z)).toBeCloseTo(20);
    expect(p.z).toBeLessThan(WIN.z);
    expect(p.x).toBeLessThan(0);
  });
});

describe('the slope', () => {
  it('is `batter` out at the ground and `shoulder` out under the roof', () => {
    expect(slopeOut(SLOPE, 0)).toBeCloseTo(1.5);
    expect(slopeOut(SLOPE, 3.1)).toBeCloseTo(0.15);
  });

  it('the vent\'s intake sits on the slope at the vent\'s height, its normal out and up', () => {
    for (const sign of [-1, 1]) {
      const side = SIDE(sign);
      const { point, normal } = ventIntake(side, SLOPE);
      expect(point.y).toBeCloseTo(side.vent.y);
      expect(point.x).toBeCloseTo(side.endX + sign * slopeOut(SLOPE, side.vent.y));
      expect(point.z).toBeCloseTo(side.vent.z);
      expect(Math.sign(normal.x)).toBe(sign);
      expect(normal.y).toBeGreaterThan(0);
      expect(Math.hypot(normal.x, normal.y, normal.z)).toBeCloseTo(1);
    }
  });

  it('the climb runs from the ground at the toe up the slope to the intake', () => {
    const side = SIDE(1);
    const route = climbRoute(side, LAYOUT);
    const first = route[0], last = route[route.length - 1];
    expect(first.y).toBeCloseTo(0);
    expect(first.up).toEqual([0, 1, 0]);
    const intake = ventIntake(side, SLOPE).point;
    expect(last.x).toBeCloseTo(intake.x);
    expect(last.y).toBeCloseTo(intake.y);
    // Every point from the toe on lies on the slope.
    for (const p of route.slice(1)) expect(Math.abs(p.x - side.endX)).toBeCloseTo(slopeOut(SLOPE, p.y), 5);
  });
});

describe('approach routes', () => {
  /** Degrees the walk turns at each point (between one stretch and the next). */
  const turns = (route) => {
    const out = [];
    for (let i = 1; i < route.length - 1; i++) {
      const a = Math.atan2(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
      const b = Math.atan2(route[i + 1].x - route[i].x, route[i + 1].z - route[i].z);
      let d = Math.abs(b - a) * 180 / Math.PI;
      if (d > 180) d = 360 - d;
      out.push(d);
    }
    return out;
  };

  for (const sign of [-1, 1]) {
    const side = SIDE(sign);
    const name = sign < 0 ? 'left' : 'right';

    for (const approach of ['window', 'yard']) {
      it(`${approach} side, ${name}: ends with a straight run in to the vent, square to the end wall`, () => {
        const route = approachRoute(approach, side, LAYOUT);
        const foot = climbRoute(side, LAYOUT)[0];
        const end = route[route.length - 1];
        expect(Math.hypot(end.x - foot.x, end.z - foot.z)).toBeLessThan(1e-6);
        const before = route[route.length - 2];
        expect(before.z).toBeCloseTo(side.vent.z, 6);
        expect(Math.abs(before.x - side.endX)).toBeCloseTo(RAGNO_PATHS.straightOut, 6);
      });

      it(`${approach} side, ${name}: the way there is rounded, no sharp corners`, () => {
        const route = approachRoute(approach, side, LAYOUT);
        // Every turn but the last (into the straight run) is gentle.
        for (const t of turns(route).slice(0, -1)) expect(t).toBeLessThan(35);
      });

      it(`${approach} side, ${name}: keeps wide of the building, out on its own end`, () => {
        const route = approachRoute(approach, side, LAYOUT);
        for (const p of route.slice(1, -1)) expect(Math.sign(p.x)).toBe(sign);
        for (const p of route.slice(1, -1)) expect(Math.abs(p.x)).toBeGreaterThan(Math.abs(side.endX) + SLOPE.batter);
      });

      it(`${approach} side, ${name}: has places to scurry to, out of the window's view`, () => {
        const route = approachRoute(approach, side, LAYOUT);
        const hides = route.filter(p => p.hide);
        expect(hides.length).toBeGreaterThan(2);
        for (const h of hides) {
          expect(inWindowView(h, EYE, WIN)).toBe(false);
          expect(Math.sign(h.x)).toBe(sign);
        }
      });
    }

    it(`window side, ${name}: one far glimpse at the window's edge, the rest out of its view`, () => {
      const route = approachRoute('window', side, LAYOUT);
      expect(route[0].edge).toBe(true);
      expect(inWindowView(route[0], EYE, WIN)).toBe(true);
      const out = windowEdgePoint(LAYOUT, sign, Math.hypot(route[0].x - EYE.x, route[0].z - EYE.z), -0.5);
      expect(inWindowView(out, EYE, WIN)).toBe(false);
      for (const p of route.slice(1)) expect(inWindowView(p, EYE, WIN)).toBe(false);
    });

    it(`yard side, ${name}: never sets foot inside the fence`, () => {
      const route = approachRoute('yard', side, LAYOUT);
      for (let i = 1; i < route.length; i++) {
        for (let t = 0; t <= 1; t += 0.05) {
          const x = route[i - 1].x + (route[i].x - route[i - 1].x) * t;
          const z = route[i - 1].z + (route[i].z - route[i - 1].z) * t;
          const inside = x > FENCE.minX && x < FENCE.maxX && z > FENCE.minZ && z < FENCE.maxZ;
          expect(inside).toBe(false);
        }
      }
    });

    it(`yard side, ${name}: starts out beyond the fence`, () => {
      expect(approachRoute('yard', side, LAYOUT)[0].z).toBeGreaterThan(FENCE.maxZ);
    });
  }

  it('route points stand on the ground', () => {
    const route = approachRoute('window', SIDE(-1), { ...LAYOUT, ground: (x, z) => 0.1 * x + 0.05 * z });
    for (const p of route) expect(p.y).toBeCloseTo(0.1 * p.x + 0.05 * p.z);
  });

  it('the window glimpse is only just inside the view', () => {
    expect(RAGNO_PATHS.glimpse).toBeGreaterThan(0);
    expect(RAGNO_PATHS.glimpse).toBeLessThan(4);
  });
});

describe('NavGraph', () => {
  // quarters ─ corridor ─ office ─ corridor ─ server, and a dead end off the office.
  const graph = new NavGraph([
    { id: 'q', x: -13, z: 2 },
    { id: 'qc', x: -8, z: 3.5 },
    { id: 'o', x: 0, z: 1 },
    { id: 'sc', x: 8, z: 3.5, door: true },
    { id: 's', x: 13, z: 3 },
    { id: 'nook', x: 2, z: -2 },
  ], [['q', 'qc'], ['qc', 'o'], ['o', 'sc'], ['sc', 's'], ['o', 'nook']]);

  it('finds the shortest way through the nodes', () => {
    expect(graph.route('q', 's').map(n => n.id)).toEqual(['q', 'qc', 'o', 'sc', 's']);
    expect(graph.route('nook', 'q').map(n => n.id)).toEqual(['nook', 'o', 'qc', 'q']);
  });

  it('the nearest node to a point', () => {
    expect(graph.nearest({ x: 7, z: 3 }).id).toBe('sc');
    expect(graph.nearest({ x: -20, z: 0 }).id).toBe('q');
  });

  it('only nodes far enough from a point', () => {
    const far = graph.farFrom({ x: 2, z: 5 }, 6).map(n => n.id);
    expect(far).toContain('q');
    expect(far).not.toContain('o');
  });

  it('how far a point is from the nearest door node', () => {
    expect(graph.doorDistance({ x: 8, z: 4.5 })).toBeCloseTo(1);
    expect(graph.doorDistance({ x: -13, z: 2 })).toBeGreaterThan(5);
  });
});
