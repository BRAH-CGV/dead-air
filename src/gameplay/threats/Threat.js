// ─────────────────────────────────────────────
// Threat  –  base class for a night's monster
// ─────────────────────────────────────────────
// Plain class, not a Component: ThreatDirector owns the ticking, so a
// threat only runs while its night is being played — never in the morning,
// never behind a failed-night prompt, never while the fly camera has frozen
// the player.
//
//   start(ctx)  → onStart()   fresh state for a new or retried night
//   update(dt)                every frame of the night (override)
//   stop()      → onStop()    hide, silence, forget
//
// ctx is the scene's context, one object shared by every threat:
//   { engine, scene, controller, player, rooms, transitions, stamina,
//     audio, lights, hud }
// Fields the scene hasn't built are null. A threat ends the night with
// kill(reason), which goes through GameController.fail.
//
// Keep the rules in a pure *Logic class with injected functions (canSee,
// isOccluded, rand) and let the threat wire it to the scene, so the rules
// test without physics, a camera or a DOM.
// ─────────────────────────────────────────────

export class Threat {
  /** Running this night. */
  active = false;
  /** The scene context from the last start(). */
  ctx = null;
  /** One sentence for the HUD: what tonight asks of the player. */
  objective = '';

  /** Begin a night: fresh state, whatever the last night left behind. */
  start(ctx) {
    this.ctx = ctx;
    this.active = true;
    this.onStart();
  }

  /** End the night's run. Safe to call twice. */
  stop() {
    if (!this.active) return;
    this.active = false;
    this.onStop();
  }

  /** End the night: the player was caught. */
  kill(reason) {
    this.ctx?.controller?.fail(reason);
  }

  // ── Overrides ──
  onStart() {}
  onStop() {}
  update(_dt) {}
}
