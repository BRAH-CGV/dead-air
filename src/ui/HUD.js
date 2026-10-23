// ─────────────────────────────────────────────
// HUD  –  In-game heads-up display overlay
// ─────────────────────────────────────────────
// Two classes wrapping DOM elements defined in index.html:
//
//   HUD              – clock, signal counter, night label, scan bar, prompt,
//                      stamina bar, EVA suit indicator
//   RadarOverlay     – 2D canvas radar display with signal blips
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
    this._prompt    = root?.querySelector('#hud-prompt')    ?? null;
    this._suit      = root?.querySelector('#hud-suit')      ?? null;
    this._stamina     = root?.querySelector('#hud-stamina')      ?? null;
    this._staminaFill = root?.querySelector('#hud-stamina-fill') ?? null;
    this._staminaShown = -1;
    this._staminaLevel = null;
  }

  show() { if (this.root) this.root.style.display = 'block'; }
  hide() { if (this.root) this.root.style.display = 'none'; }

  setTime(timeString) {
    if (this._clock) this._clock.textContent = timeString;
  }

  setSignals(saved, required, { minSignalLevel = 1 } = {}) {
    if (!this._signals) return;
    const label = minSignalLevel >= 2 ? 'Cyan drives' : 'Drives';
    this._signals.textContent = `${label}: ${saved} / ${required}`;
  }

  setNight(number) {
    if (this._night) this._night.textContent = `Night ${number}`;
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

  /** The stamina bar: its fill, and its colour by level ('ok' | 'tired' |
   *  'critical'). Called every frame, so it writes the DOM only when the
   *  percent or the level changes. */
  setStamina(value, level = 'ok') {
    if (!this._staminaFill) return;
    const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
    if (percent !== this._staminaShown) {
      this._staminaShown = percent;
      this._staminaFill.style.width = `${percent}%`;
    }
    if (level !== this._staminaLevel && this._stamina) {
      this._staminaLevel = level;
      this._stamina.dataset.level = level;
    }
  }
}

// ── RadarTelemetry ──────────────────────────────────────────
// A data-driven panel of stylised readouts beside the radar disc.
// Organised in titled blocks (e.g. DISH, CURSOR), each block holding
// labelled rows whose values are formatted on the way in.  Adding a new
// readout is just registering a row in a block; updating is passing a
// value by key.  The panel only writes the DOM when a formatted value
// actually changes, so paintDom re-reads are cheap.

/** Format a radian angle as a signed degree string with one decimal. */
function _deg(rad) {
  return (rad * 180 / Math.PI).toFixed(1);
}

/** Format an azimuth (radians) as a 0–360° string with one decimal. */
function _az(rad) {
  let d = rad * 180 / Math.PI;
  d = ((d % 360) + 360) % 360;
  return d.toFixed(1) + '°';
}

/** Format an elevation (radians, negative = up) as a signed degree string.
 *  The sign is flipped so the display reads positive-up (zenith = +90°). */
function _el(rad) {
  return _deg(-rad) + '°';
}

/** The default block/row descriptors wired by RadarOverlay.  Each entry
 *  names a block, its title, and the rows it contains.  A row's format
 *  function turns a raw number into the display string. */
const DEFAULT_BLOCKS = [
  {
    name: 'dish',
    title: 'DISH',
    rows: [
      { key: 'dishAz',     label: 'AZ',    format: _az },
      { key: 'dishEl',     label: 'EL',    format: _el },
      { key: 'dishStatus', label: 'STATE', format: String },
    ],
  },
  {
    name: 'cursor',
    title: 'CURSOR',
    rows: [
      { key: 'cursorAz', label: 'AZ', format: _az },
      { key: 'cursorEl', label: 'EL', format: _el },
      { key: 'cursorR',  label: 'R',  format: (v) => v.toFixed(2) },
    ],
  },
];

export class RadarTelemetry {
  /**
   * @param {HTMLElement|null} root  Container element (#radar-telemetry).
   *        Null-safe: every method no-ops when root is absent (tests, other
   *        scenes).
   * @param {Array} [blocks=DEFAULT_BLOCKS]  Block descriptors to register.
   */
  constructor(root = null, blocks = DEFAULT_BLOCKS) {
    this._root = root;
    /** key → { valueEl, format, last } */
    this._rows = new Map();
    if (!root) return;
    for (const block of blocks) this._addBlock(block);
  }

  /** Build the DOM for one block (a titled group of rows). */
  _addBlock({ name, title, rows }) {
    const block = document.createElement('div');
    block.className = 'telemetry-block';
    block.dataset.block = name;

    const heading = document.createElement('div');
    heading.className = 'telemetry-block-title';
    heading.textContent = title;
    block.appendChild(heading);

    for (const row of rows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'telemetry-row';

      const label = document.createElement('span');
      label.className = 'telemetry-label';
      label.textContent = row.label;

      const value = document.createElement('span');
      value.className = 'telemetry-value';
      value.textContent = '—';

      rowEl.appendChild(label);
      rowEl.appendChild(value);
      block.appendChild(rowEl);

      this._rows.set(row.key, {
        valueEl: value,
        format: row.format ?? String,
        last: null,
      });
    }

    this._root.appendChild(block);
  }

  /** Update values by key.  Only writes the DOM when the formatted string
   *  actually changed — the radar is painted onto the computer screen via
   *  paintDom every frame, so minimising DOM mutation matters. */
  update(values) {
    if (!this._root) return;
    for (const [key, raw] of Object.entries(values)) {
      const row = this._rows.get(key);
      if (!row) continue;
      const text = row.format(raw);
      if (text === row.last) continue;
      row.last = text;
      row.valueEl.textContent = text;
    }
  }

  show() { if (this._root) this._root.style.display = ''; }
  hide() { if (this._root) this._root.style.display = 'none'; }
}

// ── RadarOverlay ───────────────────────────────────────────

export class RadarOverlay {
  constructor(root = typeof document !== 'undefined' ? document.getElementById('radar-overlay') : null) {
    this.root = root;
    this._canvas = root?.querySelector('#radar-canvas') ?? null;
    this._ctx    = this._canvas?.getContext('2d')        ?? null;
    this._info   = root?.querySelector('#radar-info')    ?? null;
    this._hint   = root?.querySelector('#radar-hint')    ?? null;
    this._warning = root?.querySelector('#radar-warning') ?? null;
    this._warningText = '';
    // Telemetry panel — stylised dish/cursor readouts on the left.
    this._telemetry = new RadarTelemetry(
      root?.querySelector('#radar-telemetry') ?? null,
    );
    /** The box fit() was given, [width, height], or null for the window. */
    this._box = null;
    this._resizeHandler = null;
    // Flash state for error feedback (beep + red blink on an indicator).
    this._flashWhich = null;  // 'drive' | 'signal' | null
    this._flashTime = 0;
    this._flashPhase = 0;
    this._prevFlashPhase = null;
    // "LET ME IN" flashing text (evil signal lock).
    this._letMeInContainer = root?.querySelector('#radar-let-me-in') ?? null;
    /** @type {{ el: HTMLElement, baseX: number, baseY: number, timer: number|null, visible: boolean }[]} */
    this._letMeInItems = [];
    this._letMeInActive = false;
    this._letMeInRafId = null;
    this._resize();
    // Resize when the window changes
    if (typeof window !== 'undefined') {
      this._resizeHandler = () => this._resize();
      window.addEventListener('resize', this._resizeHandler);
    }
  }

  /** Lay the radar out in a box of `width` × `height` CSS pixels instead of
   *  the window: the office computer's screen, as ScreenView sizes it
   *  (#161). `fit(null)` goes back to the window. */
  fit(width, height) {
    this._box = width && height ? [width, height] : null;
    this._resize();
  }

  /** Recompute the canvas size and internal metrics. Called on construction,
   *  on window resize and by fit(). The disc fills the smaller of the box's
   *  (or the window's) width or height, leaving a margin for the text below. */
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
    const size = this._box
      ? Math.min(this._box[0], this._box[1] - margin)
      : typeof window !== 'undefined'
        ? Math.min(window.innerWidth, window.innerHeight) - margin
        : 400;
    // Clamp to a reasonable range
    this._canvas.width = Math.max(200, Math.min(size, 1200));
    this._canvas.height = this._canvas.width;
    this._radius = this._canvas.width / 2;
    this._cx = this._radius;
    this._cy = this._radius;
  }

  show() {
    if (this.root) this.root.style.display = 'flex';
    this._telemetry.show();
  }
  hide() {
    if (this.root) this.root.style.display = 'none';
    this._telemetry.hide();
  }

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

  /** Push new values into the telemetry panel.  See RadarTelemetry.update.
   *  Called every frame by ComputerTerminal._updateRadarDisplay. */
  setTelemetry(values) {
    this._telemetry.update(values);
  }

  /** Update the scan progress bar (0–1).  Called every frame by the terminal. */
  setScanProgress(progress) {
    const bar = this.root?.querySelector('#radar-scan-progress');
    if (!bar) return;
    const pct = Math.max(0, Math.min(1, progress ?? 0)) * 100;
    const fill = bar.querySelector('.scan-fill');
    if (fill) fill.style.height = pct + '%';
  }

  /** Update the lock-on progress bar (0–1).  Called every frame by the terminal. */
  setLockOnProgress(progress) {
    const bar = this.root?.querySelector('#radar-lockon-progress');
    if (!bar) return;
    const pct = Math.max(0, Math.min(1, progress ?? 0)) * 100;
    const fill = bar.querySelector('.scan-fill');
    if (fill) fill.style.height = pct + '%';
  }

  /** Change the fill colour of both progress bars at once (direct inline
   *  style write — paintDom does not reliably pick up class toggles).
   *  Pass the CSS colour string; pass the default to restore. */
  setBarColor(color) {
    for (const id of ['#radar-scan-progress', '#radar-lockon-progress']) {
      const fill = this.root?.querySelector(`${id} .scan-fill`);
      if (fill) fill.style.background = color;
    }
  }

  /** Update the two drive indicator lights.
   *  Uses direct inline style writes (not CSS class toggles) because the
   *  overlay is captured by paintDom each frame, which does not reliably
   *  pick up class-driven style changes with transitions.
   *  When a flash is active the targeted dot blinks red instead of its
   *  normal colour; the flash runs for three on/off cycles then clears.
   *  Returns true when a new flash phase starts (so the caller can play
   *  a beep in sync with each blink).
   *  @param {boolean} driveInserted  Whether a drive is in the reader.
   *  @param {boolean} hasSignal       Whether the inserted drive has a signal.
   *  @returns {boolean} True when a flash phase transition occurred. */
  setDriveIndicators(driveInserted, hasSignal) {
    const driveDot = this.root?.querySelector('#drive-dot');
    const signalDot = this.root?.querySelector('#signal-dot');

    // Advance flash animation if one is running.
    let flashRed = false;
    let phaseChanged = false;
    if (this._flashWhich) {
      this._flashTime += 1 / 60;
      const phaseDur = 0.075;
      const totalPhases = 6;  // 3 on + 3 off
      const phase = Math.floor(this._flashTime / phaseDur);
      if (phase >= totalPhases) {
        this._flashWhich = null;
        this._flashTime = 0;
        this._flashPhase = 0;
        this._prevFlashPhase = null;
      } else {
        this._flashPhase = phase;
        flashRed = phase % 2 === 0;
        if (this._prevFlashPhase === null || phase !== this._prevFlashPhase) {
          this._prevFlashPhase = phase;
          phaseChanged = true;
        }
      }
    }

    if (driveDot) {
      let bg, shadow;
      if (this._flashWhich === 'drive' && flashRed) {
        bg = 'rgba(255, 50, 50, 0.9)';
        shadow = '0 0 6px rgba(255, 50, 50, 0.5)';
      } else {
        bg = driveInserted ? 'rgba(0, 255, 200, 0.85)' : '#333';
        shadow = driveInserted ? '0 0 6px rgba(0, 255, 200, 0.4)' : 'none';
      }
      if (driveDot.style.background !== bg) {
        driveDot.style.background = bg;
        driveDot.style.boxShadow = shadow;
      }
    }
    if (signalDot) {
      let bg, shadow;
      if (this._flashWhich === 'signal' && flashRed) {
        bg = 'rgba(255, 50, 50, 0.9)';
        shadow = '0 0 6px rgba(255, 50, 50, 0.5)';
      } else {
        bg = hasSignal ? 'rgba(0, 255, 200, 0.85)' : '#333';
        shadow = hasSignal ? '0 0 6px rgba(0, 255, 200, 0.4)' : 'none';
      }
      if (signalDot.style.background !== bg) {
        signalDot.style.background = bg;
        signalDot.style.boxShadow = shadow;
      }
    }

    return phaseChanged;
  }

  /** Flash an indicator light red 3 times as error feedback.
   *  @param {'drive'|'signal'} which  Which dot to flash. */
  flashIndicator(which) {
    this._flashWhich = which;
    this._flashTime = 0;
    this._flashPhase = 0;
    this._prevFlashPhase = null;
  }

  // Only on a change: the radar is painted onto the computer's screen from
  // this DOM, and every change is a fresh read of it (paintDom).
  setInfo(text) {
    if (this._info && this._info.textContent !== (text || '')) this._info.textContent = text || '';
  }

  setHint(text) {
    if (this._hint && this._hint.textContent !== (text || '')) this._hint.textContent = text || '';
  }

  /** The flashing red warning line above the info line; '' hides it.
   *  Called every frame by the terminal, so it only touches the DOM when
   *  the text changes. */
  setWarning(text) {
    const next = text || '';
    if (next === this._warningText) return;
    this._warningText = next;
    if (!this._warning) return;
    if (next) this._warning.textContent = next;
    this._warning.classList.toggle('is-shown', !!next);
  }

  /** Start flashing "LET ME IN" texts at random positions inside the
   *  radar overlay.  Called by EvilSignal when the lock begins (pull-in
   *  or engage); the texts appear on the in-world computer screen via
   *  paintDom.  Idempotent — calling while already active is a no-op. */
  startLetMeIn() {
    if (this._letMeInActive) return;
    this._letMeInActive = true;
    if (!this._letMeInContainer) return;

    const TEXT_COUNT = 6;
    const FLASH_MIN = 80, FLASH_MAX = 250;
    const PAUSE_MIN = 50, PAUSE_MAX = 300;
    const SIZE_MIN = 16, SIZE_MAX = 48;
    const VIBRATE_PX = 4;

    // Create the text elements if they don't exist yet.
    if (this._letMeInItems.length === 0) {
      for (let i = 0; i < TEXT_COUNT; i++) {
        const el = document.createElement('span');
        el.className = 'let-me-in-text';
        el.textContent = 'LET ME IN';
        this._letMeInContainer.appendChild(el);
        this._letMeInItems.push({ el, baseX: 0, baseY: 0, timer: null, visible: false });
      }
    }

    const scheduleFlash = (item, delayMs = 0) => {
      item.timer = setTimeout(() => {
        if (!this._letMeInActive) return;
        item.baseX = 8 + Math.random() * 84;
        item.baseY = 8 + Math.random() * 84;
        const size = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN);
        item.el.style.left = `${item.baseX}%`;
        item.el.style.top = `${item.baseY}%`;
        item.el.style.fontSize = `${size}px`;
        item.el.style.opacity = '1';
        item.visible = true;

        const dur = FLASH_MIN + Math.random() * (FLASH_MAX - FLASH_MIN);
        item.timer = setTimeout(() => {
          item.el.style.opacity = '0';
          item.visible = false;
          const pause = PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
          scheduleFlash(item, pause);
        }, dur);
      }, delayMs);
    };

    // Stagger the first flash for each text.
    for (const item of this._letMeInItems) {
      scheduleFlash(item, Math.random() * 400);
    }

    // Vibration loop — jitters every visible text each frame.
    const vibrate = () => {
      if (!this._letMeInActive) return;
      for (const item of this._letMeInItems) {
        if (!item.visible) continue;
        const jx = (Math.random() - 0.5) * 2 * VIBRATE_PX;
        const jy = (Math.random() - 0.5) * 2 * VIBRATE_PX;
        item.el.style.left = `${item.baseX + jx * 0.3}%`;
        item.el.style.top = `${item.baseY + jy * 0.3}%`;
      }
      this._letMeInRafId = requestAnimationFrame(vibrate);
    };
    this._letMeInRafId = requestAnimationFrame(vibrate);
  }

  /** Stop the flashing "LET ME IN" texts and hide them. */
  stopLetMeIn() {
    this._letMeInActive = false;
    for (const item of this._letMeInItems) {
      clearTimeout(item.timer);
      item.timer = null;
      item.el.style.opacity = '0';
      item.visible = false;
    }
    if (this._letMeInRafId !== null) {
      cancelAnimationFrame(this._letMeInRafId);
      this._letMeInRafId = null;
    }
  }

  /** Is the cursor (unit-circle coords, as the terminal keeps it) over the
   *  UFO blob? The same centre and radius _drawThreat draws it with, a
   *  little generous so the wobbling edge still counts. */
  threatAt(cursorX, cursorY) {
    const th = this.threat;
    if (!th?.active) return false;
    const maxR = this._radius * 0.85;
    const p = this._skyToCanvas(th.yaw, th.pitch);
    const x = this._cx + cursorX * maxR;
    const y = this._cy - cursorY * maxR;
    return Math.hypot(x - p.x, y - p.y) <= this._threatRadius(th) * 1.2;
  }

  /** The blob's base radius in canvas pixels. */
  _threatRadius(th) {
    return (0.06 + 0.3 * th.size) * this._radius * 0.85;
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
    if (sig.evil)       return `rgba(0, 220, 200, ${((sig.saved || sig.deleted) ? 0.5 : 0.8) * a})`;   // same cyan as ordinary, dim once resolved
    if (sig.saved)      return `rgba(80, 200, 80, ${0.5 * a})`;      // dim green
    if (sig.deleted)    return `rgba(200, 60, 60, ${0.5 * a})`;      // dim red
    if (sig.scanned)    return `rgba(180, 180, 60, ${0.7 * a})`;     // scanned but unresolved
    return `rgba(0, 220, 200, ${0.8 * a})`;                          // unscanned cyan
  }

  /** RGB triplet for a signal's state colour — used by the ripple
   *  animation which applies its own alpha. */
  _blipRgb(sig) {
    if (sig.evil)    return '0, 220, 200';
    if (sig.saved)   return '80, 200, 80';
    if (sig.deleted) return '200, 60, 60';
    if (sig.scanned) return '180, 180, 60';
    return '0, 220, 200';
  }

  /** The UFO on its way in, or null. UfoThreat owns the object and rewrites
   *  it in place every frame: { active, yaw, pitch, size 0..1,
   *  intensity 0..1, time }. */
  threat = null;

  /** The evil signal's dish lock, or null. EvilSignal sets it while locked:
   *  { active, yaw, pitch, intensity 0..1, time }. Draws the same glitchy
   *  effect as the UFO threat but in red, centered on the locked signal. */
  evilLock = null;

  /** A big, wobbling, glitching blob where the UFO is in the sky — on the
   *  shared _skyToCanvas mapping, like everything else. Its outline is a
   *  ring of points pushed in and out by sines that drift with time; it
   *  swells as `size` grows, and the higher `intensity` climbs the harder
   *  it shakes, the more static it throws off and the more the whole disc
   *  tears into displaced strips. */
  _drawThreat(ctx, s) {
    const th = this.threat;
    if (!th?.active) return;
    const maxR = this._radius * 0.85;
    const p = this._skyToCanvas(th.yaw, th.pitch);
    const t = th.time;
    const k = th.intensity;
    const R = this._threatRadius(th);

    // Body: a filled, many-sided outline that never holds still.
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R * 1.4);
    glow.addColorStop(0, `rgba(255, 70, 110, ${(0.55 + 0.4 * k).toFixed(3)})`);
    glow.addColorStop(0.6, `rgba(200, 20, 90, ${(0.35 + 0.3 * k).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(120, 0, 60, 0)');
    ctx.fillStyle = glow;
    this._blobPath(ctx, p, R, t, k, 0);
    ctx.fill();

    // Two loose rings shivering around it — their extra radius scales with
    // intensity so they grow outward as the effect fades in.
    for (let ring = 1; ring <= 2; ring++) {
      ctx.strokeStyle = `rgba(255, 90, 140, ${(0.25 + 0.3 * k) / ring})`;
      ctx.lineWidth = 1.5 * s;
      this._blobPath(ctx, p, R * (1 + 0.35 * ring * k), t * (1 + 0.4 * ring), k, ring * 1.7);
      ctx.stroke();
    }

    // Static: specks thrown off the blob.
    const specks = Math.floor(6 + 30 * k);
    ctx.fillStyle = `rgba(255, 160, 190, ${(0.3 + 0.5 * k).toFixed(3)})`;
    for (let i = 0; i < specks; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = R * (0.8 + Math.random() * 1.6);
      ctx.fillRect(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 2 * s, 2 * s);
    }

    // Tearing: strips of the finished disc copied back a few pixels off.
    if (this._canvas && ctx.drawImage) {
      const strips = Math.floor(k * 5);
      const w = this._radius * 2;
      for (let i = 0; i < strips; i++) {
        const y = Math.random() * w;
        const h = (2 + Math.random() * 10) * s;
        const dx = (Math.random() - 0.5) * 30 * s * k;
        ctx.drawImage(this._canvas, 0, y, w, h, dx, y, w, h);
      }
    }
  }

  /** The evil signal's dish lock — same glitchy effect as the UFO threat,
   *  but in red, centered on the locked signal. Active while EvilSignal
   *  holds the dish. */
  _drawEvilGlitch(ctx, s) {
    const lock = this.evilLock;
    if (!lock?.active) return;
    const maxR = this._radius * 0.85;
    const p = this._skyToCanvas(lock.yaw, lock.pitch);
    const t = lock.time;
    const k = lock.intensity;
    const R = this._radius * 0.15;  // smaller than the UFO blob

    // Body: red filled outline that never holds still.
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R * 1.4);
    glow.addColorStop(0, `rgba(255, 45, 45, ${(0.6 + 0.35 * k).toFixed(3)})`);
    glow.addColorStop(0.6, `rgba(200, 20, 20, ${(0.4 + 0.3 * k).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(120, 0, 0, 0)');
    ctx.fillStyle = glow;
    this._blobPath(ctx, p, R, t, k, 0);
    ctx.fill();

    // Two loose rings shivering around it — their extra radius scales with
    // intensity so they grow outward as the effect fades in.
    for (let ring = 1; ring <= 2; ring++) {
      ctx.strokeStyle = `rgba(255, 60, 60, ${(0.3 + 0.3 * k) / ring})`;
      ctx.lineWidth = 1.5 * s;
      this._blobPath(ctx, p, R * (1 + 0.35 * ring * k), t * (1 + 0.4 * ring), k, ring * 1.7);
      ctx.stroke();
    }

    // Static: specks thrown off the blob.
    const specks = Math.floor(6 + 30 * k);
    ctx.fillStyle = `rgba(255, 100, 100, ${(0.35 + 0.5 * k).toFixed(3)})`;
    for (let i = 0; i < specks; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = R * (0.8 + Math.random() * 1.6);
      ctx.fillRect(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 2 * s, 2 * s);
    }

    // Tearing: strips of the finished disc copied back a few pixels off.
    if (this._canvas && ctx.drawImage) {
      const strips = Math.floor(k * 5);
      const w = this._radius * 2;
      for (let i = 0; i < strips; i++) {
        const y = Math.random() * w;
        const h = (2 + Math.random() * 10) * s;
        const dx = (Math.random() - 0.5) * 30 * s * k;
        ctx.drawImage(this._canvas, 0, y, w, h, dx, y, w, h);
      }
    }
  }

  /** The blob's outline around `p`: 48 points, radius pushed about by three
   *  drifting sines — all scaled by intensity `k` so the wobble ramps up
   *  smoothly as the effect fades in. */
  _blobPath(ctx, p, R, t, k, phase) {
    const N = 48;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const wobble = 1
        + 0.22 * k * Math.sin(3 * a + t * 2.1 + phase)
        + 0.14 * k * Math.sin(5 * a - t * 3.7 + phase * 2)
        + 0.12 * k * Math.sin(11 * a + t * 9.3);
      const x = p.x + Math.cos(a) * R * wobble;
      const y = p.y + Math.sin(a) * R * wobble;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
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
  update(signals, dishYaw, dishPitch, cursorX, cursorY, hoveredSignal, scanProgress, neighbours = [], localRig = null, lockOnFraction = -1, lockOnTarget = null) {
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

    // Signal blips — each signal is a single expanding ripple that
    // repeats continuously.  A ring grows outward from the signal's
    // position and fades before starting again, staggered per signal
    // so they never pulse in lock-step.
    const now = Date.now();
    const RIPPLE_CYCLE = 2000;       // ms per ripple
    const RIPPLE_MAX   = 18;         // max ripple radius (in s units)
    for (let i = 0; i < signals.length; i++) {
      const sig = signals[i];
      if (sig.opacity <= 0 || sig.resolved) continue;
      const pos = this._skyToCanvas(sig.yaw, sig.pitch);
      const rgb = this._blipRgb(sig);

      // Stagger each signal's phase so the sky never pulses as one.
      // Evil signals ripple inward (contracting) instead of outward.
      const offset = (i * 737) % RIPPLE_CYCLE;
      const raw    = ((now + offset) % RIPPLE_CYCLE) / RIPPLE_CYCLE;
      const phase  = sig.evil ? 1 - raw : raw;

      // The ring — radius grows (or shrinks for evil), alpha fades.
      const ringR   = phase * RIPPLE_MAX * s;
      const ringA   = (1 - phase) * 0.8 * sig.opacity;
      if (ringA > 0.01) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${rgb}, ${ringA.toFixed(3)})`;
        ctx.lineWidth = 1.5 * s;
        ctx.stroke();
      }
    }

    // Something big coming in — over the blips, under the dish and cursor.
    this._drawThreat(ctx, s);

    // The dish is locked on the evil signal — same glitch, red.
    this._drawEvilGlitch(ctx, s);

    // Lock-on X — fades in over the target signal during phase 1.
    if (lockOnFraction > 0 && lockOnTarget && !lockOnTarget.resolved) {
      const pos = this._skyToCanvas(lockOnTarget.yaw, lockOnTarget.pitch);
      const xSize = 12 * s;
      const alpha = Math.min(1, lockOnFraction) * 0.9;
      ctx.beginPath();
      ctx.moveTo(pos.x - xSize, pos.y - xSize);
      ctx.lineTo(pos.x + xSize, pos.y + xSize);
      ctx.moveTo(pos.x + xSize, pos.y - xSize);
      ctx.lineTo(pos.x - xSize, pos.y + xSize);
      ctx.strokeStyle = `rgba(0, 255, 200, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 2 * s;
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

