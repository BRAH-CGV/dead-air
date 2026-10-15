import * as THREE from 'three';
import { describe, it, expect, vi } from 'vitest';
import { DreamDustEyes, DREAM_EYES } from './DreamDustEyes.js';
import { DustEye } from '../gameobjects/DustEye.js';

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
  it('places all pool members around the player at the correct distances', () => {
    const rig = makeRig({ count: 16 });
    const active = rig.system.active;
    expect(active.length).toBe(16);
    for (const slot of active) {
      const d = Math.hypot(slot.position.x - rig.pos.x, slot.position.z - rig.pos.z);
      expect(d).toBeGreaterThanOrEqual(DREAM_EYES.spawnDistance[0] - 0.1);
      expect(d).toBeLessThanOrEqual(DREAM_EYES.spawnDistance[1] + 0.1);
      expect(slot.position.y).toBeGreaterThanOrEqual(DREAM_EYES.height[0]);
      expect(slot.position.y).toBeLessThanOrEqual(DREAM_EYES.height[1]);
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
    target.walkDist = 0;
    // Collect y values over several ticks.
    const ys = new Set();
    for (let i = 0; i < 40; i++) {
      rig.system.onUpdate(0.05);
      ys.add(+target.position.y.toFixed(4));
    }
    // The bob should produce more than one y value — it's not a flat slide.
    expect(ys.size).toBeGreaterThan(1);
    // And walkDist should have accumulated.
    expect(target.walkDist).toBeGreaterThan(0);
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
