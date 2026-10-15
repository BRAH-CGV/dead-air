import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RagnoGait, RAGNO_GAIT, LEG_PAIRS, stanceHome } from './RagnoGait.js';

// Four feet like the rig's, at the manifest's 0.8: front pair wide, back
// pair narrower and behind.
const HOMES = [[0.73, 0, 0.06], [0.26, 0, -0.69], [-0.73, 0, 0.06], [-0.26, 0, -0.69]];

/** A flat floor at y = 0: casts straight down from above it. */
const floor = (origin, dir, out) => {
  if (dir.y >= 0) return false;
  const t = origin.y / -dir.y;
  out.copy(origin).addScaledVector(dir, t);
  return true;
};

const UP = new THREE.Vector3(0, 1, 0);

function body(x = 0, z = 0, yaw = 0) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(1, 1, 1),
  );
}

function makeGait() {
  const gait = new RagnoGait({ homes: HOMES });
  gait.reset(body(), UP, floor);
  return gait;
}

/** Walk the body along +z at `speed` for `seconds`, in frames of `dt`. */
function walk(gait, { speed = 1, seconds = 2, dt = 1 / 60, from = 0, onFrame } = {}) {
  const v = new THREE.Vector3(0, 0, speed);
  let z = from;
  for (let t = 0; t < seconds; t += dt) {
    z += speed * dt;
    gait.update(dt, { matrix: body(0, z), velocity: v, up: UP, cast: floor });
    onFrame?.(gait, z);
  }
  return z;
}

describe('RagnoGait', () => {
  it('starts with every foot planted on its home spot, on the floor', () => {
    const gait = makeGait();
    gait.feet.forEach((foot, i) => {
      expect(foot.x).toBeCloseTo(HOMES[i][0]);
      expect(foot.y).toBeCloseTo(0);
      expect(foot.z).toBeCloseTo(HOMES[i][2]);
    });
    expect(gait.lifted).toBe(0);
  });

  it('a planted foot stays put while the body moves less than the step trigger', () => {
    const gait = makeGait();
    const before = gait.feet.map(f => f.clone());
    const v = new THREE.Vector3(0, 0, 0.5);
    const shift = RAGNO_GAIT.stepTrigger * 0.4;
    gait.update(1 / 60, { matrix: body(0, shift), velocity: v.set(0, 0, 0), up: UP, cast: floor });
    gait.feet.forEach((f, i) => expect(f.distanceTo(before[i])).toBeLessThan(1e-9));
  });

  it('steps in diagonal pairs, never more than two feet up at once', () => {
    const gait = makeGait();
    walk(gait, {
      speed: 1.2, seconds: 4,
      onFrame: (g) => {
        expect(g.lifted).toBeLessThanOrEqual(2);
        const up = g.legs.map(l => l.stepping);
        // Never a foot of each pair up together.
        const [a, b] = LEG_PAIRS;
        expect(a.some(i => up[i]) && b.some(i => up[i])).toBe(false);
      },
    });
  });

  it('keeps up with the body: every foot stays near its home on a long walk', () => {
    const gait = makeGait();
    const z = walk(gait, { speed: 1, seconds: 6 });
    gait.feet.forEach((f, i) => {
      expect(Math.abs(f.z - (z + HOMES[i][2]))).toBeLessThan(0.8);
    });
  });

  it('a finished step lands on the surface', () => {
    const gait = makeGait();
    walk(gait, { speed: 1, seconds: 3 });
    // Let it settle.
    for (let i = 0; i < 60; i++) gait.update(1 / 60, { matrix: body(0, 3), velocity: new THREE.Vector3(), up: UP, cast: floor });
    gait.feet.forEach(f => expect(f.y).toBeCloseTo(0, 5));
  });

  it('lifts a stepping foot off the surface, at most the step height', () => {
    const gait = makeGait();
    let highest = 0;
    walk(gait, { speed: 1, seconds: 3, onFrame: g => g.feet.forEach(f => { highest = Math.max(highest, f.y); }) });
    expect(highest).toBeGreaterThan(RAGNO_GAIT.stepHeight * 0.5);
    expect(highest).toBeLessThanOrEqual(RAGNO_GAIT.stepHeight + 1e-6);
  });

  it('reports each foot coming down once per step', () => {
    const gait = makeGait();
    let downs = 0, landings = 0;
    const was = gait.legs.map(() => false);
    walk(gait, {
      speed: 1, seconds: 3,
      onFrame: (g) => {
        downs += g.footDowns;
        g.legs.forEach((l, i) => { if (was[i] && !l.stepping) landings++; was[i] = l.stepping; });
      },
    });
    expect(downs).toBeGreaterThan(0);
    expect(downs).toBe(landings);
  });

  it('steps faster the faster the body goes', () => {
    const slow = makeGait(), fast = makeGait();
    let slowDowns = 0, fastDowns = 0;
    walk(slow, { speed: 0.6, seconds: 3, onFrame: g => { slowDowns += g.footDowns; } });
    walk(fast, { speed: 5, seconds: 3, onFrame: g => { fastDowns += g.footDowns; } });
    expect(fastDowns).toBeGreaterThan(slowDowns * 2);
    expect(fast.stepSeconds(5)).toBeLessThan(slow.stepSeconds(0.6));
  });

  it('a body teleported far away re-plants every foot at once', () => {
    const gait = makeGait();
    gait.update(1 / 60, { matrix: body(10, 10), velocity: new THREE.Vector3(), up: UP, cast: floor });
    gait.feet.forEach((f, i) => expect(f.distanceTo(new THREE.Vector3(10 + HOMES[i][0], 0, 10 + HOMES[i][2]))).toBeLessThan(1e-6));
    expect(gait.lifted).toBe(0);
  });

  it('turning in place moves the feet round with the body', () => {
    const gait = makeGait();
    for (let t = 0; t < 3; t += 1 / 60) {
      gait.update(1 / 60, { matrix: body(0, 0, Math.min(t, 1) * Math.PI / 2), velocity: new THREE.Vector3(), up: UP, cast: floor });
    }
    // Turned a quarter: the front-left foot (+x, +z local) is now at about (+z… ) → world (0.06, 0, -0.73).
    expect(gait.feet[0].x).toBeCloseTo(0.06, 0);
    expect(gait.feet[0].z).toBeCloseTo(-0.73, 0);
  });

  describe('stance', () => {
    it('blends the homes inward across and out along as it goes thin', () => {
      const wide = stanceHome(HOMES[0], 0, new THREE.Vector3());
      const thin = stanceHome(HOMES[0], 1, new THREE.Vector3());
      const half = stanceHome(HOMES[0], 0.5, new THREE.Vector3());
      expect(wide.x).toBeCloseTo(HOMES[0][0]);
      expect(thin.x).toBeCloseTo(HOMES[0][0] * RAGNO_GAIT.thin.across);
      expect(half.x).toBeGreaterThan(thin.x);
      expect(half.x).toBeLessThan(wide.x);
    });

    it('thin, every foot is inside a doorway with room to spare', () => {
      const doorHalf = 1.2 / 2;
      for (const home of HOMES) {
        const p = stanceHome(home, 1, new THREE.Vector3());
        expect(Math.abs(p.x)).toBeLessThan(doorHalf - 0.2);
      }
    });

    it('raises the body as it goes thin', () => {
      const gait = makeGait();
      expect(gait.bodyLift(0)).toBe(0);
      expect(gait.bodyLift(1)).toBeCloseTo(RAGNO_GAIT.thin.lift);
    });
  });
});
