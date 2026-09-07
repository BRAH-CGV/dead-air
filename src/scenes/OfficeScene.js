import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { GameObject } from '../core/GameObject.js';
import { Scene } from '../core/Scene.js';
import { Interactable } from '../components/Interactable.js';

// ─────────────────────────────────────────────
// OfficeScene  –  The starting office level
// ─────────────────────────────────────────────

export class OfficeScene extends Scene {

  build() {
    this._addLighting();
    this._addGround();
    this._addWalls();
    this._addWindow();
    this._addOfficeFurniture();
    this._addProps();
  
    // ── Player (shared across all scenes) ──
    this.engine.buildPlayer();
  }
  
  dispose() {
    // Future: dispose level-specific GPU resources (lights, ground geom, etc.)
  }

  // ──────────────────────────────────────────
  // Lighting
  // ──────────────────────────────────────────
  _addLighting() {
    const { scene } = this.engine;
  
    scene.add(new THREE.AmbientLight(0x435472, 1.0));
          
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
    scene.add(moon);
  
    const ceilingLight = new THREE.PointLight(0xffd8a8, 10.0, 24, 1.0);
    ceilingLight.position.set(0, 2.75, 0.4);
    ceilingLight.castShadow = true;
    ceilingLight.shadow.mapSize.set(1024, 1024);
    scene.add(ceilingLight);
  
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
    scene.add(fixture);
  
    const deskGlow = new THREE.PointLight(0x66ccff, 2.8, 6, 1.6);
    deskGlow.position.set(0, 1.1, -2.1);
    scene.add(deskGlow);
  
    const visibleMoon = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0xffe1a3 }),
    );
    visibleMoon.name = 'VisibleMoon';
    visibleMoon.position.set(-2.4, 5.3, -15);
    scene.add(visibleMoon);
  
    const moonGlow = new THREE.PointLight(0xffe1a3, 5.0, 32, 1.4);
    moonGlow.position.copy(visibleMoon.position);
    scene.add(moonGlow);
  }
  
  // ─────────────────────────────────────────
  // Ground (visual plane + static collider)
  // ──────────────────────────────────────────
  _addGround() {
    const { scene, world, assets } = this.engine;

    // Textures come from the manifest, already in the right colour space and
    // set to repeat — see AssetManager._loadTexture.
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
    scene.add(groundMesh);

    // Ground collider (static, no GameObject needed)
    const groundBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 0.1, 50).setTranslation(0, -0.1, 0),
      groundBody,
    );
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
  
    this._addStaticBox('BackWall_Left', [-windowWidth / 2 - sideWidth / 2, wallHeight / 2, backZ], [sideWidth, wallHeight, wallThick], wallMaterial);
    this._addStaticBox('BackWall_Right', [windowWidth / 2 + sideWidth / 2, wallHeight / 2, backZ], [sideWidth, wallHeight, wallThick], wallMaterial);
    this._addStaticBox('BackWall_Lower', [0, lowerHeight / 2, backZ], [windowWidth, lowerHeight, wallThick], wallMaterial);
    this._addStaticBox('BackWall_Upper', [0, windowY + windowHeight / 2 + upperHeight / 2, backZ], [windowWidth, upperHeight, wallThick], wallMaterial);
  
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
    this._addStaticBox('FrontWall_Left', [roomLeft + frontLeftWidth / 2, wallHeight / 2, frontZ], [frontLeftWidth, wallHeight, wallThick], wallMaterial);
    this._addStaticBox('FrontWall_Right', [doorRight + frontRightWidth / 2, wallHeight / 2, frontZ], [frontRightWidth, wallHeight, wallThick], wallMaterial);
    this._addStaticBox('DoorHeader', [doorX, doorHeight + (wallHeight - doorHeight) / 2, frontZ], [doorWidth, wallHeight - doorHeight, wallThick], wallMaterial);
    
    // Side walls and ceiling.
    this._addStaticBox('LeftWall', [-roomWidth / 2, wallHeight / 2, 0], [wallThick, wallHeight, roomDepth], wallMaterial);
    this._addStaticBox('RightWall', [roomWidth / 2, wallHeight / 2, 0], [wallThick, wallHeight, roomDepth], wallMaterial);
    this._addStaticBox('Ceiling', [0, wallHeight + wallThick / 2, 0], [roomWidth, wallThick, roomDepth], wallMaterial);
      
    // Open doorway placeholder; a proper door model can be added later.
    const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.65 });
    this._addStaticBox('DoorTrim_Left', [doorLeft - 0.06, doorHeight / 2, frontZ - 0.05], [0.12, doorHeight, 0.18], trimMaterial);
    this._addStaticBox('DoorTrim_Right', [doorRight + 0.06, doorHeight / 2, frontZ - 0.05], [0.12, doorHeight, 0.18], trimMaterial);
    this._addStaticBox('DoorTrim_Top', [doorX, doorHeight + 0.06, frontZ - 0.05], [doorWidth + 0.24, 0.12, 0.18], trimMaterial);
  }
  
  _addWindow() {
    // Leave the opening clear: imported desk materials use transparency, and a
    // transparent glass plane sorts badly against them from inside the room.
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.65 });
  
    this._addStaticBox('WindowFrame_Top', [0, 2.9, -4.84], [8.75, 0.12, 0.18], frameMaterial);
    this._addStaticBox('WindowFrame_Bottom', [0, 0.4, -4.84], [8.75, 0.12, 0.18], frameMaterial);
    this._addStaticBox('WindowFrame_Left', [-4.37, 1.65, -4.84], [0.12, 2.6, 0.18], frameMaterial);
    this._addStaticBox('WindowFrame_Right', [4.37, 1.65, -4.84], [0.12, 2.6, 0.18], frameMaterial);
    this._addStaticBox('WindowFrame_Mullion_Left', [-1.42, 1.65, -4.83], [0.08, 2.35, 0.12], frameMaterial);
    this._addStaticBox('WindowFrame_Mullion_Right', [1.42, 1.65, -4.83], [0.08, 2.35, 0.12], frameMaterial);
    this._addStaticBox('WindowFrame_Crossbar', [0, 1.65, -4.82], [8.5, 0.06, 0.12], frameMaterial);
  }
  
  _addOfficeFurniture() {
    // Retro computer with built-in desk: central focal point facing into the room.
    this.engine.spawnModel('model:retro-computer', { 
      name: 'ComputerDesk', 
      position: [0, 0, -2.55],
      rotationY: Math.PI,
      scale: 0.016,
    });
      
    this.engine.spawnModel('model:server-rack', { 
      name: 'ServerRack', 
      position: [4.55, 0, -1.35], 
      rotationY: -Math.PI / 2,
      scale: 0.333,
    });
      
    this.engine.spawnModel('model:radar-terminal', { 
      name: 'RadarTerminal', 
      position: [-4.45, 0, -0.55], 
      rotationY: Math.PI / 2,
      scale: 0.478,
    });
      
    this.engine.spawnModel('model:switchboard', { 
      name: 'Switchboard', 
      position: [5.72, 1.15, 1.25], 
      rotationY: -Math.PI / 2,
      scale: 0.638,
    });
  
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
    }
  }
  
  /** Helper: add static procedural room geometry with matching collision. */
  _addStaticBox(name, position, size, material) {
    const { scene, world } = this.engine;
  
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(...position),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2),
      body,
    );
  
    return mesh;
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
}
