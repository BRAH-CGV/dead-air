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
import { createBunkerShell, BUNKER } from '../gameobjects/BunkerShell.js';
import { createSignalMast } from '../gameobjects/SignalMast.js';
import { createWindDust, WindDustMotion } from '../gameobjects/WindDust.js';
import { RoomTransitionSystem } from '../components/RoomTransitionSystem.js';
import { Interactable } from '../components/Interactable.js';
import { InteractionSystem } from '../components/InteractionSystem.js';
import { PickupSystem } from '../components/PickupSystem.js';
import { DriveSlot } from '../components/DriveSlot.js';
import { SnapSocket } from '../components/SnapSocket.js';
import { DriveBoxDock } from '../gameplay/DriveBoxDock.js';
import { BuggyCargo, BUGGY_CARGO } from '../components/BuggyCargo.js';
import { SkyFollow } from '../components/SkyFollow.js';
import { NightManager } from '../systems/NightManager.js';
import { MainOffice, WINDOW_CORNER_RADIUS, deskStation } from './rooms/MainOffice.js';
import { ServerRoom } from './rooms/ServerRoom.js';
import { LivingQuarters, COFFEE_MACHINE } from './rooms/LivingQuarters.js';
import { Airlock } from './rooms/Airlock.js';
import { Corridor } from './rooms/Corridor.js';
import { Ambience, AMBIENCE } from '../components/Ambience.js';
import { AirlockSound, AIRLOCK_SOUND } from '../components/AirlockSound.js';
import { WindowSand } from '../components/WindowSand.js';
import { AmbienceMix } from '../systems/AmbienceMix.js';
import { EVASuit } from '../components/EVASuit.js';
import { SuitVisor } from '../components/SuitVisor.js';
import { Daylight } from '../components/Daylight.js';
import { NightClock } from '../gameplay/NightClock.js';
import { SignalManager } from '../gameplay/SignalManager.js';
import { SignalRegistry } from '../gameplay/SignalRegistry.js';
import { DriveManager } from '../gameplay/DriveManager.js';
import { GameController } from '../gameplay/GameController.js';
import { DriveSnapshot } from '../gameplay/DriveSnapshot.js';
import { ComputerTerminal, createComputerInteractable } from '../components/ComputerTerminal.js';
import { ScreenView, screenMesh } from '../components/ScreenView.js';
import { ScreenCanvas } from '../components/ScreenCanvas.js';
import { paintDom } from '../ui/paintDom.js';
import { HUD, RadarOverlay } from '../ui/HUD.js';
import { ProcessingScreen, SCREEN_LAYOUT as PROCESSING_LAYOUT } from '../ui/ProcessingScreen.js';
import { ScreenFade } from '../ui/ScreenFade.js';
import { DREAM_AFTER_NIGHT } from '../gameplay/dream.js';
import { OcclusionZones } from '../systems/OcclusionZones.js';
import { PortalCulling, doorPortal } from '../systems/PortalCulling.js';
import { DriveInstancer } from '../gameobjects/DriveInstancer.js';
import {
  windowHalfSpaces, sphereSeenThroughWindows, boxSeenThroughWindows, splitInstances, forEachInstanceSphere, hiddenFromRegion, collectHideable,
  groundChunk,
} from '../systems/Sightlines.js';
import { AirlockPortal } from '../components/AirlockPortal.js';
import { PLAYER_BODY } from '../components/PlayerBody.js';
import { Component } from '../core/Component.js';
import { LEDStrip } from '../components/LEDStrip.js';
import { FirstPersonController } from '../components/FirstPersonController.js';
import { Flashlight } from '../components/Flashlight.js';
import { PowerGrid } from '../systems/PowerGrid.js';
import { Ufo } from '../gameobjects/Ufo.js';
import { UfoThreat } from '../gameplay/UfoThreat.js';
import { EvilSignal } from '../gameplay/EvilSignal.js';
import { DOOM_LIGHT_COLOR, DOOM_LIGHT_MAX_DISTANCE } from '../gameobjects/Drive.js';
import { WhiteOut } from '../ui/WhiteOut.js';
import { DeleteWarning } from '../ui/DeleteWarning.js';
import { RedOut } from '../core/RedOut.js';
import { PostPipeline } from '../core/PostPipeline.js';
import { VisorRefraction } from '../core/VisorRefraction.js';
import { GeneratorSound } from '../components/GeneratorSound.js';
import { SatelliteSound } from '../components/SatelliteSound.js';
import { FeedDisplay } from '../core/FeedDisplay.js';
import { MonitorSpeaker } from '../components/MonitorSpeaker.js';
import { ScannerAlertSound } from '../components/ScannerAlertSound.js';
import { CoffeeSound } from '../components/CoffeeSound.js';
import { Sandstorm } from '../gameplay/Sandstorm.js';
import { DustStorm } from '../gameobjects/DustStorm.js';
import { DustEye } from '../gameobjects/DustEye.js';
import { DustEyes } from '../gameplay/DustEyes.js';
import { StormOutage } from '../gameplay/StormOutage.js';
import { Nap } from '../gameplay/Nap.js';
import { Tutorial } from '../components/Tutorial.js';
import { BreakerPanel } from '../ui/BreakerPanel.js';
import { BreakerPuzzle } from '../gameplay/BreakerPuzzle.js';
import { sealAgainst } from '../core/ShadowSides.js';
import { SecurityCamera } from '../gameobjects/SecurityCamera.js';
import { CameraTerminal, createCameraInteractable, CAMERA_FLASH } from '../components/CameraTerminal.js';
import { CameraOverlay } from '../ui/CameraOverlay.js';
import { Stamina } from '../gameplay/Stamina.js';
import { CoffeeHarvest, COFFEE_HARVEST } from '../gameplay/CoffeeHarvest.js';
import { CoffeeItems } from '../components/CoffeeItems.js';
import { ProcessorSound } from '../components/ProcessorSound.js';
import { ImpactSound, IMPACT_SOUNDS } from '../components/ImpactSound.js';
import { CoffeeBeans, CoffeeBag, COFFEE_BAG } from '../gameobjects/CoffeeGoods.js';
import { StaminaDrain } from '../components/StaminaDrain.js';
import { SleepDemon, sightRay, SLEEP_DEMON_FIGURE } from '../gameplay/SleepDemon.js';
import { createMonsterFigure } from '../gameobjects/MonsterFigure.js';
import { FatigueEffects } from '../components/FatigueEffects.js';
import { BedRest } from '../components/BedRest.js';
import { PromptLabel } from '../ui/PromptLabel.js';
import { TutorialOverlay, tutorialKeys } from '../ui/TutorialOverlay.js';
import { FatigueOverlay } from '../ui/FatigueOverlay.js';
import { EventBanner } from '../ui/EventBanner.js';
import { exitGate, buggyRoute, routeCurve, distanceAlong } from '../gameplay/BuggyDeparture.js';
import { BuggySendOff } from '../components/BuggySendOff.js';
import { BuggySound } from '../components/BuggySound.js';
import { Footsteps } from '../components/Footsteps.js';
import { BedroomPCPanel } from '../ui/BedroomPCPanel.js';
import { colonyMap } from '../ui/colonyMap.js';
import { RunRecord } from '../gameplay/RunRecord.js';
import { ThreatWatch } from '../gameplay/ThreatWatch.js';
import { threatForecast } from '../gameplay/ThreatForecast.js';
import { Pickupable } from '../components/Pickupable.js';
import { RagnoFigure } from '../gameobjects/RagnoFigure.js';
import { Ragno, ragnoRay } from '../gameplay/Ragno.js';
import { approachRoute, climbRoute, slopeOut, NavGraph, RAGNO_PATHS } from '../gameplay/RagnoPaths.js';
import { createVentHood, createVentGrille, createCameraPole } from '../gameobjects/WallVent.js';
import { terrainHeightAt } from '../gameobjects/MarsTerrain.js';

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
// A night is a shift: 6:00 PM to 6:00 AM on the NightClock, which the office's
// wall clock and the HUD both show. It starts at sunset and the first hour is
// the dusk; the last hour brings the dawn (Daylight turns the sky, lights and
// fog between the night and the Martian day). A met quota makes it
// morning, and the bunk in LivingQuarters sleeps through the day to the next
// night. The dev console's `night` skips ahead; it wraps back to night 1
// after the last.
// ─────────────────────────────────────────────

const CORRIDOR_LENGTH = 4;
const CORRIDOR_WIDTH  = 2;
/** Side rooms' centre z. Their doorways slide to meet the corridor. */
const SIDE_ROOM_Z = 1;
/** Capsule centre: the office floor centre, lifted so the capsule starts
 *  above the floor and settles onto it. */
const PLAYER_SPAWN = [0, 1, 0];

/** The fog's density, everywhere: every room, every corridor and outside.
 *  No room has a fog of its own — a room that changed it showed as the view
 *  through the office window changing at its doorway — and the rooms' own
 *  surfaces take no fog at all (_keepFogOutside).
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

/** The buggy's half-length along x, in metres, for when its model isn't
 *  loaded (tests) and its bounds can't be measured. */
const BUGGY_HALF_LENGTH = 2.6;

/** Where the night reset leaves the boxes it takes back — the airlock
 *  dock's first, then the buggy's — on the office floor by the front door.
 *  Room-local equals world (the office root is at the origin); y is half a
 *  box's height. */
const BOX_PARKING = [[1.1, 0.06, 4.72], [1.6, 0.06, 4.72]];

/** Metres round the generator kept free of grass. The tallest blade
 *  (1.45 m), tipped its furthest, reaches about 1 m from its root. */
const GRASS_GENERATOR_CLEARANCE = 1;
/** Metres past that over which the grass grows back, thin and short at
 *  first: a hard edge left a few tall blades standing alone by the casing. */
const GRASS_GENERATOR_FADE = 2;

/** Metres from the coffee machine's top a bag let go docks on it from:
 *  enough for the floor in front of its table. */
const COFFEE_DOCK_REACH = 1.4;

/** Metres either side of the fence kept free of trees. The widest canopy in
 *  the belt (a pine, ~4.7 m across) reaches 2.35 m from its trunk. */
const TREE_FENCE_CLEARANCE = 3;

/** Metres across the concrete buttress each side run of the fence ends on,
 *  where it runs into the bunker's front slope (BunkerShell.addAnchor). */
const FENCE_ANCHOR_WIDTH = 0.45;

/** Metres the building-as-occluder is shrunk by on every side, for the
 *  sightlines between the corners hiddenFromRegion samples. */
const OCCLUDER_MARGIN = 0.3;

/** An inside-only or unseen group of instances smaller than this stays in
 *  its mesh's always-drawn part: splitting it off costs a draw call, which a
 *  few thousand triangles aren't worth. The yard split has no floor — it
 *  saves work on every frame indoors, where the player spends the night. */
const MIN_SPLIT_TRIANGLES = 8000;

/** An instanced mesh this heavy is also cut into wedges of ground round the
 *  base (groundChunk), so three culls the wedges behind the camera: one
 *  mesh of the whole ring has one bounding sphere round the basin, which
 *  every view meets (#175). Measured on the belt from the desk and the yard:
 *  8 wedges × 2 rings over 200 k triangles took what was drawn from 2.8 M
 *  triangles to about 1.45 M for some 30 more draw calls. Lighter meshes
 *  aren't worth the calls. */
export const CHUNK_TRIANGLES = 200_000;

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
 *  the floor beneath them dark: hiding under the desk looks like hiding.
 *  `glass` is how much of it the window's smudges show by (WindowGlass). */
const WINDOW_FLOOD = { from: [0, 2.7, 0.3], to: [0, 0, 2.9], intensity: 60, angle: 0.7, glass: 0.04 };

/** The main menu's shot (_buildMenuShot, #115): over the office computer,
 *  out of the window at the dish. `eye` is office-local metres, just behind
 *  the desk and above its screen. It looks at a point `look` m up the tower,
 *  `lead` m along x from it, so the dish sits right of centre, clear of the
 *  menu panel on the left. A narrower `fov` than the player's keeps the
 *  dish big; the window frames it at any screen shape from 4:3 to 21:9. */
const MENU_SHOT = { eye: [0.15, 1.35, -1.9], look: 3.5, lead: -6, fov: 60 };

/** The height, CSS px, the radar's and the camera's overlays are laid out
 *  at on their screens (#161); their widths follow each screen's shape. */
const SCREEN_LAYOUT_HEIGHT = 720;

/** The security cameras (_addSecurityCameras), in metres. Indoors: in from
 *  the corner's two walls, and down from the ceiling. Outdoors: how far off
 *  the bunker's roof band (the bracket's plate) — they hang halfway up it,
 *  BunkerShell's `fascia`. Pan ranges are
 *  radians either way; `reach` is how far each one's flash carries. */
const SECURITY_CAMERAS = {
  room:    { inset: 0.2, drop: 0.25, aimHeight: 0.4, panRange: 0.75, reach: 11 },
  /** `aimBack`: metres toward the window side the end-wall cameras look at
   *  rest, 15 m out, so they pick up Ragno rounding the end. */
  outside: { offWall: 0.02, panRange: 1.1, reach: 25, aimBack: -2 },
  yard:    { inFromFence: 1.5, panRange: Math.PI / 2, reach: 25 },
  /** On a CCTV pole in the clearing behind each wing: `out` m from the end
   *  wall's line (negative: in from it), `back` m behind the wing's
   *  window-side wall, clear of the trees. It looks out across the clearing
   *  at the tree line Ragno comes out of (`aim`: x out, z back), held to
   *  `panRange` either way of that so it never turns to the building. */
  pole: { out: -3.3, back: 9, height: 3.6, aim: [12, -4], panRange: 0.35, reach: 30 },
  /** The ground in front of each pole kept clear of trees: metres out along
   *  its aim, and either side of its line. */
  poleView: { ahead: 13, across: 5 },
  /** The monitor's map: metres of ground shown round the base and its
   *  farthest cameras (the poles are the corners), [across, down]. Wide
   *  enough across that the end-wall cameras read as outside, and enough
   *  every way that no camera's button hangs off the map's edge. */
  mapMargin: [6, 4],
};

// ── BannerTicker ──────────────────────────────────────────
// A small component on GameplaySystems that runs the event banner on
// engine.realDt, so a nap's 15× timeScale doesn't rush it and a pause
// holds it.
class BannerTicker extends Component {
  constructor(banner, engine) {
    super();
    this._banner = banner;
    this._engine = engine;
  }
  onUpdate(_dt) {
    this._banner?.update(this._engine?.realDt ?? 0);
  }
}

/** Ragno's vents (_addVents), one per wing, on the end wall: the middle of
 *  the opening `y` up, and room-local z along the wall, where the floor
 *  inside is clear of the bunk, the racks and the desk. The hood outside
 *  stands `hoodOut` past the slope at its foot; he lands on the floor
 *  `landing` m in from the wall, coming down it. */
const RAGNO_VENTS = {
  y: 2.2, width: 0.8, height: 0.55, hoodOut: 0.3, landing: 0.75,
  z: { LivingQuarters: 1.2, ServerRoom: 2.7 },
};
/** Where Ragno stands watching the corridor (room-local x, z): toward the
 *  back of his room, out of the line of sight through its doorway, so he
 *  can't be seen from the corridor. And the player's eye at the desk
 *  (office-local), for the window's view. */
const RAGNO_WATCH = { LivingQuarters: [-0.6, -0.6], ServerRoom: [0.4, -1.0] };
/** A standing spot on the way to his watch, where the room needs one
 *  (room-local x, z): the server room's aisle mouth, so the way down the
 *  aisle never cuts across a rack's corner. */
const RAGNO_VIA = { ServerRoom: [0.3, 1.9] };
/** Metres his standing spots round the office desk keep off it. */
const RAGNO_DESK_GAP = 0.8;
const DESK_EYE = [0, 1.24, -1.4];


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

  /** How awake the player is: drained through the shift, topped up by a
   *  ration. The Sleep Demon and the fatigue effects read it.
   *  @type {Stamina|null} */
  stamina = null;
  /** The thing in the corner of the eye, every night. @type {SleepDemon|null} */
  sleepDemon = null;

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
    this._addBunkerShell();
    this._addAmbience();
    this._setupNights();
    this._addSky();
    this._addGround();
    this._addLighting();
    this._buildOutside();
    this._buildMenuShot();
    this._addSecurityCameras();
    this._addVents();
    this._addWindDust();
    this._spawnPlayer();
    this._keepFogOutside();
    this._addPower();
    this._addGameplaySystems();
    this._addCameraTerminal();
    this._addScreenPictures();
    this._addCoffee();
    this._addStamina();
    this._addBedRest();
    this._addBuggySendOff();
    this._addBedroomPC();
    this._addFatigue();
    this._addSleepDemon();
    this._addUfo();
    this._addSandstorm();
    this._addRagno();
    this._addThreatWatch();
    this._addNap();
    this._addTutorial();
    this._buildOcclusion();
    this._buildPortalCulling();
    this._addDriveInstancer();

    console.timeEnd('BaseScene.build');
    this._logBuildStats();
  }

  /** Budget check (see docs/PERFORMANCE-PLAN.md): how many
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
    // Off every screen first: the frame goes back to the player's eyes.
    this._leaveScreens();
    this.cameraOverlay?.hide();
    if (this.feedDisplay) {
      const passes = this.engine.screenPasses;
      passes?.splice(passes.indexOf(this.feedDisplay) >>> 0, 1);
      this.feedDisplay.dispose();
      this.feedDisplay = null;
    }
    this._feedQuad?.geometry.dispose();
    this._feedQuad = null;
    if (this._visorRefraction) {
      const passes = this.engine.screenPasses;
      const at = passes?.indexOf(this._visorRefraction) ?? -1;
      if (at >= 0) passes.splice(at, 1);
      this._visorRefraction.dispose();
      this._visorRefraction = null;
    }
    this.monitorSpeaker?.dispose();
    this.monitorSpeaker = null;
    this._offCameraState?.();
    this._offCameraPause?.();
    for (const cam of this.securityCameras ?? []) cam.dispose();
    this._offNightStart?.();
    this._offNightReset?.();
    this._offSuitHud?.();
    this._offRetry?.();
    this._offBuggyNight?.();
    this._offPower?.forEach(off => off());
    this.ufo?.dispose();
    this.driveInstancer?.dispose();
    this.dust?.dispose();
    for (const { go } of this.dustEyes?.slots ?? []) go.dispose();
    this.ragnoFigure?.dispose();
    this.breakerPanel?.close();
    for (const sound of this._sounds) {
      if (sound.isPlaying) sound.stop();
      try { sound.disconnect(); } catch (_) { /* never connected */ }
    }
    this._sounds.length = 0;
    this.whiteOut?.clear();
    this._pipeline?.dispose();
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
    // The HUD, radar and processing screen are DOM overlays living in
    // index.html, outside the scene graph — nothing tears them down for
    // us, so a scene swap would leave last night's numbers floating over
    // the next level.
    this.hud?.hide();
    this.banner?.clear();
    // dispose(), not just hide(): both hang listeners on page elements and
    // the window that outlive the scene.
    this.radarOverlay?.dispose();
    this.processingScreen?.dispose();
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
    const frontDoor = office.openings.find(o => o.side === 'front');
    const frontDoorX = office.position[0] + frontDoor.offset;
    // The office's front wall shows inside the airlock, round that doorway:
    // the airlock lines it, as neither room's own walls cover it.
    airlock.openEndDoorways = { back: { width: frontDoor.width, height: frontDoor.height } };
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
    // Each end butts against a room's outer wall, round its doorway; the
    // corridor lines that face, as neither room's own walls cover it. A
    // corridor runs along x, so its left end is the −x one.
    const door = (room, side) => {
      const { width, height } = rooms[room].openings.find(o => o.side === side);
      return { width, height };
    };
    this.corridors = {
      OfficeToServer: new Corridor(engine, {
        ...common, name: 'OfficeToServer', position: [mid, 0, this._doorZ.right],
        openEndDoorways: { left: door('MainOffice', 'right'), right: door('ServerRoom', 'left') },
      }),
      OfficeToQuarters: new Corridor(engine, {
        ...common, name: 'OfficeToQuarters', position: [-mid, 0, this._doorZ.left],
        openEndDoorways: { left: door('LivingQuarters', 'right'), right: door('MainOffice', 'left') },
      }),
    };
    for (const corridor of Object.values(this.corridors)) this._corridors.addChild(corridor.build());
  }

  // ──────────────────────────────────────────
  // The bunker (the building as seen from outside)
  // ──────────────────────────────────────────
  /** The sloped concrete shell round the whole building (BunkerShell). Its
   *  outline is walked round the rooms' outer wall faces: the wings' backs,
   *  the office jutting out behind them, the ends, the front, and round the
   *  airlock, which juts out of the front as a sloped porch. Two stretches
   *  stay bare: the office's back wall, so the window looks straight out —
   *  framed in a rounded, flared embrasure — and the airlock's hatch end, so
   *  the hatch opens on the yard. A signal mast stands on the roof. Read off
   *  the rooms, so it follows a redesign — as long as the office stands out
   *  behind the wings and the fronts line up.
   *
   *  On the scene root, not under Outside: the occlusion sort would file it
   *  by where it stands, and it is the building — seen from everywhere
   *  outside, and from indoors hidden behind the walls anyway. */
  _addBunkerShell() {
    const { MainOffice: office, ServerRoom: server, LivingQuarters: quarters, Airlock: airlock } = this.rooms;
    const ob = office.bounds(), ab = airlock.bounds();
    const ends = [quarters.bounds(), server.bounds()];
    const west  = Math.min(...ends.map(b => b.min.x));
    const east  = Math.max(...ends.map(b => b.max.x));
    const back  = Math.max(...ends.map(b => b.min.z));          // the wings' back walls
    const front = Math.min(ob.max.z, ...ends.map(b => b.max.z));

    // Each corner starts the edge to the next; `flat` leaves that edge bare.
    const corners = {
      quartersBack: { x: west,     z: back },
      officeLeft:   { x: ob.min.x, z: back },
      window:       { x: ob.min.x, z: ob.min.z, flat: true },
      officeRight:  { x: ob.max.x, z: ob.min.z },
      serverBack:   { x: ob.max.x, z: back },
      serverEnd:    { x: east,     z: back },
      serverFront:  { x: east,     z: front },
      airlockRight: { x: ab.max.x, z: front },
      hatch:        { x: ab.max.x, z: ab.max.z, flat: true },
      airlockLeft:  { x: ab.min.x, z: ab.max.z },
      quartersFront:{ x: ab.min.x, z: front },
      quartersEnd:  { x: west,     z: front },
    };
    const names = Object.keys(corners);
    const edge = name => names.indexOf(name);

    // Louvre plates high on the slopes, as on the front of the wings; `at` is
    // metres along the edge from its corner.
    const louvre = (name, at) => ({ edge: edge(name), at, y: 2.2, width: 1.3, height: 0.5 });
    const backWindow = office.openings.find(o => o.side === 'back');
    const spec = {
      outline: Object.values(corners),
      height: ob.max.y,
      roofProps: [
        { kind: 'stack', x: quarters.position[0] - 1.2, z: back + 1.6 },
        { kind: 'vent',  x: server.position[0], z: server.position[2] - 1 },
        { kind: 'vent',  x: office.position[0] - 3, z: office.position[2] + 1, rotationY: Math.PI / 2 },
      ],
      louvres: [
        louvre('serverFront', east - server.position[0] - 1.6),
        louvre('serverFront', east - server.position[0] + 1.6),
        louvre('quartersFront', ab.min.x - quarters.position[0] - 1.6),
        louvre('quartersFront', ab.min.x - quarters.position[0] + 1.6),
        louvre('serverEnd', 1.6),
        louvre('quartersEnd', front - back - 1.6),
      ],
      embrasures: [{
        edge: edge('window'),
        at: office.position[0] + (backWindow.offset ?? 0) - ob.min.x,
        sill: office.position[1] + backWindow.sill,
        width: backWindow.width, height: backWindow.height,
        radius: WINDOW_CORNER_RADIUS,
      }],
    };
    const shell = createBunkerShell({ engine: this.engine, ...spec });
    this._sceneRoot.addChild(shell);
    for (const resource of shell.resources) this._own(resource);
    this.bunker = shell;
    /** What it was built from: the dream's base is the same shell
     *  (DreamScene's BASE_SHELL, pinned to this by BaseScene.bunker.test.js). */
    this.bunkerSpec = spec;

    // The office's back wall is the one stretch of the rooms' own shell left
    // in view outside: in the slopes' weathered concrete, laid out as theirs,
    // it reads as part of the bunker. Its inner face is under the lining.
    for (const name of ['BackWall_A', 'BackWall_B', 'BackWall_Header', 'BackWall_Sill']) {
      const mesh = office.root.find(name)?.object3d.children.find(c => c.isMesh);
      if (mesh) shell.clad(mesh);
    }

    // The relay mast, on the server wing's roof toward the back: its lamp
    // flashes red over the building, seen from all round the yard.
    const mast = createSignalMast();
    mast.object3d.position.set(server.position[0] + 1.6, ob.max.y + BUNKER.cap.height, back + 1.4);
    shell.addChild(mast);
    for (const resource of mast.resources) this._own(resource);
    this.signalMast = mast;
  }

  // ──────────────────────────────────────────
  // Ambience (a loop per room, blended down the corridors)
  // ──────────────────────────────────────────
  /** Each room's shell plays that room's loop; each corridor crossfades the
   *  two rooms it joins. Read at the camera, where the ears are, so it
   *  follows the debug fly camera too.
   *
   *  The airlock has no loop of its own: it hears whichever side's door
   *  stands open — the office through the inner door, the wind through the
   *  hatch — and nothing at all while it cycles with both shut. So a change
   *  of mind mid-cycle never lets the wind in. */
  _addAmbience() {
    const { engine, rooms, corridors } = this;
    const office = AMBIENCE.rooms.MainOffice;
    // How much of a storm each room lets in (AMBIENCE.storm): a hiss, and a
    // little more in the office, behind its window. The airlock is open to
    // the office or to the yard, so it leaks as the office does.
    const leak = name => AMBIENCE.storm.rooms[name] ?? AMBIENCE.storm.inside;
    const airlock = { box: rooms.Airlock.bounds(), track: office, leak: leak('MainOffice') };
    const follow = (state) => {
      if (state === 'pressurised') airlock.track = office;
      else if (state === 'depressurised') airlock.track = AMBIENCE.outside ?? office;
      else airlock.track = null;
    };
    follow(rooms.Airlock.state);
    rooms.Airlock.onStateChange(follow);   // dropped by the airlock's dispose()

    const mix = new AmbienceMix({
      zones: [
        ...Object.values(rooms)
          .filter(room => AMBIENCE.rooms[room.name])
          .map(room => ({ box: room.bounds(), track: AMBIENCE.rooms[room.name], leak: leak(room.name) })),
        airlock,
      ],
      passages: Object.values(corridors).map(c => ({ box: c.bounds(), axis: c.axis })),
      outside: AMBIENCE.outside,
      leak: AMBIENCE.storm.inside,
    });
    this.ambience = this._group('Ambience').addComponent(new Ambience({
      mix,
      listenerPosition: out => this._ears(out),
      // Testing only: the dev console's `music spooky|ambient|off` swings
      // one in under the game. Dev builds only, so the production bundle
      // never loads the extra track for it.
      testTracks: import.meta.env?.DEV ? { spooky: AMBIENCE.music, ambient: AMBIENCE.ambientMusic } : null,
    }));

    // The silence of the sealed airlock is filled by its pressure release:
    // once as the doors shut, for a player who is in the chamber.
    this.ambience.gameObject.addComponent(new AirlockSound({
      airlock: rooms.Airlock,
      sound:   this._sound(AIRLOCK_SOUND.key),
      isInside: () => airlock.box.containsPoint(this._ears(_airlockEar)),
    }));

    // In a storm, sand on the office window: heard in the office, louder
    // the nearer the glass. The storm is built later, so it is read live.
    const officeShell = rooms.MainOffice.bounds();
    this.ambience.gameObject.addComponent(new WindowSand({
      window: this._officeWindow(),
      storm:  () => this.sandstorm?.level ?? 0,
      listenerPosition: out => this._ears(out),
      isInside: p => officeShell.containsPoint(p),
    }));
  }

  // ──────────────────────────────────────────
  // Night progression
  // ──────────────────────────────────────────
  _setupNights() {
    // Night 0 is the tutorial: New game opens on it (App), the scene
    // itself is built on night 1.
    this.nights = new NightManager({ minNight: 0 });
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
    this.nightClock = new NightClock();

    // Signal registry discovers .wav files at build time; SignalManager
    // shuffles the names each night and assigns one per target.
    this.signalRegistry = new SignalRegistry();
    this.signalManager = new SignalManager({ signalNames: this.signalRegistry.names });

    // ── Drive manager (physical hard drives) ──
    this.driveManager = new DriveManager();

    // UI wrappers over the markup in index.html. With no DOM (tests) each
    // falls back to a null root and every call is a no-op.
    this.hud          = new HUD();
    this.banner       = new EventBanner();
    this.radarOverlay = new RadarOverlay();
    this.processingScreen = new ProcessingScreen();

    // Show the radar overlay (and its telemetry panel) from scene build,
    // not only after the first terminal interaction. The overlay stays
    // permanently visible once shown.
    this.radarOverlay.show();

    // The real sky behind the radar grid: the backdrop reads it live, so it
    // turns with the night and drowns in the dawn exactly as the window
    // view does.
    this.radarOverlay.setSky(this.sky);

    this.terminal = new ComputerTerminal();
    this.terminal.satellite     = this.satellite;
    this.terminal.signalManager = this.signalManager;
    this.terminal.hud           = this.hud;
    this.terminal.radar         = this.radarOverlay;
    this.terminal.driveManager  = this.driveManager;
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

    // Using the computer, or the server room's console, leans the view in
    // to its screen and draws the overlay on it (#161). One view for both:
    // only one screen is used at a time.
    this.screenView = new ScreenView({ engine: this.engine });
    gameplayGO.addComponent(this.screenView);
    this.terminal.screenView = this.screenView;
    this.terminal.screen = this.rooms.MainOffice.computerScreen;

    this.gameController = new GameController();
    this.gameController.nightClock    = this.nightClock;
    this.gameController.signalManager = this.signalManager;
    this.gameController.satellite     = this.satellite;
    this.gameController.terminal      = this.terminal;
    this.gameController.hud           = this.hud;
    this.gameController.banner        = this.banner;
    // The run's array name and each night's threat log, for the bedroom PC.
    // On the engine, so a dream's rebuild between nights keeps it.
    this.engine.run ??= new RunRecord();
    gameplayGO.addComponent(this.gameController);

    // The banner's timing runs on real time (engine.realDt), ticked by a
    // small component on GameplaySystems, so a nap's 15× timeScale doesn't
    // rush it and a pause holds it.
    gameplayGO.addComponent(new BannerTicker(this.banner, this.engine));

    // The terminal notifies the controller when a signal is auto-saved.
    this.terminal.gameController = this.gameController;

    // The red signal (the next threat, in early): it scans itself, pins
    // the dish when no drive is in, and corrupts the drive it is saved to
    // — a red drive never counts towards the quota. Twice on night 3, each
    // at an hour of its own on the night clock (scheduleEvil); the console's
    // `evil` brings it on any night.
    this.evilSignal = new EvilSignal({
      controller:    this.gameController,
      signalManager: this.signalManager,
      terminal:      this.terminal,
      driveManager:  this.driveManager,
      satellite:     this.satellite,
      clock:         this.nightClock,
    });
    gameplayGO.addComponent(this.evilSignal);
    this.terminal.evilSignal = this.evilSignal;

    // Shared doom PointLight — created once at scene build, moved to the
    // corrupted drive each frame by EvilSignal. Never added/removed so the
    // scene's light count stays fixed (no shader recompiles).
    const doomLight = new THREE.PointLight(DOOM_LIGHT_COLOR, 0, DOOM_LIGHT_MAX_DISTANCE);
    doomLight.name = 'DoomLight';
    gameplayGO.object3d.add(doomLight);
    this.evilSignal.doomLight = doomLight;

    // Wire the drive manager to the office's drive reader slot.
    const driveSlot = this.rooms.MainOffice.driveReader?.getComponent(DriveSlot);
    if (driveSlot) {
      driveSlot.bindDriveManager(this.driveManager);
    }

    // Wire the delete and processing console slots.
    // Each slot works independently (no DriveManager) — the console's
    // Interactable checks the slot's insertedDrive for signals.
    const deleteSlot = this.rooms.ServerRoom?.deleteDriveSlot;
    const processingSlot = this.rooms.ServerRoom?.driveSlot;

    // Wire the processing screen to the ServerRoom console and the signal
    // registry (for audio URL lookup from the drive's signal name).
    this.processingScreen.signalRegistry = this.signalRegistry;
    this.processingScreen.setEngine(this.engine);
    this.processingScreen.view = this.screenView;
    this.processingScreen.screen = this.rooms.ServerRoom?.consoleScreen ?? null;
    if (this.rooms.ServerRoom) {
      this.rooms.ServerRoom.processingScreen = this.processingScreen;
    }

    // Wire the drive box dock in the airlock and the drive boxes on the
    // office shelf.
    const quotaDock = this.rooms.Airlock.quotaDock;
    const driveBoxes = this.rooms.MainOffice.driveBoxes ?? [];
    if (quotaDock) {
      quotaDock.requiredCount = this.signalManager.required;
      this.gameController.quotaDock = quotaDock;
    }

    // Drives are already in the room (added by MainOffice._buildDriveBoxes)
    // so they have physics from the engine lifecycle. Register every drive
    // with the manager and every snap receiver up front, so any drive can
    // snap into any slot or box the same way.
    const office = this.rooms.MainOffice;
    for (const drive of office.drives) {
      this.driveManager.addDrive(drive);
      if (driveSlot) driveSlot.addDrive(drive);
      if (deleteSlot) deleteSlot.addDrive(drive);
      if (processingSlot) processingSlot.addDrive(drive);
      for (const box of driveBoxes) box.addDrive?.(drive);
    }

    // Hook into slot eject callbacks to ensure drives stay in the room
    const addDriveToRoom = (drive) => {
      if (drive.object3d.parent !== office.root.object3d) {
        office.root.addChild(drive);
      }
    };
    if (driveSlot) {
      const origOnRemoved = driveSlot.onDriveRemoved;
      driveSlot.onDriveRemoved = (drive) => {
        origOnRemoved?.(drive);
        addDriveToRoom(drive);
      };
    }
    if (deleteSlot) {
      const origOnRemoved = deleteSlot.onDriveRemoved;
      deleteSlot.onDriveRemoved = (drive) => {
        origOnRemoved?.(drive);
        addDriveToRoom(drive);
      };
    }
    if (processingSlot) {
      const origOnRemoved = processingSlot.onDriveRemoved;
      processingSlot.onDriveRemoved = (drive) => {
        origOnRemoved?.(drive);
        // Removing a drive from the processing console cancels any in-flight
        // signal upgrade — the player must start over with a fresh insertion.
        drive.processingStarted = false;
        drive.processingAccumulated = 0;
        addDriveToRoom(drive);
      };
    }

    // The dock's socket only accepts whole drive boxes — introduce it to
    // every shelf box so a carried box released near the pedestal snaps on.
    if (quotaDock?.socket) {
      for (const box of driveBoxes) quotaDock.socket.addCandidate(box);
    }

    // The buggy's cargo bay: in the morning the docked box goes out to it
    // before bed (#98). The controller keeps the bed shut until it is in.
    if (this.buggyCargo) {
      this.buggyCargo.controller = this.gameController;
      this.gameController.cargo = this.buggyCargo.dock;
      for (const box of driveBoxes) this.buggyCargo.dock.socket.addCandidate(box);
    }

    // ── Pickup system (generic carry mechanic) ──
    // Attached to the player so it can detect Pickupable objects via
    // InteractionSystem's raycast and apply spring-damper hold forces.
    this.pickupSystem = new PickupSystem();
    this.engine.player.addComponent(this.pickupSystem);
    this.pickupSystem.interactionSystem = this.engine.player.getComponent(InteractionSystem);
    this.pickupSystem.terminal = this.terminal;

    // The player's footsteps: an outdoor thump under them out of the shells.
    this.engine.player.addComponent(new Footsteps({
      isOutside: () => !!this.engine.camera && this._isOutside(this.engine.camera.getWorldPosition(_staminaEye)),
      surfaceUnder: () => this._surfaceUnder(),
    }));

    // The night baseline for every drive and box: a retry reverts to it.
    this.driveSnapshot = new DriveSnapshot({
      drives: office.drives,
      boxes: driveBoxes,
      driveManager: this.driveManager,
      pickupSystem: this.pickupSystem,
    });

    // One night number across the scene. NightManager owns it; the
    // controller's quota, clock and HUD follow it instead of counting on
    // their own — otherwise sleeping (or pressing N) would move to night 2
    // while the HUD still read "Night 1". autoStart is off for the same
    // reason: it hardcodes night 1.
    this.gameController.autoStart = false;
    // A retry reverts to the night-start snapshot; a real night change
    // resets the dock and captures a fresh baseline. Registered before the
    // respawn listener below, so physics is settled before the player
    // teleports.
    this._offNightReset = this.gameController.onNightStart((_night, { retry }) => {
      if (retry) this.driveSnapshot.restore();
      else { this._resetForNewNight(); this.driveSnapshot.capture(); }
    });
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
    const { wallClock, deskClock, signalLight, windowGlass } = this.rooms.MainOffice;
    if (wallClock) wallClock.clock = this.nightClock;
    if (deskClock) deskClock.clock = this.nightClock;
    const { bedsideClock } = this.rooms.LivingQuarters;
    if (bedsideClock) bedsideClock.clock = this.nightClock;
    // The window's smudges show by the night outside too, and by the dawn.
    windowGlass?.addLight(this.ambientLight, 1 / Math.PI);
    if (signalLight) {
      signalLight.signalManager  = this.signalManager;
      signalLight.gameController = this.gameController;
      // Its beep, with every light-up.
      signalLight.addComponent(new ScannerAlertSound());
    }
    this.screenFade = new ScreenFade();
    const { bed } = this.rooms.LivingQuarters;
    if (bed) {
      bed.controller = this.gameController;
      bed.fade       = this.screenFade;
      bed.dream      = (night) => this._dream(night);
    }

    this.hud.setSuit(this.suit.worn);
    this._offSuitHud = this.suit.onChange(worn => this.hud.setSuit(worn));

    // A retry after a game over starts the night over from the beginning:
    // back at the spawn, facing the window, suit off (the airlock cycles
    // back with it). A new night after sleeping leaves you where you woke.
    this._offRetry = this.gameController.onNightStart((_night, { retry }) => {
      this._leaveScreens();
      if (retry) this._respawn();
    });

    // The terminal is a vital function: it runs whenever the generator
    // does, blown bulbs or not.
    this.terminal.setPowered(this.power.on);
    this._offPower.push(this.power.onChange(grid => this.terminal.setPowered(grid.on)));
  }

  /** Between-nights reset. Machine-slot drives are ejected but keep their
   *  signals; the docked drive box and the one loaded into the buggy lose
   *  everything — every drive seated in them is wiped, even over quota —
   *  and the empty boxes are released and parked on the office floor.
   *  Drives outside those boxes keep their signals and positions. */
  _resetForNewNight() {
    const driveSlot = this.rooms.MainOffice.driveReader?.getComponent(DriveSlot);
    const deleteSlot = this.rooms.ServerRoom?.deleteDriveSlot;
    const processingSlot = this.rooms.ServerRoom?.driveSlot;

    // Eject drives from reader and console slots (they keep their signal)
    if (driveSlot?.hasDrive) driveSlot._ejectDrive(driveSlot.insertedDrive);
    if (deleteSlot?.hasDrive) deleteSlot._ejectDrive(deleteSlot.insertedDrive);
    if (processingSlot?.hasDrive) processingSlot._ejectDrive(processingSlot.insertedDrive);

    // Empty the dock and the buggy: wipe their boxes' drives, release the
    // boxes and park them on the office floor, each in its own spot.
    const boxes = [this.rooms.Airlock.quotaDock?.empty(), this.buggyCargo?.dock.empty()].filter(Boolean);
    boxes.forEach((box, i) => {
      box.object3d.position.set(...BOX_PARKING[i]);
      box.object3d.updateMatrixWorld(true);
      const body = box.rigidBody;
      if (body) {
        const world = box.object3d.getWorldPosition(new THREE.Vector3());
        body.setTranslation({ x: world.x, y: world.y, z: world.z }, true);
        body.setLinvel?.({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel?.({ x: 0, y: 0, z: 0 }, true);
      }
    });
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
    // The bunker's slopes too: a cloud through one shows as a hard edge.
    const cutouts = [...parts.map(part => part.bounds()), ...(this.bunker?.cutouts() ?? [])];
    this.windDust = createWindDust({ cutouts });
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
    // never resets scene.fog, and both halves of the pair are ours now.
    this._prevFogColor   = this.engine.scene.fog?.color.getHex();
    this._prevFogDensity = this.engine.scene.fog?.density;

    // Match the fog to the dome's horizon band. Fog fades the terrain to its
    // own colour long before the dome starts, so a mismatch draws a visible
    // seam where the ground meets the sky.
    this.engine.scene.fog?.color.set(0x1f2a38);

    // One density, everywhere and for good: the engine's base fog is far too
    // thick for the valley (see OUTDOOR_FOG_DENSITY).
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

    // The generator, in the far corner of the fenced yard, on the side away
    // from the buggy — a walk out into the storm to cut the power, along the
    // wire. Read off the fence, so it follows the yard. Its control panel is
    // on its −z side, facing back across the yard. _addPower() puts its
    // switch on it. Placed before the grass, which is kept off it.
    const side = Math.sign(BUGGY_SPOT[0]) < 0 ? 1 : -1;   // across from the buggy
    const [insetX, insetZ] = GENERATOR_CORNER_INSET;
    const genX = side > 0 ? fenceRect.maxX - insetX : fenceRect.minX + insetX;
    this.generator = this.engine.spawnModel('model:generator', {
      name: 'Generator', position: [genX, 0, fenceRect.maxZ - insetZ],
    });
    this._adopt(this._outside, this.generator);

    const rocks = createMarsRocks({ footprint });
    const belt = createMarsVegetation({
      footprint,
      assets: engine.assets,
      // The belt closes the horizon all round, so the way out to the dish has
      // to be one of the lanes through it, not just a clearing at its feet.
      lanes: [DISH_LANE],
      // A tree on the fence line grows through the chain-link. Dropped, not
      // moved, so the rest of the belt stands where it always has.
      treesClearOf: [
        ...fenceKeepOut(fenceRect, { openSides: ['S'], clearance: TREE_FENCE_CLEARANCE }),
        // Nothing grows right in front of a pole's camera: it watches the
        // clearing Ragno crosses out of the trees. Nor on his way down the
        // yard side, past the fence: a worn strip to the end walls.
        ...[-1, 1].map(side => this._poleView(side)),
        ...[-1, 1].map(side => this._yardWalk(side, fenceRect)),
      ],
      // Blades grew up through the generator's casing.
      grassClearOf: this._footprintOf(this.generator, GRASS_GENERATOR_CLEARANCE)
        .map(box => ({ ...box, fade: GRASS_GENERATOR_FADE })),
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

    // The sliding gate in the fence's back (north) run, where one of the
    // belt's own lanes crosses it (the 60.5° one, as the belt is seeded).
    // exitGate picks the crossing nearest x = 12: the lane ahead of the
    // buggy's nose, not the one behind that needs a U-turn.
    // Null if no lane crosses within the run: the cargo then dispatches
    // directly, with no cutscene.
    const gate = exitGate(belt.lanes, fenceRect, { near: 12 });
    this.exitGate = gate;

    // Chain-link round the yard block in front of the base — the airlock's
    // side, with the generator and the buggy — closed on three sides, the
    // building's front being the fourth. The player stays in front of the
    // building: the only window is in the back wall (see _buildOcclusion).
    // A sliding gate in the back run lets the buggy out each morning (#98):
    // its opening is cut from the panels, a collider stands across it, and
    // two leaves slide apart along the line (FenceGate). The side runs meet
    // the END rooms' front walls, not the airlock's — the airlock sticks out
    // further, and fencing from its depth would leave a gap at each end.
    //
    // With the bunker round the building, the side runs start at the foot of
    // its front slope instead of buried in it, and each is anchored there:
    // a concrete buttress fills the wedge between the last post and the
    // slope, so the wire runs into the bunker and leaves no gap.
    const sideStart = this.bunker ? endFront + BUNKER.batter : undefined;
    const fence = createPerimeterFence({
      rect: fenceRect,
      openSides: ['S'],
      assets: engine.assets,
      world: engine.world,
      sideStart,
      gate,
    });
    this.fence = fence;
    this.fenceAnchors = this.bunker
      ? [fenceRect.minX, fenceRect.maxX].map(x => this.bunker.addAnchor({ x, z: sideStart, height: FENCE.height, width: FENCE_ANCHOR_WIDTH }))
      : [];
    for (const { mesh } of this.fenceAnchors) this._own(mesh.geometry);

    for (const field of [rocks, belt, towers, fence]) {
      this._outside.addChild(field);
      // Every field builds its own geometry and materials, so dispose() has to
      // know about them or they survive a scene reload.
      this._ownResourcesOf(field);
    }
    // The beacons' glow is a texture, which _ownResourcesOf leaves alone.
    this._own(towers.glowTexture);

    // Steerable dish tower. spawnModel registers it as a root object;
    // parented under Outside it's reached through SceneRoot instead, and
    // left in both it would slew at double speed.
    this.satellite = engine.spawnModel('model:dish-tower', {
      name: 'Satellite', position: [0, 0, -25], scale: 0.137, type: Satellite,
    });
    this._adopt(this._outside, this.satellite);
    // Its drive while it slews, and the click as it settles.
    this.satellite.addComponent(new SatelliteSound());
    // Park the dish at its demo pose: set the model sub-nodes and the rig
    // to the same angles so it spawns already there instead of slewing on
    // load. The neck mirrors game yaw (bearing g → neck.rotation.y = π − g).
    const parkYaw   = THREE.MathUtils.degToRad(45);
    const parkPitch = THREE.MathUtils.degToRad(-55);
    if (this.satellite.neck) this.satellite.neck.object3d.rotation.y = Math.PI - parkYaw;
    if (this.satellite.dish) this.satellite.dish.object3d.rotation.x = parkPitch;
    this.satellite.rig.currentYaw   = parkYaw;
    this.satellite.rig.currentPitch = parkPitch;
    this.satellite.targetYaw   = parkYaw;
    this.satellite.targetPitch = parkPitch;

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
    // lintel. Position and heading placed by hand in the level editor.
    const buggy = this._addBuggy(BUGGY_SPOT, THREE.MathUtils.degToRad(95.7), 1.237);
    this.buggyCargo = this._addBuggyCargo(buggy);

    this.dishPad = dishPad;
  }

  /** A GameObject's ground-plan rectangle, grown by `margin` metres all
   *  round, as a one-box list; empty if it has no mesh (tests). */
  _footprintOf(go, margin = 0) {
    if (!go) return [];
    go.object3d.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(go.object3d);
    if (box.isEmpty()) return [];
    return [{ minX: box.min.x - margin, maxX: box.max.x + margin, minZ: box.min.z - margin, maxZ: box.max.z + margin }];
  }

  /** The camera the main menu is drawn through (`menuCamera`, #115): over
   *  the office computer, looking out of the window at the dish. App hands
   *  it to `engine.viewCamera` while the main menu is up and fits its
   *  aspect and far plane to the game camera's, so the shot stays the same
   *  wherever the player wakes. It belongs to no GameObject: nothing moves
   *  it, so its matrices are set once here. */
  _buildMenuShot() {
    const [ox, oy, oz] = this.rooms.MainOffice.position;
    const [ex, ey, ez] = MENU_SHOT.eye;
    const camera = new THREE.PerspectiveCamera(MENU_SHOT.fov, 16 / 9, 0.1, this.engine.camera?.far ?? 1000);
    camera.name = 'MenuShot';
    camera.position.set(ox + ex, oy + ey, oz + ez);
    const tower = this.satellite.object3d.position;
    camera.lookAt(tower.x + MENU_SHOT.lead, MENU_SHOT.look, tower.z);
    camera.updateMatrixWorld();
    this.menuCamera = camera;
  }

  // ──────────────────────────────────────────
  // Security cameras (watched from the monitor on the desk's left wing)
  // ──────────────────────────────────────────
  /** Six cameras, placed off the rooms and the fence so they follow a
   *  redesign:
   *    • one in each side room, looking down across it: high in the
   *      living quarters' outer back corner (its top left, as seen from the
   *      desk), and high in the middle of the server room's back wall;
   *    • one on the outside of each end wall, about its middle, looking out;
   *    • two in the fenced yard, on the building's front near each end of
   *      the fence, looking out across it.
   *  The room ones hang in their rooms, so they go undrawn with the
   *  furnishings; the outdoor ones stand under Outside, for the occlusion
   *  sort. Each says which zones its picture needs: from indoors the yard
   *  (and the scenery no one is meant to see) has been left undrawn, and the
   *  monitor shows static until it is in.
   *
   *  A bracket turned off square to its wall stands on a wedge
   *  (SecurityCamera `mount`), so none of them hangs in the air.
   *
   *  The flash they share is built here too, at zero, so the boot warm-up
   *  compiles every lit shader with it counted. It hangs on the scene root
   *  — off the grid, and never under a room the occlusion sort can hide. */
  _addSecurityCameras() {
    const { rooms } = this;
    const R = SECURITY_CAMERAS.room, O = SECURITY_CAMERAS.outside, Y = SECURITY_CAMERAS.yard;
    const cams = [];
    // A wedge is drawn in the wall it is fixed to: inside, the room's lining
    // (its plain wall if the lining's textures aren't loaded); outside, the
    // shell. Both the room's, shared — never freed by the camera.
    const innerWall = room => room.root.object3d.getObjectByName('Lining_Walls')?.material ?? room.material;
    const place = (parent, spec, origin = [0, 0, 0]) => {
      const local = v => v.map((c, i) => c - origin[i]);
      // The mount is in the same space: a corner's (x, z), or a wall's plane.
      const { mount } = spec;
      const localMount = mount?.corner ? { ...mount, corner: [mount.corner[0] - origin[0], mount.corner[1] - origin[2]] }
        : mount?.wall ? { ...mount, wall: { axis: mount.wall.axis, at: mount.wall.at - origin[mount.wall.axis === 'x' ? 0 : 2] } }
        : null;
      const cam = new SecurityCamera({
        ...spec, name: `SecurityCamera_${cams.length + 1}`,
        position: local(spec.position), target: local(spec.target), mount: localMount,
      });
      parent.addChild(cam);
      cams.push(cam);
    };

    // The living quarters: high in the far back corner, on a wedge.
    {
      const room = rooms.LivingQuarters, b = room.bounds(), t = room.wallThick;
      const corner = [b.min.x + t, b.min.z + t];   // the inner faces of the end and back walls
      place(room.root, {
        label: 'LIVING QUARTERS', panRange: R.panRange, zones: ['interior'], flashReach: R.reach,
        position: [corner[0] + R.inset, room.position[1] + room.height - R.drop, corner[1] + R.inset],
        target: [room.position[0], R.aimHeight, room.position[2]],
        mount: { corner, material: innerWall(room) },
      }, room.position);
    }
    // The server room: high in the middle of the back wall, straight down the room.
    {
      const room = rooms.ServerRoom, b = room.bounds(), t = room.wallThick;
      const wall = b.min.z + t;
      place(room.root, {
        label: 'SERVER ROOM', panRange: R.panRange, zones: ['interior'], flashReach: R.reach,
        position: [room.position[0], room.position[1] + room.height - R.drop, wall + O.offWall],
        target: [room.position[0], R.aimHeight, room.position[2]],
        mount: { wall: { axis: 'z', at: wall }, material: innerWall(room) },
      }, room.position);
    }

    // Outside each end wall, about its middle, looking out.
    // The outdoor ones hang on the bunker's roof band — a sheer face, where
    // the slope under it would swallow a bracket.
    const band = this.bunker.fascia;
    for (const [room, label, side] of [[rooms.LivingQuarters, 'EXTERIOR — QUARTERS END', -1], [rooms.ServerRoom, 'EXTERIOR — SERVER END', 1]]) {
      const b = room.bounds();
      const face = (side < 0 ? b.min.x : b.max.x) + side * band.out;
      const x = face + side * O.offWall;
      const z = (b.min.z + b.max.z) / 2;
      place(this._outside, {
        label, panRange: O.panRange, zones: ['yard', 'unseen'], flashReach: O.reach,
        position: [x, band.y, z], target: [x + side * 15, 0, z + O.aimBack],
        mount: { wall: { axis: 'x', at: face }, material: band.material },
      });
    }

    // In the fenced yard: on the end rooms' front walls, in from each end of
    // the fence, looking straight out across the yard — and free to turn
    // all the way round either way, to look along the building.
    const { rect } = this.fence;
    for (const [room, label, side] of [[rooms.LivingQuarters, 'YARD — QUARTERS SIDE', -1], [rooms.ServerRoom, 'YARD — SERVER SIDE', 1]]) {
      const x = side < 0 ? rect.minX + Y.inFromFence : rect.maxX - Y.inFromFence;
      const front = room.bounds().max.z + band.out;
      place(this._outside, {
        label, panRange: Y.panRange, maxView: Y.panRange, zones: ['yard', 'unseen'], flashReach: Y.reach,
        position: [x, band.y, front + O.offWall],
        target: [x, 0, rect.maxZ - 2],
        mount: { wall: { axis: 'z', at: front }, material: band.material },
      });
    }
    // On a pole off each end, toward the window side (Ragno's cameras):
    // out over the trees he comes from, and free to turn round to the end
    // wall and its vent.
    const PL = SECURITY_CAMERAS.pole;
    this.cameraPoles = [];
    for (const [room, label, side] of [[rooms.LivingQuarters, 'POLE — QUARTERS SIDE', -1], [rooms.ServerRoom, 'POLE — SERVER SIDE', 1]]) {
      const { x, z } = this._poleSpot(side);
      const ground = terrainHeightAt(x, z);
      const pole = createCameraPole({ height: PL.height, name: `CameraPole_${room.name}` });
      pole.object3d.position.set(x, ground, z);
      // Its camera's collar toward where it looks.
      pole.object3d.rotation.y = Math.atan2(side * PL.aim[0], PL.aim[1]);
      this._outside.addChild(pole);
      for (const r of pole.resources) this._own(r);
      this.cameraPoles.push(pole);
      pole.object3d.updateMatrixWorld(true);
      const top = pole.object3d.localToWorld(pole.top.clone());
      place(this._outside, {
        label, panRange: PL.panRange, zones: ['yard', 'unseen'], flashReach: PL.reach,
        position: top.toArray(), target: [top.x + side * PL.aim[0], ground, top.z + PL.aim[1]],
      });
    }
    this.securityCameras = cams;
    this.cameraMap = this._cameraMap(cams);

    const flashGO = new GameObject('CameraFlash');
    flashGO.object3d.userData.offGrid = true;
    const flash = new THREE.SpotLight(CAMERA_FLASH.color, 0, R.reach, CAMERA_FLASH.angle, CAMERA_FLASH.penumbra, CAMERA_FLASH.decay);
    flash.name = 'CameraFlash';
    flash.castShadow = false;
    flashGO.object3d.add(flash, flash.target);
    this._sceneRoot.addChild(flashGO);
    this.cameraFlash = flash;
  }

  /** Where the pole for one end (−1 the quarters', +1 the server's) stands
   *  on the ground: in the clearing behind its wing (SECURITY_CAMERAS.pole). */
  _poleSpot(side) {
    const room = side < 0 ? this.rooms.LivingQuarters : this.rooms.ServerRoom;
    const b = room.bounds();
    const PL = SECURITY_CAMERAS.pole;
    return { x: (side < 0 ? b.min.x : b.max.x) + side * PL.out, z: b.min.z - PL.back };
  }

  /** The strip Ragno comes down outside the fence's side run to an end
   *  wall, as a box no tree may stand in: from the fence out past where his
   *  straight run in to the vent starts, from the end wall to past the
   *  fence's far end. */
  _yardWalk(side, fence) {
    const room = side < 0 ? this.rooms.LivingQuarters : this.rooms.ServerRoom;
    const b = room.bounds();
    const end = side < 0 ? b.min.x : b.max.x;
    const far = end + side * (RAGNO_PATHS.straightOut + 1);
    const line = side < 0 ? fence.minX : fence.maxX;
    return {
      minX: Math.min(line, far), maxX: Math.max(line, far),
      minZ: b.min.z, maxZ: fence.maxZ + RAGNO_PATHS.yardFrom + 2,
    };
  }

  /** The ground a pole's camera looks across, as a box no tree may stand in. */
  _poleView(side) {
    const { x, z } = this._poleSpot(side);
    const { aim } = SECURITY_CAMERAS.pole;
    const { ahead, across } = SECURITY_CAMERAS.poleView;
    const len = Math.hypot(aim[0], aim[1]);
    const ex = x + side * aim[0] / len * ahead, ez = z + aim[1] / len * ahead;
    return {
      minX: Math.min(x, ex) - across, maxX: Math.max(x, ex) + across,
      minZ: Math.min(z, ez) - across, maxZ: Math.max(z, ez) + across,
    };
  }

  /** The monitor's map, as CameraOverlay.setMap wants it: every room and
   *  corridor's shell from above, the fenced yard as an outline, and each
   *  camera where it hangs — all in world x / z. */
  _cameraMap(cams) {
    // Short: the side rooms are narrow on the map, with camera buttons on their walls.
    const NAMES = { MainOffice: 'OFFICE', LivingQuarters: 'QTRS', ServerRoom: 'SRVR', Airlock: 'A/L' };
    const block = (b, label) => ({ label, x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z });
    const { minX, maxX, minZ, maxZ } = this.fence.rect;
    return {
      margin: SECURITY_CAMERAS.mapMargin,
      rooms: [
        // The yard first, so the building is drawn over its overlap.
        { label: 'YARD', x0: minX, z0: minZ, x1: maxX, z1: maxZ, outline: true },
        ...Object.values(this.corridors).map(c => block(c.bounds(), '')),
        ...Object.values(this.rooms).map(r => block(r.bounds(), NAMES[r.name] ?? r.name)),
      ],
      cameras: cams.map((cam, i) => {
        const p = cam.object3d.getWorldPosition(new THREE.Vector3());
        // Which way it faces at rest, level: the map puts its square that
        // side of the wall, so a room camera's is inside, the others' out.
        cam.object3d.updateWorldMatrix(true, true);
        const d = cam.lens.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
        return { label: String(i + 1), x: p.x, z: p.z, dir: [d.x, d.z] };   // a numbered button, FNAF style
      }),
    };
  }

  /** The monitor's CameraTerminal: on the generator like the computer, and
   *  let go of on any end to the shift (a game over, the morning). Built
   *  after the gameplay systems, which it reads; the occlusion zones come
   *  last of all, so they are read when used. */
  _addCameraTerminal() {
    const monitor = this.rooms.MainOffice.cameraMonitor;
    this.cameraOverlay = new CameraOverlay();
    this.cameraOverlay.setMap(this.cameraMap);
    // The monitor's own picture (#161): the camera on it, drawn into a
    // small target after each frame and shown on its screen, always. The
    // switch between cameras is the screen's shader. The zones the yard
    // cameras need are handed over once built (_buildOcclusion), and drawn
    // for the picture alone.
    const screen = this.rooms.MainOffice.cameraScreen;
    const [tl, tr, , bl] = screen?.local ?? [];
    this.feedDisplay = new FeedDisplay({
      scene: this.engine.scene,
      aspect: screen ? tl.distanceTo(tr) / tl.distanceTo(bl) : 16 / 9,
    });
    this._feedQuad = screen ? screenMesh(screen, this.feedDisplay.material, { lift: 0.002 }) : null;
    const { renderer, screenPasses } = this.engine;
    if (renderer && screenPasses) {
      this.feedDisplay.attach(renderer);
      screenPasses.push(this.feedDisplay);
    }
    // The monitor's speaker: everything the camera on screen hears
    // (_listenFrom), and the flash's clicks, thin and fuzzy through it. The
    // servo's clip is fuzzy already and the static is the speaker's own:
    // out of it as they are, never heard from the lens.
    this.monitorSpeaker = new MonitorSpeaker(this.engine.audioListener);
    const speaker = this.monitorSpeaker;
    this.cameraTerminal = new CameraTerminal({
      display:    this.feedDisplay,
      screenView: this.screenView ?? null,
      screen:     screen ?? null,
      cameras:   this.securityCameras,
      flash:     this.cameraFlash,
      overlay:   this.cameraOverlay,
      crosshair: this.engine.crosshair,
      sounds: {
        servo:     speaker.route(this._sound('sfx:camera-servo'), { dry: true }),
        static:    speaker.route(this._sound('sfx:camera-static'), { dry: true }),
        spotlight:    speaker.route(this._sound('sfx:camera-spotlight')),
        spotlightOff: speaker.route(this._sound('sfx:camera-spotlight-off')),
      },
      hooks: {
        seen:         () => this._monitorSeen(),
        listenFrom:   (lens, level) => this._listenFrom(lens, level),
        // The mouse goes to the page, for the map — as for the breaker panel.
        // Taken off the monitor by the shift ending (a game over, the
        // morning), the pointer lock isn't asked back: there was no click.
        holdPlayer: (held) => {
          if (held || this.gameController?.state === 'playing') return this._usePanel(held);
          this.engine.uiHasMouse = false;
          this.engine.crosshair?.show();
          this._setPlayerLocked(false);
        },
      },
    });
    if (monitor) {
      monitor.addComponent(this.cameraTerminal);
      monitor.addComponent(createCameraInteractable(this.cameraTerminal));
    } else {
      console.warn('[BaseScene] no CameraMonitor in MainOffice — security cameras not attached');
    }

    this.cameraTerminal.setPowered(this.power.on);
    this._offPower.push(this.power.onChange(grid => this.cameraTerminal.setPowered(grid.on)));
    this._offCameraState = this.gameController.onStateChange((state) => {
      if (state !== 'playing') this.cameraTerminal.exit();
    });
    // Paused, nothing updates but the audio clock runs on: hush the loops.
    // The first frame after resuming starts whatever is still wanted.
    this._offCameraPause = this.engine.onPauseChange?.((paused) => {
      if (paused) this.cameraTerminal.silence();
    });
  }

  /** What the screens show (#161): each overlay's own DOM — the radar,
   *  the processing console, the camera's label and map — painted onto its
   *  screen, the same whether the player is leaned in to it or across the
   *  room. Each overlay is laid out once at a fixed size, invisible on the
   *  page (`.on-screen`); leaned in, ScreenView lays it onto the screen to
   *  take the mouse. The camera monitor's overlay goes over its feed, in
   *  the feed's own shader (FeedDisplay). */
  _addScreenPictures() {
    const gameplay = this._sceneRoot.find('GameplaySystems');
    if (!gameplay) return;
    const office = this.rooms.MainOffice, server = this.rooms.ServerRoom;
    const layoutFor = (surface) => {
      const [tl, tr, , bl] = surface.local;
      return [Math.round(SCREEN_LAYOUT_HEIGHT * tl.distanceTo(tr) / tl.distanceTo(bl)), SCREEN_LAYOUT_HEIGHT];
    };
    const picture = (surface, room, root, layout, painter, opts = {}) => {
      if (!surface) return null;
      this._hostOnScreen(root, layout);
      const screen = new ScreenCanvas({
        surface, layout, painter, ...opts,
        seen: () => this._screenSeen(surface, room),
        focused: () => !!this.screenView?.holds(surface),
      });
      gameplay.addComponent(screen);
      return screen;
    };

    // Lifts are in each model's own units: ~2.4 mm off the glass.
    const radarLayout = office.computerScreen ? layoutFor(office.computerScreen) : null;
    if (radarLayout) this.radarOverlay.fit(...radarLayout);
    this.computerPicture = picture(office.computerScreen, office, this.radarOverlay.root, radarLayout,
      (ctx, w, h) => this.terminal.paintScreen(ctx, w, h), { corner: 0.15, lift: 0.15 });
    this.consolePicture = picture(server?.consoleScreen, server, this.processingScreen.root, PROCESSING_LAYOUT,
      (ctx, w, h) => this.processingScreen.paint(ctx, w, h, server.driveSlot?.insertedDrive ?? null),
      { corner: 0.06, lift: 0.005 });
    // The camera's overlay: a texture alone, over the feed in its shader.
    const camera = office.cameraScreen;
    const overlay = this.cameraOverlay?.root ?? null;
    this.cameraPicture = picture(camera, office, overlay, camera ? layoutFor(camera) : null,
      (ctx, w, h) => { if (overlay) paintDom(overlay, ctx, w, h); },
      { quad: false, colorSpace: THREE.NoColorSpace });
    if (this.cameraPicture?.texture) this.feedDisplay?.setOverlay(this.cameraPicture.texture);
  }

  /** An overlay laid out at `layout` CSS px for its screen, for good:
   *  invisible on the page, painted onto the screen (index.html). */
  _hostOnScreen(root, layout) {
    if (!root || !layout) return;
    root.classList.add('on-screen');
    root.style.width = `${layout[0]}px`;
    root.style.height = `${layout[1]}px`;
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
      hooks: { listenerPosition: out => this._ears(out), isOutside: p => this._isOutside(p) },
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

  /** Where the player's ears are: on the player, or on the lens of the
   *  security camera on screen (_listenFrom). Every sound that works out
   *  its own level from where it is heard reads this. */
  _ears(out) {
    const ears = this.engine.audioListener?.parent ? this.engine.audioListener : this.engine.camera;
    return ears ? ears.getWorldPosition(out) : out;
  }

  /** Hear what `lens` hears, as if standing there, through the monitor's
   *  speaker at `level` (0..1) — or, with null, the player's own ears
   *  again. The ears themselves move (the AudioListener goes onto the
   *  lens), so every sound placed in the world is heard from the camera,
   *  and the sounds that work out their own level (_ears) cut straight
   *  over rather than easing across. */
  _listenFrom(lens, level) {
    const { audioListener: listener, camera } = this.engine;
    if (!listener || !camera) return;
    const host = lens ?? camera;
    if (listener.parent !== host) {
      host.add(listener);
      this.ambience?.jump();
      this.generatorSound?.jump();
    }
    this.monitorSpeaker?.engage(!!lens, level);
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

  /** Sleep after night `night` dreams (#101): that night's dream
   *  (DREAM_AFTER_NIGHT, the walk if it has none), at the night's level,
   *  waking into the next night. The scene is found by name — the
   *  dream wakes back into this scene, and the two importing each other
   *  would be a cycle. Swapped on the next tick: this runs inside a frame.
   *  @param {number} night  The night just done
   *  @returns {boolean} false when there is no dream scene to go to */
  _dream(night) {
    const { engine } = this;
    const registry = engine.sceneRegistry;
    const Dream = registry?.get?.(DREAM_AFTER_NIGHT[night]) ?? registry?.get?.('DreamScene');
    if (!Dream) return false;
    queueMicrotask(() => engine.loadScene(Dream, { sceneOptions: { level: night, night: night + 1 } }));
    return true;
  }

  /** Back to where the night starts: beside the bunk, facing the desk. */
  _respawn() {
    this.suit?.takeOff();
    const { position, yaw } = this._spawnPoint();
    const player = this.engine.player;
    const ctrl = player?.getComponent(FirstPersonController);
    if (ctrl) ctrl.teleport(position, { yaw, pitch: 0 });
    else player?.object3d.position.set(...position);
  }

  /** Where the player wakes (#79): the bedroom's spawn, beside the bunk —
   *  they sleep the day through there. The office centre if it's missing. */
  _spawnPoint() {
    return this.rooms.LivingQuarters?.spawn ?? { position: PLAYER_SPAWN, yaw: 0 };
  }

  /** Off any screen at once (the computer, the console, the cameras, the
   *  bedroom PC), with no lean back (#161): a kill or a new night wants the
   *  player's own view now. */
  _leaveScreens() {
    if (this.terminal?.state !== 'idle') this.terminal?.exit();
    if (this.processingScreen?.isOpen) this.processingScreen.close();
    this.rooms.LivingQuarters?.pc?.close();
    this.cameraTerminal?.exit();
    this.screenView?.cut();
  }

  /** The security monitor can be seen (_screenSeen): only then is its
   *  picture worth drawing from across the room. */
  _monitorSeen() {
    return this._screenSeen(this.rooms.MainOffice.cameraScreen, this.rooms.MainOffice);
  }

  /** A screen can be seen from where the frame is drawn: from inside its
   *  room, with its middle in view. */
  _screenSeen(surface, room) {
    const camera = this.engine.renderCamera ?? this.engine.camera;
    if (!surface || !room || !camera) return false;
    const t = (this._seenScratch ??= { eye: new THREE.Vector3(), centre: new THREE.Vector3(), m: new THREE.Matrix4(), frustum: new THREE.Frustum(), shells: new Map() });
    camera.getWorldPosition(t.eye);
    let shell = t.shells.get(room);
    if (!shell) t.shells.set(room, (shell = room.bounds()));
    if (!shell.containsPoint(t.eye)) return false;
    const [tl, , br] = surface.worldCorners();
    t.centre.addVectors(tl, br).multiplyScalar(0.5);
    camera.updateMatrixWorld();
    t.frustum.setFromProjectionMatrix(t.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    return t.frustum.containsPoint(t.centre);
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
  /** What the player stands on, for their footsteps: a prop's `surface`
   *  ('wood', 'bed') straight below their body, or 'floor'. */
  _surfaceUnder() {
    const { world, player, _bodyToGO } = this.engine;
    const body = player?.rigidBody;
    if (!world?.castRay || !body) return 'floor';
    const p = body.translation();
    this._footRay ??= new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this._footRay.origin.x = p.x; this._footRay.origin.y = p.y; this._footRay.origin.z = p.z;
    const hit = world.castRay(this._footRay, FOOT_REACH, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined, undefined, body);
    const go = hit ? _bodyToGO?.get(hit.collider.parent()?.handle) : null;
    return go?.surface ?? 'floor';
  }

  _isOutside(p) {
    this._insideBoxes ??= [...Object.values(this.rooms), ...Object.values(this.corridors)].map(part => part.bounds());
    return !this._insideBoxes.some(box => box.containsPoint(p));
  }

  // ──────────────────────────────────────────
  // Stamina and the Sleep Demon (every night)
  // ──────────────────────────────────────────
  /** Stamina drains through the shift — faster outside, and faster still
   *  while the player stares at the dust eyes — and the bedroom's coffee
   *  machine tops it up, a cup for each ripe bush picked (_addCoffee). The drain ticks on
   *  GameplaySystems after the controller, and before the demon and the
   *  fatigue effects, so within a frame both read this frame's stamina. */
  _addStamina() {
    this.stamina = new Stamina({ nightSeconds: this.nightClock.nightDuration });
    const machine = this.rooms.LivingQuarters.coffeeMachine;
    if (machine) {
      machine.stamina = this.stamina;
      machine.items = this.coffeeItems;
      // The machine at work while a cup brews, and its start click.
      machine.gameObject.addComponent(new CoffeeSound({ machine }));
      // A slurp as the cup is drunk (a quiet recording, so lifted).
      // onBrew and onBrewed are free hooks still.
      const sip = this._sound('sfx:slurp', 1.6);
      machine.onDrink = () => {
        if (!sip) return;
        if (sip.isPlaying) sip.stop();
        sip.play();
      };
    }
    // Dream crater death penalty: 60 % stamina instead of full.
    if (this.engine._dreamCraterDeath) {
      this.engine._dreamCraterDeath = false;
      this.stamina.value = 0.6;
    }
    this._sceneRoot.find('GameplaySystems').addComponent(new StaminaDrain({
      stamina:      this.stamina,
      controller:   this.gameController,
      hud:          this.hud,
      grid:         this.power,
      onNightStart: () => { this.coffee.newNight(); this.coffeeItems.reset(); machine?.reset(); },
      isOutside:    () => !!this.engine.camera && this._isOutside(this.engine.camera.getWorldPosition(_staminaEye)),
      isStaring:    () => !!this.dustEyes?.staredAt,
    }));
  }

  /** The night's coffee (#168): a CoffeeHarvest over the office rack's
   *  bushes, two ripe a night (a new one on each night start, from the
   *  stamina drain's), and the piles of beans and bags of ground coffee
   *  carried from the rack to the processor and on to the bedroom's coffee
   *  machine (CoffeeItems, as many of each as there are ripe bushes, built
   *  once and parked between uses). The goods are the office's, like its
   *  drives. Rooms don't know about gameplay, so it is wired here, and in
   *  _addStamina for the machine. */
  _addCoffee() {
    const office = this.rooms.MainOffice;
    const { coffeeBushes, beanProcessor } = office;
    const own = r => office._own(r);
    const make = (Kind, name) => Array.from({ length: COFFEE_HARVEST.ripePerNight }, (_, i) => {
      const item = new Kind(`${name}_${i + 1}`, { own });
      office.root.addChild(item);
      return item;
    });
    this.coffee = new CoffeeHarvest({ bushes: coffeeBushes?.bushes.length ?? 0 });
    this.coffeeItems = this._sceneRoot.find('GameplaySystems').addComponent(new CoffeeItems({
      beans: make(CoffeeBeans, 'CoffeeBeans'),
      bags: make(CoffeeBag, 'CoffeeBag'),
      pickup: this.pickupSystem,
      engine: this.engine,
    }));
    coffeeBushes?.bind(this.coffee, this.coffeeItems);
    beanProcessor?.bind(this.coffee, this.coffeeItems);
    // Their sounds: the grind while a pile is processed, and what each
    // machine takes in (the pile or bag is parked away with its own voice).
    beanProcessor?.gameObject.addComponent(new ProcessorSound({ harvest: this.coffee }));
    beanProcessor?.gameObject.addComponent(new ImpactSound(IMPACT_SOUNDS.beans));
    this._addCoffeeDock();
  }

  /** The bedroom coffee machine's top: a bag of ground coffee let go near
   *  it docks there (a SnapSocket, like the drive boxes' and the airlock's),
   *  seen and still able to be picked back off, until a cup is brewed from
   *  it. Near is within `COFFEE_DOCK_REACH` of the top: the table round it
   *  and the floor in front. The bag sounds its own seating. */
  _addCoffeeDock() {
    const machine = this.rooms.LivingQuarters.coffeeMachine;
    if (!machine) return;
    const dock = machine.gameObject.addComponent(new SnapSocket({
      slots: [{ offset: { y: COFFEE_MACHINE[1] / 2 + COFFEE_BAG.size[1] / 2 + 0.005 } }],
      snapDistance: COFFEE_DOCK_REACH,
      sounds: 'item',
      attachedPromptLabel: '[E] Pick up',
      canAccept: item => machine.accepts(item),
    }));
    for (const bag of this.coffeeItems.bags) dock.addCandidate(bag);
    machine.dock = dock;
  }

  /** The Sleep Demon, in the corner of the player's eye once they tire (see
   *  SleepDemon). Its figure is a placeholder under a Threats group on the
   *  scene root, which sits at the world origin: the demon writes world
   *  positions, and no occlusion zone ever hides it. It is a shadow in
   *  itself: a pitch-black shade no light shows, and it casts none — a solid
   *  shadow under a faint figure gave it away — so moving it never redraws
   *  the frozen shadow maps. */
  /** The screens that fill the view: the terminal's radar or review, the
   *  security monitor and the bedroom PC. Whichever is up is the state;
   *  'idle' while none is. Read every frame, so it allocates nothing. */
  _screens() {
    const screens = [this.terminal, this.cameraTerminal, this.rooms.LivingQuarters?.pc].filter(Boolean);
    const scene = this;
    return {
      /** Off whichever is up, at once: the Sleep Demon's kill. */
      exit() {
        scene._leaveScreens();
      },
      get state() {
        for (let i = 0; i < screens.length; i++) {
          if (screens[i].state !== 'idle') return screens[i].state;
        }
        return 'idle';
      },
    };
  }

  _addSleepDemon() {
    const { engine } = this;
    // Its body is the baked model (sleep-demon.glb); without it (a test's
    // stub asset manager) the placeholder capsule stands in.
    const model = engine.assets?.has?.('model:sleep-demon') ? engine.assets.get('model:sleep-demon').scene : null;
    const figure = createMonsterFigure({
      name: 'SleepDemon', ...SLEEP_DEMON_FIGURE, shade: true, castShadow: false, placeholderFor: 'sleep-demon.glb', model,
    });
    this._group('Threats').addChild(figure);
    this._ownResourcesOf(figure);
    this.sleepDemon = this._sceneRoot.find('GameplaySystems').addComponent(new SleepDemon({
      controller:      this.gameController,
      stamina:         this.stamina,
      figure,
      camera:          engine.camera ?? null,
      terminal:        this._screens(),
      rayHit:          sightRay(engine.world, engine.player?.rigidBody ?? null),
      isFrozen:        () => !!engine.debugCamera?.active,
      flashlight:      engine.player?.getComponent(Flashlight) ?? null,
      // Dead air: the room dies as the view comes round to it.
      ambience:        this.ambience,
      // Walking them down: the breath and the heart carry the dread.
      fatigue:         this.fatigueEffects,
      // Its death (falling asleep on it) takes these over, and gives them back.
      player:          engine.player?.getComponent(FirstPersonController) ?? null,
      overlay:         this._fatigueOverlay ??= new FatigueOverlay(),
      fade:            this.screenFade ?? null,
      listener:        engine.audioListener ?? null,
      // In bed its rules wait; through the half-open eyes of a nap it
      // watches, on the real clock, seen from inside the bunk's box.
      sleeper:         this.bedRest ?? null,
      realDt:          () => engine.realDt,
      napRayHit:       sightRay(engine.world, engine.player?.rigidBody ?? null,
        this.rooms.LivingQuarters.bed?.gameObject?.collider ?? null),
    }));
  }

  /** What low stamina does to the player: the tunnel and the eyelids, the
   *  lights stuttering ('dread' on the grid), the heartbeat and the yawns.
   *  Built before the demon, which tells it how hard the walk-down grips. */
  _addFatigue() {
    const { engine } = this;
    this.fatigueEffects = this._sceneRoot.find('GameplaySystems').addComponent(new FatigueEffects({
      stamina:    this.stamina,
      controller: this.gameController,
      overlay:    this._fatigueOverlay ??= new FatigueOverlay(),   // shared with the demon: one cache of what is shown
      grid:       this.power,
      isFrozen:   () => !!engine.debugCamera?.active,
      isResting:  () => !!this.bedRest?.active,
    }));
  }

  // ──────────────────────────────────────────
  // Getting into and out of the bunk (BedRest)
  // ──────────────────────────────────────────
  /** The view to the pillow and back, the lids, the peeks. Built before the
   *  fatigue effects and the demon, so within a frame the demon sees where
   *  it got to; it writes the lids last (its late update). The bunk, the nap
   *  and the demon are handed it. */
  _addBedRest() {
    const { engine } = this;
    const bed = this.rooms.LivingQuarters.bed;
    if (!bed) return;
    this.bedRest = this._sceneRoot.find('GameplaySystems').addComponent(new BedRest({
      engine,
      camera:          engine.camera ?? null,
      player:          engine.player?.getComponent(FirstPersonController) ?? null,
      interaction:     engine.player?.getComponent(InteractionSystem) ?? null,
      overlay:         this._fatigueOverlay ??= new FatigueOverlay(),
      bed,
      controller:      this.gameController,
      setPlayerLocked: locked => this._setPlayerLocked(locked),
      isFrozen:        () => !!engine.debugCamera?.active,
    }));
    bed.rest = this.bedRest;
  }

  // ──────────────────────────────────────────
  // The buggy send-off (BuggySendOff)
  // ──────────────────────────────────────────
  /** The cutscene that sends the buggy off each morning (#98): the lid
   *  shuts, the view rises to an eagle's eye, the buggy drives itself out
   *  through the gate and down the lane, the screen fades. Built after
   *  _addBedRest, on the GameplaySystems GO. Only when a gate exists. */
  _addBuggySendOff() {
    if (!this.exitGate || !this.buggyBoot) return;
    const { engine } = this;
    const buggy = this._outside.find('Buggy');
    if (!buggy) return;

    const points = this._buggyRoutePoints(buggy);
    const curve = routeCurve(points, (x, z) => terrainHeightAt(x, z) + 1.237);
    const length = curve.getLength();
    const gateAt = distanceAlong(curve, new THREE.Vector3(this.exitGate.at, 0, this.fence.rect.maxZ));

    this.buggySendOff = this._sceneRoot.find('GameplaySystems').addComponent(new BuggySendOff({
      engine,
      buggy,
      boot: this.buggyBoot,
      lidPivot: this.buggyLidPivot,
      socket: this.buggySocket,
      gate: this.fence.gate,
      controller: this.gameController,
      fade: this.screenFade,
      player: engine.player?.getComponent(FirstPersonController) ?? null,
      interaction: engine.player?.getComponent(InteractionSystem) ?? null,
      setPlayerLocked: locked => this._setPlayerLocked(locked),
      isFrozen: () => !!engine.debugCamera?.active,
      curve,
      length,
      gateAt,
    }));

    if (this.buggyCargo) this.buggyCargo.sendOff = this.buggySendOff;
    // The rover's hum as it drives off.
    this._sceneRoot.find('GameplaySystems').addComponent(new BuggySound({ sendOff: this.buggySendOff }));

    // It drives under the moon, so its shadow is redrawn as it goes.
    engine.shadows?.watch(buggy.object3d, [this.moonLight]);

    this._offBuggyNight = this.gameController.onNightStart(() => {
      this.buggySendOff.resetForNight();
    });
  }

  /** The buggy's way out, in world metres from its parking spot: straight
   *  at the gate, through it and down the lane (buggyRoute). The send-off
   *  drives it; the bedroom PC's map draws it. Empty with no gate. */
  _buggyRoutePoints(buggy = this._outside?.find('Buggy')) {
    if (!this.exitGate || !buggy) return [];
    const startYaw = buggy.object3d.rotation.y;
    const forward = { x: Math.sin(startYaw), z: Math.cos(startYaw) };
    return buggyRoute({
      start: { x: buggy.object3d.position.x, z: buggy.object3d.position.z },
      forward,
      gate: this.exitGate,
      rect: this.fence.rect,
    });
  }

  // ──────────────────────────────────────────
  // The bedroom PC (#114)
  // ──────────────────────────────────────────
  /** The computer on the bedroom desk: the room put it there, this hands
   *  it the night, its panel (#bedroom-pc), the run record (last night's
   *  threats), the forecast and the colony map — the six neighbours where
   *  the radar has them, and the buggy's route out toward the hub. */
  _addBedroomPC() {
    const pc = this.rooms.LivingQuarters?.pc;
    if (!pc) return;
    pc.controller = this.gameController;
    pc.panel = new BedroomPCPanel();
    pc.run = this.engine.run;
    pc.forecast = threatForecast;
    pc.map = colonyMap({
      neighbours: this.satellite?.neighbours ?? [],
      route: this._buggyRoutePoints(),
    });

    // On its own monitor (#161): the panel is what the screen shows, leaned
    // in to or not, as for the office's screens (_addScreenPictures).
    const quarters = this.rooms.LivingQuarters;
    const surface = quarters.pcScreen;
    const gameplay = this._sceneRoot.find('GameplaySystems');
    if (!surface || !gameplay) return;
    const [tl, tr, , bl] = surface.local;
    const layout = [Math.round(SCREEN_LAYOUT_HEIGHT * tl.distanceTo(tr) / tl.distanceTo(bl)), SCREEN_LAYOUT_HEIGHT];
    this._hostOnScreen(pc.panel.root, layout);
    pc.screenView = this.screenView ?? null;
    pc.screen = surface;
    this.pcPicture = new ScreenCanvas({
      surface, layout, lift: 0.002, corner: 0.014,   // the laptop screen's rounded corners
      painter: (ctx, w, h) => pc.paintScreen(ctx, w, h),
      seen: () => this._screenSeen(surface, quarters),
      focused: () => !!this.screenView?.holds(surface),
    });
    gameplay.addComponent(this.pcPicture);
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
    // The beam through the glass lights up every smudge on it.
    office.windowGlass?.addLight(flood, WINDOW_FLOOD.glass);

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
    this.evilSignal.whiteOut = this.whiteOut;
    this.evilSignal.hooks = {
      setPlayerLocked: locked => this._setPlayerLocked(locked),
      // A due appearance waits out the UFO's visit and a nap (both built
      // after this, so read when asked).
      busy: () => {
        const phase = this.ufoThreat?.phase;
        return (!!phase && phase !== 'waiting' && phase !== 'gone') || !!this.nap?.napping;
      },
    };
    this.evilSignal.deleteWarning = new DeleteWarning();
    this._redOut = new RedOut();
    this._pipeline = new PostPipeline();
    this._pipeline.attach(this.engine);
    this._pipeline.add('redOut', this._redOut);
    // The helmet's warp bends the finished frame, so it is a screen pass,
    // not a pipeline one: the scene under the glass is drawn as it always is.
    this._visorRefraction ??= new VisorRefraction();
    const { renderer, screenPasses } = this.engine;
    if (renderer && screenPasses) {
      this._visorRefraction.attach(renderer);
      screenPasses.push(this._visorRefraction);
    }
    this.engine.postProcess = this._pipeline;
    this.evilSignal.redOut = this._redOut;
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
      startHour:     this.nightClock.startHour,
    });
    this._sceneRoot.find('GameplaySystems').addComponent(this.ufoThreat);
  }

  /** No room or corridor takes fog. The scene's fog is one fog — the office
   *  window has to show the valley, and the storm swallowing it — and at a
   *  storm's density it filled the rooms themselves with brown haze (a wall
   *  10 m off a third dust). Their own surfaces opt out instead; everything
   *  seen through the glass keeps it. On a clear night that fog is ~0.05 %
   *  at 10 m, so indoors nothing changes. A material shared with anything
   *  outside the building is copied for it first, so nothing else loses its
   *  fog. Built before the power grid collects the lamps' materials, so the
   *  grid holds the copies. */
  _keepFogOutside() {
    const parts = [...Object.values(this.rooms), ...Object.values(this.corridors)].filter(Boolean);
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
      // …and the wind: the storm has no recording of its own. It blows the
      // ambience's wind harder, and lets a hiss of it into the rooms.
      ambience: this.ambience,
      // The moons are lost in the dust, and their light with them.
      moon:     this.moonLight,
      ambient:  this.ambientLight,
      hooks: {
        // The grit is wrapped round the eye the frame is drawn from — a
        // security camera's, on the monitor (Engine.renderCamera).
        listenerPosition: out => (engine.renderCamera ?? engine.camera).getWorldPosition(out),
      },
      nightDuration: this.nightClock.nightDuration,
      nightHours:    this.nightClock.endHour - this.nightClock.startHour,
      startHour:     this.nightClock.startHour,
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

  // ──────────────────────────────────────────
  // Ragno (the camera entity) and its vents
  // ──────────────────────────────────────────
  /** The slope Ragno climbs, as RagnoPaths wants it: the bunker's batter
   *  and shoulder, and its height (the rooms' roof). */
  _ragnoSlope() {
    return { batter: BUNKER.batter, shoulder: BUNKER.shoulder, height: this.rooms.MainOffice.bounds().max.y };
  }

  /** One air vent per wing, on its end wall: a duct hood on the slope
   *  outside, a grille on the wall inside. Ragno goes in at one and comes
   *  out of the other. The hood hangs on the bunker (always drawn: the end
   *  walls are seen only by cameras); the grille is a room furnishing. */
  _addVents() {
    const V = RAGNO_VENTS;
    const slope = this._ragnoSlope();
    this.vents = {};
    for (const [name, sign] of [['LivingQuarters', -1], ['ServerRoom', 1]]) {
      const room = this.rooms[name];
      const b = room.bounds();
      const endX = sign < 0 ? b.min.x : b.max.x;
      const z = room.position[2] + V.z[name];
      const y = room.position[1] + V.y;
      // Outside: its back against the slope at its top edge, its face out
      // past the slope at its foot.
      const top = slopeOut(slope, y + V.height / 2), foot = slopeOut(slope, y - V.height / 2);
      const depth = foot - top + V.hoodOut;
      const hood = createVentHood({ width: V.width, height: V.height, depth, name: `VentHood_${name}` });
      hood.object3d.position.set(endX + sign * top, y, z);
      hood.object3d.rotation.y = sign * Math.PI / 2;
      (this.bunker ?? this._sceneRoot).addChild(hood);
      for (const r of hood.resources) this._own(r);
      // Inside: on the wall's inner face, facing into the room.
      const inner = endX - sign * room.wallThick;
      const grille = createVentGrille({ width: V.width, height: V.height });
      grille.object3d.position.set(inner - sign * 0.03 - room.position[0], y - room.position[1], z - room.position[2]);
      grille.object3d.rotation.y = -sign * Math.PI / 2;
      room.root.addChild(grille);
      for (const r of grille.resources) this._own(r);
      this.vents[sign] = {
        room: name,
        /** Where he goes in outside: the hood's mouth. */
        intake: new THREE.Vector3(endX + sign * (top + depth), y, z),
        /** Where he comes out inside: the grille. */
        grille: new THREE.Vector3(inner - sign * 0.05, y, z),
        /** Just under the hood: the top of his climb. */
        climbTop: y - V.height / 2 - 0.1,
        endX, inner, z,
      };
    }
  }

  /** Everything RagnoLogic and the Ragno component need, read off the rooms,
   *  the fence, the window and the vents. */
  _ragnoLayout() {
    const { rooms } = this;
    const office = rooms.MainOffice;
    const slope = this._ragnoSlope();
    const [ox, oy, oz] = office.position;
    const eye = { x: ox + DESK_EYE[0], y: oy + DESK_EYE[1], z: oz + DESK_EYE[2] };
    const win = this._officeWindow();
    // He comes in at the treeline or beyond, and creeps inside the trees.
    const trees = this._sceneRoot.find('Outside')?.find('MarsVegetation')?.trees ?? [];
    const paths = { window: win, eye, slope, fence: this.fence.rect, ground: (x, z) => terrainHeightAt(x, z), trees };

    // Inside: the rooms as a graph of standing spots. Door nodes sit in the
    // doorways, where he goes thin.
    const o = office.bounds();
    const nodes = [{ id: 'oC', x: ox, z: oz + 0.8 }];
    const edges = [];
    // Round the desk, so a player hiding behind it is reached the long way,
    // not dithered at from the front: its front corners, its back corners
    // and behind its middle, `RAGNO_DESK_GAP` m off it.
    const desk = deskStation();
    const g = RAGNO_DESK_GAP;
    const behind = (desk.minZ + o.min.z + office.wallThick) / 2;   // between the desk and the window wall
    nodes.push(
      { id: 'oFL', x: ox + desk.minX - g, z: oz + desk.maxZ + g },
      { id: 'oFR', x: ox + desk.maxX + g, z: oz + desk.maxZ + g },
      { id: 'oBL', x: ox + desk.minX - g, z: behind },
      { id: 'oBR', x: ox + desk.maxX + g, z: behind },
      { id: 'oB', x: ox, z: behind },
    );
    edges.push(['oC', 'oFL'], ['oC', 'oFR'], ['oFL', 'oBL'], ['oFR', 'oBR'], ['oBL', 'oB'], ['oBR', 'oB']);
    const sides = {};
    const slopes = {};
    for (const [tag, sign, roomName, corridorName] of [['q', -1, 'LivingQuarters', 'OfficeToQuarters'], ['s', 1, 'ServerRoom', 'OfficeToServer']]) {
      const room = rooms[roomName];
      const vent = this.vents[sign];
      const b = room.bounds();
      const doorZ = this._doorZ[sign < 0 ? 'left' : 'right'];
      const roomDoorX = sign < 0 ? b.max.x : b.min.x;           // its wall toward the office
      const officeDoorX = sign < 0 ? o.min.x : o.max.x;
      const [wx, wz] = RAGNO_WATCH[roomName];
      const landing = { x: vent.inner - sign * RAGNO_VENTS.landing, z: vent.z };
      nodes.push(
        { id: `${tag}L`, ...landing },
        { id: `${tag}W`, x: room.position[0] + wx, z: room.position[2] + wz },
        { id: `${tag}I`, x: roomDoorX + sign * 1.2, z: doorZ },
        { id: `${tag}D`, x: roomDoorX, z: doorZ, door: true },
        { id: `${tag}C`, x: (roomDoorX + officeDoorX) / 2, z: doorZ },
        { id: `${tag}O`, x: officeDoorX, z: doorZ, door: true },
        { id: `${tag}N`, x: officeDoorX - sign * 1.2, z: doorZ },
      );
      edges.push([`${tag}I`, `${tag}D`], [`${tag}D`, `${tag}C`], [`${tag}C`, `${tag}O`], [`${tag}O`, `${tag}N`], [`${tag}N`, 'oC']);
      const via = RAGNO_VIA[roomName];
      if (via) {
        nodes.push({ id: `${tag}A`, x: room.position[0] + via[0], z: room.position[2] + via[1] });
        edges.push([`${tag}L`, `${tag}A`], [`${tag}A`, `${tag}W`], [`${tag}A`, `${tag}I`]);
      } else {
        edges.push([`${tag}L`, `${tag}W`], [`${tag}L`, `${tag}I`], [`${tag}W`, `${tag}I`]);
      }

      const side = { sign, endX: vent.endX, back: b.min.z, front: b.max.z, vent: { z: vent.z, y: vent.climbTop } };
      sides[sign] = {
        ...side,
        approach: { window: approachRoute('window', side, paths), yard: approachRoute('yard', side, paths) },
        creep: {
          window: approachRoute('window', side, paths, { inside: true }),
          yard: approachRoute('yard', side, paths, { inside: true }),
        },
        climb: climbRoute(side, paths),
        // Out of the grille, head first down the wall, onto the floor.
        descent: [
          { x: vent.grille.x, y: vent.grille.y - 0.3, z: vent.z, up: [-sign, 0, 0] },
          { x: vent.grille.x, y: 0.7, z: vent.z, up: [-sign, 0, 0] },
          { x: landing.x, y: 0, z: landing.z, up: [0, 1, 0] },
        ],
        landing: `${tag}L`, stare: `${tag}W`,
        door: { x: roomDoorX, z: doorZ },
        room: roomName, corridor: corridorName,
      };

      // The slope his feet find outside (Ragno._cast), as a plane.
      const len = Math.hypot(slope.height, slope.batter - slope.shoulder);
      const normal = { x: sign * slope.height / len, y: (slope.batter - slope.shoulder) / len, z: 0 };
      const toeX = vent.endX + sign * slope.batter;
      slopes[sign] = { normal, c: normal.x * toeX, x0: vent.endX, x1: toeX, z0: b.min.z, z1: b.max.z };
    }

    const frontDoor = office.openings.find(op => op.side === 'front');
    // Each corridor's floor between its walls' inner faces: he is thin all
    // along one, and kept off its walls (RagnoLogic._keepOffWalls).
    const corridors = Object.values(this.corridors).map((c) => {
      const b = c.bounds();
      const t = c.wallThick ?? office.wallThick;
      return c.axis === 'x'
        ? { minX: b.min.x, maxX: b.max.x, minZ: b.min.z + t, maxZ: b.max.z - t, axis: 'x' }
        : { minX: b.min.x + t, maxX: b.max.x - t, minZ: b.min.z, maxZ: b.max.z, axis: 'z' };
    });
    return {
      sides,
      corridors,
      graph: new NavGraph(nodes, edges),
      airlockDoor: { x: ox + frontDoor.offset, z: o.max.z },
      window: win,
      vents: this.vents,
      occluders: this._yardView().occluders,
      slopes,
    };
  }

  /** Which room or corridor a point is in, by whole shells; 'outside' for
   *  none. Rooms first, so a doorway counts as the room. */
  _zoneOf(p) {
    this._zoneBoxes ??= [...Object.values(this.rooms), ...Object.values(this.corridors)].map(part => [part.name, part.bounds()]);
    for (const [name, box] of this._zoneBoxes) if (box.containsPoint(p)) return name;
    return 'outside';
  }

  /** The night's threat log for the bedroom PC (ThreatWatch): each kind
   *  noted as it first shows, put on the run record as the shift ends. One
   *  source a kind, as ThreatForecast names them, each reading the system
   *  live. After every threat it reads; nothing allocated per frame. */
  _addThreatWatch() {
    const eyesOut = () => {
      for (const slot of this.dustEyes?.slots ?? []) if (slot.phase !== 'off') return true;
      return false;
    };
    const ufoHere = () => {
      const phase = this.ufoThreat?.phase;
      return phase === 'approaching' || phase === 'expanding' || phase === 'lethal' || phase === 'caught';
    };
    const corrupt = () => {
      for (const s of this.signalManager?.signals ?? []) if (s.evil && s.appeared) return true;
      return false;
    };
    this.threatWatch = this._sceneRoot.find('GameplaySystems').addComponent(new ThreatWatch());
    Object.assign(this.threatWatch, {
      controller: this.gameController,
      clock:      this.nightClock,
      run:        this.engine.run,
      sources: {
        storm:   () => (this.sandstorm?.level ?? 0) > 0.5,
        outage:  () => !!this.stormOutage?.flickering,
        eyes:    eyesOut,
        prowler: () => { const l = this.ragno?.logic; return !!l && l.state !== 'off' && !l.indoors; },
        vents:   () => !!this.ragno?.logic?.indoors,
        aerial:  ufoHere,
        corrupt,
      },
    });
  }

  /** Ragno, the camera entity (Ragno.js): his figure under Threats on the
   *  scene root, built hidden so its shaders compile behind the loading
   *  screen, and the component that runs him on GameplaySystems. After the
   *  UFO (never during its visit) and before the nap (which he wakes). */
  _addRagno() {
    const { engine } = this;
    const loaded = !!engine.assets?.has?.('model:ragno');
    const figure = new RagnoFigure({
      model: loaded ? engine.assets.instantiate('model:ragno') : null,
      animations: loaded ? engine.assets.getAnimations?.('model:ragno') ?? [] : [],
      warm: loaded ? engine.assets.instantiate('model:ragno') : null,
    });
    (this._sceneRoot.find('Threats') ?? this._group('Threats')).addChild(figure);
    this.ragnoFigure = figure;
    this.ragnoLayout = this._ragnoLayout();
    const ufoBusy = () => {
      const phase = this.ufoThreat?.phase;
      return !!phase && phase !== 'waiting' && phase !== 'gone';
    };
    this.ragno = this._sceneRoot.find('GameplaySystems').addComponent(new Ragno({
      controller: this.gameController,
      clock:      this.nightClock,
      layout:     this.ragnoLayout,
      figure,
      terminal:   this.cameraTerminal ?? null,
      cameras:    this.securityCameras ?? [],
      flashlight: engine.player?.getComponent(Flashlight) ?? null,
      power:      this.power,
      camera:     engine.camera ?? null,
      whiteOut:   this.whiteOut ?? null,
      // His kill drains the view to red, as the evil signal's does.
      redOut:     this._redOut ?? null,
      ambience:   this.ambience ?? null,
      hooks: {
        zoneOf:          p => this._zoneOf(p),
        ufoBusy,
        setPlayerLocked: locked => this._setPlayerLocked(locked),
        leaveScreens:    () => this._leaveScreens(),
        isFrozen:        () => !!engine.debugCamera?.active,
        rayHit:          ragnoRay(engine.world, engine.player?.rigidBody ?? null),
      },
    }));
  }

  /** Naps at the bunk: the night fast-forwarded until 6 AM, until the
   *  player presses E, or until something loud enough to wake a sleeper —
   *  the lamps buzzing before a storm outage, the UFO's roar. Silent things
   *  (the power simply going, the radar blob, eyes at the window) don't.
   *  No nap with the UFO on its way. Getting into and out of the bunk is
   *  the bed animation (BedRest): the night speeds up only once the eyes
   *  are shut. Added last, so it reads every threat after it has moved this
   *  frame. */
  _addNap() {
    const ufoBusy = () => {
      const phase = this.ufoThreat?.phase;
      return !!phase && phase !== 'waiting' && phase !== 'gone';
    };
    this.nap = new Nap({
      controller: this.gameController,
      engine:     this.engine,
      rest:       this.bedRest ?? null,
      banner:     this.banner,
      // Over the closed lids (#nap-hint): the HUD is under them.
      hint:       new PromptLabel(typeof document !== 'undefined' ? document.getElementById('nap-hint') : null),
      stamina:    this.stamina,
      hooks: {
        setPlayerLocked: locked => this._setPlayerLocked(locked),
        restless:        ufoBusy,
        watched:         () => !!this.sleepDemon?.watchingSleeper,
      },
      alarms: [
        { test: () => !!this.stormOutage?.flickering, message: 'The lamps\' buzzing woke you — the power is failing.', tone: 'warning' },
        { test: () => !!this.ufoThreat?.audible,      message: 'A roar overhead woke you.',                              tone: 'warning' },
        { test: () => !!this.ragno?.hunting,          message: 'Something skittering in the corridor woke you.' },
      ],
    });
    this._sceneRoot.find('GameplaySystems').addComponent(this.nap);
    const { bed } = this.rooms.LivingQuarters;
    if (bed) bed.nap = this.nap;
  }

  /** Night 0, the tutorial (Tutorial): its steps on the live scene, with
   *  big words and an arrow (#tutorial). Added after the nap, last on
   *  GameplaySystems, so it reads everything after it has moved this frame.
   *  Off on every other night. */
  _addTutorial() {
    const office = this.rooms.MainOffice;
    const airlock = this.rooms.Airlock;
    const server = this.rooms.ServerRoom;
    const boxes = office.driveBoxes ?? [];
    const eye = new THREE.Vector3();
    const at = new THREE.Vector3();
    // The drive box nearest the player, for "pick up a box"; with
    // `withRoom`, the nearest with a free slot, for "put it in a box" (the
    // shelf's boxes start full, so the one the drive came out of).
    const nearestBox = (withRoom = false) => {
      if (!boxes.length || !this.engine.camera) return null;
      this.engine.camera.getWorldPosition(eye);
      let best = null;
      let bestDist = Infinity;
      for (const box of boxes) {
        if (withRoom && !box.receiver.attachments.includes(null)) continue;
        const d = box.object3d.getWorldPosition(at).distanceToSquared(eye);
        if (d < bestDist) { bestDist = d; best = box.object3d; }
      }
      return best;
    };
    const bed = this.rooms.LivingQuarters.bed;
    // The coffee lesson's arrows: the ripe bush nearest the player, and a
    // bag once one is out (the processor that makes it until then).
    const bushes = office.coffeeBushes;
    const processorObject = office.beanProcessor?.gameObject.object3d ?? null;
    const bushMark = new THREE.Object3D();
    const ripeBush = () => {
      if (!bushes || !this.coffee || !this.engine.camera) return null;
      this.engine.camera.getWorldPosition(eye);
      const rack = bushes.gameObject.object3d;
      let best = null;
      let bestDist = Infinity;
      this.coffee.bushes.forEach((state, i) => {
        if (state !== 'ripe') return;
        rack.localToWorld(at.copy(bushes.bushes[i]));
        const d = at.distanceToSquared(eye);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      if (best === null) return null;
      rack.localToWorld(bushMark.position.copy(bushes.bushes[best]));
      bushMark.updateMatrixWorld(true);
      return bushMark;
    };
    const bagOut = () => this.coffeeItems?.loose('bag')[0]?.object3d ?? processorObject;
    this.tutorial = new Tutorial({
      controller:    this.gameController,
      clock:         this.nightClock,
      stamina:       this.stamina ?? null,
      signalManager: this.signalManager,
      terminal:      this.terminal,
      driveManager:  this.driveManager,
      drives:        office.drives ?? [],
      driveBoxes:    boxes,
      quotaDock:     airlock.quotaDock ?? null,
      serverSlot:    server?.driveSlot ?? null,
      processingScreen: this.processingScreen ?? null,
      grid:          this.power ?? null,
      suit:          this.suit ?? null,
      nap:           this.nap ?? null,
      bedRest:       this.bedRest ?? null,
      cargoDock:     this.buggyCargo?.dock ?? null,
      sendOff:       this.buggySendOff ?? null,
      sandstorm:     this.sandstorm ?? null,
      stormOutage:   this.stormOutage ?? null,
      bed,
      flashlight:    this.engine.player?.getComponent(Flashlight) ?? null,
      onDesk:        (p) => office.isOnDesk(p),
      coffee:        { harvest: this.coffee, items: this.coffeeItems, machine: this.rooms.LivingQuarters.coffeeMachine },
      overlay:       new TutorialOverlay(undefined, {
        keyLabel: (text) => tutorialKeys(text, this.engine.keyBinds ?? {}),
      }),
      camera:        this.engine.camera ?? null,
      // The breaker panel has the mouse (_usePanel): it covers the words.
      // (So does the processing console, but the tutorial shows over it.)
      covered:       () => !!this.engine.uiHasMouse,
      targets: {
        reader:    { object: office.driveReader?.object3d ?? null, lift: 0.05 },
        computer:  { object: office.root.find('ComputerDesk')?.object3d ?? null, lift: 1.05 },
        box:       { object: () => nearestBox(), lift: 0.1 },
        openBox:   { object: () => nearestBox(true) ?? nearestBox(), lift: 0.1 },
        desk:      { object: office.boxSpot ?? null, lift: 0.1 },
        dock:      { object: airlock.quotaDockGO?.object3d ?? null, lift: 0.3 },
        serverReader:  { object: server?.driveSlot?.gameObject?.object3d ?? null, lift: 0.05 },
        serverConsole: { object: server?.root.find('ServerConsole')?.object3d ?? null, lift: 0.6 },
        locker:    { object: airlock.root.find('SuitLocker')?.object3d ?? null, lift: 1.2 },
        generator: { object: this.generator?.object3d ?? null, lift: 1.2 },
        bed:       { object: bed?.gameObject?.object3d ?? null, lift: 0.6 },
        buggy:     { object: this.buggyBoot?.object3d ?? null, lift: 0.6 },
        bush:      { object: ripeBush, lift: 0.1 },
        processor: { object: processorObject, lift: 0.5 },
        bag:       { object: bagOut, lift: 0.15 },
        coffee:    { object: this.rooms.LivingQuarters.coffeeMachine?.gameObject.object3d ?? null, lift: 0.35 },
      },
    });
    this._sceneRoot.find('GameplaySystems').addComponent(this.tutorial);
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
    // The bunker's slopes either side of it are as solid: out to their toe.
    const airlock = this.rooms.Airlock;
    if (airlock?.hatch) {
      const shell = airlock.bounds();
      const slope = this.bunker ? BUNKER.batter : 0;
      const hatch = airlock.hatch.object3d.getWorldPosition(new THREE.Vector3());
      boxes.push({
        minX: shell.min.x - slope, maxX: shell.max.x + slope, minZ: shell.min.z, maxZ: shell.max.z,
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
  /** Another room's things drawn only where a doorway shows them
   *  (PortalCulling, #175): the rooms and corridors are its nodes, their
   *  doors its portals. The console's `portals` switches it off to compare. */
  _buildPortalCulling() {
    const parts = [...Object.values(this.rooms), ...Object.values(this.corridors)];
    const nodes = parts.map(part => ({ name: part.name, box: part.bounds() }));
    const portals = parts.flatMap(part => part.doors).map(door => doorPortal(door.object3d, door.doorSize, nodes));
    this.portalCulling = new PortalCulling({ nodes, portals, roots: parts.map(part => part.root.object3d) });
    this.engine.renderCullers?.push(this.portalCulling);
  }

  /** Every drive's casing in one draw call and every LED in another
   *  (DriveInstancer, #175), updated by the engine before the main view.
   *  Run once now, so the warm-up draws them as they will be. */
  _addDriveInstancer() {
    this.driveInstancer = new DriveInstancer({ root: this._sceneRoot.object3d });
    this.engine.beforeRender?.push(this.driveInstancer);
    this._sceneRoot.object3d.updateMatrixWorld(true);
    this.driveInstancer.update();
  }

  _buildOcclusion() {
    const { engine } = this;
    const zones = new OcclusionZones({ renderer: engine.renderer, scene: engine.scene, camera: engine.camera });

    const interiorParts = [
      this.rooms.MainOffice, this.rooms.ServerRoom, this.rooms.LivingQuarters,
      ...Object.values(this.corridors),
    ];
    // What the player can pick up goes where they go — out through the
    // airlock to the dock, or into the yard — and stays a child of the room
    // it was built in. A zone hiding it would hide it in their hands.
    const carried = new Set();
    for (const part of interiorParts) {
      for (const go of part.root.descendants()) if (go.getComponent?.(Pickupable)) carried.add(go.object3d);
    }
    const isFixed = o => o.userData.isDoor || carried.has(o)
      || /^(Floor|Ceiling|(Back|Front|Left|Right)Wall)/.test(o.name);
    for (const part of interiorParts) {
      for (const door of part.doors) door.object3d.userData.isDoor = true;
      zones.add('interior', collectHideable(part.root.object3d, isFixed));
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
    const sorted = { yard: [], interior: [], unseen: [], geometries: [] };
    for (const child of [...this._outside.object3d.children]) {
      if (child.name === 'MarsTerrain') continue;   // the ground under everything
      sortOutdoors(child, view, sorted);
    }
    // A split part with something per instance has a geometry of its own.
    for (const geometry of sorted.geometries) this._own(geometry);
    zones.add('yard', sorted.yard);
    zones.add('interior', sorted.interior);
    zones.add('unseen', sorted.unseen);
    zones.hide('unseen');
    this.zones = zones;
    // The yard cameras' picture draws the yard for itself alone (FeedDisplay).
    if (this.feedDisplay) this.feedDisplay.zones = zones;

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
   * a value read straight from the level editor: easier to trust than
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

  /**
   * The buggy's boot (#98): a hollow steel box on the buggy's rear (-z end),
   * where the night's drive box is set down in the morning before the buggy
   * is sent off. A child of the Buggy GO, so it rides along during the
   * cutscene. The boot's own scale (1/buggy's scale) makes its units metres.
   *
   * Visuals: floor + 4 walls (dark steel), a mount plate reaching forward
   * into the body so there's no visible gap, and a lid on a pivot at the
   * buggy-side top edge that swings open for loading and shuts for departure.
   *
   * Physics: its own fixed rigid body with cuboid colliders for the floor
   * and 4 walls, open top so the interaction ray reaches the seated box.
   *
   * Components: BuggyCargo (labels, canSend, onInteract), SnapSocket (one
   * slot at the floor top + 0.06 m), DriveBoxDock (counts the drives).
   *
   * A delegate Interactable on the Buggy GO copies the cargo's prompt label
   * and forwards onInteract, so looking at the buggy's body offers
   * '[E] Send the buggy off'.
   */
  _addBuggyCargo(buggy) {
    const { engine } = this;
    const [across, height, depth] = BUGGY_CARGO.size;
    const { top, gap, wall, lidOpen, mount } = BUGGY_CARGO;
    const s = buggy.object3d.scale.x;

    // Measure the buggy's own-frame bounds (local unscaled space).
    const localBounds = this._measureLocalBounds(buggy.object3d);
    if (!localBounds) {
      // Fallback for tests with no model: a plain crate beside the buggy.
      return this._addBuggyCargoFallback(buggy);
    }

    // The boot is a child of the buggy, at the rear (-z end).
    const boot = new GameObject('BuggyBoot');
    boot.object3d.scale.setScalar(1 / s);
    const localZ = localBounds.min.z - (gap + depth / 2) / s;
    const localY = (top - height / 2 - buggy.object3d.position.y) / s;
    boot.object3d.position.set(0, localY, localZ);
    // addChild, not object3d.add: the boot's components (the socket, the
    // dock, the cargo's labels) only tick as part of the GameObject tree.
    buggy.addChild(boot);

    // Visuals: dark steel.
    const steelMat = this._own(new THREE.MeshStandardMaterial({ color: 0x2a2d2a, roughness: 0.7, metalness: 0.5 }));

    // Floor.
    const floor = new THREE.Mesh(this._own(new THREE.BoxGeometry(across, wall, depth)), steelMat);
    floor.name = 'BootFloor';
    floor.position.y = -height / 2 + wall / 2;
    floor.castShadow = floor.receiveShadow = true;
    boot.object3d.add(floor);

    // 4 walls.
    const wallH = height - wall;
    const wallY = wall / 2;
    const walls = [
      { name: 'BootWallBack', size: [across, wallH, wall], pos: [0, wallY, -depth / 2 + wall / 2] },
      { name: 'BootWallFront', size: [across, wallH, wall], pos: [0, wallY, depth / 2 - wall / 2] },
      { name: 'BootWallLeft', size: [wall, wallH, depth - 2 * wall], pos: [-across / 2 + wall / 2, wallY, 0] },
      { name: 'BootWallRight', size: [wall, wallH, depth - 2 * wall], pos: [across / 2 - wall / 2, wallY, 0] },
    ];
    for (const w of walls) {
      const mesh = new THREE.Mesh(this._own(new THREE.BoxGeometry(...w.size)), steelMat);
      mesh.name = w.name;
      mesh.position.set(...w.pos);
      mesh.castShadow = mesh.receiveShadow = true;
      boot.object3d.add(mesh);
    }

    // Mount plate: reaches forward into the body so there's no visible gap.
    const mountPlate = new THREE.Mesh(
      this._own(new THREE.BoxGeometry(across, height, mount)),
      this._own(new THREE.MeshStandardMaterial({ color: 0x1e201e, roughness: 0.8, metalness: 0.4 })),
    );
    mountPlate.name = 'BootMount';
    mountPlate.position.set(0, 0, depth / 2 + mount / 2);
    mountPlate.castShadow = mountPlate.receiveShadow = true;
    boot.object3d.add(mountPlate);

    // Lid: a pivot group on the buggy-side top edge, the lid mesh extending
    // toward -z. rotation.x = lidOpen * lid raises the far edge.
    const lidPivot = new THREE.Group();
    lidPivot.name = 'BootLidPivot';
    lidPivot.position.set(0, height / 2, depth / 2);
    boot.object3d.add(lidPivot);
    const lidMesh = new THREE.Mesh(
      this._own(new THREE.BoxGeometry(across, wall, depth)),
      this._own(new THREE.MeshStandardMaterial({ color: 0x2f3230, roughness: 0.7, metalness: 0.4 })),
    );
    lidMesh.name = 'BootLid';
    lidMesh.position.set(0, wall / 2, -depth / 2);
    lidMesh.castShadow = lidMesh.receiveShadow = true;
    lidPivot.add(lidMesh);

    // Physics: own fixed rigid body at the boot's world pose.
    boot.object3d.updateMatrixWorld(true);
    const bootWorldPos = new THREE.Vector3();
    const bootWorldQuat = new THREE.Quaternion();
    boot.object3d.getWorldPosition(bootWorldPos);
    boot.object3d.getWorldQuaternion(bootWorldQuat);
    const { world } = engine;
    boot.rigidBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(bootWorldPos.x, bootWorldPos.y, bootWorldPos.z)
        .setRotation({ x: bootWorldQuat.x, y: bootWorldQuat.y, z: bootWorldQuat.z, w: bootWorldQuat.w }),
    );
    // Cuboid colliders for the floor and the four walls, open top. A
    // collider's offset is relative to its body, which already stands at the
    // boot's world pose, and the boot's world scale is 1: so these are the
    // meshes' own boot-local metres, unrotated.
    const bootColliders = [
      { size: [across, wall, depth], pos: [0, floor.position.y, 0] },
      ...walls,
    ].map(({ size: [sx, sy, sz], pos: [px, py, pz] }) => world.createCollider(
      RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(px, py, pz),
      boot.rigidBody,
    ));
    boot.collider = bootColliders[0];
    boot.colliders = bootColliders;
    engine._bodyToGO?.set(boot.rigidBody.handle, boot);

    // Components.
    const cargo = boot.addComponent(new BuggyCargo());
    // Snap slot: y = floor top + 0.06 in boot-local metres.
    const slotY = -height / 2 + wall + 0.06;
    const socket = boot.addComponent(new SnapSocket({
      snapDistance: 0.5,
      slots: [{ offset: { x: 0, y: slotY, z: 0 } }],
      attachedPromptLabel: '[E] Take drive box',
      sounds: 'item',
      canAccept: item => cargo.accepts(item),
    }));
    cargo.dock = boot.addComponent(new DriveBoxDock({ socket }));

    // Store references for the send-off.
    this.buggyBoot = boot;
    this.buggyLidPivot = lidPivot;
    this.buggySocket = socket;

    // Delegate Interactable on the Buggy GO: looks at the cargo's prompt.
    const delegate = buggy.addComponent(new class extends Interactable {
      promptLabel = '';
      onUpdate() { this.promptLabel = cargo.promptLabel; }
      onInteract(hit) { cargo.onInteract(hit); }
    }());
    this.buggyInteractable = delegate;

    return cargo;
  }

  /** Measure an Object3D's bounds in its own local (unscaled) space. */
  _measureLocalBounds(object3d) {
    const inv = object3d.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    let found = false;
    object3d.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      o.geometry.computeBoundingBox();
      if (!o.geometry.boundingBox) return;
      // Transform the 8 corners of the geometry's bounding box to world
      // space, then back into the buggy's local space.
      const bb = o.geometry.boundingBox;
      const corners = [
        new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z),
        new THREE.Vector3(bb.min.x, bb.min.y, bb.max.z),
        new THREE.Vector3(bb.min.x, bb.max.y, bb.min.z),
        new THREE.Vector3(bb.min.x, bb.max.y, bb.max.z),
        new THREE.Vector3(bb.max.x, bb.min.y, bb.min.z),
        new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z),
        new THREE.Vector3(bb.max.x, bb.max.y, bb.min.z),
        new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z),
      ];
      for (const c of corners) {
        c.applyMatrix4(o.matrixWorld);
        c.applyMatrix4(inv);
        box.expandByPoint(c);
        found = true;
      }
    });
    return found ? box : null;
  }

  /** Fallback for tests with no buggy model: a plain crate beside it. */
  _addBuggyCargoFallback(buggy) {
    const [w, h, d] = BUGGY_CARGO.size;
    const at = buggy.object3d.position;
    const go = new GameObject('BuggyBoot');
    go.object3d.position.set(at.x + BUGGY_HALF_LENGTH + BUGGY_CARGO.gap + w / 2, h / 2, at.z);
    const crate = new THREE.Mesh(
      this._own(new THREE.BoxGeometry(w, h, d)),
      this._own(new THREE.MeshStandardMaterial({ color: 0x2a2d2a, roughness: 0.7, metalness: 0.5 })),
    );
    crate.name = 'BuggyBoot';
    crate.castShadow = crate.receiveShadow = true;
    go.object3d.add(crate);
    const { world } = this.engine;
    const p = go.object3d.position;
    go.rigidBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, p.y, p.z));
    go.collider = world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), go.rigidBody);
    go.colliders = [go.collider];
    this.engine._bodyToGO?.set(go.rigidBody.handle, go);
    const cargo = go.addComponent(new BuggyCargo());
    const socket = go.addComponent(new SnapSocket({
      snapDistance: 0.5,
      slots: [{ offset: { y: h / 2 + 0.06 } }],
      attachedPromptLabel: '[E] Take drive box',
      sounds: 'item',
      canAccept: item => cargo.accepts(item),
    }));
    cargo.dock = go.addComponent(new DriveBoxDock({ socket }));
    this._outside.addChild(go);
    this.buggyBoot = go;
    this.buggyLidPivot = null;
    this.buggySocket = socket;
    return cargo;
  }

  // ──────────────────────────────────────────
  // Player
  // ──────────────────────────────────────────
  _spawnPlayer() {
    const { engine } = this;
    const spawn = this._spawnPoint();
    engine.buildPlayer({ position: spawn.position });
    engine.player?.getComponent(FirstPersonController)?.teleport?.(spawn.position, { yaw: spawn.yaw, pitch: 0 });
    const transitions = new RoomTransitionSystem({
      doors: Object.values(this.rooms).flatMap(r => r.doors),
      rooms: Object.values(this.rooms),
    });
    engine.player.addComponent(transitions);

    // The suit rides on the player; the hatch follows it however it changes,
    // not only through the locker.
    this.suit = engine.player.addComponent(new EVASuit());
    this.rooms.Airlock.bindSuit(this.suit);
    // Helmet glass and mask breathing while it's on.
    // No breathing on a death screen — the night has been lost.
    engine.player.addComponent(new SuitVisor({
      suit: this.suit,
      refraction: (this._visorRefraction ??= new VisorRefraction()),
      silenced: () => this.gameController?.state === 'gameOver',
    }));
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

const _airlockEar = new THREE.Vector3();
const _staminaEye = new THREE.Vector3();
/** Metres down from the player's body centre a foot can reach: the standing
 *  capsule's half height and a little. */
const FOOT_REACH = 1.2;

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
 * A heavy one (CHUNK_TRIANGLES) is cut into wedges of ground as well, zone
 * by zone. A part that has to carry per-instance values gets a geometry of
 * its own (splitInstances); those land in `out.geometries` for the scene
 * to dispose.
 *
 * @param {THREE.Object3D} object
 * @param {{ windows: import('../systems/Sightlines.js').HalfSpace[],
 *           eyes: THREE.Box3, occluders: THREE.Box3[] }} view
 * @param {{ yard: THREE.Object3D[], interior: THREE.Object3D[], unseen: THREE.Object3D[],
 *           geometries: THREE.BufferGeometry[] }} out
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
    if (perInstance * labels.length >= CHUNK_TRIANGLES) {
      forEachInstanceSphere(object, (sphere, i) => { labels[i] += `#${groundChunk(sphere.center)}`; });
    }
    const parts = splitInstances(object, (_sphere, i) => labels[i]);
    for (const [label, mesh] of parts) {
      const zone = label.split('#')[0];
      if (zone !== 'always') out[zone].push(mesh);
      if (mesh.geometry !== object.geometry) out.geometries.push(mesh.geometry);
    }
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
