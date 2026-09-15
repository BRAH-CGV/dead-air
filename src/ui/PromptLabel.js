// ─────────────────────────────────────────────
// PromptLabel  –  HUD line under the crosshair
// ─────────────────────────────────────────────
// Short contextual text ("Locked", "[E] Inspect"). Uses #prompt from the
// page if it exists, otherwise creates it — so it works before anyone adds
// markup to index.html. Like Crosshair, this is the single place game code
// touches the element.
// ─────────────────────────────────────────────

export class PromptLabel {
  constructor(root = PromptLabel.findOrCreate()) {
    this.root = root;
    this.hide();
  }

  /** The page's #prompt element, created and styled if missing. */
  static findOrCreate() {
    if (typeof document === 'undefined') return null;
    let el = document.getElementById('prompt');
    if (!el) {
      el = document.createElement('div');
      el.id = 'prompt';
      Object.assign(el.style, {
        position: 'fixed',
        left: '50%',
        top: 'calc(50% + 28px)',
        transform: 'translateX(-50%)',
        color: '#e8e2d0',
        font: '14px monospace',
        letterSpacing: '0.05em',
        textShadow: '0 1px 2px #000',
        pointerEvents: 'none',
        zIndex: '10',
      });
      document.body.appendChild(el);
    }
    return el;
  }

  show(text) {
    if (!this.root) return;
    this.root.textContent = text;
    this.root.style.display = 'block';
  }

  hide() {
    if (!this.root) return;
    this.root.style.display = 'none';
  }

  get text() { return this.root?.textContent ?? ''; }

  get visible() { return !!this.root && this.root.style.display !== 'none'; }
}
