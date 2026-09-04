// ─────────────────────────────────────────────
// Scene  –  Base class for level construction
// ─────────────────────────────────────────────

/**
 * Scenes populate the world with lights, geometry, props and the player.
 * Engine owns the infrastructure (renderer, physics, assets, loop) and
 * delegates world-population to the active Scene.
 *
 * Subclass and override `build()` to create your level.  Override
 * `dispose()` to free any GPU resources you allocated that the asset
 * cache doesn't already track.
 */
export class Scene {
  /** @type {import('./Engine.js').Engine} */
  engine;

  constructor(engine) {
    this.engine = engine;
  }

  /** Populate the world.  Called by Engine after assets are loaded. */
  build() {}

  /** Tear down level-specific objects.  Called before swapping to a new
   *  scene or restarting.  The asset cache handles shared GPU memory —
   *  dispose only what you created outside of it (lights, procedural
   *  geometry, custom materials, etc.). */
  dispose() {}
}
