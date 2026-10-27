// ─────────────────────────────────────────────
// ToonPoof  –  a small comic "POOF!" burst on the screen (#169)
// ─────────────────────────────────────────────
// The 2D half of the globe turning to cheese: a cream starburst with a dark
// outline and POOF! across it, centred on a point on the page. It pops in
// past its size, wobbles back, and fades, then takes itself off the page.
// Built on the spot and gone after `TOON_POOF.ms`; it never takes a click.
//
//   showToonPoof(x, y);                    // page pixels
// ─────────────────────────────────────────────

export const TOON_POOF = Object.freeze({
  /** Pixels across. */
  size: 150,
  ms: 750,
  fill: '#fff4d6',
  ink: '#3a2a1c',
  word: '#f2b53a',
  /** Starburst points. */
  points: 11,
  tilt: -9,
});

/** The starburst's outline, in a 100 × 100 box. */
function burst(points) {
  const out = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 31 : (i % 4 ? 44 : 48);   // two lengths of spike, so it looks drawn by hand
    out.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
  }
  return out.join(' ');
}

/**
 * Show the burst centred on page pixels (x, y).
 * @param {number} x
 * @param {number} y
 * @param {object} [opts]
 * @param {HTMLElement} [opts.parent=document.body]
 * @returns {HTMLElement}
 */
export function showToonPoof(x, y, { parent = document.body } = {}) {
  const { size, ms, fill, ink, word, points, tilt } = TOON_POOF;
  const el = document.createElement('div');
  el.className = 'toon-poof';
  Object.assign(el.style, {
    position: 'fixed',
    left: `${x - size / 2}px`,
    top: `${y - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    pointerEvents: 'none',
    zIndex: '40',
  });
  el.innerHTML = `
    <svg viewBox="0 0 100 100" width="${size}" height="${size}" style="overflow: visible">
      <g transform="rotate(${tilt} 50 50)">
        <polygon points="${burst(points)}" fill="${fill}" stroke="${ink}" stroke-width="3.5" stroke-linejoin="round"/>
        <text x="50" y="57" text-anchor="middle" font-family="Impact, 'Arial Black', sans-serif"
              font-size="21" font-weight="900" letter-spacing="0.5"
              fill="${word}" stroke="${ink}" stroke-width="2.6" paint-order="stroke">POOF!</text>
      </g>
    </svg>`;
  parent.appendChild(el);

  el.animate?.([
    { transform: 'scale(0.2) rotate(-20deg)', opacity: 0 },
    { transform: 'scale(1.18) rotate(4deg)', opacity: 1, offset: 0.22 },
    { transform: 'scale(0.95) rotate(-2deg)', opacity: 1, offset: 0.4 },
    { transform: 'scale(1) rotate(0deg)', opacity: 1, offset: 0.7 },
    { transform: 'scale(1.06) rotate(0deg)', opacity: 0 },
  ], { duration: ms, easing: 'ease-out', fill: 'forwards' });

  setTimeout(() => el.remove(), ms);
  return el;
}
