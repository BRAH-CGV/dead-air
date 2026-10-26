// ─────────────────────────────────────────────
// screenTransform  –  lay a DOM box onto a screen seen in 3D
// ─────────────────────────────────────────────
// An overlay (the radar, the processing console) is a box of `w` × `h`
// CSS pixels. ScreenView projects the screen's four corners through the
// camera to the page, and this finds the CSS matrix3d that takes the box's
// corners exactly onto them: a homography, so the box is drawn in the
// screen's own perspective, and stays clickable (the browser hit-tests
// through the transform).
//
//   el.style.transformOrigin = '0 0';
//   el.style.transform = quadToCss(w, h, [tl, tr, br, bl]);
//
// Pure: no DOM, no three.js. Corners are [x, y] page pixels, clockwise
// from the top left.
// ─────────────────────────────────────────────

/**
 * The column-major 4×4 (matrix3d's order) taking the box (0,0)–(w,h) onto
 * `quad`. The unit square → quad step is Heckbert's.
 * @param {number} w
 * @param {number} h
 * @param {number[][]} quad  [tl, tr, br, bl], each [x, y]
 * @returns {number[]} sixteen numbers
 */
export function quadMatrix(w, h, quad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;

  let g = 0, k = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    k = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + k * x3;
  const d = y1 - y0 + g * y1, e = y3 - y0 + k * y3;

  // (u, v) = (x / w, y / h) folded in: the first two columns over w and h.
  return [
    a / w, d / w, 0, g / w,
    b / h, e / h, 0, k / h,
    0,     0,     1, 0,
    x0,    y0,    0, 1,
  ];
}

/** quadMatrix as a CSS `transform` value. */
export function quadToCss(w, h, quad) {
  return `matrix3d(${quadMatrix(w, h, quad).map(n => +n.toFixed(10)).join(',')})`;
}
