import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';
import { createMarsSky, directionFromAngles, DEFAULT_MOONS } from '../gameobjects/MarsSky.js';
import { createMarsTerrain, terrainHeightAt } from '../gameobjects/MarsTerrain.js';
import { createMarsRocks } from '../gameobjects/MarsRocks.js';
import { SkyFollow } from '../components/SkyFollow.js';
import { DreamWalk } from '../components/DreamWalk.js';
import { Component } from '../core/Component.js';
import { FatigueOverlay } from '../ui/FatigueOverlay.js';
import { BaseScene } from './BaseScene.js';
import { wakeInto } from './dreamWake.js';

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

/** The light on the ridge, straight down the player's view: something to
 *  walk towards that the base never lets you reach. Metres from the base. */
const BEACON = { distance: 300, mast: 16, glow: 1.4, halo: 5 };
/** Its colour, level by level: a warm lamp that turns red. */
const BEACON_COLORS = [0xffc27a, 0xff8a4a, 0xff2a1a];


/** The beacon's breathing: the halo swells and fades, slowly. */
class BeaconPulse extends Component {
  constructor(halo) {
    super();
    this.halo = halo;
    this._t = 0;
  }

  onUpdate(dt) {
    this._t += dt;
    const k = 0.5 + 0.5 * Math.sin(this._t * 1.3);
    this.halo.material.opacity = 0.25 + 0.35 * k;
    this.halo.scale.setScalar(0.85 + 0.3 * k);
  }
}

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
    this._addRocks();
    this._addLighting();
    this._addBase();
    this._addBeacon();
    this._spawnPlayer();
    this._addWalk();

    // Eyes open: falling asleep in the bunk shuts the eyelids (BedRest), and
    // nothing in the dream would ever open them again.
    new FatigueOverlay().clear();
  }

  /** Wake: back to the base, on the night the dream came from. DreamWalk
   *  has already covered the screen; wakeInto holds the black, captioned
   *  with the night, until the base is ready to be seen.
   *  @returns {Promise<void>} */
  wake() {
    return wakeInto(this.engine, DreamScene.returnTo, { night: this.night });
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

  /** The valley's rock field, round the dream's base: something on the
   *  ground to watch go by, so walking — and slowing down — can be seen. The
   *  first playtest had bare black ground and read as not moving at all. */
  _addRocks() {
    const rocks = createMarsRocks({ footprint: { halfX: BASE.width / 2, halfZ: BASE.depth / 2 } });
    this._root.addChild(rocks);
    this._ownAll(rocks);
    this.rocks = rocks;
  }

  _addLighting() {
    // Bright enough to see the valley floor by: a dream's moonlight, a
    // touch violet. The first playtest was near black underfoot.
    const ambient = new GameObject('DreamAmbient');
    ambient.object3d.add(new THREE.AmbientLight(0x5a5070, 1.1));
    this._root.addChild(ambient);

    // The moon, from where Phobos stands at midnight; no shadow — cheap,
    // and the dream needn't be exact.
    const moonGO = new GameObject('DreamMoon');
    const moon = new THREE.DirectionalLight(0xd8d0ec, 1.5);
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

  /** The light on the ridge (Ryan's idea): a mast with a glowing lamp,
   *  straight down the player's first view and far past where the base
   *  pulls them back — the thing they want to reach and never do. The lamp
   *  and its halo ignore the fog, so it shows through the thickest dream. */
  _addBeacon() {
    const color = new THREE.Color(BEACON_COLORS[Math.min(Math.max(this.level, 1), 3) - 1]);
    this.beaconColor = color;
    // Straight out from the spawn, the way the player faces.
    const dir = new THREE.Vector2(SPAWN[0], SPAWN[2]).normalize();
    const x = dir.x * BEACON.distance;
    const z = dir.y * BEACON.distance;
    const ground = terrainHeightAt(x, z);

    const beacon = new GameObject('DreamBeacon');
    beacon.object3d.position.set(x, ground, z);
    const metal = this._own(new THREE.MeshStandardMaterial({ color: 0x0c0b10, roughness: 0.8 }));
    const mast = new THREE.Mesh(this._own(new THREE.CylinderGeometry(0.15, 0.3, BEACON.mast, 8)), metal);
    mast.position.y = BEACON.mast / 2;
    const lampMat = this._own(new THREE.MeshBasicMaterial({ color, fog: false }));
    const lamp = new THREE.Mesh(this._own(new THREE.SphereGeometry(BEACON.glow, 16, 12)), lampMat);
    lamp.position.y = BEACON.mast;
    const haloMat = this._own(new THREE.MeshBasicMaterial({
      color, fog: false, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    const halo = new THREE.Mesh(this._own(new THREE.SphereGeometry(BEACON.halo, 16, 12)), haloMat);
    halo.position.y = BEACON.mast;
    beacon.object3d.add(mast, lamp, halo);
    beacon.addComponent(new BeaconPulse(halo));
    this._root.addChild(beacon);
    this.beacon = beacon;
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
