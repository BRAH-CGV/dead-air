import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from './GameObject.js';
import { FirstPersonController } from '../components/FirstPersonController.js';
import { AssetManager } from './AssetManager.js';
import { ASSETS, PRELOAD } from '../assets/manifest.js';
import { LoadingScreen } from '../ui/LoadingScreen.js';
import { mergePhysics, resolvePhysics } from './ColliderSpec.js';
import { createBody, attachColliders } from './Colliders.js';

// ─────────────────────────────────────────────
// Engine  –  Initialisation & game loop
// ─────────────────────────────────────────────

export class Engine {
  // ── Tunables ──────────────────────────────
  static FIXED_DT   = 1 / 60;
  static MAX_FRAME  = 0.25;       // spiral-of-death clamp (seconds)

  // ── Three.js ──────────────────────────────
  scene; camera; renderer;

  // ── Assets ────────────────────────────────
  /** @type {AssetManager} */ assets;
  /** @type {LoadingScreen} */ loadingScreen;

  // ── Rapier ────────────────────────────────
  world;
  /** Bodies that MOVE — dynamic and kinematic only. Static props never need a
   *  per-step snapshot, so keeping them out is free performance. */
  rigidBodyMap = new Map();       // RigidBody.handle → GameObject

  // ── Physics interpolation (pre-allocated) ──
  _prevPos   = new Map();         // RigidBody.handle → { x, y, z }
  _prevQuat  = new Map();         // RigidBody.handle → { x, y, z, w }
  _scratchQ  = new THREE.Quaternion();

  // ── Timing ────────────────────────────────
  _accumulator = 0;
  _lastTime    = 0;
  _rootObjects = [];

  // ── Input ─────────────────────────────────
  input = {
    keys: {},
    mouse: { dx: 0, dy: 0 },
    locked: false,
  };

  // ──────────────────────────────────────────
  // Bootstrap
  // ──────────────────────────────────────────
  async init() {
    this.loadingScreen = new LoadingScreen();

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
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = Engine.FIXED_DT;
    
    // Expose engine to components via scene userData
    this.scene.userData.engine = this;

    // ── Pointer-lock mouse look ──
    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', () => canvas.requestPointerLock());
    document.addEventListener('pointerlockchange', () => {
      this.input.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.input.locked) return;
      this.input.mouse.dx += e.movementX;
      this.input.mouse.dy += e.movementY;
    });

    // ── Keyboard ──
    addEventListener('keydown', (e) => { this.input.keys[e.code] = true;  });
    addEventListener('keyup',   (e) => { this.input.keys[e.code] = false; });

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
    this._buildScene();

    // ── Initialise every root object ──
    for (const obj of this._rootObjects) obj._init(this.scene, this.world);

    this.loadingScreen.hide();

    // ── Kick off the loop ──
    requestAnimationFrame(this._loop);
  }

  /** Free every GPU resource we own. Call before rebuilding a level, so
   *  memory doesn't climb across restarts. */
  dispose() {
    this.assets?.dispose();
    this.renderer?.dispose();
  }

  // ──────────────────────────────────────────
  // Scene construction
  // ──────────────────────────────────────────
  _buildScene() {
    // ── Lighting ──
    this.scene.add(new THREE.AmbientLight(0x404060, 0.5));

    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(10, 20, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near   =  0.5;
    sun.shadow.camera.far    = 50;
    sun.shadow.camera.left   = -20;
    sun.shadow.camera.right  =  20;
    sun.shadow.camera.top    =  20;
    sun.shadow.camera.bottom = -20;
    this.scene.add(sun);

    // ── Ground (visual) ──
    // Textures come from the manifest, already in the right colour space and
    // set to repeat — see AssetManager._loadTexture.
    const groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshStandardMaterial({
        color: 0x8890a0,
        roughness: 0.9,
        map: this.assets.get('tex:floor-basecolor'),
        normalMap: this.assets.get('tex:floor-normal'),
        normalScale: new THREE.Vector2(0.8, 0.8),
      }),
    );
    groundMesh.rotation.x    = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    this.scene.add(groundMesh);

    // Ground collider (static, no GameObject needed)
    const groundBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 0.1, 50).setTranslation(0, -0.1, 0),
      groundBody,
    );

    // ── Decorative boxes ──
    this._addBox('Crate_A', new THREE.Vector3( 5, 0.5, -3), 0x5588aa);
    this._addBox('Crate_B', new THREE.Vector3(-4, 0.5, -6), 0xaa5544);
    this._addBox('Crate_C', new THREE.Vector3( 2, 0.5,  8), 0x44aa55);

    // ── Imported meshes ──
    // Solid: the manifest entry carries `physics: 'static'`, which fits a box
    // to the bounds measured at load.
    this.spawnModel('model:desk', { name: 'Desk', position: [0, 0, -3] });

    // ── Player ──
    this._buildPlayer();
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
   * @param {number} [opts.scale]            Uniform scale on top of the manifest's.
   * @param {import('./ColliderSpec.js').PhysicsSpec|string} [opts.physics]
   *        Per-spawn override, merged over the manifest's block. Handy for one
   *        crate that should be dynamic when the rest are scenery.
   * @returns {GameObject}
   */
  spawnModel(key, opts = {}) {
    const { name, position = [0, 0, 0], rotationY = 0, scale = 1, physics } = opts;

    const go = new GameObject(name ?? key);
    go.object3d.add(this.assets.instantiate(key));
    go.object3d.position.set(position[0], position[1], position[2]);
    go.object3d.rotation.y = rotationY;
    if (scale !== 1) go.object3d.scale.setScalar(scale);

    this._attachPhysics(go, key, { position, rotationY, scale, physics });

    this._rootObjects.push(go);
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

    // Static props never move, so they stay out of the interpolation map.
    if (resolved.body !== 'static') this.rigidBodyMap.set(go.rigidBody.handle, go);
  }

  /** Helper: spawn a physics-backed box GameObject. */
  _addBox(name, pos, color) {
    const go = new GameObject(name);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color }),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    go.object3d.add(mesh);
    go.object3d.position.copy(pos);

    const rb = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setLinvel(0, 0, 0),
    );
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), rb);
    go.rigidBody = rb;
    this.rigidBodyMap.set(rb.handle, go);

    this._rootObjects.push(go);
    return go;
  }

  // ──────────────────────────────────────────
  // Player – first-person character controller
  // ──────────────────────────────────────────
  _buildPlayer() {
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

    const rb = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(0, 1, 5)
        .lockRotations(),
    );
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(capsuleHalf, capsuleR),
      rb,
    );

    player.rigidBody = rb;
    player.collider  = col;

    // ── FirstPersonController component ──
    const ctrl = new FirstPersonController(controller, {
      speed: 5,
      jumpForce: 4,
      sensitivity: 0.002,
    });
    ctrl.camera = this.camera;

    player.addComponent(ctrl);
    this._rootObjects.push(player);
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

    // Interpolation factor: how far we are between the last two physics steps
    const alpha = this._accumulator / Engine.FIXED_DT;
    this._interpolatePhysics(alpha);

    // ── Variable update ──
    for (const obj of this._rootObjects) obj._update(frameDt);

    // ── Late update (post-update, camera, etc.) ──
    for (const obj of this._rootObjects) obj._lateUpdate(frameDt);

    // ── Render ──
    this.renderer.render(this.scene, this.camera);

    // Consume mouse deltas after all updates
    this.input.mouse.dx = 0;
    this.input.mouse.dy = 0;
  };

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
      // Only interpolate dynamic bodies; kinematics (Player) are
      // driven every frame by their controller, so snapping is fine.
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
