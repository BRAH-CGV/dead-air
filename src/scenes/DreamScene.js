import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';
import { createMarsSky, directionFromAngles, DEFAULT_MOONS } from '../gameobjects/MarsSky.js';
import { createMarsTerrain } from '../gameobjects/MarsTerrain.js';
import { SkyFollow } from '../components/SkyFollow.js';
import { DreamWalk } from '../components/DreamWalk.js';
import { BaseScene } from './BaseScene.js';

// ─────────────────────────────────────────────
// DreamScene  –  the walk that pulls you back (#101)
// ─────────────────────────────────────────────
// The operator dreams they are outside: the valley at night, the base a
// dark block behind them with one lit window. They can walk away from it,
// but not far: DreamWalk slows them, thickens the fog and turns the sky,
// then drags them back, and they wake. `level` (1-3) is how unhinged it
// is, one a night (gameplay/dream.js).
//
//   engine.loadScene(DreamScene, { sceneOptions: { level: 2, night: 2 } });
//
// Waking loads `returnTo` (BaseScene) and puts it back on `night`. For now
// the dream is reached from the developer console (`dream`); hooking it in
// between the nights comes later.
// ─────────────────────────────────────────────

/** The base, as the dream has it: just a block. Metres. */
const BASE = { width: 12, height: 3.2, depth: 9 };
/** Where the player stands: just outside the front, facing away. */
const SPAWN = [0, 1, BASE.depth / 2 + 3];

export class DreamScene extends Scene {
  /** The scene the dreamer wakes into. */
  static returnTo = BaseScene;

  /** GPU resources this scene made. */
  _owned = [];

  /**
   * @param {import('../core/Engine.js').Engine} engine
   * @param {{ level?: number, night?: number }} [opts]
   */
  constructor(engine, { level = 1, night = level } = {}) {
    super(engine);
    this.level = level;
    this.night = night;
  }

  build() {
    const { engine } = this;
    const root = new GameObject('DreamRoot').makeGroup();
    engine._rootObjects.push(root);
    engine.scene?.add?.(root.object3d);
    this._root = root;

    this._addSky();
    this._addTerrain();
    this._addLighting();
    this._addBase();
    this._spawnPlayer();
    this._addWalk();
  }

  /** Wake: back to the base, on the night the dream came from. Deferred a
   *  tick — the dream ends inside a frame, and a scene can't be swapped
   *  out from under the loop that is updating it. */
  wake() {
    const { engine } = this;
    const night = this.night;
    queueMicrotask(() => {
      engine.loadScene(DreamScene.returnTo);
      if (night > 1) engine.activeScene?.nights?.setNight?.(night);
    });
  }

  dispose() {
    const fog = this.engine.scene?.fog;
    if (fog && this._prevFog) {
      fog.density = this._prevFog.density;
      fog.color.setHex(this._prevFog.color);
    }
    for (const resource of this._owned) resource.dispose();
    this._owned.length = 0;
  }

  // ── Building ──────────────────────────────

  _addSky() {
    const sky = createMarsSky();
    sky.addComponent(new SkyFollow());
    this._root.addChild(sky);
    this._ownAll(sky);
    this.sky = sky;

    const fog = this.engine.scene?.fog;
    if (fog) {
      this._prevFog = { density: fog.density, color: fog.color.getHex() };
      fog.color.set(0x241c24);   // a bruised horizon: not quite the real night
    }
  }

  _addTerrain() {
    const terrain = createMarsTerrain(this.engine.world);
    terrain.object3d.position.y = -0.01;
    this._root.addChild(terrain);
    this._ownAll(terrain);
    this.terrain = terrain;
  }

  _addLighting() {
    const ambient = new GameObject('DreamAmbient');
    ambient.object3d.add(new THREE.AmbientLight(0x3a3448, 0.6));
    this._root.addChild(ambient);

    // The moon, from where Phobos stands at midnight; no shadow — cheap,
    // and the dream needn't be exact.
    const moonGO = new GameObject('DreamMoon');
    const moon = new THREE.DirectionalLight(0xc8c0d8, 0.7);
    const { azimuth, elevation } = DEFAULT_MOONS.phobos;
    moon.position.copy(directionFromAngles(azimuth, elevation)).multiplyScalar(30);
    moon.castShadow = false;
    moonGO.object3d.add(moon, moon.target);
    this._root.addChild(moonGO);
    this.moonLight = moon;
  }

  /** The base: a dark block with one warm window on its front, solid. */
  _addBase() {
    const { width, height, depth } = BASE;
    const base = new GameObject('DreamBase');
    const wall = this._own(new THREE.MeshStandardMaterial({ color: 0x15131a, roughness: 1 }));
    const block = new THREE.Mesh(this._own(new THREE.BoxGeometry(width, height, depth)), wall);
    block.position.y = height / 2;
    const glass = this._own(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffb36b, emissiveIntensity: 1.4 }));
    const window_ = new THREE.Mesh(this._own(new THREE.PlaneGeometry(2.4, 1)), glass);
    window_.position.set(0, 1.6, depth / 2 + 0.01);
    base.object3d.add(block, window_);

    const { world } = this.engine;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, height / 2, 0));
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2), body);
    base.rigidBody = body;
    base.collider = collider;
    base.colliders = [collider];
    this.engine._bodyToGO?.set(body.handle, base);

    this._root.addChild(base);
    this.base = base;
  }

  _spawnPlayer() {
    const { engine } = this;
    engine.buildPlayer({ position: SPAWN });
    // Facing away from the base, down the valley: forward at yaw is (-sin, -cos).
    const yaw = Math.atan2(-SPAWN[0], -SPAWN[2]);
    engine.playerController?.teleport?.(SPAWN, { yaw, pitch: 0 });
  }

  _addWalk() {
    const { engine } = this;
    const walkGO = new GameObject('DreamWalk');
    this.walk = walkGO.addComponent(new DreamWalk({
      level: this.level,
      base: { x: 0, z: 0 },
      controller: engine.playerController,
      camera: engine.camera,
      sky: this.sky,
      fog: engine.scene?.fog ?? null,
      fade: engine.screenFade ?? null,
      onWake: () => this.wake(),
    }));
    this._root.addChild(walkGO);
  }

  _own(resource) {
    this._owned.push(resource);
    return resource;
  }

  _ownAll(go) {
    go.object3d.traverse((o) => {
      if (o.geometry) this._own(o.geometry);
      for (const m of [].concat(o.material ?? [])) this._own(m);
    });
  }
}
