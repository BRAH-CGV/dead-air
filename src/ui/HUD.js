// ─────────────────────────────────────────────
// HUD  –  In-game heads-up display overlay
// ─────────────────────────────────────────────
// Three classes wrapping DOM elements defined in index.html:
//
//   HUD              – clock, signal counter, night label, scan bar, prompt
//   RadarOverlay     – 2D canvas radar display with signal blips
//   SignalReviewPanel– modal for save/delete after scanning a signal
//
// All follow the Crosshair/LoadingScreen pattern: markup + CSS live in
// index.html so the panel renders before any JS parses; these classes
// are the single place game code touches the DOM.
// ─────────────────────────────────────────────

// ── HUD ────────────────────────────────────────────────────

export class HUD {
  constructor(root = typeof document !== 'undefined' ? document.getElementById('hud') : null) {
    this.root = root;
    this._clock     = root?.querySelector('#hud-clock')     ?? null;
    this._signals   = root?.querySelector('#hud-signals')   ?? null;
    this._night     = root?.querySelector('#hud-night')     ?? null;
    this._scanBar   = root?.querySelector('#hud-scan-bar')  ?? null;
    this._prompt    = root?.querySelector('#hud-prompt')    ?? null;
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
    if (this._prompt) this._prompt.textContent = text || '';
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
    this._radius = this._canvas ? this._canvas.width / 2 : 200;
    this._cx     = this._radius;
    this._cy     = this._radius;
  }

  show() { if (this.root) this.root.style.display = 'flex'; }
  hide() { if (this.root) this.root.style.display = 'none'; }

  setInfo(text) {
    if (this._info) this._info.textContent = text || '';
  }

  setHint(text) {
    if (this._hint) this._hint.textContent = text || '';
  }

  /** Map a sky direction to a point on the radar canvas. Azimuth (yaw)
   *  sweeps around the circle — 0 rad points up — and elevation (-pitch)
   *  sets the radial distance: the horizon sits on the rim, the zenith at
   *  the centre. ONE mapping serves blips and the dish indicator alike, so
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
      y: this._cy - Math.cos(yaw) * radius,
    };
  }

  /** Redraw the radar with current signal data and dish direction.
   *  Blips and the dish indicator share one sky mapping: azimuth (yaw)
   *  sweeps around the circle, elevation (-pitch) sets the radial distance
   *  — horizon on the rim, zenith at the centre. Parking the dish dot on
   *  a blip visually matches the aim the scan checks.
   *  @param {import('../gameplay/SignalTarget.js').SignalTarget[]} signals
   *  @param {number} dishYaw   Current neck rotation Y
   *  @param {number} dishPitch Current dish rotation X
   *  @param {number|null} selectedId  Currently selected signal ID
   *  @param {number} [dishTargetYaw]   Where the dish is slewing toward (Y)
   *  @param {number} [dishTargetPitch] Where the dish is slewing toward (X) */
  update(signals, dishYaw, dishPitch, selectedId, dishTargetYaw, dishTargetPitch) {
    const ctx = this._ctx;
    if (!ctx) return;

    const r = this._radius;
    const cx = this._cx;
    const cy = this._cy;

    // Clear
    ctx.clearRect(0, 0, r * 2, r * 2);

    // Background circle
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 15, 25, 0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 200, 180, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

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

    // Dish direction line + dot — same mapping as the blips, so aiming is
    // just "put the dot on the blip". Elevation (W/S) moves the dot
    // radially; azimuth (A/D) sweeps it around the circle.
    const dish = this._skyToCanvas(dishYaw, dishPitch);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(dish.x, dish.y);
    ctx.strokeStyle = 'rgba(255, 200, 60, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(dish.x, dish.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 200, 60, 0.9)';
    ctx.fill();

    // Where the dish is slewing TOWARD (the target), as a faint cross —
    // the dish lags behind steering at maxRotationSpeed, so this shows
    // where it will settle while the dot catches up.
    if (dishTargetYaw !== undefined && dishTargetYaw !== null) {
      const t = this._skyToCanvas(dishTargetYaw, dishTargetPitch);
      ctx.beginPath();
      ctx.moveTo(t.x - 5, t.y); ctx.lineTo(t.x + 5, t.y);
      ctx.moveTo(t.x, t.y - 5); ctx.lineTo(t.x, t.y + 5);
      ctx.strokeStyle = 'rgba(255, 200, 60, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Signal blips — the same _skyToCanvas mapping the dish indicator uses
    for (const sig of signals) {
      const pos = this._skyToCanvas(sig.yaw, sig.pitch);
      const sx = pos.x;
      const sy = pos.y;

      let color;
      let dotR = 5;
      if (sig.saved) {
        color = 'rgba(80, 200, 80, 0.5)';      // dim green
      } else if (sig.deleted) {
        color = 'rgba(200, 60, 60, 0.5)';       // dim red
      } else if (sig.id === selectedId) {
        color = 'rgba(0, 255, 230, 1.0)';       // bright pulsing
        dotR = 7;
      } else if (sig.scanned) {
        color = 'rgba(180, 180, 60, 0.7)';       // scanned but unresolved
      } else {
        color = 'rgba(0, 220, 200, 0.8)';        // unscanned cyan
      }

      ctx.beginPath();
      ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Selected glow
      if (sig.id === selectedId) {
        ctx.beginPath();
        ctx.arc(sx, sy, dotR + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0, 255, 230, 0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
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

    // Wire click handlers
    this._saveBtn?.addEventListener('click', () => this._saveCb?.());
    this._deleteBtn?.addEventListener('click', () => this._deleteCb?.());
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
