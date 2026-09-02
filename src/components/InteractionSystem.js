import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { Component } from '../core/Component.js';
import { Interactable } from './Interactable.js';

// ─────────────────────────────────────────────
// InteractionSystem  –  Component (attach to Player)
// ─────────────────────────────────────────────
// Casts a ray from the camera centre every frame and looks for the
// nearest GameObject that carries an Interactable component.
//
// When the player presses the interact action (default: KeyE),
// the targeted Interactable.onInteract(rayHitInfo) is invoked.
//
// The crosshair DOM element (#crosshair) is automatically toggled
// between its default and "active" (brighter) state based on whether
// an interactable is targeted.
// ─────────────────────────────────────────────

export class InteractionSystem extends Component {
  /** @type {number} Maximum interaction distance (world units). */
  range = 5;

  /** @type {Object|null} Current raycast hit info (updated every frame). */
  currentHit = null;

  /** @type {Interactable|null} Currently targeted interactable. */
  currentTarget = null;

  /** @type {HTMLElement|null} Crosshair DOM element (cached on start). */
  _crosshairEl = null;

  /** Prevents re-triggering while the interact key is held. */
  _held = false;

  // Pre-allocated scratch vectors to avoid per-frame allocations.
  _origin = new THREE.Vector3();
  _dir    = new THREE.Vector3();

  constructor(opts = {}) {
    super();
    this.range = opts.range ?? 5;
  }

  onStart() {
    this._crosshairEl = document.getElementById('crosshair');
  }

  // ── Every rendered frame ────────────────────────────────────
  onUpdate(_dt) {
    if (!this.gameObject?.scene) return;

    const engine = this.gameObject.scene.userData.engine;
    if (!engine) return;

    const { camera } = engine;

    // ── Build ray from camera centre ──
    this._origin.setFromMatrixPosition(camera.matrixWorld);
    this._dir.set(0, 0, -1).applyQuaternion(camera.quaternion);

    this.currentHit    = null;
    this.currentTarget = null;

    // ── Cast ray into physics world ──
    // filterExcludeRigidBody: skip the player's own body
    // filterPredicate: only accept colliders whose GameObject has an Interactable
    const ray     = new RAPIER.Ray(this._origin, this._dir);
    const bodyMap = engine._bodyToGO;

    const hit = engine.world.castRay(
      ray,
      this.range,
      true,                          // solid
      undefined,                     // filterFlags
      undefined,                     // filterGroups
      undefined,                     // filterExcludeCollider
      this.gameObject.rigidBody,     // filterExcludeRigidBody – skip self
      (collider) => {
        const go = bodyMap.get(collider.parent()?.handle);
        return go?.getComponent(Interactable) != null;
      },
    );

    if (hit) {
      const go        = bodyMap.get(hit.collider.parent()?.handle);
      const interact  = go?.getComponent(Interactable);

      // Respect per-object interactRange if smaller than system range.
      if (interact && hit.timeOfImpact <= (interact.interactRange ?? this.range)) {
        this.currentTarget = interact;
        this.currentHit = {
          collider:   hit.collider,
          gameObject: go,
          point:      ray.pointAt(hit.timeOfImpact),
          normal:     null,  // castRay doesn't return normal; use castRayAndGetNormal if needed
          distance:   hit.timeOfImpact,
        };
      }
    }

    // ── Crosshair visual feedback ──
    if (this._crosshairEl) {
      this._crosshairEl.classList.toggle('active', !!this.currentTarget);
    }

    // ── Hover callbacks ──
    if (this.currentTarget !== this._prevTarget) {
      this._prevTarget?.onHoverEnd();
      this._prevTarget = this.currentTarget;
    }
    if (this.currentTarget && this.currentHit) {
      this.currentTarget.onHover(this.currentHit);
    }

    // ── Input: trigger interaction on key press (edge-detected) ──
    const wantInteract = engine.isAction('interact');
    if (wantInteract && !this._held) {
      if (this.currentTarget && this.currentHit) {
        this.currentTarget.onInteract(this.currentHit);
      }
    }
    this._held = wantInteract;
  }
}
