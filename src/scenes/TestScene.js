import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';

// ─────────────────────────────────────────────
// TestScene  –  A simple outdoor corridor for testing scene switching
// ─────────────────────────────────────────────
// Visually distinct from OfficeScene: open-air corridor with coloured walls,
// a different prop layout, and outdoor lighting.  Use this to verify that
// engine.loadScene() properly tears down the old scene and builds a new one.

export class TestScene extends Scene {

  build() {
    // ── Create hierarchy groups ──
    const sceneRoot = new GameObject('SceneRoot');
    sceneRoot.makeGroup();
    this.engine._rootObjects.push(sceneRoot);
    this.engine.scene.add(sceneRoot.object3d);

    const corridor = new GameObject('Corridor');
    corridor.makeGroup();
    sceneRoot.addChild(corridor);

    const outside = new GameObject('Outside');
    outside.makeGroup();
    sceneRoot.addChild(outside);

    const lighting = new GameObject('Lighting');
    lighting.makeGroup();
    sceneRoot.addChild(lighting);

    this._sceneRoot = sceneRoot;
    this._corridor = corridor;
    this._outside = outside;
    this._lighting = lighting;

    this._addLighting();
    this._addGround();
    this._addCorridorWalls();
    this._addProps();

    this.engine.buildPlayer();
  }

  dispose() {
    // Future: free scene-specific GPU resources
  }

  // ──────────────────────────────────────────
  // Lighting — warm outdoor feel
  // ──────────────────────────────────────────
  _addLighting() {
    const ambientGO = new GameObject('AmbientLight');
    ambientGO.object3d.add(new THREE.AmbientLight(0x887766, 0.8));
    this._lighting.addChild(ambientGO);

    const sunGO = new GameObject('SunLight');
    const sun = new THREE.DirectionalLight(0xffe0b0, 2.2);
    sun.position.set(5, 10, -5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near   =  0.5;
    sun.shadow.camera.far    = 30;
    sun.shadow.camera.left   = -12;
    sun.shadow.camera.right  =  12;
    sun.shadow.camera.top    =  12;
    sun.shadow.camera.bottom = -12;
    sunGO.object3d.add(sun);
    this._lighting.addChild(sunGO);
  }

  // ──────────────────────────────────────────
  // Ground
  // ──────────────────────────────────────────
  _addGround() {
    const { world, assets } = this.engine;

    const groundGO = new GameObject('Ground');
    const groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({
        color: 0x556655,
        roughness: 0.95,
        map: assets.get('tex:floor-basecolor'),
        normalMap: assets.get('tex:floor-normal'),
        normalScale: new THREE.Vector2(0.5, 0.5),
      }),
    );
    groundMesh.rotation.x    = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    groundGO.object3d.add(groundMesh);
    this._outside.addChild(groundGO);

    const groundBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(30, 0.1, 30).setTranslation(0, -0.1, 0),
      groundBody,
    );
  }

  // ──────────────────────────────────────────
  // Corridor walls — long open corridor, very different from the office
  // ──────────────────────────────────────────
  _addCorridorWalls() {
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x664433,
      roughness: 0.9,
    });
    const corridorLength = 20;
    const corridorWidth  = 4;
    const wallHeight     = 3.5;
    const wallThick      = 0.25;

    // Left wall
    this._addStaticBox('Wall_Left',
      [-corridorWidth / 2, wallHeight / 2, 0],
      [wallThick, wallHeight, corridorLength],
      wallMat, this._corridor);

    // Right wall
    this._addStaticBox('Wall_Right',
      [corridorWidth / 2, wallHeight / 2, 0],
      [wallThick, wallHeight, corridorLength],
      wallMat, this._corridor);

    // Back wall (solid)
    this._addStaticBox('Wall_Back',
      [0, wallHeight / 2, -corridorLength / 2],
      [corridorWidth, wallHeight, wallThick],
      wallMat, this._corridor);

    // Ceiling
    const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x443322, roughness: 0.85 });
    this._addStaticBox('Ceiling',
      [0, wallHeight + wallThick / 2, 0],
      [corridorWidth, wallThick, corridorLength],
      ceilingMat, this._corridor);
  }

  // ──────────────────────────────────────────
  // Props — different arrangement from OfficeScene
  // ──────────────────────────────────────────
  _addProps() {
    // Server rack at the far end of the corridor
    const server = this.engine.spawnModel('model:server-rack', {
      name: 'ServerRack',
      position: [0, 0, -8],
      rotationY: Math.PI,
      scale: 0.333,
    });
    this._corridor.addChild(server);

    // Radar terminal against the left wall
    const radar = this.engine.spawnModel('model:radar-terminal', {
      name: 'RadarTerminal',
      position: [-1.5, 0, -3],
      rotationY: Math.PI / 2,
      scale: 0.478,
    });
    this._corridor.addChild(radar);

    // Security camera looking down the corridor
    const cam = this.engine.spawnModel('model:security-camera', {
      name: 'SecurityCamera_Corridor',
      position: [0, 3, 5],
      scale: 0.339,
      physics: 'none',
    });
    cam.object3d.rotation.set(Math.PI / 4, 0, 0);
    this._corridor.addChild(cam);
  }

  // ──────────────────────────────────────────
  // Helper — same pattern as OfficeScene._addStaticBox
  // ──────────────────────────────────────────
  _addStaticBox(name, position, size, material, parent) {
    const { world } = this.engine;

    const go = new GameObject(name);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    go.object3d.add(mesh);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(...position),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2),
      body,
    );

    if (parent) parent.addChild(go);
    return go;
  }
}
