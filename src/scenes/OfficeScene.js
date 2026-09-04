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
    this._addProps();

    // ── Imported meshes ──
    // Solid: the manifest entry carries `physics: 'static'`, which fits a box
    // to the bounds measured at load. Press ` to see it.
    this.engine.spawnModel('model:desk', { name: 'Desk', position: [0, 0, -3] });

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

    scene.add(new THREE.AmbientLight(0x404060, 0.5));

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
    scene.add(sun);
  }

  // ──────────────────────────────────────────
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
  // Props (decorative / interactable crates)
  // ──────────────────────────────────────────
  _addProps() {
    const crateA = this._addBox('Crate_A', new THREE.Vector3( 5, 0.5, -3), 0x5588aa);
    const crateB = this._addBox('Crate_B', new THREE.Vector3(-4, 0.5, -6), 0xaa5544);
    const crateC = this._addBox('Crate_C', new THREE.Vector3( 2, 0.5,  8), 0x44aa55);

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
