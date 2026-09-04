// ─────────────────────────────────────────────
// Component  –  MonoBehaviour-inspired base class
// ─────────────────────────────────────────────
// Lifecycle: onAwake → onStart → [onUpdate | onFixedUpdate | onLateUpdate] → onDestroy
//
// Attach to a GameObject to participate in the scene-graph traversal.
// Override any hook in your subclass / instance.
// ─────────────────────────────────────────────

export class Component {
  /** @type {import('./GameObject').GameObject|null} */
  gameObject = null;

  /** Suspend the per-frame hooks while false — Unity's `Behaviour.enabled`.
   *  The one-shot lifecycle (onAwake, onStart, onDestroy) is unaffected: a
   *  component that starts disabled still gets its onStart, it just doesn't
   *  tick until re-enabled. Used by the debug fly camera to freeze the
   *  player while the camera is detached. */
  enabled = true;

  get transform() { return this.gameObject?.object3d; }
  get scene()     { return this.gameObject?.scene; }
  get world()     { return this.gameObject?.world; }

  /** Called once when the GameObject is initialised (like Unity Awake). */
  onAwake() {}

  /** Called once before the first update (like Unity Start). */
  onStart() {}

  /** Called every rendered frame. */
  onUpdate(_dt) {}

  /** Called every fixed-timestep tick (physics). */
  onFixedUpdate(_dt) {}

  /** Called every frame after onUpdate (camera follow, input smoothing). */
  onLateUpdate(_dt) {}

  /** Called when the component or its GameObject is removed. */
  onDestroy() {}
}
