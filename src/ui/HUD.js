// ─────────────────────────────────────────────
// HUD  –  In-game heads-up display overlay
// ─────────────────────────────────────────────
// Three classes wrapping DOM elements defined in index.html:
//
//   HUD              – clock, signal counter, night label, scan bar, prompt,
//                      EVA suit indicator
//   RadarOverlay     – 2D canvas radar display with signal blips
//   SignalReviewPanel– modal for save/delete after scanning a signal
//
// All follow the Crosshair/LoadingScreen pattern: markup + CSS live in
// index.html so the panel renders before any JS parses; these classes
// are the single place game code touches the DOM.
// ─────────────────────────────────────────────

import { createSkyBackdrop } from '../gameobjects/SkyBackdrop.js';
import { withKeys } from './promptKeys.js';

// ── HUD ────────────────────────────────────────────────────

export class HUD {
  /**
   * @param {HTMLElement|null} [root]
   * @param {{ keyLabel?: (text: string) => string }} [opts]  Rewrites '[E]'
   *        in prompts to the bound interact key; the shared one by default.
   */
  constructor(root = typeof document !== 'undefined' ? document.getElementById('hud') : null, { keyLabel = withKeys } = {}) {
    this.root = root;
    this.keyLabel = keyLabel;
    this._clock     = root?.querySelector('#hud-clock')     ?? null;
    this._signals   = root?.querySelector('#hud-signals')   ?? null;
    this._night     = root?.querySelector('#hud-night')     ?? null;
    this._scanBar   = root?.querySelector('#hud-scan-bar')  ?? null;
    this._prompt    = root?.querySelector('#hud-prompt')    ?? null;
    this._suit      = root?.querySelector('#hud-suit')      ?? null;
  }

  show() { if (this.root) this.root.style.display = 'block'; }
  hide() { if (this.root) this.root.style.display = 'none'; }

  setTime(timeString) {
    if (this._clock) this._clock.textContent = timeString;
  }

  setSignals(saved, required) {
    if (this._signals) this._signals.textContent = `Signals: ${saved} / ${required}`;
  }

  setNight(number) {
    if (this._night) this._night.textContent = `Night ${number}`;
  }

  /** Set scan progress bar fill (0..1). Pass -1 or negative to hide. */
  setScanProgress(fraction) {
    if (!this._scanBar) return;
    if (fraction < 0) {
      this._scanBar.style.display = 'none';
    } else {
      this._scanBar.style.display = 'block';
      this._scanBar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    }
  }

  setPrompt(text) {
    if (this._prompt) this._prompt.textContent = text ? this.keyLabel(text) : '';
  }

  /** Show the EVA suit indicator while the suit is on; hidden otherwise. */
  setSuit(worn) {
    if (!this._suit) return;
    this._suit.textContent = 'EVA suit on';
    this._suit.style.display = worn ? 'block' : 'none';
  }
}

// ── RadarOverlay ───────────────────────────────────────────

export class RadarOverlay {
  constructor(root = typeof document !== 'undefined' ? document.getElementById('radar-overlay') : null) {
    this.root = root;
    this._canvas = root?.querySelector('#radar-canvas') ?? null;
    this._ctx    = this._canvas?.getContext('2d')        ?? null;
    this._info   = root?.querySelector('#radar-info')    ?? null;
    this._hint   = root?.querySelector('#radar-hint')    ?? null;
    this._resizeHandler = null;
    this._resize();
    // Resize when the window changes
    if (typeof window !== 'undefined') {
      this._resizeHandler = () => this._resize();
      window.addEventListener('resize', this._resizeHandler);
    }
  }

  /** Recompute the canvas size and internal metrics. Called on construction
   *  and on window resize. The overlay fills the smaller of the window's
   *  width or height, leaving a margin for the text below. */
  _resize() {
    if (!this._canvas) {
      // Fallback for tests / no DOM
      this._radius = 200;
      this._cx = 200;
      this._cy = 200;
      return;
    }
    // Leave room for the info/hint text below the canvas
    const margin = 80;
    const size = typeof window !== 'undefined'
      ? Math.min(window.innerWidth, window.innerHeight) - margin
      : 400;
    // Clamp to a reasonable range
    this._canvas.width = Math.max(200, Math.min(size, 1200));
    this._canvas.height = this._canvas.width;
    this._radius = this._canvas.width / 2;
    this._cx = this._radius;
    this._cy = this._radius;
  }

  show() { if (this.root) this.root.style.display = 'flex'; }
  hide() { if (this.root) this.root.style.display = 'none'; }

  /** Stop listening for resizes and drop the sky. The window listener
   *  would otherwise keep this overlay — and the scene's sky through the
   *  backdrop — alive after every rebuild. */
  dispose() {
    this.hide();
    if (this._resizeHandler && typeof window !== 'undefined') {
      window.removeEventListener('resize', this._resizeHandler);
    }
    this._resizeHandler = null;
    this._backdrop = null;
  }

  setInfo(text) {
    if (this._info) this._info.textContent = text || '';
  }

  setHint(text) {
    if (this._hint) this._hint.textContent = text || '';
  }

  /** The faint sky behind the grid, or null for the plain dark disc. */
  _backdrop = null;

  /** Draw the actual Mars sky behind the radar grid — pass a sky from
   *  createMarsSky(), or null to go back to the plain disc. The scene wires
   *  it once; the backdrop re-reads the sky on every update, so it turns
   *  with the night and drowns in the dawn exactly as the window view
   *  does. Stars, the Milky Way and both moons land through the SAME
   *  _skyToCanvas mapping the blips use, so a blip sits on the patch of
   *  sky it belongs to. */
  setSky(sky) {
    this._backdrop = sky ? createSkyBackdrop(sky) : null;
  }

  /** Map a sky direction to a point on the radar canvas. Azimuth (yaw)
   *  sweeps around the circle — 0 rad, the window direction, sits at the
   *  BOTTOM of the canvas so the disc reads like the view out of the
   *  window: the horizon ahead on the bottom rim, the sky rising toward
   *  the centre, and what climbs in the window climbs on the radar.
   *  Elevation (-pitch) sets the radial distance: the horizon sits on the
   *  rim, the zenith at the centre. ONE mapping serves blips, the dish
   *  indicator, the neighbour sections and the sky backdrop alike, so
   *  parking the dish dot on a blip visually means the aim matches — the
   *  scan check compares exactly these angles.
   *  @param {number} yaw
   *  @param {number} pitch  negative = up
   *  @returns {{ x: number, y: number }} */
  _skyToCanvas(yaw, pitch) {
    const maxR = this._radius * 0.85;
    // Negative pitch = up. Clamp into the hemisphere so a steered-past
    // horizon or zenith still lands somewhere sane on the disc.
    const elev = Math.min(Math.max(-pitch, 0), Math.PI / 2);
    const radius = (1 - elev / (Math.PI / 2)) * maxR;
    return {
      x: this._cx + Math.sin(yaw) * radius,
      y: this._cy + Math.cos(yaw) * radius,
    };
  }

  /** Stars, the Milky Way band and both moons behind the grid — set
   *  dressing, not a second sky, so everything stays faint and clipped to
   *  the sky disc. Shares _skyToCanvas with the blips: every dot lands on
   *  the patch of sky it belongs to. Allocates nothing. */
  _drawSkyBackdrop(ctx, maxR) {
    const b = this._backdrop;
    if (!b) return;
    b.refresh();

    // Pixels per radian of elevation — the shared mapping's radial scale.
    const pxPerRad = maxR / (Math.PI / 2);

    ctx.save();
    ctx.beginPath();
    ctx.arc(this._cx, this._cy, maxR, 0, Math.PI * 2);
    ctx.clip();

    // Star dots — a subsample of the real field; the backdrop has already
    // scaled each alpha by magnitude, horizon fade and dawn.
    for (let k = 0; k < b.stars.length; k += 4) {
      const alpha = b.stars[k + 3];
      if (alpha <= 0.01) continue;
      const p = this._skyToCanvas(b.stars[k], b.stars[k + 1]);
      ctx.fillStyle = `rgba(${b.starBase}, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, b.stars[k + 2], 0, Math.PI * 2);
      ctx.fill();
    }

    // The Milky Way — one soft stroke along its visible great circle,
    // breaking wherever it dips under the horizon (NaN samples). The stroke
    // uses a radial gradient so the band fades out smoothly as it approaches
    // the edge, rather than popping in/out at the hard clip.
    const bandAlpha = Math.min(0.3, b.bandIntensity * 2.5) * (1 - b.dawn);
    if (bandAlpha > 0.01) {
      const bandGradient = ctx.createRadialGradient(
        this._cx, this._cy, maxR * 0.5,
        this._cx, this._cy, maxR * 0.9,
      );
      bandGradient.addColorStop(0, `rgba(${b.bandBase}, ${bandAlpha.toFixed(3)})`);
      bandGradient.addColorStop(1, `rgba(${b.bandBase}, 0)`);
      ctx.strokeStyle = bandGradient;
      ctx.lineWidth = Math.max(2, b.bandWidthRad * pxPerRad);
      ctx.lineCap = 'round';
      ctx.beginPath();
      let drawing = false;
      for (let k = 0; k < b.band.length; k += 2) {
        const pitch = b.band[k + 1];
        if (Number.isNaN(pitch)) { drawing = false; continue; }
        const p = this._skyToCanvas(b.band[k], pitch);
        if (drawing) ctx.lineTo(p.x, p.y);
        else { ctx.moveTo(p.x, p.y); drawing = true; }
      }
      ctx.stroke();
    }

    // Both moons — discs a shade brighter than the backdrop, dimming with
    // the dawn but not vanishing: they are meshes in the sky, not stars.
    for (const moon of b.moons) {
      if (moon.pitch >= 0) continue;   // under the horizon this hour
      const p = this._skyToCanvas(moon.yaw, moon.pitch);
      ctx.fillStyle = `rgba(${moon.base}, ${(0.7 * (1 - 0.6 * b.dawn)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(3, moon.angularRadius * pxPerRad), 0, Math.PI * 2);
      ctx.fill();
    }

    // Soft fade at the edge — a radial gradient overlay that hides the hard
    // clip. Fades from transparent at 85% of the radius to the background
    // color at the rim, so stars and the Milky Way fade out smoothly rather
    // than popping in/out.
    const fadeInner = 0.85;
    const gradient = ctx.createRadialGradient(
      this._cx, this._cy, maxR * fadeInner,
      this._cx, this._cy, maxR,
    );
    gradient.addColorStop(0, 'rgba(10, 15, 25, 0)');
    gradient.addColorStop(1, 'rgba(10, 15, 25, 0.92)');
    ctx.fillStyle = gradient;
    ctx.fillRect(this._cx - maxR, this._cy - maxR, maxR * 2, maxR * 2);

    ctx.restore();
  }

  /** A dish's coverage section as a circle on the canvas. Coverage is
   *  measured on the radar's own disc (see DishRig.skyToCursor): bearing
   *  around, elevation out from the centre — the same unit the cursor and
   *  the blips' radial placement use — so a section that reads as a circle
   *  to the player is drawn as an exact circle, and its centre sits where
   *  the shared _skyToCanvas mapping puts the rig's origin.
   *  @param {import('../gameobjects/DishRig.js').DishRig} rig
   *  @returns {{ x: number, y: number, r: number }} */
  _sectionCircle(rig) {
    const maxR = this._radius * 0.85;
    return {
      x: this._cx + rig.originX * maxR,
      y: this._cy - rig.originY * maxR,
      r: rig.coverageRadius * maxR,
    };
  }

  /** Blip fill colour for a signal, its alpha scaled by the signal's
   *  fade-in opacity — a signal mid-fade shows as a ghost of its state. */
  _blipColor(sig) {
    const a = sig.opacity;
    if (sig.saved)      return `rgba(80, 200, 80, ${0.5 * a})`;      // dim green
    if (sig.deleted)    return `rgba(200, 60, 60, ${0.5 * a})`;      // dim red
    if (sig.scanned)    return `rgba(180, 180, 60, ${0.7 * a})`;     // scanned but unresolved
    return `rgba(0, 220, 200, ${0.8 * a})`;                          // unscanned cyan
  }

  /** Redraw the radar with current signal data, dish direction, cursor,
   *  and scan state. Blips and indicators share one sky mapping: azimuth
   *  (yaw) sweeps around the circle, elevation (-pitch) sets the radial
   *  distance — horizon on the rim, zenith at the centre. The cursor is
   *  in Cartesian unit-circle coords, drawn directly without projection.
   *  @param {import('../gameplay/SignalTarget.js').SignalTarget[]} signals
   *  @param {number} dishYaw   Current neck rotation Y
   *  @param {number} dishPitch Current dish rotation X
   *  @param {number} cursorX   Cursor x in unit circle (-1..+1)
   *  @param {number} cursorY   Cursor y in unit circle (-1..+1); the disc's
   *                            centre is the zenith, its rim the horizon
   *  @param {import('../gameplay/SignalTarget.js').SignalTarget|null} hoveredSignal
   *  @param {number} scanProgress 0..1 while scanning, -1 when not
   *  @param {import('../gameobjects/DishRig.js').DishRig[]} [neighbours]
   *   The neighbour array dishes: each draws its sky section, a line from
   *   its origin to where it faces, and a small aim dot — locked dishes
   *   visibly converge on the scanned blip
   *  @param {import('../gameobjects/DishRig.js').DishRig|null} [localRig]
   *   The local dish's rig: draws its reach as an amber circle around the
   *   centre, covering the majority of the scannable band */
  update(signals, dishYaw, dishPitch, cursorX, cursorY, hoveredSignal, scanProgress, neighbours = [], localRig = null) {
    const ctx = this._ctx;
    if (!ctx) return;

    const r = this._radius;
    const cx = this._cx;
    const cy = this._cy;
    const maxR = this._radius * 0.85;
    // Scale factor: the original canvas was 400×400 (radius 200). Scale all
    // stroke widths and element sizes proportionally so the overlay looks
    // the same at any size.
    const s = r / 200;

    // Clear
    ctx.clearRect(0, 0, r * 2, r * 2);

    // Background circle
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 15, 25, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 200, 180, 0.3)';
    ctx.lineWidth = 1 * s;
    ctx.stroke();

    // The real sky, faintly: stars, the Milky Way and both moons, read
    // live from the sky the scene wired in — under the grid, so the grid
    // and the blips stay the readable layer.
    this._drawSkyBackdrop(ctx, maxR);

    // Grid rings
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (r * i) / 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 200, 180, 0.12)';
      ctx.stroke();
    }

    // Cross lines
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, r * 2);
    ctx.moveTo(0, cy); ctx.lineTo(r * 2, cy);
    ctx.strokeStyle = 'rgba(0, 200, 180, 0.12)';
    ctx.stroke();

    // Local dish reach — the amber circle around the centre, covering the
    // majority of the scannable band. Amber to match the local dish
    // indicator: beyond this circle our own tower stops following the
    // cursor.
    if (localRig && Number.isFinite(localRig.coverageRadius)) {
      const c = this._sectionCircle(localRig);
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 200, 60, 0.25)';
      ctx.lineWidth = 1 * s;
      ctx.stroke();
    }

    // Neighbour array sections — a faint circle marking the patch of sky
    // each far-off dish can see, drawn before the blips so the blips stay
    // dominant. The origins sit on the rim and each section reaches past
    // the sky's edge, so the circle is clipped to the radar disc — its
    // outer half reads as cut off — and each dish gets the same treatment
    // as the local one: a small dot on its origin and a line from there to
    // where it faces.
    for (const rig of neighbours) {
      if (!Number.isFinite(rig.coverageRadius)) continue;
      const c = this._sectionCircle(rig);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx.clip();
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 200, 180, 0.22)';
      ctx.lineWidth = 1 * s;
      ctx.stroke();
      ctx.restore();

      // Origin dot + line to the facing, then the aim dot — same shape
      // and mapping as the local dish's amber centre line.
      const aim = this._skyToCanvas(rig.currentYaw, rig.currentPitch);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(aim.x, aim.y);
      ctx.strokeStyle = 'rgba(120, 190, 180, 0.45)';
      ctx.lineWidth = 1.5 * s;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(c.x, c.y, 2 * s, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(120, 190, 180, 0.5)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(aim.x, aim.y, 2.5 * s, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(120, 190, 180, 0.55)';
      ctx.fill();
    }

    // Signal blips — shared _skyToCanvas mapping. Each signal appears on
    // its own schedule through the night and fades in (sig.opacity), so
    // an un-appeared signal draws nothing at all.
    for (const sig of signals) {
      if (sig.opacity <= 0) continue;
      const pos = this._skyToCanvas(sig.yaw, sig.pitch);

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 5 * s, 0, Math.PI * 2);
      ctx.fillStyle = this._blipColor(sig);
      ctx.fill();
    }

    // Hover highlight — pulsing glow around the hovered signal
    if (hoveredSignal && !hoveredSignal.resolved) {
      const hPos = this._skyToCanvas(hoveredSignal.yaw, hoveredSignal.pitch);
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.006);
      ctx.beginPath();
      ctx.arc(hPos.x, hPos.y, (10 + pulse * 3) * s, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 255, 230, ${0.3 + pulse * 0.3})`;
      ctx.lineWidth = 2 * s;
      ctx.stroke();
    }

    // Scan progress ring — arc around the hovered/scanning signal
    if (scanProgress >= 0 && hoveredSignal) {
      const sPos = this._skyToCanvas(hoveredSignal.yaw, hoveredSignal.pitch);
      ctx.beginPath();
      ctx.arc(sPos.x, sPos.y, 14 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * scanProgress);
      ctx.strokeStyle = 'rgba(0, 255, 200, 0.9)';
      ctx.lineWidth = 3 * s;
      ctx.stroke();
    }

    // Dish direction line + dot — same mapping as the blips
    const dish = this._skyToCanvas(dishYaw, dishPitch);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(dish.x, dish.y);
    ctx.strokeStyle = 'rgba(255, 200, 60, 0.7)';
    ctx.lineWidth = 2 * s;
    ctx.stroke();

    // Origin dot — matches the neighbour origin dots
    ctx.beginPath();
    ctx.arc(cx, cy, 2 * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 200, 60, 0.6)';
    ctx.fill();

    // Aim dot
    ctx.beginPath();
    ctx.arc(dish.x, dish.y, 4 * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 200, 60, 0.9)';
    ctx.fill();

    // Cursor indicator — crosshair at the Cartesian cursor position
    const curX = this._cx + cursorX * maxR;
    const curY = this._cy - cursorY * maxR;
    const cSize = 8 * s;
    ctx.beginPath();
    ctx.moveTo(curX - cSize, curY); ctx.lineTo(curX + cSize, curY);
    ctx.moveTo(curX, curY - cSize); ctx.lineTo(curX, curY + cSize);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.5 * s;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(curX, curY, 3 * s, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1 * s;
    ctx.stroke();
  }
}

// ── SignalReviewPanel ──────────────────────────────────────

export class SignalReviewPanel {
  constructor(root = typeof document !== 'undefined' ? document.getElementById('signal-review') : null) {
    this.root = root;
    this._image    = root?.querySelector('#signal-review-image')  ?? null;
    this._saveBtn  = root?.querySelector('#signal-save-btn')      ?? null;
    this._deleteBtn = root?.querySelector('#signal-delete-btn')    ?? null;
    this._saveCb    = null;
    this._deleteCb  = null;
    this._keyHandler = null;

    // Wire click handlers. The buttons outlive the scene (index.html), so
    // the handlers are kept to be removed again in dispose().
    this._onSaveClick   = () => this._saveCb?.();
    this._onDeleteClick = () => this._deleteCb?.();
    this._saveBtn?.addEventListener('click', this._onSaveClick);
    this._deleteBtn?.addEventListener('click', this._onDeleteClick);
  }

  /** Let go of the page's buttons. Without this every scene rebuild adds
   *  another pair of click listeners, and one click saves into every dead
   *  scene as well as the live one. */
  dispose() {
    this.hide();
    this._saveBtn?.removeEventListener('click', this._onSaveClick);
    this._deleteBtn?.removeEventListener('click', this._onDeleteClick);
    this._saveCb = null;
    this._deleteCb = null;
  }

  /** Show the panel with the signal's payload image. */
  show(payloadUrl) {
    if (!this.root) return;
    if (this._image) this._image.src = payloadUrl;
    this.root.style.display = 'flex';
    this._installKeyHandler();
  }

  /** Hide the panel and clear handlers. */
  hide() {
    if (!this.root) return;
    this.root.style.display = 'none';
    if (this._image) this._image.src = '';
    this._removeKeyHandler();
  }

  /** Register callback for save action (KeyS or click). */
  onSave(callback) { this._saveCb = callback; }

  /** Register callback for delete action (KeyD or click). */
  onDelete(callback) { this._deleteCb = callback; }

  _installKeyHandler() {
    this._removeKeyHandler();
    this._keyHandler = (e) => {
      if (e.code === 'KeyS') { e.preventDefault(); this._saveCb?.(); }
      if (e.code === 'KeyD') { e.preventDefault(); this._deleteCb?.(); }
    };
    addEventListener('keydown', this._keyHandler);
  }

  _removeKeyHandler() {
    if (this._keyHandler) {
      removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
  }
}
