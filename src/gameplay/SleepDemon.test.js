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
import { SleepDemon, SLEEP_DEMON_KILL, SLEEP_DEMON_FIGURE, SLEEP_DEMON_BEAM, SLEEP_DEMON_DUCK, SLEEP_DEMON_DREAD, sightRay } from './SleepDemon.js';
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
  /** The figure's fade, through its eyes' material (one material, both eyes). */
  const opacity = () => figure.eyes[0].material.opacity;

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
    figure = createMonsterFigure({ name: 'SleepDemon', ...SLEEP_DEMON_FIGURE });
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
      sounds: { footstep: fakeSound() },
      rand: () => 0.9,                      // the right-hand side first
    });
    demon.onStart();
  });

  it('stays hidden while the player is awake', () => {
    run(60);
    expect(visible()).toBe(false);
  });

  it('fades in, silently, in the corner of the eye: just outside the look cone, on the floor, facing the player', () => {
    const asked = vi.spyOn(demon.logic, 'place');
    stamina.value = 0.8;
    run(7);
    expect(visible()).toBe(true);
    const [{ distance, edge, side, focus }] = asked.mock.calls[0];
    const at = seen();
    expect(at.distance).toBeCloseTo(distance, 5);
    expect(at.angle).toBeCloseTo(side * Math.max(edge * HALF_WIDTH, focus + T.showMargin), 5);
    expect(Math.abs(at.angle)).toBeGreaterThan(demon.logic.focus);
    expect(Math.abs(at.angle)).toBeLessThan(HALF_WIDTH);
    expect(demon.sounds.footstep.play).not.toHaveBeenCalled();   // it fades in; it doesn't walk in

    const feet = figure.object3d.position;
    expect(feet.y).toBeCloseTo(terrainHeightAt(feet.x, feet.z));
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(figure.object3d.quaternion);
    const toEye = new THREE.Vector3(-feet.x, 0, -feet.z).normalize();
    expect(facing.dot(toEye)).toBeGreaterThan(0.99);
  });

  it('fades in slowly from nothing, and while the player is fresh no further than faint', () => {
    stamina.value = 0.8;
    run(5.8);                               // shows 5.7 s in
    expect(visible()).toBe(true);
    expect(opacity()).toBeLessThan(0.02);
    run(T.fadeIn / 2);
    expect(opacity()).toBeGreaterThan(0.05);
    expect(opacity()).toBeLessThan(T.faintest);
    run(T.fadeIn);
    expect(opacity()).toBeCloseTo(T.faintest, 5);   // barely there
    stamina.value = 0.2;                    // tired: solid now, in place
    run(T.fadeIn + 0.2);
    expect(opacity()).toBe(1);
  });

  it('looked at, it fades away where it stood, and fades back in at the other edge of the view', () => {
    stamina.value = 0.3;                    // solid: presence 1
    run(2.9);                               // shown at 2.76 s
    run(T.fadeIn + 0.1);                    // the fade in done
    expect(visible()).toBe(true);
    expect(opacity()).toBe(1);
    expect(seen().angle).toBeGreaterThan(0);
    const at = figure.object3d.position;
    face(at.x, EYE, at.z);
    run(0.1);                               // the look lands: fading away, not popped
    expect(visible()).toBe(true);
    expect(opacity()).toBeGreaterThan(0);
    expect(opacity()).toBeLessThan(1);
    run(T.fadeOut);                         // the fade out done
    expect(visible()).toBe(false);

    run(1.9);                               // gone 2.76 s at this stamina
    expect(visible()).toBe(false);
    run(0.3);
    expect(visible()).toBe(true);
    expect(opacity()).toBeLessThan(0.2);    // and back in, fading, not popped
    expect(seen().angle).toBeLessThan(-demon.logic.focus);
    expect(seen().angle).toBeGreaterThan(-HALF_WIDTH);
    run(T.fadeIn);
    expect(opacity()).toBe(1);
  });

  it('never teleports: as stamina falls it stays where it stood, silent while seen', () => {
    stamina.value = 0.8;
    run(7);
    expect(seen().distance).toBeGreaterThan(9);
    const spot = figure.object3d.position.clone();
    for (let s = 0.8; s > 0.15; s -= 0.01) {
      stamina.value = s;
      run(0.1);
    }
    expect(visible()).toBe(true);
    expect(figure.object3d.position.distanceTo(spot)).toBeLessThan(1e-9);
    expect(demon.sounds.footstep.play).not.toHaveBeenCalled();
  });

  it('the tireder the player, the nearer it shows, and the nearer the middle of the view', () => {
    stamina.value = 0.15;
    run(2);                                 // shows 1.88 s in
    expect(visible()).toBe(true);
    const { distance, angle } = seen();
    expect(distance).toBeLessThan(3);
    expect(Math.abs(angle)).toBeLessThan(35 * DEG);
    expect(Math.abs(angle)).toBeGreaterThan(demon.logic.focus);
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

  it('turned away from, it stays where it stood and creeps in slowly along the same line, footsteps as it goes', () => {
    stamina.value = 0.425;
    run(4);
    const spot = figure.object3d.position.clone();
    face(0, EYE, 10);                       // turn round
    run(5);
    expect(visible()).toBe(true);
    const now = figure.object3d.position;
    const crept = Math.hypot(spot.x, spot.z) - Math.hypot(now.x, now.z);
    expect(crept).toBeCloseTo(5 * (T.sneakFar + (T.sneakNear - T.sneakFar) * 0.5), 1);
    expect(crept).toBeLessThan(1.5);        // slowly
    expect(Math.atan2(now.x, now.z)).toBeCloseTo(Math.atan2(spot.x, spot.z), 5);
    expect(demon.sounds.footstep.play).toHaveBeenCalled();
  });

  it('some showings land behind the player by the roll: out of sight, creeping nearer', () => {
    demon.onDestroy();
    demon = new SleepDemon({
      controller, stamina, figure, camera, terminal, rayHit, onFigureChanged,
      isFrozen: () => frozen,
      sounds: { footstep: fakeSound() },
      rand: () => 0.1,                      // inside behindChance: the roll fires
    });
    demon.onStart();
    stamina.value = 0.425;
    run(3.6);                               // shows at 3.5 s, behind the player
    expect(visible()).toBe(true);
    const { distance, angle } = seen();
    expect(Math.abs(angle)).toBeGreaterThan(HALF_WIDTH);   // out of sight: behind the back
    expect(distance).toBeLessThan(4);       // nearer than the edge of the view's 5.4 m
    run(2);                                 // nobody looking: it creeps in
    expect(seen().distance).toBeLessThan(distance - 0.3);
  });

  it('its footsteps are heard only while it creeps: slow, careful steps', () => {
    demon.onDestroy();
    const footsteps = fakeSound();
    demon = new SleepDemon({
      controller, stamina, camera, figure,
      sounds: { footstep: footsteps },
      rand: () => 0,                        // shows behind by the roll, then paces at the ticks
    });
    demon.onStart();
    stamina.value = 0.425;
    run(4);                                 // shows at 3.5 s and creeps from there
    expect(demon.logic.sneaking).toBe(true);
    const heard = footsteps.play.mock.calls.length;
    expect(heard).toBeGreaterThan(0);
    run(3);                                 // a step every 0.9 s
    expect(footsteps.play.mock.calls.length).toBeGreaterThanOrEqual(heard + 3);
  });

  it('shut out by something in between, it fades in again in front of it', () => {
    stamina.value = 0.8;
    run(7);
    wall = 2;                               // between the player and where it stands
    run(T.stuckAfter + 0.2);
    expect(visible()).toBe(true);
    expect(seen().distance).toBeCloseTo(2 - T.wallGap, 5);
    expect(opacity()).toBeLessThan(T.faintest);   // fading in, not popped
  });

  it('the terminal screen covers the view: looked at through it, it stays, creeping slowly', () => {
    stamina.value = 0.425;
    run(4);
    terminal.state = 'radar';
    const at = figure.object3d.position.clone();
    face(at.x, EYE, at.z);
    run(0.1);                               // it slips out of sight
    const spot = figure.object3d.position.clone();
    run(2);
    expect(visible()).toBe(true);
    expect(spot.distanceTo(at)).toBeGreaterThan(1);
    expect(figure.object3d.position.distanceTo(spot)).toBeGreaterThan(0);
    expect(figure.object3d.position.distanceTo(spot)).toBeLessThan(0.5);
  });

  it('with the terminal screen up it stands out of sight: beside the player at first, behind them near empty', () => {
    terminal.state = 'radar';
    stamina.value = 0.8;
    run(7);
    expect(visible()).toBe(true);
    let at = seen();
    const halfBody = Math.atan2(SLEEP_DEMON_FIGURE.radius, at.distance);
    expect(Math.abs(at.angle) - halfBody).toBeGreaterThan(HALF_WIDTH);
    expect(Math.abs(at.angle)).toBeGreaterThan(70 * DEG);
    expect(Math.abs(at.angle)).toBeLessThan(100 * DEG);

    stamina.reset();
    controller.startNight(1);
    stamina.value = 0.04;
    run(1.3);
    at = seen();
    expect(at.distance).toBeLessThan(1.6);
    expect(Math.abs(at.angle)).toBeGreaterThan(135 * DEG);
    const feet = figure.object3d.position;
    expect(feet.y).toBeCloseTo(terrainHeightAt(feet.x, feet.z));
  });

  it('out of sight it still keeps clear of walls, and with no room either side it waits', () => {
    terminal.state = 'radar';
    wall = 3;
    stamina.value = 0.8;
    run(5.8);                               // just shown: it has barely begun to creep
    expect(visible()).toBe(true);
    expect(seen().distance).toBeCloseTo(3 - T.wallGap, 1);
    expect(seen().distance).toBeLessThanOrEqual(3 - T.wallGap);

    stamina.reset();
    controller.startNight(1);
    wall = 0.5;
    stamina.value = 0.8;
    run(7);
    expect(visible()).toBe(false);
  });

  it('the screen closed, it comes after the player: turning round to look at it sends it away', () => {
    stamina.value = 0.5;
    run(4);
    terminal.state = 'radar';
    run(0.1);
    const spot = figure.object3d.position.clone();
    const gapBefore = seen().distance;
    terminal.state = 'idle';
    run(4);                                 // nobody looking: it creeps in after them
    expect(visible()).toBe(true);
    expect(figure.object3d.position.distanceTo(spot)).toBeGreaterThan(0.5);
    expect(seen().distance).toBeLessThan(gapBefore);
    face(spot.x, EYE, spot.z);              // turn round
    run(0.1);
    expect(visible()).toBe(true);           // fading away, not popped
    run(T.fadeOut);                         // the fade out done
    expect(visible()).toBe(false);
  });

  it('below walkBelow, stared at, it walks in on the player along the line it is seen along, to arm\'s length', () => {
    stamina.value = 0.04;
    run(1.3);
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

  it('between 10 % and 5 % it no longer fades from a look, but only stares', () => {
    stamina.value = 0.08;
    run(1.6);                               // shows 1.53 s in
    const at = figure.object3d.position.clone();
    face(at.x, EYE, at.z);
    run(3);
    expect(visible()).toBe(true);
    expect(figure.object3d.position.distanceTo(at)).toBeLessThan(1e-9);
  });

  it('each step of the walk is checked like a new spot: furniture on the floor and it stops short', () => {
    // Something 0.75 m high on the floor within 0.9 m of the player.
    rayHit.mockImplementation((from, dir) => {
      if (dir.y > -0.5) return wall;
      return Math.hypot(from.x, from.z) < 0.9 ? from.y - 0.75 : Infinity;
    });
    stamina.value = 0.04;
    run(1.3);
    const at = figure.object3d.position;
    face(at.x, EYE, at.z);
    run(30);
    expect(visible()).toBe(true);
    expect(Math.hypot(at.x, at.z)).toBeGreaterThanOrEqual(0.9);
    expect(Math.hypot(at.x, at.z)).toBeLessThan(0.91);
  });

  it('tells the scene as it walks, a centimetre at a time, and not once it stands still', () => {
    stamina.value = 0.04;
    run(1.3);
    onFigureChanged.mockClear();
    run(1.6, 1 / 60);                       // 19 cm in 96 frames
    expect(onFigureChanged.mock.calls.length).toBeGreaterThanOrEqual(16);
    expect(onFigureChanged.mock.calls.length).toBeLessThanOrEqual(20);
    run(30);
    onFigureChanged.mockClear();
    run(2);
    expect(onFigureChanged).not.toHaveBeenCalled();
  });

  it('with the stare-down off, below walkBelow it only stands there', () => {
    demon.onDestroy();
    demon = new SleepDemon({
      controller, stamina, figure, camera, terminal, rayHit, onFigureChanged,
      sounds: { footstep: fakeSound() }, rand: () => 0.9, tuning: { ...T, stareDown: false },
    });
    demon.onStart();
    stamina.value = 0.04;
    run(1.3);
    const at = figure.object3d.position.clone();
    face(at.x, EYE, at.z);
    run(5);
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
    stamina.value = 0.5;
    run(4);
    expect(onFigureChanged).toHaveBeenCalledTimes(1);     // shows
    run(1);
    expect(onFigureChanged).toHaveBeenCalledTimes(1);     // only turns to face the player
    const at = figure.object3d.position;
    face(at.x, EYE, at.z);
    run(0.1);
    expect(onFigureChanged).toHaveBeenCalledTimes(1);     // fading: still there
    run(T.fadeOut);
    expect(onFigureChanged).toHaveBeenCalledTimes(2);     // gone
    run(4);
    expect(onFigureChanged).toHaveBeenCalledTimes(3);     // shows again, elsewhere
    controller.state = 'morning';
    run(0.1);
    expect(onFigureChanged).toHaveBeenCalledTimes(4);     // hides
    run(1);
    expect(onFigureChanged).toHaveBeenCalledTimes(4);
  });

  it('smiles from 1 % stamina, keeps the smile through the death, and a new night wipes it', () => {
    stamina.value = 0.3;
    run(3);
    expect(figure.smile.visible).toBe(false);
    stamina.value = 0.02;
    run(0.1);
    expect(figure.smile.visible).toBe(false);
    stamina.value = 0.01;
    run(0.1);
    expect(figure.smile.visible).toBe(true);
    stamina.value = 0;
    for (let t = 0; t < DEATH_TOTAL - 0.2; t += 0.1) {
      demon.onUpdate(0.1);
      expect(figure.smile.visible).toBe(true);
    }
    run(0.5);
    stamina.reset();
    controller.startNight(1, { retry: true });
    expect(figure.smile.visible).toBe(false);
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
      sounds: { footstep: fakeSound() },
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
    expect(figure.object3d.visible).toBe(true);           // fading away, still there
    run(0.4);                                             // the fade out done
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
  it('steps only while it moves: never as it shows, never standing, never from nowhere', () => {
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    camera.position.set(0, EYE, 0);
    camera.updateMatrixWorld(true);
    const look = (x, z) => { camera.lookAt(x, EYE, z); camera.updateMatrixWorld(true); };
    const stamina = new Stamina();
    const controller = fakeController();
    const footsteps = fakeSound();
    const figure = new GameObject('SleepDemon');
    const demon = new SleepDemon({
      controller, stamina, camera, figure,
      sounds: { footstep: footsteps }, rand: () => 0.9,
    });
    demon.onStart();
    const run = seconds => { for (let t = 0; t < seconds - 1e-9; t += 0.1) demon.onUpdate(0.1); };
    const plays = () => footsteps.play.mock.calls.length;

    run(1);
    expect(plays()).toBe(0);

    stamina.value = 0.8;
    run(1);                                 // about, but nowhere yet: no step from nowhere
    expect(plays()).toBe(0);
    run(6);                                 // shows at 5.7 s: silently, it fades in
    expect(figure.object3d.visible).toBe(true);
    expect(plays()).toBe(0);
    run(5);                                 // seen, standing: not a sound
    expect(plays()).toBe(0);

    look(0, 10);                            // turned away: it creeps, and is heard
    run(2);
    expect(plays()).toBeGreaterThanOrEqual(1);
    const far = footsteps.volume;
    expect(far).toBeGreaterThan(0);

    stamina.value = 0.04;                   // near empty: nearer, louder
    run(3);
    expect(footsteps.volume).toBeGreaterThan(far);

    stamina.value = 0.5;                    // a ration: it flees a look again
    const at = figure.object3d.position;
    look(at.x, at.z);
    run(0.1);
    const heard = plays();
    run(2);                                 // looked at: fading away — and no steps from nowhere
    expect(figure.object3d.visible).toBe(false);
    expect(plays()).toBe(heard);

    run(3);                                 // back, seen: silent
    expect(figure.object3d.visible).toBe(true);
    expect(plays()).toBe(heard);
    look(-camera.getWorldDirection(new THREE.Vector3()).x * 10, -camera.getWorldDirection(new THREE.Vector3()).z * 10);
    run(0.1);                               // turned away: the first step at once
    expect(plays()).toBeGreaterThan(heard);
    expect(footsteps.isPlaying).toBe(true);  // mid-step at the very moment…
    controller.state = 'morning';
    run(0.1);
    expect(footsteps.isPlaying).toBe(false); // …the shift cuts it

    controller.startNight(2);
    expect(footsteps.isPlaying).toBe(false);
    demon.onDestroy();
    expect(footsteps.isPlaying).toBe(false);
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

describe('SleepDemon dread: it walks you down', () => {
  let camera, figure, stamina, controller, player, fatigue, demon;

  function run(seconds, dt = 0.1) {
    for (let t = 0; t < seconds - 1e-9; t += dt) demon.onUpdate(dt);
  }

  /** The gap between the eye and the figure, level. */
  function gap() {
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const at = figure.object3d.position;
    return Math.hypot(at.x - eye.x, at.z - eye.z);
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
    player = { enabled: true, speedScale: 1 };
    fatigue = { setDread: vi.fn() };
    demon = new SleepDemon({
      controller, stamina, figure, camera, player, fatigue,
      sounds: { footstep: fakeSound() },
      rand: () => 0.9,
    });
    demon.onStart();
  });

  it('while it walks in the player is slowed and the dread is on them; let go the moment it is not', () => {
    stamina.value = 0.04;
    run(1.5);                               // shown at 1.24 s, walking since
    expect(demon.logic.walking).toBe(true);
    expect(player.speedScale).toBeCloseTo(SLEEP_DEMON_DREAD.slow, 10);
    expect(fatigue.setDread).toHaveBeenLastCalledWith(1);
    expect(SLEEP_DEMON_DREAD.slow).toBeGreaterThan(0);
    expect(SLEEP_DEMON_DREAD.slow).toBeLessThan(1);

    controller.state = 'morning';
    run(0.1);
    expect(player.speedScale).toBe(1);
    expect(fatigue.setDread).toHaveBeenLastCalledWith(0);

    controller.state = 'playing';
    stamina.reset();
    controller.startNight(2);
    expect(player.speedScale).toBe(1);
    expect(fatigue.setDread).toHaveBeenLastCalledWith(0);

    stamina.value = 0.04;
    run(30);                                // walked home: at arm's length, nothing left to give
    expect(gap()).toBeCloseTo(T.stareFloor, 2);
    expect(demon.logic.walking).toBe(false);
    expect(player.speedScale).toBe(1);
    expect(fatigue.setDread).toHaveBeenLastCalledWith(0);
  });

  it('a player who backs away is walked after — half the retreat, no more: they gain ground', () => {
    stamina.value = 0.04;
    run(1.5);                               // shown at 1.24 s, walking since
    expect(demon.logic.walking).toBe(true);
    const at = figure.object3d.position.clone();
    camera.lookAt(at.x, EYE, at.z);         // the stare: level on it
    camera.updateMatrixWorld(true);
    const back = new THREE.Vector3(at.x, 0, at.z).normalize();
    const before = gap();
    for (let i = 0; i < 40; i++) {
      camera.position.addScaledVector(back, -0.03);   // backing away
      camera.updateMatrixWorld(true);
      demon.onUpdate(0.1);
    }
    // 1.2 m of retreat: the demon follows at stareSpeed and takes up
    // stareFollow of the rest — the player keeps the difference.
    expect(gap() - before).toBeCloseTo(1.2 * (1 - T.stareFollow) - T.stareSpeed * 4, 1);
    expect(gap()).toBeGreaterThan(before);  // it follows, it doesn't stick
    expect(demon.logic.walking).toBe(true);
    expect(player.speedScale).toBeCloseTo(SLEEP_DEMON_DREAD.slow, 10);
    expect(fatigue.setDread).toHaveBeenLastCalledWith(1);
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

describe('SleepDemon dead air', () => {
  let camera, figure, stamina, controller, terminal, ambience, demon;

  /** The duck it asks the ambience for: 1 when it has let go. */
  const duck = () => ambience.ducks.get(SLEEP_DEMON_DUCK) ?? 1;

  function run(seconds, dt = 0.1) {
    for (let t = 0; t < seconds - 1e-9; t += dt) demon.onUpdate(dt);
  }

  /** Turn the view level, `angle` to the right of straight ahead (−Z). */
  function turn(angle) {
    camera.lookAt(Math.sin(angle) * 10, EYE, -Math.cos(angle) * 10);
    camera.updateMatrixWorld(true);
  }

  /** Where it stands, off the centre of the view as it was first faced. */
  function shownAt() {
    const at = figure.object3d.position;
    return Math.atan2(at.x, -at.z);
  }

  beforeEach(() => {
    camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    camera.position.set(0, EYE, 0);
    turn(0);
    figure = new GameObject('SleepDemon');
    figure.object3d.visible = false;
    stamina = new Stamina();
    controller = fakeController();
    terminal = { state: 'idle' };
    // Ducks by source, as Ambience keeps them: 1 lets go.
    ambience = { ducks: new Map() };
    ambience.setDuck = vi.fn((level, source) => {
      if (level < 1) ambience.ducks.set(source, level);
      else ambience.ducks.delete(source);
    });
    demon = new SleepDemon({
      controller, stamina, figure, camera, terminal, ambience,
      sounds: { footstep: fakeSound() },
      rand: () => 0.9,                      // the right-hand side first
    });
    demon.onStart();
  });

  it('ducks nothing while the player is awake, nor before it shows', () => {
    run(10);
    stamina.value = 0.425;
    run(3);
    expect(figure.object3d.visible).toBe(false);
    expect(duck()).toBe(1);
  });

  it('a mild duck when it shows, at the edge of the view', () => {
    stamina.value = 0.425;
    run(4);
    expect(figure.object3d.visible).toBe(true);
    expect(duck()).toBeCloseTo(T.duckEdge, 2);
  });

  it('deepens as the view comes round to it, near-silent at the look, and lets go as it flees', () => {
    stamina.value = 0.12;                   // the cone has closed to ~16°
    run(2);
    const at = shownAt();
    expect(at).toBeGreaterThan(demon.logic.focus);   // it shows outside the look: the periphery
    const levels = [];
    for (const off of [28 * DEG, 22 * DEG, demon.logic.focus + 0.3 * DEG]) {
      turn(at - off);
      run(0.1);
      expect(figure.object3d.visible).toBe(true);
      levels.push(duck());
    }
    expect(levels[0]).toBeLessThan(T.duckEdge);
    expect(levels[1]).toBeLessThan(levels[0]);
    expect(levels[2]).toBeLessThan(levels[1]);
    expect(levels[2]).toBeCloseTo(T.duckFloor, 1);

    turn(at);                               // the look: it has fled
    run(T.fadeOut + 0.1);                   // faded away, the duck already let go
    expect(figure.object3d.visible).toBe(false);
    expect(duck()).toBe(1);
  });

  it('turned away from, out of view: no duck', () => {
    stamina.value = 0.425;
    run(4);
    turn(Math.PI);
    run(0.5);
    expect(duck()).toBe(1);
  });

  it('while the terminal screen covers the view, the mild duck holds', () => {
    stamina.value = 0.425;
    run(4);
    terminal.state = 'radar';
    turn(shownAt());
    run(1);
    expect(figure.object3d.visible).toBe(true);
    expect(duck()).toBeCloseTo(T.duckEdge);
  });

  it('lets go in the morning and behind the failed-night prompt', () => {
    for (const state of ['morning', 'gameOver']) {
      controller.state = 'playing';
      stamina.value = 0.425;
      run(8);
      expect(duck(), state).toBeLessThan(1);
      controller.state = state;
      run(0.1);
      expect(duck(), state).toBe(1);
    }
  });

  it('lets go on a new or retried night, and when destroyed', () => {
    stamina.value = 0.425;
    run(4);
    expect(duck()).toBeLessThan(1);
    stamina.reset();
    controller.startNight(1, { retry: true });
    expect(duck()).toBe(1);

    stamina.value = 0.425;
    run(4);
    expect(duck()).toBeLessThan(1);
    demon.onDestroy();
    expect(duck()).toBe(1);
  });

  it('runs without an ambience to duck', () => {
    const quiet = new SleepDemon({
      controller: fakeController(), stamina, figure: new GameObject('SleepDemon'), camera,
    });
    quiet.onStart();
    stamina.value = 0.425;
    expect(() => { for (let i = 0; i < 60; i++) quiet.onUpdate(0.1); }).not.toThrow();
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
      sounds: { footstep: fakeSound() },
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
