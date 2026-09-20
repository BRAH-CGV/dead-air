import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';
import { Satellite } from '../gameobjects/Satellite.js';
import { createMarsSky, directionFromAngles, DEFAULT_MOONS } from '../gameobjects/MarsSky.js';
import { createMarsTerrain } from '../gameobjects/MarsTerrain.js';
import { createMarsRocks } from '../gameobjects/MarsRocks.js';
import { createMarsVegetation } from '../gameobjects/MarsVegetation.js';
import { RoomTransitionSystem } from '../components/RoomTransitionSystem.js';
import { Interactable } from '../components/Interactable.js';
import { SkyFollow } from '../components/SkyFollow.js';
import { NightManager } from '../systems/NightManager.js';
import { MainOffice } from './rooms/MainOffice.js';
import { ServerRoom } from './rooms/ServerRoom.js';
import { LivingQuarters } from './rooms/LivingQuarters.js';
import { Corridor } from './rooms/Corridor.js';
import { NightClock } from '../gameplay/NightClock.js';
import { SignalManager } from '../gameplay/SignalManager.js';
import { GameController } from '../gameplay/GameController.js';
import { ComputerTerminal, createComputerInteractable } from '../components/ComputerTerminal.js';
import { HUD, RadarOverlay, SignalReviewPanel } from '../ui/HUD.js';

// ─────────────────────────────────────────────
// BaseScene  –  the whole base as one continuous scene
// ─────────────────────────────────────────────
// Three rooms joined by corridors, plus the small outside area — all of it
// standing on the Mars valley (MarsTerrain), under the procedural night sky
// and its two moons (MarsSky). Nothing is loaded per night: doors lock and
// unlock instead (NightManager).
//
//   LivingQuarters ── corridor ── MainOffice ── corridor ── ServerRoom
//                                     │ front door
//                                  Outside (generator, satellite)
//
// The office sits at the origin. Everything else is placed from the rooms'
// own sizes and the office's doorway offsets, so resizing a room or moving
// a doorway re-flows the layout instead of leaving gaps: each corridor runs
// from the office's outer wall face to the side room's, and the side room
// slides its doorway to the corridor's line.
//
// Until gameplay drives the nights, press N (Engine keyBinds.nextNight) to
// advance; it wraps back to night 1 after the last.
// ─────────────────────────────────────────────

const CORRIDOR_LENGTH = 4;
const CORRIDOR_WIDTH  = 2;
/** Side rooms' centre z. Their doorways slide to meet the corridor. */
const SIDE_ROOM_Z = 1;
/** Capsule centre: the office floor centre, lifted so the capsule starts
 *  above the floor and settles onto it. */
const PLAYER_SPAWN = [0, 1, 0];

/** Fog density for the SEALED rooms — the ones with no sightline out of the
 *  base, so their density is free to be an atmosphere knob: thicker in the
 *  server room, thinner in living quarters.
 *
 *  Rooms here are small (6-12 m across), so fog only needs to be a light
 *  depth cue, not the "can't see the far wall" effect it's for outdoors —
 *  ServerRoom was originally 0.05, which combined with its dim lighting to
 *  make it borderline unreadable. Kept subtle now that the racks light
 *  themselves (see ServerRoom.buildLighting). */
const ROOM_FOG_DENSITY = {
  ServerRoom: 0.03,
  LivingQuarters: 0.008,
};

/** Density everywhere the valley is visible: the main office (whose back wall
 *  is an 8.5 m window), the corridors, and outside.
 *
 *  This is the one number the two halves of this scene had to agree on, and
 *  they did not. The engine's base fog (0.02) is opaque by ~150 m, and
 *  MarsTerrain's ridge line sits at 350-500 m — at 0.02 the office window
 *  shows flat fog colour and the valley may as well not exist. 0.0022 is the
 *  terrain's own figure: thin enough to see the rim, thick enough to keep
 *  aerial perspective between the near hills and the far ones.
 *
 *  Indoors it costs almost nothing, which is why the office can give up its
 *  own density without losing anything. FogExp2 extinction across a 10 m
 *  office is ~4% at 0.02 and ~0.05% at 0.0022: the office fog was never doing
 *  visible work, and the view out of the window is worth far more. */
const OUTDOOR_FOG_DENSITY = 0.0022;

export class BaseScene extends Scene {
  /** @type {{MainOffice: MainOffice, ServerRoom: ServerRoom, LivingQuarters: LivingQuarters}} */
  rooms = {};
  /** @type {{OfficeToServer: Corridor, OfficeToQuarters: Corridor}} */
  corridors = {};
  /** Which rooms are open tonight; re-locks doors on every change.
   *  @type {NightManager|null} */
  nights = null;

  /** GPU resources the scene itself created (ground, moon). */
  _owned = [];

  build() {
    console.time('BaseScene.build');
    const { engine } = this;

    const sceneRoot = new GameObject('SceneRoot').makeGroup();
    engine._rootObjects.push(sceneRoot);
    engine.scene.add(sceneRoot.object3d);
    this._sceneRoot = sceneRoot;

    this._outside   = this._group('Outside');
    this._corridors = this._group('Corridors');
    this._lighting  = this._group('Lighting');

    this._buildRooms();
    this._buildCorridors();
    this._setupNights();
    this._addSky();
    this._addGround();
    this._addLighting();
    this._buildOutside();
    this._spawnPlayer();
    this._addGameplaySystems();

    console.timeEnd('BaseScene.build');
    this._logBuildStats();
  }

  /** Phase 12 budget check (see docs/ROOM-BASED-SCENE-PLAN.md): how many
   *  physics bodies and Object3Ds one BaseScene build produces. */
  _logBuildStats() {
    const { engine } = this;
    let objectCount = 0;
    this._sceneRoot.object3d.traverse(() => { objectCount++; });
    const bodyCount = engine.world?.bodies?.len?.() ?? 0;
    console.log(`[BaseScene] built: ${bodyCount} physics bodies, ${objectCount} Object3Ds`);
  }

  /** Free what the rooms and the scene created. Bodies are left alone:
   *  Engine drops the whole physics world right after this. */
  dispose() {
    this._offNightChange?.();
    this._offNightStart?.();
    // Scene teardown never resets scene.fog, so hand back what _addSky
    // borrowed — otherwise the Mars horizon tint and this scene's long
    // outdoor sightlines follow us into whatever loads next.
    if (this._prevFogColor !== undefined) {
      this.engine.scene.fog?.color.setHex(this._prevFogColor);
    }
    if (this._prevFogDensity !== undefined && this.engine.scene.fog) {
      this.engine.scene.fog.density = this._prevFogDensity;
    }
    for (const part of [...Object.values(this.rooms), ...Object.values(this.corridors)]) {
      part.dispose({ removeBodies: false });
    }
    for (const resource of this._owned) resource.dispose();
    this._owned.length = 0;
    // The HUD, radar and review panel are DOM overlays living in index.html,
    // outside the scene graph — nothing tears them down for us, so a scene
    // swap would leave last night's numbers floating over the next level.
    this.hud?.hide();
    this.radarOverlay?.hide();
    this.reviewPanel?.hide();
  }

  // ──────────────────────────────────────────
  // Layout
  // ──────────────────────────────────────────
  _buildRooms() {
    const { engine } = this;
    const office = new MainOffice(engine);
    const doorZ = side => office.position[2] + office.openings.find(o => o.side === side).offset;

    // Constructed first, placed second: each position depends on the room's
    // own width. Room reads `position` only when building.
    const server   = new ServerRoom(engine,     { doorOffset: doorZ('right') - SIDE_ROOM_Z });
    const quarters = new LivingQuarters(engine, { doorOffset: doorZ('left')  - SIDE_ROOM_Z });
    const officeEdge = office.width / 2 + office.wallThick / 2;
    server.position   = [ officeEdge + CORRIDOR_LENGTH + server.wallThick / 2 + server.width / 2, 0, SIDE_ROOM_Z];
    quarters.position = [-(officeEdge + CORRIDOR_LENGTH + quarters.wallThick / 2 + quarters.width / 2), 0, SIDE_ROOM_Z];

    this.rooms = { MainOffice: office, ServerRoom: server, LivingQuarters: quarters };
    for (const room of Object.values(this.rooms)) this._sceneRoot.addChild(room.build());

    this._doorZ = { right: doorZ('right'), left: doorZ('left') };
    this._officeEdge = officeEdge;
  }

  _buildCorridors() {
    const { engine, rooms } = this;
    const mid = this._officeEdge + CORRIDOR_LENGTH / 2;
    const common = {
      length: CORRIDOR_LENGTH, width: CORRIDOR_WIDTH,
      height: rooms.MainOffice.height, wallThick: rooms.MainOffice.wallThick, axis: 'x',
    };
    this.corridors = {
      OfficeToServer:   new Corridor(engine, { ...common, name: 'OfficeToServer',   position: [ mid, 0, this._doorZ.right] }),
      OfficeToQuarters: new Corridor(engine, { ...common, name: 'OfficeToQuarters', position: [-mid, 0, this._doorZ.left] }),
    };
    for (const corridor of Object.values(this.corridors)) this._corridors.addChild(corridor.build());
  }

  // ──────────────────────────────────────────
  // Night progression
  // ──────────────────────────────────────────
  _setupNights() {
    this.nights = new NightManager();
    this.nights.applyTo(this.rooms);
    this._offNightChange = this.nights.onChange(() => this.nights.applyTo(this.rooms));
  }

  // ──────────────────────────────────────────
  // Gameplay loop (signal collection)
  // ──────────────────────────────────────────
  /** Wire the night clock, signal manager, computer terminal and game
   *  controller together, and hang them off the pieces of the base that
   *  they drive: the office's computer desk and the satellite outside.
   *
   *  Built after the rooms, the outside area and the player, because it
   *  reaches into all three. */
  _addGameplaySystems() {
    this.nightClock = new NightClock({ nightDuration: 300 });

    // Payload URLs are direct paths to the placeholder images, not manifest
    // keys — they are displayed through an HTML <img>, not a Three.js
    // texture. Relative, like every other path that has to survive the
    // upload to a LAMP subdirectory.
    const payloadPool = Array.from({ length: 8 }, (_, i) =>
      `assets/signals/signal-${i + 1}.png`,
    );
    this.signalManager = new SignalManager({ signalsPerNight: 5, payloadPool });

    // UI wrappers over the markup in index.html. With no DOM (tests) each
    // falls back to a null root and every call is a no-op.
    this.hud          = new HUD();
    this.radarOverlay = new RadarOverlay();
    this.reviewPanel  = new SignalReviewPanel();

    this.terminal = new ComputerTerminal();
    this.terminal.satellite     = this.satellite;
    this.terminal.signalManager = this.signalManager;
    this.terminal.hud           = this.hud;
    this.terminal.radar         = this.radarOverlay;
    this.terminal.reviewPanel   = this.reviewPanel;

    // The desk is a room prop, so it is found through the room rather than
    // the scene root. MainOffice deliberately leaves it without an
    // Interactable of its own — InteractionSystem takes the first one it
    // finds, and that has to be the terminal's.
    const computer = this.rooms.MainOffice.root.find('ComputerDesk');
    if (computer) {
      computer.addComponent(this.terminal);
      computer.addComponent(createComputerInteractable(this.terminal));
    } else {
      console.warn('[BaseScene] no ComputerDesk in MainOffice — terminal not attached');
    }

    const gameplayGO = new GameObject('GameplaySystems').makeGroup();
    this._sceneRoot.addChild(gameplayGO);

    this.gameController = new GameController();
    this.gameController.nightClock    = this.nightClock;
    this.gameController.signalManager = this.signalManager;
    this.gameController.satellite     = this.satellite;
    this.gameController.terminal      = this.terminal;
    this.gameController.hud           = this.hud;
    gameplayGO.addComponent(this.gameController);

    this.reviewPanel.onSave(() => {
      this.terminal.saveSignal();
      this.gameController.onSignalSaved();
    });
    this.reviewPanel.onDelete(() => {
      this.terminal.deleteSignal();
      this.gameController.onSignalDeleted();
    });

    // One night number across the scene. NightManager already owns which
    // rooms are unlocked tonight; the controller's quota, clock and HUD now
    // follow it instead of counting on their own — otherwise pressing N
    // would open night 2's doors while the HUD still read "Night 1".
    // autoStart is off for the same reason: it hardcodes night 1.
    this.gameController.autoStart = false;
    this.gameController.startNight(this.nights.currentNight);
    this._offNightStart = this.nights.onChange(night => this.gameController.startNight(night));
  }

  // ──────────────────────────────────────────
  // Sky (procedural Mars night dome and moons)
  // ──────────────────────────────────────────
  _addSky() {
    const skyGroup = this._group('Sky');

    const sky = createMarsSky();
    // The dome has a finite radius, so without this the player walks out
    // through it — it rides the camera and only ever looks infinite.
    sky.addComponent(new SkyFollow());
    skyGroup.addChild(sky);
    this._ownResourcesOf(sky);

    // Remember the fog we were handed before touching it. Scene teardown
    // never resets scene.fog, and both halves of the pair are ours now: the
    // colour here, the density in _applyRoomFog.
    this._prevFogColor   = this.engine.scene.fog?.color.getHex();
    this._prevFogDensity = this.engine.scene.fog?.density;

    // Match the fog to the dome's horizon band. Fog fades the terrain to its
    // own colour long before the dome starts, so a mismatch draws a visible
    // seam where the ground meets the sky.
    this.engine.scene.fog?.color.set(0x1f2a38);

    // Start the scene at the outdoor density. RoomTransitionSystem only
    // reports a room on its first update, and the player spawns in the office
    // facing the window — without this the first frame is drawn at whatever
    // density the engine happened to leave in scene.fog.
    if (this.engine.scene.fog) this.engine.scene.fog.density = OUTDOOR_FOG_DENSITY;
  }

  // ──────────────────────────────────────────
  // Ground (the Mars valley the whole base sits in)
  // ──────────────────────────────────────────
  _addGround() {
    // The valley brings its own heightfield collider, sampled from the same
    // height function as its mesh, so it replaces the flat plane outright.
    // Its pad is flat out to a 40 m radius and the base spans ~33 m, so every
    // room, corridor, the generator and the satellite stand on level ground.
    const terrain = createMarsTerrain(this.engine.world);
    // The pad is exactly y = 0 and the room and corridor floor slabs top out
    // at y = 0 too, so the faces are coplanar and would z-fight across every
    // floor in the base. Drop the MESH a centimetre and leave the collider
    // flush — the same trick the flat ground used, and it keeps walking out
    // of the front door step-free.
    terrain.object3d.position.y = -0.01;
    this._outside.addChild(terrain);
    this._ownResourcesOf(terrain);
  }

  // ──────────────────────────────────────────
  // Global lighting (rooms light themselves)
  // ──────────────────────────────────────────
  _addLighting() {
    const ambientGO = new GameObject('AmbientLight');
    // Down from 1.0: the valley was reading as dusk rather than night once
    // there was scenery out there to light. The rooms carry their own lamps,
    // so this is the fill the windows look out on.
    ambientGO.object3d.add(new THREE.AmbientLight(0x435472, 0.72));
    this._lighting.addChild(ambientGO);

    // Shadow frustum sized to the whole base, not just the office.
    const reach = Math.max(...Object.values(this.rooms).map(r => {
      const b = r.bounds();
      return Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z));
    })) + 2;

    const moonGO = new GameObject('MoonLight');
    // Colour and intensity are MarsSky's tuned pair, so this base is lit the
    // same way OfficeScene is — one moon, one look across both scenes.
    // Down from 1.1 for the same reason — this rakes the terrain and the
    // belt, not just the office floor.
    const moon = new THREE.DirectionalLight(0xd4d4d4, 0.8);
    // Aimed along Phobos' own angles rather than a hand-picked vector, so the
    // shadows and the moon you can actually see in the sky cannot drift apart
    // when either is retuned. Its elevation is 30 degrees, so the light rakes
    // long across the valley. 30 m out keeps the whole base inside the shadow
    // camera's near/far below.
    const { azimuth, elevation } = DEFAULT_MOONS.phobos;
    moon.position.copy(directionFromAngles(azimuth, elevation)).multiplyScalar(30);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.near   = 0.5;
    moon.shadow.camera.far    = 60;
    moon.shadow.camera.left   = -reach;
    moon.shadow.camera.right  =  reach;
    moon.shadow.camera.top    =  reach;
    moon.shadow.camera.bottom = -reach;
    moonGO.object3d.add(moon);
    this._lighting.addChild(moonGO);

    // No hand-placed moon prop or its point light here any more. MarsSky
    // hangs the real Phobos and Deimos at sky distance with their own halos;
    // the old 0.85 m sphere sat 15 m out, which read fine against a blank
    // backdrop and would read as a glowing ball hovering over the valley.
  }

  // ──────────────────────────────────────────
  // Outside area (night 3)
  // ──────────────────────────────────────────
  _buildOutside() {
    const { engine } = this;

    // Scenery clears a yard shaped to the base's own outline rather than a
    // circle at the origin — the rooms run 33 m east to west but only 10 m
    // deep, so a circle wide enough for the wings sits twenty metres off the
    // back wall. Bounds are read off the rooms themselves, so moving a room
    // moves the cleared ground with it.
    const footprint = this._baseFootprint();
    this._outside.addChild(createMarsRocks({ footprint }));
    this._outside.addChild(createMarsVegetation({
      footprint,
      assets: engine.assets,
      // The belt closes the horizon all round, so the way out to the dish has
      // to be one of the lanes through it, not just a clearing at its feet.
      lanes: [Math.atan2(-25, 0)],
    }));

    // Steerable dish tower. spawnModel registers it as a root object;
    // parented under Outside it's reached through SceneRoot instead, and
    // left in both it would slew at double speed.
    this.satellite = engine.spawnModel('model:dish-tower', {
      name: 'Satellite', position: [0, 0, -25], scale: 0.137, type: Satellite,
    });
    this._adopt(this._outside, this.satellite);
    this.satellite.targetYaw   = THREE.MathUtils.degToRad(45);
    this.satellite.targetPitch = THREE.MathUtils.degToRad(-25);

    // Generator stand-in until generator.glb arrives (asset list, P1). Out
    // the office's front door, where the player has to go to cut power.
    const generator = this._addStandIn('Generator', 'generator.glb', [7, 0.8, 9], [2.0, 1.6, 1.2], 0x5a4a32);
    generator.powerOn = true;
    generator.addComponent(new class extends Interactable {
      promptLabel = '[E] Cut power';
      onInteract() {
        generator.powerOn = !generator.powerOn;
        // TODO: cut every room's lights when powerOn is false (breaker panel).
        console.log(`[Outside] generator power ${generator.powerOn ? 'on' : 'off'}`);
      }
    }());
  }

  /** Half extents of the built base on the ground, for the scenery to clear.
   *  Measured off the rooms and corridors so it cannot drift from the layout. */
  _baseFootprint() {
    const parts = [...Object.values(this.rooms), ...Object.values(this.corridors)];
    const bounds = parts.map(part => part.bounds());
    return {
      halfX: Math.max(...bounds.map(b => Math.max(Math.abs(b.min.x), Math.abs(b.max.x)))),
      halfZ: Math.max(...bounds.map(b => Math.max(Math.abs(b.min.z), Math.abs(b.max.z)))),
    };
  }

  /** Solid box standing in for a model that hasn't been sourced yet. */
  _addStandIn(name, file, position, size, color) {
    const { world } = this.engine;
    const go = new GameObject(name);
    go.object3d.position.set(...position);
    const mesh = new THREE.Mesh(
      this._own(new THREE.BoxGeometry(...size)),
      this._own(new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.3 })),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    go.object3d.add(mesh);

    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...position));
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2), body);
    go.rigidBody = body;
    go.collider  = collider;
    go.colliders = [collider];
    go._originalSize = [...size];
    go.placeholderFor = file;
    this.engine._bodyToGO?.set(body.handle, go);

    this._outside.addChild(go);
    return go;
  }

  // ──────────────────────────────────────────
  // Player
  // ──────────────────────────────────────────
  _spawnPlayer() {
    const { engine } = this;
    engine.buildPlayer({ position: PLAYER_SPAWN });
    const transitions = new RoomTransitionSystem({
      doors: Object.values(this.rooms).flatMap(r => r.doors),
      rooms: Object.values(this.rooms),
    });
    transitions.onRoomChange = room => this._applyRoomFog(room);
    engine.player.addComponent(transitions);
  }

  /** Per-room atmosphere: dense fog in the sealed server room, light in the
   *  sealed living quarters, the outdoor density everywhere the valley is in
   *  view (the main office, the corridors, and outside). */
  _applyRoomFog(room) {
    const fog = this.engine.scene.fog;
    if (!fog) return;
    fog.density = this._fogDensityFor(room);
  }

  /** A room that can see the valley takes the outdoor density whatever else
   *  it would like; only sealed rooms get a mood of their own. Corridors and
   *  outside arrive here as room = null.
   *
   *  "Can see the valley" is read off the room's own openings — a sill above
   *  the floor is a window, per Room's opening schema — rather than from a
   *  list of room names kept in step by hand. Give a room a window and its
   *  fog follows; nobody has to remember this function exists. */
  _fogDensityFor(room) {
    if (!room) return OUTDOOR_FOG_DENSITY;
    if (room.openings?.some(o => (o.sill ?? 0) > 0)) return OUTDOOR_FOG_DENSITY;
    return ROOM_FOG_DENSITY[room.name] ?? OUTDOOR_FOG_DENSITY;
  }

  // ──────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────
  _group(name) {
    const go = new GameObject(name).makeGroup();
    this._sceneRoot.addChild(go);
    return go;
  }

  /** Track every geometry and material under a generated object so dispose()
   *  frees them. MarsSky and MarsTerrain build fresh GPU resources per call
   *  instead of sharing cached ones, so this scene owns them — unlike props
   *  pulled from the asset cache, which it must never dispose (AGENTS.md). */
  _ownResourcesOf(go) {
    go.object3d.traverse(o => {
      if (o.geometry) this._own(o.geometry);
      if (Array.isArray(o.material)) o.material.forEach(m => this._own(m));
      else if (o.material) this._own(o.material);
    });
  }

  /** Parent a spawned model under `parent` and drop it from the root list. */
  _adopt(parent, go) {
    const roots = this.engine._rootObjects;
    const i = roots.indexOf(go);
    if (i !== -1) roots.splice(i, 1);
    parent.addChild(go);
  }

  _own(resource) {
    this._owned.push(resource);
    return resource;
  }
}
