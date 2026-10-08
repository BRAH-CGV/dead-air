import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { Component } from '../core/Component.js';
import { Interactable } from './Interactable.js';
import { Pickupable } from './Pickupable.js';
import { PromptLabel } from '../ui/PromptLabel.js';
import { packGroups, Layers } from '../core/PhysicsLayers.js';

// ─────────────────────────────────────────────
// InteractionSystem  –  Component (attach to Player)
// ─────────────────────────────────────────────
// Casts a ray from the camera centre every frame. It stops at the first
// solid collider it meets — a wall, a locked door, a prop — and targets it
// only if that collider's GameObject carries an Interactable, or a
// Pickupable (a pickup-able object in view; one already held is skipped and
// a carried object is excluded from the ray entirely, see excludeBody), so
// nothing is reachable through a wall. Sensors (open doorways) block
// nothing.
//
// When the player presses the interact action (default: KeyE),
// the targeted Interactable.onInteract(rayHitInfo) is invoked.
//
// The crosshair DOM element (#crosshair) is automatically toggled
// between its default and "active" (brighter) state based on whether
// a target is in view, and the target's `promptLabel` is shown on
// the same HUD prompt RoomTransitionSystem uses for locked doors (they
// share the #prompt element — a player is rarely at a locked door and
// looking at a prop in the same frame, so one line is enough).
// ─────────────────────────────────────────────

/**
 * Collision groups for the interaction ray: hits DEFAULT (walls, props, floor)
 * and SHELF (shelf boards, drives, crates) but NOT PLAYER (the shelf's
 * player-only envelope box, which uses PLAYER membership so the ray passes
 * through to items on/behind the shelf).
 */
const RAY_GROUPS = packGroups(
  [Layers.DEFAULT, Layers.SHELF],
  [Layers.DEFAULT, Layers.SHELF],
);

export class InteractionSystem extends Component {
  /** @type {number} Maximum interaction distance (world units). */
  range = 5;

  /** @type {Object|null} Current raycast hit info (updated every frame). */
  currentHit = null;

  /** @type {Interactable|null} Currently targeted interactable. */
  currentTarget = null;

  /** @type {Pickupable|null} Pickupable in view (not held). Lets
   *  PickupSystem reach the object under the crosshair without casting its
   *  own ray. An Interactable on the same object takes priority. */
  currentPickupable = null;

  /** @type {object|null} RigidBody excluded from the ray. A carried object
   *  sits on the camera axis at hold distance and would otherwise stop the
   *  ray before it reaches whatever the player is looking at. Set by
   *  PickupSystem while holding; null when the hands are free. */
  excludeBody = null;

  /** @type {HTMLElement|null} Crosshair DOM element (cached on start). */
  _crosshairEl = null;

  /** Prevents re-triggering while the interact key is held. */
  _held = false;

  /** When set (to any truthy value), InteractionSystem hides its prompt and
   *  stops updating it — another system (e.g. PickupSystem) owns the prompt.
   *  Clear to null to hand control back. */
  promptOverride = null;

  /** Tracks whether we already hid the prompt for an override, so we only
   *  hide once and force a re-show when the override clears. */
  _promptWasSuppressed = false;

  // Pre-allocated scratch vectors to avoid per-frame allocations.
  _origin = new THREE.Vector3();
  _dir    = new THREE.Vector3();

  /** @param {object} [opts]
   *  @param {number} [opts.range=5]
   *  @param {{show:Function, hide:Function}} [opts.prompt]  Defaults to a PromptLabel on start */
  constructor(opts = {}) {
    super();
    this.range = opts.range ?? 5;
    this.prompt = opts.prompt ?? null;
  }

  onStart() {
    this._crosshairEl = document.getElementById('crosshair');
    this.prompt ??= new PromptLabel();
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
    this.currentPickupable = null;

    // ── Cast ray into physics world ──
    // The first solid thing hit is what the player is looking at. No
    // Interactable filter on the cast itself: that would let the ray pass
    // through walls to whatever interactable lies behind them.
    const ray     = new RAPIER.Ray(this._origin, this._dir);
    const bodyMap = engine._bodyToGO;
    const excludeBody = this.excludeBody;

    const hit = engine.world.castRay(
      ray,
      this.range,
      true,                                       // solid
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,    // open doorways block nothing
      RAY_GROUPS,                                 // filterGroups – skip PLAYER-layer colliders (shelf envelope)
      undefined,                                  // filterExcludeCollider
      this.gameObject.rigidBody,                  // filterExcludeRigidBody – skip self
      excludeBody                                 // filterPredicate – skip a carried object
        ? (collider) => collider.parent() !== excludeBody
        : undefined,
    );

    if (hit) {
      // A wall, the terrain or a plain prop has no Interactable: no target.
      const go        = bodyMap.get(hit.collider.parent()?.handle);
      const interact  = go?.getComponent(Interactable);

      // Respect per-object interactRange if smaller than system range.
      if (interact && hit.timeOfImpact <= (interact.interactRange ?? this.range)) {
        this.currentTarget = interact;
        this.currentHit = {
          collider:   hit.collider,
          gameObject: go,
          point:      ray.pointAt(hit.timeOfImpact),
        //   normal:     null,  // castRay doesn't return normal; use castRayAndGetNormal if needed
          ray: ray,
          distance:   hit.timeOfImpact,
        };
      } else {
        // A pickup-able object is a target too — its promptLabel tells the
        // player it can be picked up. One already held is not: it is in the
        // player's hands already.
        const pickupable = go?.getComponent(Pickupable);
        if (pickupable && !pickupable.held &&
            hit.timeOfImpact <= (pickupable.interactRange ?? this.range)) {
          this.currentPickupable = pickupable;
        }
      }
    }

    // ── Crosshair visual feedback ──
    if (this._crosshairEl) {
      this._crosshairEl.classList.toggle(
        'active', !!(this.currentTarget || this.currentPickupable));
    }

    // ── Hover callbacks + HUD prompt ──
    // When another system has claimed the prompt (promptOverride is set),
    // suppress our prompt logic entirely. Reset _prevTarget so that when
    // the override clears, we re-evaluate from scratch.
    if (this.promptOverride) {
      if (!this._promptWasSuppressed) {
        this.prompt?.hide();
        this._promptWasSuppressed = true;
        this._prevTarget = null;
      }
    } else {
      // When the override just cleared, force a prompt re-evaluation even
      // if source and _prevTarget are both null — otherwise the old prompt
      // text (e.g. '[E] Drop') lingers after the player drops while looking
      // away from any target.
      const justUnsuppressed = this._promptWasSuppressed;
      this._promptWasSuppressed = false;

    // Re-shown on a new target, or when the same target changes its label
    // (a toggle like the suit locker's "Put on" / "Take off") — never every
    // frame for an unchanged prompt. The prompt comes from the targeted
    // Interactable, or from the Pickupable in view (its promptLabel reads
    // '[E] Pick up').
    const source = this.currentTarget ?? this.currentPickupable;
    const label = source?.promptLabel ?? null;
    if (source !== this._prevTarget || justUnsuppressed) {
      this._prevTarget?.onHoverEnd?.();   // Pickupable carries no hover hooks
      this._prevTarget = source;
      if (source) this.prompt?.show(label);
      else this.prompt?.hide();
    } else if (source && label !== this._prevLabel) {
      this.prompt?.show(label);
    }
    this._prevLabel = label;
    } // end of promptOverride else branch
    if (this.currentTarget && this.currentHit) {
      this.currentTarget.onHover(this.currentHit);
    }

    // ── Input: trigger interaction on key press (edge-detected) ──
    const wantInteract = engine.isAction('interact');
    if (wantInteract && !this._held) {
      // Held objects take priority: when another system claims the prompt
      // (e.g. PickupSystem showing '[E] Drop'), skip our interact action
      // so we don't fire the targeted Interactable's onInteract.
      if (!this.promptOverride && this.currentTarget && this.currentHit) {
        this.currentTarget.onInteract(this.currentHit);
      }
    }
    this._held = wantInteract;
  }
}
