import * as THREE from 'three';
import { describe, it, expect, vi } from 'vitest';
import {
  DustEyes, DUST_EYES, spawnChance, maxEyes, fenceSpawnPoint, windowSpawnPoint, throughWindow,
  sightBlocked, steerAround, leadingSilence,
} from './DustEyes.js';
import { DustEye } from '../gameobjects/DustEye.js';

// ─────────────────────────────────────────────
// DustEyes — the things in the storm, and the chase
// ─────────────────────────────────────────────

const FENCE = { minX: -20, maxX: 20, minZ: 4, maxZ: 30 };   // yard, in front (+Z)
const WINDOW = { x0: -4, x1: 4, z: -5, sill: 0.5, top: 2.8 }; // back wall, looking −Z

describe('how often', () => {
  it('never before night 2', () => {
    expect(spawnChance(1)).toBe(0);
    expect(maxEyes(1, 'fence')).toBe(0);
    expect(maxEyes(1, 'window')).toBe(0);
  });

  it('8 % a roll on night 2, 20 % from night 3', () => {
    expect(spawnChance(2)).toBe(0.08);
    expect(spawnChance(3)).toBe(0.2);
    // Through the window, one or two; in the yard, three or four.
    expect(maxEyes(2, 'window')).toBe(1);
    expect(maxEyes(3, 'window')).toBe(2);
    expect(maxEyes(2, 'fence')).toBe(3);
    expect(maxEyes(3, 'fence')).toBe(4);
  });

  it('1.3 seconds of staring is too long', () => {
    expect(DUST_EYES.stareSeconds).toBe(1.3);
  });
});

describe('where', () => {
  it('beyond the fence — never inside the yard — within sight of the player', () => {
    const player = new THREE.Vector3(0, 1.2, 15);
    for (let i = 0; i < 50; i++) {
      const p = fenceSpawnPoint(FENCE, player, Math.random, new THREE.Vector3());
      const inYard = p.x > FENCE.minX && p.x < FENCE.maxX && p.z > FENCE.minZ && p.z < FENCE.maxZ;
      expect(inYard).toBe(false);
      expect(p.z).toBeGreaterThan(FENCE.minZ);   // the building's side is not fenced
      expect(p.distanceTo(player)).toBeLessThan(DUST_EYES.sightRange);
      expect(p.y).toBeGreaterThan(1);
    }
  });

  it('out past the window, where it can be seen through the glass from inside', () => {
    const inside = new THREE.Vector3(0, 1.24, -2);
    for (let i = 0; i < 50; i++) {
      const p = windowSpawnPoint(WINDOW, Math.random, new THREE.Vector3());
      expect(p.z).toBeLessThan(WINDOW.z - 5);
      expect(throughWindow(inside, p, WINDOW)).toBe(true);
    }
  });

  it('throughWindow: through the glass yes, through the wall beside it or below the sill no', () => {
    const eye = new THREE.Vector3(0, 1.24, -2);
    expect(throughWindow(eye, new THREE.Vector3(0, 1.5, -15), WINDOW)).toBe(true);
    expect(throughWindow(eye, new THREE.Vector3(30, 1.5, -15), WINDOW)).toBe(false);
    expect(throughWindow(eye, new THREE.Vector3(0, -8, -15), WINDOW)).toBe(false);
    expect(throughWindow(new THREE.Vector3(0, 1.24, -8), new THREE.Vector3(0, 1.5, -15), WINDOW)).toBe(false);
  });
});

// ── The system, with a fake player ──

function makeSound() {
  return {
    isPlaying: false, volume: 0,
    play: vi.fn(function () { this.isPlaying = true; }),
    stop: vi.fn(function () { this.isPlaying = false; }),
    setVolume: vi.fn(function (v) { this.volume = v; }),
    setLoop: vi.fn(),
  };
}

function makeRig({ night = 2, outside = true, random = () => 0, player = [0, 1.24, 15], look = null, hatchShut = false } = {}) {
  const listeners = [];
  const controller = {
    state: 'playing',
    nightNumber: night,
    onNightStart: fn => { listeners.push(fn); return () => {}; },
    fail: vi.fn(function () { this.state = 'gameOver'; }),
  };
  const sandstorm = { level: 1, held: false, stormId: 1, stormProgress: 0.1 };
  const pos = new THREE.Vector3(...player);
  const dir = new THREE.Vector3(0, 0, -1);
  const state = { outside, hatchShut };
  const hooks = {
    eyePosition: out => out.copy(pos),
    viewDirection: out => (look ? out.copy(look()).sub(pos).normalize() : out.copy(dir)),
    isOutside: () => state.outside,
    hatchShut: () => state.hatchShut,
    setPlayerLocked: vi.fn(),
  };
  const whiteOut = { play: vi.fn(), clear: vi.fn() };
  const pool = Array.from({ length: 6 }, () => new DustEye());
  const sounds = { attack: makeSound(), bite: makeSound(), growl: makeSound() };
  const fog = new THREE.FogExp2(0x5a3f2c, 0.07);
  const system = new DustEyes({
    controller, sandstorm, hooks, whiteOut, pool, fence: FENCE, window: WINDOW, random, sounds, fog,
  });
  system.onStart();
  return { system, controller, sandstorm, hooks, whiteOut, pool, pos, state, sounds, fog, startNight: (n, o = {}) => listeners.forEach(fn => fn(n, o)) };
}

const run = (system, seconds, step = 0.05) => {
  for (let t = 0; t < seconds - 1e-9; t += step) system.onUpdate(step);
};

/** Look straight at the first live eye, wherever it is. */
const atFirst = (rig) => () => rig.system.active[0]?.position ?? new THREE.Vector3(0, 0, -100);

describe('DustEyes', () => {
  it('spawn only in a storm, from night 2', () => {
    const calm = makeRig({ night: 2 });
    calm.sandstorm.level = 0;
    run(calm.system, 60);
    expect(calm.system.active).toHaveLength(0);

    const early = makeRig({ night: 1 });
    run(early.system, 60);
    expect(early.system.active).toHaveLength(0);

    const storm = makeRig({ night: 2 });
    run(storm.system, DUST_EYES.checkSeconds + 0.1);
    expect(storm.system.active.length).toBeGreaterThanOrEqual(1);
    expect(storm.pool.some(e => e.object3d.visible)).toBe(true);
  });

  it('spawn passive, at the fence while the player is outside, past the window while inside', () => {
    const out = makeRig({ outside: true });
    run(out.system, DUST_EYES.checkSeconds + 0.1);
    expect(out.system.active[0].kind).toBe('fence');
    expect(out.system.active[0].mode).toBe('passive');

    const inside = makeRig({ outside: false, player: [0, 1.24, -2] });
    run(inside.system, DUST_EYES.checkSeconds + 0.1);
    expect(inside.system.active[0].kind).toBe('window');
  });

  it('a glance is fine; staring too long turns it, and it comes for you — holding the storm', () => {
    const rig = makeRig();
    rig.system.summon('fence');
    run(rig.system, 0.1);
    const lookAway = new THREE.Vector3(0, 1.24, 1000);
    const eye = rig.system.active[0];
    rig.hooks.viewDirection = out => out.copy(eye.position).sub(rig.pos).normalize();
    run(rig.system, DUST_EYES.stareSeconds * 0.5);
    rig.hooks.viewDirection = out => out.copy(lookAway).sub(rig.pos).normalize();
    run(rig.system, DUST_EYES.stareSeconds);
    expect(eye.mode).toBe('passive');

    rig.hooks.viewDirection = out => out.copy(eye.position).sub(rig.pos).normalize();
    run(rig.system, DUST_EYES.stareSeconds + 0.1);
    expect(eye.mode).toBe('growl');
    expect(rig.sandstorm.held).toBe(true);
    const start = eye.position.distanceTo(rig.pos);
    run(rig.system, DUST_EYES.growlSeconds + 1);
    expect(eye.position.distanceTo(rig.pos)).toBeLessThan(start - 1);
  });

  it('catches a player who stays out: game over', () => {
    const rig = makeRig();
    rig.system.summon('fence');
    run(rig.system, 0.1);
    const eye = rig.system.active[0];
    rig.hooks.viewDirection = out => out.copy(eye.position).sub(rig.pos).normalize();
    run(rig.system, 30);
    expect(rig.controller.fail).toHaveBeenCalledTimes(1);
    expect(rig.whiteOut.play).toHaveBeenCalled();
    expect(rig.hooks.setPlayerLocked).toHaveBeenCalledWith(true);
    expect(rig.sandstorm.held).toBe(false);
  });

  it('gives up when the player is in and the airlock hatch is shut — and lets the storm go', () => {
    const rig = makeRig();
    rig.system.summon('fence');
    run(rig.system, 0.1);
    const eye = rig.system.active[0];
    rig.hooks.viewDirection = out => out.copy(eye.position).sub(rig.pos).normalize();
    run(rig.system, DUST_EYES.stareSeconds + DUST_EYES.growlSeconds + 0.2);
    expect(rig.sandstorm.held).toBe(true);

    // Into the airlock: inside, but the hatch is still open — not safe yet.
    rig.state.outside = false;
    rig.pos.set(0, 1.24, 40);   // far off, so it can't arrive this second
    run(rig.system, 0.5);
    expect(rig.sandstorm.held).toBe(true);

    rig.state.hatchShut = true;
    run(rig.system, DUST_EYES.fadeSeconds + 0.2);
    expect(rig.sandstorm.held).toBe(false);
    expect(rig.system.active).toHaveLength(0);
    expect(rig.controller.fail).not.toHaveBeenCalled();
  });

  it('seen through the window, it growls (barely heard) and backs off into the fog — no chase', () => {
    const rig = makeRig({ outside: false, player: [0, 1.24, -2] });
    rig.system.summon('window');
    run(rig.system, 0.1);
    const eye = rig.system.active[0];
    expect(eye.kind).toBe('window');
    rig.hooks.viewDirection = out => out.copy(eye.position).sub(rig.pos).normalize();
    run(rig.system, DUST_EYES.windowStareSeconds + 0.1);
    expect(eye.mode).toBe('growl');
    expect(rig.sandstorm.held).toBe(false);
    expect(rig.sounds.growl.play).toHaveBeenCalledTimes(1);
    expect(rig.sounds.growl.volume).toBe(DUST_EYES.windowGrowlVolume);
    expect(DUST_EYES.windowGrowlVolume).toBeLessThanOrEqual(0.08);
    const before = eye.position.distanceTo(rig.pos);
    run(rig.system, DUST_EYES.retreatSeconds * 0.5);
    expect(eye.position.distanceTo(rig.pos)).toBeGreaterThan(before + 1);
    const atWindow = () => rig.system.active.filter(s => s.kind === 'window');
    expect(atWindow()).toHaveLength(1);   // still backing off
    run(rig.system, DUST_EYES.retreatSeconds * 0.5 + 0.1);
    expect(atWindow()).toHaveLength(0);
    expect(rig.controller.fail).not.toHaveBeenCalled();
    // …and it comes round to the yard, agitated.
    expect(eye.kind).toBe('fence');
    expect(eye.agitated).toBe(true);
    expect(eye.go.agitated).toBe(true);
    expect(eye.mode).toBe('passive');
  });

  it('cannot be stared at through a wall', () => {
    // Inside, but the eye is off to the side, beyond the solid wall.
    const rig = makeRig({ outside: false, player: [0, 1.24, -2] });
    rig.system.summon('window');
    run(rig.system, 0.1);
    const eye = rig.system.active[0];
    eye.anchor.set(40, 1.5, -15);
    run(rig.system, 0.05);
    rig.hooks.viewDirection = out => out.copy(eye.position).sub(rig.pos).normalize();
    run(rig.system, DUST_EYES.windowStareSeconds * 3);
    expect(eye.mode).toBe('passive');
  });

  it('passive eyes drift off after a while, and with the storm', () => {
    const rig = makeRig({ random: () => 0.999 });   // no further random spawns
    rig.system.summon('fence');
    run(rig.system, 0.1);
    run(rig.system, DUST_EYES.lifeSeconds[1] + DUST_EYES.fadeSeconds + 0.5);
    expect(rig.system.active).toHaveLength(0);

    rig.system.summon('fence');
    run(rig.system, 0.1);
    rig.sandstorm.level = 0.2;
    run(rig.system, DUST_EYES.fadeSeconds + 0.2);
    expect(rig.system.active).toHaveLength(0);
  });

  it('a new night (or a retry) clears them and frees the player', () => {
    const rig = makeRig();
    rig.system.summon('fence');
    run(rig.system, 0.1);
    const eye = rig.system.active[0];
    rig.hooks.viewDirection = out => out.copy(eye.position).sub(rig.pos).normalize();
    run(rig.system, 30);
    expect(rig.controller.fail).toHaveBeenCalled();
    rig.controller.state = 'playing';
    rig.startNight(2, { retry: true });
    expect(rig.system.active).toHaveLength(0);
    expect(rig.hooks.setPlayerLocked).toHaveBeenLastCalledWith(false);
    expect(rig.pool.every(e => !e.object3d.visible)).toBe(true);
  });

  it('vanish when the shift ends', () => {
    const rig = makeRig();
    rig.system.summon('fence');
    run(rig.system, 0.1);
    rig.controller.state = 'morning';
    run(rig.system, 0.1);
    expect(rig.system.active).toHaveLength(0);
    expect(rig.sandstorm.held).toBe(false);
  });
});

describe('DustEyes — where the player is', () => {
  it('neither kind melts away when the player goes in or out', () => {
    const rig = makeRig({ outside: true, random: () => 0.999 });
    rig.system.summon('fence');
    run(rig.system, 0.1);
    expect(rig.system.active[0].kind).toBe('fence');
    rig.state.outside = false;
    rig.pos.set(0, 1.24, -2);
    rig.system.summon('window');
    run(rig.system, DUST_EYES.fadeSeconds + 0.2);
    expect(rig.system.active.map(s => s.kind).sort()).toEqual(['fence', 'window']);
    rig.state.outside = true;
    rig.pos.set(0, 1.24, 15);
    run(rig.system, DUST_EYES.fadeSeconds + 0.2);
    expect(rig.system.active.map(s => s.kind).sort()).toEqual(['fence', 'window']);
  });

  it('night 3: stepping out into the storm always brings two to the fence', () => {
    const rig = makeRig({ night: 3, outside: false, player: [0, 1.24, -2], random: () => 0.999 });
    run(rig.system, 10);
    expect(rig.system.active).toHaveLength(0);   // the rolls all failed
    rig.state.outside = true;
    rig.pos.set(0, 1.24, 15);
    run(rig.system, DUST_EYES.guaranteeDelay + 0.2);
    expect(rig.system.active.filter(s => s.kind === 'fence')).toHaveLength(2);
  });

  it('night 2: no such promise', () => {
    const rig = makeRig({ night: 2, outside: false, player: [0, 1.24, -2], random: () => 0.999 });
    rig.state.outside = true;
    rig.pos.set(0, 1.24, 15);
    run(rig.system, DUST_EYES.guaranteeDelay + 0.2);
    expect(rig.system.active).toHaveLength(0);
  });
});

describe('DustEyes — several at once', () => {
  it('keeps rolling in the yard, up to the most the night allows', () => {
    const rig = makeRig({ night: 3, hatchShut: true });   // random 0: every roll comes up
    // Four rolls, inside the first one's life, so none has drifted off yet.
    run(rig.system, DUST_EYES.checkSeconds * 4 + 0.5);
    const kinds = rig.system.active.map(s => s.kind);
    expect(kinds.filter(k => k === 'fence')).toHaveLength(maxEyes(3, 'fence'));
  });

  it('in the yard, whether the player is in or out — waiting for them', () => {
    const rig = makeRig({ night: 2, outside: false, player: [0, 1.24, -2] });
    run(rig.system, DUST_EYES.checkSeconds * 3 + 0.1);
    expect(rig.system.active.filter(s => s.kind === 'fence').length).toBeGreaterThanOrEqual(2);
  });

  it('through the window, few — and a long wait between them', () => {
    const rig = makeRig({ night: 3, outside: false, player: [0, 1.24, -2] });   // every roll comes up
    let spawns = 0;
    const live = new Map();
    for (let t = 0; t < DUST_EYES.windowCooldown * 2 + 1; t += 0.05) {
      rig.system.onUpdate(0.05);
      for (const slot of rig.system.slots) {
        const now = slot.phase !== 'off' && slot.kind === 'window';
        if (now && !live.get(slot)) spawns++;
        live.set(slot, now);
      }
      expect(rig.system.slots.filter(s => s.phase !== 'off' && s.kind === 'window').length)
        .toBeLessThanOrEqual(maxEyes(3, 'window'));
    }
    expect(DUST_EYES.windowCooldown).toBeGreaterThanOrEqual(30);
    expect(spawns).toBeGreaterThanOrEqual(2);
    expect(spawns).toBeLessThanOrEqual(3);
  });

  it('through the window they sit deep in the fog and burn fainter; in the yard they stand back from the fence', () => {
    expect(DUST_EYES.windowDistance[0]).toBeGreaterThanOrEqual(21);
    expect(DUST_EYES.beyondFence[0]).toBeGreaterThanOrEqual(6);
    expect(DUST_EYES.beyondFence[1]).toBeLessThanOrEqual(10);
    const rig = makeRig({ random: () => 0.999 });
    rig.system.summon('fence');
    rig.state.outside = false;
    rig.pos.set(0, 1.24, -2);
    rig.system.summon('window');
    const [yard, win] = rig.system.active;
    expect(yard.kind).toBe('fence');
    expect(win.kind).toBe('window');
    const glow = s => s.go.eyeMaterial.uniforms.uIntensity.value;
    expect(glow(win)).toBeLessThan(glow(yard) * 0.7);
    expect(DUST_EYES.windowDim).toBeGreaterThan(DUST_EYES.dimDensity);
  });
});

describe('DustEyes — how they look and sound', () => {
  it('drift slowly side to side while they watch', () => {
    const rig = makeRig({ random: () => 0.999 });
    rig.system.summon('fence');
    run(rig.system, 0.1);
    const eye = rig.system.active[0];
    const xs = [];
    for (let i = 0; i < 40; i++) { run(rig.system, 0.25); xs.push(eye.position.clone()); }
    const spread = Math.max(...xs.map(p => p.distanceTo(eye.anchor)));
    expect(spread).toBeGreaterThan(DUST_EYES.swayAmplitude * 0.5);
    expect(spread).toBeLessThanOrEqual(DUST_EYES.swayAmplitude + 1e-6);
    // Slowly: never more than a fraction of a metre per quarter second.
    for (let i = 1; i < xs.length; i++) expect(xs[i].distanceTo(xs[i - 1])).toBeLessThan(0.5);
  });

  it('stand out of the storm as a silhouette a little darker than the fog', () => {
    const rig = makeRig();
    rig.system.summon('fence');
    run(rig.system, 0.1);
    const go = rig.system.active[0].go;
    const body = go.bodyMaterial.uniforms.uColor.value;
    const fog = rig.fog.color;
    expect(body.r).toBeLessThan(fog.r);
    expect(body.r).toBeGreaterThan(fog.r * 0.3);
    expect(body.r / body.b).toBeCloseTo(fog.r / fog.b, 1);   // the same brown, darker
  });

  it('the attack sound runs through the chase, quietly, and stops when it gives up', () => {
    const rig = makeRig();
    rig.system.summon('fence');
    run(rig.system, 0.1);
    const eye = rig.system.active[0];
    rig.hooks.viewDirection = out => out.copy(eye.position).sub(rig.pos).normalize();
    run(rig.system, DUST_EYES.stareSeconds + DUST_EYES.growlSeconds + 0.2);
    expect(rig.sounds.attack.isPlaying).toBe(true);
    expect(rig.sounds.attack.volume).toBeLessThanOrEqual(DUST_EYES.attackVolume);
    expect(DUST_EYES.attackVolume).toBeLessThanOrEqual(0.35);
    rig.state.outside = false;
    rig.state.hatchShut = true;
    run(rig.system, DUST_EYES.fadeSeconds + 0.2);
    expect(rig.sounds.attack.isPlaying).toBe(false);
  });

  it('bites when it catches you', () => {
    const rig = makeRig();
    rig.system.summon('fence');
    run(rig.system, 0.1);
    const eye = rig.system.active[0];
    rig.hooks.viewDirection = out => out.copy(eye.position).sub(rig.pos).normalize();
    run(rig.system, 30);
    expect(rig.sounds.bite.play).toHaveBeenCalledTimes(1);
    expect(rig.sounds.attack.isPlaying).toBe(false);
    expect(rig.whiteOut.play).toHaveBeenCalledWith(expect.stringMatching(/eaten/i), expect.objectContaining({ tone: 'blood' }));
    // Black at once, turning red; [E] only once the prompt is up.
    const screen = rig.whiteOut.play.mock.lastCall[1];
    expect(screen.fadeMs).toBe(0);
    expect(rig.controller.fail.mock.lastCall[1].retryAfter).toBeCloseTo(screen.messageDelayMs / 1000);
  });
});

describe('DustEyes — the growl and the leap', () => {
  /** A rig with one eye out at the fence, stared at until it turns. */
  function turned({ gap = null } = {}) {
    const rig = makeRig();
    rig.system.summon('fence');
    run(rig.system, 0.1);
    const eye = rig.system.active[0];
    if (gap !== null) {
      // Stand `gap` metres from it, square on.
      rig.pos.copy(eye.anchor).add(new THREE.Vector3(0, 0, gap));
      rig.pos.y = eye.anchor.y;
    }
    rig.hooks.viewDirection = out => out.copy(eye.position).sub(rig.pos).normalize();
    run(rig.system, DUST_EYES.stareSeconds + 0.05);
    return { rig, eye };
  }

  it('growls first: still, jaws shut, a low growl — for just over a second', () => {
    const { rig, eye } = turned();
    expect(eye.mode).toBe('growl');
    expect(rig.sounds.growl.play).toHaveBeenCalledTimes(1);
    expect(rig.sounds.growl.volume).toBe(DUST_EYES.growlVolume);
    expect(DUST_EYES.growlSeconds).toBeGreaterThan(1);
    expect(DUST_EYES.growlSeconds).toBeLessThan(1.5);
    const at = eye.position.clone();
    run(rig.system, DUST_EYES.growlSeconds - 0.15);
    expect(eye.position.distanceTo(at)).toBeLessThan(1e-6);   // not a twitch
    expect(rig.sounds.attack.isPlaying).toBe(false);
  });

  it('then leaps, jaws open, closing the gap — but lands well short of the player', () => {
    const { rig, eye } = turned({ gap: 14 });
    run(rig.system, DUST_EYES.growlSeconds + 0.05);
    expect(eye.mode).toBe('aggressive');
    run(rig.system, DUST_EYES.leapSeconds);
    const d = eye.position.distanceTo(rig.pos);
    expect(d).toBeLessThan(14 - 3);
    expect(d).toBeGreaterThanOrEqual(DUST_EYES.leapMinGap - 0.5);
  });

  it('never leaps onto a player who is already close', () => {
    const { rig, eye } = turned({ gap: 4 });
    run(rig.system, DUST_EYES.growlSeconds + 0.05 + DUST_EYES.leapSeconds * 0.5);
    expect(eye.position.distanceTo(rig.pos)).toBeGreaterThan(3);
    expect(rig.controller.fail).not.toHaveBeenCalled();
  });

  it('leaves time to run: a player sprinting away from where it lands gets away from it', () => {
    expect(DUST_EYES.chaseSpeed).toBeLessThan(5);
    // Landing 4 m off, a sprinter keeps it behind them for a good few seconds.
    expect(DUST_EYES.leapMinGap).toBe(4);
    expect(DUST_EYES.leapMinGap / (5 - DUST_EYES.chaseSpeed)).toBeGreaterThan(2.5);
  });
});

describe('DustEyes — the J key', () => {
  it('puts it in front of the player, so it can be found', () => {
    const rig = makeRig({ random: Math.random });
    for (const look of [[0, 0, 1], [-1, 0, 0], [1, 0, 0.2]]) {
      rig.system.reset(2);
      rig.hooks.viewDirection = out => out.set(...look).normalize();
      expect(rig.system.summon('fence')).toBe(true);
      const eye = rig.system.active[0];
      const to = eye.position.clone().sub(rig.pos).setY(0).normalize();
      const view = new THREE.Vector3(...look).setY(0).normalize();
      expect(to.dot(view), look.join()).toBeGreaterThan(Math.cos(THREE.MathUtils.degToRad(DUST_EYES.inViewAngle)) - 1e-6);
    }
  });

  it('brings one to the yard and one to the window, wherever the player is', () => {
    for (const outside of [true, false]) {
      const rig = makeRig({ outside, player: outside ? [0, 1.24, 15] : [0, 1.24, -2], random: () => 0.999 });
      expect(rig.system.summon()).toBe(true);
      expect(rig.system.active.map(s => s.kind)).toEqual(['fence', 'window']);
    }
  });
});

describe('DustEyes — facing', () => {
  it('every eye out there looks at the player, wherever they walk', () => {
    const rig = makeRig({ night: 3, random: () => 0.3 });
    rig.system.summon('fence');
    run(rig.system, DUST_EYES.checkSeconds * 3 + 0.1);
    for (const at of [[0, 1.24, 15], [-14, 1.24, 6], [14, 1.24, 16]]) {
      rig.pos.set(...at);
      run(rig.system, 0.05);
      for (const slot of rig.system.active) {
        slot.go.object3d.updateMatrixWorld(true);
        const mesh = slot.go.eyes[0];
        const normal = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
        const toPlayer = rig.pos.clone().sub(mesh.getWorldPosition(new THREE.Vector3())).normalize();
        expect(normal.dot(toPlayer)).toBeGreaterThan(0.98);
      }
    }
  });
});

describe('DustEyes — a harder leap from further back', () => {
  it('covers more ground, faster, but still lands short of the player', () => {
    expect(DUST_EYES.leapDistance).toBeGreaterThanOrEqual(9);
    expect(DUST_EYES.leapSeconds).toBeLessThanOrEqual(0.5);
    expect(DUST_EYES.leapMinGap).toBeGreaterThanOrEqual(4);
  });
});

describe('trees', () => {
  const tree = (x, z) => ({ x, z, reach: 2.35 });

  it('sightBlocked: a tree between the two, or the far end inside a canopy', () => {
    const eye = new THREE.Vector3(0, 1.24, 0);
    expect(sightBlocked(eye, new THREE.Vector3(0, 1.8, 20), [tree(0, 10)])).toBe(true);
    expect(sightBlocked(eye, new THREE.Vector3(0, 1.8, 20), [tree(6, 10)])).toBe(false);
    expect(sightBlocked(eye, new THREE.Vector3(0, 1.8, 20), [tree(1, 21)])).toBe(true);
    expect(sightBlocked(eye, new THREE.Vector3(0, 1.8, 20), [])).toBe(false);
  });

  it('fence spawns stand clear of the trees and in plain sight of the player', () => {
    const player = new THREE.Vector3(0, 1.24, 15);
    // A treeline just beyond the far run and the ends, with gaps.
    const trees = [];
    for (let x = -30; x <= 30; x += 5) trees.push(tree(x, FENCE.maxZ + 5));
    for (let z = 0; z <= 35; z += 5) trees.push(tree(FENCE.minX - 5, z), tree(FENCE.maxX + 5, z));
    for (let i = 0; i < 60; i++) {
      const p = fenceSpawnPoint(FENCE, player, Math.random, new THREE.Vector3(), { trees });
      expect(sightBlocked(player, p, trees), p.toArray().join()).toBe(false);
    }
  });
});

describe('obstacles', () => {
  const buggy = { minX: -1, maxX: 1, minZ: -2, maxZ: 2 };

  it('steerAround: straight on when nothing is in the way', () => {
    const out = steerAround(new THREE.Vector3(-10, 1, 10), new THREE.Vector3(10, 1, 10), [buggy], new THREE.Vector3());
    expect(out.toArray()).toEqual([10, 1, 10]);
  });

  it('steerAround: works its way round, corner to corner, without dithering', () => {
    const p = new THREE.Vector3(-1.85, 1.5, 2.52);
    const to = new THREE.Vector3(9, 1.24, 0);
    const way = new THREE.Vector3();
    for (let i = 0; i < 200 && p.distanceTo(to) > 0.2; i++) {
      steerAround(p, to, [buggy], way);
      const d = way.clone().sub(p);
      p.addScaledVector(d, Math.min(0.18, d.length()) / d.length());
      expect(p.x > buggy.minX && p.x < buggy.maxX && p.z > buggy.minZ && p.z < buggy.maxZ).toBe(false);
    }
    expect(p.distanceTo(to)).toBeLessThanOrEqual(0.2);
  });

  it('steerAround: makes for a corner of something in the way', () => {
    const out = steerAround(new THREE.Vector3(-10, 1, 0), new THREE.Vector3(10, 1, 0), [buggy], new THREE.Vector3());
    expect(Math.abs(out.x)).toBeGreaterThan(1);
    expect(Math.abs(out.z)).toBeGreaterThan(2);
  });

  it('a chase goes round the buggy, never through it — and still gets there', () => {
    const rig = makeRig({ random: () => 0.999 });
    rig.system.obstacles = [buggy];
    rig.system.summon('fence');
    run(rig.system, 0.1);
    const eye = rig.system.active[0];
    // The eye on one side of the buggy, the player square behind the other.
    eye.anchor.set(-12, 1.8, 0);
    run(rig.system, 0.05);
    rig.pos.set(9, 1.24, 0);
    rig.hooks.viewDirection = out => out.copy(eye.position).sub(rig.pos).normalize();
    let inside = 0;
    for (let t = 0; t < 30 && rig.controller.state === 'playing'; t += 0.05) {
      rig.system.onUpdate(0.05);
      const p = eye.position;
      if (p.x > buggy.minX && p.x < buggy.maxX && p.z > buggy.minZ && p.z < buggy.maxZ) inside++;
    }
    expect(inside).toBe(0);
    expect(rig.controller.fail).toHaveBeenCalled();
  });
});

describe('in plain sight', () => {
  const buggy = { minX: -12, maxX: -8, minZ: 13, maxZ: 17 };

  it('sightBlocked: something solid between them blocks the view too', () => {
    const eye = new THREE.Vector3(0, 1.24, 15);
    expect(sightBlocked(eye, new THREE.Vector3(-22, 1.8, 15), [], [buggy])).toBe(true);
    expect(sightBlocked(eye, new THREE.Vector3(-22, 1.8, 2), [], [buggy])).toBe(false);
  });

  it('never puts a yard eye behind the buggy', () => {
    const player = new THREE.Vector3(0, 1.24, 15);
    for (let i = 0; i < 80; i++) {
      const p = fenceSpawnPoint(FENCE, player, Math.random, new THREE.Vector3(), { obstacles: [buggy] });
      expect(sightBlocked(player, p, [], [buggy]), p.toArray().join()).toBe(false);
    }
  });

  it('can be asked to land in front of the player', () => {
    const player = new THREE.Vector3(0, 1.24, 15);
    const facing = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < 80; i++) {
      const p = fenceSpawnPoint(FENCE, player, Math.random, new THREE.Vector3(), { facing, inView: true });
      const to = p.clone().sub(player).setY(0).normalize();
      expect(to.dot(facing)).toBeGreaterThan(Math.cos(THREE.MathUtils.degToRad(DUST_EYES.inViewAngle)) - 1e-6);
    }
  });

  it('natural ones are in view more often than not — but not always', () => {
    expect(DUST_EYES.inViewChance).toBeGreaterThan(0.5);
    expect(DUST_EYES.inViewChance).toBeLessThan(1);
  });
});

describe('DustEyes — staying out too long', () => {
  /** Night 2, outside with the hatch just opened, one yard eye out there. */
  function outThere({ random = () => 0 } = {}) {
    const rig = makeRig({ random: () => 0.999 });
    rig.system.summon('fence');
    rig.system.random = random;
    rig.hooks.viewDirection = out => out.set(0, -1, 0);   // at the ground: no stare
    return rig;
  }

  it('the first seconds after the hatch opens are safe', () => {
    const rig = outThere();
    run(rig.system, DUST_EYES.graceSeconds - 0.2);
    expect(rig.system.active.every(s => s.mode === 'passive')).toBe(true);
  });

  it('after that, every couple of seconds each yard eye may turn on its own', () => {
    expect(DUST_EYES.aggroRollSeconds).toBe(2);
    expect(DUST_EYES.aggroChance).toBe(0.05);
    const rig = outThere();
    run(rig.system, DUST_EYES.graceSeconds + DUST_EYES.aggroRollSeconds + 0.1);
    expect(rig.system.active[0].mode).toBe('growl');
    expect(rig.sandstorm.held).toBe(true);
  });

  it('turned that way it growls for two seconds, not one, before it leaps', () => {
    expect(DUST_EYES.passiveGrowlSeconds).toBe(2);
    const rig = outThere();
    run(rig.system, DUST_EYES.graceSeconds + DUST_EYES.aggroRollSeconds + 0.1);
    const eye = rig.system.active[0];
    run(rig.system, 1.7);
    expect(eye.phase).toBe('growling');
    run(rig.system, 0.4);
    expect(eye.phase).not.toBe('growling');
  });

  it('5 % a roll: a roll of 0.1 leaves an ordinary eye be', () => {
    const rig = outThere({ random: () => 0.1 });
    run(rig.system, DUST_EYES.graceSeconds + DUST_EYES.aggroRollSeconds * 3);
    expect(rig.system.active[0].mode).toBe('passive');
  });

  it('never from indoors, nor while the hatch is shut', () => {
    const rig = outThere();
    rig.state.outside = false;
    run(rig.system, DUST_EYES.graceSeconds + DUST_EYES.aggroRollSeconds * 3);
    expect(rig.system.active[0].mode).toBe('passive');
    // Back in with the hatch shut, the clock starts again from the next opening.
    rig.state.hatchShut = true;
    run(rig.system, 0.1);
    rig.state.hatchShut = false;
    rig.state.outside = true;
    run(rig.system, DUST_EYES.graceSeconds - 0.3);
    expect(rig.system.active[0].mode).toBe('passive');
  });

  it('only one turns on its own — but look at another during the chase and it comes too', () => {
    const rig = makeRig({ night: 3, random: () => 0.999 });
    rig.system.summon('fence');
    rig.system.summon('fence');
    expect(rig.system.active).toHaveLength(2);
    rig.system.random = () => 0;
    rig.hooks.viewDirection = out => out.set(0, -1, 0);
    run(rig.system, DUST_EYES.graceSeconds + DUST_EYES.aggroRollSeconds * 2 + 0.1);
    const turned = rig.system.active.filter(s => s.mode !== 'passive');
    expect(turned).toHaveLength(1);
    const other = rig.system.active.find(s => s.mode === 'passive');
    rig.hooks.viewDirection = out => out.copy(other.position).sub(rig.pos).normalize();
    run(rig.system, DUST_EYES.stareSeconds + 0.1);
    expect(other.mode).not.toBe('passive');
    expect(rig.system.active.filter(s => s.mode !== 'passive')).toHaveLength(2);
  });

  it('agitated ones (seen through the window) burn darker and turn far more readily', () => {
    expect(DUST_EYES.agitatedAggroChance).toBe(0.25);
    // At the desk: the hatch is shut.
    const rig = makeRig({ outside: false, player: [0, 1.24, -2], random: () => 0.999, hatchShut: true });
    rig.system.summon('window');
    run(rig.system, 0.1);
    const eye = rig.system.active[0];
    rig.hooks.viewDirection = out => out.copy(eye.position).sub(rig.pos).normalize();
    run(rig.system, DUST_EYES.windowStareSeconds + DUST_EYES.retreatSeconds + 0.3);
    expect(eye.kind).toBe('fence');
    expect(eye.agitated).toBe(true);
    // Out into the yard: a roll of 0.1 is under its 25 %.
    rig.system.random = () => 0.1;
    rig.hooks.viewDirection = out => out.set(0, -1, 0);
    rig.state.hatchShut = false;   // out through the airlock
    rig.state.outside = true;
    rig.pos.set(0, 1.24, 15);
    run(rig.system, DUST_EYES.graceSeconds + DUST_EYES.aggroRollSeconds + 0.1);
    expect(eye.mode).toBe('growl');
  });
});

describe('DustEyes — the midway check', () => {
  const kinds = rig => rig.system.active.map(s => s.kind);

  it('halfway through a storm: one in the yard and one at the window, for certain', () => {
    const rig = makeRig({ night: 2, random: () => 0.999 });   // no rolls of its own
    run(rig.system, 1);
    expect(rig.system.active).toHaveLength(0);
    rig.sandstorm.stormProgress = 0.5;
    run(rig.system, 0.1);
    expect(kinds(rig).sort()).toEqual(['fence', 'window']);
  });

  it('once a storm — and again the next', () => {
    const rig = makeRig({ night: 2, random: () => 0.999 });
    rig.sandstorm.stormProgress = 0.5;
    run(rig.system, 0.1);
    rig.sandstorm.stormProgress = 0.7;
    run(rig.system, 1);
    expect(rig.system.active).toHaveLength(2);
    for (const s of rig.system.slots) rig.system._hide(s);
    rig.sandstorm.stormId = 2;
    rig.sandstorm.stormProgress = 0.55;
    run(rig.system, 0.1);
    expect(rig.system.active).toHaveLength(2);
  });

  it('no second at the window if one is already there', () => {
    const rig = makeRig({ night: 2, outside: false, player: [0, 1.24, -2], random: () => 0.999 });
    rig.system.summon('window');
    rig.sandstorm.stormProgress = 0.5;
    run(rig.system, 0.1);
    expect(kinds(rig).filter(k => k === 'window')).toHaveLength(1);
    expect(kinds(rig).filter(k => k === 'fence')).toHaveLength(1);
  });

  it('night 3 brings two to the yard', () => {
    const rig = makeRig({ night: 3, random: () => 0.999, hatchShut: true });
    rig.sandstorm.stormProgress = 0.5;
    run(rig.system, 0.1);
    expect(kinds(rig).filter(k => k === 'fence')).toHaveLength(2);
  });

  it('not before night 2', () => {
    const rig = makeRig({ night: 1, random: () => 0.999 });
    rig.sandstorm.stormProgress = 0.5;
    run(rig.system, 0.1);
    expect(rig.system.active).toHaveLength(0);
  });
});

describe('DustEyes — the airlock is solid but for its hatch', () => {
  // An airlock jutting into the yard, its hatch at the far end (+z).
  const airlock = { minX: -1.5, maxX: 1.5, minZ: 4, maxZ: 7, door: { x: 0, z: 7, halfWidth: 0.6 } };

  it('a chase after a player in the airlock comes in through the hatch, never the side walls', () => {
    const rig = makeRig({ random: () => 0.999 });
    rig.system.obstacles = [airlock];
    rig.system.summon('fence');
    run(rig.system, 0.1);
    const eye = rig.system.active[0];
    eye.anchor.set(-14, 1.8, 5.5);   // off to the side, level with the airlock
    run(rig.system, 0.05);
    rig.pos.set(-8, 1.24, 5.5);
    rig.hooks.viewDirection = out => out.copy(eye.position).sub(rig.pos).normalize();
    run(rig.system, DUST_EYES.stareSeconds + 0.1);
    // Into the airlock — hatch still open.
    rig.pos.set(0, 1.24, 5.5);
    rig.state.outside = false;
    let throughWall = 0;
    for (let t = 0; t < 40 && rig.controller.state === 'playing'; t += 0.05) {
      rig.system.onUpdate(0.05);
      const p = eye.position;
      const inside = p.x > airlock.minX && p.x < airlock.maxX && p.z > airlock.minZ && p.z < airlock.maxZ;
      // Inside the shell is only allowed through the hatch: in its width.
      if (inside && Math.abs(p.x - airlock.door.x) > airlock.door.halfWidth + 0.35) throughWall++;
    }
    expect(throughWall).toBe(0);
    expect(rig.controller.fail).toHaveBeenCalled();   // it still got in
  });
});

describe('the bite, on the instant', () => {
  it('leadingSilence: how long a clip is quiet before it starts', () => {
    const rate = 1000;
    const data = new Float32Array(1000);
    for (let i = 300; i < 1000; i++) data[i] = Math.sin(i) * 0.5;
    expect(leadingSilence([data], rate)).toBeCloseTo(0.3, 2);
    expect(leadingSilence([new Float32Array(10)], rate)).toBe(0);   // all silence: play from the start
  });
});

describe('DustEyes — the generator draws them', () => {
  it('a coin toss: switching the generator in a storm may set an eye on the player', () => {
    expect(DUST_EYES.generatorChance).toBe(0.5);
    const rig = makeRig({ random: () => 0.999 });
    rig.system.summon('fence');
    run(rig.system, 0.1);
    const eye = rig.system.active[0];
    rig.system.random = () => 0.3;
    expect(rig.system.generatorNoise()).toBe(true);
    expect(eye.mode).toBe('growl');
    expect(eye.growlFor).toBe(DUST_EYES.passiveGrowlSeconds);
  });

  it('with none out there, one comes — already turned', () => {
    const rig = makeRig({ random: () => 0.3 });
    expect(rig.system.generatorNoise()).toBe(true);
    const turned = rig.system.active.filter(s => s.mode !== 'passive');
    expect(turned).toHaveLength(1);
    expect(turned[0].kind).toBe('fence');
  });

  it('the other half of the time, nothing', () => {
    const rig = makeRig({ random: () => 0.6 });
    expect(rig.system.generatorNoise()).toBe(false);
    expect(rig.system.active).toHaveLength(0);
  });

  it('nothing without a storm, before night 2, or with one already after the player', () => {
    const calm = makeRig({ random: () => 0 });
    calm.sandstorm.level = 0;
    expect(calm.system.generatorNoise()).toBe(false);
    const early = makeRig({ night: 1, random: () => 0 });
    expect(early.system.generatorNoise()).toBe(false);
    const busy = makeRig({ random: () => 0 });
    busy.system.generatorNoise();
    expect(busy.system.generatorNoise()).toBe(false);   // one is already coming
  });
});
