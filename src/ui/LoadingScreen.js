// ─────────────────────────────────────────────
// LoadingScreen  –  overlay shown while assets stream in
// ─────────────────────────────────────────────
// Thin wrapper over markup that already exists in index.html, so the panel
// paints before any JavaScript has parsed. Without it the player stares at a
// black canvas for the length of the preload; with it, a failed fetch reads as
// an error message instead of a game that never started.
// ─────────────────────────────────────────────

export class LoadingScreen {
  constructor(root = document.getElementById('loading')) {
    this.root = root;
    this.bar = root?.querySelector('#loading-bar') ?? null;
    this.label = root?.querySelector('#loading-label') ?? null;
  }

  /** @param {number} fraction 0..1 */
  setProgress(fraction, loaded = 0, total = 0) {
    const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
    if (this.bar) this.bar.style.width = `${percent}%`;
    if (this.label) {
      this.label.textContent = total
        ? `Loading assets… ${loaded}/${total}`
        : 'Loading…';
    }
  }

  /** Name a stage after the asset download — 'Preparing scene…' — with its
   *  own 0..1 progress, so a bar that refills reads as work, not a hang.
   *  @param {string} label
   *  @param {number} [fraction] */
  setStage(label, fraction) {
    if (this.label) this.label.textContent = label;
    if (fraction !== undefined && this.bar) {
      this.bar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    }
  }

  /** Replace the bar with an error, and leave the overlay up. */
  fail(message) {
    if (!this.root) return;
    this.root.classList.add('is-error');
    if (this.bar) this.bar.style.width = '100%';
    if (this.label) this.label.textContent = String(message);
    console.error(message);
  }

  /** Fade out and remove from the layout, so it stops eating pointer events.
   *  `immediate` drops it at once — for when a black fade already covers it.
   *  @param {{ immediate?: boolean }} [opts] */
  hide({ immediate = false } = {}) {
    if (!this.root) return;
    if (immediate) {
      this.root.style.display = 'none';
      return;
    }
    this.root.classList.add('is-hidden');
    setTimeout(() => { this.root.style.display = 'none'; }, 400);
  }
}
