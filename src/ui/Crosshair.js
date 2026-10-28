// ─────────────────────────────────────────────
// Crosshair  –  HUD reticle overlay
// ─────────────────────────────────────────────
// Thin wrapper over the #crosshair element defined in index.html. The markup
// and styles live there so the reticle is visible before any JavaScript has
// parsed; this class is the single place game code touches it.
// ─────────────────────────────────────────────

export class Crosshair {
  constructor(root = document.getElementById('crosshair')) {
    this.root = root;
    /** When true, show() is a no-op — the HUD command hid the crosshair. */
    this._hudHidden = false;
  }

  /** Highlight the reticle (e.g. when aiming at an interactable). */
  setActive(active) {
    if (!this.root) return;
    this.root.classList.toggle('active', !!active);
  }

  /** Whether the reticle is currently in its active state. */
  get isActive() {
    return !!this.root?.classList.contains('active');
  }

  /** Hide the reticle entirely (cutscenes, menus, etc.). */
  hide() {
    if (!this.root) return;
    this.root.style.display = 'none';
  }

  /** Show the reticle after a hide(), unless the HUD command hid it. */
  show() {
    if (!this.root || this._hudHidden) return;
    this.root.style.display = 'block';
  }

  /** Called by the `hud` debug command to suppress the crosshair. */
  setHudHidden(hidden) {
    this._hudHidden = hidden;
    if (hidden) this.hide();
    else this.show();
  }
}
