// ─────────────────────────────────────────────
// JournalPanel  –  the notebook page, read up close (#79)
// ─────────────────────────────────────────────
// Wraps #journal in index.html (the paper look lives there, like the other
// overlays). Text is set with textContent, never as HTML. Without markup
// every call is a no-op.
// ─────────────────────────────────────────────

import { withKeys } from './promptKeys.js';

export class JournalPanel {
  /** @param {HTMLElement|null} [root]  Defaults to the page's #journal. */
  constructor(root = typeof document !== 'undefined' ? document.getElementById('journal') : null) {
    this.root = root;
  }

  get visible() { return !!this.root && this.root.classList.contains('is-open'); }

  /** @param {import('../gameplay/journal.js').JournalEntry} entry */
  show(entry) {
    if (!this.root) return;
    const el = (tag, cls, text) => {
      const node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const paper = el('div', 'journal-paper');
    const body = el('div', 'journal-body');
    for (const paragraph of entry.body) body.append(el('p', null, paragraph));
    paper.append(el('h2', 'journal-title', entry.title), body, el('div', 'journal-hint', withKeys('[E] or [Q] to put it down')));
    this.root.replaceChildren(paper);
    this.root.classList.add('is-open');
  }

  hide() {
    this.root?.classList.remove('is-open');
  }
}
