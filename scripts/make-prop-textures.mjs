// ─────────────────────────────────────────────
// make-prop-textures  –  the carried props' atlases → public/assets/textures/ (#188)
// ─────────────────────────────────────────────
// Small atlases, one per prop, a rectangle per face (the layouts are in
// src/gameobjects/propAtlases.js, which lays them onto the boxes):
//
//   drive.png           the drive's casing: its size on top, vents on the end
//                       its LED sits on, the connector on the other
//   drive-normal.png    its relief, made like the reader's
//   drive-box.png       the drive box, in greys: its own colour tints it
//   drive-box-normal.png  its relief, made like the reader's
//   coffee-bag.png      a kraft bag of ground coffee, its sealed seam and tie
//   drive-reader.png    the drive readers: a slot on the front the drive
//                       slides into, a cover plate, grille and vents
//   drive-reader-normal.png  their relief, a normal map made from a height
//                       map of the same shapes
//   dock-table.png      the table under it: a steel cabinet, drawers and a
//                       louvred door, a kick plate, a worn worktop
//   dock-table-normal.png  its relief, made like the reader's
//   box-dock.png        the airlock's box dock: a steel plate, a ribbed
//                       rubber pad for the box and guide blocks round it
//
// Every face ends under the same wear (wear()): fine grain, patches of
// grime, scattered scratches and darker edges, so nothing reads as flat paint.
// Drawn here as SVG and rasterised with sharp. Ours, so no credit.
//
// Usage: node scripts/make-prop-textures.mjs [outDir]
// ─────────────────────────────────────────────
import sharp from 'sharp';
import { DRIVE_ATLAS, BOX_ATLAS, BAG_ATLAS, READER_ATLAS, DOCK_ATLAS, TABLE_ATLAS } from '../src/gameobjects/propAtlases.js';

const outDir = process.argv[2] ?? 'public/assets/textures';
const SANS = 'DejaVu Sans, sans-serif';
const MONO = 'DejaVu Sans Mono, monospace';
const SERIF = 'DejaVu Serif, serif';

/** The wear every atlas shares: grain, grime, scratches, dark edges. */
const WEAR_DEFS = `
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="3"/>
    <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.2 0"/>
  </filter>
  <filter id="grime" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="4" seed="11"/>
    <feColorMatrix values="0 0 0 0 0.09  0 0 0 0 0.07  0 0 0 0 0.05  1.1 0 0 0 -0.42"/>
  </filter>
  <radialGradient id="edgeShade" cx="0.5" cy="0.5" r="0.72">
    <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity="0.38"/>
  </radialGradient>`;

const svg = ([W, H], body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${WEAR_DEFS}${defs}</defs>${body}</svg>`;

/** The wear over a w × h face. `scratches` 0 for paper. */
/** How worn each kind of thing is. The tech is kept clean enough to work. */
const TECH = { grime: 0.22, scratches: 0.6 };
const STEEL_WEAR = { grime: 0.4, scratches: 0.8 };
const PAPER = { grime: 0.4, scratches: 0 };

/** Mulberry32: the same scratches every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scratches over a w × h face, the faint marks of use: short, fine
 *  strokes, each its own way, length and slight bend, mostly bright (bare
 *  metal), now and then dark; a few a little longer. `amount` scales how
 *  many. */
const scratchMarks = (w, h, amount, seed) => {
  const rand = rng(seed);
  const n = Math.round((w * h) / 2500 * amount);
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = rand() * w, y = rand() * h, a = rand() * Math.PI * 2;
    const len = rand() < 0.1 ? 12 + rand() * 14 : 2 + rand() * 8;
    const bend = (rand() - 0.5) * len * 0.15;
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    const cx = (x + ex) / 2 - Math.sin(a) * bend, cy = (y + ey) / 2 + Math.cos(a) * bend;
    const dark = rand() < 0.1;
    out += `<path d="M ${x.toFixed(1)} ${y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}"
      stroke="${dark ? '#000' : '#fff'}" stroke-opacity="${(0.03 + rand() * 0.06).toFixed(3)}"
      stroke-width="${(0.3 + rand() * 0.4).toFixed(2)}" stroke-linecap="round" fill="none"/>`;
  }
  return out;
};

/** A seed from a face's id, so every face scratches differently. */
const seedOf = id => [...id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

const wear = (w, h, { grime = 0.5, scratches = 1 } = {}, id = '') => `
  <rect width="${w}" height="${h}" filter="url(#grain)"/>
  <rect width="${w}" height="${h}" filter="url(#grime)" opacity="${grime}"/>
  ${scratches ? scratchMarks(w, h, scratches, seedOf(id)) : ''}
  <rect width="${w}" height="${h}" fill="url(#edgeShade)"/>`;

/** Draw `body` into the rectangle `[x, y, w, h]`, its own 0,0 at the corner,
 *  clipped to it, and wear it. */
const inRect = ([x, y, w, h], body, id, wearOpts) =>
  `<clipPath id="${id}"><rect width="${w}" height="${h}"/></clipPath>
   <g transform="translate(${x} ${y})" clip-path="url(#${id})">${body}${wear(w, h, wearOpts, id + w + h)}</g>`;

const text = (x, y, size, str, { fill, font = SANS, weight = 'bold', anchor = 'middle', spacing = 0 } = {}) =>
  `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}"
    text-anchor="${anchor}" letter-spacing="${spacing}" fill="${fill}">${str}</text>`;

/** A soft bevel round a rectangle: light along its top and left, dark along
 *  its bottom and right (raised), or the other way (`sunk`). */
const bevel = (x, y, w, h, { sunk = false, k = 1 } = {}) => {
  const lit = `rgba(255,255,255,${0.12 * k})`, shade = `rgba(0,0,0,${0.35 * k})`;
  const [a, b] = sunk ? [shade, lit] : [lit, shade];
  return `<rect x="${x}" y="${y}" width="${w}" height="2" fill="${a}"/><rect x="${x}" y="${y}" width="2" height="${h}" fill="${a}"/>
    <rect x="${x}" y="${y + h - 2}" width="${w}" height="2" fill="${b}"/><rect x="${x + w - 2}" y="${y}" width="2" height="${h}" fill="${b}"/>`;
};

const screw = (x, y, r, fill, slot) =>
  `<circle cx="${x}" cy="${y}" r="${r + 1}" fill="rgba(0,0,0,0.35)"/>
   <circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>
   <rect x="${x - r * 0.7}" y="${y - r * 0.18}" width="${r * 1.4}" height="${r * 0.36}" fill="${slot}" transform="rotate(${(x * 37 + y * 13) % 180} ${x} ${y})"/>`;

/** A row of slots, e.g. vents. */
const slots = (x, y, n, pitch, w, h, fill) =>
  Array.from({ length: n }, (_, i) => `<rect x="${x + i * pitch}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w, h) / 3}" fill="${fill}"/>`).join('');

// ── The drive ──────────────────────────────────

/**
 * The drive, as its colour (`height` false) or as a height map (true), the
 * way the reader is drawn: the same shapes, each with a colour and a height
 * (the casing at 0.5). Print (the sticker's words and lines) has no height.
 */
function drive(height = false) {
  const { size, faces } = DRIVE_ATLAS;
  const grey = v => { const g = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0'); return `#${g}${g}${g}`; };
  const P = (colour, h) => (height ? grey(h) : colour);
  const CASE = P('#36383b', 0.5), DARK = P('#1b1c1e', 0.2), STICKER = P('#aca595', 0.54), INK = P('#2c2925', 0.54);
  const GROOVE = P('#1b1c1e', 0.32), EMBOSS = P('#45484c', 0.58), PIN = P('#8f7a3e', 0.32), RECESS = P('#1b1c1e', 0.12);
  const relief = (...args) => (height ? '' : bevel(...args));
  const print = str => (height ? '' : str);
  const screwAt = (x, y, r) => height
    ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${grey(0.72)}"/><rect x="${x - r * 0.7}" y="${y - r * 0.18}" width="${r * 1.4}" height="${r * 0.36}" fill="${grey(0.55)}" transform="rotate(${(x * 37 + y * 13) % 180} ${x} ${y})"/>`
    : screw(x, y, r, '#55595e', '#1b1c1e');
  const casing = (w, h) => `<rect width="${w}" height="${h}" fill="${CASE}"/>${relief(0, 0, w, h)}`;
  const top = `${casing(128, 192)}
    <rect x="64" y="0" width="62" height="28" rx="3" fill="${DARK}"/>${relief(64, 0, 62, 28, { sunk: true })}
    <rect x="16" y="56" width="96" height="96" rx="3" fill="${STICKER}"/>
    <rect x="16" y="56" width="96" height="14" rx="3" fill="${INK}"/>
    <rect x="16" y="64" width="96" height="6" fill="${INK}"/>
    ${print(`<rect x="24" y="62" width="34" height="3" fill="${STICKER}" opacity="0.6"/>
    <rect x="62" y="62" width="20" height="3" fill="${STICKER}" opacity="0.6"/>
    ${text(24, 98, 13, '64 MB', { fill: INK, font: MONO, anchor: 'start' })}
    ${[[24, 114, 80], [24, 122, 62], [24, 130, 72], [24, 138, 44]].map(([x, y, w]) =>
      `<rect x="${x}" y="${y}" width="${w}" height="3" fill="${INK}" opacity="0.4"/>`).join('')}`)}`;
  const bottom = `${casing(128, 192)}
    ${screwAt(14, 14, 5)}${screwAt(114, 14, 5)}
    ${screwAt(14, 178, 5)}${screwAt(114, 178, 5)}
    ${[[30, 82, 68], [30, 92, 52], [30, 102, 60], [30, 112, 36]].map(([x, y, w]) =>
      `<rect x="${x}" y="${y}" width="${w}" height="3" fill="${EMBOSS}"/>`).join('')}`;
  const side = `${casing(256, 32)}
    <rect x="8" y="11" width="240" height="2" fill="${GROOVE}"/>
    <rect x="8" y="19" width="240" height="2" fill="${GROOVE}"/>`;
  const vents = `${casing(128, 32)}${slots(68, 8, 7, 8, 4, 16, RECESS)}`;
  const connector = `${casing(128, 32)}
    <rect x="14" y="9" width="100" height="14" rx="2" fill="${RECESS}"/>
    ${slots(19, 12, 14, 6.8, 3.4, 8, PIN)}`;
  const rect = (r, body, id) => height
    ? `<g transform="translate(${r[0]} ${r[1]})">${body}</g>`
    : inRect(r, body, id, TECH);
  return svg(size, [
    rect(faces.py, top, 'py'),
    rect(faces.ny, bottom, 'ny'),
    rect(faces.px, side, 'px'),
    rect(faces.nz, vents, 'nz'),
    rect(faces.pz, connector, 'pz'),
  ].join(''));
}

// ── The drive box ──────────────────────────────

/** The drive box, as its colour or (`height`) a height map, as the reader
 *  is. Each shape has its own height, though several share a grey. */
function box(height = false) {
  const { size, faces } = BOX_ATLAS;
  const grey = v => { const g = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0'); return `#${g}${g}${g}`; };
  const P = (colour, h) => (height ? grey(h) : colour);
  // Greys only: the box's colour multiplies them.
  const BASE = P('#cfcfcf', 0.5), RIM = P('#d8d8d8', 0.56), TRAY = P('#a8a8a8', 0.42), RIB = P('#a8a8a8', 0.6);
  const RIVET = P('#a8a8a8', 0.68), GROOVE = P('#a8a8a8', 0.42), HOLE = P('#262626', 0.04), CORNER = P('#626262', 0.64);
  const PLATE = P('#c4c4c4', 0.55), INK = '#3a3a3a';
  const bevel_ = (...args) => (height ? '' : bevel(...args));
  const paint = str => (height ? '' : str);
  const screwAt = (x, y, r) => height
    ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${grey(0.66)}"/>`
    : screw(x, y, r, '#a8a8a8', '#8a8a8a');
  const frame = (w, h, band) => `<rect width="${w}" height="${h}" fill="${RIM}"/>
    <rect x="${band}" y="${band}" width="${w - 2 * band}" height="${h - 2 * band}" fill="${BASE}"/>
    ${bevel_(band, band, w - 2 * band, h - 2 * band, { sunk: true, k: 1.4 })}`;
  const rivets = (w, h, inset) => [[inset, inset], [w - inset, inset], [inset, h - inset], [w - inset, h - inset]]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="${RIVET}"/>${bevel_(x - 4, y - 4, 8, 8)}`).join('');
  const scuffs = (w, h) => paint(`<rect x="0" y="${h - 22}" width="${w}" height="22" fill="#a8a8a8" opacity="0.5"/>`);
  // Dark corner guards, an L in each corner of a side.
  const guards = (w, h, s) => [[0, 0], [w - s, 0], [0, h - 12], [w - s, h - 12]]
    .map(([x, y]) => `<rect x="${x}" y="${y}" width="${s}" height="12" fill="${CORNER}"/>`)
    .concat([[0, 0], [w - 12, 0], [0, h - s], [w - 12, h - s]]
      .map(([x, y]) => `<rect x="${x}" y="${y}" width="12" height="${s}" fill="${CORNER}"/>`)).join('');
  const top = `${frame(512, 448, 22)}
    <rect x="34" y="44" width="444" height="360" rx="8" fill="${TRAY}"/>${bevel_(34, 44, 444, 360, { sunk: true, k: 1.6 })}
    ${rivets(512, 448, 12)}`;
  const long = `${frame(512, 192, 14)}${scuffs(512, 192)}
    <rect x="120" y="14" width="6" height="164" fill="${RIB}"/><rect x="386" y="14" width="6" height="164" fill="${RIB}"/>
    <rect x="176" y="56" width="160" height="64" rx="3" fill="${PLATE}"/>${bevel_(176, 56, 160, 64)}
    ${screwAt(190, 88, 4)}${screwAt(322, 88, 4)}
    ${guards(512, 192, 40)}`;
  const short = `${frame(448, 192, 14)}${scuffs(448, 192)}
    <rect x="144" y="36" width="160" height="34" rx="17" fill="${HOLE}"/>
    ${paint(`<rect x="144" y="36" width="160" height="10" rx="5" fill="#000000" opacity="0.5"/>
    ${text(224, 128, 16, '▲ THIS WAY UP ▲', { fill: INK, font: MONO })}`)}
    ${guards(448, 192, 40)}`;
  const bottom = `${frame(512, 192, 10)}
    ${slots(32, 10, 7, 64, 3, 172, GROOVE)}`;
  // Light greys show grime hard: less of it.
  const light = { grime: 0.18, scratches: 0.6 };
  const rect = (r, body, id) => height
    ? `<g transform="translate(${r[0]} ${r[1]})">${body}</g>`
    : inRect(r, body, id, light);
  return svg(size, [
    rect(faces.py, top, 'py'),
    rect(faces.pz, long, 'pz'),
    rect(faces.px, short, 'px'),
    rect(faces.ny, bottom, 'ny'),
  ].join(''));
}

// ── The drive reader ───────────────────────────

/**
 * The reader, as its colour (`height` false) or as a height map (true): the
 * same shapes either way, each with a colour and a height (0 deep … 1
 * proud, the casing at 0.5), so the normal map made from the height fits
 * the picture exactly.
 */
function reader(height = false) {
  const { size, faces } = READER_ATLAS;
  const grey = v => { const g = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0'); return `#${g}${g}${g}`; };
  const P = (colour, h) => (height ? grey(h) : colour);
  const CASE = P('#2a2c2f', 0.5), PLATE = P('#303337', 0.58), SEAM = P('#151618', 0.36), DARK = P('#141516', 0.12);
  const HOLE = P('#0a0a0b', 0), BEZEL = P('#3a3d41', 0.64), SCREW = P('#4a4e53', 0.72), SLOT = P('#121314', 0.2);
  const FOOT = P('#121212', 0.66), RING = P('#3a3d41', 0.76);
  const relief = (...args) => (height ? '' : bevel(...args));
  const screwAt = (x, y, r) => height
    ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${SCREW}"/><rect x="${x - r * 0.7}" y="${y - r * 0.18}" width="${r * 1.4}" height="${r * 0.36}" fill="${grey(0.55)}"/>`
    : screw(x, y, r, '#4a4e53', '#17181a');
  const lamp = (x, y, colour) => `<circle cx="${x}" cy="${y}" r="4.5" fill="${BEZEL}"/><circle cx="${x}" cy="${y}" r="3" fill="${P(colour, 0.6)}"/>
    ${height ? '' : `<circle cx="${x - 1}" cy="${y - 1}" r="1" fill="rgba(255,255,255,0.25)"/>`}`;
  const casing = (w, h) => `<rect width="${w}" height="${h}" fill="${CASE}"/>${relief(0, 0, w, h)}`;

  // The top (its top edge the back, −z): a cover plate over the drive's
  // channel down the middle, the drive's width; a grille to its left, a
  // cooling slot row to its right; a screw in each corner.
  const top = `${casing(205, 256)}
    <rect x="35" y="56" width="135" height="196" rx="3" fill="${PLATE}"/>${relief(35, 56, 135, 196)}
    <rect x="35" y="56" width="135" height="2" fill="${SEAM}"/><rect x="35" y="250" width="135" height="2" fill="${SEAM}"/>
    ${screwAt(44, 66, 3.5)}${screwAt(161, 66, 3.5)}${screwAt(44, 242, 3.5)}${screwAt(161, 242, 3.5)}
    <rect x="62" y="140" width="80" height="18" rx="2" fill="${SEAM}"/><rect x="64" y="142" width="76" height="14" rx="2" fill="${P('#26282b', 0.46)}"/>
    <rect x="12" y="12" width="181" height="34" rx="3" fill="${P('#25272a', 0.42)}"/>${relief(12, 12, 181, 34, { sunk: true })}
    ${Array.from({ length: 4 }, (_, r) => slots(18, 16 + r * 7.5, 22, 8, 4, 3, HOLE)).join('')}
    ${slots(10, 66, 1, 0, 16, 3, DARK)}${Array.from({ length: 16 }, (_, i) => slots(10, 70 + i * 11, 1, 0, 16, 4, DARK)).join('')}
    ${Array.from({ length: 16 }, (_, i) => slots(180, 70 + i * 11, 1, 0, 16, 4, DARK)).join('')}
    ${screwAt(8, 8, 3)}${screwAt(197, 8, 3)}${screwAt(8, 248, 3)}${screwAt(197, 248, 3)}`;
  // The front: the slot the drive slides into (a little over its 0.08 ×
  // 0.02 m) in a raised bezel; an activity lamp left of it, eject right.
  const front = `${casing(256, 64)}
    <rect x="33" y="3" width="190" height="58" rx="4" fill="${BEZEL}"/>${relief(33, 3, 190, 58)}
    <rect x="39" y="8" width="178" height="48" rx="2" fill="${SLOT}"/>
    <rect x="43" y="12" width="170" height="40" rx="1" fill="${HOLE}"/>${relief(39, 8, 178, 48, { sunk: true, k: 1.5 })}
    ${lamp(16, 22, '#2c3a30')}${lamp(16, 42, '#3a3020')}
    <rect x="230" y="20" width="18" height="24" rx="3" fill="${SEAM}"/><rect x="232" y="22" width="14" height="20" rx="3" fill="${P('#3c4045', 0.7)}"/>`;
  const side = `${casing(256, 52)}
    <rect x="4" y="36" width="248" height="2" fill="${SEAM}"/>
    ${slots(40, 9, 24, 7.5, 3, 20, DARK)}
    ${screwAt(18, 44, 3)}${screwAt(238, 44, 3)}`;
  // The back: a cable gland and a small vent.
  const back = `${casing(256, 64)}
    <circle cx="128" cy="32" r="17" fill="${RING}"/><circle cx="128" cy="32" r="12" fill="${P('#1e1f21', 0.6)}"/>
    <circle cx="128" cy="32" r="6" fill="${HOLE}"/>
    ${slots(30, 18, 6, 9, 4, 28, DARK)}${slots(176, 18, 6, 9, 4, 28, DARK)}`;
  const bottom = `${casing(51, 64)}
    ${[[9, 9], [42, 9], [9, 55], [42, 55]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="${FOOT}"/>`).join('')}`;
  const look = height ? { grime: 0, scratches: 0 } : TECH;
  const rect = (r, body, id) => height
    ? `<g transform="translate(${r[0]} ${r[1]})">${body}</g>`
    : inRect(r, body, id, look);
  return svg(size, [
    rect(faces.py, top, 'py'),
    rect(faces.ny, bottom, 'ny'),
    rect(faces.px, side, 'px'),
    rect(faces.pz, front, 'pz'),
    rect(faces.nz, back, 'nz'),
  ].join(''));
}

/**
 * A tangent-space normal map from a height map's SVG: three's convention
 * (green up the picture), each face's slopes read only from inside its own
 * rectangle so neighbours in the atlas don't bleed into it.
 */
async function normalMap(heightSvg, [W, H], rects, strength) {
  const { data } = await sharp(Buffer.from(heightSvg)).removeAlpha().greyscale().blur(0.6).raw()
    .toBuffer({ resolveWithObject: true });
  const owner = new Int16Array(W * H).fill(-1);
  rects.forEach(([x, y, w, h], i) => {
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) owner[r * W + c] = i;
  });
  const at = (c, r, o) => {
    const k = r * W + c;
    return c < 0 || r < 0 || c >= W || r >= H || owner[k] !== o ? null : data[k] / 255;
  };
  const out = Buffer.alloc(W * H * 3);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const k = r * W + c, o = owner[k], h0 = data[k] / 255;
      const hl = at(c - 1, r, o) ?? h0, hr = at(c + 1, r, o) ?? h0;
      const hu = at(c, r - 1, o) ?? h0, hd = at(c, r + 1, o) ?? h0;
      let nx = -(hr - hl) * strength, ny = (hd - hu) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      out[k * 3] = Math.round((nx / len * 0.5 + 0.5) * 255);
      out[k * 3 + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      out[k * 3 + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
    }
  }
  return sharp(out, { raw: { width: W, height: H, channels: 3 } });
}

// ── The box dock ───────────────────────────────

function dock() {
  const { size, faces } = DOCK_ATLAS;
  const STEEL = '#4e4648', SEAM = '#2c2627', PAD = '#262324', RIB = '#332f30', BLOCK = '#3b3537', BOLT = '#6a6264';
  const bolt = (x, y) => `<circle cx="${x}" cy="${y}" r="6" fill="rgba(0,0,0,0.4)"/><circle cx="${x}" cy="${y}" r="5" fill="${BOLT}"/>
    <circle cx="${x - 1.5}" cy="${y - 1.5}" r="1.5" fill="rgba(255,255,255,0.15)"/>`;
  const boltRow = (x0, x1, y, n) => Array.from({ length: n }, (_, i) => bolt(x0 + (x1 - x0) * i / (n - 1), y)).join('');
  // The pad: the box's footprint (0.32 × 0.28 m) in the middle of the top, a
  // ribbed rubber mat in a sunk tray, a guide block at each corner.
  const [px, py, pw, ph] = [61, 49, 390, 341];
  const block = (x, y) => `<rect x="${x}" y="${y}" width="30" height="30" rx="2" fill="${BLOCK}"/>${bevel(x, y, 30, 30, { k: 1.4 })}`;
  const top = `<rect width="512" height="439" fill="${STEEL}"/>${bevel(0, 0, 512, 439)}
    <rect x="22" y="22" width="468" height="395" fill="none" stroke="${SEAM}" stroke-width="2"/>
    ${boltRow(40, 472, 12, 8)}${boltRow(40, 472, 427, 8)}
    <rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="4" fill="${PAD}"/>${bevel(px, py, pw, ph, { sunk: true, k: 1.6 })}
    ${Array.from({ length: Math.floor((ph - 20) / 12) }, (_, i) => `<rect x="${px + 10}" y="${py + 12 + i * 12}" width="${pw - 20}" height="4" fill="${RIB}"/>`).join('')}
    ${block(px - 14, py - 14)}${block(px + pw - 16, py - 14)}${block(px - 14, py + ph - 16)}${block(px + pw - 16, py + ph - 16)}`;
  const side = (w) => `<rect width="${w}" height="73" fill="${STEEL}"/>${bevel(0, 0, w, 73)}
    <rect y="54" width="${w}" height="2" fill="${SEAM}"/>
    ${boltRow(18, w - 18, 30, Math.max(3, Math.round(w / 60)))}`;
  return svg(size, [
    inRect(faces.py, top, 'py', STEEL_WEAR),
    inRect(faces.pz, side(256), 'pz', STEEL_WEAR),
    inRect(faces.px, side(219), 'px', STEEL_WEAR),
  ].join(''));
}

// ── The dock's table ───────────────────────────

/** The table, as its colour or (`height`) a height map, as the reader is. */
function table(height = false) {
  const { size, faces } = TABLE_ATLAS;
  const grey = v => { const g = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0'); return `#${g}${g}${g}`; };
  const P = (colour, h) => (height ? grey(h) : colour);
  const STEEL = P('#464b51', 0.5), FACE = P('#4d5359', 0.58), SEAM = P('#24272a', 0.3), KICK = P('#2b2e32', 0.4);
  const HANDLE = P('#8a9096', 0.82), TOP = P('#3f4449', 0.56), LOUVRE = P('#1c1e21', 0.14);
  const bevel_ = (...args) => (height ? '' : bevel(...args));
  const gleam = str => (height ? '' : str);
  const screwAt = (x, y, r) => height
    ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${grey(0.72)}"/>`
    : screw(x, y, r, '#5a5f65', '#24272a');
  // A drawer or a door: a raised face in the frame, a bar handle.
  const panel = (x, y, w, h, handleY = 22) => `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${SEAM}"/>
    <rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="2" fill="${FACE}"/>${bevel_(x + 3, y + 3, w - 6, h - 6, { k: 1.3 })}
    <rect x="${x + w / 2 - 34}" y="${y + handleY}" width="68" height="9" rx="4" fill="${HANDLE}"/>${bevel_(x + w / 2 - 34, y + handleY, 68, 9, { k: 1.6 })}`;
  // The front (−x), 1.95 m long: a lip under the top, three bays (stacked
  // drawers, a louvred door, stacked drawers), a kick plate along the foot.
  const front = `<rect width="1024" height="394" fill="${STEEL}"/>${bevel_(0, 0, 1024, 394)}
    <rect y="0" width="1024" height="16" fill="${TOP}"/><rect y="16" width="1024" height="3" fill="${SEAM}"/>
    ${panel(24, 30, 300, 98)}${panel(24, 134, 300, 98)}${panel(24, 238, 300, 98)}
    ${panel(700, 30, 300, 98)}${panel(700, 134, 300, 98)}${panel(700, 238, 300, 98)}
    <rect x="340" y="30" width="344" height="306" fill="${SEAM}"/>
    <rect x="343" y="33" width="338" height="300" rx="2" fill="${FACE}"/>${bevel_(343, 33, 338, 300, { k: 1.3 })}
    ${Array.from({ length: 9 }, (_, i) => `<rect x="392" y="${70 + i * 22}" width="240" height="9" rx="3" fill="${LOUVRE}"/>
      ${gleam(`<rect x="392" y="${70 + i * 22}" width="240" height="2" fill="rgba(255,255,255,0.08)"/>`)}`).join('')}
    <rect x="652" y="150" width="10" height="70" rx="4" fill="${HANDLE}"/>${bevel_(652, 150, 10, 70, { k: 1.6 })}
    <rect y="346" width="1024" height="48" fill="${KICK}"/>${bevel_(0, 346, 1024, 48, { sunk: true })}
    ${slots(40, 362, 31, 31, 18, 16, LOUVRE)}`;
  // The worktop: a sheet of steel with a rolled edge, worn where things go.
  const top = `<rect width="131" height="512" fill="${TOP}"/>${bevel_(0, 0, 131, 512)}
    <rect x="6" y="6" width="119" height="500" fill="none" stroke="${SEAM}" stroke-width="2"/>
    ${screwAt(14, 14, 3)}${screwAt(117, 14, 3)}${screwAt(14, 498, 3)}${screwAt(117, 498, 3)}`;
  // The ends: a side panel in its frame, a lifting slot.
  const end = `<rect width="341" height="512" fill="${STEEL}"/>${bevel_(0, 0, 341, 512)}
    <rect y="0" width="341" height="21" fill="${TOP}"/><rect y="21" width="341" height="3" fill="${SEAM}"/>
    <rect x="24" y="40" width="293" height="390" rx="3" fill="${FACE}"/>${bevel_(24, 40, 293, 390, { k: 1.2 })}
    <rect x="120" y="80" width="100" height="22" rx="10" fill="${LOUVRE}"/>
    <rect y="450" width="341" height="62" fill="${KICK}"/>${bevel_(0, 450, 341, 62, { sunk: true })}`;
  const look = { grime: 0.35, scratches: 0.9 };
  const rect = (r, body, id) => height
    ? `<g transform="translate(${r[0]} ${r[1]})">${body}</g>`
    : inRect(r, body, id, look);
  return svg(size, [
    rect(faces.nx, front, 'nx'),
    rect(faces.py, top, 'py'),
    rect(faces.pz, end, 'pz'),
  ].join(''));
}

// ── The coffee bag ─────────────────────────────

function bag() {
  const { size, body, roll } = BAG_ATLAS;
  const KRAFT = '#977250', FOLD = '#6f5236', LABEL = '#2f2219', CREAM = '#cbbd9e', TIE = '#7f8488';
  const defs = `
    <filter id="paper" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.16 0"/>
    </filter>
    <filter id="creases" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="turbulence" baseFrequency="0.03 0.012" numOctaves="2" seed="9"/>
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.9 0 0 0 -0.3"/>
    </filter>
    <linearGradient id="edges" x1="0" x2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.28"/><stop offset="0.12" stop-color="#000" stop-opacity="0"/>
      <stop offset="0.88" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.28"/>
    </linearGradient>
    <linearGradient id="crease" x1="0" x2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.5" stop-color="#000" stop-opacity="0.3"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </linearGradient>`;
  const paper = (w, h) => `<rect width="${w}" height="${h}" fill="${KRAFT}"/>
    <rect width="${w}" height="${h}" filter="url(#paper)"/>`;
  // Crumples over the whole face, the label included.
  const crumple = (w, h) => `<rect width="${w}" height="${h}" filter="url(#creases)" opacity="0.6"/>`;
  const bean = (x, y, s) => `<g transform="translate(${x} ${y}) rotate(-25)">
    <ellipse rx="${s}" ry="${s * 1.35}" fill="${CREAM}"/>
    <path d="M 0 ${-s * 1.2} C ${s * 0.6} ${-s * 0.4}, ${-s * 0.6} ${s * 0.4}, 0 ${s * 1.2}" stroke="${LABEL}" stroke-width="${s * 0.22}" fill="none"/></g>`;
  // The front's top third leans in to the seam; the label is on the rest.
  const front = `${paper(256, 310)}<rect width="256" height="310" fill="url(#edges)"/>
    <circle cx="128" cy="58" r="12" fill="${FOLD}"/><circle cx="128" cy="58" r="6" fill="#4f3822"/>
    <rect x="12" y="108" width="232" height="192" rx="10" fill="${LABEL}"/>
    <rect x="20" y="116" width="216" height="176" rx="7" fill="none" stroke="${CREAM}" stroke-width="2" opacity="0.8"/>
    ${bean(104, 150, 13)}${bean(152, 150, 13)}
    ${text(128, 216, 36, 'GROUND', { fill: CREAM, font: SERIF, spacing: 2 })}
    ${text(128, 256, 36, 'COFFEE', { fill: CREAM, font: SERIF, spacing: 2 })}
    <rect x="58" y="272" width="140" height="2" fill="${CREAM}" opacity="0.8"/>
    ${crumple(256, 310)}`;
  const back = `${paper(256, 310)}<rect width="256" height="310" fill="url(#edges)"/>
    <rect x="40" y="140" width="176" height="120" rx="5" fill="${CREAM}"/>
    ${Array.from({ length: 6 }, (_, i) => `<rect x="56" y="${158 + i * 14}" width="${i % 3 === 2 ? 96 : 144}" height="5" fill="${LABEL}" opacity="0.55"/>`).join('')}
    ${crumple(256, 310)}`;
  const gusset = `${paper(206, 310)}<rect x="63" width="80" height="310" fill="url(#crease)"/>${crumple(206, 310)}`;
  const plain = `${paper(306, 245)}${crumple(306, 245)}`;
  // The seam: crimped, with a tin tie across it.
  const crimp = (w, h) => `${paper(w, h)}<rect width="${w}" height="${h}" fill="${FOLD}" opacity="0.3"/>
    ${slots(2, 0, Math.floor(w / 8), 8, 2, h, FOLD).replace(/fill=/g, 'opacity="0.5" fill=')}`;
  const rollFront = `${crimp(512, 86)}
    <rect y="33" width="512" height="20" fill="${TIE}"/><rect y="33" width="512" height="4" fill="#a9adb0"/>
    <rect x="0" y="25" width="22" height="36" fill="${TIE}"/><rect x="490" y="25" width="22" height="36" fill="${TIE}"/>`;
  const rollSide = crimp(128, 86);
  const rollTop = `${paper(384, 86)}<rect width="384" height="86" fill="${FOLD}" opacity="0.4"/>`;
  return svg(size, [
    inRect(body.pz, front, 'bpz', PAPER),
    inRect(body.nz, back, 'bnz', PAPER),
    inRect(body.px, gusset, 'bpx', PAPER),
    inRect(body.py, plain, 'bpy', PAPER),
    inRect(roll.pz, rollFront, 'rpz', PAPER),
    inRect(roll.px, rollSide, 'rpx', PAPER),
    inRect(roll.py, rollTop, 'rpy', PAPER),
  ].join(''), defs);
}

for (const [name, draw] of [['drive', () => drive()], ['drive-box', () => box()], ['coffee-bag', bag], ['drive-reader', () => reader()], ['box-dock', dock], ['dock-table', () => table()]]) {
  const out = `${outDir}/${name}.png`;
  await sharp(Buffer.from(draw())).png({ compressionLevel: 9, palette: true }).toFile(out);
  console.log(`wrote ${out}`);
}

// The reader's, the drive's, the table's and the box's relief, from the same shapes as their colour.
for (const [name, draw, { size, faces }] of [['drive-reader-normal', reader, READER_ATLAS], ['drive-normal', drive, DRIVE_ATLAS], ['dock-table-normal', table, TABLE_ATLAS], ['drive-box-normal', box, BOX_ATLAS]]) {
  const out = `${outDir}/${name}.png`;
  await (await normalMap(draw(true), size, Object.values(faces), 4)).png({ compressionLevel: 9 }).toFile(out);
  console.log(`wrote ${out}`);
}
