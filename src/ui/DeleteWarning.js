// ─────────────────────────────────────────────
// DeleteWarning  –  the corrupted drive's desperate plea
// ─────────────────────────────────────────────
// Multiple "DELETE" texts flash at random positions and sizes across the
// screen while the corrupted drive exists. Each text vibrates intensely
// (rapid position jitter) and reappears at a new random location and
// scale every flash.
//
//   warning.show();   // start the flashing
//   warning.hide();   // stop (drive wiped or night reset)
//
// Wraps #delete-warning in index.html. Without a DOM every call is a
// no-op, so tests and headless runs are unaffected.
// ─────────────────────────────────────────────

/** Number of simultaneous "DELETE" texts on screen. */
const TEXT_COUNT = 8;

/** How long each text stays visible before flashing again (ms). */
const FLASH_DURATION_MIN = 80;
const FLASH_DURATION_MAX = 250;

/** Pause between flashes (ms). */
const PAUSE_MIN = 50;
const PAUSE_MAX = 300;

/** Font size range (px). */
const SIZE_MIN = 24;
const SIZE_MAX = 90;

/** Vibration amplitude (px) — how far the text jitters each frame. */
const VIBRATE_PX = 6;

/** How long the edge-bias lasts (ms). Texts start at edges and gradually
 *  fill the whole screen over this duration. */
const SPREAD_DURATION = 10000;

/** Initial exclusion radius (% of viewport) — texts can't appear this
 *  close to the center at the start. Shrinks to 0 over SPREAD_DURATION. */
const INITIAL_EXCLUSION_RADIUS = 90;

/** Max attempts to find a position outside the exclusion zone before
 *  falling back to an edge position. */
const MAX_POSITION_RETRIES = 10;

export class DeleteWarning {
  /** True from show() until hide(). */
  active = false;

  /**
   * @param {HTMLElement|null} [root]  Defaults to the page's #delete-warning.
   */
  constructor(root = typeof document !== 'undefined' ? document.getElementById('delete-warning') : null) {
    this.root = root;
    /** @type {{ el: HTMLElement, baseX: number, baseY: number, timer: number|null, visible: boolean }[]} */
    this._items = [];
    this._rafId = null;
    /** Timestamp when show() was called — used to compute the exclusion
     *  zone shrink progress. @type {number} */
    this._startTime = 0;
    // Clean up any leftover DOM state from a previous instance (scene rebuild).
    if (this.root) {
      this.root.classList.remove('is-active');
      this.root.innerHTML = '';
    }
  }

  /** Start the flashing DELETE texts. */
  show() {
    this.active = true;
    this._startTime = performance.now();
    if (!this.root) return;
    this.root.classList.add('is-active');

    // Create the text elements if they don't exist yet.
    if (this._items.length === 0) {
      for (let i = 0; i < TEXT_COUNT; i++) {
        const el = document.createElement('span');
        el.className = 'delete-text';
        el.textContent = 'DELETE';
        this.root.appendChild(el);
        this._items.push({ el, baseX: 0, baseY: 0, timer: null, visible: false });
      }
    }

    // Stagger the first flash for each text so they don't all appear at once.
    for (const item of this._items) {
      this._scheduleFlash(item, Math.random() * 400);
    }

    // Start the vibration loop.
    this._vibrate();
  }

  /** Stop the flashing and hide all texts. */
  hide() {
    this.active = false;
    if (!this.root) return;
    this.root.classList.remove('is-active');

    for (const item of this._items) {
      clearTimeout(item.timer);
      item.timer = null;
      item.el.style.opacity = '0';
      item.visible = false;
    }

    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  // ── Private ──────────────────────────────

  /** Schedule the next flash for a text element after `delayMs`. */
  _scheduleFlash(item, delayMs = 0) {
    item.timer = setTimeout(() => {
      if (!this.active) return;

      // Pick a position, respecting the shrinking exclusion zone.
      const pos = this._getRandomPosition();
      item.baseX = pos.x;
      item.baseY = pos.y;

      // Random font size.
      const size = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN);

      item.el.style.left = `${item.baseX}%`;
      item.el.style.top = `${item.baseY}%`;
      item.el.style.fontSize = `${size}px`;
      item.el.style.transform = 'translate(-50%, -50%)';
      item.el.style.opacity = '1';
      item.visible = true;

      // Hide after the flash duration, then schedule the next flash.
      const duration = FLASH_DURATION_MIN + Math.random() * (FLASH_DURATION_MAX - FLASH_DURATION_MIN);
      item.timer = setTimeout(() => {
        item.el.style.opacity = '0';
        item.visible = false;
        const pause = PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
        this._scheduleFlash(item, pause);
      }, duration);
    }, delayMs);
  }

  /** Generate a random position, rejecting those too close to the center
   *  early in the warning's lifetime. The exclusion zone shrinks from
   *  INITIAL_EXCLUSION_RADIUS to 0 over SPREAD_DURATION ms.
   *  @returns {{ x: number, y: number }} */
  _getRandomPosition() {
    const elapsed = performance.now() - this._startTime;
    // Exclusion radius shrinks linearly from INITIAL_EXCLUSION_RADIUS to 0.
    const progress = Math.min(1, elapsed / SPREAD_DURATION);
    const exclusionRadius = INITIAL_EXCLUSION_RADIUS * (1 - progress);

    // Try to find a position outside the exclusion zone.
    for (let i = 0; i < MAX_POSITION_RETRIES; i++) {
      const x = 5 + Math.random() * 85;  // 5%–90%
      const y = 5 + Math.random() * 85;
      // Distance from center (50%, 50%).
      const dx = x - 50;
      const dy = y - 50;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= exclusionRadius) {
        return { x, y };
      }
    }

    // Fallback: place at a random edge (top, bottom, left, or right).
    const edge = Math.floor(Math.random() * 4);
    switch (edge) {
      case 0: return { x: 5 + Math.random() * 85, y: 5 + Math.random() * 10 };   // top
      case 1: return { x: 5 + Math.random() * 85, y: 80 + Math.random() * 10 };  // bottom
      case 2: return { x: 5 + Math.random() * 10, y: 5 + Math.random() * 85 };   // left
      default: return { x: 80 + Math.random() * 10, y: 5 + Math.random() * 85 }; // right
    }
  }

  /** Vibration loop — jitters every visible text's position each frame. */
  _vibrate() {
    if (!this.active) return;
    for (const item of this._items) {
      if (!item.visible) continue;
      const jx = (Math.random() - 0.5) * 2 * VIBRATE_PX;
      const jy = (Math.random() - 0.5) * 2 * VIBRATE_PX;
      item.el.style.left = `${item.baseX + jx * 0.3}%`;
      item.el.style.top = `${item.baseY + jy * 0.3}%`;
    }
    this._rafId = requestAnimationFrame(() => this._vibrate());
  }
}
