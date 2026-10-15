import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  BUGGY_DEPARTURE, laneCentre, laneCrossing, exitGate, buggyRoute, routeCurve,
  distanceAlong, eagleView, BuggyDeparture,
} from './BuggyDeparture.js';

// ─────────────────────────────────────────────
// The buggy leaving in the morning (#98): out of the closed yard by its
// sliding gate and away down a lane through the belt, seen from above.
// ─────────────────────────────────────────────

/** A lane like the belt's: bearing out from the base, wandering a little. */
const LANE = { bearing: THREE.MathUtils.degToRad(60.5), halfWidth: 4.4, wander: 1.3 };
/** The yard as BaseScene fences it. */
const RECT = { minX: -16.45, maxX: 16.45, minZ: 4.1, maxZ: 17 };
/** Where the buggy parks, and the way it faces. */
const START = { x: -7.79, z: 10.01 };
const FORWARD = { x: 0.995 / Math.hypot(0.995, 0.099), z: -0.099 / Math.hypot(0.995, 0.099) };

describe('the lanes', () => {
  it("a lane's centre wanders off its bearing by no more than 0.09 rad", () => {
    for (const r of [10, 20, 40, 80]) {
      const { x, z } = laneCentre(LANE, r);
      expect(Math.hypot(x, z)).toBeCloseTo(r, 6);
      expect(Math.abs(Math.atan2(z, x) - LANE.bearing)).toBeLessThanOrEqual(0.09 + 1e-9);
    }
  });

  it('finds where the centre line crosses a line of constant z', () => {
    const x = laneCrossing(LANE, RECT.maxZ);
    const r = Math.hypot(x, RECT.maxZ);
    expect(laneCentre(LANE, r).x).toBeCloseTo(x, 3);
    expect(laneCentre(LANE, r).z).toBeCloseTo(RECT.maxZ, 3);
  });

  it('a lane heading away from +z never crosses it', () => {
    expect(laneCrossing({ ...LANE, bearing: -Math.PI / 2 }, RECT.maxZ)).toBeNull();
    expect(laneCrossing({ ...LANE, bearing: 0.05 }, RECT.maxZ)).toBeNull();
  });
});

describe('exitGate — where the buggy leaves the yard', () => {
  it('is cut in the back run where a lane crosses it, the gate on its centre line', () => {
    const gate = exitGate([LANE], RECT);
    expect(gate.side).toBe('N');
    expect(gate.at).toBeCloseTo(laneCrossing(LANE, RECT.maxZ), 6);
    expect(gate.halfWidth).toBe(BUGGY_DEPARTURE.gateHalfWidth);
  });

  it('skips a lane that crosses beyond the yard or too near a corner, and lanes that never come round', () => {
    const offEnd = { ...LANE, bearing: THREE.MathUtils.degToRad(30) };   // crosses z = 17 at x ≈ 29
    const away   = { ...LANE, bearing: -Math.PI / 2 };
    expect(exitGate([offEnd, away], RECT)).toBeNull();
    expect(exitGate([offEnd, LANE, away], RECT).at).toBeCloseTo(laneCrossing(LANE, RECT.maxZ), 6);
  });

  it('of two, takes the crossing nearer `near`', () => {
    const left = { ...LANE, bearing: Math.PI - LANE.bearing };
    expect(exitGate([LANE, left], RECT, { near: START.x }).at).toBeLessThan(0);
    expect(exitGate([LANE, left], RECT, { near: 12 }).at).toBeGreaterThan(0);
  });
});

describe('buggyRoute — from the parking spot, through the gate and down the lane', () => {
  const gate = exitGate([LANE], RECT);
  const points = buggyRoute({ start: START, forward: FORWARD, gate, lane: LANE, rect: RECT });
  const curve = routeCurve(points);
  const samples = curve.getSpacedPoints(400);

  it('starts where the buggy stands, heading along its nose', () => {
    expect(points[0]).toEqual(START);
    const t = curve.getTangentAt(0);
    const off = Math.atan2(t.x, t.z) - Math.atan2(FORWARD.x, FORWARD.z);
    expect(Math.abs(off)).toBeLessThan(THREE.MathUtils.degToRad(2));
  });

  // The buggy faces along the route, so a kink or a wobble in it is the
  // buggy spinning on the spot as it drives.
  it('turns smoothly: never tighter than a 4 m radius, and never back and forth', () => {
    const length = curve.getLength();
    const ds = 0.25;
    const t = new THREE.Vector3();
    const yawAt = d => { curve.getTangentAt(Math.min(d / length, 1), t); return Math.atan2(t.x, t.z); };
    let prev = yawAt(0);
    let turned = 0;
    for (let d = ds; d <= length; d += ds) {
      const yaw = yawAt(d);
      const dyaw = Math.abs(yaw - prev);
      expect(dyaw / ds, `at ${d.toFixed(2)} m`).toBeLessThan(1 / 4);
      turned += dyaw;
      prev = yaw;
    }
    // About as much turning as the way needs: round to the gate, then onto
    // the lane, and the lane's own gentle wander.
    const need = Math.abs(yawAt(0)) + Math.abs(yawAt(length));
    expect(turned).toBeLessThan(need + THREE.MathUtils.degToRad(20));
  });

  it('crosses the fence once, through the middle of the gate and square to it', () => {
    const crossings = [];
    for (let i = 1; i < samples.length; i++) {
      const [a, b] = [samples[i - 1], samples[i]];
      if ((a.z - RECT.maxZ) * (b.z - RECT.maxZ) <= 0 && a.z !== b.z) crossings.push([a, b]);
    }
    expect(crossings).toHaveLength(1);
    const [a, b] = crossings[0];
    const x = a.x + (b.x - a.x) * (RECT.maxZ - a.z) / (b.z - a.z);
    expect(Math.abs(x - gate.at)).toBeLessThan(0.3);
    const heading = Math.atan2(b.x - a.x, b.z - a.z);
    expect(Math.abs(heading)).toBeLessThan(THREE.MathUtils.degToRad(10));
  });

  it('ends out on the lane, `out` metres from the base', () => {
    const end = points.at(-1);
    expect(Math.hypot(end.x, end.z)).toBeCloseTo(BUGGY_DEPARTURE.out, 0);
    const centre = laneCentre(LANE, Math.hypot(end.x, end.z));
    expect(Math.hypot(end.x - centre.x, end.z - centre.z)).toBeLessThan(0.01);
  });

  it('beyond the gate keeps to the lane: never further off its centre than a metre and a half', () => {
    for (const p of samples) {
      if (p.z < RECT.maxZ + 1) continue;
      const centre = laneCentre(LANE, Math.hypot(p.x, p.z));
      expect(Math.hypot(p.x - centre.x, p.z - centre.z)).toBeLessThan(1.5);
    }
  });

  it('routeCurve lays it at the height asked for, point by point', () => {
    const lifted = routeCurve(points, (x, z) => 1.2 + x * 0.01);
    expect(lifted.points[0].y).toBeCloseTo(1.2 + START.x * 0.01, 6);
    expect(lifted.points[0].z).toBe(START.z);
  });

  it('distanceAlong finds how far along the route a point is', () => {
    const length = curve.getLength();
    expect(distanceAlong(curve, new THREE.Vector3(START.x, 0, START.z))).toBeCloseTo(0, 1);
    const end = points.at(-1);
    expect(distanceAlong(curve, new THREE.Vector3(end.x, 0, end.z))).toBeCloseTo(length, 0);
    const gateAt = distanceAlong(curve, new THREE.Vector3(gate.at, 0, RECT.maxZ));
    expect(gateAt).toBeGreaterThan(0);
    expect(gateAt).toBeLessThan(length);
  });
});

describe('eagleView — the camera over the buggy', () => {
  it('hangs behind and above it, looking at a point just ahead of it', () => {
    const view = eagleView(new THREE.Vector3(2, 1, 3), new THREE.Vector3(1, 0, 0));
    const { behind, up, ahead } = BUGGY_DEPARTURE.camera;
    expect(view.position.x).toBeCloseTo(2 - behind, 6);
    expect(view.position.y).toBeCloseTo(1 + up, 6);
    expect(view.position.z).toBeCloseTo(3, 6);
    expect(view.target.x).toBeCloseTo(2 + ahead, 6);
    expect(view.target.y).toBeCloseTo(1, 6);
  });

  it('writes into the object it is handed, so a frame allocates nothing', () => {
    const out = { position: new THREE.Vector3(), target: new THREE.Vector3() };
    expect(eagleView(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), out)).toBe(out);
  });
});

describe('BuggyDeparture — the send-off, step by step', () => {
  const T = BUGGY_DEPARTURE;
  const make = () => new BuggyDeparture({ length: 50, gateAt: 20 });
  const run = (d, seconds, step = 1 / 60) => { for (let t = 0; t < seconds; t += step) d.update(step); };

  it('waits, with the lid open, until started', () => {
    const d = make();
    expect(d.phase).toBe('idle');
    expect(d.active).toBe(false);
    expect(d.lid).toBe(1);
    d.update(1);
    expect(d.distance).toBe(0);
  });

  it('shuts the lid first, the buggy still standing', () => {
    const d = make();
    d.start();
    expect(d.phase).toBe('closing');
    expect(d.active).toBe(true);
    run(d, T.lidClose / 2);
    expect(d.lid).toBeGreaterThan(0);
    expect(d.lid).toBeLessThan(1);
    expect(d.distance).toBe(0);
    run(d, T.lidClose / 2 + 0.05);
    expect(d.lid).toBe(0);
    expect(d.phase).toBe('driving');
  });

  it('the camera rises from the eye to the eagle view over `rise`, from the start', () => {
    const d = make();
    d.start();
    expect(d.view).toBe(0);
    run(d, T.rise / 2);
    expect(d.view).toBeGreaterThan(0.2);
    expect(d.view).toBeLessThan(0.8);
    run(d, T.rise / 2 + 0.05);
    expect(d.view).toBe(1);
  });

  it('pulls away gently, up to its top speed, and stops at the end of the route', () => {
    const d = make();
    d.start();
    run(d, T.lidClose + 0.1);
    expect(d.speed).toBeGreaterThan(0);
    expect(d.speed).toBeLessThan(T.speed);
    expect(d.driving).toBe(true);
    run(d, 30);
    expect(d.distance).toBe(50);
    expect(d.speed).toBe(0);
    expect(d.driving).toBe(false);
  });

  it('opens the gate as it comes up to it and shuts it again behind', () => {
    const d = make();
    const gateAt = (distance) => { d.distance = distance; return d.gateOpen; };
    d.start();
    expect(gateAt(20 - T.gateOpenFrom - 1)).toBe(0);
    const half = gateAt(20 - (T.gateOpenFrom + T.gateOpenBy) / 2);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
    expect(gateAt(20 - T.gateOpenBy)).toBe(1);
    expect(gateAt(20 + T.gateCloseAfter)).toBe(1);
    expect(gateAt(20 + T.gateCloseAfter + T.gateCloseOver)).toBe(0);
  });

  it('asks for the fade `fadeLead` short of the end, not before', () => {
    const d = make();
    d.start();
    d.phase = 'driving';
    d.distance = 50 - T.fadeLead - 0.5;
    expect(d.wantsFade).toBe(false);
    d.distance = 50 - T.fadeLead;
    expect(d.wantsFade).toBe(true);
  });

  it('a skip after the grace asks for the fade at once; before it, it is refused', () => {
    const d = make();
    d.start();
    run(d, T.skipGrace / 2);
    expect(d.skip()).toBe(false);
    expect(d.wantsFade).toBe(false);
    run(d, T.skipGrace / 2 + 0.05);
    expect(d.skip()).toBe(true);
    expect(d.wantsFade).toBe(true);
  });

  it('finish() leaves it gone: nothing moves and nothing more is asked', () => {
    const d = make();
    d.start();
    run(d, 2);
    d.finish();
    expect(d.phase).toBe('gone');
    expect(d.active).toBe(false);
    expect(d.wantsFade).toBe(false);
    expect(d.lid).toBe(0);
    const at = d.distance;
    d.update(1);
    expect(d.distance).toBe(at);
    expect(d.skip()).toBe(false);
  });

  it('reset() brings it back to waiting, for the next morning', () => {
    const d = make();
    d.start();
    run(d, 3);
    d.finish();
    d.reset();
    expect(d.phase).toBe('idle');
    expect(d.distance).toBe(0);
    expect(d.view).toBe(0);
    expect(d.lid).toBe(1);
  });
});
