import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { RoomTransitionSystem } from '../components/RoomTransitionSystem.js';
import { Satellite } from '../gameobjects/Satellite.js';
import { makeEngine } from '../test/fakeRapier.js';

const EPS = 1e-6;

function makeSceneEngine() {
  const engine = makeEngine();
  engine.scene = new THREE.Scene();
  engine.assets = { get: vi.fn(() => null) };
  engine.buildPlayer = vi.fn(({ position = [0, 1, 5] } = {}) => {
    const player = new GameObject('Player');
    player.object3d.position.set(...position);
    engine.player = player;
    engine._rootObjects.push(player);
    return player;
  });
  return engine;
}

function worldPos(go) {
  return go.object3d.getWorldPosition(new THREE.Vector3());
}

/** Do two boxes share volume (not just a face)? */
function overlaps(a, b) {
  return a.min.x < b.max.x - EPS && b.min.x < a.max.x - EPS
      && a.min.y < b.max.y - EPS && b.min.y < a.max.y - EPS
      && a.min.z < b.max.z - EPS && b.min.z < a.max.z - EPS;
}

describe('BaseScene', () => {
  let engine, scene, sceneRoot;

  beforeEach(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
    sceneRoot = engine._rootObjects.find(go => go.name === 'SceneRoot');
  });

  it('creates all three rooms under SceneRoot', () => {
    expect(sceneRoot).toBeDefined();
    const names = sceneRoot.children.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['Room:MainOffice', 'Room:ServerRoom', 'Room:LivingQuarters']));
    expect(Object.keys(scene.rooms).sort()).toEqual(['LivingQuarters', 'MainOffice', 'ServerRoom']);
  });

  it('keeps the office at the origin', () => {
    expect(scene.rooms.MainOffice.position).toEqual([0, 0, 0]);
  });

  it('creates corridors connecting the office to each side room', () => {
    const corridors = sceneRoot.find('Corridors');
    expect(corridors.isGroup).toBe(true);
    expect(corridors.children.map(c => c.name).sort())
      .toEqual(['Corridor:OfficeToQuarters', 'Corridor:OfficeToServer']);
  });

  it('corridor ends sit flush on the room walls they join', () => {
    const office = scene.rooms.MainOffice.bounds();
    const server = scene.rooms.ServerRoom.bounds();
    const quarters = scene.rooms.LivingQuarters.bounds();
    const toServer = scene.corridors.OfficeToServer.bounds();
    const toQuarters = scene.corridors.OfficeToQuarters.bounds();

    expect(toServer.min.x).toBeCloseTo(office.max.x);
    expect(toServer.max.x).toBeCloseTo(server.min.x);
    expect(toQuarters.max.x).toBeCloseTo(office.min.x);
    expect(toQuarters.min.x).toBeCloseTo(quarters.max.x);
  });

  it('doorways at both ends of each corridor line up with the corridor', () => {
    const door = (room, target) => scene.rooms[room].doors.find(d => d.targetRoom === target);
    const pairs = [
      [door('MainOffice', 'ServerRoom'),     door('ServerRoom', 'MainOffice'),     scene.corridors.OfficeToServer],
      [door('MainOffice', 'LivingQuarters'), door('LivingQuarters', 'MainOffice'), scene.corridors.OfficeToQuarters],
    ];
    for (const [a, b, corridor] of pairs) {
      expect(worldPos(a).z).toBeCloseTo(worldPos(b).z);
      expect(worldPos(a).z).toBeCloseTo(corridor.position[2]);
      // The door fits inside the corridor's clear width
      expect(a.doorSize[0]).toBeLessThan(corridor.corridorWidth - corridor.wallThick);
    }
  });

  it('no two rooms or corridors share volume', () => {
    const parts = [...Object.values(scene.rooms), ...Object.values(scene.corridors)];
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        expect(overlaps(parts[i].bounds(), parts[j].bounds()), `${parts[i].name} × ${parts[j].name}`).toBe(false);
      }
    }
  });

  it('spawns the player inside the main office', () => {
    expect(engine.buildPlayer).toHaveBeenCalledTimes(1);
    expect(scene.rooms.MainOffice.containsPoint(worldPos(engine.player))).toBe(true);
  });

  it('gives the player a RoomTransitionSystem that knows every door and room', () => {
    const sys = engine.player.getComponent(RoomTransitionSystem);
    expect(sys).not.toBeNull();
    const allDoors = Object.values(scene.rooms).flatMap(r => r.doors);
    expect(allDoors.length).toBe(5);
    expect(sys.doors).toEqual(expect.arrayContaining(allDoors));
    expect(sys.rooms).toEqual(expect.arrayContaining(Object.values(scene.rooms)));
  });

  it('builds one shared ground with a collider flush at y = 0 and the mesh just below', () => {
    const ground = sceneRoot.find('Ground');
    expect(ground.rigidBody).toBeTruthy();
    const h = ground.collider.halfExtents();
    expect(ground.rigidBody.translation().y + h.y).toBeCloseTo(0);
    const mesh = ground.object3d.children.find(o => o.isMesh);
    const y = mesh.position.y + ground.object3d.position.y;
    // Below the room floors (so they never z-fight), but imperceptibly.
    expect(y).toBeLessThan(0);
    expect(y).toBeGreaterThan(-0.05);
  });

  it('adds global ambient and moon light', () => {
    const lighting = sceneRoot.find('Lighting');
    let ambient = 0, moon = 0;
    lighting.object3d.traverse(o => { if (o.isAmbientLight) ambient++; if (o.isDirectionalLight) moon++; });
    expect(ambient).toBe(1);
    expect(moon).toBe(1);
  });

  it('moon shadows cover the whole base', () => {
    let moon;
    sceneRoot.find('Lighting').object3d.traverse(o => { if (o.isDirectionalLight) moon = o; });
    const cam = moon.shadow.camera;
    const extent = Math.max(...[...Object.values(scene.rooms)].map(r => Math.abs(r.bounds().max.x)));
    expect(cam.right).toBeGreaterThanOrEqual(extent);
    expect(-cam.left).toBeGreaterThanOrEqual(extent);
  });

  it('builds the outside area: satellite and generator stand-in, outside every room', () => {
    const outside = sceneRoot.find('Outside');
    const satCall = engine.spawnModel.mock.calls.find(([key]) => key === 'model:dish_tower');
    expect(satCall[1].type).toBe(Satellite);
    expect(outside.find('Satellite')).not.toBeNull();

    const generator = outside.find('Generator');
    expect(generator.placeholderFor).toBe('generator.glb');
    for (const room of Object.values(scene.rooms)) {
      expect(room.containsPoint(worldPos(generator)), room.name).toBe(false);
    }
  });

  it('dispose tears down every room and corridor', () => {
    const disposers = [...Object.values(scene.rooms), ...Object.values(scene.corridors)]
      .map(part => vi.spyOn(part, 'dispose'));
    scene.dispose();
    for (const spy of disposers) expect(spy).toHaveBeenCalled();
    expect(sceneRoot.children.filter(c => /^(Room|Corridor):/.test(c.name))).toEqual([]);
  });
});
