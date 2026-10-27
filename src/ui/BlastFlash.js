import { makeRandom } from '../core/Random.js';

// ─────────────────────────────────────────────
// BlastFlash  –  the screen flaring from a point, and shaken
// ─────────────────────────────────────────────
// The 2D half of the cheese going off: the whole page flares white-hot
// from a point on it, orange out to the edges, and fades. After
// `BLAST_FLASH.ms` it takes itself off the page. Under the white-out, so a
// cut to black covers it. It never takes a click. And the view is shaken.
//
//   showBlastFlash(x, y);                  // page pixels
//   shakeScreen(canvas);                   // the view jolted about, then still
// ─────────────────────────────────────────────

export const BLAST_FLASH = Object.freeze({
  ms: 600,
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

/** How the view is shaken: for `ms`, by up to `px` pixels and `deg`
 *  degrees, dying away; `zoom` hides the edges it would show. */
export const SCREEN_SHAKE = Object.freeze({ ms: 1500, px: 38, deg: 2.5, zoom: 1.12, steps: 40, seed: 42132 });

/**
 * Jolt an element (the game's canvas) about, hardest at once, dying away
 * to still. A CSS transform only: the camera is left alone.
 * @param {HTMLElement|null} el
 * @param {object} [opts]  Over SCREEN_SHAKE.
 * @returns {Animation|null}
 */
export function shakeScreen(el, opts = {}) {
  if (!el?.animate) return null;
  const { ms, px, deg, zoom, steps, seed } = { ...SCREEN_SHAKE, ...opts };
  const random = makeRandom(seed);
  const rand = () => random() * 2 - 1;
  const frames = [];
  for (let i = 0; i <= steps; i++) {
    const k = i === steps ? 0 : (1 - i / steps) ** 1.5;
    const z = 1 + (zoom - 1) * k;
    frames.push({
      transform: `translate(${(rand() * px * k).toFixed(1)}px, ${(rand() * px * k).toFixed(1)}px) rotate(${(rand() * deg * k).toFixed(2)}deg) scale(${z.toFixed(3)})`,
    });
  }
  return el.animate(frames, { duration: ms, easing: 'linear' });
}
