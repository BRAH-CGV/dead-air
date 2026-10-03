import { Component } from '../core/Component.js';

// ─────────────────────────────────────────────
// Pickupable  –  Marker component for objects that can be picked up
// ─────────────────────────────────────────────
// Attach to any GameObject to make it pickup-eligible by the PickupSystem.
// This component is purely data — it marks the object and stores hold
// parameters. The PickupSystem (on the player) handles the actual physics
// and interaction logic.
//
// Usage:
//   const drive = new Drive('Drive_1');
//   drive.addComponent(new Pickupable());
//   // Now the player can pick up this drive when looking at it and pressing E.
//
// The PickupSystem reads holdDistance to position the object in front of the
// camera while carried. Mouse wheel scrolling adjusts this distance within
// the [minHoldDistance, maxHoldDistance] range.
// ─────────────────────────────────────────────

export class Pickupable extends Component {
  /** True while the PickupSystem is carrying this object. */
  held = false;

  /** Metres in front of the camera when held. */
  holdDistance = 1.0;

  /** Closest the player can pull the object (mouse wheel scroll up). */
  minHoldDistance = 0.5;

  /** Furthest the player can push the object (mouse wheel scroll down). */
  maxHoldDistance = 3.0;

  /** How far the player can see the pickup prompt. */
  interactRange = 3;

  /** Prompt shown when the player looks at this object (not holding). */
  promptLabel = '[E] Pick up';
}
