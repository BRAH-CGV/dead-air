import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';
import { Satellite } from '../gameobjects/Satellite.js';
import { createMarsSky, directionFromAngles, DEFAULT_MOONS } from '../gameobjects/MarsSky.js';
import { createMarsTerrain } from '../gameobjects/MarsTerrain.js';
import { createMarsRocks } from '../gameobjects/MarsRocks.js';
import { createMarsVegetation } from '../gameobjects/MarsVegetation.js';
import { createCommTowers } from '../gameobjects/CommTowers.js';
import { createPerimeterFence, FENCE } from '../gameobjects/PerimeterFence.js';
import { createDishPad } from '../gameobjects/DishPad.js';
import { RoomTransitionSystem } from '../components/RoomTransitionSystem.js';
import { SkyFollow } from '../components/SkyFollow.js';
import { NightManager } from '../systems/NightManager.js';
import { MainOffice } from './rooms/MainOffice.js';
import { ServerRoom } from './rooms/ServerRoom.js';
import { LivingQuarters } from './rooms/LivingQuarters.js';
import { Airlock } from './rooms/Airlock.js';
import { Corridor } from './rooms/Corridor.js';
import { EVASuit } from '../components/EVASuit.js';
import { Daylight } from '../components/Daylight.js';
import { NightClock } from '../gameplay/NightClock.js';
import { SignalManager } from '../gameplay/SignalManager.js';
import { GameController } from '../gameplay/GameController.js';
import { ComputerTerminal, createComputerInteractable } from '../components/ComputerTerminal.js';
import { HUD, RadarOverlay, SignalReviewPanel } from '../ui/HUD.js';
import { ScreenFade } from '../ui/ScreenFade.js';
import { ThreatDirector } from '../gameplay/ThreatDirector.js';
import { WindowWatchers } from '../gameplay/threats/WindowWatchers.js';
import { CameraEntity } from '../gameplay/threats/CameraEntity.js';
import { SleepDemon } from '../gameplay/threats/SleepDemon.js';
import { Stamina } from '../gameplay/Stamina.js';
import { StaminaDrain } from '../components/StaminaDrain.js';
import { createMonsterFigure } from '../gameobjects/MonsterFigure.js';
import { AudioSystem, dishMotorLevel } from '../audio/AudioSystem.js';
import { Ambience } from '../audio/Ambience.js';
import { SoundCues } from '../audio/SoundCues.js';
import { BaseLights } from '../gameplay/BaseLights.js';
import { Power } from '../gameplay/Power.js';
import { GeneratorSwitch } from '../components/GeneratorSwitch.js';
import { CrtScreen, createCrtScreenMesh, RETRO_COMPUTER_SCREEN } from '../components/CrtScreen.js';
import { createCrtMaterial } from '../shaders/CrtScreen.js';
import { Oxygen } from '../gameplay/Oxygen.js';
import { OxygenSupply } from '../components/OxygenSupply.js';

/** Scratch for the player's world position (read every frame, never kept). */
const _playerPos = new THREE.Vector3();

// ─────────────────────────────────────────────
// BaseScene  –  the whole base as one continuous scene
// ─────────────────────────────────────────────
// Three rooms joined by corridors, an airlock, and the small outside area —
// all of it standing on the Mars valley (MarsTerrain), under the procedural
// night sky and its two moons (MarsSky). Nothing is loaded per night, and
// every interior door is open from night 1 — NightManager only counts
// nights. The one door that stays shut is the airlock hatch, and it opens
// for the EVA suit (on the player), not for a night. The office's front
// door is the airlock's inner door: the interlock shuts it while the suit
// is on, so the two are never open together.
//
//   LivingQuarters ── corridor ── MainOffice ── corridor ── ServerRoom
//                                     │ front door
//                                  Airlock (suit locker)
//                                     │ hatch — suit on
//                                  Outside (generator, satellite)
//
// The office sits at the origin. Everything else is placed from the rooms'
// own sizes and the office's doorway offsets, so resizing a room or moving
// a doorway re-flows the layout instead of leaving gaps: each corridor runs
// from the office's outer wall face to the side room's, and the side room
// slides its doorway to the corridor's line.
//
// A night is a shift: 12:00 to 6:00 AM on the NightClock, which the office's
// wall clock and the HUD both show. The last hour brings the dawn (Daylight
// turns the sky, lights and fog to the Martian day). A met quota makes it
// morning, and the bunk in LivingQuarters sleeps through the day to the next
// night. Press N (Engine keyBinds.nextNight) to skip ahead; it wraps back to
// night 1 after the last.
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

/** Bearing of the lane kept open between the back window and the dish, which
 *  stands at (0, -25). The masts skip this one. */
const DISH_LANE = Math.atan2(-25, 0);

/** The colony rover is 3.4 x 3.3 x 6.6 m as downloaded. The base's exterior
 *  door is 1 m wide and 2.2 m tall, and at native size the buggy dwarfs both
 *  it and the building. Three quarters puts the roof just above the lintel. */
const BUGGY_SCALE = 0.75;

export class BaseScene extends Scene {
  /** @type {{MainOffice: MainOffice, ServerRoom: ServerRoom, LivingQuarters: LivingQuarters, Airlock: Airlock}} */
  rooms = {};
  /** @type {{OfficeToServer: Corridor, OfficeToQuarters: Corridor}} */
  corridors = {};
  /** Which night it is. The game controller follows it.
   *  @type {NightManager|null} */
  nights = null;
  /** The player's EVA suit — the airlock hatch follows it.
   *  @type {EVASuit|null} */
  suit = null;
  /** The player's room tracker. Threats read `currentRoom` off it.
   *  @type {RoomTransitionSystem|null} */
  transitions = null;
  /** Which monsters run tonight. @type {ThreatDirector|null} */
  threatDirector = null;

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
    this._addPower();
    this._addSignalStorage();
    this._addStamina();
    this._addAudio();
    this._addOxygen();
    this._addThreats();
    this._addCrtScreen();

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
    this.threatDirector?.dispose();
    this.audio?.dispose();
    this.baseLights?.restore();
    this._offNightStart?.();
    this._offSuitHud?.();
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

    // The airlock's open end sits on the office's front outer wall face,
    // centred on the front doorway — the office doorway is its way in.
    const airlock = new Airlock(engine);
    const frontDoorX = office.position[0] + office.openings.find(o => o.side === 'front').offset;
    const frontFace  = office.position[2] + office.depth / 2 + office.wallThick / 2;
    airlock.position = [frontDoorX, 0, frontFace + airlock.length / 2];

    this.rooms = { MainOffice: office, ServerRoom: server, LivingQuarters: quarters, Airlock: airlock };
    for (const room of Object.values(this.rooms)) this._sceneRoot.addChild(room.build());

    // The office's front door is the airlock's inner door: the interlock
    // shuts it behind the suit before the hatch opens.
    airlock.bindInnerDoor(office.doors.find(d => d.targetRoom === 'Airlock'));

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
    // From night 3 the terminal holds two saved signals; they count once
    // stored at the server room's console (_addSignalStorage).
    this.signalManager = new SignalManager({
      signalsPerNight: 5, payloadPool, storageFromNight: 3, storageCapacity: 2,
    });

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
      this.audio?.play('sfx:save', { volume: 0.6 });
    });
    this.reviewPanel.onDelete(() => {
      this.terminal.deleteSignal();
      this.gameController.onSignalDeleted();
      this.audio?.play('sfx:delete', { volume: 0.6 });
    });

    // One night number across the scene. NightManager owns it; the
    // controller's quota, clock and HUD follow it instead of counting on
    // their own — otherwise sleeping (or pressing N) would move to night 2
    // while the HUD still read "Night 1". autoStart is off for the same
    // reason: it hardcodes night 1.
    this.gameController.autoStart = false;
    this._offNightStart = this.gameController.bindNights(this.nights);

    // The day. Added after the controller so, within a frame, it reads the
    // state the controller has just moved to.
    this.daylight = gameplayGO.addComponent(new Daylight({
      controller: this.gameController,
      sky:        this.sky,
      ambient:    this.ambientLight,
      sun:        this.moonLight,
      fog:        this.engine.scene.fog,
    }));

    // Rooms build the clock and the bed; gameplay is handed to them here.
    const { wallClock } = this.rooms.MainOffice;
    if (wallClock) wallClock.clock = this.nightClock;
    this.screenFade = new ScreenFade();
    const { bed } = this.rooms.LivingQuarters;
    if (bed) {
      bed.controller = this.gameController;
      bed.fade       = this.screenFade;
    }

    this.hud.setSuit(this.suit.worn);
    this._offSuitHud = this.suit.onChange(worn => this.hud.setSuit(worn));
  }

  /** Night 3's errand: the server room's console empties the terminal's
   *  storage into the quota. The room builds the console; what it stores
   *  is handed to it here. */
  _addSignalStorage() {
    const { storageConsole } = this.rooms.ServerRoom;
    if (!storageConsole) return;
    storageConsole.waiting = () => this.signalManager.pending;
    storageConsole.onUse = () => {
      this.signalManager.storeSignals();
      this.gameController.onSignalsStored();
    };
  }

  /** Night 1's clock of the body: stamina drains through each shift and the
   *  office's ration dispenser tops it up. The drain ticks on GameplaySystems
   *  after the controller (it reads the state just moved to) and before the
   *  threats (the Sleep Demon reads the value just drained). A minimal seed:
   *  the full stamina system is Hayden's. */
  _addStamina() {
    this.stamina = new Stamina();
    const { rationDispenser } = this.rooms.MainOffice;
    if (rationDispenser) rationDispenser.stamina = this.stamina;
    this.gameController.gameObject.addComponent(new StaminaDrain({
      stamina:      this.stamina,
      controller:   this.gameController,
      hud:          this.hud,
      onNightStart: () => this._startOfNight(),
      lights:       this.baseLights,
    }));
  }

  /** What every night, and every retry of one, puts back: the dispenser's
   *  refill, the power and the suit's air. */
  _startOfNight() {
    this.rooms.MainOffice.rationDispenser?.reset();
    this.power?.reset();
    this.oxygen?.reset();
  }

  /** The EVA suit's air: it drains while the suit is worn outside and
   *  refills in the pressurised airlock. RoomTransitionSystem can't tell a
   *  corridor from outside (both are null), so "outside" is its own test:
   *  not inside any room's or corridor's shell. Those never move, so their
   *  boxes are measured once here. On GameplaySystems after the audio, whose
   *  helmet beep it plays. */
  _addOxygen() {
    const shells = [...Object.values(this.rooms), ...Object.values(this.corridors)]
      .map(part => part.bounds());
    const player = this.engine.player;
    const airlock = this.rooms.Airlock;

    this.oxygen = new Oxygen();
    this.gameController.gameObject.addComponent(new OxygenSupply({
      oxygen:      this.oxygen,
      suit:        this.suit,
      controller:  this.gameController,
      hud:         this.hud,
      audio:       this.audio,
      isOutside:   () => {
        player.object3d.getWorldPosition(_playerPos);
        return !shells.some(box => box.containsPoint(_playerPos));
      },
      isRefilling: () => this.transitions.currentRoom === airlock && airlock.state === 'pressurised',
    }));
  }

  // ──────────────────────────────────────────
  // Power
  // ──────────────────────────────────────────
  /** The generator feeds the base. Every room's and corridor's lights go on
   *  one BaseLights; Power drives its 'power' factor, and the generator's
   *  lever switches it. A cut leaves the emergency glow, kills the terminal
   *  and parks the dish. The airlock runs on its own battery (its beacon is
   *  not registered, and nothing here touches its doors), so a cut can never
   *  shut the player outside. On GameplaySystems before the threats, which
   *  read the lights. */
  _addPower() {
    const lights = this.baseLights = new BaseLights();
    for (const part of [...Object.values(this.rooms), ...Object.values(this.corridors)]) {
      lights.register(part.lights);
    }

    const power = this.power = this.gameController.gameObject.addComponent(new Power({ lights }));
    this.generator.addComponent(new GeneratorSwitch()).bind(power);

    const cut = { at: this.generator.object3d };
    power.onChange(on => {
      this.terminal.setPowered(on);
      this.satellite.powered = on;
      if (!on) this.audio?.play('sfx:power-cut', cut);
    });
  }

  // ──────────────────────────────────────────
  // Sound
  // ──────────────────────────────────────────
  /** One AudioSystem for the scene, on GameplaySystems before the threats
   *  so they find it in their context. Around it:
   *
   *    Ambience   the base's machinery or the wind, with the room's tone over it
   *    SoundCues  the scanner, the shift's end and the airlock, off their state
   *    emitters   the racks, the generator and the dish drive, each as loud
   *               as it is working
   *
   *  Without Web Audio (tests, a locked-down browser) every call is a no-op. */
  _addAudio() {
    const gameplayGO = this.gameController.gameObject;
    const audio = this.audio = gameplayGO.addComponent(new AudioSystem({
      camera: this.engine.camera ?? null,
      assets: this.engine.assets,
    }));
    const { Airlock: airlock } = this.rooms;

    gameplayGO.addComponent(new Ambience({
      audio,
      transitions: this.transitions,
      corridors:   Object.values(this.corridors),
      player:      this.engine.player.object3d,
      airlock,
    }));
    gameplayGO.addComponent(new SoundCues({
      audio,
      terminal:   this.terminal,
      controller: this.gameController,
      airlock,
      airlockAt:  airlock?.root.object3d ?? null,
    }));

    const rack = this.rooms.ServerRoom.root.find('ServerRack_2');
    const serverHum = audio.positional('amb:server-hum', (rack ?? this.rooms.ServerRoom.root).object3d,
      { volume: 0.5, refDistance: 3 }).setLevel(1);
    const generator = audio.positional('amb:generator', this.generator.object3d,
      { volume: 0.8, refDistance: 4 });
    audio.follow(generator, { level: () => (this.power.on ? 1 : 0) });
    const dishMotor = audio.positional('amb:dish-motor', this.satellite.object3d,
      { volume: 0.7, refDistance: 12 });
    audio.follow(dishMotor, { level: () => dishMotorLevel(this.satellite) });
    this.audioEmitters = { serverHum, generator, dishMotor };

    const { rationDispenser } = this.rooms.MainOffice;
    if (rationDispenser) {
      const eat = { at: rationDispenser.transform };
      rationDispenser.onEat = () => audio.play('sfx:ration', eat);
    }
  }

  // ──────────────────────────────────────────
  // Threats (one per night — ThreatDirector's table)
  // ──────────────────────────────────────────
  /** The monsters and the director that runs them. The director goes on
   *  GameplaySystems after the controller, so within a frame it reads the
   *  state the controller has just moved to.
   *
   *  Monster visuals hang under a Threats group, built hidden and with no
   *  collider: a monster that isn't a body can't push the player through a
   *  wall. */
  _addThreats() {
    this._threats = this._group('Threats');

    this.threatContext = {
      engine:      this.engine,
      scene:       this,
      player:      this.engine.player,
      rooms:       this.rooms,
      transitions: this.transitions,
      hud:         this.hud,
      stamina:     this.stamina,
      audio:       this.audio,
      lights:      this.baseLights,
    };
    this.threatDirector = new ThreatDirector({
      controller: this.gameController,
      context:    this.threatContext,
      hud:        this.hud,
    });

    this.gameController.gameObject.addComponent(this.threatDirector);

    this._addSleepDemon();
    this._addWindowWatchers();
    this._addCameraEntity();
  }

  /** The terminal monitor's picture: a CRT radar shader on a plane over
   *  the desk model's glass (see src/shaders/CrtScreen.js). It shows the
   *  dish's scan, dies with the power, and breaks up while a Watcher looks
   *  in. Added after the terminal, so the terminal's Interactable stays the
   *  first one on the desk. */
  _addCrtScreen() {
    const desk = this.rooms.MainOffice.root.find('ComputerDesk');
    if (!desk) return;
    const material = this._own(createCrtMaterial({ bulge: RETRO_COMPUTER_SCREEN.bulge }));
    const mesh = createCrtScreenMesh(material);
    this._own(mesh.geometry);
    desk.object3d.add(mesh);
    const watchers = this.threatDirector.threats.get('windowWatchers');
    desk.addComponent(new CrtScreen({
      material,
      satellite: this.satellite,
      power:     this.power,
      disturbed: () => watchers?.logic.phase === 'peer',
    }));
  }

  /** Night 1: something steps closer through the rooms as you tire. */
  _addSleepDemon() {
    const figure = createMonsterFigure({
      name: 'SleepDemon', height: 2.2, placeholderFor: 'sleep-demon.glb',
    });
    this._threats.addChild(figure);
    this._ownResourcesOf(figure);
    this.threatDirector.register('sleepDemon', new SleepDemon({ figure }));
  }

  /** Night 2: a figure walks up to the office window. */
  _addWindowWatchers() {
    const figure = createMonsterFigure({
      name: 'WindowWatcher', height: 2.4, placeholderFor: 'window-watcher.glb',
    });
    this._threats.addChild(figure);
    this._ownResourcesOf(figure);
    this.threatDirector.register('windowWatchers', new WindowWatchers({ figure }));
  }

  /** Night 3: the server room's ceiling camera sweeps the aisle to the
   *  storage console. The room builds the rig; the threat drives it. */
  _addCameraEntity() {
    this.threatDirector.register('cameraEntity', new CameraEntity());
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
    this.sky = sky;   // Daylight turns its uDawn

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
    // Daylight reads these night values as its starting point.
    this.ambientLight = new THREE.AmbientLight(0x435472, 0.72);
    ambientGO.object3d.add(this.ambientLight);
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
    // Doubles as the sunlight in the morning — Daylight warms and brightens it.
    this.moonLight = moon;

    // No hand-placed moon prop or its point light here any more. MarsSky
    // hangs the real Phobos and Deimos at sky distance with their own halos;
    // the old 0.85 m sphere sat 15 m out, which read fine against a blank
    // backdrop and would read as a glowing ball hovering over the valley.
  }

  // ──────────────────────────────────────────
  // Outside area (through the airlock, suit on)
  // ──────────────────────────────────────────
  _buildOutside() {
    const { engine } = this;

    // Scenery clears a yard shaped to the base's own outline rather than a
    // circle at the origin — the rooms run 33 m east to west but only 10 m
    // deep, so a circle wide enough for the wings sits twenty metres off the
    // back wall. Bounds are read off the rooms themselves, so moving a room
    // moves the cleared ground with it.
    const footprint = this._baseFootprint();
    const rocks = createMarsRocks({ footprint });
    const belt = createMarsVegetation({
      footprint,
      assets: engine.assets,
      // The belt closes the horizon all round, so the way out to the dish has
      // to be one of the lanes through it, not just a clearing at its feet.
      lanes: [DISH_LANE],
    });
    // Masts on the rim, blinking. The belt closed the horizon, so these are
    // what is left to look at in the distance — and standing one at the end of
    // each clearing is what makes the clearings read as roads to somewhere
    // rather than as gaps. The dish road is left out: the dish is what you are
    // meant to see down that one.
    const roads = belt.lanes
      .map(lane => lane.bearing)
      .filter(bearing => bearing !== DISH_LANE);
    const towers = createCommTowers({ alignTo: roads });

    // Chain-link round the compound, opening wherever a lane crosses it — so
    // the paths through the belt and the gaps in the wire are the same five
    // ways out, not two unrelated sets of gaps. The dish lane's own width
    // left a gap of a few metres between its gate and the next lane's, on the
    // side toward the western wing — too narrow for a real gate, but wide
    // enough for the tiler to stand one isolated panel in it, right in front
    // of the dish. Widened past that neighbour's edge so the two merge into
    // one gate instead of leaving a stray panel between them.
    const fenceLanes = belt.lanes.map(lane =>
      lane.bearing !== DISH_LANE ? lane : { ...lane, halfWidth: 9 });
    const fence = createPerimeterFence({
      lanes: fenceLanes,
      assets: engine.assets,
      world: engine.world,
    });

    for (const field of [rocks, belt, towers, fence]) {
      this._outside.addChild(field);
      // Every field builds its own geometry and materials, so dispose() has to
      // know about them or they survive a scene reload.
      this._ownResourcesOf(field);
    }

    // Steerable dish tower. spawnModel registers it as a root object;
    // parented under Outside it's reached through SceneRoot instead, and
    // left in both it would slew at double speed.
    this.satellite = engine.spawnModel('model:dish-tower', {
      name: 'Satellite', position: [0, 0, -25], scale: 0.137, type: Satellite,
    });
    this._adopt(this._outside, this.satellite);
    this.satellite.targetYaw   = THREE.MathUtils.degToRad(45);
    this.satellite.targetPitch = THREE.MathUtils.degToRad(-25);

    // Lit concrete under the dish. Positioned off the satellite's own
    // transform rather than a second copy of its coordinates.
    const dishPad = createDishPad({ position: this.satellite.object3d.position });
    this._outside.addChild(dishPad);
    this._ownResourcesOf(dishPad);

    // The buggy, parked in the open ground to the right as you step out the
    // door. Scaled against the doorway it stands next to: the model is 3.3 m
    // tall as downloaded, which beside a 2.2 m door reads as a machine that
    // could not get through it. BUGGY_SCALE brings the roof to just over the
    // lintel. Position and heading placed by hand in the level editor (F2).
    this._addBuggy([-7.79, 10.01], THREE.MathUtils.degToRad(95.7), 1.237);

    // The generator, out the office's front door: the player has to suit
    // up and go out to cut the power. Its lever is wired in _addPower.
    this.generator = engine.spawnModel('model:generator', { name: 'Generator', position: [7, 0, 9] });
    this._adopt(this._outside, this.generator);
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

  /**
   * Park the colony buggy.
   *
   * `y` defaults to the computed lift — the download's origin sits inside the
   * body rather than on the floor, so dropped at y = 0 the wheels end up
   * buried, and this is measured off the model's own bounds so swapping it
   * cannot quietly sink it again. Passing `y` explicitly overrides that with
   * a value read straight from the level editor (F2): easier to trust than
   * the computed one once someone has actually looked at where the wheels
   * land, and the fix if that ever needs revisiting.
   */
  _addBuggy([x, z], rotationY = 0, y) {
    const key = 'model:colony-rover';
    const bounds = this.engine.assets.getCollision?.(key)?.bounds;
    // center.y - size.y/2 is the model's lowest point, relative to its origin.
    const floorOffset = bounds ? bounds.center[1] - bounds.size[1] / 2 : 0;

    const buggy = this.engine.spawnModel(key, {
      name: 'Buggy',
      position: [x, y ?? -floorOffset * BUGGY_SCALE, z],
      rotationY,
      scale: BUGGY_SCALE,
    });
    this._adopt(this._outside, buggy);
    return buggy;
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
    // One callback, shared: the fog first, then whatever else follows the
    // player from room to room. Add to _onRoomChange, don't reassign this.
    transitions.onRoomChange = (room, previous) => this._onRoomChange(room, previous);
    engine.player.addComponent(transitions);
    this.transitions = transitions;

    // The suit rides on the player; the hatch follows it however it changes,
    // not only through the locker.
    this.suit = engine.player.addComponent(new EVASuit());
    this.rooms.Airlock.bindSuit(this.suit);
  }

  /** The player moved between rooms (null = a corridor or outside). */
  _onRoomChange(room, _previous) {
    this._applyRoomFog(room);
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
