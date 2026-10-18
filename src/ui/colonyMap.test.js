import { describe, it, expect } from 'vitest';
import { colonyMap, COLONY_MAP } from './colonyMap.js';
import { createDefaultNeighbourDishes, skyToCursor } from '../gameobjects/DishRig.js';

const { centre: c, ring, edge, routeReach } = COLONY_MAP;
const dist = (p) => Math.hypot(p.x - c, p.y - c);
/** A route like the buggy's: from its parking spot out through the gate. */
const ROUTE = [{ x: -7.8, z: 10 }, { x: 8.2, z: 22 }, { x: 22, z: 39 }];

describe('colonyMap', () => {
  const neighbours = createDefaultNeighbourDishes();

  it('puts our base in the middle', () => {
    const map = colonyMap({ neighbours, route: ROUTE });
    expect(map.base).toEqual({ x: c, y: c });
  });

  it('puts the six neighbouring arrays on a ring, each at its radar-rim bearing', () => {
    const map = colonyMap({ neighbours, route: ROUTE });
    expect(map.neighbours).toHaveLength(6);
    for (let i = 0; i < 6; i++) {
      const n = map.neighbours[i];
      expect(dist(n)).toBeCloseTo(ring);
      // The radar's own mapping, read with y down the screen.
      const rig = neighbours[i];
      expect(n.x).toBeCloseTo(c + rig.originX * ring);
      expect(n.y).toBeCloseTo(c + rig.originY * ring);
    }
  });

  it('is a top-down map: the window side at the top, +x on the right (the radar flipped top to bottom)', () => {
    const at = (yaw) => colonyMap({ neighbours: [{ ...skyToCursor(yaw, 0) }].map(p => ({ originX: p.x, originY: p.y })), route: [] }).neighbours[0];
    expect(at(0).y).toBeLessThan(c);              // out of the window: the top
    expect(at(0).x).toBeCloseTo(c);
    expect(at(Math.PI / 2).x).toBeGreaterThan(c); // toward +x: the right
    expect(at(Math.PI).y).toBeGreaterThan(c);     // the yard side: the bottom
  });

  it("labels each neighbour with its bearing in whole degrees, 0 out of the window", () => {
    const map = colonyMap({ neighbours, route: ROUTE });
    expect(map.neighbours.map(n => n.bearing)).toEqual([180, 240, 300, 0, 60, 120]);
  });

  it('points the hub along the bearing of the route out, off the edge of the map', () => {
    const map = colonyMap({ neighbours, route: ROUTE });
    const end = ROUTE[ROUTE.length - 1];
    const yaw = Math.atan2(end.x, -end.z);
    expect(map.hub.bearing).toBe(Math.round(((yaw * 180) / Math.PI + 360) % 360));
    expect(dist(map.hub.to)).toBeCloseTo(edge);
    expect(edge).toBeGreaterThan(ring);
    // The same way as the route's end from the base, on the screen.
    expect(Math.atan2(map.hub.to.x - c, map.hub.to.y - c)).toBeCloseTo(Math.atan2(end.x, end.z));
  });

  it("draws the buggy's route in the middle, scaled so its end is where the hub's line starts", () => {
    const map = colonyMap({ neighbours, route: ROUTE });
    expect(map.route).toHaveLength(ROUTE.length);
    const last = map.route[map.route.length - 1];
    expect(dist(last)).toBeCloseTo(routeReach);
    expect(map.hub.from).toEqual(last);
    // One scale for every point: the route's shape is kept.
    const k = routeReach / Math.hypot(ROUTE[2].x, ROUTE[2].z);
    expect(map.route[0].x).toBeCloseTo(c + ROUTE[0].x * k);
    expect(map.route[0].y).toBeCloseTo(c + ROUTE[0].z * k);
  });

  it('with no route there is no hub to point at', () => {
    const map = colonyMap({ neighbours, route: [] });
    expect(map.route).toEqual([]);
    expect(map.hub).toBeNull();
    expect(colonyMap({ neighbours }).hub).toBeNull();
  });
});
