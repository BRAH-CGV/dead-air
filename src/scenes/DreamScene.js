import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';
import { createMarsSky, directionFromAngles, DEFAULT_MOONS } from '../gameobjects/MarsSky.js';
import { createMarsTerrain, terrainHeightAt } from '../gameobjects/MarsTerrain.js';
import { createMarsRocks } from '../gameobjects/MarsRocks.js';
import { createBunkerShell, roundedRect, BUNKER } from '../gameobjects/BunkerShell.js';
import { SkyFollow } from '../components/SkyFollow.js';
import { DreamWalk } from '../components/DreamWalk.js';
import { Component } from '../core/Component.js';
import { FatigueOverlay } from '../ui/FatigueOverlay.js';
import { DreamMusic } from '../components/DreamMusic.js';
import { DreamWind } from '../components/DreamWind.js';
import { DreamFilter } from '../core/DreamFilter.js';
import { BaseScene } from './BaseScene.js';
import { wakeInto } from './dreamWake.js';

// ─────────────────────────────────────────────
// DreamScene  –  the walk that pulls you back (#101)
// ─────────────────────────────────────────────
// The operator dreams they are outside: the valley at night, the base
// behind them, its one window lit. They can walk away from it,
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

/** The base, as the dream has it: the real building's outside, the bunker
 *  shell, from the base scene's own outline (BaseScene's `bunkerSpec`;
 *  BaseScene.bunker.test.js keeps the two the same, so a change to the
 *  rooms shows up there). There are no rooms in it: the two walls the shell
 *  leaves to them, the window's and the hatch's, are closed here. Metres. */
export const BASE_SHELL = {
  outline: [
    { x: -16.3, z: -3.1 }, { x: -6.1, z: -3.1 }, { x: -6.1, z: -5.1, flat: true }, { x: 6.1, z: -5.1 },
    { x: 6.1, z: -3.1 }, { x: 16.3, z: -3.1 }, { x: 16.3, z: 5.1 }, { x: 3.3, z: 5.1 },
    { x: 3.3, z: 8.1, flat: true }, { x: 0.7, z: 8.1 }, { x: 0.7, z: 5.1 }, { x: -16.3, z: 5.1 },
  ],
  height: 3.2,
  roofProps: [
    { kind: 'stack', x: -14.4, z: -1.5 },
    { kind: 'vent', x: 13.2, z: 0 },
    { kind: 'vent', x: -3, z: 1, rotationY: Math.PI / 2 },
  ],
  louvres: [
    { edge: 6, at: 1.5, y: 2.2, width: 1.3, height: 0.5 },
    { edge: 6, at: 4.7, y: 2.2, width: 1.3, height: 0.5 },
    { edge: 10, at: 12.3, y: 2.2, width: 1.3, height: 0.5 },
    { edge: 10, at: 15.5, y: 2.2, width: 1.3, height: 0.5 },
    { edge: 5, at: 1.6, y: 2.2, width: 1.3, height: 0.5 },
    { edge: 11, at: 6.6, y: 2.2, width: 1.3, height: 0.5 },
  ],
  embrasures: [{ edge: 2, at: 6.1, sill: 0.475, width: 8.5, height: 2.35, radius: 0.45 }],
};

/** The outline's bounding box, its middle and half its size each way: what
 *  the walk measures from (DreamWalk's `base`), so the pull lets go outside
 *  even the long wings. */
const FOOTPRINT = (() => {
  const xs = BASE_SHELL.outline.map(p => p.x), zs = BASE_SHELL.outline.map(p => p.z);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, halfX: (x1 - x0) / 2, halfZ: (z1 - z0) / 2 };
})();

/** What the dream adds to the shell. Metres. `wall`: the closed walls'
 *  thickness; `door`: the shut hatch (width, height, thickness); `glow`: the
 *  lit window, the block's, kept; `pane`: the glass's stand-off from the
 *  wall, inside the embrasure's collar; `spawn`: how far out of the hatch
 *  the player stands. */
const CLOSE = {
  wall: 0.3,
  door: [1.1, 2.2, 0.06],
  glow: { color: 0xffb36b, intensity: 1.4 },
  pane: 0.02,
  spawn: 3,
};

/** The light on the ridge, straight down the player's view: something to
 *  walk towards that the base never lets you reach. Metres from the spawn. */
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
    // The spooky music, creeping in under the dream.
    root.addComponent(new DreamMusic());
    // The wind rushing past as the base drags the dreamer back.
    root.addComponent(new DreamWind({ walk: this.walk }));

    // The dream's look: desaturated with subtle cel-shading.
    this._dreamFilter = new DreamFilter();
    this._dreamFilter.attach(this.engine);
    this._dreamFilter.setIntensity(1);
    this.engine.postProcess = this._dreamFilter;

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
    if (this._dreamFilter) {
      if (this.engine.postProcess === this._dreamFilter) {
        this.engine.postProcess = null;
      }
      this._dreamFilter.dispose();
      this._dreamFilter = null;
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
    // Kept off the building as the base scene's are: half extents about
    // the middle.
    const halfX = Math.max(...BASE_SHELL.outline.map(p => Math.abs(p.x)));
    const halfZ = Math.max(...BASE_SHELL.outline.map(p => Math.abs(p.z)));
    const rocks = createMarsRocks({ footprint: { halfX, halfZ } });
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

  /** The base: the bunker shell, solid, its window lit, and the two walls
   *  it leaves to the rooms closed in its concrete. Places the spawn,
   *  outside the hatch. */
  _addBase() {
    const shell = createBunkerShell({ engine: this.engine, ...BASE_SHELL });
    for (const resource of shell.resources) this._own(resource);
    this._root.addChild(shell);
    this.base = shell;

    const windows = new Set(BASE_SHELL.embrasures.map(w => w.edge));
    let hatch = null;
    for (const edge of shell.faces.edges.filter(e => e.flat)) {
      this._closeWall(shell, edge);
      if (!windows.has(edge.i)) hatch = edge;
    }
    for (const w of BASE_SHELL.embrasures) this._addWindow(shell, shell.faces.edges[w.edge], w);
    this._addHatch(shell, hatch);

    // In the dream's fog, as the block was: the base scene keeps the fog off
    // its building, but here the fog is what swallows the base as you walk.
    shell.object3d.traverse(o => { if (o.isMesh) o.material.fog = true; });

    // Out of the hatch, facing straight out of it: forward at yaw is (-sin, -cos).
    const { x, z } = this._onEdge(hatch, hatch.len / 2, CLOSE.spawn);
    this._spawn = {
      position: [x, 1, z],
      facing: hatch.normal,
      yaw: Math.atan2(-hatch.normal[0], -hatch.normal[1]),
    };
  }

  /** A point on `edge`: `along` it from its start and `out` from its face,
   *  and the yaw that turns a part's local +Z out of the wall. */
  _onEdge(edge, along, out) {
    const { a, dir, normal } = edge;
    return {
      x: a.x + dir[0] * along + normal[0] * out,
      z: a.z + dir[1] * along + normal[1] * out,
      yaw: Math.atan2(normal[0], normal[1]),
    };
  }

  /** A flat edge walled, floor to roof, in the slopes' concrete, its outer
   *  face on the outline; solid as the slopes are, up past the roof. */
  _closeWall(shell, edge) {
    const { height } = BASE_SHELL;
    const t = CLOSE.wall;
    const { x, z, yaw } = this._onEdge(edge, edge.len / 2, -t / 2);
    const wall = new THREE.Mesh(this._own(new THREE.BoxGeometry(edge.len, height, t)));
    wall.name = 'DreamWall';
    wall.position.set(x, height / 2, z);
    wall.rotation.y = yaw;
    shell.object3d.add(wall);
    shell.clad(wall);

    const top = height + BUNKER.climbGuard;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const desc = RAPIER.ColliderDesc.cuboid(edge.len / 2, top / 2, t / 2)
      .setTranslation(x, top / 2, z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    shell.colliders.push(this.engine.world.createCollider(desc, shell.rigidBody));
  }

  /** The window's glass, lit warm from inside: just proud of the wall, in
   *  the embrasure's steel collar. */
  _addWindow(shell, edge, { at, sill, width, height, radius }) {
    const contour = roundedRect({ x0: -width / 2, x1: width / 2, y0: sill, y1: sill + height, r: radius });
    const shape = new THREE.Shape(contour.map(([u, v]) => new THREE.Vector2(u, v)));
    const glass = this._own(new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: CLOSE.glow.color, emissiveIntensity: CLOSE.glow.intensity,
    }));
    const pane = new THREE.Mesh(this._own(new THREE.ShapeGeometry(shape)), glass);
    pane.name = 'DreamWindow';
    const { x, z, yaw } = this._onEdge(edge, at, CLOSE.pane);
    pane.position.set(x, 0, z);
    pane.rotation.y = yaw;
    shell.object3d.add(pane);
  }

  /** The hatch: a dark steel door, shut, in the middle of its wall. */
  _addHatch(shell, edge) {
    const [w, h, t] = CLOSE.door;
    const steel = this._own(new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.7, metalness: 0.5 }));
    const door = new THREE.Mesh(this._own(new THREE.BoxGeometry(w, h, t)), steel);
    door.name = 'DreamHatch';
    const { x, z, yaw } = this._onEdge(edge, edge.len / 2, t / 2);
    door.position.set(x, h / 2, z);
    door.rotation.y = yaw;
    shell.object3d.add(door);
  }

  /** The light on the ridge (Ryan's idea): a mast with a glowing lamp,
   *  straight down the player's first view and far past where the base
   *  pulls them back — the thing they want to reach and never do. The lamp
   *  and its halo ignore the fog, so it shows through the thickest dream. */
  _addBeacon() {
    const color = new THREE.Color(BEACON_COLORS[Math.min(Math.max(this.level, 1), 3) - 1]);
    this.beaconColor = color;
    // Straight out from the spawn, the way the player faces.
    const { position, facing } = this._spawn;
    const x = position[0] + facing[0] * BEACON.distance;
    const z = position[2] + facing[1] * BEACON.distance;
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
    // Out of the hatch, facing away from the base, down the valley.
    const { position, yaw } = this._spawn;
    engine.buildPlayer({ position });
    engine.playerController?.teleport?.(position, { yaw, pitch: 0 });
  }

  _addWalk() {
    const { engine } = this;
    const walkGO = new GameObject('DreamWalk');
    this.walk = walkGO.addComponent(new DreamWalk({
      level: this.level,
      base: FOOTPRINT,
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
