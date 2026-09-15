import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';
import { Satellite } from '../gameobjects/Satellite.js';
import { RoomTransitionSystem } from '../components/RoomTransitionSystem.js';
import { MainOffice } from './rooms/MainOffice.js';
import { ServerRoom } from './rooms/ServerRoom.js';
import { LivingQuarters } from './rooms/LivingQuarters.js';
import { Corridor } from './rooms/Corridor.js';

// ─────────────────────────────────────────────
// BaseScene  –  the whole base as one continuous scene
// ─────────────────────────────────────────────
// Three rooms joined by corridors, plus the small outside area. Nothing is
// loaded per night: doors lock and unlock instead (night progression).
//
//   LivingQuarters ── corridor ── MainOffice ── corridor ── ServerRoom
//                                     │ front door
//                                  Outside (generator, satellite)
//
// The office sits at the origin. Everything else is placed from the rooms'
// own sizes and the office's doorway offsets, so resizing a room or moving
// a doorway re-flows the layout instead of leaving gaps: each corridor runs
// from the office's outer wall face to the side room's, and the side room
// slides its doorway to the corridor's line.
// ─────────────────────────────────────────────

const CORRIDOR_LENGTH = 4;
const CORRIDOR_WIDTH  = 2;
/** Side rooms' centre z. Their doorways slide to meet the corridor. */
const SIDE_ROOM_Z = 1;
const PLAYER_SPAWN = [0, 1, 2];

export class BaseScene extends Scene {
  /** @type {{MainOffice: MainOffice, ServerRoom: ServerRoom, LivingQuarters: LivingQuarters}} */
  rooms = {};
  /** @type {{OfficeToServer: Corridor, OfficeToQuarters: Corridor}} */
  corridors = {};

  /** GPU resources the scene itself created (ground, moon). */
  _owned = [];

  build() {
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
    this._addGround();
    this._addLighting();
    this._buildOutside();
    this._spawnPlayer();
  }

  /** Free what the rooms and the scene created. Bodies are left alone:
   *  Engine drops the whole physics world right after this. */
  dispose() {
    for (const part of [...Object.values(this.rooms), ...Object.values(this.corridors)]) {
      part.dispose({ removeBodies: false });
    }
    for (const resource of this._owned) resource.dispose();
    this._owned.length = 0;
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

    this.rooms = { MainOffice: office, ServerRoom: server, LivingQuarters: quarters };
    for (const room of Object.values(this.rooms)) this._sceneRoot.addChild(room.build());

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
  // Ground (shared by the whole base)
  // ──────────────────────────────────────────
  _addGround() {
    const { world, assets } = this.engine;

    const ground = new GameObject('Ground');
    const mesh = new THREE.Mesh(
      this._own(new THREE.PlaneGeometry(100, 100)),
      this._own(new THREE.MeshStandardMaterial({
        color: 0x8890a0,
        roughness: 0.9,
        map: assets.get('tex:floor-basecolor'),
        normalMap: assets.get('tex:floor-normal'),
        normalScale: new THREE.Vector2(0.8, 0.8),
      })),
    );
    mesh.rotation.x = -Math.PI / 2;
    // A hair below the room and corridor floors, whose tops sit at y = 0 —
    // coplanar faces would z-fight. The collider stays flush, so walking
    // out the front door is step-free.
    mesh.position.y = -0.01;
    mesh.receiveShadow = true;
    ground.object3d.add(mesh);
    this._outside.addChild(ground);

    // On the GameObject so teardown finds it — an orphan body would leak a
    // ghost floor on every reload.
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.1, 50), body);
    ground.rigidBody = body;
    ground.collider  = collider;
    ground.colliders = [collider];
    ground._originalSize = [100, 0.2, 100];
  }

  // ──────────────────────────────────────────
  // Global lighting (rooms light themselves)
  // ──────────────────────────────────────────
  _addLighting() {
    const ambientGO = new GameObject('AmbientLight');
    ambientGO.object3d.add(new THREE.AmbientLight(0x435472, 1.0));
    this._lighting.addChild(ambientGO);

    // Shadow frustum sized to the whole base, not just the office.
    const reach = Math.max(...Object.values(this.rooms).map(r => {
      const b = r.bounds();
      return Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z));
    })) + 2;

    const moonGO = new GameObject('MoonLight');
    const moon = new THREE.DirectionalLight(0x8fb7ff, 1.8);
    moon.position.set(-6, 8, -10);
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

    const visibleMoonGO = new GameObject('VisibleMoon');
    const visibleMoon = new THREE.Mesh(
      this._own(new THREE.SphereGeometry(0.85, 32, 16)),
      this._own(new THREE.MeshBasicMaterial({ color: 0xffe1a3 })),
    );
    visibleMoon.name = 'VisibleMoon';
    visibleMoon.position.set(-2.4, 5.3, -15);
    visibleMoonGO.object3d.add(visibleMoon);
    this._lighting.addChild(visibleMoonGO);

    const moonGlowGO = new GameObject('MoonGlow');
    const moonGlow = new THREE.PointLight(0xffe1a3, 5.0, 32, 1.4);
    moonGlow.position.copy(visibleMoon.position);
    moonGlowGO.object3d.add(moonGlow);
    this._lighting.addChild(moonGlowGO);
  }

  // ──────────────────────────────────────────
  // Outside area (night 3)
  // ──────────────────────────────────────────
  _buildOutside() {
    const { engine } = this;

    // Steerable dish tower. spawnModel registers it as a root object;
    // parented under Outside it's reached through SceneRoot instead, and
    // left in both it would slew at double speed.
    this.satellite = engine.spawnModel('model:dish_tower', {
      name: 'Satellite', position: [0, 0, -25], scale: 0.137, type: Satellite,
    });
    this._adopt(this._outside, this.satellite);
    this.satellite.targetYaw   = THREE.MathUtils.degToRad(45);
    this.satellite.targetPitch = THREE.MathUtils.degToRad(-25);

    // Generator stand-in until generator.glb arrives (asset list, P1). Out
    // the office's front door, where the player has to go to cut power.
    this._addStandIn('Generator', 'generator.glb', [7, 0.8, 9], [2.0, 1.6, 1.2], 0x5a4a32);
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

    this._outside.addChild(go);
    return go;
  }

  // ──────────────────────────────────────────
  // Player
  // ──────────────────────────────────────────
  _spawnPlayer() {
    const { engine } = this;
    engine.buildPlayer({ position: PLAYER_SPAWN });
    engine.player.addComponent(new RoomTransitionSystem({
      doors: Object.values(this.rooms).flatMap(r => r.doors),
      rooms: Object.values(this.rooms),
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
