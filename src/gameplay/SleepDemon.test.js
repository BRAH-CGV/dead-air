import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

// sightRay only needs Ray construction and a world.castRay it can call.
vi.mock('@dimforge/rapier3d', () => ({
  default: {
    Ray: class Ray {
      constructor(origin, dir) { this.origin = origin; this.dir = dir; }
    },
    QueryFilterFlags: { EXCLUDE_SENSORS: 8 },   // Rapier's own bit
  },
}));

import { GameObject } from '../core/GameObject.js';
import { terrainHeightAt } from '../gameobjects/MarsTerrain.js';
import { Stamina } from './Stamina.js';
import { SleepDemon, SLEEP_DEMON_KILL, SLEEP_DEMON_FIGURE, SLEEP_DEMON_BEAM, sightRay } from './SleepDemon.js';
import { SLEEP_DEMON as T } from './SleepDemonLogic.js';

const EYE = 1.24;
const DEG = Math.PI / 180;
/** Half the width of the view every test uses: 75° tall, 16:9. */
const HALF_WIDTH = Math.atan(Math.tan(37.5 * DEG) * 16 / 9);

/** A controller that announces nights the way GameController does. */
function fakeController() {
  const listeners = new Set();
  return {
    state: 'playing',
    nightNumber: 1,
    fail: vi.fn(),
    onNightStart: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    startNight(night, opts = {}) {
      this.state = 'playing';
      this.nightNumber = night;
      for (const fn of listeners) fn(night, opts);
    },
    listeners,
  };
}

function fakeSound() {
  return {
    isPlaying: false, volume: 1,
    play: vi.fn(function () { this.isPlaying = true; }),
    stop: vi.fn(function () { this.isPlaying = false; }),
    setVolume: vi.fn(function (v) { this.volume = v; }),
  };
}

describe('SleepDemon', () => {
  let camera, figure, stamina, controller, terminal, frozen, onFigureChanged, wall, rayHit, demon;

  const visible = () => figure.object3d.visible;

  function run(seconds, dt = 0.1) {
    for (let t = 0; t < seconds - 1e-9; t += dt) demon.onUpdate(dt);
  }

  function face(x, y, z) {
    camera.lookAt(x, y, z);
    camera.updateMatrixWorld(true);
  }

  /** The figure as the player sees it: metres away, level, and the angle
   *  off the centre of the view, + to the right. */
  function seen() {
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const ahead = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(ahead, new THREE.Vector3(0, 1, 0));
    const to = figure.object3d.position.clone().sub(eye).setY(0);
    const distance = to.length();
    to.normalize();
    return { distance, angle: Math.atan2(to.dot(right), to.dot(ahead)) };
  }

  beforeEach(() => {
    camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    camera.position.set(0, EYE, 0);
    face(0, EYE, -10);
    figure = new GameObject('SleepDemon');
    figure.object3d.visible = false;
    stamina = new Stamina();
    controller = fakeController();
    terminal = { state: 'idle' };
    frozen = false;
    onFigureChanged = vi.fn();
    // A wall `wall` metres off, all round; the floor clear of furniture.
    wall = Infinity;
    rayHit = vi.fn((from, dir) => (dir.y < -0.5 ? Infinity : wall));
    demon = new SleepDemon({
      controller, stamina, figure, camera, terminal, rayHit, onFigureChanged,
      isFrozen: () => frozen,
      sounds: { breathing: fakeSound() },
      rand: () => 0.9,                      // the right-hand side first
    });
    demon.onStart();
  });

  it('stays hidden while the player is awake', () => {
    run(60);
    expect(visible()).toBe(false);
  });

  it('shows in the corner of the eye: at the edge of the view, where the rules said, on the floor, facing the player', () => {
    const asked = vi.spyOn(demon.logic, 'place');
    stamina.value = 0.8;
    run(7);
    expect(visible()).toBe(true);
    const [{ distance, edge, side }] = asked.mock.calls[0];
    const at = seen();
    expect(at.distance).toBeCloseTo(distance, 5);
    expect(at.angle).toBeCloseTo(side * edge * HALF_WIDTH, 5);
    expect(Math.abs(at.angle)).toBeGreaterThan(35 * DEG);
    expect(Math.abs(at.angle)).toBeLessThan(HALF_WIDTH);

    const feet = figure.object3d.position;
    expect(feet.y).toBeCloseTo(terrainHeightAt(feet.x, feet.z));
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(figure.object3d.quaternion);
    const toEye = new THREE.Vector3(-feet.x, 0, -feet.z).normalize();
    expect(facing.dot(toEye)).toBeGreaterThan(0.99);
  });

  it('looked at, it vanishes, and shows again at the other edge of the view', () => {
    stamina.value = 0.425;
    run(4);
    expect(visible()).toBe(true);
    expect(seen().angle).toBeGreaterThan(0);
    const at = figure.object3d.position;
    face(at.x, EYE, at.z);
    run(0.1);
    expect(visible()).toBe(false);

    run(3.4);
    expect(visible()).toBe(true);
    expect(seen().angle).toBeLessThan(-T.focusAngle);
    expect(seen().angle).toBeGreaterThan(-HALF_WIDTH);
  });

  it('comes in as stamina falls, until it stands right beside the player, inside the clear middle of the tunnel', () => {
    stamina.value = 0.8;
    run(7);
    const far = seen().distance;
    expect(far).toBeGreaterThan(9);

    stamina.value = 0.01;
    run(0.1);
    const { distance, angle } = seen();
    expect(distance).toBeLessThan(1);
    // The tunnel's clear middle reaches about 25° either side of the centre.
    expect(Math.abs(angle)).toBeLessThan(25 * DEG);
    expect(Math.abs(angle)).toBeGreaterThan(T.focusAngle);
  });

  it('never stands in a wall: something in the way brings it in front of it', () => {
    wall = 3;
    stamina.value = 0.8;
    run(7);
    expect(visible()).toBe(true);
    expect(seen().distance).toBeCloseTo(3 - T.wallGap, 5);
    const [from, dir] = rayHit.mock.calls[0];
    expect(from.y).toBeCloseTo(EYE);        // level, from the player's eye
    expect(dir.y).toBeCloseTo(0);
  });

  it('never stands in the furniture: it steps in toward the player to clear floor', () => {
    // A desk 0.75 m high across the spot it would take, 4 to 6 m out.
    const onDesk = ({ x, z }) => Math.hypot(x, z) > 4 && Math.hypot(x, z) < 6;
    rayHit.mockImplementation((from, dir) => {
      if (dir.y > -0.5) return Infinity;
      expect(from.y).toBeCloseTo(SLEEP_DEMON_FIGURE.height);   // down from its full height
      return onDesk(from) ? from.y - 0.75 : Infinity;
    });
    stamina.value = 0.425;                  // 5.4 m: on the desk
    run(4);
    expect(visible()).toBe(true);
    expect(seen().distance).toBeLessThan(4);
    expect(seen().distance).toBeGreaterThan(3.5);
  });

  it('with no room either side it waits out of sight, and shows once there is room', () => {
    wall = 0.5;
    stamina.value = 0.8;
    run(7);
    expect(visible()).toBe(false);
    wall = Infinity;
    run(0.3);
    expect(visible()).toBe(true);
  });

  it('turned away from, it finds the edge of the new view', () => {
    stamina.value = 0.425;
    run(4);
    face(0, EYE, 10);                       // turn round
    run(T.lostAfter + 0.2);
    expect(visible()).toBe(true);
    const { angle } = seen();
    expect(Math.abs(angle)).toBeGreaterThan(T.focusAngle);
    expect(Math.abs(angle)).toBeLessThan(HALF_WIDTH);
  });

  it('something in between counts as out of view: it comes back out in front of it', () => {
    stamina.value = 0.8;
    run(7);
    wall = 2;                               // between the player and where it stands
    run(T.lostAfter + 0.2);
    expect(visible()).toBe(true);
    expect(seen().distance).toBeCloseTo(2 - T.wallGap, 5);
  });

  it('the terminal screen covers the view: looked at through it, it stays', () => {
    stamina.value = 0.425;
    run(4);
    terminal.state = 'radar';
    const at = figure.object3d.position.clone();
    face(at.x, EYE, at.z);
    run(2);
    expect(visible()).toBe(true);
    expect(figure.object3d.position.distanceTo(at)).toBeLessThan(1e-9);
  });

  it('below holdBelow, stared at, it walks in on the player along the line it is seen along, to arm\'s length', () => {
    stamina.value = 0.05;
    run(1);
    expect(visible()).toBe(true);
    const at = figure.object3d.position.clone();
    face(at.x, EYE, at.z);
    const from = Math.hypot(at.x, at.z);
    run(1);
    const now = figure.object3d.position;
    expect(Math.hypot(now.x, now.z)).toBeCloseTo(from - T.stareSpeed, 2);
    expect(Math.atan2(now.x, now.z)).toBeCloseTo(Math.atan2(at.x, at.z), 5);
    expect(now.y).toBeCloseTo(terrainHeightAt(now.x, now.z));
    run(30);
    expect(visible()).toBe(true);
    expect(Math.hypot(now.x, now.z)).toBeCloseTo(T.stareFloor, 5);
    expect(controller.fail).not.toHaveBeenCalled();
  });

  it('each step of the walk is checked like a new spot: furniture on the floor and it stops short', () => {
    // Something 0.75 m high on the floor within 0.9 m of the player.
    rayHit.mockImplementation((from, dir) => {
      if (dir.y > -0.5) return wall;
      return Math.hypot(from.x, from.z) < 0.9 ? from.y - 0.75 : Infinity;
    });
    stamina.value = 0.05;
    run(1);
    const at = figure.object3d.position;
    face(at.x, EYE, at.z);
    run(30);
    expect(visible()).toBe(true);
    expect(Math.hypot(at.x, at.z)).toBeGreaterThanOrEqual(0.9);
    expect(Math.hypot(at.x, at.z)).toBeLessThan(0.91);
  });

  it('tells the scene as it walks, a centimetre at a time, and not once it stands still', () => {
    stamina.value = 0.05;
    run(1);
    onFigureChanged.mockClear();
    run(1, 1 / 60);                         // 8 cm in 60 frames
    expect(onFigureChanged.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(onFigureChanged.mock.calls.length).toBeLessThanOrEqual(8);
    run(30);
    onFigureChanged.mockClear();
    run(2);
    expect(onFigureChanged).not.toHaveBeenCalled();
  });

  it('with the stare-down off, below holdBelow it only stands there', () => {
    demon.onDestroy();
    demon = new SleepDemon({
      controller, stamina, figure, camera, terminal, rayHit, onFigureChanged,
      sounds: { breathing: fakeSound() }, rand: () => 0.9, tuning: { ...T, stareDown: false },
    });
    demon.onStart();
    stamina.value = 0.05;
    run(1);
    const at = figure.object3d.position.clone();
    face(at.x, EYE, at.z);
    run(5);
    expect(visible()).toBe(true);
    expect(figure.object3d.position.distanceTo(at)).toBeLessThan(1e-9);
  });

  it('ends the night when the player runs out of stamina, with the retry prompt', () => {
    stamina.value = 0;
    run(0.1);
    expect(controller.fail).toHaveBeenCalledWith(SLEEP_DEMON_KILL);
    expect(SLEEP_DEMON_KILL).toMatch(/fell asleep/i);
    expect(SLEEP_DEMON_KILL).toMatch(/\[E\] to retry/);
  });

  it('is hidden and harmless outside the shift: the morning, or a failed night', () => {
    stamina.value = 0.425;
    run(4);
    expect(visible()).toBe(true);
    controller.state = 'morning';
    stamina.value = 0;
    run(5);
    expect(visible()).toBe(false);
    expect(controller.fail).not.toHaveBeenCalled();
  });

  it('a new or retried night starts it away', () => {
    stamina.value = 0.425;
    run(4);
    controller.state = 'gameOver';
    run(0.1);
    stamina.reset();
    controller.startNight(1, { retry: true });
    expect(visible()).toBe(false);
    expect(demon.logic.around).toBe(false);
    run(10);
    expect(visible()).toBe(false);
  });

  it('comes every night: nights 2 and 3 as well as 1', () => {
    for (const night of [2, 3]) {
      stamina.reset();
      controller.startNight(night);
      expect(visible()).toBe(false);
      stamina.value = 0.425;
      run(4);
      expect(visible(), `night ${night}`).toBe(true);
    }
  });

  it('holds while the debug fly camera has frozen the player', () => {
    frozen = true;
    stamina.value = 0;
    run(30);
    expect(visible()).toBe(false);
    expect(controller.fail).not.toHaveBeenCalled();
  });

  it('tells the scene each time the figure moves, shows or hides (the frozen shadow maps)', () => {
    onFigureChanged.mockClear();
    stamina.value = 0.425;
    run(4);
    expect(onFigureChanged).toHaveBeenCalledTimes(1);     // shows
    stamina.value = 0.3;
    run(0.1);
    expect(onFigureChanged).toHaveBeenCalledTimes(2);     // steps in
    run(1);
    expect(onFigureChanged).toHaveBeenCalledTimes(2);     // only turns to face the player
    controller.state = 'morning';
    run(0.1);
    expect(onFigureChanged).toHaveBeenCalledTimes(3);     // hides
    run(1);
    expect(onFigureChanged).toHaveBeenCalledTimes(3);
  });

  it('stops listening for nights when destroyed', () => {
    demon.onDestroy();
    expect(controller.listeners.size).toBe(0);
  });

  it('the figure is sized like a person, so right beside the player its eyes are in view', () => {
    // At 0.8 m a 75° view shows 0.61 m above the eye: the crown may go, the eyes may not.
    const eyes = SLEEP_DEMON_FIGURE.height - SLEEP_DEMON_FIGURE.radius * 0.9;
    expect(Math.atan2(eyes - EYE, T.nearest)).toBeLessThan(37.5 * DEG);
    expect(SLEEP_DEMON_FIGURE.height).toBeGreaterThan(1.6);
  });
});

describe('SleepDemon and the flashlight', () => {
  let camera, figure, stamina, controller, torch, frozen, demon;
  const run = (seconds, dt = 0.1) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) demon.onUpdate(dt);
  };
  /** Whether the demon has the torch stuttering now: its last word. */
  const stuttering = () => torch.setInterference.mock.calls.at(-1)?.[0] ?? false;

  /** Aim the view, and the torch on it, level and `angle` radians off the
   *  line to the figure, toward the middle of the view it showed in. */
  function aimOff(angle) {
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const to = figure.object3d.position.clone().sub(eye).setY(0).normalize();
    to.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);   // it shows on the right: turn left
    camera.lookAt(eye.add(to));
    camera.updateMatrixWorld(true);
  }

  beforeEach(() => {
    camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    camera.position.set(0, EYE, 0);
    camera.lookAt(0, EYE, -10);
    camera.updateMatrixWorld(true);
    figure = new GameObject('SleepDemon');
    figure.object3d.visible = false;
    stamina = new Stamina();
    controller = fakeController();
    torch = { on: true, light: { angle: 0.45 }, setInterference: vi.fn() };
    frozen = false;
    demon = new SleepDemon({
      controller, stamina, figure, camera, isFrozen: () => frozen,
      sounds: { breathing: fakeSound() },
      rand: () => 0.9,                      // the right-hand side first
      flashlight: torch,
    });
    demon.onStart();
    stamina.value = 0.8;
    run(7);                                 // showing, at the very edge of the view
  });

  it('stutters the torch while its beam is on him, and not while it points past him', () => {
    expect(figure.object3d.visible).toBe(true);
    expect(stuttering()).toBe(false);       // the edge of the view is outside the beam
    aimOff(20 * DEG);
    run(0.1);
    expect(figure.object3d.visible).toBe(true);
    expect(stuttering()).toBe(true);
    expect(torch.setInterference).toHaveBeenLastCalledWith(true, 'sleep-demon');
    aimOff(40 * DEG);
    run(0.1);
    expect(stuttering()).toBe(false);
  });

  it("the beam reaches him at its cone's edge plus a margin", () => {
    const edge = torch.light.angle + SLEEP_DEMON_BEAM.margin;
    aimOff(edge - 0.01);
    run(0.1);
    expect(stuttering()).toBe(true);
    aimOff(edge + 0.01);
    run(0.1);
    expect(stuttering()).toBe(false);
    expect(SLEEP_DEMON_BEAM.margin).toBeGreaterThan(0);
    expect(SLEEP_DEMON_BEAM.margin).toBeLessThan(0.15);
  });

  it('is a warning, not a cure: centred on him he still goes, as ever, and the stutter with him', () => {
    aimOff(20 * DEG);
    run(0.1);
    expect(stuttering()).toBe(true);
    aimOff(0);
    run(0.1);
    expect(figure.object3d.visible).toBe(false);
    expect(stuttering()).toBe(false);
  });

  it('leaves a switched-off torch alone', () => {
    torch.on = false;
    aimOff(20 * DEG);
    run(1);
    expect(torch.setInterference).not.toHaveBeenCalledWith(true, expect.anything());
  });

  it('lets go of the torch outside the shift, and when destroyed', () => {
    aimOff(20 * DEG);
    run(0.1);
    expect(stuttering()).toBe(true);
    controller.state = 'morning';
    run(0.1);
    expect(stuttering()).toBe(false);

    controller.state = 'playing';
    stamina.value = 0.8;
    run(7);
    aimOff(20 * DEG);
    run(0.1);
    expect(stuttering()).toBe(true);
    demon.onDestroy();
    expect(stuttering()).toBe(false);
  });

  it('lets go of the torch while the fly camera has the view: it carries the torch off', () => {
    aimOff(20 * DEG);
    run(0.1);
    expect(stuttering()).toBe(true);
    frozen = true;
    run(0.1);
    expect(stuttering()).toBe(false);
    expect(figure.object3d.visible).toBe(true);           // the demon itself holds
  });
});

describe('SleepDemon sound', () => {
  it('breathes from where it stands once it has shown, louder as it comes in, and stops when it goes', () => {
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    camera.position.set(0, EYE, 0);
    camera.updateMatrixWorld(true);
    const stamina = new Stamina();
    const controller = fakeController();
    const breathing = fakeSound();
    const demon = new SleepDemon({
      controller, stamina, camera, figure: new GameObject('SleepDemon'),
      sounds: { breathing }, rand: () => 0.9,
    });
    demon.onStart();
    const run = seconds => { for (let t = 0; t < seconds - 1e-9; t += 0.1) demon.onUpdate(0.1); };

    run(1);
    expect(breathing.isPlaying).toBe(false);

    stamina.value = 0.8;
    run(1);                                 // about, but nowhere yet: no sound from nowhere
    expect(breathing.isPlaying).toBe(false);
    run(6);
    expect(breathing.isPlaying).toBe(true);
    const far = breathing.volume;
    expect(far).toBeGreaterThan(0);
    stamina.value = 0.1;
    run(0.1);
    expect(breathing.volume).toBeGreaterThan(far);

    stamina.value = 0.9;                    // ate: it goes
    run(0.1);
    expect(breathing.isPlaying).toBe(false);

    stamina.value = 0.425;
    run(4);
    expect(breathing.isPlaying).toBe(true);
    controller.state = 'morning';
    run(0.1);
    expect(breathing.isPlaying).toBe(false);

    controller.startNight(2);
    demon.onDestroy();
    expect(breathing.isPlaying).toBe(false);
  });

  it('works with no sound at all (no audio loaded)', () => {
    const stamina = new Stamina();
    const demon = new SleepDemon({
      controller: fakeController(), stamina,
      camera: new THREE.PerspectiveCamera(),
      figure: new GameObject('SleepDemon'),
    });
    demon.onStart();
    stamina.value = 0.3;
    expect(() => { for (let i = 0; i < 100; i++) demon.onUpdate(0.1); }).not.toThrow();
  });
});

describe('sightRay', () => {
  const eye = { x: 0, y: EYE, z: 0 };
  const ahead = { x: 0, y: 0, z: -1 };

  it('asks the physics world for the first solid thing, past open doorways and the player\'s own body', () => {
    const body = { handle: 7 };
    const castRay = vi.fn(() => ({ timeOfImpact: 2.5 }));
    expect(sightRay({ castRay }, body)(eye, ahead, 10)).toBe(2.5);
    const [ray, max, solid, flags, , , excludeBody] = castRay.mock.calls[0];
    expect(ray.origin).toMatchObject(eye);
    expect(ray.dir).toMatchObject(ahead);
    expect(max).toBe(10);
    expect(solid).toBe(true);
    expect(flags).toBe(8);                  // EXCLUDE_SENSORS
    expect(excludeBody).toBe(body);
  });

  it('nothing in the way: Infinity', () => {
    expect(sightRay({ castRay: () => null })(eye, ahead, 10)).toBe(Infinity);
  });

  it('with no world that can cast a ray, nothing is ever in the way', () => {
    expect(sightRay(null)(eye, ahead, 10)).toBe(Infinity);
    expect(sightRay({})(eye, ahead, 10)).toBe(Infinity);
  });
});
