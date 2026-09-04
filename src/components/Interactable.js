import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// Interactable  –  Base component for objects the player can interact with
// ─────────────────────────────────────────────
// Attach to any GameObject and override onInteract() to define custom
// behaviour when the player looks at it and presses the interact key.
//
// hitInfo passed to onInteract:
//   {
//     collider   – RAPIER.Collider that was hit
//     gameObject – GameObject that owns the collider
//     point      – { x, y, z }  world-space hit position
//     ray        – RAPIER.Ray      world-space ray that was cast
//     distance   – number        distance from camera
//   }
// ─────────────────────────────────────────────

export class Interactable extends Component {
  /**
   * Maximum distance at which this object can be interacted with.
   * The InteractionSystem respects whichever range is smaller: its own or this one.
   */
  interactRange = Infinity;

  /** Optional label shown in UI when the player looks at this object. */
  promptLabel = '';

  /**
   * Called when the player interacts with this object (default key: E).
   * @param {Object} hitInfo  Raycast data — see header comment.
   */
  onInteract(_hitInfo) {
    // Override in subclass or instance.
  }

  /**
   * Called every frame while the player's crosshair hovers over this object.
   * Useful for highlight effects, prompt text, etc.
   */
  onHover(_hitInfo) {}

  /**
   * Called once when the crosshair leaves this object after hovering.
   */
  onHoverEnd() {}
}
