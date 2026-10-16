import * as THREE from 'three';

// ─────────────────────────────────────────────
// PostPipeline  –  chains multiple post-processing passes
// ─────────────────────────────────────────────
// Drop-in replacement for the engine's single `postProcess` slot.  Exposes
// the same interface as RedOut (preRender / postRender / warmUp / preCompile
// / active / dispose) so the engine code never changes.
//
// Internally it holds an ordered list of passes.  Each pass is a small
// object with:
//
//   .active           getter — true while the effect should run
//   .build(engine)    called once to set up shaders, geometry, etc.
//   .warmUp()        compile the composite shader (dummy render to screen)
//   .preCompile(renderer, targets)  compile RT shader variants
//   .dispose()        free GPU resources
//
// The pipeline owns the render targets.  When at least one pass is active
// the scene is rendered into the first target; each active pass then
// composites from one target into the next, and the last one writes to the
// screen.  When nothing is active the scene renders straight to screen as
// usual — no targets, no overhead.
//
// Passes are added / removed by name so gameplay code can look them up:
//
//   pipeline.add('redOut', redOutPass);
//   pipeline.get('redOut').setIntensity(0.5);
//
// A pass here draws the scene into an off-screen target: no MSAA, no tone
// mapping, linear 8-bit. That suits an effect that replaces the picture
// (RedOut). One that only bends or tints the frame as shown belongs in
// engine.screenPasses instead, working on a copy of the screen
// (VisorRefraction, CameraSignalPass).
// ─────────────────────────────────────────────

export class PostPipeline {
  /** @type {Map<string, object>} insertion-ordered pass map */
  _passes = new Map();
  _renderer = null;
  /** Shared render targets — one per active pass, plus one for the scene.
   *  Reused every frame; resized when the window changes. */
  _targets = [];

  /** Attach to an engine. Each pass builds its own private composite scene
   *  and shaders when added. */
  attach(engine) {
    this._renderer = engine.renderer;
  }

  /** Register a pass.  `pass.build(engine)` is called immediately so the
   *  shader is ready for the WarmUp compile pass. */
  add(name, pass) {
    if (this._passes.has(name)) this.remove(name);
    pass.build({ renderer: this._renderer, pipeline: this });
    this._passes.set(name, pass);
    return this;
  }

  /** Remove and dispose a single pass. */
  remove(name) {
    const pass = this._passes.get(name);
    if (pass) { pass.dispose(); this._passes.delete(name); }
    return this;
  }

  /** Look up a pass by name. */
  get(name) { return this._passes.get(name); }

  /** True while at least one pass is active. */
  get active() {
    for (const p of this._passes.values()) if (p.active) return true;
    return false;
  }

  // ── Engine interface (same as RedOut) ──────

  /** Redirect the scene render into the first target when any pass is
   *  active. */
  preRender() {
    if (!this.active) return;
    this._ensureTargets();
    this._renderer.setRenderTarget(this._targets[0]);
  }

  /** Chain every active pass: each reads from the previous target and
   *  writes into the next one, or to the screen for the last. */
  postRender() {
    if (!this.active) return;
    const active = this._activePasses();
    if (!active.length) return;
    this._ensureTargets();

    for (let i = 0; i < active.length; i++) {
      const inputTex = this._targets[i].texture;
      const isLast = (i === active.length - 1);
      const outputTarget = isLast ? null : this._targets[i + 1];
      active[i].composite(inputTex, outputTarget, this._renderer);
    }
  }

  /** Compile every pass's composite shader while the loading screen still
   *  covers the canvas. */
  warmUp() {
    for (const p of this._passes.values()) p.warmUp?.();
  }

  /** Compile the render-target variants of every shader in the main game
   *  scene (Three.js needs separate programs for RT output), then compile
   *  each pass's own composite shader for RT output too.
   *  @param {THREE.Scene} scene  The main game scene.
   *  @param {THREE.Camera} camera */
  async preCompile(scene, camera) {
    if (!this._renderer) return;
    this._ensureTargets();
    // Compile the main scene's shaders for render-target output.
    this._renderer.setRenderTarget(this._targets[0]);
    await this._renderer.compileAsync(scene, camera);
    this._renderer.setRenderTarget(null);
    // Compile each pass's own composite shader for RT output.
    for (const p of this._passes.values()) {
      await p.preCompile?.(this._renderer, this._targets);
    }
  }

  /** Free every render target and pass. */
  dispose() {
    for (const p of this._passes.values()) p.dispose();
    this._passes.clear();
    for (const t of this._targets) t.dispose();
    this._targets.length = 0;
    this._renderer = null;
  }

  // ── Internals ─────────────────────────────

  /** Snapshot of active passes in insertion order. */
  _activePasses() {
    const out = [];
    for (const p of this._passes.values()) if (p.active) out.push(p);
    return out;
  }

  /** Ensure there is one render target per active pass, plus one for the
   *  scene output.  Targets are reused and resized, never recreated unless
   *  the count changes. */
  _ensureTargets() {
    const need = this._activePasses().length + 1; // scene target + 1 per pass
    const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const h = typeof window !== 'undefined' ? window.innerHeight : 768;

    // Grow
    while (this._targets.length < need) {
      this._targets.push(new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      }));
    }
    // Shrink
    while (this._targets.length > need) {
      this._targets.pop().dispose();
    }
    // Resize
    for (const t of this._targets) {
      if (t.width !== w || t.height !== h) t.setSize(w, h);
    }
  }
}
