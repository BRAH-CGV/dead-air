import { describe, it, expect } from 'vitest';

import {
  BASE_FOOTPRINT, YARD,
  makeYard, zoneDistance, yardDistance, yardRadiusAlong, makeYardRadiusLookup,
} from './BaseYard.js';
import { TERRAIN } from './MarsTerrain.js';

const MARGIN = 10;
const zones = (opts) => makeYard({ margin: MARGIN, ...opts });
const inside = (x, z, opts) => yardDistance(x, z, zones(opts)) < 0;

describe('zone shapes', () => {
  it('measures a circle from its centre', () => {
    const circle = { x: 0, z: -25, radius: 10 };
    expect(zoneDistance(0, -25, circle)).toBe(-10);
    expect(zoneDistance(0, -15, circle)).toBeCloseTo(0);
    expect(zoneDistance(0, -5, circle)).toBeCloseTo(10);
  });

  it('measures a box to its nearest face, and negative within', () => {
    const box = { x: 0, z: 0, halfX: 20, halfZ: 5, round: 0 };
    expect(zoneDistance(0, 0, box)).toBe(-5);
    expect(zoneDistance(25, 0, box)).toBeCloseTo(5);
    expect(zoneDistance(0, 9, box)).toBeCloseTo(4);
    // Diagonally out from a corner, so both axes contribute.
    expect(zoneDistance(23, 9, box)).toBeCloseTo(5);
  });

  it('rounds a box corner in, so the yard is not a drawn rectangle', () => {
    const square = { x: 0, z: 0, halfX: 10, halfZ: 10, round: 0 };
    const rounded = { x: 0, z: 0, halfX: 10, halfZ: 10, round: 5 };
    // Face centres are untouched; only the corner is pulled in.
    expect(zoneDistance(10, 0, rounded)).toBeCloseTo(zoneDistance(10, 0, square));
    expect(zoneDistance(10, 10, rounded)).toBeGreaterThan(zoneDistance(10, 10, square));
  });
});

describe('the yard', () => {
  it('clears the margin off every wall of the base', () => {
    const { halfX, halfZ } = BASE_FOOTPRINT;
    // Behind the back wall but clear of the dish track, which cuts its own
    // corridor straight out from the window.
    const offDish = -12;
    // Just inside the margin off the back wall and off a wing.
    expect(inside(offDish, -(halfZ + MARGIN - 1))).toBe(true);
    expect(inside(halfX + MARGIN - 1, 0)).toBe(true);
    // Just outside it, where planting is allowed to start.
    expect(inside(offDish, -(halfZ + MARGIN + 1))).toBe(false);
    expect(inside(halfX + MARGIN + 1, 0)).toBe(false);
  });

  it('follows the building rather than a circle', () => {
    // The whole point of the shape: the base is three times wider than it is
    // deep, so the yard must reach further along X than along Z. A circle
    // wide enough for the wings sat twenty metres off the back wall.
    const alongX = yardRadiusAlong(0, zones(), 150);
    const alongZ = yardRadiusAlong(Math.PI / 2, zones(), 150);
    expect(alongX).toBeGreaterThan(alongZ);
    expect(alongX).toBeCloseTo(BASE_FOOTPRINT.halfX + MARGIN, 1);
  });

  it('takes a footprint override, for whoever owns the real room layout', () => {
    const wider = makeYard({ margin: MARGIN, footprint: { halfX: 40, halfZ: 5 } });
    expect(yardDistance(45, 0, wider)).toBeLessThan(0);
    expect(yardDistance(45, 0, zones())).toBeGreaterThan(0);
  });

  it('keeps the parking apron open out the front door', () => {
    // The base's only exterior door is on the front (+Z) wall at x = 2, and
    // the generator stands out at (7, 9). Both have to be on cleared ground,
    // or the way out of the building is planted shut.
    expect(inside(2, 6)).toBe(true);
    expect(inside(7, 9)).toBe(true);
    expect(inside(6, 20)).toBe(true);
  });

  it('holds the window-to-dish sightline open', () => {
    // This is the regression guard for the four hand-walked keep-clear circles
    // OfficeScene used to carry: the dish is what the window looks at.
    for (let z = -6; z >= -25; z -= 2) expect(inside(0, z)).toBe(true);
    expect(inside(0, -25)).toBe(true);
  });

  it('takes extra zones, so a scene can clear ground it owns', () => {
    const extra = [{ x: 60, z: 60, radius: 8 }];
    expect(inside(60, 60)).toBe(false);
    expect(inside(60, 60, { extra })).toBe(true);
  });

  it('stays on the terrain flat pad, so the yard is level ground', () => {
    // Anything outside FLAT_RADIUS is on the slope up to the crest, where a
    // parking apron would visibly tilt.
    for (let i = 0; i < 360; i += 5) {
      const r = yardRadiusAlong((i * Math.PI) / 180, zones(), 150);
      expect(r).toBeLessThan(TERRAIN.FLAT_RADIUS);
    }
  });
});

describe('the yard edge along a bearing', () => {
  it('lands on the boundary', () => {
    const z = zones();
    for (let i = 0; i < 360; i += 7) {
      const bearing = (i * Math.PI) / 180;
      const r = yardRadiusAlong(bearing, z, 150);
      // Just inside is in the yard, just outside is not.
      expect(yardDistance(Math.cos(bearing) * (r - 0.2), Math.sin(bearing) * (r - 0.2), z)).toBeLessThan(0);
      expect(yardDistance(Math.cos(bearing) * (r + 0.2), Math.sin(bearing) * (r + 0.2), z)).toBeGreaterThan(0);
    }
  });

  it('finds the far side of the parking apron, not the shell it overlaps', () => {
    // The apron sticks out past the shell, so a bearing through it leaves the
    // yard, re-enters and leaves again. A plain bisection would stop at the
    // first crossing and plant a belt straight through the parking.
    const bearing = Math.atan2(YARD.parking.z, YARD.parking.x);
    const r = yardRadiusAlong(bearing, zones(), 150);
    expect(r).toBeGreaterThan(Math.hypot(YARD.parking.x, YARD.parking.z));
  });

  it('is looked up from a table without moving the edge much', () => {
    const z = zones();
    const lookup = makeYardRadiusLookup(z, 150);
    for (let i = 0; i < 360; i += 3) {
      const bearing = (i * Math.PI) / 180;
      expect(lookup(bearing)).toBeCloseTo(yardRadiusAlong(bearing, z, 150), 0);
    }
  });
});
