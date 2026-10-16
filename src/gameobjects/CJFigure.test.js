import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { createCJFigure } from './CJFigure.js';

// ─────────────────────────────────────────────
// CJ  –  the player's body, seen only through the debug fly camera
// ─────────────────────────────────────────────
// The driver lives on a GameObject CHILD of the player, which the fly camera
// does not suspend (it freezes the player's own components only), so these
// tests drive the player the way Engine does: _init once, then _update.
// ─────────────────────────────────────────────

/** Rapier capsules don't exist in this suite — the driver only reads
 *  halfHeight() and radius() off the player's active collider. */
const STAND  = { halfHeight: () => 0.375, radius: () => 0.3 };   // centre→feet 0.675
const CROUCH = { halfHeight: () => 0.025, radius: () => 0.3 };   // centre→feet 0.325

/** The player at the origin, CJ on it, a scene whose engine mock says whether
 *  the fly camera is out. */
function rig({ flying = false, collider = STAND, model = null } = {}) {
  const scene = new THREE.Scene();
  scene.userData.engine = {
    debugCamera: { active: flying },
    camera: new THREE.PerspectiveCamera(),
  };

  const player = new GameObject('Player');
  player.collider = collider;

  const cj = createCJFigure({ model });
  player.addChild(cj);
  player._init(scene, null);

  return { scene, engine: scene.userData.engine, player, cj, update: () => player._update(1 / 60) };
}

describe('CJ', () => {
  it('is hidden while the fly camera is out of play', () => {
    const { cj, update } = rig();
    update();
    update();
    expect(cj.object3d.visible).toBe(false);
  });

  it('shows only while the fly camera is out, and hides again after', () => {
    const { engine, cj, update } = rig({ flying: true });
    update();
    expect(cj.object3d.visible).toBe(true);

    engine.debugCamera.active = false;
    update();
    expect(cj.object3d.visible).toBe(false);
  });

  it('stands on the floor, at the bottom of whichever capsule is active', () => {
    const { player, cj, update } = rig();
    update();
    expect(cj.object3d.position.y).toBeCloseTo(-0.675, 5);

    player.collider = CROUCH;   // the controller swaps go.collider on crouch
    update();
    expect(cj.object3d.position.y).toBeCloseTo(-0.325, 5);
  });

  it('faces the fly camera, upright, wherever it flies', () => {
    const { engine, cj, update } = rig({ flying: true });

    engine.camera.position.set(4, 1.5, 0);   // to his right
    update();
    expect(cj.object3d.rotation.y).toBeCloseTo(Math.PI / 2, 5);

    engine.camera.position.set(0, 5, -2);    // behind and above
    update();
    expect(cj.object3d.rotation.y).toBeCloseTo(Math.PI, 5);
    // Yaw only: he stands, he doesn't lean back to look up.
    expect(cj.object3d.rotation.x).toBe(0);
    expect(cj.object3d.rotation.z).toBe(0);
  });

  it('does not chase the camera while the fly camera is out of play', () => {
    const { engine, cj, update } = rig({ flying: true });
    engine.camera.position.set(4, 1.5, 0);
    update();
    const faced = cj.object3d.rotation.y;

    engine.debugCamera.active = false;       // back to first person: hidden
    engine.camera.position.set(0, 1.5, 4);
    update();
    expect(cj.object3d.rotation.y).toBe(faced);
  });

  it('wears the model it is given, with nothing casting a shadow', () => {
    // A loader-fresh model: three.js meshes default to castShadow true.
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.22));
    const model = new THREE.Group();
    model.add(body);

    const { cj } = rig({ model });
    expect(body.parent).toBe(model);
    expect(model.parent).toBe(cj.object3d);

    let meshes = 0;
    cj.object3d.traverse(node => {
      if (node.isMesh) { meshes++; expect(node.castShadow, node.name).toBe(false); }
    });
    expect(meshes).toBe(1);
  });

  it('without a model it still drives — hidden, standing, facing', () => {
    const { engine, cj, update } = rig({ flying: true });
    engine.camera.position.set(0, 1.5, 3);
    update();
    expect(cj.object3d.visible).toBe(true);
    expect(cj.object3d.position.y).toBeCloseTo(-0.675, 5);
    expect(cj.object3d.rotation.y).toBeCloseTo(0, 5);
  });
});
