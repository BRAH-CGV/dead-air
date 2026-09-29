import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../../test/fakeRapier.js')).rapierModule());

import { MainOffice } from '../../scenes/rooms/MainOffice.js';
import { LivingQuarters } from '../../scenes/rooms/LivingQuarters.js';
import { makeEngine } from '../../test/fakeRapier.js';
import { GameObject } from '../../core/GameObject.js';
import { terrainHeightAt } from '../../gameobjects/MarsTerrain.js';
import { Stamina } from '../Stamina.js';
import { SleepDemon, SLEEP_DEMON_KILL } from './SleepDemon.js';
import { SLEEP_DEMON as T } from './SleepDemonLogic.js';

// Real rooms, moved off the origin so every anchor goes through a transform.
const OFFICE = [5, 0, -3];
const QUARTERS = [-6, 0, -3];
const EYE = 1.24;

describe('SleepDemon', () => {
  let office, quarters, camera, figure, stamina, controller, terminal, ctx, demon;

  /** Stand at a room-local spot in the office and look at another. */
  function look(from, at) {
    camera.position.set(from[0] + OFFICE[0], from[1] + OFFICE[1], from[2] + OFFICE[2]);
    camera.lookAt(at[0] + OFFICE[0], at[1] + OFFICE[1], at[2] + OFFICE[2]);
    camera.updateMatrixWorld(true);
  }
  const lookAway = () => look([0, EYE, 0], [10, EYE, 0]);   // toward the server room: every anchor is behind

  function anchorWorld(room, name) {
    return new THREE.Vector3(...room.threatAnchors[name]).applyMatrix4(room.root.object3d.matrixWorld);
  }

  function run(seconds, dt = 0.1) {
    for (let t = 0; t < seconds - 1e-9; t += dt) demon.update(dt);
  }

  beforeEach(() => {
    office = new MainOffice(makeEngine(), { position: OFFICE });
    office.build();
    quarters = new LivingQuarters(makeEngine(), { position: QUARTERS, doorOffset: 1 });
    quarters.build();
    for (const r of [office, quarters]) r.root.object3d.updateMatrixWorld(true);

    camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 200);
    figure = new GameObject('SleepDemon');
    figure.object3d.visible = false;
    stamina = new Stamina();
    controller = { fail: vi.fn() };
    terminal = { state: 'idle' };
    ctx = {
      engine: { camera }, rooms: { MainOffice: office, LivingQuarters: quarters },
      stamina, controller, scene: { terminal },
    };
    demon = new SleepDemon({ figure });
    lookAway();
    demon.start(ctx);
  });

  it('tells the player to eat, and that it moves when they are not looking', () => {
    expect(demon.objective).toMatch(/ration|dispenser|eat/i);
    expect(demon.objective).toMatch(/not looking|aren't looking/i);
  });

  it('stays hidden while the player is awake', () => {
    run(60);
    expect(figure.object3d.visible).toBe(false);
    expect(demon.logic.stage).toBe(0);
  });

  it('first appears out in the dust beyond the office window, feet on the ground', () => {
    stamina.value = 0.8;
    run(T.moveInterval + 0.2);
    expect(demon.logic.stage).toBe(1);
    expect(figure.object3d.visible).toBe(true);
    const spot = anchorWorld(office, 'outsideWindow');
    const at = figure.object3d.position;
    expect(at.x).toBeCloseTo(spot.x);
    expect(at.z).toBeCloseTo(spot.z);
    expect(at.y).toBeCloseTo(terrainHeightAt(spot.x, spot.z));
  });

  it('walks the anchors in order: the quarters corridor, the left doorway, the corner', () => {
    stamina.value = 0.3;                    // band 4
    const expected = [
      [quarters, 'corridorEnd'], [office, 'leftDoorway'], [office, 'cornerBehindDesk'],
    ];
    run(T.moveInterval + 0.2);
    for (const [room, name] of expected) {
      run(T.moveInterval + 0.2);          // a frame of slack: 0.1 s frames sum just under 8
      const spot = anchorWorld(room, name);
      expect(figure.object3d.position.distanceTo(spot), name).toBeLessThan(1e-6);
    }
    expect(demon.logic.stage).toBe(4);
  });

  it('stage 5 is right behind the player, 1.5 m back, on the floor', () => {
    stamina.value = 0.1;
    run(5 * T.moveInterval + 0.5);
    expect(demon.logic.stage).toBe(5);
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const at = figure.object3d.position;
    expect(Math.hypot(at.x - eye.x, at.z - eye.z)).toBeCloseTo(T.behindDistance);
    // Behind: the view looks +X, so it stands at −X.
    expect(at.x).toBeLessThan(eye.x);
    expect(at.y).toBeCloseTo(terrainHeightAt(at.x, at.z));
  });

  it('turns to face the player', () => {
    stamina.value = 0.3;
    run(4 * T.moveInterval + 0.5);
    const at = figure.object3d.position;
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(figure.object3d.quaternion);
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const toEye = new THREE.Vector3(eye.x - at.x, 0, eye.z - at.z).normalize();
    expect(facing.dot(toEye)).toBeGreaterThan(0.99);
  });

  it('sees a spot in the view (with a margin), not one behind or out of range', () => {
    look([0, EYE, 0], office.threatAnchors.cornerBehindDesk.map((v, i) => (i === 1 ? EYE : v)));
    expect(demon.canSee(4)).toBe(true);
    expect(demon.canSee(3)).toBe(false);    // the left doorway is behind
    expect(demon.canSee(0)).toBe(false);    // nowhere is never in view
  });

  it('never moves while the player watches where it is going', () => {
    look([0, EYE, 0], [-2.2, EYE, -9]);     // out of the window, at stage 1's spot
    stamina.value = 0.8;
    run(3 * T.moveInterval);
    expect(demon.logic.stage).toBe(0);
    lookAway();
    run(0.2);
    expect(demon.logic.stage).toBe(1);
  });

  it('the terminal screen covers the view: it moves while the player works', () => {
    look([0, EYE, 0], [-2.2, EYE, -9]);
    terminal.state = 'radar';
    stamina.value = 0.8;
    run(T.moveInterval + 0.2);
    expect(demon.logic.stage).toBe(1);
  });

  it('ends the night when the player runs out of stamina', () => {
    stamina.value = 0;
    run(0.1);
    expect(controller.fail).toHaveBeenCalledWith(SLEEP_DEMON_KILL);
    expect(SLEEP_DEMON_KILL).toBe('You fell asleep. It was waiting.');
  });

  it('stop() hides it; a new night starts it back at nothing', () => {
    stamina.value = 0.5;
    run(3 * T.moveInterval + 0.5);
    expect(figure.object3d.visible).toBe(true);
    demon.stop();
    expect(figure.object3d.visible).toBe(false);
    stamina.reset();
    demon.start(ctx);
    expect(demon.logic.stage).toBe(0);
    expect(figure.object3d.visible).toBe(false);
  });
});
