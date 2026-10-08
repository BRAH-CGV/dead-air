import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from './GameObject.js';
import { FirstPersonController } from '../components/FirstPersonController.js';
import { playerBody } from '../components/PlayerBody.js';
import { InteractionSystem } from '../components/InteractionSystem.js';
import { Flashlight } from '../components/Flashlight.js';
import { AssetManager } from './AssetManager.js';
import { ASSETS, PRELOAD } from '../assets/manifest.js';
import { LoadingScreen } from '../ui/LoadingScreen.js';
import { ScreenFade } from '../ui/ScreenFade.js';
import { ShadowScheduler } from './ShadowScheduler.js';
import { FrameSettle } from './FrameSettle.js';
import { warmUp } from './WarmUp.js';
import { Crosshair } from '../ui/Crosshair.js';
import { PerfStats } from '../ui/PerfStats.js';
import { mergePhysics, resolvePhysics } from './ColliderSpec.js';
import { createBody, attachColliders } from './Colliders.js';
import { Layers, packGroups } from './PhysicsLayers.js';
import { PhysicsDebug } from './PhysicsDebug.js';
import { DebugCamera } from './DebugCamera.js';
import { Fullbright } from './Fullbright.js';
import { OfficeScene } from '../scenes/OfficeScene.js';
import { TestScene } from '../scenes/TestScene.js';
import { BaseScene } from '../scenes/BaseScene.js';
import { logModelDebugInfo } from './ModelUtils.js';
import { LevelEditor } from '../editor/LevelEditor.js';

// ─────────────────────────────────────────────
// Engine  –  Initialisation & game loop
// ─────────────────────────────────────────────

export class Engine {
  // ── Tunables ──────────────────────────────
  static FIXED_DT   = 1 / 60;
  static MAX_FRAME  = 0.25;       // spiral-of-death clamp (seconds)
  static GRAVITY    = { x: 0, y: -9.81, z: 0 };

  // ── Three.js ──────────────────────────────
  scene; camera; renderer;

  // ── Assets ────────────────────────────────
  /** @type {AssetManager} */ assets;
  /** @type {LoadingScreen} */ loadingScreen;
  /** Shadow maps redrawn only when something changed (PERFORMANCE-PLAN §3).
   *  @type {ShadowScheduler} */ shadows = new ShadowScheduler();
  /** Holds the loading screen up until the first frames run smooth; null
   *  once the game has been revealed. @type {FrameSettle|null} */ _settle = null;
  /** @type {Crosshair}     */ crosshair;
  /** The ears: rides on the camera, and every THREE.Audio plays through it.
   *  @type {THREE.AudioListener} */ audioListener;

  // ── Rapier ────────────────────────────────
  world;

  /** Bodies that MOVE — dynamic and kinematic only. Static props never need a
   *  per-step snapshot, so keeping them out is free performance. */
  rigidBodyMap = new Map();       // RigidBody.handle → GameObject
  _bodyToGO    = new Map();       // RigidBody.handle → GameObject (all bodies, for raycasts)
  /** @type {PhysicsDebug} */ physicsDebug;
  /** @type {LevelEditor}  */ levelEditor;
  /** @type {DebugCamera}  */ debugCamera;
  /** @type {Fullbright}   */ fullbright;
  /** @type {GameObject}   */ player;
  /** The player's controller — settings (sensitivity, crouch mode, …) are
   *  written onto it after every build.
   *  @type {FirstPersonController|null} */ playerController = null;

  // ── Physics interpolation (pre-allocated) ──
  _prevPos   = new Map();         // RigidBody.handle → { x, y, z }
  _prevQuat  = new Map();         // RigidBody.handle → { x, y, z, w }
  _scratchQ  = new THREE.Quaternion();
  _scratchQ2 = new THREE.Quaternion();
  _scratchQ3 = new THREE.Quaternion();
  _scratchV  = new THREE.Vector3();

  // ── Scene ────────────────────────────────
  /** @type {import('./Scene.js').Scene} */ activeScene;

  /** Registered scenes available in the switcher dropdown.
   *  @type {Map<string, typeof import('./Scene.js').Scene>} */
  sceneRegistry = new Map();

  // ── Timing ────────────────────────────────
  _accumulator = 0;
  _lastTime    = 0;
  _rootObjects = [];

  // ── App state ─────────────────────────────
  /** While true the loop still renders (menus preview settings live behind
   *  them) but nothing steps or updates — the clock, the dish, the airlock
   *  and every enemy freeze without knowing why. Set through setPaused(). */
  paused = false;
  /** Gates every debug key (` F2 V B I N F4). The app layer sets it from the
   *  DEVELOPER setting; on by default so a bare Engine keeps its tools. */
  devTools = true;
  /** True while a DOM panel has the mouse (the generator's breaker panel):
   *  the pointer lock was let go on purpose, so losing it isn't a pause. */
  uiHasMouse = false;
  /** @type {Set<(scene: import('./Scene.js').Scene) => void>} */
  _sceneLoadedListeners = new Set();
  /** Told when the simulation pauses and resumes (onPauseChange). */
  _pauseListeners = new Set();
  /** Resolves once the loading screen is gone and the game is on show —
   *  the moment the main menu can appear. @type {Promise<void>} */
  revealed = new Promise((resolve) => { this._resolveRevealed = resolve; });

  // ── Input ─────────────────────────────────
  // Touchpads can occasionally emit one huge movement event. Cap each raw
  // event before accumulation; FirstPersonController also caps the frame total.
  mouseEventMaxDelta = 40;
  input = {
    keys: {},
    pressed: {},
    mouse: { dx: 0, dy: 0, wheel: 0 },
    locked: false,
  };
  
  // ── Debug ─────────────────────────────────
  /** When true, spawnModel() logs position/scale/bounds to console. */
  debugModels = false;

  // ── Key binds ─────────────────────────────
  // Maps action names → KeyboardEvent.code strings.
  // Change values at runtime or load from config to remap controls.
  keyBinds = {
    forward:  'KeyW',
    back:     'KeyS',
    left:     'KeyA',
    right:    'KeyD',
    jump:     'Space',
    crouch:   'KeyC',
    interact: 'KeyE',
    flashlight: 'KeyF',
    // Debug keys, in the same table so they remap with everything else.
    debugFly:   'KeyV',   // toggle the noclip fly camera
    fullbright: 'KeyB',   // toggle the unlit lighting mode
    nextNight:  'KeyN',   // BaseScene: advance the night (wraps to night 1)
    perfStats:  'KeyI',   // toggle the FPS / draw-call readout
    // TESTING ONLY — remove before release: bring the UFO now (BaseScene).
    summonUfo:  'KeyU',
    // TESTING ONLY — remove before release: start a sandstorm now (BaseScene).
    summonStorm: 'KeyK',
    // TESTING ONLY — remove before release: bring a dust eye now, with a
    // storm if none is blowing (BaseScene).
    summonEyes:  'KeyJ',
  };

  /** Freeze or unfreeze the simulation. Input is cleared both ways: a keyup
   *  that lands while the window is blurred never arrives, so a key held
   *  into the pause menu would otherwise walk the player on resume.
   *  @param {boolean} paused */
  setPaused(paused) {
    const changed = this.paused !== !!paused;
    this.paused = !!paused;
    if (changed) for (const listener of [...this._pauseListeners]) listener(this.paused);
    this._accumulator = 0;
    // Cleared in place — components and the debug camera hold these objects.
    for (const code in this.input.keys) delete this.input.keys[code];
    for (const code in this.input.pressed) delete this.input.pressed[code];
    this._consumed.clear();
    this.input.mouse.dx = 0;
    this.input.mouse.dy = 0;
    this.input.mouse.wheel = 0;
  }

  /** Subscribe to pauses and resumes: `listener(paused)`, only when it
   *  changes. Nothing is updated while paused, so whatever has to stop with
   *  the game — a looping sound — has no frame to notice in.
   *  @param {(paused: boolean) => void} listener
   *  @returns {() => void} unsubscribe */
  onPauseChange(listener) {
    this._pauseListeners.add(listener);
    return () => this._pauseListeners.delete(listener);
  }

  /** Whether the debug keys may act right now. */
  get debugKeysActive() {
    return this.devTools && !this.paused;
  }

  /** Subscribe to scene loads — called at the end of every loadScene, the
   *  ones the app starts and the ones it doesn't (F4, the editor's switcher).
   *  @param {(scene: import('./Scene.js').Scene) => void} listener
   *  @returns {() => void} unsubscribe */
  onSceneLoaded(listener) {
    this._sceneLoadedListeners.add(listener);
    return () => this._sceneLoadedListeners.delete(listener);
  }

  /** Returns true while the key mapped to [action] is held down — unless
   *  that press was consumed (consumeAction), until the key is let go. */
  isAction(action) {
    const code = this.keyBinds[action];
    if (!code || !this.input.keys[code]) return false;
    return !this._consumed.has(code);
  }

  /** Use up the current press of [action]: isAction() and input.pressed
   *  read it as up until the key is released. For a press that has done its
   *  job (E retrying the night) and must not also reach anything else. */
  consumeAction(action) {
    const code = this.keyBinds[action];
    if (!code) return;
    this.input.pressed[code] = false;
    if (this.input.keys[code]) this._consumed.add(code);
  }

  /** Key codes whose current press was consumed. */
  _consumed = new Set();

  // ──────────────────────────────────────────
  // Bootstrap
  // ──────────────────────────────────────────
  async init() {
    this.loadingScreen = new LoadingScreen();
    this.crosshair     = new Crosshair();
    this.crosshair.hide();   // revealed once the player exists

    // ── Scene & camera ──
    this.scene  = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.02);

    this.camera = new THREE.PerspectiveCamera(
      75, innerWidth / innerHeight, 0.1, 1000,
    );

    // ── Audio ──
    // Starts suspended until the first click (see pointer lock below).
    this.audioListener = new THREE.AudioListener();
    this.camera.add(this.audioListener);

    // ── Renderer ──
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    // PCF, not PCFSoft: three r185 deprecates PCFSoft and swaps it for PCF on
    // the first shadow render — after the warm-up has compiled every lit
    // shader for PCFSoft. That swap re-keyed ~30 programs and recompiled them
    // all synchronously: a 20 s freeze on the first frame. PCF is what was
    // being drawn either way.
    this.renderer.shadowMap.type    = THREE.PCFShadowMap;
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    document.body.appendChild(this.renderer.domElement);

    // ── Physics world ──
    this.world = new RAPIER.World(Engine.GRAVITY);
    this.world.timestep = Engine.FIXED_DT;
    this.RAPIER = RAPIER; // exposed so components/editors can build colliders without importing (test wasm resolver)
    
    // Expose engine to components via scene userData
    this.scene.userData.engine    = this;
    this.scene.userData.crosshair = this.crosshair;

    // ── Pointer-lock mouse look ──
    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', () => {
      canvas.requestPointerLock();
      // Chrome won't let an AudioContext start before a user gesture; this
      // click is the first one the game gets, so it's where sound wakes up.
      if (this.audioListener?.context.state === 'suspended') this.audioListener.context.resume();
    });
    document.addEventListener('pointerlockchange', () => {
      this.input.locked = document.pointerLockElement === canvas;
      this.input.mouse.dx = 0;
      this.input.mouse.dy = 0;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.input.locked) return;
      this.input.mouse.dx += this._clampMouseEventDelta(e.movementX);
      this.input.mouse.dy += this._clampMouseEventDelta(e.movementY);
    });

    // ── Mouse wheel (scroll) ──
    // Accumulated per frame; consumed after updates read it (same as mouse dx/dy).
    addEventListener('wheel', (e) => {
      if (!this.input.locked) return;
      // deltaY is positive when scrolling down (away from user).
      // Normalise to ±1 ticks so consumers can multiply by a step size.
      this.input.mouse.wheel += Math.sign(e.deltaY);
    }, { passive: true });

    // ── Keyboard ──
    addEventListener('keydown', (e) => {
      this.input.keys[e.code] = true;
      if (!e.repeat) this.input.pressed[e.code] = true;
    });
    addEventListener('keyup',   (e) => {
      this.input.keys[e.code] = false;
      this._consumed.delete(e.code);
    });

    // ── Debug tooling ──
    // Built before their key handlers are registered, so a debug key can
    // never arrive before the tool it toggles exists.
    this.debugCamera = new DebugCamera(this.camera, this.scene);
    this.fullbright  = new Fullbright(this.scene, this.renderer);
    this.perfStats   = new PerfStats();

    // ── Debug toggles ──
    // Edge-triggered, so like the collider overlay they get their own
    // listener rather than `input.keys`, which is level-triggered.
    addEventListener('keydown', (e) => {
      if (!this.debugKeysActive) return;
      if (e.code === 'Backquote')        this.physicsDebug?.toggle();
      if (e.code === 'F2')               this.levelEditor?.toggle();
      if (e.code === this.keyBinds.debugFly)
        this.debugCamera?.toggle(this.player);
      if (e.code === this.keyBinds.fullbright) this.fullbright?.toggle();
      if (e.code === this.keyBinds.perfStats)  this.perfStats?.toggle();
      // Only scenes with night progression (BaseScene) have `nights`.
      const nights = this.activeScene?.nights;
      // TESTING ONLY — remove before release.
      if (e.code === this.keyBinds.summonUfo && this.activeScene?.ufoThreat) {
        const coming = this.activeScene.ufoThreat.summon();
        console.log(coming ? '[DEBUG] UFO summoned' : '[DEBUG] UFO not summoned — a visit is under way, or no shift is');
      }
      if (e.code === this.keyBinds.summonStorm && this.activeScene?.sandstorm) {
        const coming = this.activeScene.sandstorm.summon();
        console.log(coming ? '[DEBUG] Sandstorm summoned' : '[DEBUG] Sandstorm not summoned — one is blowing, or no shift is');
      }
      if (e.code === this.keyBinds.summonEyes && this.activeScene?.dustEyes) {
        const coming = this.activeScene.dustEyes.summon();
        console.log(coming ? '[DEBUG] Dust eye summoned in the yard' : '[DEBUG] Dust eye not summoned — no shift, the UFO is over the base, or the yard is full');
      }
      if (e.code === this.keyBinds.nextNight && nights) {
        if (nights.isLastNight()) nights.setNight(1);
        else nights.advance();
        console.log(`[DEBUG] Night ${nights.currentNight} of ${nights.maxNight}`);
      }
      // F4, not F1: F1 belongs to the browser — Chrome opens help with it
      // and DevTools opens its settings — and those contexts swallow the
      // key before the page ever sees it, preventDefault or not.
      if (e.code === 'F4') {
        e.preventDefault();
        this.debugModels = !this.debugModels;
        console.log(`[DEBUG] Model debug logging ${this.debugModels ? 'ENABLED' : 'DISABLED'}`);
        if (this.debugModels) {
          console.log('[DEBUG] Re-spawning models to show debug info...');
          // Re-spawn current scene to show debug info
          if (this.activeScene) {
            this.loadScene(this.activeScene.constructor);
          }
        }
      }
    });

    // ── Resize ──
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    // ── Assets ──
    // Everything the first frame needs is fetched before the scene is built,
    // so nothing pops in mid-render. The renderer has to exist first — the
    // AssetManager reads its anisotropy cap.
    this.assets = new AssetManager({ renderer: this.renderer });
    await this.assets.loadAll(PRELOAD, (fraction, loaded, total) => {
      this.loadingScreen.setProgress(fraction, loaded, total);
    });

    // ── Build world ──
    this.registerScene('OfficeScene', OfficeScene);
    this.registerScene('TestScene', TestScene);
    this.registerScene('BaseScene', BaseScene);
    this.loadScene(BaseScene);

    // Hidden until ` is pressed, and costs nothing while hidden.
    this.physicsDebug = new PhysicsDebug(this.scene, this.world);
    
    // Level editor — toggle with F2. Provides visual object placement.
    this.levelEditor = new LevelEditor(this);
    this.levelEditor.init();

    // loadScene() already called _init on every root object (line 319).
    // A second pass here would double-create physics bodies for any
    // GameObject that builds them in _init (e.g. Drive), leaving orphaned
    // colliders in the Rapier world — hence no second _init loop.

    // ── Warm up, behind the loading screen ──
    // Every shader compiled, every texture uploaded, every mesh and shadow
    // map drawn once — WebGL otherwise pays for each the first frame it is
    // needed, which is the stutter on a first look round (see WarmUp.js).
    await warmUp({
      renderer: this.renderer, scene: this.scene, camera: this.camera,
      onStage: (label, fraction) => this.loadingScreen.setStage(label, fraction),
    });

    // ── Kick off the loop — still behind the loading screen ──
    // The first frames after that are the JIT, the physics world and the
    // gameplay systems finding their feet. The loop runs under the overlay
    // until they've been smooth for a run (FrameSettle), then _reveal()
    // fades the game in.
    this.loadingScreen.setStage('Almost there…', 1);
    this.screenFade = new ScreenFade();
    this._settle = new FrameSettle();
    requestAnimationFrame(this._loop);
  }

  /** The way in: cut to black over the loading screen, drop it, fade up. */
  _reveal() {
    this.screenFade.fadeIn(1500);
    this.loadingScreen.hide({ immediate: true });
    this._resolveRevealed();
  }

  /** Free every GPU resource we own. Call before rebuilding a level, so
   *  memory doesn't climb across restarts. */
  dispose() {
    this.fullbright?.dispose();     // restores lights/fog/materials if active
    this.physicsDebug?.dispose();
    this.levelEditor?.dispose();
    this.assets?.dispose();
    this.renderer?.dispose();
  }

  // ──────────────────────────────────────────
  // Scene management
  // ──────────────────────────────────────────
  /** Register a Scene class so it appears in the editor's scene switcher.
   *  @param {string} name  Display name (must match the class name).
   *  @param {typeof import('./Scene.js').Scene} SceneClass */
  registerScene(name, SceneClass) {
    this.sceneRegistry.set(name, SceneClass);
  }

  /** Return all registered scene names. */
  getRegisteredSceneNames() {
    return [...this.sceneRegistry.keys()];
  }

  /** Swap to a new scene.  Tears down the old one (removes Three.js objects,
   *  physics bodies, colliders, and root-object bookkeeping), then builds
   *  the new scene and initialises its root objects.
   *
   *  @param {typeof import('./Scene.js').Scene} SceneClass */
  loadScene(SceneClass) {
    // ── Tear down the old scene ──
    // Shadows first: the scene registers its watches while it builds.
    this.shadows.release();
    this._teardownScene();

    // ── Build the new one ──
    this.activeScene = new SceneClass(this);
    this.activeScene.build();

    // Initialise every new root object (sets scene/world refs, adds to
    // the Three.js scene graph via _init).
    for (const obj of this._rootObjects) obj._init(this.scene, this.world);

    // Freeze every shadow map in the new scene (one render each now, then
    // only when something changes).
    this.shadows.adopt(this.scene);

    // The editor may be open across a scene switch (F4 reset): refresh its
    // tree and drop any selection pointing into the old scene, or the next
    // arrow-key press would sync dead physics bodies.
    this.levelEditor?.onSceneRebuilt?.();

    for (const listener of [...this._sceneLoadedListeners]) listener(this.activeScene);
  }

  /** Remove every Three.js object, Rapier body/collider, and bookkeeping
   *  entry left by the current scene.  Keeps the renderer, camera, and
   *  world alive for the next scene. */
  _teardownScene() {
    this.activeScene?.dispose();

    // ── Physics: drop the whole world and start a fresh one ──
    // Removing bodies one-by-one proved fragile: a stale wrapper or any
    // mid-operation panic bricks the WASM arena — the borrow flag never
    // clears, and every later world call dies with "recursive use of an
    // object detected", repeating every frame in step(). A fresh world is
    // cheap and removes every body, collider and character controller in
    // one shot.
    try { this.world.free(); } catch (_) { /* already bricked — just drop it */ }
    this.world = new RAPIER.World(Engine.GRAVITY);
    this.world.timestep = Engine.FIXED_DT;
    if (this.physicsDebug) this.physicsDebug.world = this.world;

    // Remove all root Object3Ds from the Three.js scene. Destroy first: the
    // camera outlives the scene (the next buildPlayer re-mounts it), so
    // anything a component hung on it — the flashlight, the suit visor —
    // would otherwise ride along into the next level.
    for (const go of this._rootObjects) {
      go.destroy();
      this.scene.remove(go.object3d);
    }

    // Clear bookkeeping
    this._rootObjects.length = 0;
    this.rigidBodyMap.clear();
    this._bodyToGO.clear();
    this._prevPos.clear();
    this._prevQuat.clear();
  }

  /**
   * Place a manifest model in the world and return the GameObject wrapping it.
   * The mesh is a clone sharing geometry/materials with the cache, so calling
   * this repeatedly is cheap.
   *
   * ── Physics ──
   * Opt-in: a model with no `physics` in its manifest entry is render-only, so
   * decorative geometry never quietly becomes solid. Adding `physics: 'static'`
   * is the whole of what most props need — the collider is fitted to bounds
   * measured once at load. See ColliderSpec.js for the three tiers.
   *
   * @param {string} key                     Manifest key, e.g. 'model:desk'.
   * @param {Object} [opts]
   * @param {string} [opts.name]             GameObject name; defaults to the key.
   * @param {[number,number,number]} [opts.position]
   * @param {number} [opts.rotationY]        Yaw in radians.
   * @param {number|[number,number,number]} [opts.scale]
   *        Uniform or XYZ scale on top of the manifest's.
   * @param {import('./ColliderSpec.js').PhysicsSpec|string} [opts.physics]
   *        Per-spawn override, merged over the manifest's block. Handy for one
   *        crate that should be dynamic when the rest are scenery.
   * @param {typeof GameObject} [opts.type]   GameObject subclass to wrap the
   *        clone in instead of a plain GameObject — spawns the model as a
   *        smarter object with behaviour of its own (see
   *        gameobjects/Satellite.js). The subclass must keep GameObject's
   *        constructor signature; override `static fromObject3D` to latch
   *        onto named sub-nodes.
   * @returns {GameObject}
   */
  spawnModel(key, opts = {}) {
    const { name, position = [0, 0, 0], rotationY = 0, scale = 1, physics, type = GameObject } = opts;

    // Wrap the entire cloned GLB hierarchy into GameObjects so that named
    // sub-parts are reachable via go.find() and lifecycle hooks propagate.
    const clone = this.assets.instantiate(key);
    const go = type.fromObject3D(clone);
    go.name = name ?? key;
    go.object3d.name = go.name;
    go.physicsAssetKey = key;
    go.physicsOverride = physics;
    go.object3d.position.set(position[0], position[1], position[2]);
    go.object3d.rotation.y = rotationY;
    this._applyObjectScale(go.object3d, scale);
    
    this._attachPhysics(go, key, { position, rotationY, scale, physics });
    
    this._rootObjects.push(go);

    // Debug: log model info to console
    if (this.debugModels) {
      logModelDebugInfo(key, go.object3d);
    }

    // Spawned while fullbright is on: swap the newcomer too, so a level built
    // under the debug light looks consistent immediately.
    this.fullbright?.refresh();
    return go;
  }

  /** Build the rigid body and colliders for a spawned model, if it asked for
   *  any. Split out of `spawnModel` so the visual path stays readable. */
  _attachPhysics(go, key, { position, rotationY, scale, physics }) {
    // null means neither the manifest nor this spawn asked for physics — the
    // model is render-only, which is the default for anything decorative.
    const spec = mergePhysics(ASSETS[key]?.physics, physics);
    if (!spec || spec.body === 'none') return;

    // Only 'trimesh', and 'hull' on a model with no UCX_ proxies, need the
    // merged render geometry — everything else is answered by the bounds.
    const needsMesh = spec.shape === 'trimesh' || spec.shape === 'hull';
    const resolved = resolvePhysics(spec, this.assets.getCollision(key, needsMesh), scale);
    if (!resolved) return;

    if (resolved.body === 'dynamic' && spec.shape === 'trimesh') {
      console.warn(
        `[physics] '${key}': trimesh colliders are hollow and can't be dynamic — ` +
        "use 'hull' or a compound of primitives instead.",
      );
    }

    // The body has to start where the Object3D is: `_syncPhysicsToScene` copies
    // the body's transform onto the mesh every step, so a body left at the
    // origin would yank the model there on the first frame.
    go.rigidBody = createBody(this.world, resolved, { position, rotationY });
    go.colliders = attachColliders(this.world, go.rigidBody, resolved, key);
    go.collider  = go.colliders[0] ?? null;
    go._physicsScale = this._scaleArray(scale);

    // Every spawned body goes into _bodyToGO so raycasts (InteractionSystem)
    // can look up the owning GameObject from a collider handle. Static props
    // stay out of rigidBodyMap — they never move, so interpolation is wasted.
    this._bodyToGO.set(go.rigidBody.handle, go);
    if (resolved.body !== 'static') this.rigidBodyMap.set(go.rigidBody.handle, go);
  }
  
  rebuildModelPhysicsForScale(go) {
    if (!go?.rigidBody || !go.physicsAssetKey) return false;
  
    const key = go.physicsAssetKey;
    const spec = mergePhysics(ASSETS[key]?.physics, go.physicsOverride);
    if (!spec || spec.body === 'none') return false;
  
    const scale = this._scaleArray(go.object3d.scale);
    const needsMesh = spec.shape === 'trimesh' || spec.shape === 'hull';
    const resolved = resolvePhysics(spec, this.assets.getCollision(key, needsMesh), scale);
    if (!resolved) return false;
  
    for (const collider of go.colliders ?? (go.collider ? [go.collider] : [])) {
      this.world.removeCollider(collider, true);
    }
  
    go.colliders = attachColliders(this.world, go.rigidBody, resolved, key);
    go.collider = go.colliders[0] ?? null;
    go._physicsScale = scale;
    return true;
  }
  
  _applyObjectScale(object3d, scale) {
    const [x, y, z] = this._scaleArray(scale);
    object3d.scale.set(x, y, z);
  }
  
  _scaleArray(scale) {
    if (Array.isArray(scale)) return [scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1];
    if (typeof scale === 'object' && scale !== null) return [scale.x ?? 1, scale.y ?? 1, scale.z ?? 1];
    return [scale, scale, scale];
  }
    
  // ──────────────────────────────────────────
  // Player – first-person character controller
  // ──────────────────────────────────────────
  /** Build the player GameObject (camera, controller, interaction).
   *  Called by every scene's `build()` — shared across levels. */
  buildPlayer({ position = [0, 1, 5] } = {}) {
    const player = new GameObject('Player');

    // YXZ Euler order — standard for FPS cameras (yaw then pitch)
    this.camera.rotation.order = 'YXZ';

    // Attach camera directly to the player Object3D
    player.object3d.add(this.camera);

    // Capsule centre; scenes pick where the player starts.
    player.object3d.position.set(...position);

    // Rapier kinematic character controller
    const controller = this.world.createCharacterController(0.01);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.enableSnapToGround(0.5);

    // Heights, eye offsets and the doorway / desk-gap limits they're chosen
    // against all live in PlayerBody.
    const body = playerBody();

    const rb = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(...position)
        .lockRotations(),
    );

    // Player collision groups: member of PLAYER layer, interacts with DEFAULT
    // and PLAYER. DEFAULT catches walls, props and the floor; PLAYER catches
    // the shelf's player-only envelope box (which uses PLAYER membership so the
    // interaction ray can skip it). SHELF boards stay excluded — the player
    // walks through them, items rest on them.
    const playerGroups = packGroups([Layers.PLAYER], [Layers.DEFAULT, Layers.PLAYER]);

    const standCol  = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(body.standHalf, body.radius)
        .setCollisionGroups(playerGroups),
      rb,
    );
    // The crouch capsule shares the body; exactly one of the two is enabled
    // at a time and the controller swaps them (see FirstPersonController).
    const crouchCol = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(body.crouchHalf, body.radius)
        .setCollisionGroups(playerGroups),
      rb,
    );
    crouchCol.setEnabled(false);

    player.rigidBody = rb;
    player.collider  = standCol;
    player.colliders = [standCol, crouchCol];
    this._bodyToGO.set(rb.handle, player);

    // ── FirstPersonController component ──
    const ctrl = new FirstPersonController(controller, {
      speed: 5,
      jumpForce: 4,
      sensitivity: 0.002,
      // Source-style movement: velocity ramps instead of snapping.
      accel: 6,        // ground accelerate
      airAccel: 2,     // gentler air control (momentum is kept)
      friction: 6,     // ground friction
      standCollider:  standCol,
      crouchCollider: crouchCol,
      standEyeOffset:  body.standEyeOffset,
      crouchEyeOffset: body.crouchEyeOffset,
      crouchSpeed: 2.5,
      crouchMode: 'toggle',   // flip to 'hold' for hold-to-crouch — nothing else changes
      // Collision groups for the character controller filter — only colliders
      // in the DEFAULT layer block the player (not SHELF boards).
      filterGroups: playerGroups,
    });
    ctrl.camera = this.camera;

    player.addComponent(ctrl);

    // ── InteractionSystem component ──
    player.addComponent(new InteractionSystem({ range: 5 }));

    // ── Flashlight component ──  F toggles; bright up close, short reach by design.
    player.addComponent(new Flashlight());

    this.player = player;           // the debug fly camera freezes whoever this is
    this.playerController = ctrl;
    this._rootObjects.push(player);
    this.crosshair.show();
  }

  // ──────────────────────────────────────────
  // Game loop  (fixed-timestep physics + variable render)
  // ──────────────────────────────────────────
  _loop = (time) => {
    requestAnimationFrame(this._loop);

    const now = time / 1000;
    if (this._lastTime === 0) { this._lastTime = now; return; }

    let frameDt = Math.min(now - this._lastTime, Engine.MAX_FRAME);
    this._lastTime = now;

    // Paused: the clock above still moves (no spike on resume), the frame
    // still renders, and nothing in between runs.
    if (!this.paused) this._simulate(frameDt);

    this._renderFrame(frameDt);
  };

  /** One frame of simulation: fixed steps, interpolation, the debug camera,
   *  then the variable and late updates. Skipped while paused. */
  _simulate(frameDt) {
    // ── Fixed update (physics) ──
    this._accumulator += frameDt;
    while (this._accumulator >= Engine.FIXED_DT) {
      this._savePrevPhysics();
      for (const obj of this._rootObjects) obj._fixedUpdate(Engine.FIXED_DT);
      this.world.step();
      this._syncPhysicsToScene();
      this._accumulator -= Engine.FIXED_DT;
    }

    // ── Deferred body removal ──
    // Clean up rigid bodies that were flagged for removal during the physics
    // step (e.g. editor delete). The try/catch in _deleteSelected queues
    // them here if Rapier threw "recursive use". Safe to remove now that
    // world.step() has finished.
    if (this._deferredBodyRemovals?.length > 0) {
      for (const body of this._deferredBodyRemovals) {
        try {
          this.world.removeRigidBody(body);
        } catch (e) {
          // Still can't remove it — leave it queued for next frame.
          // This shouldn't happen outside world.step(), but guard anyway.
        }
      }
      this._deferredBodyRemovals = [];
    }

    // Interpolation factor: how far we are between the last two physics steps
    const alpha = this._accumulator / Engine.FIXED_DT;
    this._interpolatePhysics(alpha);

    // ── Debug fly camera ──
    // Above the variable update on purpose: the player's components are
    // suspended while it flies, so nothing else touches the camera this frame,
    // and the mouse deltas it consumes are reset at the bottom of the loop.
    if (this.debugCamera?.active) {
      this.debugCamera.update(frameDt, this.input, this.keyBinds);
    }

    // ── Variable update ──
    for (const obj of this._rootObjects) obj._update(frameDt);

    // ── Late update (post-update, camera, etc.) ──
    for (const obj of this._rootObjects) obj._lateUpdate(frameDt);
  }

  /** Draw the frame and consume one-frame input — runs paused or not. */
  _renderFrame(frameDt) {
    // ── Render ──
    this.physicsDebug?.update();
    this.levelEditor?.update();
    // The editor moves shadow casters the scheduler isn't watching; while it
    // is open, shadows go back to every frame.
    if (this.levelEditor?.enabled) this.shadows.invalidate();
    this.shadows.update();
    this.renderer.render(this.scene, this.camera);
    // After render: renderer.info now holds this frame's totals, shadow
    // passes included. No-op while the readout is hidden.
    this.perfStats?.update(frameDt, this.renderer.info);

    // Still behind the loading screen: reveal once the frames are smooth.
    if (this._settle?.push(frameDt)) {
      this._settle = null;
      this._reveal();
    }

    // Consume one-frame input after all updates have read it
    this.input.mouse.dx = 0;
    this.input.mouse.dy = 0;
    this.input.mouse.wheel = 0;
    this.input.pressed = {};
  }

  _clampMouseEventDelta(delta) {
    if (!Number.isFinite(delta)) return 0;
    return Math.max(-this.mouseEventMaxDelta, Math.min(this.mouseEventMaxDelta, delta));
  }

  /** Snapshot every rigid-body transform BEFORE world.step(). */
  _savePrevPhysics() {
    for (const [handle, go] of this.rigidBodyMap) {
      const t = go.rigidBody.translation();
      const r = go.rigidBody.rotation();
      let p = this._prevPos.get(handle);
      if (p) { p.x = t.x; p.y = t.y; p.z = t.z; }
      else   { this._prevPos.set(handle, { x: t.x, y: t.y, z: t.z }); }
      let q = this._prevQuat.get(handle);
      if (q) { q.x = r.x; q.y = r.y; q.z = r.z; q.w = r.w; }
      else   { this._prevQuat.set(handle, { x: r.x, y: r.y, z: r.z, w: r.w }); }
    }
  }

  /** Push Rapier body transforms into Three.js Object3Ds (no interpolation). */
  _syncPhysicsToScene() {
    for (const obj of this._rootObjects) {
      if (!obj.rigidBody) continue;
      // A fixed body's transform is the one we gave it and never changes;
      // copying it back every step would be pure cost in a room full of props.
      if (obj.rigidBody.bodyType() === RAPIER.RigidBodyType.Fixed) continue;
      const t = obj.rigidBody.translation();
      const r = obj.rigidBody.rotation();
      obj.object3d.position.set(t.x, t.y, t.z);
      obj.object3d.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /** Lerp/slerp dynamic-body visuals between previous and current physics
   *  state so they appear to move at the display refresh rate, not 60 Hz. */
  _interpolatePhysics(alpha) {
    for (const [handle, go] of this.rigidBodyMap) {
      // Only interpolate dynamic bodies. The player is kinematic and camera-owned;
      // interpolating it can fight pointer-look and cause visible jitter.
      if (go.rigidBody.bodyType() !== RAPIER.RigidBodyType.Dynamic) continue;

      const prev = this._prevPos.get(handle);
      if (!prev) continue;
      const cur = go.rigidBody.translation();
      
      // Interpolated world position
      const wx = prev.x + (cur.x - prev.x) * alpha;
      const wy = prev.y + (cur.y - prev.y) * alpha;
      const wz = prev.z + (cur.z - prev.z) * alpha;
      
      // Convert world position to local space if the object has a parent.
      // Child objects (e.g. drives inside a room) store position relative to
      // their parent, so we must transform from world to local space.
      if (go.object3d.parent) {
        // Ensure the parent's world matrix is current before the conversion.
        go.object3d.parent.updateMatrixWorld(true);
        this._scratchV.set(wx, wy, wz);
        go.object3d.parent.worldToLocal(this._scratchV);
        go.object3d.position.copy(this._scratchV);
      } else {
        go.object3d.position.set(wx, wy, wz);
      }

      const pq = this._prevQuat.get(handle);
      if (pq) {
        const cr = go.rigidBody.rotation();
        this._scratchQ.set(pq.x, pq.y, pq.z, pq.w);
        
        // Interpolated world quaternion
        const wq = this._scratchQ2.set(cr.x, cr.y, cr.z, cr.w);
        wq.slerp(this._scratchQ, 1 - alpha);
        
        // Convert world quaternion to local space if the object has a parent.
        if (go.object3d.parent) {
          // Parent's world matrix is already up to date from the position block.
          const parentQuat = this._scratchQ3;
          go.object3d.parent.getWorldQuaternion(parentQuat);
          parentQuat.invert().multiply(wq);
          go.object3d.quaternion.copy(parentQuat);
        } else {
          go.object3d.quaternion.copy(wq);
        }
      }
    }
  }
}
