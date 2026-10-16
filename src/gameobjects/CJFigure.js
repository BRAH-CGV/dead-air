import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// CJFigure  –  the player's body, an easter egg
// ─────────────────────────────────────────────
// The player has no body — the camera rides where his eyes are and first
// person shows nothing. But he IS someone: CJ stands on the player, dressed
// for the job (white tank top, jeans), and the only way to ever see him is
// the debug fly camera (`fly` in the dev console): put the camera out, fly
// back, and there he is, at the player's feet, turning to watch you.
//
// The trick that makes him work: DebugCamera suspends the PLAYER's own
// components to freeze him mid-stride — and this figure is a GameObject
// CHILD of the player, whose components the fly camera never touches. Its
// driver keeps ticking the whole time, so while everything else is frozen
// CJ still turns to face the camera and still stands on the floor.
//
// What the driver does each frame:
//   • visible    — only while the fly camera is out; hidden the rest of the
//                  time, so first person never draws him, and neither does
//                  the security monitor or any threat.
//   • position.y — every frame, seen or not: the player's object3d sits at
//                  the CAPSULE CENTRE, not the feet, so the figure rides at
//                  the bottom of whichever capsule is active (the controller
//                  swaps go.collider on crouch). He is already standing on
//                  the floor the moment he is shown.
//   • rotation.y — while the fly camera is out, yaw toward it, and nothing
//                  else: he stands upright, he doesn't lean to look up (and
//                  he isn't animated — this is as much of him as there is).
//
// He casts no shadow: the shadow maps are frozen while the fly camera is out
// (ShadowScheduler), so showing him would light nothing — and hiding him
// again must never leave a stale shadow behind.
//
// `model` is a fresh instance from the AssetManager (`assets.instantiate`):
// it owns nothing shared — geometry and materials stay with the cache, and
// teardown is just removing him from the scene. Without one he is only the
// driver, which still hides, stands and faces; the tests run him that way.
// ─────────────────────────────────────────────

/** A camera nearer than this, horizontally, is overhead — keep the last yaw
 *  rather than spin on rounding noise. Metres. */
const FACE_DEAD_ZONE = 0.01;

// Scratch — nothing allocated per frame.
const _cameraAt = new THREE.Vector3();
const _figureAt = new THREE.Vector3();

class CJDriver extends Component {
  onUpdate() {
    const engine = this.scene?.userData?.engine;
    const flying = !!engine?.debugCamera?.active;
    this.transform.visible = flying;

    // ── Feet on the floor (every frame, seen or not) ──
    // The parent GameObject is the Player; its `collider` is whichever
    // capsule the controller has enabled (FirstPersonController swaps it
    // on crouch). Its bottom is halfHeight + radius below the body centre,
    // which is where this figure's origin sits.
    const capsule = this.gameObject.parent?.collider;
    if (capsule) {
      this.transform.position.y = -(capsule.halfHeight() + capsule.radius());
    }

    // ── Facing the camera (only while it is out; hidden, he freezes) ──
    if (!flying) return;
    const camera = engine?.camera;
    if (!camera) return;
    camera.getWorldPosition(_cameraAt);
    this.transform.getWorldPosition(_figureAt);
    const dx = _cameraAt.x - _figureAt.x;
    const dz = _cameraAt.z - _figureAt.z;
    if (dx * dx + dz * dz < FACE_DEAD_ZONE * FACE_DEAD_ZONE) return;
    this.transform.rotation.y = Math.atan2(dx, dz);   // +Z is his front
  }
}

/**
 * Build CJ: a GameObject child of the Player carrying the model and the
 * driver. Hidden until the fly camera comes out.
 * @param {object} [opts]
 * @param {THREE.Object3D|null} [opts.model]  an assets.instantiate('model:cj')
 * @returns {GameObject}
 */
export function createCJFigure({ model = null } = {}) {
  const cj = new GameObject('CJ');
  if (model) {
    cj.object3d.add(model);
    // Frozen shadow maps mean a cast shadow could never update while he is
    // out — and the manifest sets the same flag on the entry.
    model.traverse(node => { if (node.isMesh) node.castShadow = false; });
  }
  cj.addComponent(new CJDriver());
  cj.object3d.visible = false;
  return cj;
}
