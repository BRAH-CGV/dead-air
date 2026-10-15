// ─────────────────────────────────────────────
// FatigueOverlay  –  a tired player's narrowing view and heavy eyelids
// ─────────────────────────────────────────────
// Markup and CSS live in index.html (#fatigue): a dark radial vignette,
// under the HUD so the stamina bar stays readable, and two black lids over
// everything but the screen fade, closed by the --lid variable (0 open …
// 1 shut). FatigueEffects calls set() every frame; it writes the DOM only
// when the hundredths it shows change.
//
// In bed, the lids are absent: a darkening filter (#bed-darkness) takes
// their place. The world dims and desaturates behind a heavy vignette, the
// bedside clock's red digits still readable through it. BedRest writes the
// darkness (0 clear … 1 fully darkened) through the third parameter of
// set(). The backdrop-filter is expensive, so it is removed entirely when
// the strength is 0.
// ─────────────────────────────────────────────

export class FatigueOverlay {
  constructor(root = typeof document !== 'undefined' ? document.getElementById('fatigue') : null) {
    this.root = root;
    this._tunnel = root?.querySelector('#fatigue-tunnel') ?? null;
    this._lids = root?.querySelector('#fatigue-lids') ?? null;
    this._darkness = root?.querySelector('#bed-darkness') ?? null;
    this._tunnelShown = -1;
    this._lidShown = -1;
    this._darknessShown = -1;
  }

  /**
   * @param {number} tunnel  the vignette's opacity, 0 … 1
   * @param {number} eyelid  0 open … 1 shut
   * @param {number} [bedDarkness=0]  0 clear … 1 fully darkened (in bed)
   */
  set(tunnel, eyelid, bedDarkness = 0) {
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
    const d = Math.round(Math.min(1, Math.max(0, bedDarkness)) * 100);
    if (d !== this._darknessShown && this._darkness) {
      this._darknessShown = d;
      const v = d / 100;
      if (v <= 0) {
        // Turn the filter fully off: backdrop-filter over the canvas costs
        // every frame, and the game must run on lab hardware.
        this._darkness.style.setProperty('backdrop-filter', 'none');
        this._darkness.style.setProperty('opacity', '0');
      } else {
        this._darkness.style.setProperty('backdrop-filter', `brightness(${1 - v * 0.7}) saturate(${1 - v * 0.8})`);
        this._darkness.style.setProperty('opacity', String(v));
      }
    }
  }

  /** Eyes open, no tunnel, no bed darkness. */
  clear() {
    this.set(0, 0, 0);
  }
}
