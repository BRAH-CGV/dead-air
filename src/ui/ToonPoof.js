// ─────────────────────────────────────────────
// ToonPoof  –  a small burst of comic lines on the screen (#169)
// ─────────────────────────────────────────────
// The 2D half of the globe turning to cheese: short inked impact lines
// shooting out from a point on the page, with a few four-point sparkles
// twinkling between them. No words, no bubble: the middle stays clear for
// the cloud. The lines dash outward and thin away, the sparkles pop and
// shrink, and after `TOON_POOF.ms` it takes itself off the page. It never
// takes a click.
//
//   showToonPoof(x, y);                    // page pixels
// ─────────────────────────────────────────────

export const TOON_POOF = Object.freeze({
  /** Pixels across. */
  size: 170,
  ms: 450,
  /** Impact lines and sparkles. */
  lines: 10,
  sparkles: 4,
  ink: '#3a2a1c',
  sparkle: '#fff4d6',
});

/** A tapered line from r0 to r1 out along angle a, in the 100 × 100 box. */
function stroke(a, r0, r1, width) {
  const c = Math.cos(a), s = Math.sin(a), nx = -s * width / 2, ny = c * width / 2;
  const x0 = 50 + c * r0, y0 = 50 + s * r0, x1 = 50 + c * r1, y1 = 50 + s * r1;
  const f = (n) => n.toFixed(1);
  // Thin at the inner end, full width a third of the way out, a point at the tip.
  const xm = x0 + (x1 - x0) * 0.35, ym = y0 + (y1 - y0) * 0.35;
  return `M ${f(x0)} ${f(y0)} L ${f(xm + nx)} ${f(ym + ny)} L ${f(x1)} ${f(y1)} L ${f(xm - nx)} ${f(ym - ny)} Z`;
}

/** A four-point sparkle of radius r at (x, y). */
function sparkle(x, y, r) {
  const f = (n) => n.toFixed(1), k = r * 0.22;
  return `M ${f(x)} ${f(y - r)} Q ${f(x + k)} ${f(y - k)} ${f(x + r)} ${f(y)} Q ${f(x + k)} ${f(y + k)} ${f(x)} ${f(y + r)}`
    + ` Q ${f(x - k)} ${f(y + k)} ${f(x - r)} ${f(y)} Q ${f(x - k)} ${f(y - k)} ${f(x)} ${f(y - r)} Z`;
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
  const { size, ms, lines, sparkles, ink } = TOON_POOF;
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

  const paths = [];
  for (let i = 0; i < lines; i++) {
    // Evenly round, nudged off even, every other one shorter.
    const a = (i / lines) * Math.PI * 2 + (i % 3 - 1) * 0.12;
    const long = i % 2 === 0;
    paths.push(`<path class="toon-poof-line" d="${stroke(a, long ? 27 : 31, long ? 47 : 42, long ? 4.2 : 3.2)}"/>`);
  }
  for (let i = 0; i < sparkles; i++) {
    const a = ((i + 0.5) / sparkles) * Math.PI * 2 + 0.3;
    const r = i % 2 ? 36 : 41;
    paths.push(`<path class="toon-poof-sparkle" d="${sparkle(50 + Math.cos(a) * r, 50 + Math.sin(a) * r, i % 2 ? 4 : 5.5)}"/>`);
  }
  el.innerHTML = `
    <svg viewBox="0 0 100 100" width="${size}" height="${size}" style="overflow: visible">
      <g fill="${ink}">${paths.filter((p) => p.includes('line')).join('')}</g>
      <g fill="${TOON_POOF.sparkle}" stroke="${ink}" stroke-width="1.4" stroke-linejoin="round">${paths.filter((p) => p.includes('sparkle')).join('')}</g>
    </svg>`;
  parent.appendChild(el);

  // The lines dash outward; the whole thing pops and fades.
  el.animate?.([
    { transform: 'scale(0.55)', opacity: 0 },
    { transform: 'scale(1)', opacity: 1, offset: 0.25 },
    { transform: 'scale(1.25)', opacity: 0 },
  ], { duration: ms, easing: 'ease-out', fill: 'forwards' });
  for (const p of el.querySelectorAll('.toon-poof-sparkle')) {
    p.style.transformBox = 'fill-box';
    p.style.transformOrigin = 'center';
    p.animate?.([
      { transform: 'scale(0) rotate(0deg)' },
      { transform: 'scale(1.3) rotate(30deg)', offset: 0.35 },
      { transform: 'scale(0) rotate(60deg)' },
    ], { duration: ms, easing: 'ease-out', fill: 'forwards' });
  }

  setTimeout(() => el.remove(), ms);
  return el;
}
