import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from './GameObject.js';
import { FirstPersonController } from '../components/FirstPersonController.js';
import { InteractionSystem } from '../components/InteractionSystem.js';
import { AssetManager } from './AssetManager.js';
import { ASSETS, PRELOAD } from '../assets/manifest.js';
import { LoadingScreen } from '../ui/LoadingScreen.js';
import { Crosshair } from '../ui/Crosshair.js';
import { mergePhysics, resolvePhysics } from './ColliderSpec.js';
import { createBody, attachColliders } from './Colliders.js';
import { PhysicsDebug } from './PhysicsDebug.js';
import { DebugCamera } from './DebugCamera.js';
import { Fullbright } from './Fullbright.js';
import { OfficeScene } from '../scenes/OfficeScene.js';
import { TestScene } from '../scenes/TestScene.js';
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
  /** @type {Crosshair}     */ crosshair;

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

  // ── Physics interpolation (pre-allocated) ──
  _prevPos   = new Map();         // RigidBody.handle → { x, y, z }
  _prevQuat  = new Map();         // RigidBody.handle → { x, y, z, w }
  _scratchQ  = new THREE.Quaternion();

  // ── Scene ────────────────────────────────
  /** @type {import('./Scene.js').Scene} */ activeScene;

  /** Registered scenes available in the switcher dropdown.
   *  @type {Map<string, typeof import('./Scene.js').Scene>} */
  sceneRegistry = new Map();

  // ── Timing ────────────────────────────────
  _accumulator = 0;
  _lastTime    = 0;
  _rootObjects = [];

  // ── Input ─────────────────────────────────
  // Touchpads can occasionally emit one huge movement event. Cap each raw
  // event before accumulation; FirstPersonController also caps the frame total.
  mouseEventMaxDelta = 40;
  input = {
    keys: {},
    pressed: {},
    mouse: { dx: 0, dy: 0 },
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
    // Debug keys, in the same table so they remap with everything else.
    debugFly:   'KeyV',   // toggle the noclip fly camera
    fullbright: 'KeyB',   // toggle the unlit lighting mode
  };

  /** Returns true while the key mapped to [action] is held down. */
  isAction(action) {
    const code = this.keyBinds[action];
    return code ? !!this.input.keys[code] : false;
  }

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

    // ── Renderer ──
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
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
    canvas.addEventListener('click', () => canvas.requestPointerLock());
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

    // ── Keyboard ──
    addEventListener('keydown', (e) => {
      this.input.keys[e.code] = true;
      if (!e.repeat) this.input.pressed[e.code] = true;
    });
    addEventListener('keyup',   (e) => { this.input.keys[e.code] = false; });

    // ── Debug tooling ──
    // Built before their key handlers are registered, so a debug key can
    // never arrive before the tool it toggles exists.
    this.debugCamera = new DebugCamera(this.camera, this.scene);
    this.fullbright  = new Fullbright(this.scene, this.renderer);

    // ── Debug toggles ──
    // Edge-triggered, so like the collider overlay they get their own
    // listener rather than `input.keys`, which is level-triggered.
    addEventListener('keydown', (e) => {
      if (e.code === 'Backquote')        this.physicsDebug?.toggle();
      if (e.code === 'F2')               this.levelEditor?.toggle();
      if (e.code === this.keyBinds.debugFly)
        this.debugCamera?.toggle(this.player);
      if (e.code === this.keyBinds.fullbright) this.fullbright?.toggle();
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
    this.loadScene(OfficeScene);

    // Hidden until ` is pressed, and costs nothing while hidden.
    this.physicsDebug = new PhysicsDebug(this.scene, this.world);
    
    // Level editor — toggle with F2. Provides visual object placement.
    this.levelEditor = new LevelEditor(this);
    this.levelEditor.init();

    // ── Initialise every root object ──
    for (const obj of this._rootObjects) obj._init(this.scene, this.world);

    this.loadingScreen.hide();

    // ── Kick off the loop ──
    requestAnimationFrame(this._loop);
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
    this._teardownScene();

    // ── Build the new one ──
    this.activeScene = new SceneClass(this);
    this.activeScene.build();

    // Initialise every new root object (sets scene/world refs, adds to
    // the Three.js scene graph via _init).
    for (const obj of this._rootObjects) obj._init(this.scene, this.world);

    // The editor may be open across a scene switch (F4 reset): refresh its
    // tree and drop any selection pointing into the old scene, or the next
    // arrow-key press would sync dead physics bodies.
    this.levelEditor?.onSceneRebuilt?.();
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

    // Remove all root Object3Ds from the Three.js scene
    for (const go of this._rootObjects) {
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
  buildPlayer() {
    const player = new GameObject('Player');

    // YXZ Euler order — standard for FPS cameras (yaw then pitch)
    this.camera.rotation.order = 'YXZ';

    // Attach camera directly to the player Object3D
    player.object3d.add(this.camera);

    player.object3d.position.set(0, 1, 5);

    // Rapier kinematic character controller
    const controller = this.world.createCharacterController(0.01);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.enableSnapToGround(0.5);

    const capsuleHalf = 0.5;
    const capsuleR    = 0.3;

    // Crouch clearance: the desk's under-top gap is 0.72 m (AGENTS.md worked
    // example), so 0.65 is the tallest capsule that still fits under it.
    const crouchHeight = 0.65;
    const crouchHalf   = crouchHeight / 2 - capsuleR;

    const rb = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(0, 1, 5)
        .lockRotations(),
    );
    const standCol  = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(capsuleHalf, capsuleR),
      rb,
    );
    // The crouch capsule shares the body; exactly one of the two is enabled
    // at a time and the controller swaps them (see FirstPersonController).
    const crouchCol = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(crouchHalf, capsuleR),
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
      crouchSpeed: 2.5,
      crouchMode: 'toggle',   // flip to 'hold' for hold-to-crouch — nothing else changes
    });
    ctrl.camera = this.camera;

    player.addComponent(ctrl);

    // ── InteractionSystem component ──
    player.addComponent(new InteractionSystem({ range: 5 }));

    this.player = player;           // the debug fly camera freezes whoever this is
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

    // ── Render ──
    this.physicsDebug?.update();
    this.levelEditor?.update();
    this.renderer.render(this.scene, this.camera);

    // Consume one-frame input after all updates have read it
    this.input.mouse.dx = 0;
    this.input.mouse.dy = 0;
    this.input.pressed = {};
  };

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
      go.object3d.position.set(
        prev.x + (cur.x - prev.x) * alpha,
        prev.y + (cur.y - prev.y) * alpha,
        prev.z + (cur.z - prev.z) * alpha,
      );

      const pq = this._prevQuat.get(handle);
      if (pq) {
        const cr = go.rigidBody.rotation();
        this._scratchQ.set(pq.x, pq.y, pq.z, pq.w);
        go.object3d.quaternion.set(cr.x, cr.y, cr.z, cr.w);
        go.object3d.quaternion.slerp(this._scratchQ, 1 - alpha);
      }
    }
  }
}
