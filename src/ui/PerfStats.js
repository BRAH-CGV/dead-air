// ─────────────────────────────────────────────
// PerfStats  –  FPS / draw-call readout (debug, I to toggle)
// ─────────────────────────────────────────────
// Reads THREE.WebGLRenderer.info after each frame. `render.calls` and
// `render.triangles` cover the whole frame, shadow-map passes and screen
// passes (the security monitor's feed) included — so a shadow-casting point
// light (6 extra passes) shows up here. The engine resets info once a frame
// (autoReset off): left to three, each render() reset it, and the readout
// showed whichever render came last, often the feed's alone.
//
// Draw calls show the last frame and the heaviest of the interval, each
// with the screen passes' share: the feed is drawn only some frames, and a
// shadow map only when something moves, so the heavy frames come and go.
// `drawcalls` in the console breaks one frame down.
//
// Refreshes the text once per `interval` rather than every frame, and does
// nothing while hidden, so leaving it in the build is free. Shows the worst
// frame of the interval next to the average: a stutter vanishes in an
// average but is exactly what the player feels.
// ─────────────────────────────────────────────

export class PerfStats {
  /**
   * @param {HTMLElement|null} [root]  Defaults to #perf-stats, created if missing
   * @param {object} [opts]
   * @param {number} [opts.interval=0.5]  Seconds between refreshes
   */
  constructor(root = PerfStats.findOrCreate(), { interval = 0.5 } = {}) {
    this.root = root;
    this.interval = interval;
    this._reset();
    if (this.root) this.root.style.display = 'none';
  }

  static findOrCreate() {
    if (typeof document === 'undefined') return null;
    let el = document.getElementById('perf-stats');
    if (!el) {
      el = document.createElement('div');
      el.id = 'perf-stats';
      Object.assign(el.style, {
        position: 'fixed',
        top: '8px',
        left: '8px',
        padding: '6px 8px',
        background: 'rgba(0, 0, 0, 0.6)',
        color: '#cfe8d0',
        font: '12px monospace',
        whiteSpace: 'pre',
        pointerEvents: 'none',
        zIndex: '20',
      });
      document.body.appendChild(el);
    }
    return el;
  }

  get visible() { return !!this.root && this.root.style.display !== 'none'; }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  /** Show the readout (the Show FPS setting, or I). */
  show() {
    if (!this.root || this.visible) return;
    this.root.style.display = 'block';
    this._reset();
  }

  hide() {
    if (!this.root) return;
    this.root.style.display = 'none';
    this._reset();
  }

  /** Call once per rendered frame, after renderer.render().
   *  @param {number} dt  Frame time, seconds
   *  @param {{render:{calls:number,triangles:number}, memory:{geometries:number,textures:number}}} info
   *  @param {number} [screens]  Of info's calls, those the screen passes drew */
  update(dt, info, screens = 0) {
    if (!this.visible) return;
    this._time += dt;
    this._frames++;
    if (dt > this._worst) this._worst = dt;
    if (info.render.calls > this._mostCalls) {
      this._mostCalls = info.render.calls;
      this._mostScreens = screens;
    }
    // Tolerance: summing 1/60 thirty times lands a hair under 0.5.
    if (this._time < this.interval - 1e-9) return;

    const fps   = Math.round(this._frames / this._time);
    const avgMs = (this._time / this._frames * 1000).toFixed(1);
    const worst = (this._worst * 1000).toFixed(1);
    const n = v => v.toLocaleString('en-US');
    this.root.textContent =
      `FPS ${fps}  ${avgMs} ms (worst ${worst} ms)\n` +
      `Draw calls ${n(info.render.calls)} (screens ${n(screens)}), most ${n(this._mostCalls)} (screens ${n(this._mostScreens)})\n` +
      `Triangles  ${n(info.render.triangles)}\n` +
      `Geometries ${n(info.memory.geometries)}  Textures ${n(info.memory.textures)}`;
    this._reset();
  }

  _reset() {
    this._time = 0;
    this._frames = 0;
    this._worst = 0;
    this._mostCalls = 0;
    this._mostScreens = 0;
  }
}
