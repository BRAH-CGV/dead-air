// ─────────────────────────────────────────────
// BlastFlash  –  the screen whiting out from a point, for a moment
// ─────────────────────────────────────────────
// The 2D half of the cheese going off: the whole page flares white-hot
// from a point on it, orange out to the edges, and fades. After
// `BLAST_FLASH.ms` it takes itself off the page. Under the white-out, so a
// cut to black covers it. It never takes a click.
//
//   showBlastFlash(x, y);                  // page pixels
// ─────────────────────────────────────────────

export const BLAST_FLASH = Object.freeze({
  ms: 400,
  core: '#fffbe8',
  mid: '#ffc44a',
  edge: '#e0500f',
});

/**
 * Flash the page from page pixels (x, y).
 * @param {number} x
 * @param {number} y
 * @param {object} [opts]
 * @param {HTMLElement} [opts.parent=document.body]
 * @returns {HTMLElement}
 */
export function showBlastFlash(x, y, { parent = document.body } = {}) {
  const { ms, core, mid, edge } = BLAST_FLASH;
  const el = document.createElement('div');
  el.className = 'blast-flash';
  Object.assign(el.style, {
    position: 'fixed',
    inset: '0',
    background: `radial-gradient(circle at ${x}px ${y}px, ${core} 0, ${core} 12%, ${mid} 35%, ${edge} 80%)`,
    pointerEvents: 'none',
    zIndex: '101',
  });
  parent.appendChild(el);
  el.animate?.([
    { opacity: 1 },
    { opacity: 0.85, offset: 0.4 },
    { opacity: 0 },
  ], { duration: ms, easing: 'ease-in', fill: 'forwards' });
  setTimeout(() => el.remove(), ms);
  return el;
}
