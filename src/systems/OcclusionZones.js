// ─────────────────────────────────────────────
// OcclusionZones  –  named sets of objects drawn or skipped together
// ─────────────────────────────────────────────
// Hand-placed occlusion: a zone is a list of objects that can all be hidden
// when the player is somewhere none of them can be seen from. Hiding is just
// `visible = false` — the geometry, textures and shader programs stay on the
// GPU (the boot warm-up put them there), so showing a zone again costs
// nothing to upload and nothing to compile. That is what lets the airlock
// swap sides without a hitch.
//
//   zones.add('yard', [buggy, generator]);
//   zones.hide('yard');
//   zones.show('yard');            // and then, before opening a door onto it:
//   zones.isReady('yard');         // compiled, loaded, and drawn a few frames
//
// "Ready" is the airlock's gate. After show(), a zone is ready once:
//   • the renderer has compiled it (compileAsync — instant when the programs
//     are cached, which after the warm-up they are; real work if a new
//     material turned up),
//   • anything registered with waitFor() has finished loading,
//   • and it has been drawn for `framesToReady` frames (tick() once a frame),
//     so any lazy upload has happened behind a shut door.
//
// revealAll() is the override for the debug fly camera and the level editor:
// everything drawn, the zones' own state kept underneath and put back after.
// ─────────────────────────────────────────────

export class OcclusionZones {
  /**
   * @param {object} [opts]
   * @param {{compileAsync: Function}} [opts.renderer]  Omit headless.
   * @param {import('three').Scene}  [opts.scene]
   * @param {import('three').Camera} [opts.camera]
   * @param {number} [opts.framesToReady=3]
   */
  constructor({ renderer = null, scene = null, camera = null, framesToReady = 3 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.framesToReady = framesToReady;

    /** name → { objects, visible, compiled, loads, frames } */
    this._zones = new Map();
    this._revealed = false;
    this._listeners = new Set();
  }

  /** Add objects to a zone, creating it (visible) if new. */
  add(name, objects) {
    let zone = this._zones.get(name);
    if (!zone) {
      // A zone that exists from the start was drawn by the boot warm-up, so
      // it starts out ready.
      zone = { objects: [], visible: true, compiled: true, loads: [], frames: this.framesToReady, settledFrames: 1 };
      this._zones.set(name, zone);
    }
    zone.objects.push(...objects);
    for (const o of objects) o.visible = this._revealed || zone.visible;
  }

  /** @returns {string[]} */
  names() { return [...this._zones.keys()]; }

  /** The objects in a zone. @returns {import('three').Object3D[]} */
  objects(name) { return this._zones.get(name)?.objects ?? []; }

  isVisible(name) { return !!this._zones.get(name)?.visible; }

  /** Drawn, compiled, loaded, and a few frames old. */
  isReady(name) {
    const zone = this._zones.get(name);
    return !!zone && zone.visible && zone.compiled && zone.loads.length === 0
        && zone.frames >= this.framesToReady && zone.settledFrames >= 1;
  }

  /** Hold the zone's readiness until `promise` settles — an asset still
   *  loading for it. */
  waitFor(name, promise) {
    const zone = this._zones.get(name);
    if (!zone) return;
    zone.loads.push(promise);
    const done = () => {
      const i = zone.loads.indexOf(promise);
      if (i !== -1) zone.loads.splice(i, 1);
      zone.settledFrames = 0;   // drawn at least once *after* it arrived
    };
    promise.then(done, done);
  }

  show(name) {
    const zone = this._zones.get(name);
    if (!zone || zone.visible) return;
    zone.visible = true;
    zone.frames = 0;
    zone.settledFrames = 0;
    zone.compiled = false;
    this._apply(zone);
    this._compile(zone);
    this._emit(name, true);
  }

  hide(name) {
    const zone = this._zones.get(name);
    if (!zone || !zone.visible) return;
    zone.visible = false;
    this._apply(zone);
    this._emit(name, false);
  }

  /** Count a drawn frame. Call once per frame. A zone needs `framesToReady`
   *  frames since it was shown, at least one of them after its compile and
   *  loads finished. */
  tick() {
    for (const zone of this._zones.values()) {
      if (!zone.visible) continue;
      zone.frames++;
      if (zone.compiled && zone.loads.length === 0) zone.settledFrames++;
    }
  }

  /** Draw everything (on) or go back to the zones' own state (off). */
  revealAll(on) {
    on = !!on;
    if (on === this._revealed) return;
    this._revealed = on;
    for (const zone of this._zones.values()) this._apply(zone);
  }

  get revealed() { return this._revealed; }

  /** `listener(name, visible)` on every real change. @returns unsubscribe */
  onChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** Show everything and forget every zone. */
  dispose() {
    for (const zone of this._zones.values()) {
      for (const o of zone.objects) o.visible = true;
    }
    this._zones.clear();
    this._listeners.clear();
  }

  // ── Internals ─────────────────────────────

  _apply(zone) {
    const visible = this._revealed || zone.visible;
    for (const o of zone.objects) o.visible = visible;
  }

  _compile(zone) {
    const { renderer, camera, scene } = this;
    if (!renderer?.compileAsync || !camera || !scene) {
      zone.compiled = true;
      return;
    }
    const token = (zone._compileToken = {});
    const done = () => {
      // A hide/show while compiling starts a new compile; only the latest counts.
      if (zone._compileToken !== token) return;
      zone.compiled = true;
      zone.settledFrames = 0;
    };
    Promise.all(zone.objects.map(o => renderer.compileAsync(o, camera, scene))).then(done, done);
  }

  _emit(name, visible) {
    for (const listener of [...this._listeners]) listener(name, visible);
  }
}
