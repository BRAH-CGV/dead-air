import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';
import { Interactable } from '../components/Interactable.js';
import { SkyFollow } from '../components/SkyFollow.js';
import { Satellite } from '../gameobjects/Satellite.js';
import { createMarsSky } from '../gameobjects/MarsSky.js';

// ─────────────────────────────────────────────
// OfficeScene  –  The starting office level
// ─────────────────────────────────────────────

export class OfficeScene extends Scene {

  build() {
    // ── Create hierarchy groups ──
    const sceneRoot = new GameObject('SceneRoot');
    sceneRoot.makeGroup();
    this.engine._rootObjects.push(sceneRoot);
    this.engine.scene.add(sceneRoot.object3d);

    const office = new GameObject('Office');
    office.makeGroup();
    sceneRoot.addChild(office);

    const outside = new GameObject('Outside');
    outside.makeGroup();
    sceneRoot.addChild(outside);

    const lighting = new GameObject('Lighting');
    lighting.makeGroup();
    sceneRoot.addChild(lighting);

    // Store references for child methods
    this._sceneRoot = sceneRoot;
    this._office = office;
    this._outside = outside;
    this._lighting = lighting;

    this._addLighting();
    this._addSky();
    this._addGround();
    this._addWalls();
    this._addWindow();
    this._addOfficeFurniture();
    this._addProps();

    // ── Satellite (outside, steerable dish tower) ──
    // The dish tower spawns as a Satellite (GameObject subclass): its neck
    // slews toward targetYaw and its dish tilts toward targetPitch, never
    // faster than maxRotationSpeed — steering instead of spinning forever.
    this.satellite = this.engine.spawnModel('model:dish_tower', {
      name: 'Satellite',
      position: [0, 0, -25],
      scale: 0.137,
      type: Satellite,
    });
    this._outside.addChild(this.satellite);
    // Aim it off the shipped pose so the slew plays out on load. Gameplay
    // (the radar terminal) will steer these later.
    this.satellite.targetYaw   = THREE.MathUtils.degToRad(45);
    this.satellite.targetPitch = THREE.MathUtils.degToRad(-25);

    // ── Player (shared across all scenes) ──
    this.engine.buildPlayer();
  }
  
  dispose() {
    // Scene teardown never resets scene.fog, so hand back the colour _addSky
    // borrowed or the Mars horizon tint follows us into the next scene.
    if (this._prevFogColor !== undefined) {
      this.engine.scene.fog?.color.setHex(this._prevFogColor);
    }
    // Future: dispose level-specific GPU resources (lights, ground geom, etc.)
  }

  // ──────────────────────────────────────────
  // Lighting
  // ──────────────────────────────────────────
  _addLighting() {
    const { scene } = this.engine;
  
    const ambientGO = new GameObject('AmbientLight');
    ambientGO.object3d.add(new THREE.AmbientLight(0x435472, 1.0));
    this._lighting.addChild(ambientGO);
          
    const moonGO = new GameObject('MoonLight');
    const moon = new THREE.DirectionalLight(0x8fb7ff, 1.8);
    moon.position.set(-6, 8, -10);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.near   =  0.5;
    moon.shadow.camera.far    = 30;
    moon.shadow.camera.left   = -12;
    moon.shadow.camera.right  =  12;
    moon.shadow.camera.top    =  12;
    moon.shadow.camera.bottom = -12;
    moonGO.object3d.add(moon);
    this._lighting.addChild(moonGO);
  
    const ceilingLightGO = new GameObject('CeilingLight');
    const ceilingLight = new THREE.PointLight(0xffd8a8, 10.0, 24, 1.0);
    ceilingLight.position.set(0, 2.75, 0.4);
    ceilingLight.castShadow = true;
    ceilingLight.shadow.mapSize.set(1024, 1024);
    ceilingLightGO.object3d.add(ceilingLight);
    this._lighting.addChild(ceilingLightGO);
  
    const fixture = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.45, 0.08, 24),
      new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,
        emissive: 0xffc36b,
        emissiveIntensity: 1.8,
      }),
    );
    fixture.position.copy(ceilingLight.position);
    fixture.rotation.x = Math.PI / 2;
    ceilingLightGO.object3d.add(fixture);
  
    const deskGlowGO = new GameObject('DeskGlow');
    const deskGlow = new THREE.PointLight(0x66ccff, 2.8, 6, 1.6);
    deskGlow.position.set(0, 1.1, -2.1);
    deskGlowGO.object3d.add(deskGlow);
    this._lighting.addChild(deskGlowGO);
  
    const visibleMoonGO = new GameObject('VisibleMoon');
    const visibleMoon = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0xffe1a3 }),
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
  
  // ─────────────────────────────────────────
  // Ground (visual plane + static collider)
  // ──────────────────────────────────────────
  _addGround() {
    const { world, assets } = this.engine;

    const groundGO = new GameObject('Ground');
    const groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshStandardMaterial({
        color: 0x8890a0,
        roughness: 0.9,
        map: assets.get('tex:floor-basecolor'),
        normalMap: assets.get('tex:floor-normal'),
        normalScale: new THREE.Vector2(0.8, 0.8),
      }),
    );
    groundMesh.rotation.x    = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    groundGO.object3d.add(groundMesh);
    this._outside.addChild(groundGO);

    // Ground collider — attached to the GameObject so scene teardown can
    // find and remove it. An orphan body would leak a ghost floor on every
    // scene reload.
    const groundBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0),
    );
    const groundCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 0.1, 50).setTranslation(0, -0.1, 0),
      groundBody,
    );
    groundGO.rigidBody = groundBody;
    groundGO.colliders = [groundCollider];
    groundGO.collider  = groundCollider;
    groundGO._originalSize = [100, 0.2, 100];
  }

  // ──────────────────────────────────────────
  // Walls (visual + static colliders)
  // ──────────────────────────────────────────
  _addWalls() {
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x2f3945,
      roughness: 0.95,
    });
  
    // Room dimensions: 12m x 10m, walls 3m tall, 0.2m thick
    const roomWidth  = 12;
    const roomDepth  = 10;
    const wallHeight = 3;
    const wallThick  = 0.2;
    const backZ      = -roomDepth / 2;
    const frontZ     =  roomDepth / 2;
  
    // Back wall with a big centre window opening.
    const windowWidth  = 8.5;
    const windowHeight = 2.35;
    const windowY      = 1.65;
    const sideWidth    = (roomWidth - windowWidth) / 2;
    const lowerHeight  = windowY - windowHeight / 2;
    const upperHeight  = wallHeight - (windowY + windowHeight / 2);
  
    this._addStaticBox('BackWall_Left', [-windowWidth / 2 - sideWidth / 2, wallHeight / 2, backZ], [sideWidth, wallHeight, wallThick], wallMaterial, this._office);
    this._addStaticBox('BackWall_Right', [windowWidth / 2 + sideWidth / 2, wallHeight / 2, backZ], [sideWidth, wallHeight, wallThick], wallMaterial, this._office);
    this._addStaticBox('BackWall_Lower', [0, lowerHeight / 2, backZ], [windowWidth, lowerHeight, wallThick], wallMaterial, this._office);
    this._addStaticBox('BackWall_Upper', [0, windowY + windowHeight / 2 + upperHeight / 2, backZ], [windowWidth, upperHeight, wallThick], wallMaterial, this._office);
  
    // Front wall with a door opening. Explicit edges avoid skewed/overlapping segments.
    const doorWidth  = 1;
    const doorHeight = 2.2;
    const doorX      = 2;
    const doorLeft   = doorX - doorWidth / 2;
    const doorRight  = doorX + doorWidth / 2;
    const roomLeft   = -roomWidth / 2;
    const roomRight  =  roomWidth / 2;
    const frontLeftWidth  = doorLeft - roomLeft;
    const frontRightWidth = roomRight - doorRight;
    this._addStaticBox('FrontWall_Left', [roomLeft + frontLeftWidth / 2, wallHeight / 2, frontZ], [frontLeftWidth, wallHeight, wallThick], wallMaterial, this._office);
    this._addStaticBox('FrontWall_Right', [doorRight + frontRightWidth / 2, wallHeight / 2, frontZ], [frontRightWidth, wallHeight, wallThick], wallMaterial, this._office);
    this._addStaticBox('DoorHeader', [doorX, doorHeight + (wallHeight - doorHeight) / 2, frontZ], [doorWidth, wallHeight - doorHeight, wallThick], wallMaterial, this._office);
    
    // Side walls and ceiling.
    this._addStaticBox('LeftWall', [-roomWidth / 2, wallHeight / 2, 0], [wallThick, wallHeight, roomDepth], wallMaterial, this._office);
    this._addStaticBox('RightWall', [roomWidth / 2, wallHeight / 2, 0], [wallThick, wallHeight, roomDepth], wallMaterial, this._office);
    this._addStaticBox('Ceiling', [0, wallHeight + wallThick / 2, 0], [roomWidth, wallThick, roomDepth], wallMaterial, this._office);
      
    // Open doorway placeholder; a proper door model can be added later.
    const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.65 });
    this._addStaticBox('DoorTrim_Left', [doorLeft - 0.06, doorHeight / 2, frontZ - 0.05], [0.12, doorHeight, 0.18], trimMaterial, this._office);
    this._addStaticBox('DoorTrim_Right', [doorRight + 0.06, doorHeight / 2, frontZ - 0.05], [0.12, doorHeight, 0.18], trimMaterial, this._office);
    this._addStaticBox('DoorTrim_Top', [doorX, doorHeight + 0.06, frontZ - 0.05], [doorWidth + 0.24, 0.12, 0.18], trimMaterial, this._office);
  }
  
  _addWindow() {
    // Leave the opening clear: imported desk materials use transparency, and a
    // transparent glass plane sorts badly against them from inside the room.
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.65 });
  
    this._addStaticBox('WindowFrame_TOP', [0, 2.9, -4.84], [8.75, 0.12, 0.18], frameMaterial, this._office);
    this._addStaticBox('WindowFrame_Bottom', [0, 0.4, -4.84], [8.75, 0.12, 0.18], frameMaterial, this._office);
    this._addStaticBox('WindowFrame_Left', [-4.37, 1.65, -4.84], [0.12, 2.6, 0.18], frameMaterial, this._office);
    this._addStaticBox('WindowFrame_Right', [4.37, 1.65, -4.84], [0.12, 2.6, 0.18], frameMaterial, this._office);
    this._addStaticBox('WindowFrame_Mullion_Left', [-1.42, 1.65, -4.83], [0.08, 2.35, 0.12], frameMaterial, this._office);
    this._addStaticBox('WindowFrame_Mullion_Right', [1.42, 1.65, -4.83], [0.08, 2.35, 0.12], frameMaterial, this._office);
    this._addStaticBox('WindowFrame_Crossbar', [0, 1.65, -4.82], [8.5, 0.06, 0.12], frameMaterial, this._office);
  }
  
  _addOfficeFurniture() {
    // Retro computer with built-in desk: central focal point facing into the room.
    const computer = this.engine.spawnModel('model:retro-computer', { 
      name: 'ComputerDesk', 
      position: [0, 0, -2.55],
      rotationY: Math.PI,
      scale: 0.016,
    });
    this._office.addChild(computer);
      
    const server = this.engine.spawnModel('model:server-rack', { 
      name: 'ServerRack', 
      position: [4.55, 0, -1.35], 
      rotationY: -Math.PI / 2,
      scale: 0.333,
    });
    this._office.addChild(server);
      
    const radar = this.engine.spawnModel('model:radar-terminal', { 
      name: 'RadarTerminal', 
      position: [-4.45, 0, -0.55], 
      rotationY: Math.PI / 2,
      scale: 0.478,
    });
    this._office.addChild(radar);
      
    const switchboard = this.engine.spawnModel('model:switchboard', { 
      name: 'Switchboard', 
      position: [5.72, 1.15, 1.25], 
      rotationY: -Math.PI / 2,
      scale: 0.638,
    });
    this._office.addChild(switchboard);
  
    const cameras = [
      { name: 'SecurityCamera_Window', position: [-2.2, 2.75, -4.65], rotation: [Math.PI / 5, -Math.PI / 8, 0] },
      { name: 'SecurityCamera_Door', position: [4.9, 2.65, 3.9], rotation: [Math.PI / 4, -Math.PI * 0.78, 0] },
      { name: 'SecurityCamera_Desk', position: [-4.7, 2.55, 2.2], rotation: [Math.PI / 4, Math.PI * 0.65, 0] },
    ];
  
    for (const camera of cameras) {
      const go = this.engine.spawnModel('model:security-camera', {
        name: camera.name,
        position: camera.position,
        scale: 0.339,
        physics: 'none',
      });
      go.object3d.rotation.set(...camera.rotation);
      this._office.addChild(go);
    }
  }
  
  /** Helper: add static procedural room geometry with matching collision.
   *  Returns the GameObject so callers can parent it into the hierarchy. */
  _addStaticBox(name, position, size, material, parent) {
    const { world } = this.engine;
  
    const go = new GameObject(name);
    // Position lives on the GameObject; the mesh is centred on it, so scale
    // and rotate pivot around the box's own centre, not a corner.
    go.object3d.position.set(...position);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name;
    mesh.position.set(0, 0, 0);
    mesh.castShadow = mesh.receiveShadow = true;
    go.object3d.add(mesh);
  
    // Offset the physics body to compensate — the collider still sits at
    // the correct world position even though the mesh is at local origin.
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(...position),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2),
      body,
    );
    // The editor syncs colliders through go.rigidBody — without this
    // reference the sync bails out and scale/rotate never reach Rapier.
    go.rigidBody = body;
    go.colliders = [collider];
    go.collider  = collider;
    go._originalSize = [...size];
  
    if (parent) parent.addChild(go);
    return go;
  }
  
  // ──────────────────────────────────────────
  // Props (decorative / interactable crates)
  // ──────────────────────────────────────────
  _addProps() {
    const crateA = this._addBox('Crate_A', new THREE.Vector3(-2.2, 0.5, -7.3), 0x334b63);
    const crateB = this._addBox('Crate_B', new THREE.Vector3( 0.0, 0.5, -7.8), 0x5c3430);
    const crateC = this._addBox('Crate_C', new THREE.Vector3( 2.2, 0.5, -7.3), 0x36513f);
    
    // Attach Interactable components with example behaviour
    for (const crate of [crateA, crateB /*, crateC*/]) {
      const label = crate.name;
      crate.addComponent(new class extends Interactable {
        promptLabel = `[E] Inspect ${label}`;
        interactRange = 4;
        onInteract(hit) {
          console.log(`[Interact] ${label}`, {
            distance: hit.distance.toFixed(2),
            point:    hit.point,
          });
          console.log(hit);
          hit.gameObject.rigidBody.applyImpulse(
            new RAPIER.Vector3(hit.ray.dir.x, hit.ray.dir.y + 3, hit.ray.dir.z),
            true,
          );
        }
        onHover() {
          // Hook: highlight effect, prompt UI, etc.
        }
        onHoverEnd() {
          // Hook: clear highlight
        }
      }());
    }
  }

  /** Helper: spawn a physics-backed box GameObject. */
  _addBox(name, pos, color) {
    const { world } = this.engine;

    const go = new GameObject(name);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color }),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    go.object3d.add(mesh);
    go.object3d.position.copy(pos);

    const rb = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setLinvel(0, 0, 0),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), rb);
    go.rigidBody = rb;
    this.engine.rigidBodyMap.set(rb.handle, go);
    this.engine._bodyToGO.set(rb.handle, go);

    this.engine._rootObjects.push(go);
    return go;
  }

  // ──────────────────────────────────────────
  // Sky (procedural Mars night dome + moons)
  // ──────────────────────────────────────────
  _addSky() {
    const skyGroup = new GameObject('Sky');
    skyGroup.makeGroup();
    this._sceneRoot.addChild(skyGroup);

    const sky = createMarsSky();
    sky.addComponent(new SkyFollow());
    skyGroup.addChild(sky);

    // Match the fog to the dome's horizon. FogExp2 washes the ground plane out
    // to the fog colour by ~100 m, well inside the dome, so the engine default
    // shows up as a seam where the faded ground meets the rust horizon.
    this._prevFogColor = this.engine.scene.fog?.color.getHex();
    this.engine.scene.fog?.color.set(0x3a2820);
  }
}
