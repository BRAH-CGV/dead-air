import { describe, it, expect } from 'vitest';
import {
  DishRig,
  createLocalRig,
  createDefaultNeighbourDishes,
  cursorToSky,
  skyToCursor,
  ARRAY_RING,
  DISH_SLEW_RATE,
  NEIGHBOUR_SLEW_RATE,
  angleDelta,
  SETTLED_EPSILON,
} from './DishRig.js';

describe('DishRig', () => {
  // ── Physics parity with Satellite (ported headless) ──────

  it('holds its starting aim until a target is set', () => {
    const rig = new DishRig({ currentYaw: 0.5, currentPitch: -0.25 });

    expect(rig.targetYaw).toBeCloseTo(0.5);
    expect(rig.targetPitch).toBeCloseTo(-0.25);

    rig.update(1);   // a whole second of headroom — nothing may move
    expect(rig.currentYaw).toBeCloseTo(0.5);
    expect(rig.currentPitch).toBeCloseTo(-0.25);
  });

  it('accelerates from rest instead of moving at constant rate', () => {
    const rig = new DishRig();
    rig.maxRotationSpeed = 2;
    rig.angularAccel = 4;
    rig.targetYaw = Math.PI;

    rig.update(0.1);
    expect(rig.currentYaw).toBeGreaterThan(0);
    expect(rig.velYaw).toBeGreaterThan(0);
    expect(rig.velYaw).toBeLessThan(rig.maxRotationSpeed);

    rig.update(0.5);
    expect(rig.velYaw).toBeGreaterThan(0);
  });

  it('clamps velocity to maxRotationSpeed', () => {
    const rig = new DishRig();
    rig.maxRotationSpeed = 1;
    rig.angularAccel = 100;
    rig.targetYaw = Math.PI;

    rig.update(1);
    expect(rig.velYaw).toBeLessThanOrEqual(1 + 0.001);
    expect(rig.velYaw).toBeGreaterThanOrEqual(-1 - 0.001);
  });

  it('settles near target with damping', () => {
    const rig = new DishRig();
    rig.maxRotationSpeed = 2;
    rig.angularAccel = 3;
    rig.angularDamping = 6;
    rig.targetYaw = 1.0;

    for (let i = 0; i < 120; i++) rig.update(1 / 30);  // 4 seconds

    expect(Math.abs(rig.currentYaw - 1.0)).toBeLessThan(0.15);
  });

  it('moves both axes with momentum', () => {
    const rig = new DishRig();
    rig.maxRotationSpeed = 2;
    rig.angularAccel = 4;
    rig.angularDamping = 3;
    rig.targetYaw   = Math.PI / 2;
    rig.targetPitch = Math.PI / 2;

    rig.update(0.5);
    expect(rig.currentYaw).toBeGreaterThan(0);
    expect(rig.currentPitch).toBeGreaterThan(0);
    expect(rig.velYaw).toBeGreaterThan(0);
    expect(rig.velPitch).toBeGreaterThan(0);
  });

  it('takes the short way around the circle', () => {
    const rig = new DishRig({ currentYaw: 3 });
    rig.targetYaw = -3;                      // just past −π the other way

    rig.update(0.01);                        // a small step must head toward π
    expect(rig.currentYaw).toBeGreaterThan(3);
    expect(rig.currentYaw).toBeLessThanOrEqual(3 + (Math.PI / 8) * 0.01);
  });

  it('isRotating reports false when settled and true once a target is set', () => {
    const rig = new DishRig();
    expect(rig.isRotating()).toBe(false);    // targets start on the current pose

    rig.targetYaw = 1;
    expect(rig.isRotating()).toBe(true);
  });

  it('isRotating is true while either axis is off target', () => {
    const rig = new DishRig({ currentPitch: 0.2 });
    rig.targetPitch = -0.2;                  // yaw settled, pitch not

    expect(rig.isRotating()).toBe(true);
  });

  it('isRotating treats a target one full turn away as settled', () => {
    const rig = new DishRig({ currentYaw: 1 });
    rig.targetYaw = 1 + Math.PI * 2;         // same heading, wrapped

    expect(rig.isRotating()).toBe(false);
  });

  it('comes to rest without swinging past the target', () => {
    const rig = new DishRig();
    const target = Math.PI / 2;
    rig.targetYaw = target;
    let furthest = 0;
    for (let i = 0; i < 600; i++) {
      rig.update(1 / 60);
      furthest = Math.max(furthest, rig.currentYaw);
    }
    expect(furthest - target).toBeLessThan(Math.PI / 180);   // < 1° overshoot
  });

  // ── Aim queries ──────────────────────────────────────────

  it('aimAt sets both target angles', () => {
    const rig = new DishRig();
    rig.aimAt(1.2, -0.4);
    expect(rig.targetYaw).toBeCloseTo(1.2);
    expect(rig.targetPitch).toBeCloseTo(-0.4);
  });

  it('getAimError returns combined angular distance', () => {
    const rig = new DishRig();
    // yaw error = 0.3, pitch error = 0.4, combined = 0.5 (Pythagorean)
    expect(rig.getAimError(0.3, 0.4)).toBeCloseTo(0.5);
  });

  it('isAimedAt returns true within tolerance and false outside', () => {
    const rig = new DishRig();
    expect(rig.isAimedAt(0.01, 0.01, 0.1)).toBe(true);
    expect(rig.isAimedAt(1.0, 1.0, 0.1)).toBe(false);
  });

  // ── Coverage — measured on the radar disc (cursor space) ─

  it('covers() is true inside the radius, false outside, inclusive on the boundary', () => {
    const rig = new DishRig({ originX: 0.5, originY: 0, coverageRadius: 0.55 });
    const inside = cursorToSky(0.45, 0.1);               // 0.15 away
    const boundary = cursorToSky(1.05, 0);               // exactly 0.55 away
    const outside = cursorToSky(-0.1, 0);                // 0.6 away

    expect(rig.covers(inside.yaw, inside.pitch)).toBe(true);
    expect(rig.covers(boundary.yaw, boundary.pitch)).toBe(true);
    expect(rig.covers(outside.yaw, outside.pitch)).toBe(false);
  });

  it('covers() measures from the origin, not the current aim', () => {
    const rig = new DishRig({ originX: 0.5, originY: 0, coverageRadius: 0.55 });
    rig.currentYaw = 1.4;                                 // pointed well away
    rig.currentPitch = -0.2;

    const centre = cursorToSky(0.5, 0);
    expect(rig.covers(centre.yaw, centre.pitch)).toBe(true);
  });

  it('covers() spans the yaw seam at the back of the disc', () => {
    // Origins either side of the ±π bearing are close together on the disc.
    const rig = new DishRig({ originX: 0.05, originY: -0.4975, coverageRadius: 0.2 });
    const west = cursorToSky(-0.05, -0.4975);

    expect(rig.covers(west.yaw, west.pitch)).toBe(true);  // 0.1 away, across the seam
  });

  it('an infinite coverageRadius covers the whole hemisphere (a bare rig)', () => {
    const rig = new DishRig({ coverageRadius: Infinity });

    expect(rig.covers(-Math.PI, 0)).toBe(true);
    expect(rig.covers(Math.PI, -Math.PI / 2)).toBe(true);
    expect(rig.covers(2.4, -1.1)).toBe(true);
  });

  // ── Default tuning ───────────────────────────────────────

  it('defaults to the same tuning as the local dish', () => {
    const rig = new DishRig();
    expect(DISH_SLEW_RATE).toBeCloseTo(Math.PI / 8);
    expect(rig.maxRotationSpeed).toBe(DISH_SLEW_RATE);
    expect(rig.angularAccel).toBeCloseTo(25.0);
    expect(rig.angularDamping).toBeCloseTo(10.0);
  });

  // ── The array layout ─────────────────────────────────────

  it('the local dish covers the majority of the scannable band', () => {
    // Band = cursor radius 0.11…0.91 (pitch -80°..-8°). The local reach is
    // the big central disc: most of the band must be OURS, leaving only the
    // outer band to the neighbours.
    const local = createLocalRig();
    expect(Number.isFinite(local.coverageRadius)).toBe(true);

    let inBand = 0;
    let ours = 0;
    for (let pitchDeg = -80; pitchDeg <= -8; pitchDeg += 2) {
      for (let yawDeg = -180; yawDeg < 180; yawDeg += 5) {
        inBand++;
        const yaw = yawDeg * Math.PI / 180;
        const pitch = pitchDeg * Math.PI / 180;
        if (local.covers(yaw, pitch)) ours++;
      }
    }
    expect(ours / inBand).toBeGreaterThan(0.6);
  });

  it('the local reach stops short of the neighbour origins', () => {
    // The origins sit out on the rim now, well past our reach — only their
    // sections dip back inside it.
    const local = createLocalRig();

    for (const rig of createDefaultNeighbourDishes()) {
      const origin = cursorToSky(rig.originX, rig.originY);
      expect(local.covers(origin.yaw, origin.pitch)).toBe(false);
    }
    const centre = cursorToSky(0, 0);                              // our origin: the zenith
    expect(local.covers(centre.yaw, centre.pitch)).toBe(true);
  });

  it('creates six neighbours on one ring, evenly spaced, each aimed at its own origin', () => {
    const neighbours = createDefaultNeighbourDishes();
    expect(neighbours).toHaveLength(6);

    const angles = [];
    for (const rig of neighbours) {
      expect(rig).toBeInstanceOf(DishRig);
      expect(Math.hypot(rig.originX, rig.originY)).toBeCloseTo(ARRAY_RING, 5);
      const origin = cursorToSky(rig.originX, rig.originY);
      angles.push(origin.yaw);
      expect(rig.currentYaw).toBeCloseTo(origin.yaw);
      expect(rig.currentPitch).toBeCloseTo(origin.pitch);
      expect(rig.targetYaw).toBeCloseTo(origin.yaw);
      expect(rig.targetPitch).toBeCloseTo(origin.pitch);
      expect(rig.isRotating()).toBe(false);
      expect(Number.isFinite(rig.coverageRadius)).toBe(true);
    }

    // Even yaw spacing, including across the seam.
    const sorted = [...angles].sort((a, b) => a - b);
    const spacing = (2 * Math.PI) / sorted.length;
    for (let i = 0; i < sorted.length; i++) {
      const next = sorted[(i + 1) % sorted.length];
      expect(angleDelta(sorted[i], next)).toBeCloseTo(spacing, 5);
    }
  });

  it('each neighbour section overlaps the local reach', () => {
    // The sections keep their size but sit out on the rim, so their inner
    // edge must dip back well inside the local reach — the middle of the
    // disc is covered by both.
    const local = createLocalRig();

    for (const rig of createDefaultNeighbourDishes()) {
      const len = Math.hypot(rig.originX, rig.originY);
      const innerX = (rig.originX / len) * (len - rig.coverageRadius);
      const innerY = (rig.originY / len) * (len - rig.coverageRadius);
      const inner = cursorToSky(innerX, innerY);

      expect(rig.covers(inner.yaw, inner.pitch)).toBe(true);
      expect(local.covers(inner.yaw, inner.pitch)).toBe(true);
    }
  });

  it('at least half of each neighbour section is cut off by the radar rim', () => {
    // Grid-sample the section disc; what falls outside the unit sky disc is
    // cut off by the radar's edge.
    for (const rig of createDefaultNeighbourDishes()) {
      let inside = 0;
      let cut = 0;
      const step = 0.01;
      for (let x = rig.originX - rig.coverageRadius; x <= rig.originX + rig.coverageRadius; x += step) {
        for (let y = rig.originY - rig.coverageRadius; y <= rig.originY + rig.coverageRadius; y += step) {
          if (Math.hypot(x - rig.originX, y - rig.originY) > rig.coverageRadius) continue;
          inside++;
          if (Math.hypot(x, y) > 1) cut++;
        }
      }
      expect(cut / inside).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('the outer band beyond the local reach belongs to the neighbours', () => {
    const local = createLocalRig();
    const neighbours = createDefaultNeighbourDishes();

    for (let radius = 0.8; radius <= 0.91; radius += 0.02) {
      for (let yawDeg = -180; yawDeg < 180; yawDeg += 5) {
        const yaw = yawDeg * Math.PI / 180;
        const p = cursorToSky(radius * Math.sin(yaw), radius * Math.cos(yaw));
        expect(local.covers(p.yaw, p.pitch)).toBe(false);          // 0.8 > local reach: not ours
        expect(
          neighbours.some(rig => rig.covers(p.yaw, p.pitch)),
          `gap at radius ${radius}, yaw ${yawDeg}°`,
        ).toBe(true);
      }
    }
  });

  it('adjacent neighbour sections overlap so no bearing on the ring is left unwatched', () => {
    const neighbours = createDefaultNeighbourDishes();
    const first = neighbours[0];
    const second = neighbours[1];
    const mid = cursorToSky(
      (first.originX + second.originX) / 2,
      (first.originY + second.originY) / 2,
    );

    let covering = 0;
    for (const rig of neighbours) {
      if (rig.covers(mid.yaw, mid.pitch)) covering++;
    }
    expect(covering).toBeGreaterThanOrEqual(2);
  });

  it('neighbours slew slower than the local dish', () => {
    const local = createLocalRig();
    expect(local.maxRotationSpeed).toBeCloseTo(DISH_SLEW_RATE);

    for (const rig of createDefaultNeighbourDishes()) {
      expect(rig.maxRotationSpeed).toBeCloseTo(NEIGHBOUR_SLEW_RATE);
      expect(rig.maxRotationSpeed).toBeLessThan(DISH_SLEW_RATE);
    }
  });

  it('the whole signal band lies inside the combined reach of the array', () => {
    // Signals spawn from -80° up to -8° (cursor radius 0.11…0.91). Every
    // point of that band must belong to the local dish or a neighbour.
    const local = createLocalRig();
    const neighbours = createDefaultNeighbourDishes();

    for (let pitchDeg = -80; pitchDeg <= -8; pitchDeg += 2) {
      for (let yawDeg = -180; yawDeg < 180; yawDeg += 5) {
        const yaw = yawDeg * Math.PI / 180;
        const pitch = pitchDeg * Math.PI / 180;
        const covered = local.covers(yaw, pitch)
          || neighbours.some(r => r.covers(yaw, pitch));
        expect(covered, `gap at yaw ${yawDeg}°, pitch ${pitchDeg}°`).toBe(true);
      }
    }
  });
});

describe('sky/cursor conversions', () => {
  it('cursorToSky and skyToCursor are inverses', () => {
    const cursorPoints = [[0, 0], [0.5, 0.5], [-0.9, 0.1], [0.3, -0.8], [1, 0]];
    for (const [x, y] of cursorPoints) {
      const sky = cursorToSky(x, y);
      const back = skyToCursor(sky.yaw, sky.pitch);
      expect(back.x).toBeCloseTo(x);
      expect(back.y).toBeCloseTo(y);
    }

    const skyPoints = [[0, -1.2], [2.5, -0.3], [-3.0, -0.05], [Math.PI - 0.1, -0.785]];
    for (const [yaw, pitch] of skyPoints) {
      const c = skyToCursor(yaw, pitch);
      const back = cursorToSky(c.x, c.y);
      expect(back.yaw).toBeCloseTo(yaw);
      expect(back.pitch).toBeCloseTo(pitch);
    }
  });

  it('the zenith sits at the cursor centre, the horizon on the rim', () => {
    const zenith = skyToCursor(0, -Math.PI / 2);
    expect(zenith.x).toBeCloseTo(0);
    expect(zenith.y).toBeCloseTo(0);

    const rim = skyToCursor(1.2, 0);
    expect(Math.hypot(rim.x, rim.y)).toBeCloseTo(1);
  });
});

describe('angleDelta', () => {
  it('returns the shortest signed difference, wrapped into ±π', () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(angleDelta(0, -Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    expect(angleDelta(3, -3)).toBeCloseTo(angleDelta(3, 3 + 2 * (Math.PI - 3)));  // -3 ≡ 3.28 wrapped
    expect(angleDelta(1, 1 + 2 * Math.PI)).toBeCloseTo(0);                        // a full turn away = no delta
    expect(SETTLED_EPSILON).toBeCloseTo(0.05);
  });
});
