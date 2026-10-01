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

// ── HUD ────────────────────────────────────────────────────

export class HUD {
  constructor(root = typeof document !== 'undefined' ? document.getElementById('hud') : null) {
    this.root = root;
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
    if (this._prompt) this._prompt.textContent = text || '';
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
   *  the centre. ONE mapping serves blips, the dish indicator and the
   *  neighbour sections alike, so parking the dish dot on a blip visually
   *  means the aim matches — the scan check compares exactly these angles.
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

  /** Redraw the radar with current signal data, dish direction, cursor,
   *  and scan state. Blips and indicators share one sky mapping: azimuth
   *  (yaw) sweeps around the circle, elevation (-pitch) sets the radial
   *  distance — horizon on the rim, zenith at the centre. The cursor is
   *  in Cartesian unit-circle coords, drawn directly without projection.
   *  @param {import('../gameplay/SignalTarget.js').SignalTarget[]} signals
   *  @param {number} dishYaw   Current neck rotation Y
   *  @param {number} dishPitch Current dish rotation X
   *  @param {number} cursorX   Cursor x in unit circle (-1..+1)
   *  @param {number} cursorY   Cursor y in unit circle (-1..+1, +1=zenith)
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

    // Local dish reach — the amber circle around the centre, covering the
    // majority of the scannable band. Amber to match the local dish
    // indicator: beyond this circle our own tower stops following the
    // cursor.
    if (localRig && Number.isFinite(localRig.coverageRadius)) {
      const c = this._sectionCircle(localRig);
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 200, 60, 0.25)';
      ctx.lineWidth = 1;
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
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // Origin dot + line to the facing, then the aim dot — same shape
      // and mapping as the local dish's amber centre line.
      const aim = this._skyToCanvas(rig.currentYaw, rig.currentPitch);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(aim.x, aim.y);
      ctx.strokeStyle = 'rgba(120, 190, 180, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(c.x, c.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(120, 190, 180, 0.5)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(aim.x, aim.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(120, 190, 180, 0.55)';
      ctx.fill();
    }

    // Signal blips — shared _skyToCanvas mapping
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
      } else if (sig.scanned) {
        color = 'rgba(180, 180, 60, 0.7)';       // scanned but unresolved
      } else {
        color = 'rgba(0, 220, 200, 0.8)';        // unscanned cyan
      }

      ctx.beginPath();
      ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Hover highlight — pulsing glow around the hovered signal
    if (hoveredSignal && !hoveredSignal.resolved) {
      const hPos = this._skyToCanvas(hoveredSignal.yaw, hoveredSignal.pitch);
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.006);
      ctx.beginPath();
      ctx.arc(hPos.x, hPos.y, 10 + pulse * 3, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 255, 230, ${0.3 + pulse * 0.3})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Scan progress ring — arc around the hovered/scanning signal
    if (scanProgress >= 0 && hoveredSignal) {
      const sPos = this._skyToCanvas(hoveredSignal.yaw, hoveredSignal.pitch);
      ctx.beginPath();
      ctx.arc(sPos.x, sPos.y, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * scanProgress);
      ctx.strokeStyle = 'rgba(0, 255, 200, 0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Dish direction line + dot — same mapping as the blips
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

    // Cursor indicator — crosshair at the Cartesian cursor position
    const curX = this._cx + cursorX * maxR;
    const curY = this._cy - cursorY * maxR;
    const cSize = 8;
    ctx.beginPath();
    ctx.moveTo(curX - cSize, curY); ctx.lineTo(curX + cSize, curY);
    ctx.moveTo(curX, curY - cSize); ctx.lineTo(curX, curY + cSize);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(curX, curY, 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
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
