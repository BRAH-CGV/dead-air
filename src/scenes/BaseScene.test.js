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
import { SuitVisor } from '../components/SuitVisor.js';
import { PRELOAD } from '../assets/manifest.js';
import { ScannerAlertSound } from '../components/ScannerAlertSound.js';
import { Daylight } from '../components/Daylight.js';
import { ScreenFade } from '../ui/ScreenFade.js';
import { hiddenFromRegion } from '../systems/Sightlines.js';
import { Ufo } from '../gameobjects/Ufo.js';
import { BUNKER } from '../gameobjects/BunkerShell.js';
import { UfoThreat } from '../gameplay/UfoThreat.js';
import { EvilSignal } from '../gameplay/EvilSignal.js';
import { GeneratorSound } from '../components/GeneratorSound.js';
import { Sandstorm, SANDSTORM } from '../gameplay/Sandstorm.js';
import { DustStorm } from '../gameobjects/DustStorm.js';
import { DustEye } from '../gameobjects/DustEye.js';
import { DustEyes, throughWindow } from '../gameplay/DustEyes.js';
import { StormOutage } from '../gameplay/StormOutage.js';
import { Nap, NAP } from '../gameplay/Nap.js';
import { BedRest } from '../components/BedRest.js';
import { BED_TRANSITION } from '../gameplay/BedTransition.js';

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
  // The generator arrives drawn, as the real spawn loads it: a box its size
  // (generator.glb at its manifest scale), so the zones and the dust eyes
  // have something to measure.
  const spawn = engine.spawnModel;
  engine.spawnModel = vi.fn((key, opts) => {
    const go = spawn(key, opts);
    if (key === 'model:generator') {
      go.object3d.add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.24, 0.89).translate(0, 0.62, 0)));
    }
    return go;
  });
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

  it('wakes the player in the bedroom, beside the bunk (#79)', () => {
    expect(engine.buildPlayer).toHaveBeenCalledTimes(1);
    expect(scene.rooms.LivingQuarters.containsPoint(worldPos(engine.player))).toBe(true);
    expect(engine.buildPlayer).toHaveBeenCalledWith(expect.objectContaining({
      position: scene.rooms.LivingQuarters.spawn.position,
    }));
  });

  it('wires the journal: the night from the controller, the paper panel (#79)', () => {
    const { journal } = scene.rooms.LivingQuarters;
    expect(journal.controller).toBe(scene.gameController);
    expect(journal.panel).toBeTruthy();
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

    // The real model now, not a stand-in box, standing on the ground.
    const generator = outside.find('Generator');
    expect(generator.physicsAssetKey).toBe('model:generator');
    expect(generator.placeholderFor).toBeFalsy();
    expect(generator.object3d.position.y).toBe(0);
    expect(engine._rootObjects).not.toContain(generator);         // updated once, under Outside
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

  it('tells the airlock of the office\'s front doorway, so the wall it butts against is lined round it', () => {
    const front = scene.rooms.MainOffice.openings.find(o => o.side === 'front');
    expect(scene.rooms.Airlock.openEndDoorways).toEqual({ back: { width: front.width, height: front.height } });
  });

  it('tells each passageway of the doorways at its ends, so the room walls it butts against are lined round them', () => {
    const door = (room, side) => {
      const { width, height } = scene.rooms[room].openings.find(o => o.side === side);
      return { width, height };
    };
    // Both run along x: their left end is the −x one.
    expect(scene.corridors.OfficeToServer.openEndDoorways).toEqual({
      left: door('MainOffice', 'right'), right: door('ServerRoom', 'left'),
    });
    expect(scene.corridors.OfficeToQuarters.openEndDoorways).toEqual({
      left: door('LivingQuarters', 'right'), right: door('MainOffice', 'left'),
    });
  });

  it('the generator is a raycastable Interactable that switches the power grid', () => {
    const generator = sceneRoot.find('Outside').find('Generator');
    const interactable = generator.getComponent(Interactable);
    expect(interactable).not.toBeNull();
    expect(engine._bodyToGO.get(generator.rigidBody.handle)).toBe(generator);

    expect(scene.power.on).toBe(true);
    expect(interactable.promptLabel).toMatch(/cut power/i);
    const flickAll = () => {
      const puzzle = scene.breakerPanel._puzzle;
      puzzle.switches.forEach((_, i) => puzzle.toggle(i));
      scene.breakerPanel._callbacks.onSolved();
    };

    // Off: the panel, every lead home, every breaker up — flick them down.
    interactable.onInteract({});
    expect(scene.breakerPanel.isOpen).toBe(true);
    let puzzle = scene.breakerPanel._puzzle;
    expect(puzzle.wiresConnected).toBe(puzzle.left.length);
    expect(puzzle.switchesOn).toBe(puzzle.switches.length);
    expect(scene.power.on).toBe(true);   // not until it's done
    flickAll();
    expect(scene.power.on).toBe(false);
    expect(interactable.promptLabel).toMatch(/restore power/i);

    // On: the same, the other way — every breaker down, flick them up.
    interactable.onInteract({});
    puzzle = scene.breakerPanel._puzzle;
    expect(puzzle.wiresConnected).toBe(puzzle.left.length);
    expect(puzzle.switchesOn).toBe(0);
    flickAll();
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

  it('disposes the radar and review overlays on dispose, so restarts do not stack listeners', () => {
    const radar = vi.spyOn(scene.radarOverlay, 'dispose');
    const review = vi.spyOn(scene.reviewPanel, 'dispose');
    scene.dispose();
    expect(radar).toHaveBeenCalledOnce();
    expect(review).toHaveBeenCalledOnce();
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

  it('wires the terminal to the satellite, signals, UI and drive manager', () => {
    expect(scene.terminal.satellite).toBe(scene.satellite);
    expect(scene.terminal.signalManager).toBe(scene.signalManager);
    expect(scene.terminal.hud).toBe(scene.hud);
    expect(scene.terminal.radar).toBe(scene.radarOverlay);
    expect(scene.terminal.reviewPanel).toBe(scene.reviewPanel);
    expect(scene.terminal.driveManager).toBe(scene.driveManager);
    expect(scene.terminal.gameController).toBe(scene.gameController);
    expect(scene.terminal.crosshair).toBe(scene.engine.crosshair);
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

  it('wires the drive manager to the office drive reader', () => {
    expect(scene.driveManager).toBeDefined();
    // Every drive in the room registers: 4 shelf boxes × 8 seated drives.
    expect(scene.driveManager.totalDrives).toBe(32);
    const reader = scene.rooms.MainOffice.driveReader;
    expect(reader).not.toBeNull();
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

  /** Dock a shelf box with enough saved drives to meet the quota, then run
   *  the clock out: it is morning. */
  function workTheShift() {
    const { gameController, rooms } = scene;
    const dock = rooms.Airlock.quotaDock;
    const box = rooms.MainOffice.driveBoxes[0];
    dock.socket.attach(box, 0);
    const seated = box.receiver.attachedItems.filter(Boolean);
    for (let i = 0; i < dock.requiredCount; i++) {
      seated[i].setSaved(true);
    }
    gameController.onSignalSaved();
    gameController.onUpdate(999);
    expect(gameController.state).toBe('morning');
  }

  /** Run the bed animation on for `seconds` (the fake engine has no realDt:
   *  BedRest takes the frame's own). */
  function inBed(seconds, dt = 0.05) {
    for (let t = 0; t < seconds - 1e-9; t += dt) scene.bedRest.onUpdate(dt);
  }

  it('one bed animation, shared: the bunk, the nap, the demon and the fatigue effects all know it', () => {
    const gameplay = engine._rootObjects.find(go => go.name === 'SceneRoot').find('GameplaySystems');
    const rest = gameplay.getComponent(BedRest);
    expect(rest).toBe(scene.bedRest);
    expect(scene.rooms.LivingQuarters.bed.rest).toBe(rest);
    expect(scene.nap.rest).toBe(rest);
    expect(scene.sleepDemon.sleeper).toBe(rest);
    // It watches on the real clock, and sees past the bunk the pillow is in.
    expect(scene.sleepDemon.realDt()).toBe(engine.realDt);
    expect(typeof scene.sleepDemon.napRayHit).toBe('function');
    expect(rest.bed).toBe(scene.rooms.LivingQuarters.bed);
    // The nap's "[E] Wake up" line, over the lids (#nap-hint).
    expect(typeof scene.nap.hint?.show).toBe('function');
    expect(typeof scene.nap.hint?.hide).toBe('function');
    expect(scene.fatigueEffects.isResting()).toBe(false);
    rest.lieDown();
    expect(scene.fatigueEffects.isResting()).toBe(true);
    rest.cancel();
  });

  it('the bunk naps through the night, fast once the eyes are shut, and a storm outage\'s buzz wakes you with a start', () => {
    const bed = scene.rooms.LivingQuarters.bed;
    const gameplay = engine._rootObjects.find(go => go.name === 'SceneRoot').find('GameplaySystems');
    const nap = gameplay.getComponent(Nap);
    expect(nap).toBe(scene.nap);
    expect(bed.nap).toBe(nap);

    bed.onUpdate(0.016);
    expect(bed.promptLabel).toMatch(/^\[E\] Nap/);
    bed.onInteract({});
    expect(nap.napping).toBe(true);
    expect(engine.timeScale).not.toBe(NAP.timeScale);   // lying down
    inBed(BED_TRANSITION.lieDown + 0.1);
    expect(engine.timeScale).toBe(NAP.timeScale);

    scene.stormOutage._flickering = 0;          // the lamps start to buzz
    nap.onUpdate(0.016);
    expect(nap.napping).toBe(false);
    expect(engine.timeScale).toBe(1);
    expect(nap.wokeBy).toMatch(/buzz/i);
    expect(scene.bedRest.transition.style).toBe('startled');
    inBed(1);
    expect(scene.bedRest.active).toBe(false);
  });

  it('the scene torn down mid-nap: real time again, and the player given back', () => {
    const nap = scene.nap;
    nap.start();
    inBed(BED_TRANSITION.lieDown + 0.1);
    expect(engine.timeScale).toBe(NAP.timeScale);
    engine._rootObjects.find(go => go.name === 'SceneRoot').destroy();
    expect(engine.timeScale).toBe(1);
    expect(scene.bedRest.active).toBe(false);
  });

  it('sleeps through a silent power cut — nothing you could hear from the bunk', () => {
    const nap = scene.nap;
    nap.start();
    scene.power.setOn(false);
    nap.onUpdate(0.016);
    expect(nap.napping).toBe(true);
    nap.wake();
    scene.bedRest.cancel();
  });

  it('the UFO wakes you when you can hear it, not while it is only on the radar — and no nap while it is coming', () => {
    const nap = scene.nap;
    nap.start();
    scene.ufoThreat.phase = 'approaching';      // the blob is on the radar
    nap.onUpdate(0.016);
    expect(nap.napping).toBe(true);
    scene.ufoThreat._flightStartedAt = 0;       // the roar starts
    nap.onUpdate(0.016);
    expect(nap.napping).toBe(false);
    expect(nap.wokeBy).toMatch(/roar/i);
    expect(nap.canNap).toBe(false);
  });

  it('the bunk sleeps through the day to the next night, in step across NightManager, controller and HUD', () => {
    const bed = scene.rooms.LivingQuarters.bed;
    expect(bed.controller).toBe(scene.gameController);
    expect(bed.fade).toBeInstanceOf(ScreenFade);
    const setNight = vi.spyOn(scene.hud, 'setNight');

    workTheShift();
    bed.onUpdate(0.016);
    expect(bed.promptLabel).toBe('[E] Sleep');

    bed.onInteract({});
    expect(scene.nights.currentNight).toBe(1);  // lying down: not asleep yet
    inBed(BED_TRANSITION.lieDown + 0.1);
    expect(scene.nights.currentNight).toBe(2);
    expect(scene.gameController.nightNumber).toBe(2);
    expect(scene.gameController.state).toBe('playing');
    expect(setNight).toHaveBeenLastCalledWith(2);
    expect(scene.nightClock.timeString).toBe('6:00 PM');
    // Up out of bed into the new night.
    expect(scene.bedRest.transition.style).toBe('calm');
    inBed(3);
    expect(scene.bedRest.active).toBe(false);
  });

  it('sleeping to the next night wipes the docked box and parks it on the office floor', () => {
    const { gameController, rooms } = scene;
    const dock = rooms.Airlock.quotaDock;
    const [docked, other] = rooms.MainOffice.driveBoxes;

    // Meet the quota with one docked box; another box's drive is saved
    // too, but that box never enters the dock.
    dock.socket.attach(docked, 0);
    const dockedDrives = docked.receiver.attachedItems.filter(Boolean);
    for (let i = 0; i < dock.requiredCount; i++) dockedDrives[i].setSaved(true);
    const otherDrive = other.receiver.attachedItems[0];
    otherDrive.setSaved(true);
    gameController.onSignalSaved();
    gameController.onUpdate(999);
    expect(gameController.state).toBe('morning');

    scene.rooms.LivingQuarters.bed.onInteract({});
    inBed(BED_TRANSITION.lieDown + 0.1);
    expect(scene.gameController.nightNumber).toBe(2);

    // The docked box: released, parked resting on the floor, drives blank.
    expect(docked._snapOwner).toBeNull();
    expect(dock.depositedBox).toBeNull();
    expect(docked.object3d.position.x).toBeCloseTo(1.1);
    expect(docked.object3d.position.y).toBeCloseTo(0.06);
    expect(docked.object3d.position.z).toBeCloseTo(4.72);
    for (const drive of dockedDrives) expect(drive.saved, drive.name).toBe(false);

    // A saved drive outside the docked box keeps its signal.
    expect(otherDrive.saved).toBe(true);
  });

  it('a retry reverts drives and boxes to the night-start snapshot', () => {
    const { gameController, rooms } = scene;
    const box = rooms.MainOffice.driveBoxes[0];
    const drive = box.receiver.attachedItems[0];
    const startPos = worldPos(drive).clone();

    // Mid-night: pull the drive out, carry it away and save it.
    box.receiver.detach(drive);
    drive.object3d.position.set(-4, 0.02, 3);
    drive.setSaved(true);

    gameController.fail('taken');
    gameController.retryNight();

    expect(drive.saved).toBe(false);
    expect(drive._snapOwner).toBe(box.receiver);
    expect(worldPos(drive).x).toBeCloseTo(startPos.x);
    expect(worldPos(drive).y).toBeCloseTo(startPos.y);
    expect(worldPos(drive).z).toBeCloseTo(startPos.z);
  });

  it('hangs the night clock on the office wall', () => {
    expect(scene.rooms.MainOffice.wallClock.clock).toBe(scene.nightClock);
  });

  it('runs the desk clock off the night clock too', () => {
    expect(scene.rooms.MainOffice.deskClock.clock).toBe(scene.nightClock);
  });

  it('wires the office signal lamp to the manager and the controller', () => {
    const light = scene.rooms.MainOffice.signalLight;
    expect(light.signalManager).toBe(scene.signalManager);
    expect(light.gameController).toBe(scene.gameController);
  });

  it('gives the signal lamp its beep', () => {
    const light = scene.rooms.MainOffice.signalLight;
    expect(light.getComponent(ScannerAlertSound)).toBeTruthy();
  });

  it('shows the real sky behind the radar grid', () => {
    // The backdrop is the sky the window shows, subsampled — Phobos and
    // Deimos riding the same turn — drawn through the radar's own mapping.
    const backdrop = scene.radarOverlay._backdrop;
    expect(backdrop).not.toBeNull();
    expect(backdrop.moons.map(m => m.name)).toEqual(['Phobos', 'Deimos']);
    expect(scene.sky.skyUniforms.uDawn.value).toBe(backdrop.dawn);
  });

  it('turns the night to day and back with the controller — sky, lights and fog', () => {
    const gameplay = engine._rootObjects.find(go => go.name === 'SceneRoot').find('GameplaySystems');
    const daylight = gameplay.getComponent(Daylight);
    expect(daylight).not.toBeNull();
    // Updated after the controller in the same frame, so it never lags a state.
    expect(gameplay.components.indexOf(daylight))
      .toBeGreaterThan(gameplay.components.indexOf(scene.gameController));

    const uDawn = scene.sky.skyUniforms.uDawn;

    // Built at 6 PM: the dusk is on as soon as the engine wakes the scene
    // (loadScene's _init), before anything ticks — the main menu shows it.
    gameplay._init(engine.scene, engine.world);
    expect(uDawn.value).toBe(1);

    scene.nightClock.currentTime = 0;     // midnight: full night
    daylight.onUpdate(0.016);
    expect(uDawn.value).toBe(0);
    const night = { ambient: scene.ambientLight.intensity, sun: scene.moonLight.intensity,
                    fog: engine.scene.fog.color.getHex() };

    workTheShift();
    daylight.onUpdate(0.016);
    expect(uDawn.value).toBe(1);
    expect(scene.ambientLight.intensity).toBeGreaterThan(night.ambient);
    expect(scene.moonLight.intensity).toBeGreaterThan(night.sun);
    expect(engine.scene.fog.color.getHex()).not.toBe(night.fog);

    scene.rooms.LivingQuarters.bed.onInteract({});
    inBed(BED_TRANSITION.lieDown + 0.1);
    daylight.onUpdate(0.016);
    expect(uDawn.value).toBe(1);          // the next shift starts at dusk
    scene.nightClock.currentTime = 0;
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

describe('BaseScene occlusion — the airlock decides which side is drawn', () => {
  let engine, scene;

  beforeEach(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
  });

  /** Every Object3D in a zone, and everything under them. */
  function zoneContents(name) {
    const out = new Set();
    for (const obj of scene.zones.objects(name)) obj.traverse(o => out.add(o));
    return out;
  }
  const named = (root, name) => root.getObjectByName(name);

  it('has the interior and yard zones, plus one for what nobody can see', () => {
    expect(scene.zones.names().sort()).toEqual(['interior', 'unseen', 'yard']);
  });

  it('the interior zone holds the rooms\' furnishings', () => {
    const interior = zoneContents('interior');
    const office = scene.rooms.MainOffice.root.object3d;
    for (const prop of ['ComputerDesk', 'GrowBeds', 'WindowFrame_Top']) {
      expect(interior.has(named(office, prop)), prop).toBe(true);
    }
    const bedroom = scene.rooms.LivingQuarters.root.object3d;
    expect(interior.has(named(bedroom, 'CoffeeMachine')), 'CoffeeMachine').toBe(true);
  });

  it('never the shell or the doors — those are the building as seen from outside', () => {
    const interior = zoneContents('interior');
    for (const room of [scene.rooms.MainOffice, scene.rooms.ServerRoom, scene.rooms.LivingQuarters]) {
      room.root.object3d.traverse((o) => {
        if (/^(Floor|Ceiling|(Back|Front|Left|Right)Wall)/.test(o.name)) {
          expect(interior.has(o), `${room.name}/${o.name}`).toBe(false);
        }
      });
      for (const door of room.doors) expect(interior.has(door.object3d), door.name).toBe(false);
    }
  });

  it('never a light, in either zone — hiding one recompiles every lit shader', () => {
    for (const name of scene.zones.names()) {
      for (const o of zoneContents(name)) expect(o.isLight, `${name}: ${o.name}`).toBeFalsy();
    }
  });

  it('leaves the airlock out of the interior — it is the one room seen from both sides', () => {
    const interior = zoneContents('interior');
    expect(interior.has(named(scene.rooms.Airlock.root.object3d, 'SuitLocker'))).toBe(false);
  });

  it('the yard zone holds what stands in front of the building', () => {
    const yard = zoneContents('yard');
    const outside = engine._rootObjects.find(go => go.name === 'SceneRoot').find('Outside');
    expect(yard.has(outside.find('Generator').object3d)).toBe(true);
  });

  it('but not what the back window looks out on — the dish, its pad, the valley', () => {
    const yard = zoneContents('yard');
    const outside = engine._rootObjects.find(go => go.name === 'SceneRoot').find('Outside');
    for (const name of ['Satellite', 'DishPad', 'MarsTerrain']) {
      const go = outside.find(name);
      expect(go, name).not.toBeNull();
      expect(yard.has(go.object3d), name).toBe(false);
    }
  });

  it('splits instanced scenery along the window\'s sightline: every yard instance is out of view of the glass', () => {
    const windowZ = -4.9;   // the office back wall's inner face
    const yardMeshes = [...zoneContents('yard')].filter(o => o.isInstancedMesh);
    expect(yardMeshes.length).toBeGreaterThan(0);

    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (const mesh of yardMeshes) {
      mesh.updateWorldMatrix(true, false);
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        p.setFromMatrixPosition(m.premultiply(mesh.matrixWorld));
        expect(p.z, mesh.name).toBeGreaterThan(windowZ);
      }
    }
  });

  it('fences the outside into a block on the airlock side, so the back window is out of reach', () => {
    const { rect } = scene.fence;
    const footprint = scene._baseFootprint();
    expect(rect.minX).toBeLessThan(-footprint.halfX);
    expect(rect.maxX).toBeGreaterThan(footprint.halfX);
    expect(rect.minZ).toBeGreaterThan(0);     // the block starts in front of the office's middle
    // The hatch opens into it.
    const hatch = worldPos(scene.rooms.Airlock.hatch);
    expect(hatch.z).toBeGreaterThan(rect.minZ);
    expect(hatch.z).toBeLessThan(rect.maxZ);
  });

  it('wires an AirlockPortal to the airlock and the zones', () => {
    expect(scene.portal.airlock).toBe(scene.rooms.Airlock);
    expect(scene.portal.zones).toBe(scene.zones);
  });

  it('starts with the yard hidden and the interior drawn once the portal starts', () => {
    scene.portal.onStart();
    const outside = engine._rootObjects.find(go => go.name === 'SceneRoot').find('Outside');
    expect(outside.find('Generator').object3d.visible).toBe(false);
    expect(named(scene.rooms.MainOffice.root.object3d, 'ComputerDesk').visible).toBe(true);
  });

  it('dispose shows everything again, so nothing stays hidden into the next scene', () => {
    scene.portal.onStart();
    const outside = engine._rootObjects.find(go => go.name === 'SceneRoot').find('Outside');
    const generator = outside.find('Generator').object3d;
    scene.dispose();
    expect(generator.visible).toBe(true);
  });
});

describe('BaseScene occlusion — the building hides what is low behind it from the yard', () => {
  let engine, scene;

  beforeEach(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
  });

  const instancedIn = name => {
    const out = [];
    for (const obj of scene.zones.objects(name)) obj.traverse(o => { if (o.isInstancedMesh) out.push(o); });
    return out;
  };
  const instanceSpheres = (mesh) => {
    mesh.updateWorldMatrix(true, false);
    mesh.geometry.computeBoundingSphere();
    const out = [];
    const m = new THREE.Matrix4();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      out.push(mesh.geometry.boundingSphere.clone().applyMatrix4(m.premultiply(mesh.matrixWorld)));
    }
    return out;
  };

  it('works out the occluders — one per room and corridor, never the airlock — and where the yard sees from', () => {
    const { occluders, eyes } = scene.yardView;
    const parts = [scene.rooms.MainOffice, scene.rooms.ServerRoom, scene.rooms.LivingQuarters, ...Object.values(scene.corridors)];
    expect(occluders).toHaveLength(parts.length);

    // Each inside its own part: an occluder may under-hide, never over-hide.
    occluders.forEach((box, i) => {
      expect(parts[i].bounds().containsBox(box), parts[i].name).toBe(true);
      expect(box.max.y).toBeLessThan(parts[i].height);
    });
    // Flush where they join, so the union has no gap to see through: the
    // office's right edge is the corridor's left edge, and so on.
    const office = occluders[0];
    const toServer = occluders[3];
    expect(toServer.min.x).toBeCloseTo(office.max.x);

    // The eyes: in front of every occluder, up to the top of a jump, and only
    // where the capsule can actually stand inside the fence.
    for (const box of occluders) expect(eyes.min.z).toBeGreaterThan(box.max.z);
    expect(eyes.max.y).toBeGreaterThanOrEqual(2.4);
    expect(eyes.max.x).toBeLessThan(scene.fence.rect.maxX);
  });

  it('scenery the window sees but the yard cannot joins the interior zone — drawn only from inside', () => {
    const { occluders: occluder, eyes } = scene.yardView;
    const behind = instancedIn('interior');
    expect(behind.length).toBeGreaterThan(0);
    for (const mesh of behind) {
      for (const sphere of instanceSpheres(mesh)) {
        expect(hiddenFromRegion(sphere, eyes, occluder), mesh.name).toBe(true);
      }
    }
  });

  it('what neither side can ever see goes in an unseen zone that stays hidden', () => {
    expect(scene.zones.names()).toContain('unseen');
    scene.portal.onStart();
    expect(scene.zones.isVisible('unseen')).toBe(false);
    scene.suit.putOn();
    expect(scene.zones.isVisible('unseen')).toBe(false);
  });

  it('the dish stands over the roof, so it is drawn from both sides', () => {
    const satellite = engine._rootObjects.find(go => go.name === 'SceneRoot').find('Outside').find('Satellite');
    for (const name of scene.zones.names()) {
      for (const obj of scene.zones.objects(name)) {
        let inZone = false;
        obj.traverse(o => { if (o === satellite.object3d) inZone = true; });
        expect(inZone, name).toBe(false);
      }
    }
  });
});

describe('BaseScene occlusion — only worth a draw call when it saves real work', () => {
  it('never splits off an inside-only or unseen part of fewer than 8k triangles', () => {
    const engine = makeSceneEngine();
    const scene = new BaseScene(engine);
    scene.build();
    for (const name of ['interior', 'unseen']) {
      for (const obj of scene.zones.objects(name)) {
        if (!obj.isInstancedMesh) continue;
        const g = obj.geometry;
        const tris = (g.index ? g.index.count : g.attributes.position.count) / 3 * obj.count;
        expect(tris, `${name}: ${obj.name}`).toBeGreaterThanOrEqual(8000);
      }
    }
  });
});

describe('BaseScene trees and the fence', () => {
  it('stands no tree within 3 m of a fence run — none grows through the wire', () => {
    const engine = makeSceneEngine();
    // A two-part stand-in tree, so the belt actually plants trees.
    const tree = new THREE.Group();
    tree.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 4), new THREE.MeshStandardMaterial()));
    const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5), new THREE.MeshStandardMaterial());
    canopy.position.y = 3;
    tree.add(canopy);
    engine.assets.get = vi.fn(key => (key.startsWith('model:tree-') ? { scene: tree } : null));
    engine.assets.getCollision = vi.fn(() => ({ bounds: { size: [3, 4, 3], center: [0, 2, 0] } }));

    const scene = new BaseScene(engine);
    scene.build();
    const { rect } = scene.fence;
    const near = (x, z) =>
      (Math.abs(z - rect.maxZ) < 3 && x > rect.minX - 3 && x < rect.maxX + 3)
      || ((Math.abs(x - rect.minX) < 3 || Math.abs(x - rect.maxX) < 3) && z > rect.minZ - 3 && z < rect.maxZ + 3);

    const outside = engine._rootObjects.find(go => go.name === 'SceneRoot').find('Outside');
    let trunks = 0;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    outside.object3d.traverse((mesh) => {
      if (!mesh.isInstancedMesh || mesh.geometry.type !== 'CylinderGeometry') return;
      mesh.updateWorldMatrix(true, false);
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        p.setFromMatrixPosition(m.premultiply(mesh.matrixWorld));
        trunks++;
        expect(near(p.x, p.z), `tree at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBe(false);
      }
    });
    expect(trunks).toBeGreaterThan(50);   // the belt really was planted
  });
});

describe('BaseScene power and the UFO', () => {
  let engine, scene;

  beforeEach(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
  });

  it('puts every room and corridor light on the grid, but not the airlock beacon', () => {
    const ceiling = scene.rooms.MainOffice.root.find('CeilingLight').object3d.children.find(o => o.isLight);
    const beacon = scene.rooms.Airlock.beacon;
    const before = { ceiling: ceiling.intensity, beacon: beacon.intensity };
    scene.power.setOn(false);
    scene.power.update(0.016);
    expect(ceiling.intensity).toBe(0);
    expect(beacon.intensity).toBe(before.beacon);
    scene.power.setOn(true);
    scene.power.update(0.016);
    expect(ceiling.intensity).toBe(before.ceiling);
  });

  it('feeds the signal lamp and the terminal from the grid', () => {
    scene.power.setOn(false);
    scene.power.update(0.016);
    expect(scene.rooms.MainOffice.signalLight.powerLevel).toBe(0);
    expect(scene.terminal.powered).toBe(false);
    scene.power.setOn(true);
    expect(scene.terminal.powered).toBe(true);
  });

  it('builds the UFO hidden, to hover high over the office, outside the occlusion zones', () => {
    expect(scene.ufo).toBeInstanceOf(Ufo);
    expect(scene.ufo.body.visible).toBe(false);
    const hover = scene.ufoThreat.hoverPoint;
    expect(scene.rooms.MainOffice.containsPoint(new THREE.Vector3(hover.x, 1, hover.z))).toBe(true);
    expect(hover.y).toBeGreaterThan(25);
    expect(scene._outside.object3d.getObjectById(scene.ufo.object3d.id)).toBeUndefined();
  });

  it('the building is solid to the searchlight: every room mesh draws both faces into its shadow map', () => {
    const shadowCam = scene.ufo.searchlight.shadow.camera;
    for (const part of [...Object.values(scene.rooms), ...Object.values(scene.corridors)]) {
      let wall = null;
      part.root.object3d.traverse(o => { if (!wall && o.isMesh && o.name === 'Floor') wall = o; });
      const depth = { side: THREE.BackSide };
      wall.onBeforeShadow(null, wall, null, shadowCam, null, depth, null);
      expect(depth.side, part.name).toBe(THREE.DoubleSide);
    }
  });

  it('cuts the visible beam out of every room and corridor, so it ends on the roofs', () => {
    const u = scene.ufo.beamMesh.material.uniforms;
    const parts = [...Object.values(scene.rooms), ...Object.values(scene.corridors)];
    expect(u.uCutoutCount.value).toBe(parts.length);
    const office = scene.rooms.MainOffice.bounds();
    const i = u.uCutoutMin.value.findIndex(v => v.equals(office.min));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(u.uCutoutMax.value[i].equals(office.max)).toBe(true);
  });

  it('lights the office window\'s smudges by the night outside and by the beam in the window', () => {
    const glass = scene.rooms.MainOffice.windowGlass;
    const light = glass.mesh.material.uniforms.uLight.value;
    const shown = () => { glass.mesh.onBeforeRender(); return light.length(); };

    // The ceiling light off: what is left is the ambient light, faintly.
    scene.rooms.MainOffice.root.find('CeilingLight').object3d.children.find(c => c.isLight).intensity = 0;
    const dark = shown();
    expect(dark).toBeGreaterThan(0);
    scene.ambientLight.intensity *= 2;
    expect(shown()).toBeCloseTo(dark * 2);

    // The UFO's beam through the glass lights them up.
    scene.windowFlood.intensity = 60;
    expect(shown()).toBeGreaterThan(dark * 4);
  });

    it('has a dark light inside the office, under the window, spilling the lethal beam in', () => {
    const flood = scene.windowFlood;
    const office = scene.rooms.MainOffice;
    expect(flood.intensity).toBe(0);
    expect(scene.ufoThreat.flood.light).toBe(flood);
    flood.updateMatrixWorld(true);
    const at = flood.getWorldPosition(new THREE.Vector3());
    const to = flood.target.getWorldPosition(new THREE.Vector3());
    // Inside the room, just in from the window, under its header…
    expect(office.containsPoint(at)).toBe(true);
    expect(at.z - office.bounds().min.z).toBeLessThan(1);
    expect(at.y).toBeLessThan(2.825);
    // …aimed steeply down into the room, never up at the walls' tops.
    const dir = to.clone().sub(at).normalize();
    expect(dir.y).toBeLessThan(-0.5);
    expect(dir.z).toBeGreaterThan(0);
    expect(Math.acos(-dir.y) + flood.angle).toBeLessThan(Math.PI / 2);   // the cone never rises above level
    // Its own static shadow: the desk keeps the floor beneath it dark.
    expect(flood.castShadow).toBe(true);
  });

  // A passage's lamp without a shadow lit the yard and the rooms beyond its
  // walls (#87). Each shadowed light is a texture unit in every lit shader,
  // of the sixteen WebGL guarantees, so the count is kept in sight too.
  it('every passage light keeps to its passage, and the shadowed lights stay within budget', () => {
    for (const passage of [...Object.values(scene.corridors), scene.rooms.Airlock]) {
      const lamp = passage.root.find('CorridorLight').object3d.children.find(o => o.isPointLight);
      expect(lamp.castShadow, passage.name).toBe(true);
    }
    let shadowed = 0;
    engine.scene.traverse(o => { if (o.isLight && o.castShadow) shadowed++; });
    expect(shadowed).toBeLessThanOrEqual(8);
  });

  it('a blow-out spares the dish pad floods and the desk screen glow, once power is back', () => {
    const flood = scene.dishPad.object3d.getObjectByName('DishFlood_0');
    const screen = scene.rooms.MainOffice.screenGlow;
    const ceiling = scene.rooms.MainOffice.root.find('CeilingLight').object3d.children.find(o => o.isLight);
    const before = { flood: flood.intensity, screen: screen.intensity };
    scene.power.breakLights();
    scene.power.update(0.016);
    expect(flood.intensity).toBe(0);    // the generator tripped
    expect(screen.intensity).toBe(0);
    scene.power.resetBreakers();
    scene.power.setOn(true);
    scene.power.update(0.016);
    expect(ceiling.intensity).toBe(0);
    expect(flood.intensity).toBe(before.flood);
    expect(screen.intensity).toBe(before.screen);
    expect(screen.intensity).toBeGreaterThan(0);
  });

  it('after a UFO blow-out the generator opens the breaker panel instead of switching on', () => {
    const generator = scene._sceneRoot.find('Outside').find('Generator');
    const sw = generator.getComponent(Interactable);
    scene.power.breakLights();
    expect(sw.promptLabel).toMatch(/breakers/i);

    sw.onInteract({});
    expect(scene.breakerPanel.isOpen).toBe(true);
    expect(scene.power.on).toBe(false);

    // Stepping away and back keeps the same half-done puzzle.
    const puzzle = scene.breakerPanel._puzzle;
    scene.breakerPanel.close();
    sw.onInteract({});
    expect(scene.breakerPanel._puzzle).toBe(puzzle);

    // Every flick clicks.
    expect(typeof scene.breakerPanel._callbacks.onFlick).toBe('function');
    expect(() => scene.breakerPanel._callbacks.onFlick()).not.toThrow();

    // Solved: breakers in, generator started.
    const on = vi.spyOn(scene.generatorSound, 'switchOn');
    scene.breakerPanel._callbacks.onSolved();
    expect(scene.power.tripped).toBe(false);
    expect(scene.power.on).toBe(true);
    expect(on).toHaveBeenCalled();
    expect(sw.promptLabel).toMatch(/cut power/i);
  });

  it('a new night shuts a breaker panel left open, and its next blow-out is a fresh puzzle', () => {
    const generator = scene._sceneRoot.find('Outside').find('Generator');
    scene.power.breakLights();
    generator.getComponent(Interactable).onInteract({});
    const first = scene.breakerPanel._puzzle;
    scene.power.repair();
    expect(scene.breakerPanel.isOpen).toBe(false);
    scene.power.breakLights();
    generator.getComponent(Interactable).onInteract({});
    expect(scene.breakerPanel._puzzle).not.toBe(first);
  });

  it('gives the generator its sound, switched by its Interactable', () => {
    const generator = scene._sceneRoot.find('Outside').find('Generator');
    expect(generator.getComponent(GeneratorSound)).toBe(scene.generatorSound);
    const off = vi.spyOn(scene.generatorSound, 'switchOff');
    generator.getComponent(Interactable).onInteract({});
    const puzzle = scene.breakerPanel._puzzle;
    puzzle.switches.forEach((_, i) => puzzle.toggle(i));
    scene.breakerPanel._callbacks.onSolved();
    expect(off).toHaveBeenCalled();
  });

  it('runs a UfoThreat on the gameplay systems, wired to the controller, grid and radar', () => {
    const threat = scene._sceneRoot.find('GameplaySystems').getComponent(UfoThreat);
    expect(threat).toBe(scene.ufoThreat);
    expect(threat.controller).toBe(scene.gameController);
    expect(threat.grid).toBe(scene.power);
    expect(threat.radar).toBe(scene.radarOverlay);
    expect(threat.signalLight).toBe(scene.rooms.MainOffice.signalLight);
  });

  it('runs an EvilSignal on the gameplay systems, wired to the terminal, drives and array', () => {
    const evil = scene._sceneRoot.find('GameplaySystems').getComponent(EvilSignal);
    expect(evil).toBe(scene.evilSignal);
    expect(evil.controller).toBe(scene.gameController);
    expect(evil.signalManager).toBe(scene.signalManager);
    expect(evil.terminal).toBe(scene.terminal);
    expect(evil.driveManager).toBe(scene.driveManager);
    expect(evil.satellite).toBe(scene.satellite);
    expect(scene.terminal.evilSignal).toBe(evil);
  });

  it('in view of the window means anywhere in the main office — no hiding behind the furniture', () => {
    const { exposedToBeam } = scene.ufoThreat.hooks;
    const office = scene.rooms.MainOffice;
    const [ox, , oz] = office.position;
    const desk = office.root.find('ComputerDesk').object3d.getWorldPosition(new THREE.Vector3());
    expect(exposedToBeam(new THREE.Vector3(desk.x, 0.45, desk.z + 0.2))).toBe(true);   // crouched under the desk
    expect(exposedToBeam(new THREE.Vector3(ox + 5.6, 1.24, oz - 4.5))).toBe(true);      // tucked beside the window
    expect(exposedToBeam(new THREE.Vector3(ox, 1.24, oz + 4.5))).toBe(true);            // by the front door
    // Out of the office, out of view.
    const corridor = scene.corridors.OfficeToServer.position;
    expect(exposedToBeam(new THREE.Vector3(corridor[0], 1.24, corridor[2]))).toBe(false);
    const quarters = scene.rooms.LivingQuarters.position;
    expect(exposedToBeam(new THREE.Vector3(quarters[0], 1.24, quarters[2]))).toBe(false);
  });

    it('never counts a doorway as outside: walking room to corridor to room is indoors all the way', () => {
    const { isOutside } = scene.ufoThreat.hooks;
    const centre = r => new THREE.Vector3(r.position[0], 1.24, r.position[2]);
    const walk = (from, to) => {
      for (let k = 0; k <= 400; k++) {
        const p = from.clone().lerp(to, k / 400);
        expect(isOutside(p), `(${p.x.toFixed(2)}, ${p.z.toFixed(2)})`).toBe(false);
      }
    };
    const { MainOffice, ServerRoom, LivingQuarters, Airlock } = scene.rooms;
    // Through each side doorway, along the corridor's line.
    for (const [corridor, room] of [[scene.corridors.OfficeToServer, ServerRoom], [scene.corridors.OfficeToQuarters, LivingQuarters]]) {
      const z = corridor.position[2];
      walk(new THREE.Vector3(MainOffice.position[0], 1.24, z), new THREE.Vector3(room.position[0], 1.24, z));
    }
    // Through the front door into the airlock.
    const door = MainOffice.doors.find(d => d.targetRoom === 'Airlock').object3d.getWorldPosition(new THREE.Vector3());
    walk(new THREE.Vector3(door.x, 1.24, MainOffice.position[2]), new THREE.Vector3(door.x, 1.24, centre(Airlock).z));
  });

  it('with the lights on, the airlock is as unsafe as the office; the corridors are not', () => {
    const { exposedToBeam } = scene.ufoThreat.hooks;
    const airlock = scene.rooms.Airlock.position;
    expect(exposedToBeam(new THREE.Vector3(airlock[0], 1.24, airlock[2]))).toBe(true);
    const corridor = scene.corridors.OfficeToQuarters.position;
    expect(exposedToBeam(new THREE.Vector3(corridor[0], 1.24, corridor[2]))).toBe(false);
  });

    it('a retry puts the player back at the start, suit off — a new night after sleeping does not', () => {
    const spawn = engine.buildPlayer.mock.calls[0][0].position;
    const player = engine.player;

    // Taken out in the yard, suit on.
    scene.suit.putOn();
    player.object3d.position.set(7, 1, 9);
    scene.gameController.fail('taken');
    scene.gameController.retryNight();
    expect(player.object3d.position.toArray()).toEqual(spawn);
    expect(scene.suit.worn).toBe(false);

    // Sleeping into the next night leaves you where you are (in bed).
    player.object3d.position.set(-15, 1, 1);
    scene.nights.advance();
    expect(player.object3d.position.toArray()).toEqual([-15, 1, 1]);
  });

    it('knows outside from in: rooms and corridors are inside, the yard is not', () => {
    const { isOutside } = scene.ufoThreat.hooks;
    expect(isOutside(new THREE.Vector3(0, 1.2, 0))).toBe(false);                 // the office
    const corridor = scene.corridors.OfficeToServer.position;
    expect(isOutside(new THREE.Vector3(corridor[0], 1.2, corridor[2]))).toBe(false);
    expect(isOutside(new THREE.Vector3(7, 1.2, 9))).toBe(true);                  // by the generator
  });
});

describe('BaseScene sandstorms', () => {
  let engine, scene;

  beforeEach(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
  });

  it('runs a Sandstorm on the gameplay systems, after Daylight, wired to the fog, sky and dust', () => {
    const systems = scene._sceneRoot.find('GameplaySystems');
    const storm = systems.getComponent(Sandstorm);
    expect(storm).toBe(scene.sandstorm);
    expect(storm.controller).toBe(scene.gameController);
    expect(storm.fog).toBe(engine.scene.fog);
    expect(storm.sky).toBe(scene.sky);
    expect(storm.dust).toBeInstanceOf(DustStorm);
    // Daylight rewrites the fog colour; the storm must lay itself on top.
    const order = systems.components;
    expect(order.indexOf(storm)).toBeGreaterThan(order.indexOf(scene.daylight));
  });

  it('keeps the dust on the scene root, out of the occlusion zones', () => {
    expect(scene.dust.parent).toBe(scene._sceneRoot);
  });

  it('cuts every room and corridor out of the dust', () => {
    const parts = [...Object.values(scene.rooms), ...Object.values(scene.corridors)];
    expect(scene.dust.points.material.uniforms.uCutoutCount.value).toBe(parts.length);
  });

  it('frees the dust on dispose', () => {
    const dispose = vi.spyOn(scene.dust, 'dispose');
    scene.dispose();
    expect(dispose).toHaveBeenCalled();
  });
});

describe('BaseScene dust eyes', () => {
  let engine, scene;

  beforeEach(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
  });

  it('runs DustEyes on the gameplay systems, after the storm it reads', () => {
    const systems = scene._sceneRoot.find('GameplaySystems');
    const eyes = systems.getComponent(DustEyes);
    expect(eyes).toBe(scene.dustEyes);
    expect(eyes.sandstorm).toBe(scene.sandstorm);
    expect(eyes.controller).toBe(scene.gameController);
    expect(systems.components.indexOf(eyes)).toBeGreaterThan(systems.components.indexOf(scene.sandstorm));
  });

  it('tints the silhouettes from the live fog', () => {
    expect(scene.dustEyes.fog).toBe(engine.scene.fog);
  });

  it('keeps the storm off the UFO', () => {
    expect(scene.sandstorm.ufo).toBe(scene.ufoThreat);
  });

  it('hands the storm the moonlight and the night\'s ambient light to dim', () => {
    expect(scene.sandstorm.moon).toBe(scene.moonLight);
    expect(scene.sandstorm.ambient).toBe(scene.ambientLight);
  });

  it('builds its eyes up front, hidden, on the scene root', () => {
    expect(scene.dustEyes.slots.length).toBeGreaterThanOrEqual(2);
    for (const { go } of scene.dustEyes.slots) {
      expect(go).toBeInstanceOf(DustEye);
      expect(go.parent).toBe(scene._sceneRoot);
      expect(go.object3d.visible).toBe(false);
    }
  });

  it('knows the fence it spawns beyond, and the window it is seen through', () => {
    const { fence, window: win } = scene.dustEyes;
    expect(fence).toEqual(expect.objectContaining({ minX: scene.fence.rect.minX, maxZ: scene.fence.rect.maxZ }));
    // From the desk chair, out through the middle of the glass.
    const office = scene.rooms.MainOffice;
    const [ox, , oz] = office.position;
    const seat = new THREE.Vector3(ox, 1.24, oz - 2);
    expect(throughWindow(seat, new THREE.Vector3(ox, 1.6, oz - 25), win)).toBe(true);
    expect(throughWindow(seat, new THREE.Vector3(ox + 40, 1.6, oz - 25), win)).toBe(false);
  });

  it('is safe from a chase only once the airlock hatch is shut', () => {
    const { hatch } = scene.rooms.Airlock;
    hatch.locked = false;
    expect(scene.dustEyes.hooks.hatchShut()).toBe(false);
    hatch.locked = true;
    expect(scene.dustEyes.hooks.hatchShut()).toBe(true);
  });

  it('frees its eyes on dispose', () => {
    const spies = scene.dustEyes.slots.map(({ go }) => vi.spyOn(go, 'dispose'));
    scene.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});

describe('BaseScene generator corner', () => {
  it('stands the generator in the far corner of the fenced yard, on the side away from the buggy', () => {
    const engine = makeSceneEngine();
    const scene = new BaseScene(engine);
    scene.build();
    const outside = scene._sceneRoot.find('Outside');
    const gen = worldPos(outside.find('Generator'));
    const buggy = worldPos(outside.find('Buggy') ?? { object3d: new THREE.Object3D() });
    const { rect } = scene.fence;
    // Inside the wire…
    expect(gen.x).toBeLessThan(rect.maxX);
    expect(gen.z).toBeLessThan(rect.maxZ);
    // …tucked into the corner (within a few metres of both runs)…
    expect(rect.maxX - gen.x).toBeLessThan(3);
    expect(rect.maxZ - gen.z).toBeLessThan(3);
    // …across the yard from the buggy.
    expect(Math.sign(gen.x)).not.toBe(Math.sign(buggy.x || -1));
  });
});

describe('BaseScene storm outage', () => {
  it('runs a StormOutage on the storm and the grid, cutting the power through the generator', () => {
    const engine = makeSceneEngine();
    const scene = new BaseScene(engine);
    scene.build();
    const outage = scene._sceneRoot.find('GameplaySystems').getComponent(StormOutage);
    expect(outage).toBe(scene.stormOutage);
    expect(outage.sandstorm).toBe(scene.sandstorm);
    expect(outage.grid).toBe(scene.power);
    const off = vi.spyOn(scene.generatorSound, 'switchOff');
    outage.cutPower();
    expect(off).toHaveBeenCalled();
    expect(scene.power.on).toBe(false);
    expect(scene.power.tripped).toBe(false);   // the switches alone bring it back
  });
});

describe('BaseScene dust eyes keep out of things', () => {
  it('know the trees, and steer round the buggy and the generator', () => {
    const engine = makeSceneEngine();
    const scene = new BaseScene(engine);
    scene.build();
    const belt = scene._sceneRoot.find('Outside').find('MarsVegetation');
    expect(scene.dustEyes.trees).toBe(belt.trees);
    const gen = worldPos(scene._sceneRoot.find('Outside').find('Generator'));
    const inBox = b => gen.x > b.minX && gen.x < b.maxX && gen.z > b.minZ && gen.z < b.maxZ;
    expect(scene.dustEyes.obstacles.some(inBox)).toBe(true);
  });

  it('know the building as something that hides them from the player', () => {
    const engine = makeSceneEngine();
    const scene = new BaseScene(engine);
    scene.build();
    const parts = [...Object.values(scene.rooms), ...Object.values(scene.corridors)];
    expect(scene.dustEyes.occluders).toHaveLength(parts.length);
    const office = scene.rooms.MainOffice.bounds();
    expect(scene.dustEyes.occluders.some(b => b.minX === office.min.x && b.maxZ === office.max.z)).toBe(true);
  });

  it('count the airlock as solid, slopes and all, with its hatch as the one way in', () => {
    const engine = makeSceneEngine();
    const scene = new BaseScene(engine);
    scene.build();
    const shell = scene.rooms.Airlock.bounds();
    const hatch = worldPos(scene.rooms.Airlock.hatch);
    const box = scene.dustEyes.obstacles.find(b => b.door);
    expect(box).toBeTruthy();
    // Out to the bunker's slopes either side of it, which a chase goes round.
    expect(box.minX).toBeCloseTo(shell.min.x - BUNKER.batter);
    expect(box.maxX).toBeCloseTo(shell.max.x + BUNKER.batter);
    expect(box.maxZ).toBeCloseTo(shell.max.z);
    expect(box.door.x).toBeCloseTo(hatch.x);
    expect(box.door.z).toBeCloseTo(hatch.z);
  });
});

describe('BaseScene generator noise', () => {
  it('finishing the generator panel — off or on — rolls for an eye', () => {
    const engine = makeSceneEngine();
    const scene = new BaseScene(engine);
    scene.build();
    const noise = vi.spyOn(scene.dustEyes, 'generatorNoise');
    const generator = scene._sceneRoot.find('Outside').find('Generator');
    const use = generator.getComponent(Interactable);
    const solve = () => {
      const puzzle = scene.breakerPanel._puzzle;
      puzzle.switches.forEach((_, i) => puzzle.toggle(i));
      scene.breakerPanel._callbacks.onSolved();
    };
    use.onInteract({});       // power on: the panel shuts it down
    expect(noise).not.toHaveBeenCalled();   // only finishing the panel counts
    solve();
    expect(noise).toHaveBeenCalledTimes(1);
    use.onInteract({});       // and back on
    solve();
    expect(noise).toHaveBeenCalledTimes(2);
  });
});

describe('BaseScene suit breathing', () => {
  it('the mask breathing is silenced on a death screen', () => {
    const engine = makeSceneEngine();
    const scene = new BaseScene(engine);
    scene.build();
    const visor = engine.player.getComponent(SuitVisor);
    scene.gameController.state = 'playing';
    expect(visor.silenced()).toBe(false);
    scene.gameController.state = 'gameOver';
    expect(visor.silenced()).toBe(true);
  });
});

describe('BaseScene storm fog stays outside', () => {
  let engine, scene;
  beforeEach(() => {
    engine = makeSceneEngine();
    scene = new BaseScene(engine);
    scene.build();
  });

  /** Every mesh under `root`, with its materials. */
  const meshesOf = (root) => {
    const out = [];
    root.traverse(o => { if (o.isMesh || o.isInstancedMesh) out.push(o); });
    return out;
  };
  const materials = (mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean);
  const building = () => [...Object.values(scene.rooms), ...Object.values(scene.corridors)];

  it('no room or corridor takes fog: the storm stays outside the glass', () => {
    for (const part of building()) {
      for (const mesh of meshesOf(part.root.object3d)) {
        for (const m of materials(mesh)) {
          if ('fog' in m) expect(m.fog, `${part.name} / ${mesh.name}`).toBe(false);
        }
      }
    }
  });

  it('nothing outside loses its fog — no material is shared across the building\'s walls', () => {
    const inside = new Set();
    for (const part of building()) {
      for (const mesh of meshesOf(part.root.object3d)) for (const m of materials(mesh)) inside.add(m);
    }
    const outside = scene._sceneRoot.find('Outside').object3d;
    for (const mesh of meshesOf(outside)) {
      for (const m of materials(mesh)) expect(inside.has(m), mesh.name).toBe(false);
    }
  });
});

describe('BaseScene fog is the same in every room', () => {
  // No room has a fog of its own, and none changes the storm's: walked
  // through every doorway, the fog is the same on every frame. Rooms that
  // wrote their own (the sealed rooms' mood fog, the storm thinned where
  // there was no window and thickened outside) showed as the storm
  // flickering or fading through the office window at a doorway (#73).
  //
  // The real frame: every root object updates, then every one late-updates.
  // The scene root (the storm, on GameplaySystems) comes before the player
  // (RoomTransitionSystem), so a room change lands after the storm's write.
  let engine, scene;
  const frame = dt => {
    for (const o of engine._rootObjects) o._update(dt);
    for (const o of engine._rootObjects) o._lateUpdate(dt);
  };
  const stand = ([x, , z]) => {
    engine.player.object3d.position.set(x, 1, z);
    engine.camera.position.set(x, 1.2, z);
    engine.camera.updateMatrixWorld(true);
  };

  /** End to end along the base, back to the office and out through the
   *  airlock into the yard, a frame every half metre: every fog drawn, every
   *  room stood in, and whether the walk got outside. */
  const walk = () => {
    const sys = engine.player.getComponent(RoomTransitionSystem);
    const { Airlock, MainOffice } = scene.rooms;
    const row = [...Object.values(scene.rooms), ...Object.values(scene.corridors)]
      .filter(part => part !== Airlock)
      .map(part => part.position)
      .sort((a, b) => a[0] - b[0]);
    const yard = [Airlock.position[0], 0, scene.fence.rect.maxZ - 2];
    const route = [...row, MainOffice.position, Airlock.position, yard];
    const fogs = new Set(), rooms = new Set();
    let outside = false;
    for (let i = 1; i < route.length; i++) {
      const [a, b] = [route[i - 1], route[i]];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.5));
      for (let s = 0; s <= steps; s++) {
        stand([a[0] + (b[0] - a[0]) * s / steps, 0, a[2] + (b[2] - a[2]) * s / steps]);
        frame(0.016);
        const { density, color } = engine.scene.fog;
        fogs.add(`${density} ${color.r} ${color.g} ${color.b}`);
        rooms.add(sys.currentRoom);
        outside ||= scene._isOutside(engine.camera.position);
      }
    }
    return { fogs, rooms, outside };
  };

  beforeEach(() => {
    engine = makeSceneEngine();
    engine.camera = new THREE.PerspectiveCamera();
    scene = new BaseScene(engine);
    scene.build();
    for (const o of engine._rootObjects) o._init(engine.scene, engine.world);
    // Midnight, past the dusk, so the daylight holds the fog's colour still.
    scene.nightClock.elapsed = scene.nightClock.nightDuration / 2;
    stand(scene.rooms.MainOffice.position);
    frame(0.016);
  });

  it('on a clear night', () => {
    const { fogs, rooms, outside } = walk();
    // The walk went everywhere: every room, a corridor, the yard.
    for (const room of Object.values(scene.rooms)) expect(rooms.has(room), room.name).toBe(true);
    expect(rooms.has(null)).toBe(true);
    expect(outside).toBe(true);
    expect([...fogs]).toHaveLength(1);
    expect(engine.scene.fog.density).toBeLessThan(0.005);
  });

  it('in a storm: no frame drawn without it, none thinner or thicker', () => {
    expect(scene.sandstorm.summon()).toBe(true);
    for (let t = 0; t < SANDSTORM.rampSeconds + 1; t += 0.5) frame(0.5);
    expect(engine.scene.fog.density).toBeCloseTo(SANDSTORM.fogDensity);
    const { fogs, rooms, outside } = walk();
    for (const room of Object.values(scene.rooms)) expect(rooms.has(room), room.name).toBe(true);
    expect(outside).toBe(true);
    expect([...fogs]).toHaveLength(1);
    expect(engine.scene.fog.density).toBeCloseTo(SANDSTORM.fogDensity);
  });
});
