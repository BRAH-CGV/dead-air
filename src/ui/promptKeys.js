// ─────────────────────────────────────────────
// promptKeys  –  prompts name the key Interact is really bound to
// ─────────────────────────────────────────────
// Interact prompts are written as '[E] Sleep', '[E] Use Computer', … across
// a dozen files. Rather than edit each one, the two places prompt text
// reaches the screen (PromptLabel.show, HUD.setPrompt) pass it through
// withKeys(), and App calls setInteractKey() whenever the bind changes.
// ─────────────────────────────────────────────

let interactLabel = 'E';

/** Set the label shown for the interact key (e.g. 'F'). */
export function setInteractKey(label) {
  interactLabel = label || 'E';
}

/** `'[E] Sleep'` → `'[F] Sleep'` while Interact is bound to F.
 *  @param {string} text */
export function withKeys(text) {
  if (!text) return '';
  return interactLabel === 'E' ? text : text.replaceAll('[E]', `[${interactLabel}]`);
}
