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
//   onNap(rand)               the player lies down to nap mid-shift; return
//                             true if that ends the night (override)
//   stop()      → onStop()    hide, silence, forget
//
// ctx is the scene's context, one object shared by every threat:
//   { engine, scene, controller, player, rooms, transitions, stamina,
//     audio, lights, hud }
// Fields the scene hasn't built are null. A threat ends the night with
// kill(reason), which goes through GameController.fail.
//
// Sound: loop(key, object3d) is a looping emitter riding the threat's
// figure, made once and kept across nights; the threat sets its level and
// stop() turns every one of them down to silence. One-shots go straight to
// ctx.audio.play. Without audio both are no-ops.
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
  /** The looping sounds loop() has made, by key. */
  _loops = new Map();

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
    for (const emitter of this._loops.values()) emitter.setLevel(0);
  }

  /** A looping sound riding `object3d`, made the first time it is asked
   *  for and the same one after that. Starts silent; null while the scene
   *  has no audio. */
  loop(key, object3d, opts) {
    let emitter = this._loops.get(key);
    if (!emitter) {
      emitter = this.ctx?.audio?.positional(key, object3d, opts) ?? null;
      if (emitter) this._loops.set(key, emitter);
    }
    return emitter;
  }

  /** End the night: the player was caught. */
  kill(reason) {
    this.ctx?.controller?.fail(reason);
  }

  // ── Overrides ──
  onStart() {}
  onStop() {}
  update(_dt) {}
  /** @param {() => number} _rand @returns {boolean} the nap ended the night */
  onNap(_rand) { return false; }
}
