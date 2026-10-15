import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Component } from '../core/Component.js';
import { Scene } from '../core/Scene.js';
import { createMarsSky, directionFromAngles, DEFAULT_MOONS } from '../gameobjects/MarsSky.js';
import { createMarsTerrain } from '../gameobjects/MarsTerrain.js';
import { createMarsRocks } from '../gameobjects/MarsRocks.js';
import { DustStorm } from '../gameobjects/DustStorm.js';
import { DustEye } from '../gameobjects/DustEye.js';
import { SkyFollow } from '../components/SkyFollow.js';
import { DreamDustEyes, DREAM_EYES } from '../gameplay/DreamDustEyes.js';
import { SANDSTORM, WIND_DIRECTION } from '../gameplay/Sandstorm.js';
import { WhiteOut } from '../ui/WhiteOut.js';
import { BaseScene } from './BaseScene.js';

// ─────────────────────────────────────────────
// DreamCraterScene  –  the dream in the empty crater
// ─────────────────────────────────────────────
// The operator dreams they are outside, but the base is gone — just the
// empty crater, a full sandstorm, and things watching from the dust. At
// least a dozen dust-eye entities stand in a ring around the player; they
// only attack if looked at directly. Survive a minute and the dream fades;
// get caught and the player wakes with 60 % stamina.
//
//   engine.loadScene(DreamCraterScene, { sceneOptions: { night: 2 } });
//
// Reached from the developer console (`dreamcrater`); hooking it into the
// between-nights flow comes later.
// ─────────────────────────────────────────────

/** Tuning. */
export const DREAM_CRATER = {
  /** Seconds the player must survive to wake. */
  surviveSeconds: 60,
};

/** Where the player stands: the crater centre. */
const SPAWN = [0, 1, 0];

// ── Per-frame system ─────────────────────────
// Ticks the survival timer and the dust storm each frame.

class DreamCraterSystem extends Component {
  constructor({ scene }) {
    super();
    this._scene = scene;
  }
  onUpdate(dt) {
    this._scene._tickSurvival(dt);
    this._scene._tickDust(dt);
  }
}

const CAUGHT_SCREEN = { tone: 'blood', fadeMs: 0, redMs: 2500, messageDelayMs: 2200 };

export class DreamCraterScene extends Scene {
  /** The scene the dreamer wakes into. */
  static returnTo = BaseScene;

  /** GPU resources this scene made. */
  _owned = [];

  /**
   * @param {import('../core/Engine.js').Engine} engine
   * @param {{ night?: number }} [opts]
   */
  constructor(engine, { night = 1 } = {}) {
    super(engine);
    this.night = night;
  }

  build() {
    const { engine } = this;
    const root = new GameObject('DreamCraterRoot').makeGroup();
    engine._rootObjects.push(root);
    engine.scene?.add?.(root.object3d);
    this._root = root;

    this._addSky();
    this._addTerrain();
    this._addRocks();
    this._addLighting();
    this._addFog();
    this._addDust();
    this._spawnPlayer();
    this._addDustEyes();
    this._addSurvival();
  }

  /** Survived: fade to black, then back to the base. */
  wake() {
    if (this._state !== 'watching') return;
    this._state = 'waking';
    const done = () => this._returnToBase(false);
    if (!this.engine.screenFade?.play?.(done)) done();
  }

  /** Caught: blood screen, then back to the base with the stamina penalty. */
  _catch() {
    if (this._state !== 'watching') return;
    this._state = 'caught';
    // Stop the eyes where they are.
    for (const slot of this.dustEyes?.slots ?? []) {
      if (slot.phase !== 'off') slot.go.setFade(0);
    }
    this._whiteOut ??= new WhiteOut();
    this._whiteOut.play('', CAUGHT_SCREEN);
    const delay = Math.max(CAUGHT_SCREEN.redMs, CAUGHT_SCREEN.messageDelayMs) + 800;
    this._catchTimer = setTimeout(() => this._returnToBase(true), delay);
  }

  /** Back to the base. Deferred a tick — the dream ends inside a frame. */
  _returnToBase(died) {
    const { engine } = this;
    const night = this.night;
    queueMicrotask(() => {
      engine.loadScene(DreamCraterScene.returnTo);
      if (night > 1) engine.activeScene?.nights?.setNight?.(night);
      if (died) engine._dreamCraterDeath = true;
    });
  }

  dispose() {
    const fog = this.engine.scene?.fog;
    if (fog && this._prevFog) {
      fog.density = this._prevFog.density;
      fog.color.setHex(this._prevFog.color);
    }
    this._whiteOut?.clear();
    clearTimeout(this._catchTimer);
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
    // Full storm: stars and moons lost.
    sky.setStorm?.(1);

    const fog = this.engine.scene?.fog;
    if (fog) {
      this._prevFog = { density: fog.density, color: fog.color.getHex() };
      fog.color.set(0x4c2818);   // dark storm brown
    }
  }

  _addTerrain() {
    const terrain = createMarsTerrain(this.engine.world);
    terrain.object3d.position.y = -0.01;
    this._root.addChild(terrain);
    this._ownAll(terrain);
    this.terrain = terrain;
  }

  /** The valley's rock field — small footprint since there is no base. */
  _addRocks() {
    const rocks = createMarsRocks({ footprint: { halfX: 6, halfZ: 6 } });
    this._root.addChild(rocks);
    this._ownAll(rocks);
    this.rocks = rocks;
  }

  _addLighting() {
    // Dimmer than the walk dream — the storm blots out most of the light.
    const ambient = new GameObject('DreamCraterAmbient');
    ambient.object3d.add(new THREE.AmbientLight(0x3a3040, 0.6));
    this._root.addChild(ambient);

    const moonGO = new GameObject('DreamCraterMoon');
    const moon = new THREE.DirectionalLight(0xd8d0ec, 0.3);
    const { azimuth, elevation } = DEFAULT_MOONS.phobos;
    moon.position.copy(directionFromAngles(azimuth, elevation)).multiplyScalar(30);
    moon.castShadow = false;
    moonGO.object3d.add(moon, moon.target);
    this._root.addChild(moonGO);
    this.moonLight = moon;
  }

  /** Thick brown fog — the sandstorm. */
  _addFog() {
    const scene = this.engine.scene;
    if (!scene) return;
    // _addSky already saved the previous fog and set the colour.
    // Now set the density.
    scene.fog = new THREE.FogExp2(0x4c2818, SANDSTORM.fogDensity);
  }

  /** GPU-driven dust grit around the player. No cutouts — no base. */
  _addDust() {
    const dust = new DustStorm();
    this._root.addChild(dust);
    this._ownAll(dust);
    dust.setLevel(1);
    const angle = Math.atan2(WIND_DIRECTION[1], WIND_DIRECTION[0]);
    dust.setWind(angle, SANDSTORM.windSpeed);
    this.dust = dust;
  }

  _spawnPlayer() {
    const { engine } = this;
    engine.buildPlayer({ position: SPAWN });
    engine.playerController?.teleport?.(SPAWN, { yaw: 0, pitch: 0 });
  }

  /** Build the dust-eye pool and the manager. */
  _addDustEyes() {
    const { engine } = this;
    const pool = [];
    for (let i = 0; i < DREAM_EYES.poolSize; i++) {
      const eye = new DustEye(`DreamEye${i}`);
      eye.object3d.visible = false;
      pool.push(eye);
      this._root.addChild(eye);
      this._ownAll(eye);
    }
    const eyesGO = new GameObject('DreamDustEyes');
    this.dustEyes = eyesGO.addComponent(new DreamDustEyes({
      pool,
      hooks: {
        eyePosition: (out) => {
          const pos = engine.playerController?.gameObject?.object3d?.position ?? engine.player?.object3d?.position;
          if (pos) { out.copy(pos); out.y += 1.6; }   // eye height
          return out;
        },
        viewDirection: (out) => {
          engine.camera?.getWorldDirection?.(out);
          return out;
        },
        onCatch: () => this._catch(),
      },
      fog: engine.scene?.fog ?? null,
    }));
    this._root.addChild(eyesGO);
  }

  /** The survival timer + dust storm tick. */
  _addSurvival() {
    this._state = 'watching';
    this._elapsed = 0;
    const sysGO = new GameObject('DreamCraterSystem');
    sysGO.addComponent(new DreamCraterSystem({ scene: this }));
    this._root.addChild(sysGO);
  }

  /** Called each frame by DreamCraterSystem. */
  _tickSurvival(dt) {
    if (this._state !== 'watching') return;
    this._elapsed += dt;
    if (this._elapsed >= DREAM_CRATER.surviveSeconds) this.wake();
  }

  /** Keep the dust grains drifting. */
  _tickDust(dt) {
    if (!this.dust) return;
    const ear = this.engine.playerController?.gameObject?.object3d?.position
      ?? this.engine.player?.object3d?.position;
    if (ear) this.dust.tick(dt, ear);
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
