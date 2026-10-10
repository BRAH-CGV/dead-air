// ─────────────────────────────────────────────
// FatigueOverlay  –  a tired player's narrowing view and heavy eyelids
// ─────────────────────────────────────────────
// Markup and CSS live in index.html (#fatigue): a dark radial vignette,
// under the HUD so the stamina bar stays readable, and two black lids over
// everything but the screen fade, closed by the --lid variable (0 open …
// 1 shut). FatigueEffects calls set() every frame; it writes the DOM only
// when the hundredths it shows change.
// ─────────────────────────────────────────────

export class FatigueOverlay {
  constructor(root = typeof document !== 'undefined' ? document.getElementById('fatigue') : null) {
    this.root = root;
    this._tunnel = root?.querySelector('#fatigue-tunnel') ?? null;
    this._lids = root?.querySelector('#fatigue-lids') ?? null;
    this._tunnelShown = -1;
    this._lidShown = -1;
  }

  /**
   * @param {number} tunnel  the vignette's opacity, 0 … 1
   * @param {number} eyelid  0 open … 1 shut
   */
  set(tunnel, eyelid) {
    const t = Math.round(Math.min(1, Math.max(0, tunnel)) * 100);
    if (t !== this._tunnelShown && this._tunnel) {
      this._tunnelShown = t;
      this._tunnel.style.setProperty('opacity', String(t / 100));
    }
    const l = Math.round(Math.min(1, Math.max(0, eyelid)) * 100);
    if (l !== this._lidShown && this._lids) {
      this._lidShown = l;
      this._lids.style.setProperty('--lid', String(l / 100));
    }
  }

  /** Eyes open, no tunnel. */
  clear() {
    this.set(0, 0);
  }
}
