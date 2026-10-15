import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Ragno } from './Ragno.js';
import { approachRoute, climbRoute, NavGraph } from './RagnoPaths.js';
import { RagnoFigure } from '../gameobjects/RagnoFigure.js';
import { GameObject } from '../core/GameObject.js';

// ─────────────────────────────────────────────
// The Ragno component with everything round it stood in: a controller, a
// clock, a camera monitor, the player's eye. The base's numbers as in
// RagnoLogic.test.js.
// ─────────────────────────────────────────────

const WIN = { x0: -4.25, x1: 4.25, z: -4.9, sill: 0.475, top: 2.825 };
const PATHS = {
  window: WIN, eye: { x: 0, y: 1.24, z: -1.3 }, slope: { batter: 1.5, shoulder: 0.15, height: 3.1 },
  fence: { minX: -16.5, maxX: 16.5, minZ: 4.1, maxZ: 22 }, ground: () => 0,
};

function makeLayout() {
  const graph = new NavGraph([
    { id: 'qL', x: -15.4, z: 2.2 }, { id: 'qW', x: -13.8, z: 2.2 }, { id: 'qD', x: -10.1, z: 3.5, door: true },
    { id: 'oC', x: 0, z: 1 }, { id: 'sD', x: 10.1, z: 3.5, door: true }, { id: 'sW', x: 14.4, z: 3.5 }, { id: 'sL', x: 15.4, z: 3.7 },
  ], [['qL', 'qW'], ['qW', 'qD'], ['qD', 'oC'], ['oC', 'sD'], ['sD', 'sW'], ['sW', 'sL']]);
  const sides = {};
  for (const sign of [-1, 1]) {
    const side = { sign, endX: 16.3 * sign, back: -3.1, front: 5.1, vent: { z: sign < 0 ? 2.2 : 3.7, y: 1.8 } };
    sides[sign] = {
      ...side,
      approach: { window: approachRoute('window', side, PATHS), yard: approachRoute('yard', side, PATHS) },
      climb: climbRoute(side, PATHS),
      descent: [
        { x: 16.05 * sign, y: 1.9, z: side.vent.z, up: [-sign, 0, 0] },
        { x: 16.05 * sign, y: 0.7, z: side.vent.z, up: [-sign, 0, 0] },
        { x: 15.4 * sign, y: 0, z: side.vent.z, up: [0, 1, 0] },
      ],
      landing: sign < 0 ? 'qL' : 'sL', stare: sign < 0 ? 'qW' : 'sW',
      door: { x: 10.1 * sign, z: 3.5 },
      room: sign < 0 ? 'LivingQuarters' : 'ServerRoom',
      corridor: sign < 0 ? 'OfficeToQuarters' : 'OfficeToServer',
    };
  }
  return {
    sides, graph, airlockDoor: { x: 2, z: 5.1 }, window: WIN, occluders: [],
    vents: {
      [-1]: { room: 'LivingQuarters', intake: new THREE.Vector3(-16.9, 2.2, 2.2), grille: new THREE.Vector3(-16.05, 2.2, 2.2) },
      [1]: { room: 'ServerRoom', intake: new THREE.Vector3(16.9, 2.2, 3.7), grille: new THREE.Vector3(16.05, 2.2, 3.7) },
    },
  };
}

/** Rooms by x, as the base lays them out. */
function zoneOf(p) {
  if (p.z < -5.1 || p.z > 5.1) return 'outside';
  if (p.x < -16.3 || p.x > 16.3) return 'outside';
  if (p.x < -10.1) return 'LivingQuarters';
  if (p.x < -6.1) return 'OfficeToQuarters';
  if (p.x <= 6.1) return 'MainOffice';
  if (p.x <= 10.1) return 'OfficeToServer';
  return 'ServerRoom';
}

function makeController(night = 2) {
  const starts = [], states = [];
  return {
    state: 'playing', nightNumber: night,
    onNightStart: fn => { starts.push(fn); return () => {}; },
    onStateChange: fn => { states.push(fn); return () => {}; },
    fail: vi.fn(function fail() { this.state = 'gameOver'; }),
    startNight(n, retry = false) { this.state = 'playing'; this.nightNumber = n; starts.forEach(f => f(n, { retry })); },
    setState(s) { this.state = s; states.forEach(f => f(s)); },
  };
}

/** A lens at `pos` looking at `at`, as a SecurityCamera has one. */
function fakeCamera(pos, at, reach = 25) {
  const lens = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 200);
  lens.position.copy(pos);
  lens.lookAt(at);
  lens.updateMatrixWorld(true);
  return { lens, flashReach: reach, zones: ['yard'] };
}

function seeded(seed = 3) {
  let a = seed * 0x9e3779b9;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Ragno', () => {
  let controller, clock, figure, ragno, terminal, hooks, eye, whiteOut, redOut, power;

  function build(night = 2, opts = {}) {
    controller = makeController(night);
    clock = { currentTime: -6 };
    figure = new RagnoFigure({ model: null });
    terminal = { onAir: null, interfere: vi.fn(() => true), exit: vi.fn() };
    eye = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
    eye.position.set(0, 1.24, -1.3);
    eye.lookAt(0, 1.24, -10);
    eye.updateMatrixWorld(true);
    hooks = {
      zoneOf, ufoBusy: vi.fn(() => false), setPlayerLocked: vi.fn(), isFrozen: () => false,
      rayHit: () => Infinity,
    };
    whiteOut = { play: vi.fn() };
    redOut = { setIntensity: vi.fn(), clear: vi.fn() };
    power = { on: true };
    ragno = new Ragno({
      controller, clock, layout: makeLayout(), figure, terminal, cameras: [], flashlight: null, power,
      camera: eye, hooks, whiteOut, redOut, rand: seeded(opts.seed ?? 3), sounds: opts.sounds ?? {},
    });
    const host = new GameObject('GameplaySystems');
    host.addComponent(ragno);
    ragno.onStart();
  }

  function run(seconds, dt = 1 / 30, each) {
    for (let t = 0; t < seconds; t += dt) {
      ragno.onUpdate(dt);
      each?.();
    }
  }

  beforeEach(() => build());

  describe('when he comes', () => {
    it('schedules tonight\'s visits as the night starts', () => {
      expect(ragno.visits.length).toBeGreaterThanOrEqual(1);
      expect(ragno.visits.length).toBeLessThanOrEqual(2);
    });

    it('nobody before the first visit\'s hour; then he is out, shown', () => {
      const hour = ragno.visits[0].hour;
      clock.currentTime = hour - 0.1;
      run(0.1);
      expect(ragno.logic.active).toBe(false);
      expect(figure.object3d.visible).toBe(false);
      clock.currentTime = hour;
      run(0.1);
      expect(ragno.logic.active).toBe(true);
      expect(figure.object3d.visible).toBe(true);
    });

    it('waits while the UFO is over the base', () => {
      hooks.ufoBusy.mockReturnValue(true);
      clock.currentTime = 6;
      run(0.5);
      expect(ragno.logic.active).toBe(false);
      hooks.ufoBusy.mockReturnValue(false);
      run(0.1);
      expect(ragno.logic.active).toBe(true);
    });

    it('night 1: once, at midnight, calm', () => {
      build(1);
      expect(ragno.visits).toHaveLength(1);
      expect(ragno.visits[0].hour).toBe(0);
      clock.currentTime = 0;
      run(0.1);
      expect(ragno.logic.mood).toBe('calm');
    });

    it('a new night (or a retry) sends him away and schedules again', () => {
      clock.currentTime = 6;
      run(0.1);
      expect(ragno.logic.active).toBe(true);
      controller.startNight(3);
      expect(ragno.logic.active).toBe(false);
      expect(figure.object3d.visible).toBe(false);
      expect(ragno.visits.length).toBeGreaterThanOrEqual(2);
    });

    it('the shift ending sends him away', () => {
      clock.currentTime = 6;
      run(0.1);
      controller.setState('morning');
      expect(ragno.logic.active).toBe(false);
    });

    it('another threat ending the night takes him off the screen too', () => {
      clock.currentTime = 6;
      run(0.1);
      controller.setState('gameOver');
      expect(ragno.logic.active).toBe(false);
      expect(figure.object3d.visible).toBe(false);
    });

    it('summon() brings a night-3 Ragno at once, the way asked; not while one is out', () => {
      expect(ragno.summon({ approach: 'yard', side: 1 })).toBe(true);
      expect(ragno.logic.mood).toBe('aggressive');
      expect(ragno.logic.side).toBe(1);
      expect(ragno.logic.approach).toBe('yard');
      expect(ragno.summon()).toBe(false);
    });

    it('summon() does nothing off shift', () => {
      controller.state = 'morning';
      expect(ragno.summon()).toBe(false);
    });
  });

  describe('the cameras', () => {
    it('a lit flash on him, on a live picture, makes him flinch', () => {
      ragno.summon({ approach: 'yard', side: 1 });
      run(0.5);
      const at = figure.bodyPosition(new THREE.Vector3());
      const cam = fakeCamera(at.clone().add(new THREE.Vector3(4, 2, 0)), at);
      terminal.onAir = { index: 0, camera: cam, live: true, flash: true };
      run(1 / 30);
      expect(['flinch', 'retreat']).toContain(ragno.logic.state);
    });

    it('not with the flash off, nor on a picture still switching', () => {
      ragno.summon({ approach: 'yard', side: 1 });
      run(0.5);
      const at = figure.bodyPosition(new THREE.Vector3());
      const cam = fakeCamera(at.clone().add(new THREE.Vector3(4, 2, 0)), at);
      terminal.onAir = { index: 0, camera: cam, live: true, flash: false };
      run(0.2);
      terminal.onAir = { index: 0, camera: cam, live: false, flash: true };
      run(0.2);
      expect(ragno.logic.state).not.toBe('flinch');
      expect(ragno.logic.state).not.toBe('retreat');
    });

    it('reaching the vent in front of the camera on screen breaks it up', () => {
      ragno.summon({ approach: 'yard', side: 1 });
      const intake = makeLayout().vents[1].intake;
      const cam = fakeCamera(new THREE.Vector3(17.5, 3.4, -2.3), intake);
      terminal.onAir = { index: 6, camera: cam, live: true, flash: false };
      for (let t = 0; t < 300 && ragno.logic.state !== 'duct'; t += 1 / 30) ragno.onUpdate(1 / 30);
      expect(ragno.logic.state).toBe('duct');
      expect(terminal.interfere).toHaveBeenCalledWith(6, expect.any(Number));
    });
  });

  describe('static in his room', () => {
    /** A camera inside the server room (x > 10.1), on screen. */
    const roomCamera = () => fakeCamera(new THREE.Vector3(13, 2.7, -2.8), new THREE.Vector3(13, 0, 2));

    it('going into the vent breaks up the camera of the room he is headed for', () => {
      ragno.summon({ approach: 'yard', side: 1 });
      terminal.onAir = { index: 1, camera: roomCamera(), live: true, flash: false };
      for (let t = 0; t < 600 && ragno.logic.state !== 'duct'; t += 1 / 30) ragno.onUpdate(1 / 30);
      expect(terminal.interfere).toHaveBeenCalledWith(1, expect.any(Number));
    });

    it('coming out of the grille breaks it up again', () => {
      ragno.summon({ approach: 'yard', side: 1 });
      for (let t = 0; t < 600 && ragno.logic.state !== 'duct'; t += 1 / 30) ragno.onUpdate(1 / 30);
      terminal.onAir = { index: 1, camera: roomCamera(), live: true, flash: false };
      terminal.interfere.mockClear();
      for (let t = 0; t < 60 && ragno.logic.state === 'duct'; t += 1 / 30) ragno.onUpdate(1 / 30);
      expect(terminal.interfere).toHaveBeenCalledWith(1, expect.any(Number));
    });

    it('a camera in another room stays clear', () => {
      ragno.summon({ approach: 'yard', side: 1 });
      const other = fakeCamera(new THREE.Vector3(-13, 2.7, -2.8), new THREE.Vector3(-13, 0, 2));
      terminal.onAir = { index: 0, camera: other, live: true, flash: false };
      for (let t = 0; t < 600 && ragno.logic.state !== 'watch'; t += 1 / 30) ragno.onUpdate(1 / 30);
      expect(terminal.interfere).not.toHaveBeenCalled();
    });
  });

  it('a wall a step short of the player is a wall: he does not walk through it to them', () => {
    // Every ray stops 0.4 m short of where it was going.
    hooks.rayHit = (_from, _dir, max) => max - 0.4;
    expect(ragno._walkable(new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 0, 0))).toBe(false);
    hooks.rayHit = () => Infinity;
    expect(ragno._walkable(new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 0, 0))).toBe(true);
  });

  it('outside, a rare shriek is one of the attacks pitched down, or a loud burst of the call', () => {
    const shriek = () => ({ isPlaying: false, context: { state: 'running' }, play: vi.fn(), stop: vi.fn(),
      setVolume: vi.fn(), setDetune: vi.fn(), setRefDistance: vi.fn(), setRolloffFactor: vi.fn() });
    const attacks = [shriek(), shriek()];
    build(2, { sounds: { attacks, call: null } });
    ragno.summon({ approach: 'yard', side: 1 });
    for (let i = 0; i < 20; i++) ragno._chirp(true);
    const played = attacks.filter(a => a.play.mock.calls.length > 0);
    expect(played.length).toBe(2);
    for (const a of played) expect(a.setDetune).toHaveBeenCalledWith(expect.any(Number));
    expect(attacks[0].setDetune.mock.calls[0][0]).toBeLessThan(0);
  });

  describe('the player outside', () => {
    it('in their sight (nothing between), he bolts off to the side', () => {
      ragno.summon({ approach: 'yard', side: 1 });
      run(5);
      // Out of the airlock, in the yard, looking anywhere.
      eye.position.set(10, 1.6, 9);
      eye.updateMatrixWorld(true);
      run(1 / 30);
      expect(ragno.logic.state).toBe('evade');
    });

    it('not with the building between them', () => {
      ragno.summon({ approach: 'yard', side: 1 });
      run(5);
      ragno.layout.occluders = [new THREE.Box3(new THREE.Vector3(-30, 0, 9.5), new THREE.Vector3(30, 5, 10.5))];
      eye.position.set(10, 1.6, 9);
      eye.updateMatrixWorld(true);
      run(1 / 30);
      expect(ragno.logic.state).not.toBe('evade');
    });

    it('not from indoors', () => {
      ragno.summon({ approach: 'yard', side: 1 });
      run(5);
      run(1 / 30);
      expect(ragno.logic.state).not.toBe('evade');
    });
  });

  it('a camera near the vent breaks up as he goes in, even with the vent out of its frame', () => {
    ragno.summon({ approach: 'yard', side: 1 });
    const intake = makeLayout().vents[1].intake;
    // On the end wall above the vent, looking straight out: the vent is below, out of frame.
    const cam = fakeCamera(new THREE.Vector3(16.7, 3.4, 1), new THREE.Vector3(30, 3.4, 1));
    terminal.onAir = { index: 2, camera: cam, live: true, flash: false };
    for (let t = 0; t < 600 && ragno.logic.state !== 'duct'; t += 1 / 30) ragno.onUpdate(1 / 30);
    expect(ragno.logic.state).toBe('duct');
    expect(terminal.interfere).toHaveBeenCalledWith(2, expect.any(Number));
    void intake;
  });

  describe('the kill', () => {
    it('catching the player locks them, lunges, then fails the night with the death screen', () => {
      ragno.summon({ approach: 'yard', side: -1 });
      ragno.logic.state = 'chase';
      ragno.logic.indoors = true;
      ragno.logic.pos.set(-1, 0, -1.3);
      run(1 / 30);
      expect(hooks.setPlayerLocked).toHaveBeenCalledWith(true);
      expect(terminal.exit).toHaveBeenCalled();
      expect(controller.fail).not.toHaveBeenCalled();
      // The view drains to red through the lunge, and the screen comes quickly.
      run(0.3);
      expect(redOut.setIntensity).toHaveBeenCalled();
      expect(redOut.setIntensity.mock.calls.at(-1)[0]).toBe(1);
      expect(controller.fail).toHaveBeenCalled();
      expect(controller.fail.mock.calls[0][1].retryAfter).toBeLessThan(1);
      expect(whiteOut.play).toHaveBeenCalled();
      expect(figure.object3d.visible).toBe(false);
    });

    it('the retry gives the player back', () => {
      ragno.summon({ approach: 'yard', side: -1 });
      ragno.logic.state = 'chase';
      ragno.logic.indoors = true;
      ragno.logic.pos.set(-1, 0, -1.3);
      run(1);
      controller.startNight(2, true);
      expect(hooks.setPlayerLocked).toHaveBeenLastCalledWith(false);
      expect(redOut.clear).toHaveBeenCalled();
    });
  });

  it('hunting is true through the screech and the chase (it wakes a sleeper)', () => {
    ragno.summon({ approach: 'yard', side: -1 });
    expect(ragno.hunting).toBe(false);
    ragno.logic.state = 'chase';
    expect(ragno.hunting).toBe(true);
  });
});
