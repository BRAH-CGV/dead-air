import * as THREE from 'three';
import { describe, it, expect, vi } from 'vitest';
import {
  UfoThreat, loudestTime, scheduleApproach, ufoTimeline, approachDistance, pathPoint, skyAngles, spawnBearing, UFO,
} from './UfoThreat.js';
import { PowerGrid } from '../systems/PowerGrid.js';
import { terrainHeightAt } from '../gameobjects/MarsTerrain.js';
import { COMM_TOWERS } from '../gameobjects/CommTowers.js';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

// ─────────────────────────────────────────────
// UfoThreat — radar warning, flyover, judgement, teleport away
// ─────────────────────────────────────────────

describe('loudestTime', () => {
  it('finds the loudest second of a clip, smoothed over a window', () => {
    // 10 samples a second; a long loud stretch around 6 s and a one-sample
    // click at 2 s that must not win.
    const values = new Float32Array(100);
    values[20] = 1;
    for (let i = 50; i < 70; i++) values[i] = 0.8;
    expect(loudestTime({ rate: 10, values })).toBeCloseTo(6, 0);
  });

  it('falls back when there is no envelope', () => {
    expect(loudestTime(null, 23)).toBe(23);
  });
});

describe('ufoTimeline', () => {
  it('starts the sound after the radar lead, arrives on its loudest moment, then widens and holds', () => {
    const t = ufoTimeline({ radarLead: 20, soundArrival: 23, expandSeconds: 1.5, hoverSeconds: 5 });
    expect(t.soundStart).toBe(20);
    expect(t.arrival).toBe(43);
    expect(t.lethal).toBe(44.5);
    expect(t.departure).toBe(49.5);
  });
});

describe('scheduleApproach', () => {
  it('comes only on its nights — night 3', () => {
    expect(UFO.nights).toEqual([3]);
    for (const night of [1, 2]) {
      expect(scheduleApproach({ night, nightDuration: 300, total: 50, random: () => 0.5 })).toBe(Infinity);
    }
  });

  it('comes at a random time on its night, always gone before 6 AM', () => {
    for (const night of [3])
    for (const r of [0, 0.5, 0.999]) {
      const start = scheduleApproach({ night, nightDuration: 300, total: 50, random: () => r });
      expect(start).toBeGreaterThan(0);
      expect(start + 50).toBeLessThan(300);
    }
    const early = scheduleApproach({ night: 3, nightDuration: 300, total: 50, random: () => 0 });
    const late  = scheduleApproach({ night: 3, nightDuration: 300, total: 50, random: () => 0.999 });
    expect(late).toBeGreaterThan(early);
  });
});

describe('spawnBearing', () => {
  it('sometimes puts it in the open sky of the window, either side of the dish, so you see it spawn', () => {
    for (const where of [0, 0.5, 0.99]) {
      let n = 0;
      const dice = [0.1, 0.3, where];   // under the chance: in view; a side; how far out
      const { bearing, inView } = spawnBearing(() => dice[n++]);
      expect(inView).toBe(true);
      // Never straight out of the window: the dish tower fills that view.
      expect(Math.abs(bearing)).toBeGreaterThanOrEqual(UFO.inViewFrom);
      expect(Math.abs(bearing)).toBeLessThanOrEqual(UFO.inViewTo);
    }
    // Both sides of the dish.
    let n = 0;
    const left = spawnBearing(() => [0.1, 0.3, 0.5][n++]).bearing;
    n = 0;
    const right = spawnBearing(() => [0.1, 0.7, 0.5][n++]).bearing;
    expect(Math.sign(left)).not.toBe(Math.sign(right));
  });

  it('otherwise somewhere around the valley the window cannot see', () => {
    for (const r of [0.5, 0.75, 0.99]) {
      let n = 0;
      const dice = [r, 0.3, 0.8];   // chance roll, then where round the valley
      const { bearing, inView } = spawnBearing(() => dice[n++ % dice.length]);
      expect(inView).toBe(false);
      expect(Math.abs(bearing)).toBeGreaterThanOrEqual(UFO.outOfViewFrom);
      expect(Math.abs(bearing)).toBeLessThanOrEqual(Math.PI);
    }
  });

  it('in view about as often as the chance says', () => {
    let seed = 1;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    let seen = 0;
    for (let i = 0; i < 2000; i++) if (spawnBearing(random).inView) seen++;
    expect(seen / 2000).toBeCloseTo(UFO.inViewChance, 1);
  });
});

describe('the approach path', () => {
  const tl = ufoTimeline({ soundArrival: 23 });
  const start = new THREE.Vector3(1200, 600, -3800);
  const hover = new THREE.Vector3(0, 35, 0);
  const total = start.distanceTo(hover);

  it('runs from far off to directly over the office, closing all the way', () => {
    expect(approachDistance(0, tl, total)).toBeCloseTo(total);
    expect(approachDistance(tl.soundStart, tl, total)).toBeCloseTo(UFO.visibleDistance);
    expect(approachDistance(tl.arrival, tl, total)).toBeCloseTo(0);
    let prev = Infinity;
    for (let t = 0; t <= tl.arrival; t += 0.5) {
      const d = approachDistance(t, tl, total);
      expect(d).toBeLessThanOrEqual(prev + 1e-9);
      prev = d;
    }
  });

  it('slows down once it is in the sky, so the last stretch is a crawl', () => {
    const speed = (t) => approachDistance(t, tl, total) - approachDistance(t + 0.5, tl, total);
    expect(speed(tl.soundStart + 1)).toBeGreaterThan(speed(tl.arrival - 2) * 5);
  });

  it('clears the valley ridge and the tallest mast from any bearing, all the way round', () => {
    const hoverPt = new THREE.Vector3(0, 35, 0);
    const out = new THREE.Vector3();
    for (let b = -Math.PI; b < Math.PI; b += Math.PI / 24) {
      const from = new THREE.Vector3(Math.sin(b) * UFO.startDistance, UFO.startAltitude, -Math.cos(b) * UFO.startDistance);
      const length = from.distanceTo(hoverPt);
      for (let d = 60; d <= length; d += 10) {
        pathPoint(d, from, hoverPt, out);
        if (Math.hypot(out.x, out.z) < 150) continue;   // the base itself: see the next test
        const clearance = out.y - terrainHeightAt(out.x, out.z);
        expect(clearance).toBeGreaterThan(COMM_TOWERS.height[1] + 5);
      }
    }
  });

  it('never flies lower than its hover height — clear of the dish and the trees', () => {
    const out = new THREE.Vector3();
    for (let t = 0; t <= tl.arrival; t += 0.25) {
      pathPoint(approachDistance(t, tl, total), start, hover, out);
      expect(out.y).toBeGreaterThanOrEqual(hover.y - 1e-6);
    }
    expect(pathPoint(0, start, hover, out).distanceTo(hover)).toBeLessThan(1e-6);
  });
});

describe('skyAngles', () => {
  it('uses the radar convention: yaw 0 out of the window (−Z), pitch negative up', () => {
    const a = skyAngles(new THREE.Vector3(0, 1, -1));
    expect(a.yaw).toBeCloseTo(0);
    expect(a.pitch).toBeCloseTo(-Math.PI / 4);
    expect(skyAngles(new THREE.Vector3(1, 0, 0)).yaw).toBeCloseTo(Math.PI / 2);
  });
});

// ── The component ──────────────────────────────────────────

function makeSound() {
  return {
    isPlaying: false,
    volume: 1,
    play: vi.fn(function () { this.isPlaying = true; }),
    stop: vi.fn(function () { this.isPlaying = false; }),
    setVolume: vi.fn(function (v) { this.volume = v; }),
    setLoop: vi.fn(),
  };
}

/** `summon`: start the visit at once (the U key), so timings below count
 *  from zero; off, it waits for the night's random time. */
function makeRig({ outside = false, exposed = false, summon = true, night = 3 } = {}) {
  const listeners = new Set();
  const controller = {
    state: 'playing',
    nightNumber: night,
    fail: vi.fn(function () { this.state = 'gameOver'; }),
    onNightStart: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    _start(n) { this.state = 'playing'; this.nightNumber = n; for (const fn of listeners) fn(n); },
  };
  const grid = new PowerGrid({ random: () => 0.5 });
  const ufo = {
    visible: false, beam: 0, radius: 0, position: new THREE.Vector3(),
    setPose: vi.fn(function (p) { this.position.copy(p); }),
    setVisible: vi.fn(function (v) { this.visible = v; }),
    setBeam: vi.fn(function (b, r) { this.beam = b; if (r !== undefined) this.radius = r; }),
    tick: vi.fn(),
    teleport: vi.fn(),
  };
  const flood = { light: { intensity: 0 }, intensity: 200 };
  const sounds = Object.fromEntries(
    ['flight', 'flicker', 'bulbBreak', 'powerDown', 'whoosh', 'ringing'].map(k => [k, makeSound()]),
  );
  const signalLight = { frantic: false };
  const radar = { threat: null };
  const terminal = { exit: vi.fn() };
  const whiteOut = { play: vi.fn(), clear: vi.fn() };
  const hooks = {
    eyePosition: (out) => out.set(0, 1.24, 0),
    isOutside: vi.fn(() => outside),
    exposedToBeam: vi.fn(() => exposed),
    setPlayerLocked: vi.fn(),
  };
  const threat = new UfoThreat({
    controller, grid, ufo, sounds, signalLight, radar, terminal, whiteOut, hooks, flood,
    nightDuration: 300, random: () => 0.3, soundArrival: 23,
  });
  threat.onStart();
  if (summon) threat.summon();
  return { threat, controller, grid, ufo, flood, sounds, signalLight, radar, terminal, whiteOut, hooks };
}

/** Run the threat forward `seconds` in 0.1 s steps. */
function run(threat, seconds, step = 0.1) {
  for (let t = 0; t < seconds - 1e-9; t += step) threat.onUpdate(step);
}

const timeline = ufoTimeline({ soundArrival: 23 });
/** Summoned: the visit starts on the first frame. */
const LEAD = 0;
const toArrival = LEAD + timeline.arrival;
/** When the widened beam turns lethal. */
const toLethal = LEAD + timeline.lethal;
const HOVER = new THREE.Vector3(0, 35, 0);

describe('UfoThreat', () => {
  it('waits for its random time in the night, then shows up on the radar', () => {
    const { threat, radar, signalLight } = makeRig({ summon: false });
    expect(threat._start).toBeGreaterThan(20);
    run(threat, threat._start - 1);
    expect(threat.phase).toBe('waiting');
    expect(radar.threat?.active ?? false).toBe(false);

    run(threat, 1.5);
    expect(threat.phase).toBe('approaching');
    expect(radar.threat.active).toBe(true);
    expect(signalLight.frantic).toBe(true);
  });

  it('never comes on a night that is not one of its nights', () => {
    const { threat, radar } = makeRig({ summon: false, night: 1 });
    run(threat, 290, 0.5);
    expect(threat.phase).toBe('waiting');
    expect(radar.threat?.active ?? false).toBe(false);
  });

  it('the U key still summons it on any night, for testing', () => {
    const { threat } = makeRig({ summon: false, night: 1 });
    expect(threat.summon()).toBe(true);
    run(threat, 0.2);
    expect(threat.phase).toBe('approaching');
  });

  it('bursts into the sky when it appears — once, as its sound starts', () => {
    const { threat, ufo } = makeRig();
    ufo.appear = vi.fn();
    run(threat, UFO.radarLead - 0.5);
    expect(ufo.appear).not.toHaveBeenCalled();
    run(threat, 2);
    expect(ufo.appear).toHaveBeenCalledTimes(1);
    run(threat, 5);
    expect(ufo.appear).toHaveBeenCalledTimes(1);
  });

  it('summon() (the U key) starts a visit now, instead of at its random time', () => {
    const { threat } = makeRig({ summon: false });
    run(threat, 1);
    expect(threat.summon()).toBe(true);
    run(threat, 0.2);
    expect(threat.phase).toBe('approaching');
  });

  it('summon() is ignored mid-visit, but brings it back once it has gone (for testing)', () => {
    const { threat, sounds } = makeRig();
    run(threat, 5);
    expect(threat.summon()).toBe(false);
    run(threat, toLethal + UFO.hoverSeconds);
    expect(threat.phase).toBe('gone');
    expect(threat.summon()).toBe(true);
    run(threat, 0.2);
    expect(threat.phase).toBe('approaching');
    run(threat, UFO.radarLead + 1);
    expect(sounds.flight.play).toHaveBeenCalledTimes(2);
  });

  it('summon() is ignored outside a shift in progress', () => {
    const { threat, controller } = makeRig({ summon: false });
    controller.state = 'morning';
    expect(threat.summon()).toBe(false);
  });

  it('starts the flight sound after the radar lead', () => {
    const { threat, sounds } = makeRig();
    run(threat, LEAD + UFO.radarLead - 0.5);
    expect(sounds.flight.play).not.toHaveBeenCalled();
    run(threat, 1);
    expect(sounds.flight.play).toHaveBeenCalledTimes(1);
  });

  it('keeps in step with the flight sound — and never stalls when the audio clock lags', () => {
    const { threat, sounds } = makeRig();
    const ctx = { state: 'running', currentTime: 100 };
    sounds.flight.context = ctx;
    run(threat, LEAD + UFO.radarLead + 0.05);   // sound starts at audio time 100
    const t0 = threat._t;

    // Frames run 0.1 s while the audio clock says 0.15 s: small drift is
    // corrected onto the sound.
    ctx.currentTime += 0.15;
    threat.onUpdate(0.1);
    expect(threat._t).toBeCloseTo(UFO.radarLead + (ctx.currentTime - 100), 5);

    // The audio clock stops dead: time slows while it is near, then runs
    // free — it never stops.
    let before = threat._t;
    threat.onUpdate(0.1);
    expect(threat._t).toBeGreaterThan(before);
    before = threat._t;
    for (let i = 0; i < 30; i++) threat.onUpdate(0.1);
    expect(threat._t).toBeGreaterThan(before + 2);
    expect(t0).toBeGreaterThan(0);
  });

  it('the blob on the radar grows as it closes in', () => {
    const { threat, radar } = makeRig();
    run(threat, LEAD + 2);
    const early = radar.threat.size;
    run(threat, timeline.arrival - 5);
    expect(radar.threat.size).toBeGreaterThan(early);
  });

  it('surges the lights as it gets close, and only then', () => {
    const { threat, grid } = makeRig();
    run(threat, LEAD + 2);
    expect(grid.surge).toBe(0);
    run(threat, timeline.arrival - 4);
    expect(grid.surge).toBeGreaterThan(0.5);
  });

  it('appears in the sky — searchlight on, a thin shaft — the moment its sound starts', () => {
    const { threat, ufo } = makeRig();
    run(threat, LEAD + UFO.radarLead - 0.5);
    expect(ufo.visible).toBe(false);
    expect(ufo.beam).toBe(0);
    run(threat, 1);
    expect(ufo.visible).toBe(true);
    expect(ufo.beam).toBe(1);
    expect(ufo.radius).toBe(UFO.thinRadius);
    expect(ufo.position.distanceTo(HOVER)).toBeGreaterThan(300);   // still far off
  });

  it('stops directly over the office and widens its beam over the whole facility', () => {
    const { threat, ufo, flood } = makeRig();
    run(threat, toArrival + 0.1);
    expect(threat.phase).toBe('expanding');
    expect(ufo.position.distanceTo(HOVER)).toBeLessThan(1e-6);
    expect(ufo.radius).toBeLessThan(UFO.coverRadius);
    expect(flood.light.intensity).toBeLessThan(flood.intensity);
    run(threat, UFO.expandSeconds);
    expect(threat.phase).toBe('lethal');
    expect(ufo.radius).toBe(UFO.coverRadius);
    expect(flood.light.intensity).toBe(flood.intensity);   // pouring in through the window
  });

  it('is harmless while the shaft is still thin', () => {
    const { threat, controller, grid } = makeRig({ outside: true, exposed: true });
    run(threat, toArrival + 0.5);
    expect(controller.fail).not.toHaveBeenCalled();
    expect(grid.broken).toBe(false);
  });

  it('arriving with the power on blows the lights and trips the generator', () => {
    const { threat, grid, sounds } = makeRig();
    run(threat, toLethal + 0.2);
    expect(threat.phase).toBe('lethal');
    expect(grid.broken).toBe(true);
    expect(grid.on).toBe(false);
    expect(grid.surge).toBe(0);
    expect(sounds.bulbBreak.play).toHaveBeenCalled();
    expect(sounds.powerDown.play).toHaveBeenCalled();
  });

  it('arriving with the power already cut leaves the bulbs whole', () => {
    const { threat, grid, sounds } = makeRig();
    grid.setOn(false);
    run(threat, toLethal + 0.2);
    expect(grid.broken).toBe(false);
    expect(sounds.bulbBreak.play).not.toHaveBeenCalled();
  });

  it('catches a player in view of the window while the lights are on', () => {
    const { threat, controller, whiteOut, sounds, hooks } = makeRig({ exposed: true });
    run(threat, toLethal + 0.2);
    expect(threat.phase).toBe('caught');
    expect(controller.fail).toHaveBeenCalled();
    expect(whiteOut.play).toHaveBeenCalledWith(expect.stringMatching(/\[E\] to retry/));
    expect(sounds.ringing.play).toHaveBeenCalled();
    expect(hooks.setPlayerLocked).toHaveBeenCalledWith(true);
  });

  it('keeps the beam blazing as the screen whites out', () => {
    const { threat, ufo } = makeRig({ exposed: true });
    run(threat, toLethal + 0.6);
    expect(threat.phase).toBe('caught');
    expect(ufo.beam).toBeGreaterThan(0);
    expect(ufo.visible).toBe(true);
  });

  it('spares a player in view of the window when the power was cut in advance', () => {
    const { threat, grid, controller } = makeRig({ exposed: true });
    grid.setOn(false);
    run(threat, toLethal + UFO.hoverSeconds + 2);
    expect(controller.fail).not.toHaveBeenCalled();
  });

  it('spares a hidden player even with the lights on (who loses the bulbs instead)', () => {
    const { threat, controller, grid } = makeRig({ exposed: false });
    run(threat, toLethal + UFO.hoverSeconds + 2);
    expect(controller.fail).not.toHaveBeenCalled();
    expect(grid.broken).toBe(true);
  });

  it('caught with the power on, the exposed rooms stay deadly all visit — walking in after the bulbs blew still kills', () => {
    const rig = makeRig({ exposed: false });
    run(rig.threat, toLethal + 0.5);
    expect(rig.grid.broken).toBe(true);           // the bulbs went…
    expect(rig.controller.fail).not.toHaveBeenCalled();
    rig.hooks.exposedToBeam.mockReturnValue(true); // …then in from the hallway
    run(rig.threat, 0.2);
    expect(rig.controller.fail).toHaveBeenCalled();
  });

  it('power cut in advance, the exposed rooms stay safe all visit', () => {
    const rig = makeRig({ exposed: false });
    rig.grid.setOn(false);
    run(rig.threat, toLethal + 0.5);
    rig.hooks.exposedToBeam.mockReturnValue(true);
    run(rig.threat, UFO.hoverSeconds);
    expect(rig.controller.fail).not.toHaveBeenCalled();
  });

    it('catches anyone outside while it hovers, power or not', () => {
    const rig = makeRig({ outside: false });
    rig.grid.setOn(false);
    run(rig.threat, toLethal + 1);
    expect(rig.controller.fail).not.toHaveBeenCalled();
    rig.hooks.isOutside.mockReturnValue(true);
    run(rig.threat, 0.2);
    expect(rig.controller.fail).toHaveBeenCalled();
  });

  it('teleports away after hovering a few seconds, and everything calms down', () => {
    const { threat, ufo, sounds, signalLight, radar } = makeRig();
    run(threat, toLethal + UFO.hoverSeconds + 2);
    expect(threat.phase).toBe('gone');
    expect(sounds.whoosh.play).toHaveBeenCalledTimes(1);
    expect(ufo.visible).toBe(false);
    expect(signalLight.frantic).toBe(false);
    expect(radar.threat.active).toBe(false);
  });

  it('comes once a night', () => {
    const { threat, sounds } = makeRig();
    run(threat, toLethal + UFO.hoverSeconds + 60);
    expect(sounds.whoosh.play).toHaveBeenCalledTimes(1);
  });

  it('a new night (or a retry) clears the white-out, unlocks the player, fixes the power and comes again', () => {
    const rig = makeRig({ exposed: true });
    run(rig.threat, toLethal + 0.2);
    expect(rig.threat.phase).toBe('caught');

    rig.controller._start(1);
    expect(rig.threat.phase).toBe('waiting');
    expect(rig.whiteOut.clear).toHaveBeenCalled();
    expect(rig.hooks.setPlayerLocked).toHaveBeenLastCalledWith(false);
    expect(rig.grid.broken).toBe(false);
    expect(rig.grid.on).toBe(true);
    expect(rig.sounds.ringing.stop).toHaveBeenCalled();
  });

  it('stands down if the shift ends mid-approach', () => {
    const { threat, controller, grid, signalLight } = makeRig();
    run(threat, toArrival - 3);
    controller.state = 'morning';
    run(threat, 0.2);
    expect(threat.phase).toBe('gone');
    expect(grid.surge).toBe(0);
    expect(signalLight.frantic).toBe(false);
  });
});
