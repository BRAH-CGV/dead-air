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
import { GameController } from '../gameplay/GameController.js';
import { ComputerTerminal } from '../components/ComputerTerminal.js';
import { EVASuit } from '../components/EVASuit.js';
import { PRELOAD } from '../assets/manifest.js';
import { Daylight } from '../components/Daylight.js';
import { ScreenFade } from '../ui/ScreenFade.js';
import { ThreatDirector, THREATS_BY_NIGHT } from '../gameplay/ThreatDirector.js';
import { WindowWatchers } from '../gameplay/threats/WindowWatchers.js';
import { CameraEntity } from '../gameplay/threats/CameraEntity.js';
import { SleepDemon } from '../gameplay/threats/SleepDemon.js';
import { Stamina } from '../gameplay/Stamina.js';
import { StaminaDrain, FATIGUE_DIM_MIN } from '../components/StaminaDrain.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { Ambience } from '../audio/Ambience.js';
import { SoundCues } from '../audio/SoundCues.js';
import { BaseLights } from '../gameplay/BaseLights.js';
import { Power, EMERGENCY_LEVEL } from '../gameplay/Power.js';
import { GeneratorSwitch, RESTORE_POWER } from '../components/GeneratorSwitch.js';
import { CrtScreen } from '../components/CrtScreen.js';
import { Oxygen } from '../gameplay/Oxygen.js';
import { OxygenSupply, OXYGEN_KILL } from '../components/OxygenSupply.js';

// A full base build takes several seconds under jsdom (8–16 s when the
// suite runs in parallel), past vitest's 5 s test and 10 s hook defaults.
// Those timeouts were failing tests that pass on their own, so this file
// gets a longer budget.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

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

  it('creates all four rooms under SceneRoot', () => {
    expect(sceneRoot).toBeDefined();
    const names = sceneRoot.children.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['Room:MainOffice', 'Room:ServerRoom', 'Room:LivingQuarters', 'Room:Airlock']));
    expect(Object.keys(scene.rooms).sort()).toEqual(['Airlock', 'LivingQuarters', 'MainOffice', 'ServerRoom']);
  });

  it('butts the airlock flush on the office front wall, lined up with its front doorway', () => {
    const office = scene.rooms.MainOffice;
    const airlock = scene.rooms.Airlock;
    expect(airlock.bounds().min.z).toBeCloseTo(office.bounds().max.z);

    const door = office.doors.find(d => d.targetRoom === 'Airlock');
    expect(door).toBeDefined();
    expect(worldPos(door).x).toBeCloseTo(airlock.position[0]);
    expect(worldPos(airlock.hatch).x).toBeCloseTo(airlock.position[0]);
    expect(door.doorSize[0]).toBeLessThan(airlock.corridorWidth - airlock.wallThick);
  });

  it('the airlock hatch is the only way outside, and it opens for the player in the EVA suit', () => {
    const outward = Object.values(scene.rooms).flatMap(r => r.doors).filter(d => d.targetRoom === 'Outside');
    expect(outward).toEqual([scene.rooms.Airlock.hatch]);

    expect(scene.suit).toBeInstanceOf(EVASuit);
    expect(engine.player.getComponent(EVASuit)).toBe(scene.suit);

    const airlock = scene.rooms.Airlock;
    const { hatch } = airlock;
    const cycle = () => { for (let i = 0; i < Math.ceil((airlock.cycleTime + 0.1) * 60); i++) airlock.update(1 / 60); };
    expect(hatch.locked).toBe(true);
    scene.suit.putOn();
    cycle();
    expect(hatch.locked).toBe(false);
    scene.suit.takeOff();
    expect(hatch.locked).toBe(true);
  });

  it("the office's front door is the airlock's inner door: it shuts behind the suit before the hatch opens", () => {
    const airlock = scene.rooms.Airlock;
    const inner = scene.rooms.MainOffice.doors.find(d => d.targetRoom === 'Airlock');
    expect(airlock.innerDoor).toBe(inner);
    expect(inner.locked).toBe(false);

    scene.suit.putOn();
    expect(inner.locked).toBe(true);
    expect(airlock.hatch.locked).toBe(true);
    for (let i = 0; i < Math.ceil((airlock.cycleTime + 0.1) * 60); i++) airlock.update(1 / 60);
    expect(airlock.hatch.locked).toBe(false);
    expect(inner.locked).toBe(true);
  });

  it('spawns only preloaded models, so nothing is fetched mid-build', () => {
    // The real AssetManager throws on a model that isn't in the cache, and
    // the cache only holds PRELOAD. A key left in the manifest's LIBRARY
    // passes these tests (spawnModel is faked) and breaks the game at boot.
    const spawned = new Set(engine.spawnModel.mock.calls.map(([key]) => key));
    const missing = [...spawned].filter(key => !PRELOAD.includes(key));
    expect(missing).toEqual([]);
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
    expect(allDoors.length).toBe(6);
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
    expect(engine.scene.fog.color.getHex()).toBe(0x1f2a38);
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

  it('builds the outside area: satellite and generator, outside every room', () => {
    const outside = sceneRoot.find('Outside');
    const satCall = engine.spawnModel.mock.calls.find(([key]) => key === 'model:dish-tower');
    expect(satCall[1].type).toBe(Satellite);
    expect(outside.find('Satellite')).not.toBeNull();

    const genCall = engine.spawnModel.mock.calls.find(([key]) => key === 'model:generator');
    expect(genCall[1].name).toBe('Generator');
    const generator = outside.find('Generator');
    expect(generator).toBe(scene.generator);
    for (const room of Object.values(scene.rooms)) {
      expect(room.containsPoint(worldPos(generator)), room.name).toBe(false);
    }
  });

  it('clears the scenery yard from the rooms themselves, not a guessed radius', () => {
    // The whole point of measuring: move a room and the cleared ground moves
    // with it. A hard-coded radius would silently plant rocks in a wall.
    const footprint = scene._baseFootprint();
    let halfX = 0;
    let halfZ = 0;
    for (const part of [...Object.values(scene.rooms), ...Object.values(scene.corridors)]) {
      const b = part.bounds();
      halfX = Math.max(halfX, Math.abs(b.min.x), Math.abs(b.max.x));
      halfZ = Math.max(halfZ, Math.abs(b.min.z), Math.abs(b.max.z));
    }
    expect(footprint.halfX).toBeCloseTo(halfX);
    expect(footprint.halfZ).toBeCloseTo(halfZ);
    // The base is far wider than it is deep, which is why a circle was wrong.
    expect(footprint.halfX).toBeGreaterThan(footprint.halfZ * 2);
  });

  it('stands the rock field and vegetation belt outside, clear of the base', () => {
    const outside = sceneRoot.find('Outside');
    for (const name of ['MarsRocks', 'MarsVegetation']) {
      const field = outside.find(name);
      expect(field, name).not.toBeNull();
      // Groups, so the editor neither lists every blade nor measures a
      // bounding box the size of the valley.
      expect(field.isGroup, name).toBe(true);
    }
  });

  it("the generator is a raycastable lever on the base's power", () => {
    const generator = sceneRoot.find('Outside').find('Generator');
    const lever = generator.getComponent(Interactable);
    expect(lever).toBeInstanceOf(GeneratorSwitch);
    expect(engine._bodyToGO.get(generator.rigidBody.handle)).toBe(generator);

    expect(scene.power.on).toBe(true);
    lever.onInteract({});
    expect(scene.power.on).toBe(false);
    lever.onInteract({});
    expect(scene.power.on).toBe(true);
  });

  it('opens every interior door from night 1, and keeps them open every night', () => {
    // Nights bring threats, not keys: the base is walkable from the start.
    // Only a door onto the surface may be shut, and not by the calendar.
    const interior = Object.values(scene.rooms).flatMap(r => r.doors)
      .filter(d => d.targetRoom !== 'Outside');
    expect(interior.length).toBeGreaterThan(0);

    expect(scene.nights.currentNight).toBe(1);
    for (const night of [1, 2, 3]) {
      scene.nights.setNight(night);
      for (const d of interior) expect(d.locked, `${d.name} on night ${night}`).toBe(false);
    }
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

// ─────────────────────────────────────────────
// Gameplay loop wiring
// ─────────────────────────────────────────────
// The signal-collection loop was built against OfficeScene, which the base
// replaced as the loaded scene. These pin it to BaseScene so it cannot be
// orphaned by the next scene swap.

describe('BaseScene gameplay loop', () => {
  let engine, scene;

  beforeEach(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
  });

  it('builds the night clock, signal manager and game controller', () => {
    expect(scene.nightClock).toBeDefined();
    expect(scene.signalManager).toBeDefined();
    expect(scene.gameController).toBeInstanceOf(GameController);
  });

  it('draws signal payloads from a pool of relative image paths', () => {
    for (const url of scene.signalManager.payloadPool) {
      expect(url.startsWith('/')).toBe(false);
      expect(url).toMatch(/^assets\/signals\/signal-\d+\.png$/);
    }
  });

  it('attaches the terminal to the office computer desk', () => {
    const desk = scene.rooms.MainOffice.root.find('ComputerDesk');
    expect(desk.getComponent(ComputerTerminal)).toBe(scene.terminal);
  });

  it('gives the desk one Interactable, and it opens the terminal', () => {
    const desk = scene.rooms.MainOffice.root.find('ComputerDesk');
    const interactables = desk.components.filter(c => c instanceof Interactable);
    expect(interactables.length).toBe(1);

    interactables[0].onInteract({});
    expect(scene.terminal.state).toBe('radar');
  });

  it('wires the terminal to the satellite, signals and UI', () => {
    expect(scene.terminal.satellite).toBe(scene.satellite);
    expect(scene.terminal.signalManager).toBe(scene.signalManager);
    expect(scene.terminal.hud).toBe(scene.hud);
    expect(scene.terminal.radar).toBe(scene.radarOverlay);
    expect(scene.terminal.reviewPanel).toBe(scene.reviewPanel);
  });

  it('runs the game controller as a component under SceneRoot, so it ticks', () => {
    const sceneRoot = engine._rootObjects.find(go => go.name === 'SceneRoot');
    const gameplay = sceneRoot.find('GameplaySystems');
    expect(gameplay).not.toBeNull();
    expect(gameplay.getComponent(GameController)).toBe(scene.gameController);

    expect(scene.gameController.nightClock).toBe(scene.nightClock);
    expect(scene.gameController.signalManager).toBe(scene.signalManager);
    expect(scene.gameController.satellite).toBe(scene.satellite);
    expect(scene.gameController.terminal).toBe(scene.terminal);
    expect(scene.gameController.hud).toBe(scene.hud);
  });

  it('routes the review panel buttons through the terminal and the controller', () => {
    const saved = vi.spyOn(scene.terminal, 'saveSignal').mockImplementation(() => {});
    const deleted = vi.spyOn(scene.terminal, 'deleteSignal').mockImplementation(() => {});
    const onSaved = vi.spyOn(scene.gameController, 'onSignalSaved').mockImplementation(() => {});
    const onDeleted = vi.spyOn(scene.gameController, 'onSignalDeleted').mockImplementation(() => {});

    scene.reviewPanel._saveCb();
    expect(saved).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();

    scene.reviewPanel._deleteCb();
    expect(deleted).toHaveBeenCalled();
    expect(onDeleted).toHaveBeenCalled();
  });

  it('starts the controller on the night the NightManager is actually on', () => {
    expect(scene.gameController.autoStart).toBe(false);
    expect(scene.gameController.nightNumber).toBe(scene.nights.currentNight);
    expect(scene.gameController.state).toBe('playing');
  });

  it('follows the NightManager when the night advances, so there is one night number', () => {
    scene.nights.advance();
    expect(scene.gameController.nightNumber).toBe(scene.nights.currentNight);
  });

  /** Save the night's whole quota and run the clock out: it is morning. */
  function workTheShift() {
    const { signalManager, gameController } = scene;
    for (let id = 1; id <= signalManager.required; id++) signalManager.saveSignal(id);
    gameController.onSignalSaved();
    gameController.onUpdate(999);
    expect(gameController.state).toBe('morning');
  }

  it('the bunk sleeps through the day to the next night, in step across NightManager, controller and HUD', () => {
    const bed = scene.rooms.LivingQuarters.bed;
    expect(bed.controller).toBe(scene.gameController);
    expect(bed.fade).toBeInstanceOf(ScreenFade);
    const setNight = vi.spyOn(scene.hud, 'setNight');

    workTheShift();
    bed.onUpdate(0.016);
    expect(bed.promptLabel).toBe('[E] Sleep');

    bed.onInteract({});                  // no DOM: the fade goes black at once
    expect(scene.nights.currentNight).toBe(2);
    expect(scene.gameController.nightNumber).toBe(2);
    expect(scene.gameController.state).toBe('playing');
    expect(setNight).toHaveBeenLastCalledWith(2);
    expect(scene.nightClock.timeString).toBe('12:00 AM');
  });

  it('hangs the night clock on the office wall', () => {
    expect(scene.rooms.MainOffice.wallClock.clock).toBe(scene.nightClock);
  });

  it('turns the night to day and back with the controller — sky, lights and fog', () => {
    const gameplay = engine._rootObjects.find(go => go.name === 'SceneRoot').find('GameplaySystems');
    const daylight = gameplay.getComponent(Daylight);
    expect(daylight).not.toBeNull();
    // Updated after the controller in the same frame, so it never lags a state.
    expect(gameplay.components.indexOf(daylight))
      .toBeGreaterThan(gameplay.components.indexOf(scene.gameController));

    const uDawn = scene.sky.skyUniforms.uDawn;
    const night = { ambient: scene.ambientLight.intensity, sun: scene.moonLight.intensity,
                    fog: engine.scene.fog.color.getHex() };

    daylight.onUpdate(0.016);
    expect(uDawn.value).toBe(0);

    workTheShift();
    daylight.onUpdate(0.016);
    expect(uDawn.value).toBe(1);
    expect(scene.ambientLight.intensity).toBeGreaterThan(night.ambient);
    expect(scene.moonLight.intensity).toBeGreaterThan(night.sun);
    expect(engine.scene.fog.color.getHex()).not.toBe(night.fog);

    scene.rooms.LivingQuarters.bed.onInteract({});
    daylight.onUpdate(0.016);
    expect(uDawn.value).toBe(0);
    expect(scene.ambientLight.intensity).toBe(night.ambient);
    expect(engine.scene.fog.color.getHex()).toBe(night.fog);
  });

  it('turns the sky with the night clock and keeps the moonlight on Phobos', () => {
    const gameplay = engine._rootObjects.find(go => go.name === 'SceneRoot').find('GameplaySystems');
    const daylight = gameplay.getComponent(Daylight);
    const toLight  = () => scene.moonLight.position.clone().sub(scene.moonLight.target.position);

    scene.nightClock.currentTime = 3;
    daylight.onUpdate(0.016);

    expect(scene.sky.hour).toBe(3);
    expect(toLight().length()).toBeCloseTo(30);          // still inside the shadow camera's near/far
    expect(toLight().normalize().distanceTo(scene.sky.directions.phobos)).toBeCloseTo(0, 5);
  });

  it('shows the EVA suit on the HUD while the player wears it', () => {
    const setSuit = vi.spyOn(scene.hud, 'setSuit');
    scene.suit.putOn();
    expect(setSuit).toHaveBeenLastCalledWith(true);
    scene.suit.takeOff();
    expect(setSuit).toHaveBeenLastCalledWith(false);

    // And lets go of the suit on dispose.
    scene.dispose();
    setSuit.mockClear();
    scene.suit.putOn();
    expect(setSuit).not.toHaveBeenCalled();
  });

  it('hides the gameplay UI on dispose, so a scene swap leaves no stale HUD', () => {
    const hidden = [scene.hud, scene.radarOverlay, scene.reviewPanel]
      .map(ui => vi.spyOn(ui, 'hide'));
    scene.dispose();
    for (const spy of hidden) expect(spy).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// Threats
// ─────────────────────────────────────────────
describe('BaseScene threats', () => {
  let engine, scene, gameplay;

  beforeEach(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
    gameplay = engine._rootObjects.find(go => go.name === 'SceneRoot').find('GameplaySystems');
  });

  it('runs the ThreatDirector after the controller, with the scene context', () => {
    const director = gameplay.getComponent(ThreatDirector);
    expect(director).toBe(scene.threatDirector);
    // Updated after the controller in the same frame, so it never lags a state.
    expect(gameplay.components.indexOf(director))
      .toBeGreaterThan(gameplay.components.indexOf(scene.gameController));

    const ctx = director.context;
    expect(ctx.engine).toBe(engine);
    expect(ctx.scene).toBe(scene);
    expect(ctx.controller).toBe(scene.gameController);
    expect(ctx.player).toBe(engine.player);
    expect(ctx.rooms).toBe(scene.rooms);
    expect(ctx.transitions).toBeInstanceOf(RoomTransitionSystem);
    expect(ctx.transitions).toBe(engine.player.getComponent(RoomTransitionSystem));
  });

  it('keeps the per-room fog when the room-change callback is shared', () => {
    const fog = engine.scene.fog;
    scene.transitions.onRoomChange(scene.rooms.ServerRoom, null);
    expect(fog.density).toBeCloseTo(0.03);
  });

  it('hangs a Threats group under SceneRoot for the monsters', () => {
    const sceneRoot = engine._rootObjects.find(go => go.name === 'SceneRoot');
    expect(sceneRoot.find('Threats')).not.toBeNull();
  });

  it("registers night 2's window watcher: a hidden figure under Threats, not a body", () => {
    const threat = scene.threatDirector.threats.get('windowWatchers');
    expect(threat).toBeInstanceOf(WindowWatchers);
    expect(THREATS_BY_NIGHT[2]).toContain('windowWatchers');

    const sceneRoot = engine._rootObjects.find(go => go.name === 'SceneRoot');
    const figure = sceneRoot.find('Threats').find('WindowWatcher');
    expect(figure).toBe(threat.figure);
    expect(figure.object3d.visible).toBe(false);
    expect(figure.rigidBody).toBeNull();
  });

  it("registers night 1's sleep demon: a hidden figure under Threats, not a body, reading the scene's stamina", () => {
    const threat = scene.threatDirector.threats.get('sleepDemon');
    expect(threat).toBeInstanceOf(SleepDemon);
    expect(THREATS_BY_NIGHT[1]).toContain('sleepDemon');
    expect(scene.threatContext.stamina).toBe(scene.stamina);

    const sceneRoot = engine._rootObjects.find(go => go.name === 'SceneRoot');
    const figure = sceneRoot.find('Threats').find('SleepDemon');
    expect(figure).toBe(threat.figure);
    expect(figure.object3d.visible).toBe(false);
    expect(figure.rigidBody).toBeNull();
  });

  it('ticks stamina on GameplaySystems between the controller and the threats', () => {
    expect(scene.stamina).toBeInstanceOf(Stamina);
    const drain = gameplay.getComponent(StaminaDrain);
    expect(drain.stamina).toBe(scene.stamina);
    expect(drain.controller).toBe(scene.gameController);
    expect(drain.hud).toBe(scene.hud);
    const at = c => gameplay.components.indexOf(c);
    expect(at(drain)).toBeGreaterThan(at(scene.gameController));
    expect(at(drain)).toBeLessThan(at(scene.threatDirector));
  });

  it("feeds the office's ration dispenser the stamina, and has it ready each night", () => {
    const dispenser = scene.rooms.MainOffice.rationDispenser;
    expect(dispenser.stamina).toBe(scene.stamina);
    scene.stamina.value = 0.2;
    dispenser.onInteract({});
    expect(scene.stamina.value).toBeCloseTo(0.55);
    expect(dispenser.refill).toBeGreaterThan(0);

    const drain = gameplay.getComponent(StaminaDrain);
    drain.onNightStart();
    expect(dispenser.refill).toBe(0);
  });

  it("registers night 3's camera entity on the server room's camera, cone off until its night", () => {
    const threat = scene.threatDirector.threats.get('cameraEntity');
    expect(threat).toBeInstanceOf(CameraEntity);
    expect(THREATS_BY_NIGHT[3]).toContain('cameraEntity');
    threat.ctx = scene.threatContext;
    expect(threat.rig).toBe(scene.rooms.ServerRoom.securityCamera);
    expect(threat.rig.cone.visible).toBe(false);
  });

  it('turns signal storage on from night 3, two saved signals at a time', () => {
    expect(scene.signalManager.storageFromNight).toBe(3);
    expect(scene.signalManager.storageCapacity).toBe(2);
  });

  it("the server room's storage console stores what the terminal holds and tells the controller", () => {
    const sm = scene.signalManager;
    const { storageConsole } = scene.rooms.ServerRoom;
    sm.startNight(3);
    sm.saveSignal(sm.signals[0].id);
    sm.saveSignal(sm.signals[1].id);
    expect(storageConsole.waiting()).toBe(2);

    const stored = vi.spyOn(scene.gameController, 'onSignalsStored');
    storageConsole.onUse();
    expect(sm.pending).toBe(0);
    expect(sm.stored).toBe(2);
    expect(storageConsole.waiting()).toBe(0);
    expect(stored).toHaveBeenCalledTimes(1);
  });

  it('stops every threat on dispose — loadScene never reaches onDestroy', () => {
    const stop = vi.spyOn(scene.threatDirector, 'dispose');
    scene.dispose();
    expect(stop).toHaveBeenCalled();
  });
});

describe('BaseScene audio', () => {
  let engine, scene, gameplay;

  beforeEach(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
    gameplay = engine._rootObjects.find(go => go.name === 'SceneRoot').find('GameplaySystems');
  });

  it('runs one AudioSystem on GameplaySystems, before the threats, and hands it to them', () => {
    expect(scene.audio).toBeInstanceOf(AudioSystem);
    expect(gameplay.getComponent(AudioSystem)).toBe(scene.audio);
    expect(scene.threatContext.audio).toBe(scene.audio);
    expect(gameplay.components.indexOf(scene.audio))
      .toBeLessThan(gameplay.components.indexOf(scene.threatDirector));
  });

  it("follows the player with the ambience, and cues the terminal, the shift and the airlock", () => {
    const ambience = gameplay.getComponent(Ambience);
    expect(ambience.audio).toBe(scene.audio);
    expect(ambience.transitions).toBe(scene.transitions);
    expect(ambience.airlock).toBe(scene.rooms.Airlock);

    const player = engine.player.object3d.position;
    const standIn = where => {
      player.copy(where);
      scene.transitions.onUpdate(1 / 60);
      ambience.onUpdate(1 / 60);
    };
    standIn(scene.corridors.OfficeToServer.bounds().getCenter(new THREE.Vector3()));
    expect(scene.audio.ambience).toEqual({ bed: 'amb:base-interior', room: 'amb:corridor' });
    standIn(scene.rooms.ServerRoom.bounds().getCenter(new THREE.Vector3()));
    expect(scene.audio.ambience).toEqual({ bed: 'amb:base-interior', room: 'amb:server-room' });
    standIn(scene.satellite.object3d.position);
    expect(scene.audio.ambience).toEqual({ bed: 'amb:outside-wind', room: null });

    const cues = gameplay.getComponent(SoundCues);
    expect(cues.audio).toBe(scene.audio);
    expect(cues.terminal).toBe(scene.terminal);
    expect(cues.controller).toBe(scene.gameController);
    expect(cues.airlock).toBe(scene.rooms.Airlock);
  });

  it('the machines hum as hard as they work: the racks always, the generator while on, the dish as it slews', () => {
    const { serverHum, generator, dishMotor } = scene.audioEmitters;
    scene.audio.onUpdate(1 / 60);
    expect(serverHum.level).toBe(1);
    expect(generator.level).toBe(1);
    expect(dishMotor.level).toBe(0);

    scene.power.set(false);
    scene.satellite.velYaw = scene.satellite.maxRotationSpeed / 2;
    scene.audio.onUpdate(1 / 60);
    expect(generator.level).toBe(0);
    expect(dishMotor.level).toBeCloseTo(0.5);
  });

  it('blips on save and delete, and the dispenser sounds a ration from where it stands', () => {
    const play = vi.spyOn(scene.audio, 'play');
    for (const [obj, fn] of [
      [scene.terminal, 'saveSignal'], [scene.terminal, 'deleteSignal'],
      [scene.gameController, 'onSignalSaved'], [scene.gameController, 'onSignalDeleted'],
    ]) vi.spyOn(obj, fn).mockImplementation(() => {});

    scene.reviewPanel._saveCb();
    expect(play.mock.calls.at(-1)[0]).toBe('sfx:save');
    scene.reviewPanel._deleteCb();
    expect(play.mock.calls.at(-1)[0]).toBe('sfx:delete');

    const dispenser = scene.rooms.MainOffice.rationDispenser;
    dispenser.stamina.value = 0.2;
    dispenser.onInteract({});
    expect(play).toHaveBeenLastCalledWith('sfx:ration', expect.objectContaining({ at: dispenser.transform }));
  });

  it('silences everything on dispose', () => {
    const dispose = vi.spyOn(scene.audio, 'dispose');
    scene.dispose();
    expect(dispose).toHaveBeenCalled();
  });
});

describe('BaseScene power', () => {
  let engine, scene, gameplay;

  const runPower = seconds => {
    for (let t = 0; t < seconds; t += 1 / 60) scene.power.onUpdate(1 / 60);
  };
  const pointLight = (room, group) => room.root.find(group).object3d.children.find(o => o.isPointLight);

  beforeEach(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
    gameplay = engine._rootObjects.find(go => go.name === 'SceneRoot').find('GameplaySystems');
  });

  it('puts every light the rooms and corridors run off the power on one BaseLights, and hands it to the threats', () => {
    expect(scene.baseLights).toBeInstanceOf(BaseLights);
    let count = 0;
    for (const part of [...Object.values(scene.rooms), ...Object.values(scene.corridors)]) {
      for (const obj of part.lights) {
        expect(scene.baseLights.has(obj), `${part.name}: ${obj.type}`).toBe(true);
        count++;
      }
    }
    expect(count).toBeGreaterThan(10);
    expect(scene.baseLights.has(scene.rooms.Airlock.beacon)).toBe(false);
    expect(scene.threatContext.lights).toBe(scene.baseLights);
  });

  it('runs the Power on GameplaySystems, driving that BaseLights, ahead of the threats', () => {
    expect(scene.power).toBeInstanceOf(Power);
    expect(gameplay.getComponent(Power)).toBe(scene.power);
    expect(scene.power.lights).toBe(scene.baseLights);
    expect(gameplay.components.indexOf(scene.power))
      .toBeLessThan(gameplay.components.indexOf(scene.threatDirector));
  });

  it('the lever cuts the base to its emergency lights, and brings them back', () => {
    const ceiling = pointLight(scene.rooms.MainOffice, 'CeilingLight');
    const full = ceiling.intensity;
    const beacon = scene.rooms.Airlock.beacon.intensity;
    const lever = scene.generator.getComponent(GeneratorSwitch);
    expect(lever.power).toBe(scene.power);

    lever.onInteract({});
    runPower(1);
    expect(ceiling.intensity).toBeCloseTo(full * EMERGENCY_LEVEL);
    expect(scene.rooms.Airlock.beacon.intensity).toBe(beacon);
    expect(lever.promptLabel).toBe(RESTORE_POWER);

    lever.onInteract({});
    runPower(1);
    expect(ceiling.intensity).toBe(full);
  });

  it('with no power the terminal will not start and the dish stops, until it comes back', () => {
    scene.power.set(false);
    expect(scene.terminal.powered).toBe(false);
    expect(scene.satellite.powered).toBe(false);
    scene.terminal.enter();
    expect(scene.terminal.state).toBe('idle');

    scene.power.set(true);
    expect(scene.terminal.powered).toBe(true);
    expect(scene.satellite.powered).toBe(true);
  });

  it('the airlock still cycles with the power off: it runs on its own battery', () => {
    const airlock = scene.rooms.Airlock;
    scene.power.set(false);
    runPower(1);
    scene.suit.toggle();
    for (let i = 0; i < 60 * 3; i++) airlock.update(1 / 60);
    expect(airlock.state).toBe('depressurised');
    expect(airlock.hatch.locked).toBe(false);

    scene.suit.toggle();
    for (let i = 0; i < 60 * 3; i++) airlock.update(1 / 60);
    expect(airlock.state).toBe('pressurised');
  });

  it('a cut sounds from the generator; putting it back does not', () => {
    const play = vi.spyOn(scene.audio, 'play');
    scene.power.set(false);
    expect(play).toHaveBeenCalledWith('sfx:power-cut', expect.objectContaining({ at: scene.generator.object3d }));
    play.mockClear();
    scene.power.set(true);
    expect(play).not.toHaveBeenCalled();
  });

  it("a tired player's base dims through the same lights, on top of the power", () => {
    const ceiling = pointLight(scene.rooms.MainOffice, 'CeilingLight');
    const full = ceiling.intensity;
    const drain = gameplay.getComponent(StaminaDrain);
    expect(drain.lights).toBe(scene.baseLights);
    scene.gameController.state = 'playing';
    drain.onUpdate(0);
    scene.stamina.value = 0;
    drain.onUpdate(0);
    expect(ceiling.intensity).toBeCloseTo(full * FATIGUE_DIM_MIN);
    scene.power.set(false);
    runPower(1);
    expect(ceiling.intensity).toBeCloseTo(full * FATIGUE_DIM_MIN * EMERGENCY_LEVEL);
  });

  it('a new night, or a retry, starts with the power on', () => {
    scene.power.set(false);
    runPower(1);
    gameplay.getComponent(StaminaDrain).onNightStart();
    expect(scene.power.on).toBe(true);
    expect(scene.baseLights.getFactor('power')).toBe(1);
  });

  it('dispose() hands every light its full brightness back', () => {
    const ceiling = pointLight(scene.rooms.MainOffice, 'CeilingLight');
    const full = ceiling.intensity;
    scene.power.set(false);
    runPower(1);
    scene.dispose();
    expect(ceiling.intensity).toBe(full);
  });
});

describe('BaseScene CRT screen', () => {
  let engine, scene, desk, crt;

  beforeEach(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
    desk = scene.rooms.MainOffice.root.find('ComputerDesk');
    crt = desk.getComponent(CrtScreen);
  });

  it("puts the CRT on the office desk's monitor, driven by the dish and the power", () => {
    expect(crt).toBeInstanceOf(CrtScreen);
    const mesh = desk.object3d.getObjectByName('CrtScreen');
    expect(mesh.parent).toBe(desk.object3d);
    expect(mesh.material).toBe(crt.material);
    expect(crt.material.uniforms.uSignal).toBeDefined();
    expect(crt.satellite).toBe(scene.satellite);
    expect(crt.power).toBe(scene.power);
  });

  it('keeps the terminal the first Interactable on the desk', () => {
    const at = c => desk.components.indexOf(c);
    expect(at(scene.terminal)).toBeLessThan(at(crt));
  });

  it('breaks into static while a Window Watcher looks in', () => {
    const watchers = scene.threatDirector.threats.get('windowWatchers');
    expect(crt.disturbed()).toBe(false);
    watchers.logic.phase = 'peer';
    expect(crt.disturbed()).toBe(true);
  });

  it('owns the material and the plane, and frees them with the scene', () => {
    const mesh = desk.object3d.getObjectByName('CrtScreen');
    expect(scene._owned).toContain(mesh.material);
    expect(scene._owned).toContain(mesh.geometry);
    const freed = vi.spyOn(mesh.material, 'dispose');
    scene.dispose();
    expect(freed).toHaveBeenCalled();
  });
});

describe('BaseScene oxygen', () => {
  let engine, scene, gameplay, supply;

  const standAt = p => engine.player.object3d.position.copy(p);
  /** Standing height inside a room or corridor: its middle, a body's height up. */
  const insidePart = part => {
    const box = part.bounds();
    return box.getCenter(new THREE.Vector3()).setY(box.min.y + 1);
  };

  beforeEach(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
    gameplay = engine._rootObjects.find(go => go.name === 'SceneRoot').find('GameplaySystems');
    supply = gameplay.getComponent(OxygenSupply);
  });

  it('runs an OxygenSupply on GameplaySystems, for the suit, the controller, the HUD and the sound', () => {
    expect(scene.oxygen).toBeInstanceOf(Oxygen);
    expect(supply).toBeInstanceOf(OxygenSupply);
    expect(supply.oxygen).toBe(scene.oxygen);
    expect(supply.suit).toBe(scene.suit);
    expect(supply.controller).toBe(scene.gameController);
    expect(supply.hud).toBe(scene.hud);
    expect(supply.audio).toBe(scene.audio);
    expect(gameplay.components.indexOf(supply))
      .toBeGreaterThan(gameplay.components.indexOf(scene.gameController));
  });

  it('counts the player outside only off the base: out by the generator, never in a room or corridor', () => {
    standAt(worldPos(scene.generator).setY(1));
    expect(supply.isOutside()).toBe(true);
    for (const part of [...Object.values(scene.rooms), ...Object.values(scene.corridors)]) {
      standAt(insidePart(part));
      expect(supply.isOutside(), part.name).toBe(false);
    }
  });

  it('refills in the airlock, and only once it is pressurised', () => {
    const airlock = scene.rooms.Airlock;
    scene.transitions.currentRoom = airlock;
    expect(airlock.state).toBe('pressurised');
    expect(supply.isRefilling()).toBe(true);
    for (const state of ['depressurising', 'depressurised', 'pressurising']) {
      airlock.state = state;
      expect(supply.isRefilling(), state).toBe(false);
    }
    airlock.state = 'pressurised';
    scene.transitions.currentRoom = scene.rooms.MainOffice;
    expect(supply.isRefilling()).toBe(false);
  });

  it('a trip outside in the suit spends the tank, and running dry ends the night', () => {
    scene.gameController.state = 'playing';
    scene.suit.putOn();
    standAt(worldPos(scene.generator).setY(1));
    supply.onUpdate(45);
    expect(scene.oxygen.value).toBeCloseTo(0.5);
    supply.onUpdate(46);
    expect(scene.gameController.state).toBe('gameOver');
    expect(scene.gameController.failReason).toBe(OXYGEN_KILL);
  });

  it('a new night, or a retry, starts with a full tank', () => {
    scene.oxygen.value = 0.1;
    gameplay.getComponent(StaminaDrain).onNightStart();
    expect(scene.oxygen.value).toBe(1);
  });
});
