import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';
import { Satellite } from '../gameobjects/Satellite.js';
import { createDefaultNeighbourDishes } from '../gameobjects/DishRig.js';
import { createMarsSky, directionFromAngles, DEFAULT_MOONS } from '../gameobjects/MarsSky.js';
import { createMarsTerrain } from '../gameobjects/MarsTerrain.js';
import { createMarsRocks } from '../gameobjects/MarsRocks.js';
import { createMarsVegetation } from '../gameobjects/MarsVegetation.js';
import { createCommTowers } from '../gameobjects/CommTowers.js';
import { createPerimeterFence, yardRect, fenceKeepOut, FENCE } from '../gameobjects/PerimeterFence.js';
import { createDishPad } from '../gameobjects/DishPad.js';
import { createWindDust, WindDustMotion } from '../gameobjects/WindDust.js';
import { RoomTransitionSystem } from '../components/RoomTransitionSystem.js';
import { Interactable } from '../components/Interactable.js';
import { SkyFollow } from '../components/SkyFollow.js';
import { NightManager } from '../systems/NightManager.js';
import { MainOffice } from './rooms/MainOffice.js';
import { ServerRoom } from './rooms/ServerRoom.js';
import { LivingQuarters } from './rooms/LivingQuarters.js';
import { Airlock } from './rooms/Airlock.js';
import { Corridor } from './rooms/Corridor.js';
import { Ambience, AMBIENCE } from '../components/Ambience.js';
import { AmbienceMix } from '../systems/AmbienceMix.js';
import { EVASuit } from '../components/EVASuit.js';
import { SuitVisor } from '../components/SuitVisor.js';
import { Daylight } from '../components/Daylight.js';
import { NightClock } from '../gameplay/NightClock.js';
import { SignalManager } from '../gameplay/SignalManager.js';
import { GameController } from '../gameplay/GameController.js';
import { ComputerTerminal, createComputerInteractable } from '../components/ComputerTerminal.js';
import { HUD, RadarOverlay, SignalReviewPanel } from '../ui/HUD.js';
import { ScreenFade } from '../ui/ScreenFade.js';
import { OcclusionZones } from '../systems/OcclusionZones.js';
import {
  windowHalfSpaces, sphereSeenThroughWindows, boxSeenThroughWindows, splitInstances, forEachInstanceSphere, hiddenFromRegion, collectHideable,
} from '../systems/Sightlines.js';
import { AirlockPortal } from '../components/AirlockPortal.js';
import { PLAYER_BODY } from '../components/PlayerBody.js';
import { Component } from '../core/Component.js';
import { LEDStrip } from '../components/LEDStrip.js';
import { FirstPersonController } from '../components/FirstPersonController.js';
import { PowerGrid } from '../systems/PowerGrid.js';
import { Ufo } from '../gameobjects/Ufo.js';
import { UfoThreat } from '../gameplay/UfoThreat.js';
import { WhiteOut } from '../ui/WhiteOut.js';
import { GeneratorSound } from '../components/GeneratorSound.js';
import { Sandstorm } from '../gameplay/Sandstorm.js';
import { DustStorm } from '../gameobjects/DustStorm.js';
import { DustEye } from '../gameobjects/DustEye.js';
import { DustEyes } from '../gameplay/DustEyes.js';
import { StormOutage } from '../gameplay/StormOutage.js';
import { BreakerPanel } from '../ui/BreakerPanel.js';
import { BreakerPuzzle } from '../gameplay/BreakerPuzzle.js';
import { sealAgainst } from '../core/ShadowSides.js';

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

/** Where the buggy parks (x, z), placed by hand in the level editor. */
const BUGGY_SPOT = [-7.79, 10.01];

/** The generator's centre in from the fence's corner, metres (x, z): its
 *  half size, plus room to walk round it to the switch. */
const GENERATOR_CORNER_INSET = [2.2, 1.9];

/** Dust eyes built up front — the most out at once, front and back together
 *  (DustEyes.maxEyes), plus room for ones fading away as new ones replace them. */
const DUST_EYE_POOL = 10;

/** Bearing of the lane kept open between the back window and the dish, which
 *  stands at (0, -25). The masts skip this one. */
const DISH_LANE = Math.atan2(-25, 0);

/** The colony rover is 3.4 x 3.3 x 6.6 m as downloaded. The base's exterior
 *  door is 1 m wide and 2.2 m tall, and at native size the buggy dwarfs both
 *  it and the building. Three quarters puts the roof just above the lintel. */
const BUGGY_SCALE = 0.75;

/** Metres either side of the fence kept free of trees. The widest canopy in
 *  the belt (a pine, ~4.7 m across) reaches 2.35 m from its trunk. */
const TREE_FENCE_CLEARANCE = 3;

/** Metres the building-as-occluder is shrunk by on every side, for the
 *  sightlines between the corners hiddenFromRegion samples. */
const OCCLUDER_MARGIN = 0.3;

/** An inside-only or unseen group of instances smaller than this stays in
 *  its mesh's always-drawn part: splitting it off costs a draw call, which a
 *  few thousand triangles aren't worth. The yard split has no floor — it
 *  saves work on every frame indoors, where the player spends the night. */
const MIN_SPLIT_TRIANGLES = 8000;

/** Highest an eye gets in the yard: standing, at the top of a jump (Engine
 *  jumps at 4 m/s, so v²/2g ≈ 0.82 m), plus margin for a low step. */
const EYE_TOP = PLAYER_BODY.standEyeHeight + (4 * 4) / (2 * 9.81) + 0.4;

/** Where the UFO stops: metres above the office's centre — well clear of
 *  the dish tower and the treeline on the way in. */
const UFO_HOVER_HEIGHT = 35;

/** The UFO's beam spilling in through the office window while it covers
 *  the base. The searchlight itself never gets in — its shadow map keeps it
 *  off everything under a roof — so this stands in for it: a spotlight
 *  inside the office, tucked under the window header, aimed steeply down
 *  into the room. Positions are metres from the back wall's inner face (+
 *  into the room); the cone (half-angle + tilt) stays below level, so it
 *  never paints the tops of the walls — light through a window can't reach
 *  them. It casts a shadow (static, drawn once) so the desk and chair keep
 *  the floor beneath them dark: hiding under the desk looks like hiding. */
const WINDOW_FLOOD = { from: [0, 2.7, 0.3], to: [0, 0, 2.9], intensity: 60, angle: 0.7 };


export class BaseScene extends Scene {
  /** @type {{MainOffice: MainOffice, ServerRoom: ServerRoom, LivingQuarters: LivingQuarters, Airlock: Airlock}} */
  rooms = {};
  /** @type {{OfficeToServer: Corridor, OfficeToQuarters: Corridor}} */
  corridors = {};
  /** Which night it is. The game controller follows it.
   *  @type {NightManager|null} */
  nights = null;
  /** Dust on the wind, outside. @type {GameObject|null} */
  windDust = null;
  /** The player's EVA suit — the airlock hatch follows it.
   *  @type {EVASuit|null} */
  suit = null;
  /** Room tone and tension music. A threat raises the music with
   *  `ambience.setTension(level, name)`.
   *  @type {Ambience|null} */
  ambience = null;

  /** The generator's grid: every lamp in the base, and the vital functions.
   *  @type {PowerGrid|null} */
  power = null;

  /** GPU resources the scene itself created (ground, moon). */
  _owned = [];
  /** Sounds the scene itself plays (the breaker panel's click). */
  _sounds = [];

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
    this._addAmbience();
    this._setupNights();
    this._addSky();
    this._addGround();
    this._addLighting();
    this._buildOutside();
    this._addWindDust();
    this._spawnPlayer();
    this._keepFogOutside();
    this._addPower();
    this._addGameplaySystems();
    this._addUfo();
    this._addSandstorm();
    this._buildOcclusion();

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
    this._offNightStart?.();
    this._offSuitHud?.();
    this._offRetry?.();
    this._offPower?.forEach(off => off());
    this.ufo?.dispose();
    this.dust?.dispose();
    for (const { go } of this.dustEyes?.slots ?? []) go.dispose();
    this.breakerPanel?.close();
    for (const sound of this._sounds) {
      if (sound.isPlaying) sound.stop();
      try { sound.disconnect(); } catch (_) { /* never connected */ }
    }
    this._sounds.length = 0;
    this.whiteOut?.clear();
    this._offShadowHooks?.forEach(off => off());
    // Before the rooms go: the portal lets go of the airlock, and every
    // culled object is drawn again, so nothing stays hidden into whatever
    // reuses it.
    this.portal?.onDestroy();
    this.zones?.dispose();
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
    // dispose(), not just hide(): both hang listeners on page elements and
    // the window that outlive the scene.
    this.radarOverlay?.dispose();
    this.reviewPanel?.dispose();
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
  // Ambience (a loop per room, blended down the corridors)
  // ──────────────────────────────────────────
  /** Each room's shell plays that room's loop; each corridor crossfades the
   *  two rooms it joins. Read at the camera, where the ears are, so it
   *  follows the debug fly camera too.
   *
   *  The airlock has no loop of its own: it hears whichever side's door
   *  last stood open. So the sound switches as a door opens — the wind when
   *  the hatch does, the office when the inner door does — and holds while
   *  both are shut, which also keeps the wind out on a change of mind
   *  mid-cycle. */
  _addAmbience() {
    const { engine, rooms, corridors } = this;
    const office = AMBIENCE.rooms.MainOffice;
    const airlock = { box: rooms.Airlock.bounds(), track: office };
    const follow = (state) => {
      if (state === 'pressurised') airlock.track = office;
      else if (state === 'depressurised') airlock.track = AMBIENCE.outside ?? office;
    };
    follow(rooms.Airlock.state);
    rooms.Airlock.onStateChange(follow);   // dropped by the airlock's dispose()

    const mix = new AmbienceMix({
      zones: [
        ...Object.values(rooms)
          .filter(room => AMBIENCE.rooms[room.name])
          .map(room => ({ box: room.bounds(), track: AMBIENCE.rooms[room.name] })),
        airlock,
      ],
      passages: Object.values(corridors).map(c => ({ box: c.bounds(), axis: c.axis })),
      outside: AMBIENCE.outside,
    });
    this.ambience = this._group('Ambience').addComponent(new Ambience({
      mix,
      listenerPosition: out => engine.camera?.getWorldPosition(out) ?? out,
      // Testing only — remove before release. Each key swings a music
      // track in, and back out on the next press: M the spooky one, comma
      // the ambient one. (N is the next-night key.)
      testKeys: { KeyM: AMBIENCE.music, Comma: AMBIENCE.ambientMusic },
    }));
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
    this.signalManager = new SignalManager({ signalsPerNight: 5, payloadPool });

    // UI wrappers over the markup in index.html. With no DOM (tests) each
    // falls back to a null root and every call is a no-op.
    this.hud          = new HUD();
    this.radarOverlay = new RadarOverlay();
    this.reviewPanel  = new SignalReviewPanel();

    // The real sky behind the radar grid: the backdrop reads it live, so it
    // turns with the night and drowns in the dawn exactly as the window
    // view does.
    this.radarOverlay.setSky(this.sky);

    this.terminal = new ComputerTerminal();
    this.terminal.satellite     = this.satellite;
    this.terminal.signalManager = this.signalManager;
    this.terminal.hud           = this.hud;
    this.terminal.radar         = this.radarOverlay;
    this.terminal.reviewPanel   = this.reviewPanel;
    this.terminal.crosshair     = this.engine.crosshair;

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
    const { wallClock, signalLight } = this.rooms.MainOffice;
    if (wallClock) wallClock.clock = this.nightClock;
    if (signalLight) {
      signalLight.signalManager  = this.signalManager;
      signalLight.gameController = this.gameController;
    }
    this.screenFade = new ScreenFade();
    const { bed } = this.rooms.LivingQuarters;
    if (bed) {
      bed.controller = this.gameController;
      bed.fade       = this.screenFade;
    }

    this.hud.setSuit(this.suit.worn);
    this._offSuitHud = this.suit.onChange(worn => this.hud.setSuit(worn));

    // A retry after a game over starts the night over from the beginning:
    // back at the spawn, facing the window, suit off (the airlock cycles
    // back with it). A new night after sleeping leaves you where you woke.
    this._offRetry = this.gameController.onNightStart((_night, { retry }) => {
      if (retry) this._respawn();
    });

    // The terminal is a vital function: it runs whenever the generator
    // does, blown bulbs or not.
    this.terminal.setPowered(this.power.on);
    this._offPower.push(this.power.onChange(grid => this.terminal.setPowered(grid.on)));
  }

  // ──────────────────────────────────────────
  // Wind (dust blowing through the yard and past the window)
  // ──────────────────────────────────────────
  /** One draw call of low dust clouds around the camera, kept clear of
   *  every room and corridor in its shader. Not under Outside: it moves
   *  with the camera, so the occlusion sort — which goes by where a thing
   *  stands — has nothing to sort it by. */
  _addWindDust() {
    const parts = [...Object.values(this.rooms), ...Object.values(this.corridors)];
    this.windDust = createWindDust({ cutouts: parts.map(part => part.bounds()) });
    this._sceneRoot.addChild(this.windDust);
    this._ownResourcesOf(this.windDust);
    this._own(this.windDust.dustTexture);
  }

  /** How much of a dust storm is drawn, 0 (thinnest) … 1 (all of it): the
   *  settings menu's slider. The storm's cost is its clouds' overdraw, so
   *  that is what it scales (WIND_DUST.storm.low). A new scene starts at 1,
   *  so whoever holds the setting applies it after each build.
   *  @param {number} quality  0..1 */
  setStormQuality(quality) {
    this.windDust?.getComponent(WindDustMotion)?.setQuality(quality);
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
    // Where the fence will run (built below; the reasons are there) — worked
    // out first, so the belt can keep its trees off the wire.
    const endFront = Math.min(...[this.rooms.ServerRoom, this.rooms.LivingQuarters].map(r => r.bounds().max.z));
    const fenceRect = yardRect({ halfX: footprint.halfX, halfZ: endFront });

    const rocks = createMarsRocks({ footprint });
    const belt = createMarsVegetation({
      footprint,
      assets: engine.assets,
      // The belt closes the horizon all round, so the way out to the dish has
      // to be one of the lanes through it, not just a clearing at its feet.
      lanes: [DISH_LANE],
      // A tree on the fence line grows through the chain-link. Dropped, not
      // moved, so the rest of the belt stands where it always has.
      treesClearOf: fenceKeepOut(fenceRect, { openSides: ['S'], clearance: TREE_FENCE_CLEARANCE }),
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

    // Chain-link round the yard block in front of the base — the airlock's
    // side, with the generator and the buggy — closed on three sides, the
    // building's front being the fourth. No gates: keeping the player in
    // front of the building is what lets the whole interior go undrawn while
    // they're outside, since the only window is in the back wall (see
    // _buildOcclusion). The side runs meet the END rooms' front walls, not the
    // airlock's — the airlock sticks out further, and fencing from its depth
    // would leave a gap at each end of the building to walk round.
    const fence = createPerimeterFence({
      rect: fenceRect,
      openSides: ['S'],
      assets: engine.assets,
      world: engine.world,
    });
    this.fence = fence;

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

    // The dishes of the neighbouring array nodes, lent to this station.
    // Too far away to be seen or heard, so they are simulated headless:
    // the Satellite ticks their rigs, and the radar shows their sections.
    this.satellite.neighbours = createDefaultNeighbourDishes();

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
    this._addBuggy(BUGGY_SPOT, THREE.MathUtils.degToRad(95.7), 1.237);

    // Generator stand-in until generator.glb arrives (asset list, P1). In the
    // far corner of the fenced yard, on the side away from the buggy — a walk
    // out into the storm to cut the power, along the wire. Read off the
    // fence, so it follows the yard. _addPower() puts its switch on it.
    const side = Math.sign(BUGGY_SPOT[0]) < 0 ? 1 : -1;   // across from the buggy
    const [insetX, insetZ] = GENERATOR_CORNER_INSET;
    const genX = side > 0 ? fenceRect.maxX - insetX : fenceRect.minX + insetX;
    this.generator = this._addStandIn('Generator', 'generator.glb',
      [genX, 0.8, fenceRect.maxZ - insetZ], [2.0, 1.6, 1.2], 0x5a4a32);
    this.dishPad = dishPad;
  }

  // ──────────────────────────────────────────
  // Power (the generator outside feeds the base)
  // ──────────────────────────────────────────
  /** Every lamp in the rooms, the corridors and on the dish pad goes on one
   *  PowerGrid; the server LEDs and the signal lamp drive their own glow
   *  from its level. The generator outside is the switch, and GeneratorSound
   *  its voice. The airlock beacon is on its own battery (Airlock marks it
   *  offGrid). The dish pad's floods and the desk screen's glow are
   *  unbreakable: a UFO blow-out leaves them working once power is back. */
  _addPower() {
    const grid = new PowerGrid();
    this.power = grid;

    const parts = [...Object.values(this.rooms), ...Object.values(this.corridors)];
    for (const part of parts) grid.collect(part.root.object3d);
    if (this.dishPad) grid.collect(this.dishPad.object3d, { breakable: false });
    for (const go of this._sceneRoot.descendants()) {
      const strip = go.getComponent?.(LEDStrip);
      if (strip) grid.addConsumer(strip);
    }
    const { signalLight } = this.rooms.MainOffice;
    if (signalLight) grid.addConsumer(signalLight);

    // Written every frame — the UFO's surge flickers it.
    this._sceneRoot.addComponent(new class extends Component {
      onUpdate(dt) { grid.update(dt); }
    }());

    const label = () => {
      if (grid.tripped) return '[E] Reset the tripped breakers';
      if (grid.on) return '[E] Cut power';
      return grid.broken ? '[E] Restore power (vital systems — the lights are blown)' : '[E] Restore power';
    };
    const generator = this.generator;
    // Start-up on, wind-down off, a hum between — a whisper from indoors.
    const sound = generator.addComponent(new GeneratorSound({
      grid,
      hooks: { listenerPosition: out => this.engine.camera.getWorldPosition(out), isOutside: p => this._isOutside(p) },
    }));
    this.generatorSound = sound;
    // After a UFO blow-out the breakers are tripped: the switch is dead
    // until the panel minigame is done, out here in the yard. One puzzle per
    // blow-out, so stepping away and back carries on where you left off.
    this.breakerPanel = new BreakerPanel();
    const click = this._sound('sfx:light-switch', 0.7);
    let puzzle = null;
    // Every use of the generator goes through its breaker panel:
    //   on / off  switching it normally: every lead already home, every
    //             breaker the other way — flick them all up (on) or down (off).
    //   blowout   after the UFO tripped it: breakers thrown and leads torn
    //             off. One puzzle per blow-out, so stepping away and back
    //             carries on where you left off.
    let blowout = null;
    let showing = null;   // which job the open panel is doing
    const TITLES = { on: 'Generator — start-up', off: 'Generator — shut-down', blowout: 'Generator — breakers tripped' };
    const openPanel = (kind) => {
      const puzzle = kind === 'blowout'
        ? (blowout ??= new BreakerPuzzle())
        : new BreakerPuzzle({ flick: kind });
      showing = kind;
      this._usePanel(true);
      this.breakerPanel.open(puzzle, {
        title: TITLES[kind],
        onClose: () => { showing = null; this._usePanel(false); },
        onFlick: () => {
          if (!click) return;
          if (click.isPlaying) click.stop();
          click.play();
        },
        onSolved: () => {
          showing = null;
          this._usePanel(false);
          // The noise of it carries in a storm (DustEyes rolls for an eye).
          if (kind === 'off') {
            sound.switchOff();
            this.dustEyes?.generatorNoise();
            return;
          }
          grid.resetBreakers();
          sound.switchOn();
          this.dustEyes?.generatorNoise();
        },
      });
    };

    const sw = generator.addComponent(new class extends Interactable {
      promptLabel = label();
      onInteract() {
        if (grid.tripped) openPanel('blowout');
        else openPanel(grid.on ? 'off' : 'on');
      }
    }());
    this._offPower = [grid.onChange(() => {
      // A data field, so InteractionSystem re-shows it while you look at it.
      sw.promptLabel = label();
      // Breakers back in (solved, or a new night's repair): this blow-out's
      // puzzle is done with.
      if (!grid.tripped) blowout = null;
      // A panel whose job has gone away closes: the power is already the way
      // it was being switched (a new night), or the UFO blew it meanwhile.
      const stale = (showing === 'blowout' && !grid.tripped)
        || (showing === 'on' && (grid.on || grid.tripped))
        || (showing === 'off' && (!grid.on || grid.tripped));
      if (stale) this.breakerPanel.close();
    })];
  }

  /** A THREE.Audio for a preloaded sound, or null (no listener or no
   *  buffer: tests, or a failed load). Stopped and unhooked on dispose. */
  _sound(key, volume = 1) {
    const { audioListener, assets } = this.engine;
    if (!audioListener || !assets?.has?.(key)) return null;
    const audio = new THREE.Audio(audioListener);
    audio.setBuffer(assets.get(key));
    audio.setVolume(volume);
    this._sounds.push(audio);
    return audio;
  }

  /** Hand the mouse to a DOM panel (true) or back to looking around. The
   *  player stands still meanwhile; the pointer lock comes back on the way
   *  out — a click or a key press, so the browser allows it. */
  _usePanel(open) {
    this._setPlayerLocked(open);
    // Tells the app layer the lock is being let go on purpose (no pause).
    this.engine.uiHasMouse = open;
    const canvas = this.engine.renderer?.domElement;
    if (open) {
      this.engine.crosshair?.hide();
      if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock?.();
    } else {
      this.engine.crosshair?.show();
      try { canvas?.requestPointerLock?.()?.catch?.(() => {}); } catch (_) { /* no gesture: the next click locks */ }
    }
  }

  /** Back to where the night starts: the office, facing the window. */
  _respawn() {
    this.suit?.takeOff();
    const player = this.engine.player;
    const ctrl = player?.getComponent(FirstPersonController);
    if (ctrl) ctrl.teleport(PLAYER_SPAWN, { yaw: 0, pitch: 0 });
    else player?.object3d.position.set(...PLAYER_SPAWN);
  }

  /** Freeze the player where they stand (a panel, the white-out), or free them. */
  _setPlayerLocked(locked) {
    const ctrl = this.engine.player?.getComponent(FirstPersonController);
    if (ctrl) ctrl.inputLocked = locked;
  }

  /** Anywhere not inside a room or corridor — the yard, the valley.
   *  Measured against each part's whole shell (outer wall faces, floor to
   *  roof), not Room.containsPoint, which stops at the walls' centre lines:
   *  neighbouring parts' shells touch, so a doorway is never a sliver of
   *  "outside" — the UFO took players walking through one. */
  _isOutside(p) {
    this._insideBoxes ??= [...Object.values(this.rooms), ...Object.values(this.corridors)].map(part => part.bounds());
    return !this._insideBoxes.some(box => box.containsPoint(p));
  }

  // ──────────────────────────────────────────
  // The UFO (once a night — UfoThreat)
  // ──────────────────────────────────────────
  /** The saucer comes in high and stops directly over the office, where its
   *  beam widens over the whole facility. With the lights on, anyone in the
   *  office (the room its window looks into) or the airlock is in view. Built after the gameplay
   *  systems, which it reads. Parented on the scene root, not Outside: it
   *  flies, so the occlusion sort must never file it away. */
  _addUfo() {
    const { engine } = this;
    const office = this.rooms.MainOffice;
    const [ox, , oz] = office.position;
    const back = office.bounds().min.z;
    const hoverPoint = new THREE.Vector3(ox, UFO_HOVER_HEIGHT, oz);

    // A clone sharing the cached model's GPU resources — Ufo.dispose never
    // frees it. Not loaded (tests): Ufo builds a stand-in disc.
    const model = engine.assets?.has?.('model:ufo') ? engine.assets.instantiate('model:ufo') : null;
    this.ufo = new Ufo({ model });
    this.ufo.setPose(hoverPoint);
    this._sceneRoot.addChild(this.ufo);
    // Its searchlight casts shadows (the roofs keep it out of the rooms); the
    // ShadowScheduler redraws its map as it flies. sealAgainst makes every
    // building mesh receive shadows and, for that one light, draw both faces
    // into the map — without either it got in along every wall joint and
    // lit every small fitting (see ShadowSides). And the
    // visible beam is cut out of the building, so it ends on the roofs.
    const shell = [...Object.values(this.rooms), ...Object.values(this.corridors)];
    for (const part of shell) sealAgainst(part.root.object3d, this.ufo.searchlight);
    this.ufo.setCutouts(shell.map(part => part.bounds()));

    // The beam spilling in through the window. Zeroed, never hidden (AGENTS.md).
    const inner = back + office.wallThick;   // the back wall's inner face
    const floodGO = new GameObject('UfoWindowFlood');
    const flood = new THREE.SpotLight(0xdcefff, 0, 14, WINDOW_FLOOD.angle, 0.6, 1);
    flood.position.set(ox + WINDOW_FLOOD.from[0], WINDOW_FLOOD.from[1], inner + WINDOW_FLOOD.from[2]);
    flood.target.position.set(ox + WINDOW_FLOOD.to[0], WINDOW_FLOOD.to[1], inner + WINDOW_FLOOD.to[2]);
    flood.castShadow = true;
    flood.shadow.mapSize.set(512, 512);
    flood.shadow.bias = -0.0005;
    floodGO.object3d.add(flood, flood.target);
    this._sceneRoot.addChild(floodGO);
    this.windowFlood = flood;

    const exposedRooms = [office.bounds(), this.rooms.Airlock.bounds()];
    const hooks = {
      eyePosition: out => engine.camera.getWorldPosition(out),
      isOutside: p => this._isOutside(p),
      // Where a lit base gives you away: the office (the room its window
      // looks into) and the airlock (only a hatch from the yard). Whole
      // shells, as in _isOutside; the furniture doesn't count, so there is
      // no hiding under the desk — a rule that can't drift when props change.
      exposedToBeam: eye => exposedRooms.some(box => box.containsPoint(eye)),
      setPlayerLocked: locked => this._setPlayerLocked(locked),
    };

    this.whiteOut = new WhiteOut();
    this.ufoThreat = new UfoThreat({
      controller:  this.gameController,
      grid:        this.power,
      ufo:         this.ufo,
      hooks,
      hoverPoint,
      flood:       { light: flood, intensity: WINDOW_FLOOD.intensity },
      signalLight: this.rooms.MainOffice.signalLight,
      radar:       this.radarOverlay,
      terminal:    this.terminal,
      whiteOut:    this.whiteOut,
      nightDuration: this.nightClock.nightDuration,
      nightHours:    this.nightClock.endHour - this.nightClock.startHour,
    });
    this._sceneRoot.find('GameplaySystems').addComponent(this.ufoThreat);
  }

  /** The office, the airlock and the corridors take no fog. They share the
   *  outdoor fog density — the office window has to show the valley, and the
   *  storm swallowing it — but the scene's fog is one fog, and at a storm's
   *  density it filled the rooms themselves with brown haze (a wall 10 m off
   *  a third dust). Their own surfaces opt out instead; everything seen
   *  through the glass keeps it. On a clear night that fog is ~0.05 % at
   *  10 m, so indoors nothing changes. The sealed rooms keep theirs: it is
   *  their mood. A material shared with anything outside the opted-out
   *  parts is copied for them first, so nothing else loses its fog. Built
   *  before the power grid collects the lamps' materials, so the grid holds
   *  the copies. */
  _keepFogOutside() {
    const parts = [this.rooms.MainOffice, this.rooms.Airlock, ...Object.values(this.corridors)].filter(Boolean);
    const inside = new Set();
    for (const part of parts) part.root.object3d.traverse(o => { if (o.isMesh) inside.add(o); });
    const elsewhere = new Set();
    this._sceneRoot.object3d.traverse(o => {
      if (!o.isMesh || inside.has(o)) return;
      for (const m of [].concat(o.material)) if (m) elsewhere.add(m);
    });
    const copies = new Map();
    const optOut = (m) => {
      if (!m || !m.fog) return m;
      if (elsewhere.has(m)) {
        let copy = copies.get(m);
        if (!copy) {
          copy = this._own(m.clone());
          copy.fog = false;
          copies.set(m, copy);
        }
        return copy;
      }
      m.fog = false;
      m.needsUpdate = true;
      return m;
    };
    for (const mesh of inside) {
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(optOut) : optOut(mesh.material);
    }
    this._switchSealedRoomFog();
  }

  /** A sealed room's mood fog is for being inside it. Seen through a
   *  doorway from anywhere else it took the storm's brown — the server room
   *  glowed rust down the corridor. So each sealed room's fogged surfaces
   *  get a switch in their fog shader (roomFog, 0 or 1), on only while the
   *  player is in that room (_applyRoomFog). A uniform, not material.fog:
   *  flipping that would recompile the room's shaders on every doorway. */
  _switchSealedRoomFog() {
    this._roomFog = new Map();
    const sealed = Object.values(this.rooms)
      .filter(room => room !== this.rooms.Airlock && this._fogDensityFor(room) !== OUTDOOR_FOG_DENSITY);
    for (const room of sealed) {
      const ref = { value: 0 };
      this._roomFog.set(room, ref);
      const mine = new Set();
      room.root.object3d.traverse(o => { if (o.isMesh) mine.add(o); });
      const elsewhere = new Set();
      this._sceneRoot.object3d.traverse(o => {
        if (!o.isMesh || mine.has(o)) return;
        for (const m of [].concat(o.material)) if (m) elsewhere.add(m);
      });
      const copies = new Map();
      const switched = (m) => {
        if (!m || !m.fog) return m;
        let target = m;
        if (elsewhere.has(m)) {
          target = copies.get(m);
          if (!target) { target = this._own(m.clone()); copies.set(m, target); }
        }
        target.onBeforeCompile = (shader) => {
          shader.uniforms.roomFog = ref;
          shader.fragmentShader = 'uniform float roomFog;\n'
            + shader.fragmentShader.replace('#include <fog_fragment>', ROOM_FOG_FRAGMENT);
        };
        target.customProgramCacheKey = () => 'roomFog';
        target.needsUpdate = true;
        return target;
      };
      for (const mesh of mine) {
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(switched) : switched(mesh.material);
      }
    }
  }

  // ──────────────────────────────────────────
  // Sandstorms (some nights, from night 2)
  // ──────────────────────────────────────────
  /** Dust storms roll in at random from night 2 (Sandstorm). Built after
   *  Daylight, so within a frame the storm lays its fog over the dawn's.
   *  The dust cloud follows the player, so like the UFO it hangs on the
   *  scene root, where the occlusion sort never files it away. */
  _addSandstorm() {
    const { engine } = this;
    this.dust = new DustStorm();
    // Cut out of the building, so it blows past the office window but never
    // through a room.
    const shells = [...Object.values(this.rooms), ...Object.values(this.corridors)].map(part => part.bounds());
    this.dust.setCutouts(shells);
    this._sceneRoot.addChild(this.dust);

    // The wind dust's low clouds (_addWindDust) are the storm's too: a few
    // on a calm night, a wall of them once it blows. Lit by the dawn — the
    // fog is no guide to the light, since the storm turns it brown.
    const clouds = this.windDust.getComponent(WindDustMotion);
    clouds.daylight = this.daylight;

    this.sandstorm = new Sandstorm({
      controller: this.gameController,
      fog:        engine.scene.fog,
      sky:        this.sky,
      dust:       this.dust,
      // Never with the UFO: on its night the storm follows it.
      ufo:        this.ufoThreat,
      // One storm level drives the clouds too.
      clouds,
      hooks: {
        listenerPosition: out => engine.camera.getWorldPosition(out),
        isOutside:        p => this._isOutside(p),
        // Outside, the office (its window) and the airlock (its hatch is on
        // the yard, and from it the office window shows through the inner
        // door — a window seen clear from there used to pop to storm on the
        // step into the office). Not the corridors: no window, and the storm
        // fog there only tinted the sealed rooms seen through their doorways.
        // Not the sealed mood rooms.
        valleyInView:     () => (this._currentRoom
          ? this._fogDensityFor(this._currentRoom) === OUTDOOR_FOG_DENSITY
          : this._isOutside(engine.camera.getWorldPosition(_valleyEye))),
      },
      nightDuration: this.nightClock.nightDuration,
      nightHours:    this.nightClock.endHour - this.nightClock.startHour,
    });
    this._sceneRoot.find('GameplaySystems').addComponent(this.sandstorm);
    this._addDustEyes();

    // Now and then the storm chokes the generator: the lamps flicker, then it
    // winds down — an ordinary shut-down, so the panel's switches restore it.
    this.stormOutage = new StormOutage({
      controller: this.gameController,
      sandstorm:  this.sandstorm,
      grid:       this.power,
      cutPower:   () => this.generatorSound.switchOff(),
    });
    this._sceneRoot.find('GameplaySystems').addComponent(this.stormOutage);
  }

  /** The eyes in the storm (DustEyes). A pool built now, hidden, so their
   *  shaders compile behind the loading screen — on the scene root, like the
   *  dust, since they move. They are told the fence they spawn beyond and
   *  the office window they can be seen through, as plain rectangles. */
  _addDustEyes() {
    const { engine } = this;
    const pool = [];
    for (let i = 0; i < DUST_EYE_POOL; i++) {
      const eye = new DustEye(`DustEye${i}`);
      this._sceneRoot.addChild(eye);
      pool.push(eye);
    }

    const { minX, maxX, minZ, maxZ } = this.fence.rect;
    this.dustEyes = new DustEyes({
      controller: this.gameController,
      sandstorm:  this.sandstorm,
      pool,
      fence:      { minX, maxX, minZ, maxZ },
      window:     this._officeWindow(),
      whiteOut:   this.whiteOut,
      terminal:   this.terminal,
      fog:        engine.scene.fog,
      // Yard eyes stand out of the trees, in sight; chases go round what's solid.
      trees:      this._sceneRoot.find('Outside')?.find('MarsVegetation')?.trees ?? [],
      obstacles:  this._yardObstacles(),
      // The building hides them: never placed, nor stared at, behind it.
      occluders:  [...Object.values(this.rooms), ...Object.values(this.corridors)]
        .map(part => part.bounds())
        .map(b => ({ minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z })),
      hooks: {
        eyePosition:      out => engine.camera.getWorldPosition(out),
        viewDirection:    out => engine.camera.getWorldDirection(out),
        isOutside:        p => this._isOutside(p),
        hatchShut:        () => this.rooms.Airlock.hatch.locked,
        setPlayerLocked:  locked => this._setPlayerLocked(locked),
      },
    });
    this._sceneRoot.find('GameplaySystems').addComponent(this.dustEyes);
  }

  /** The solid things standing in the yard, as ground-plan rectangles —
   *  what a chasing dust eye goes round (and the airlock, which it enters
   *  only by its hatch). Measured off the objects, so a
   *  moved buggy moves its box. Things not loaded (tests) are left out. */
  _yardObstacles() {
    const outside = this._sceneRoot.find('Outside');
    const boxes = [];
    for (const name of ['Buggy', 'Generator']) {
      const go = outside?.find(name);
      if (!go) continue;
      go.object3d.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(go.object3d);
      if (box.isEmpty()) continue;
      boxes.push({ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z });
    }
    // The airlock juts into the yard: solid, but for its hatch — a chase
    // after someone inside comes in that way, never through the side walls.
    const airlock = this.rooms.Airlock;
    if (airlock?.hatch) {
      const shell = airlock.bounds();
      const hatch = airlock.hatch.object3d.getWorldPosition(new THREE.Vector3());
      boxes.push({
        minX: shell.min.x, maxX: shell.max.x, minZ: shell.min.z, maxZ: shell.max.z,
        door: { x: hatch.x, z: hatch.z, halfWidth: airlock.hatch.doorSize[0] / 2 },
      });
    }
    return boxes;
  }

  /** The office's back window as DustEyes wants it: the opening's x span
   *  and sill-to-top height, in the plane of the wall's inner face. Read
   *  off the room's own opening, so moving the window moves this. */
  _officeWindow() {
    const office = this.rooms.MainOffice;
    const [ox, oy] = office.position;
    const opening = office.openings.find(o => o.side === 'back' && (o.sill ?? 0) > 0);
    const centre = ox + (opening.offset ?? 0);
    return {
      x0: centre - opening.width / 2,
      x1: centre + opening.width / 2,
      z: office.bounds().min.z + office.wallThick,
      sill: oy + opening.sill,
      top: oy + opening.sill + opening.height,
    };
  }

  // ──────────────────────────────────────────
  // Occlusion (the airlock as a portal)
  // ──────────────────────────────────────────
  /**
   * Two zones, never on screen together, and the airlock to switch them:
   *
   *   interior  the furnishings of every room but the airlock — props, the
   *             window frame, light fittings. Never the shell (the building
   *             as seen from outside), the doors, or a light: hiding a light
   *             changes the light count every lit shader is compiled for.
   *   yard      every outdoor thing that can't be seen through a window.
   *             The instanced scenery (rocks, belt, masts, fence) is split
   *             along that line, so the half out of view can go.
   *
   * Indoors the only view out is the back window, so the yard can go. In the
   * yard the fence keeps the player in front of the building, which hides
   * the window, so the interior can go. The windows are read off the rooms'
   * openings, so a redesigned office re-derives all of this — but a prop
   * that should stay visible from outside (behind a new window, say) needs
   * thought again. AirlockPortal does the switching.
   */
  _buildOcclusion() {
    const { engine } = this;
    const zones = new OcclusionZones({ renderer: engine.renderer, scene: engine.scene, camera: engine.camera });

    const isShell = o => o.userData.isDoor
      || /^(Floor|Ceiling|(Back|Front|Left|Right)Wall)/.test(o.name);
    const interiorParts = [
      this.rooms.MainOffice, this.rooms.ServerRoom, this.rooms.LivingQuarters,
      ...Object.values(this.corridors),
    ];
    for (const part of interiorParts) {
      for (const door of part.doors) door.object3d.userData.isDoor = true;
      zones.add('interior', collectHideable(part.root.object3d, isShell));
    }

    // Each outdoor thing (each instance, for the instanced scenery) is asked
    // two questions — can a window see it, can the yard see it — and sorted:
    //   both     drawn always
    //   yard     'yard'      drawn only outside
    //   window   'interior'  drawn only inside: low things behind the
    //                        building, which hides them from the yard
    //   neither  'unseen'    never drawn (the debug views still show it)
    this.yardView = this._yardView();
    const view = { windows: windowHalfSpaces(Object.values(this.rooms)), ...this.yardView };
    const sorted = { yard: [], interior: [], unseen: [] };
    for (const child of [...this._outside.object3d.children]) {
      if (child.name === 'MarsTerrain') continue;   // the ground under everything
      sortOutdoors(child, view, sorted);
    }
    zones.add('yard', sorted.yard);
    zones.add('interior', sorted.interior);
    zones.add('unseen', sorted.unseen);
    zones.hide('unseen');
    this.zones = zones;

    this.portal = new AirlockPortal({ airlock: this.rooms.Airlock, zones });
    this._sceneRoot.addComponent(this.portal);

    // Shadow maps are frozen between changes (Engine.shadows): a zone swap or
    // a door moving changes what casts them.
    const redraw = () => engine.shadows?.invalidate();
    this._offShadowHooks = [zones.onChange(redraw), this.rooms.Airlock.onStateChange(redraw)];
    // The dish slews; its shadow follows it.
    if (this.satellite && this.moonLight) engine.shadows?.watch(this.satellite.object3d, [this.moonLight]);
  }

  /**
   * The building as an occluder, and where it is seen from.
   *
   *   occluders  one box per room and corridor (not the airlock, whose
   *              hatch opens): its shell, shrunk by a margin on its outer
   *              faces — the top, front and back, and the two end walls —
   *              for the sightlines the corner test doesn't sample. Joins
   *              between parts are left flush, so the union has no gap to
   *              see through. Inside the real walls everywhere, so it can
   *              only ever under-hide.
   *   eyes       where the player's eye can be in the fenced yard: wherever
   *              the capsule can stand inside the fence, from a crouch to
   *              the top of a jump, in front of every occluder.
   *
   * Read off the rooms, corridors and fence, so it follows a redesign.
   */
  _yardView() {
    const parts = [
      this.rooms.MainOffice, this.rooms.ServerRoom, this.rooms.LivingQuarters,
      ...Object.values(this.corridors),
    ];
    const bounds = parts.map(part => part.bounds());
    const westEnd = Math.min(...bounds.map(b => b.min.x));
    const eastEnd = Math.max(...bounds.map(b => b.max.x));
    const m = OCCLUDER_MARGIN;
    const occluders = bounds.map((b, i) => new THREE.Box3(
      new THREE.Vector3(b.min.x <= westEnd + 1e-6 ? b.min.x + m : b.min.x, 0, b.min.z + m),
      new THREE.Vector3(b.max.x >= eastEnd - 1e-6 ? b.max.x - m : b.max.x, parts[i].height - m, b.max.z - m),
    ));

    // The capsule stops a radius short of the fence's collider, and a radius
    // off the building's nearest front face (a corridor's, set back).
    const { rect } = this.fence;
    const inset = FENCE.colliderThickness / 2 + PLAYER_BODY.radius;
    const front = Math.min(...bounds.map(b => b.max.z)) + PLAYER_BODY.radius;
    const clearOfOccluders = Math.max(...occluders.map(o => o.max.z)) + 0.01;
    const eyes = new THREE.Box3(
      new THREE.Vector3(rect.minX + inset, PLAYER_BODY.crouchEyeHeight, Math.max(front, clearOfOccluders)),
      new THREE.Vector3(rect.maxX - inset, EYE_TOP, rect.maxZ - inset),
    );
    return { occluders, eyes };
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

    // The suit rides on the player; the hatch follows it however it changes,
    // not only through the locker.
    this.suit = engine.player.addComponent(new EVASuit());
    this.rooms.Airlock.bindSuit(this.suit);
    // Helmet glass and mask breathing while it's on.
    // No breathing on a death screen — the night has been lost.
    engine.player.addComponent(new SuitVisor({
      suit: this.suit,
      silenced: () => this.gameController?.state === 'gameOver',
    }));
  }

  /** Per-room atmosphere: dense fog in the sealed server room, light in the
   *  sealed living quarters, the outdoor density everywhere the valley is in
   *  view (the main office, the corridors, and outside). */
  _applyRoomFog(room) {
    this._currentRoom = room;
    // A sealed room's mood fog shows only from inside it.
    for (const [sealed, ref] of this._roomFog ?? []) ref.value = sealed === room ? 1 : 0;
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

const _box = new THREE.Box3();

/** three's fog, scaled by a sealed room's switch (BaseScene._switchSealedRoomFog). */
const ROOM_FOG_FRAGMENT = /* glsl */`
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor * roomFog );
#endif
`;
const _valleyEye = new THREE.Vector3();

/** Which zone a thing belongs in, from who can see it — null for both. */
function zoneFor(seenInside, seenOutside) {
  if (seenInside) return seenOutside ? null : 'interior';
  return seenOutside ? 'yard' : 'unseen';
}

/**
 * Sort `object` into the zones (see _buildOcclusion). An InstancedMesh is
 * split instance by instance (splitInstances), so a ring of grass gives up
 * just the blades behind the building. Anything else goes whole if its
 * bounds settle it, or is opened up if both sides can see it, so a group
 * straddling a line still gives up the children that don't. A light is
 * never taken — it would recompile every lit shader (see collectHideable).
 *
 * An InstancedMesh marked `userData.liveInstances` is never split: something
 * rewrites its instances every frame through the mesh it was handed, and a
 * split replaces that mesh with copies nobody is writing to. (The mast
 * beacons' lamps: split, they stayed the red they were copied with.) It is
 * sorted whole, by its bounds, like any other object.
 *
 * @param {THREE.Object3D} object
 * @param {{ windows: import('../systems/Sightlines.js').HalfSpace[],
 *           eyes: THREE.Box3, occluders: THREE.Box3[] }} view
 * @param {{ yard: THREE.Object3D[], interior: THREE.Object3D[], unseen: THREE.Object3D[] }} out
 */
function sortOutdoors(object, view, out) {
  const { windows, eyes, occluders } = view;
  if (object.isLight) return;
  if (object.isInstancedMesh && !object.userData.liveInstances) {
    // Label every instance, then let a small inside-only or unseen group go
    // back to 'always': splitting it off costs a draw call of its own, and
    // for a handful of instances that costs more than drawing them does.
    const labels = [];
    forEachInstanceSphere(object, (sphere) => {
      labels.push(zoneFor(sphereSeenThroughWindows(sphere, windows), !hiddenFromRegion(sphere, eyes, occluders)) ?? 'always');
    });
    const g = object.geometry;
    const perInstance = (g.index ? g.index.count : g.attributes.position.count) / 3;
    for (const zone of ['interior', 'unseen']) {
      const count = labels.filter(l => l === zone).length;
      if (count && count * perInstance < MIN_SPLIT_TRIANGLES) {
        for (let i = 0; i < labels.length; i++) if (labels[i] === zone) labels[i] = 'always';
      }
    }
    const parts = splitInstances(object, (_sphere, i) => labels[i]);
    for (const [zone, mesh] of parts) if (zone !== 'always') out[zone].push(mesh);
    return;
  }

  let special = false;
  object.traverse((o) => { if (o !== object && (o.isInstancedMesh || o.isLight)) special = true; });
  if (!special) {
    object.updateWorldMatrix(true, true);
    _box.setFromObject(object);
    if (_box.isEmpty()) return;
    const zone = zoneFor(boxSeenThroughWindows(_box, windows), !hiddenFromRegion(_box, eyes, occluders));
    if (zone) {
      out[zone].push(object);
      return;
    }
  }
  for (const child of [...object.children]) sortOutdoors(child, view, out);
}
