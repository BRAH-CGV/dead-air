import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@dimforge/rapier3d', async () => (await import('../test/fakeRapier.js')).rapierModule());

import { BaseScene } from './BaseScene.js';
import { GameObject } from '../core/GameObject.js';
import { RoomTransitionSystem } from '../components/RoomTransitionSystem.js';
import { Satellite } from '../gameobjects/Satellite.js';
import { Fullbright } from '../core/Fullbright.js';
import { Interactable } from '../components/Interactable.js';
import { SkyFollow } from '../components/SkyFollow.js';
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

  it('stands the whole base on the Mars valley, one terrain for the scene', () => {
    const terrain = sceneRoot.find('MarsTerrain');
    expect(terrain).toBeTruthy();
    // The flat plane it replaced is gone, not left underneath it.
    expect(sceneRoot.find('Ground')).toBeFalsy();

    // Its collider is a heightfield sampled on the mesh's own grid, so what
    // you walk on is what you see. Rapier wants an (nrows+1) x (ncols+1)
    // matrix and traps on an unreachable if the count is off.
    const hf = terrain.collider.heightfield;
    expect(hf).toBeTruthy();
    expect(hf.heights.length).toBe((hf.nrows + 1) * (hf.ncols + 1));
    // Far wider than the base's ~33 m footprint, so nobody walks off an edge.
    expect(hf.scale.x).toBeGreaterThan(200);
    expect(hf.scale.z).toBeGreaterThan(200);
  });

  it('keeps the valley collider flush with the room floors and dips only the mesh', () => {
    const terrain = sceneRoot.find('MarsTerrain');
    // The body stays at y = 0 with the floor slabs, so walking out of the
    // front door is step-free...
    expect(terrain.rigidBody.translation().y).toBeCloseTo(0);
    // ...while the mesh sits imperceptibly below them, because coplanar faces
    // z-fight across every floor in the base.
    expect(terrain.object3d.position.y).toBeLessThan(0);
    expect(terrain.object3d.position.y).toBeGreaterThan(-0.05);
  });

  it('hangs a sky that rides the camera and tints the fog to its horizon', () => {
    const sky = sceneRoot.find('MarsSky');
    expect(sky).toBeTruthy();
    // The dome has a finite radius, so it has to follow the camera or the
    // player walks out through it.
    expect(sky.getComponent(SkyFollow)).toBeTruthy();
    // Fog fades the terrain to its own colour long before the dome starts;
    // a mismatch draws a seam along the horizon.
    expect(engine.scene.fog.color.getHex()).toBe(0x3a2820);
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

  it('starts at the outdoor fog density, thin enough to see the valley rim', () => {
    // RoomTransitionSystem only reports a room on its first update, and the
    // player spawns facing the office window — the scene cannot be left on
    // whatever density the engine happened to hand it.
    expect(engine.scene.fog.density).toBeLessThan(0.005);
  });

  it('thickens the fog in the sealed rooms, server room densest', () => {
    const sys = engine.player.getComponent(RoomTransitionSystem);
    const outdoor = engine.scene.fog.density;

    sys.onRoomChange(scene.rooms.ServerRoom, scene.rooms.MainOffice);
    const server = engine.scene.fog.density;

    sys.onRoomChange(scene.rooms.LivingQuarters, scene.rooms.ServerRoom);
    const quarters = engine.scene.fog.density;

    // Both are sealed, so both are free to be thick for mood; the server room
    // is the thicker of the two.
    expect(server).toBeGreaterThan(quarters);
    expect(quarters).toBeGreaterThan(outdoor);
  });

  it('gives any room with a window the outdoor density, whatever its name', () => {
    const sys = engine.player.getComponent(RoomTransitionSystem);
    const outdoor = engine.scene.fog.density;

    // The office's back wall is an 8.5 m window onto the valley, whose ridge
    // line is 350-500 m out. Indoor fog would erase it.
    expect(scene.rooms.MainOffice.openings.some(o => (o.sill ?? 0) > 0)).toBe(true);
    sys.onRoomChange(scene.rooms.ServerRoom, null);
    sys.onRoomChange(scene.rooms.MainOffice, scene.rooms.ServerRoom);
    expect(engine.scene.fog.density).toBeCloseTo(outdoor);

    // Read off the openings, not a name list: give a sealed room a window and
    // its fog follows without anyone editing BaseScene.
    scene.rooms.ServerRoom.openings.push({ side: 'back', width: 2, height: 1.2, sill: 1 });
    sys.onRoomChange(scene.rooms.ServerRoom, scene.rooms.MainOffice);
    expect(engine.scene.fog.density).toBeCloseTo(outdoor);
  });

  it('uses the outdoor density in corridors and outside (room = null)', () => {
    const sys = engine.player.getComponent(RoomTransitionSystem);
    const outdoor = engine.scene.fog.density;

    sys.onRoomChange(scene.rooms.ServerRoom, scene.rooms.MainOffice);
    sys.onRoomChange(null, scene.rooms.ServerRoom);
    expect(engine.scene.fog.density).toBeCloseTo(outdoor);
  });

  it('hands the fog back on dispose so it does not follow us into the next scene', () => {
    scene.dispose();
    // What makeSceneEngine handed the scene, untouched.
    expect(engine.scene.fog.color.getHex()).toBe(0x1a1a2e);
    expect(engine.scene.fog.density).toBeCloseTo(0.02);
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
