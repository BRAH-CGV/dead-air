// ─────────────────────────────────────────────
// CameraFeed  –  the security monitor's state (pure)
// ─────────────────────────────────────────────
// Which camera is on screen, where each one points, whether its flash is lit,
// and whether the picture has come through yet. No Three.js and no DOM:
// CameraTerminal reads it and moves the real cameras, the light and the
// overlay to match.
//
//   const feed = new CameraFeed({ cameras, isReady: zone => zones.isReady(zone) });
//   feed.open();            // on the camera last watched, behind static
//   feed.pan(+1, dt);       // hold to turn, within the camera's panRange
//   feed.toggleFlash();     // F
//   feed.next();            // another camera: static again, the flash out
//   feed.update(dt);        // once a frame — `live` once the picture is in
//   feed.close();           // the flash goes out with the view
//
// The static covers what the occlusion sort left undrawn (BaseScene's
// zones): the yard is skipped while the player is indoors, so a yard camera
// has to wait for it to be shown, compiled and drawn a few frames. Every
// switch shows static for at least `minStatic`, so a ready camera still
// cuts like a monitor changing channel; a load that never settles gives up
// after `maxStatic`.
// ─────────────────────────────────────────────

export const CCTV = {
  /** Radians a second a held key turns a camera. */
  panRate: 0.9,
  /** Seconds of static on every switch, however ready the picture is. */
  minStatic: 0.25,
  /** Seconds of static at most, waiting on a zone to load. */
  maxStatic: 2,
};

export class CameraFeed {
  /** Watching the cameras. */
  active = false;
  /** The camera on screen (kept while closed: reopening comes back to it). */
  index = 0;
  /** The flash on the camera on screen is lit. */
  flash = false;
  /** The picture is through; false while static shows. */
  live = false;

  /**
   * @param {object} opts
   * @param {{ panRange?: number, zones?: string[] }[]} opts.cameras
   * @param {(zone: string) => boolean} [opts.isReady]  Is a zone drawn and settled?
   */
  constructor({ cameras, isReady = () => true }) {
    this.cameras = cameras;
    this.isReady = isReady;
    this._pan = cameras.map(() => 0);
    this._static = 0;
  }

  get camera() { return this.cameras[this.index]; }

  /** How far camera `i` is turned from its rest, radians (+ = left). */
  panOf(i) { return this._pan[i] ?? 0; }

  open() {
    this.active = true;
    this._cut();
  }

  close() {
    this.active = false;
    this.flash = false;
    this.live = false;
  }

  /** Switch to camera `i`; a number it doesn't have is ignored. */
  select(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.cameras.length) return;
    this.index = i;
    if (this.active) this._cut();
  }

  next() { this.select((this.index + 1) % this.cameras.length); }
  prev() { this.select((this.index - 1 + this.cameras.length) % this.cameras.length); }

  /** Turn the camera on screen: `dir` +1 left, −1 right, for `dt` seconds.
   *  Kept within its `panLimits` ([right, left], which a camera on a wall
   *  narrows so its lens never swings into it), else ±`panRange`. */
  pan(dir, dt) {
    if (!this.active || !dir) return;
    const range = this.camera.panRange ?? 0;
    const [lo, hi] = this.camera.panLimits ?? [-range, range];
    const p = this._pan[this.index] + Math.sign(dir) * CCTV.panRate * dt;
    this._pan[this.index] = Math.min(hi, Math.max(lo, p));
  }

  toggleFlash() {
    if (!this.active) return;
    this.flash = !this.flash;
  }

  update(dt) {
    if (!this.active) return;
    this._static += dt;
    if (this.live) return;
    const zones = this.camera.zones ?? [];
    const ready = zones.every(zone => this.isReady(zone));
    this.live = this._static >= CCTV.maxStatic || (this._static >= CCTV.minStatic && ready);
  }

  /** A new picture: static from the top, and the last camera's flash out. */
  _cut() {
    this._static = 0;
    this.live = false;
    this.flash = false;
  }
}
