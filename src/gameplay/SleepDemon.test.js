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
import { createMonsterFigure } from '../gameobjects/MonsterFigure.js';
import { terrainHeightAt } from '../gameobjects/MarsTerrain.js';
import { Stamina } from './Stamina.js';
import { SleepDemon, SLEEP_DEMON_KILL, SLEEP_DEMON_FIGURE, sightRay } from './SleepDemon.js';
import { SLEEP_DEMON as T } from './SleepDemonLogic.js';
import { SLEEP_DEMON_DEATH as D } from './SleepDemonDeath.js';

const EYE = 1.24;
/** Seconds from empty to the failed night. */
const DEATH_TOTAL = D.passOut + D.black + D.loom + D.cut;
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

  it('ends the night when the player runs out of stamina, with the retry prompt', () => {
    stamina.value = 0;
    run(0.1);
    expect(controller.fail).not.toHaveBeenCalled();     // the death plays out first
    run(DEATH_TOTAL + 0.2);
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

describe('SleepDemon death: you fall asleep, and he is waiting', () => {
  let camera, figure, stamina, controller, frozen, onFigureChanged, player, overlay, fade, volume, listener, demon;

  /** One frame the way the engine runs it: the update, then FatigueEffects
   *  writing its own lids (it updates after the demon), then the late update. */
  function run(seconds, dt = 0.05) {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      demon.onUpdate(dt);
      overlay.set(controller.state === 'playing' ? 0.4 : 0, 0);
      demon.onLateUpdate(dt);
    }
  }

  const eye = () => camera.getWorldPosition(new THREE.Vector3());

  beforeEach(() => {
    camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    camera.rotation.order = 'YXZ';          // as the engine sets it
    camera.position.set(0, EYE, 0);
    camera.rotation.set(-0.2, 0.7, 0);      // looking a little down, off to one side
    camera.updateMatrixWorld(true);
    figure = createMonsterFigure({ name: 'SleepDemon', ...SLEEP_DEMON_FIGURE });
    stamina = new Stamina();
    controller = fakeController();
    frozen = false;
    onFigureChanged = vi.fn();
    player = { enabled: true };
    overlay = {
      tunnel: 0, lid: 0,
      set: vi.fn(function (t, l) { this.tunnel = t; this.lid = l; }),
      clear: vi.fn(function () { this.tunnel = 0; this.lid = 0; }),
    };
    fade = { play: vi.fn() };
    volume = {
      value: 0.8,
      setTargetAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(function (v) { this.value = v; }),
    };
    listener = { context: { currentTime: 12 }, gain: { gain: volume } };
    demon = new SleepDemon({
      controller, stamina, figure, camera, onFigureChanged,
      isFrozen: () => frozen,
      sounds: { breathing: fakeSound() },
      rand: () => 0.9,
      player, overlay, fade, listener,
    });
    demon.onStart();
  });

  /** Everything back as it was before it started. */
  function expectRestored() {
    expect(demon.deathPhase).toBe('idle');
    expect(player.enabled).toBe(true);
    expect(camera.position.y).toBeCloseTo(EYE, 9);
    expect(camera.rotation.x).toBeCloseTo(-0.2, 9);
    expect(camera.rotation.y).toBeCloseTo(0.7, 9);
    expect(camera.rotation.z).toBe(0);
    expect(overlay.lid).toBe(0);
    expect(overlay.tunnel).toBe(0);
    expect(volume.value).toBe(0.8);
    expect(figure.object3d.visible).toBe(false);
    for (const e of figure.eyes) expect(e.scale.x).toBe(1);
  }

  it('at empty the player passes out: frozen, the lids slam shut, the view drops and tips', () => {
    stamina.value = 0;
    run(0.05);
    expect(demon.deathPhase).toBe('passOut');
    expect(player.enabled).toBe(false);
    run(D.passOut + 0.05);
    expect(demon.deathPhase).toBe('black');
    expect(overlay.lid).toBe(1);            // its lids win over FatigueEffects'
    const { x, z } = eye();
    expect(eye().y).toBeCloseTo(terrainHeightAt(x, z) + D.slumpEye, 5);
    expect(Math.abs(camera.rotation.z)).toBeCloseTo(D.slumpRoll, 5);
    expect(camera.rotation.x).toBeCloseTo(D.slumpPitch, 5);
    expect(camera.rotation.y).toBeCloseTo(0.7, 9);   // slumped where they faced
    expect(controller.fail).not.toHaveBeenCalled();
  });

  it('the eyes flare open on him right over the player, peering down, facing them', () => {
    stamina.value = 0;
    run(0.05 + D.passOut + D.black - 0.1);
    onFigureChanged.mockClear();
    run(0.3);
    expect(demon.deathPhase).toBe('flare');
    expect(overlay.lid).toBe(0);
    expect(figure.object3d.visible).toBe(true);
    expect(onFigureChanged).toHaveBeenCalled();      // the frozen shadow maps

    const o = figure.object3d;
    const at = eye();
    const level = Math.hypot(o.position.x - at.x, o.position.z - at.z);
    expect(level).toBeCloseTo(D.loomDistance, 5);
    expect(o.position.y).toBeCloseTo(terrainHeightAt(o.position.x, o.position.z), 5);
    // In front, the way the player faced as they fell.
    const ahead = new THREE.Vector3(-Math.sin(0.7), 0, -Math.cos(0.7));
    const toIt = o.position.clone().sub(at).setY(0).normalize();
    expect(toIt.dot(ahead)).toBeGreaterThan(0.99);

    // Facing them, and leaning over them: its face above the eye, in view.
    o.updateMatrixWorld(true);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(o.quaternion).setY(0).normalize();
    expect(facing.dot(toIt)).toBeLessThan(-0.99);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(o.quaternion);
    expect(up.dot(toIt)).toBeLessThan(-0.1);         // the top of it toward the player
    const face = new THREE.Vector3(0, SLEEP_DEMON_FIGURE.height * 0.85, 0).applyMatrix4(o.matrixWorld);
    expect(face.y).toBeGreaterThan(at.y + 0.8);
    camera.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    expect(frustum.containsPoint(face)).toBe(true);
    for (const e of figure.eyes) expect(e.scale.x).toBeGreaterThan(1);   // they flare
  });

  it('cuts to black, then fails the night: exactly once, and only after every beat', () => {
    stamina.value = 0;
    run(0.05 + D.passOut + D.black + D.loom - 0.1);
    expect(fade.play).not.toHaveBeenCalled();
    expect(controller.fail).not.toHaveBeenCalled();
    run(0.2);
    expect(demon.deathPhase).toBe('cut');
    expect(fade.play).toHaveBeenCalledTimes(1);
    expect(controller.fail).not.toHaveBeenCalled();
    run(D.cut);
    expect(demon.deathPhase).toBe('over');
    expect(controller.fail).toHaveBeenCalledTimes(1);
    expect(controller.fail).toHaveBeenCalledWith(SLEEP_DEMON_KILL);
    run(10);
    expect(controller.fail).toHaveBeenCalledTimes(1);
    expect(fade.play).toHaveBeenCalledTimes(1);
    expect(player.enabled).toBe(false);     // held until the retry
  });

  it('the world\'s sound falls away as they pass out, and comes back exactly on the retry', () => {
    stamina.value = 0;
    run(0.05);
    const [target, , seconds] = volume.setTargetAtTime.mock.calls.at(-1);
    expect(target).toBeCloseTo(0.8 * D.hush, 9);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThan(D.passOut);
    run(DEATH_TOTAL + 0.2);
    controller.state = 'gameOver';
    run(0.1);
    stamina.reset();
    controller.startNight(1, { retry: true });
    expect(volume.setValueAtTime).toHaveBeenLastCalledWith(0.8, 12);
  });

  it('a retry puts everything back: the player free, the camera at the eye, the lids open, the sound up', () => {
    stamina.value = 0;
    run(0.05 + DEATH_TOTAL + 0.2);
    controller.state = 'gameOver';
    run(0.1);
    stamina.reset();
    controller.startNight(1, { retry: true });
    expectRestored();
    run(5);
    expect(player.enabled).toBe(true);
  });

  it('a night start in the middle calls it off cleanly: everything back, and no fail', () => {
    stamina.value = 0;
    run(0.05 + D.passOut + D.black / 2);
    stamina.reset();
    controller.startNight(2);
    expectRestored();
    run(DEATH_TOTAL + 1);
    expect(controller.fail).not.toHaveBeenCalled();
    expect(fade.play).not.toHaveBeenCalled();
  });

  it('the shift ending under it (6 AM, another threat) calls it off', () => {
    stamina.value = 0;
    run(0.05 + D.passOut + D.black + 0.3);
    controller.state = 'gameOver';
    run(0.1);
    expectRestored();
    run(DEATH_TOTAL);
    expect(controller.fail).not.toHaveBeenCalled();
  });

  it('runs on the game clock: it holds while the fly camera is on, and with no frames (paused)', () => {
    stamina.value = 0;
    run(0.05 + D.passOut + 0.1);
    expect(demon.deathPhase).toBe('black');
    frozen = true;
    run(30);
    expect(demon.deathPhase).toBe('black');
    expect(controller.fail).not.toHaveBeenCalled();
    frozen = false;
    run(DEATH_TOTAL);
    expect(controller.fail).toHaveBeenCalledTimes(1);
  });

  it('destroyed in the middle (a rebuild from the menu), everything is put back', () => {
    stamina.value = 0;
    run(0.05 + D.passOut + D.black + 0.3);
    demon.onDestroy();
    expectRestored();
  });

  it('works without a player, overlay, fade or audio listener', () => {
    const bare = new SleepDemon({ controller, stamina, figure, camera, rand: () => 0.9 });
    bare.onStart();
    stamina.value = 0;
    expect(() => {
      for (let i = 0; i < 100; i++) { bare.onUpdate(0.05); bare.onLateUpdate(0.05); }
    }).not.toThrow();
    expect(controller.fail).toHaveBeenCalledTimes(1);
    controller.startNight(1, { retry: true });
    expect(camera.position.y).toBeCloseTo(EYE, 9);
  });
});
