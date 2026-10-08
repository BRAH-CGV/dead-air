import { describe, it, expect, vi } from 'vitest';
import { DriveSparks, SPARKS } from './DriveSparks.js';

/** A mock drive whose rigidBody reports a fixed world position. */
function makeDrive(x = 0, y = 1, z = 0) {
  return {
    rigidBody: {
      translation: () => ({ x, y, z }),
    },
    object3d: {
      getWorldPosition: vi.fn(),
    },
  };
}

describe('DriveSparks', () => {
  it('emits nothing before the delay, even at full doom', () => {
    const sparks = new DriveSparks();
    const drive = makeDrive();
    // Tick just under the delay at doomFraction 1 — no continuous emission.
    for (let i = 0; i < 60; i++) {
      sparks.tick(SPARKS.delaySeconds / 60 - 0.001, drive, 1);
    }
    const alive = sparks._pool.filter(p => p.life > 0).length;
    expect(alive).toBe(0);
    sparks.dispose();
  });

  it('continuous emission starts after the delay', () => {
    const sparks = new DriveSparks();
    const drive = makeDrive();
    // Tick past the delay (3 s), then a further second at doomFraction 1 —
    // rate = 1^3 * 80 = 80/s.
    for (let i = 0; i < 60; i++) {
      sparks.tick(SPARKS.delaySeconds / 60, drive, 1);
    }
    const steps = 60;
    const dt = 1 / steps;
    for (let i = 0; i < steps; i++) {
      sparks.tick(dt, drive, 1);
    }
    const alive = sparks._pool.filter(p => p.life > 0).length;
    // ~80 emitted in the last second; the pool caps at 200 but few have
    // died yet (min lifetime 0.4 s covers only part of the second).
    expect(alive).toBeGreaterThan(20);
    sparks.dispose();
  });

  it('tick emits at an exponential rate dictated by doomFraction after the delay', () => {
    const sparks = new DriveSparks();
    const drive = makeDrive();
    // Skip the delay first.
    for (let i = 0; i < 60; i++) {
      sparks.tick(SPARKS.delaySeconds / 60, drive, 0);
    }
    // doomFraction 0.5 → rate = 0.5^3 * 80 = 10/s.
    const steps = 60;
    const dt = 1 / steps;
    for (let i = 0; i < steps; i++) {
      sparks.tick(dt, drive, 0.5);
    }
    // Count alive particles.
    const pool = sparks._pool;
    const alive = pool.filter(p => p.life > 0).length;
    // ~10 emitted in 1 s, some may have died (min lifetime 0.4 s).
    expect(alive).toBeGreaterThanOrEqual(4);
    expect(alive).toBeLessThanOrEqual(16);
    sparks.dispose();
  });

  it('burst emits the requested number of particles immediately', () => {
    const sparks = new DriveSparks();
    const drive = makeDrive();
    // Prime the drive reference via tick.
    sparks.tick(0, drive, 0);
    sparks.burst(20);
    const alive = sparks._pool.filter(p => p.life > 0).length;
    expect(alive).toBe(20);
    sparks.dispose();
  });

  it('particles die after their lifetime expires', () => {
    const sparks = new DriveSparks();
    const drive = makeDrive();
    sparks.tick(0, drive, 0);
    sparks.burst(10);
    // Tick well past the maximum particle lifetime (1.2 s).
    for (let i = 0; i < 200; i++) {
      sparks.tick(0.01, drive, 0);
    }
    const alive = sparks._pool.filter(p => p.life > 0).length;
    // At doomFraction 0 nothing is emitted continuously, and the burst
    // particles have all died (max lifetime 1.2 s, ticked 2 s).
    expect(alive).toBe(0);
    sparks.dispose();
  });

  it('emits nothing when doomFraction is 0, even after the delay', () => {
    const sparks = new DriveSparks();
    const drive = makeDrive();
    // doomFraction 0 → rate = 0^3 * 80 = 0. Tick well past the delay.
    for (let i = 0; i < 300; i++) {
      sparks.tick(1 / 60, drive, 0);
    }
    const alive = sparks._pool.filter(p => p.life > 0).length;
    expect(alive).toBe(0);
    sparks.dispose();
  });

  it('dispose frees geometry and material', () => {
    const sparks = new DriveSparks();
    const geom = sparks._geometry;
    const mat = sparks._material;
    geom.dispose = vi.fn();
    mat.dispose = vi.fn();
    sparks.dispose();
    expect(geom.dispose).toHaveBeenCalled();
    expect(mat.dispose).toHaveBeenCalled();
  });

  it('particles fall under gravity', () => {
    const sparks = new DriveSparks();
    const drive = makeDrive(0, 5, 0);
    sparks.tick(0, drive, 0);
    sparks.burst(10);
    // Record initial y positions.
    const initialYs = sparks._pool
      .filter(p => p.life > 0)
      .map(p => p.pos.y);
    // Tick several frames.
    for (let i = 0; i < 30; i++) {
      sparks.tick(1 / 60, drive, 0);
    }
    // All particles that are still alive should have fallen.
    const live = sparks._pool.filter(p => p.life > 0);
    for (const p of live) {
      // Gravity pulls down; even with upward initial velocity, after 0.5 s
      // at gravity 6 the net effect is downward.
      // We just check that at least some have moved down from spawn (y=5).
      expect(p.pos.y).toBeLessThan(5 + 2);  // sanity: not teleported up
    }
    // At least one particle should have y below the spawn height.
    const anyBelow = live.some(p => p.pos.y < 5);
    expect(anyBelow).toBe(true);
    sparks.dispose();
  });

  it('tick is a no-op when drive is null', () => {
    const sparks = new DriveSparks();
    // No drive set — tick should not crash.
    sparks.tick(1 / 60, null, 0.5);
    const alive = sparks._pool.filter(p => p.life > 0).length;
    expect(alive).toBe(0);
    sparks.dispose();
  });

  it('burst is a no-op when no drive has been set', () => {
    const sparks = new DriveSparks();
    // burst before any tick — no drive reference.
    sparks.burst(20);
    const alive = sparks._pool.filter(p => p.life > 0).length;
    expect(alive).toBe(0);
    sparks.dispose();
  });

  it('uses rigidBody translation over object3d position', () => {
    const sparks = new DriveSparks();
    const drive = makeDrive(3, 7, -2);
    sparks.tick(0, drive, 0);
    sparks.burst(5);
    // Particles should have been emitted near (3, 7, -2).
    const live = sparks._pool.filter(p => p.life > 0);
    for (const p of live) {
      expect(p.pos.x).toBeCloseTo(3, 0);
      expect(p.pos.y).toBeCloseTo(7, 0);
      expect(p.pos.z).toBeCloseTo(-2, 0);
    }
    // object3d.getWorldPosition should NOT have been called.
    expect(drive.object3d.getWorldPosition).not.toHaveBeenCalled();
    sparks.dispose();
  });

  it('falls back to object3d when rigidBody is absent', () => {
    const sparks = new DriveSparks();
    const drive = {
      rigidBody: null,
      object3d: {
        getWorldPosition: vi.fn((v) => v.set(1, 2, 3)),
      },
    };
    sparks.tick(0, drive, 0);
    sparks.burst(3);
    expect(drive.object3d.getWorldPosition).toHaveBeenCalled();
    const live = sparks._pool.filter(p => p.life > 0);
    for (const p of live) {
      expect(p.pos.x).toBeCloseTo(1, 0);
      expect(p.pos.y).toBeCloseTo(2, 0);
      expect(p.pos.z).toBeCloseTo(3, 0);
    }
    sparks.dispose();
  });
});
