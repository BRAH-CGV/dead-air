import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { RoomTransitionSystem } from '../components/RoomTransitionSystem.js';
import { Satellite } from '../gameobjects/Satellite.js';
import { Fullbright } from '../core/Fullbright.js';
import { Interactable } from '../components/Interactable.js';
import { makeEngine } from '../test/fakeRapier.js';

const EPS = 1e-6;

function makeSceneEngine() {
  const engine = makeEngine();
  engine.scene = new THREE.Scene();
  engine.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);
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

  it('the generator is a raycastable Interactable stub that toggles power (phase 10)', () => {
    const generator = sceneRoot.find('Outside').find('Generator');
    const interactable = generator.getComponent(Interactable);
    expect(interactable).not.toBeNull();
    expect(engine._bodyToGO.get(generator.rigidBody.handle)).toBe(generator);

    expect(generator.powerOn).toBe(true);
    interactable.onInteract({});
    expect(generator.powerOn).toBe(false);
    interactable.onInteract({});
    expect(generator.powerOn).toBe(true);
  });

  it('starts on night 1 with every doorway out of the office locked', () => {
    expect(scene.nights.currentNight).toBe(1);
    const doors = Object.values(scene.rooms).flatMap(r => r.doors);
    for (const d of doors) expect(d.locked, d.name).toBe(true);
  });

  it('advancing the night unlocks the server room corridor, both ends', () => {
    scene.nights.advance();
    const office = scene.rooms.MainOffice.doors;
    expect(office.find(d => d.targetRoom === 'ServerRoom').locked).toBe(false);
    expect(scene.rooms.ServerRoom.doors[0].locked).toBe(false);
    expect(office.find(d => d.targetRoom === 'LivingQuarters').locked).toBe(true);
    expect(office.find(d => d.targetRoom === 'Outside').locked).toBe(true);
  });

  it('sets denser fog in the server room and lighter fog in living quarters', () => {
    const sys = engine.player.getComponent(RoomTransitionSystem);
    const base = engine.scene.fog.density;

    sys.onRoomChange(scene.rooms.ServerRoom, scene.rooms.MainOffice);
    expect(engine.scene.fog.density).toBeGreaterThan(base);

    sys.onRoomChange(scene.rooms.LivingQuarters, scene.rooms.ServerRoom);
    expect(engine.scene.fog.density).toBeLessThan(base);

    sys.onRoomChange(scene.rooms.MainOffice, scene.rooms.LivingQuarters);
    expect(engine.scene.fog.density).toBeCloseTo(base);
  });

  it('falls back to the default fog density in corridors and outside (room = null)', () => {
    const sys = engine.player.getComponent(RoomTransitionSystem);
    const base = engine.scene.fog.density;

    sys.onRoomChange(scene.rooms.ServerRoom, scene.rooms.MainOffice);
    sys.onRoomChange(null, scene.rooms.ServerRoom);
    expect(engine.scene.fog.density).toBeCloseTo(base);
  });

  it('Fullbright hides every light and swaps every lit material across all three rooms', () => {
    const fb = new Fullbright(engine.scene);

    const lightsBefore = [];
    engine.scene.traverse(o => { if (o.isLight) lightsBefore.push(o); });
    expect(lightsBefore.length).toBeGreaterThan(0);
    for (const room of Object.values(scene.rooms)) {
      let roomLights = 0;
      room.root.object3d.traverse(o => { if (o.isLight) roomLights++; });
      expect(roomLights, `${room.name} should contribute a light`).toBeGreaterThan(0);
    }

    const litMeshesBefore = [];
    engine.scene.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial) litMeshesBefore.push(o); });
    expect(litMeshesBefore.length).toBeGreaterThan(0);

    fb.enable();
    for (const light of lightsBefore) expect(light.visible).toBe(false);
    for (const mesh of litMeshesBefore) expect(mesh.material.isMeshBasicMaterial).toBe(true);

    fb.disable();
    for (const light of lightsBefore) expect(light.visible).toBe(true);
    for (const mesh of litMeshesBefore) expect(mesh.material.isMeshStandardMaterial).toBe(true);
  });

  it('dispose tears down every room and corridor', () => {
    const disposers = [...Object.values(scene.rooms), ...Object.values(scene.corridors)]
      .map(part => vi.spyOn(part, 'dispose'));
    scene.dispose();
    for (const spy of disposers) expect(spy).toHaveBeenCalled();
    expect(sceneRoot.children.filter(c => /^(Room|Corridor):/.test(c.name))).toEqual([]);
  });

  it('door sensors sit in the doorway gap, clear of every wall segment in their room (phase 12)', () => {
    /** World-space AABB of a door's collider box, rotation-aware (side-wall
     *  doors are rotated pi/2, which swaps their world width/depth). */
    function doorBox(door) {
      const p = worldPos(door);
      const [w, h, d] = door.doorSize;
      const rotated = Math.abs(Math.abs(door.object3d.rotation.y) - Math.PI / 2) < 1e-3;
      const [ex, ez] = rotated ? [d, w] : [w, d];
      return new THREE.Box3(
        new THREE.Vector3(p.x - ex / 2, p.y - h / 2, p.z - ez / 2),
        new THREE.Vector3(p.x + ex / 2, p.y + h / 2, p.z + ez / 2),
      );
    }

    /** World-space AABBs of every wall segment mesh under a room. */
    function wallSegmentBoxes(room) {
      const [ox, oy, oz] = room.position;
      return room.root.children
        .filter(go => /Wall/.test(go.name))
        .map(go => {
          const mesh = go.object3d.children.find(c => c.isMesh);
          const { width, height, depth } = mesh.geometry.parameters;
          const p = go.object3d.position;
          return new THREE.Box3(
            new THREE.Vector3(ox + p.x - width / 2, oy + p.y - height / 2, oz + p.z - depth / 2),
            new THREE.Vector3(ox + p.x + width / 2, oy + p.y + height / 2, oz + p.z + depth / 2),
          );
        });
    }

    for (const room of Object.values(scene.rooms)) {
      const walls = wallSegmentBoxes(room);
      for (const door of room.doors) {
        const box = doorBox(door);
        for (let i = 0; i < walls.length; i++) {
          expect(overlaps(box, walls[i]), `${door.name} × wall segment ${i}`).toBe(false);
        }
      }
    }
  });
});

describe('BaseScene build instrumentation (phase 12)', () => {
  it('times the build and logs the body and Object3D counts', () => {
    const engine = makeSceneEngine();
    const scene = new BaseScene(engine);
    const timeSpy = vi.spyOn(console, 'time').mockImplementation(() => {});
    const timeEndSpy = vi.spyOn(console, 'timeEnd').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    scene.build();

    expect(timeSpy).toHaveBeenCalledWith('BaseScene.build');
    expect(timeEndSpy).toHaveBeenCalledWith('BaseScene.build');
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/\d+ (physics )?bod(y|ies)/i));
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/\d+ Object3Ds?/));

    timeSpy.mockRestore();
    timeEndSpy.mockRestore();
    logSpy.mockRestore();
  });
});

describe('BaseScene repeated build/dispose cycles leave no leak (phase 12)', () => {
  it('a second build after dispose ends up with the same body and root-object counts as the first', () => {
    const engine = makeSceneEngine();

    const first = new BaseScene(engine);
    first.build();
    const firstBodies = engine.world.bodies.len();
    const firstRoots = engine._rootObjects.length;
    first.dispose();

    // Mirrors what Engine._teardownScene does between scenes: drop the whole
    // physics world and the root-object bookkeeping, keep everything else.
    engine.world = new (engine.world.constructor)();
    engine._rootObjects.length = 0;
    engine._bodyToGO.clear();

    const second = new BaseScene(engine);
    second.build();

    expect(engine.world.bodies.len()).toBe(firstBodies);
    expect(engine._rootObjects.length).toBe(firstRoots);
  });
});
