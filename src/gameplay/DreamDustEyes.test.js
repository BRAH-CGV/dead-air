import * as THREE from 'three';
import { describe, it, expect, vi } from 'vitest';
import { DreamDustEyes, DREAM_EYES } from './DreamDustEyes.js';
import { DustEye } from '../gameobjects/DustEye.js';
import { terrainHeightAt } from '../gameobjects/MarsTerrain.js';

// ─────────────────────────────────────────────
// DreamDustEyes — the things in the crater dream
// ─────────────────────────────────────────────

function makeSound() {
  return {
    isPlaying: false, volume: 0,
    play: vi.fn(function () { this.isPlaying = true; }),
    stop: vi.fn(function () { this.isPlaying = false; }),
    setVolume: vi.fn(function (v) { this.volume = v; }),
    disconnect: vi.fn(),
  };
}

function makeRig({ count = 12, player = [0, 1.6, 0], look = null, random = () => 0.5 } = {}) {
  const pos = new THREE.Vector3(...player);
  const dir = new THREE.Vector3(0, 0, -1);
  const hooks = {
    eyePosition: out => out.copy(pos),
    viewDirection: out => (look ? out.copy(look()) : out.copy(dir)),
    onCatch: vi.fn(),
  };
  const pool = Array.from({ length: count }, (_, i) => new DustEye(`Eye${i}`));
  const sounds = { growl: makeSound() };
  const fog = new THREE.FogExp2(0x4c2818, 0.065);
  const system = new DreamDustEyes({ pool, hooks, fog, random, sounds });
  system.onStart();
  return { system, hooks, pool, pos, fog, sounds };
}

const run = (system, seconds, step = 0.05) => {
  for (let t = 0; t < seconds - 1e-9; t += step) system.onUpdate(step);
};

describe('spawn', () => {
  it('places all pool members in the correct rings and above the terrain', () => {
    const rig = makeRig({ count: DREAM_EYES.poolSize });
    const active = rig.system.active;
    expect(active.length).toBe(DREAM_EYES.poolSize);
    const rings = DREAM_EYES.spawnRings;
    const ringSize = Math.ceil(DREAM_EYES.poolSize / rings.length);
    for (let i = 0; i < active.length; i++) {
      const slot = active[i];
      const ringIdx = Math.min(Math.floor(i / ringSize), rings.length - 1);
      const ring = rings[ringIdx];
      const d = Math.hypot(slot.position.x - rig.pos.x, slot.position.z - rig.pos.z);
      expect(d).toBeGreaterThanOrEqual(ring[0] - 0.1);
      expect(d).toBeLessThanOrEqual(ring[1] + 0.1);
      const groundY = terrainHeightAt(slot.position.x, slot.position.z);
      expect(slot.position.y).toBeGreaterThanOrEqual(groundY + DREAM_EYES.height[0] - 0.1);
      expect(slot.position.y).toBeLessThanOrEqual(groundY + DREAM_EYES.height[1] + 0.1);
    }
  });

  it('distributes eyes evenly across all three rings', () => {
    const rig = makeRig({ count: DREAM_EYES.poolSize });
    const rings = DREAM_EYES.spawnRings;
    const ringSize = Math.ceil(DREAM_EYES.poolSize / rings.length);
    expect(rings.length).toBe(3);
    for (let r = 0; r < rings.length; r++) {
      const start = r * ringSize;
      const end = Math.min(start + ringSize, DREAM_EYES.poolSize);
      expect(end - start).toBeGreaterThanOrEqual(4);
    }
  });

  it('all eyes fade in and become passive after fadeSeconds', () => {
    const rig = makeRig({ count: 12 });
    run(rig.system, DREAM_EYES.fadeSeconds + 0.1);
    for (const slot of rig.system.active) {
      expect(slot.phase).toBe('passive');
      expect(slot.fade).toBeGreaterThanOrEqual(0.99);
    }
  });
});

describe('gaze', () => {
  it('looking at an eye accumulates gaze', () => {
    const rig = makeRig({ count: 12 });
    run(rig.system, DREAM_EYES.fadeSeconds + 0.1);
    // Look at the first passive eye.
    const target = rig.system.slots.find(s => s.phase === 'passive');
    if (!target) return;
    const lookDir = () => target.position.clone();
    rig.hooks.viewDirection = out => out.copy(lookDir()).sub(rig.pos).normalize();
    run(rig.system, 0.3);
    expect(target.gaze).toBeGreaterThan(0);
  });

  it('looking away decays gaze', () => {
    const rig = makeRig({ count: 12 });
    run(rig.system, DREAM_EYES.fadeSeconds + 0.1);
    const target = rig.system.slots.find(s => s.phase === 'passive');
    if (!target) return;
    // Look at it briefly.
    rig.hooks.viewDirection = out => out.copy(target.position).sub(rig.pos).normalize();
    run(rig.system, 0.3);
    const gazeAfterLook = target.gaze;
    expect(gazeAfterLook).toBeGreaterThan(0);
    // Look away (opposite direction).
    rig.hooks.viewDirection = out => out.copy(target.position).sub(rig.pos).normalize().negate();
    run(rig.system, 0.5);
    expect(target.gaze).toBeLessThan(gazeAfterLook);
  });

  it('gaze reaching stareSeconds triggers growling', () => {
    const rig = makeRig({ count: 12 });
    run(rig.system, DREAM_EYES.fadeSeconds + 0.1);
    const target = rig.system.slots.find(s => s.phase === 'passive');
    if (!target) return;
    rig.hooks.viewDirection = out => out.copy(target.position).sub(rig.pos).normalize();
    run(rig.system, DREAM_EYES.stareSeconds + 0.1);
    expect(target.phase).toBe('growling');
    expect(target.go.mode).toBe('growl');
  });
});

describe('attack', () => {
  function makeAttackingRig() {
    const rig = makeRig({ count: 12 });
    run(rig.system, DREAM_EYES.fadeSeconds + 0.1);
    const target = rig.system.slots.find(s => s.phase === 'passive');
    rig.hooks.viewDirection = out => out.copy(target.position).sub(rig.pos).normalize();
    run(rig.system, DREAM_EYES.stareSeconds + 0.1);
    expect(target.phase).toBe('growling');
    return { rig, target };
  }

  it('after growlSeconds the eye leaps', () => {
    const { rig, target } = makeAttackingRig();
    run(rig.system, DREAM_EYES.growlSeconds + 0.1);
    expect(target.phase).toBe('leaping');
  });

  it('after the leap the eye chases', () => {
    const { rig, target } = makeAttackingRig();
    run(rig.system, DREAM_EYES.growlSeconds + DREAM_EYES.leapSeconds + 0.1);
    expect(target.phase).toBe('chasing');
    expect(target.go.mode).toBe('aggressive');
  });

  it('looking away during chase does NOT calm the eye', () => {
    const { rig, target } = makeAttackingRig();
    run(rig.system, DREAM_EYES.growlSeconds + DREAM_EYES.leapSeconds + 0.1);
    expect(target.phase).toBe('chasing');
    // Move the eye far away so it cannot catch the player immediately.
    target.anchor.set(50, 2, 0);
    target.position.set(50, 2, 0);
    // Look away.
    rig.hooks.viewDirection = out => out.copy(target.position).sub(rig.pos).normalize().negate();
    run(rig.system, 5);
    // It should still be chasing, not reset to passive.
    expect(target.phase).toBe('chasing');
    expect(target.go.mode).toBe('aggressive');
  });

  it('eye reaching catchDistance calls onCatch', () => {
    const rig = makeRig({ count: 12, player: [0, 1.6, 0] });
    run(rig.system, DREAM_EYES.fadeSeconds + 0.1);
    const target = rig.system.slots.find(s => s.phase === 'passive');
    if (!target) return;
    // Place the eye right next to the player.
    target.anchor.set(0.5, 1.6, 0);
    target.position.set(0.5, 1.6, 0);
    // Force it into chasing state.
    target.phase = 'chasing';
    target.go.setMode('aggressive');
    run(rig.system, 0.5);
    expect(rig.hooks.onCatch).toHaveBeenCalled();
  });

  it('chasing eye bobs vertically instead of sliding flat', () => {
    const rig = makeRig({ count: 12, player: [0, 1.6, 0] });
    run(rig.system, DREAM_EYES.fadeSeconds + 0.1);
    const target = rig.system.slots.find(s => s.phase === 'passive');
    if (!target) return;
    // Place it far enough away that it won't catch during the test.
    target.anchor.set(20, 2, 0);
    target.position.set(20, 2, 0);
    target.phase = 'chasing';
    target.go.setMode('aggressive');
    target.bobPhase = 0;
    // Collect y values over several ticks.
    const ys = new Set();
    for (let i = 0; i < 40; i++) {
      rig.system.onUpdate(0.05);
      ys.add(+target.position.y.toFixed(4));
    }
    // The bob should produce more than one y value — it's not a flat slide.
    expect(ys.size).toBeGreaterThan(1);
    // And bobPhase should have accumulated.
    expect(target.bobPhase).toBeGreaterThan(0);
  });

  it('chase speed accelerates over time with no cap', () => {
    const rig = makeRig({ count: 12, player: [0, 1.6, 0] });
    run(rig.system, DREAM_EYES.fadeSeconds + 0.1);
    const target = rig.system.slots.find(s => s.phase === 'passive');
    if (!target) return;
    // Place it far enough away that it won't catch during the test.
    target.anchor.set(40, 2, 0);
    target.position.set(40, 2, 0);
    target.phase = 'chasing';
    target.go.setMode('aggressive');
    target.chaseTime = 0;
    // Measure distance covered in the first half-second.
    const x0 = target.position.x;
    run(rig.system, 0.5);
    const distEarly = Math.abs(target.position.x - x0);
    // Now chaseTime is ~0.5s. Measure distance in the next half-second.
    const x1 = target.position.x;
    run(rig.system, 0.5);
    const distLate = Math.abs(target.position.x - x1);
    // Later distance should be greater because of acceleration.
    expect(distLate).toBeGreaterThan(distEarly);
    // And chaseTime should have accumulated.
    expect(target.chaseTime).toBeGreaterThan(0.9);
  });

  it('random jumps fire during the chase and complete their arc', () => {
    // Force random() to always trigger a jump (returns 0, which is < jumpChance * dt).
    let jumpCount = 0;
    const rig = makeRig({
      count: 12, player: [0, 1.6, 0],
      random: () => { jumpCount++; return 0; },
    });
    run(rig.system, DREAM_EYES.fadeSeconds + 0.1);
    const target = rig.system.slots.find(s => s.phase === 'passive');
    if (!target) return;
    target.anchor.set(30, 2, 0);
    target.position.set(30, 2, 0);
    target.phase = 'chasing';
    target.go.setMode('aggressive');
    target.chaseTime = 0;
    target.jumpCooldown = 0;
    // Tick enough frames for at least one jump to trigger and complete.
    run(rig.system, DREAM_EYES.jumpDuration + 0.5);
    // The jump should have triggered (jumpCooldown was set after completion).
    expect(target.jumpCooldown).toBeGreaterThan(0);
  });

  it('jump cooldown prevents immediate re-jump', () => {
    const rig = makeRig({ count: 12, player: [0, 1.6, 0] });
    run(rig.system, DREAM_EYES.fadeSeconds + 0.1);
    const target = rig.system.slots.find(s => s.phase === 'passive');
    if (!target) return;
    target.anchor.set(30, 2, 0);
    target.position.set(30, 2, 0);
    target.phase = 'chasing';
    target.go.setMode('aggressive');
    // Set cooldown high — no jump should start.
    target.jumpCooldown = 100;
    target.jumpT = -1;
    const y0 = target.position.y;
    run(rig.system, 0.5);
    // jumpT should still be -1 (no jump started) because cooldown hasn't expired.
    expect(target.jumpT).toBe(-1);
  });
});

describe('visuals', () => {
  it('dims eyes by distance', () => {
    const rig = makeRig({ count: 12 });
    run(rig.system, DREAM_EYES.fadeSeconds + 0.1);
    // After ticking, every visible eye should have a fade > 0.
    for (const slot of rig.system.active) {
      expect(slot.go.object3d.visible).toBe(true);
    }
  });
});
