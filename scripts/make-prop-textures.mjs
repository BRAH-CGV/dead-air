// ─────────────────────────────────────────────
// make-prop-textures  –  the carried props' atlases → public/assets/textures/ (#188)
// ─────────────────────────────────────────────
// Three small atlases, one per prop, a rectangle per face (the layouts are
// in src/gameobjects/propAtlases.js, which lays them onto the boxes):
//
//   drive.png           the drive's casing: its size on top, vents on the end
//                       its LED sits on, the connector on the other
//   drive-box.png       the drive box, in greys: its own colour tints it
//   coffee-bag.png      a kraft bag of ground coffee, its rolled top and tie
//
// Drawn here as SVG and rasterised with sharp. Ours, so no credit.
//
// Usage: node scripts/make-prop-textures.mjs [outDir]
// ─────────────────────────────────────────────
import sharp from 'sharp';
import { DRIVE_ATLAS, BOX_ATLAS, BAG_ATLAS } from '../src/gameobjects/propAtlases.js';

const outDir = process.argv[2] ?? 'public/assets/textures';
const SANS = 'DejaVu Sans, sans-serif';
const MONO = 'DejaVu Sans Mono, monospace';
const SERIF = 'DejaVu Serif, serif';

const svg = ([W, H], body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${defs}</defs>${body}</svg>`;

/** Draw `body` into the rectangle `[x, y, w, h]`, its own 0,0 at the corner,
 *  clipped to it. */
const inRect = ([x, y, w, h], body, id) =>
  `<clipPath id="${id}"><rect width="${w}" height="${h}"/></clipPath>
   <g transform="translate(${x} ${y})" clip-path="url(#${id})">${body}</g>`;

const text = (x, y, size, str, { fill, font = SANS, weight = 'bold', anchor = 'middle', spacing = 0 } = {}) =>
  `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}"
    text-anchor="${anchor}" letter-spacing="${spacing}" fill="${fill}">${str}</text>`;

const screw = (x, y, r, fill, slot) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>
   <rect x="${x - r * 0.7}" y="${y - r * 0.18}" width="${r * 1.4}" height="${r * 0.36}" fill="${slot}"/>`;

// ── The drive ──────────────────────────────────

function drive() {
  const { size, faces } = DRIVE_ATLAS;
  const CASE = '#3a3c3f', EDGE = '#4d5054', DARK = '#1d1e20', STICKER = '#d9d3c3', INK = '#26221c';
  const casing = (w, h) => `<rect width="${w}" height="${h}" fill="${EDGE}"/>
    <rect x="3" y="3" width="${w - 6}" height="${h - 6}" fill="${CASE}"/>`;
  const top = `${casing(128, 192)}
    <rect x="64" y="0" width="62" height="28" rx="3" fill="${DARK}"/>
    <rect x="16" y="56" width="96" height="96" rx="4" fill="${STICKER}"/>
    <rect x="16" y="56" width="96" height="14" rx="4" fill="${INK}"/>
    <rect x="16" y="64" width="96" height="6" fill="${INK}"/>
    <rect x="24" y="62" width="34" height="3" fill="${STICKER}" opacity="0.7"/>
    <rect x="62" y="62" width="20" height="3" fill="${STICKER}" opacity="0.7"/>
    ${text(24, 98, 13, '64 MB', { fill: INK, font: MONO, anchor: 'start' })}
    ${[[24, 114, 80], [24, 122, 62], [24, 130, 72], [24, 138, 44]].map(([x, y, w]) =>
      `<rect x="${x}" y="${y}" width="${w}" height="3" fill="${INK}" opacity="0.45"/>`).join('')}`;
  const bottom = `${casing(128, 192)}
    ${screw(14, 14, 5, '#5c6066', DARK)}${screw(114, 14, 5, '#5c6066', DARK)}
    ${screw(14, 178, 5, '#5c6066', DARK)}${screw(114, 178, 5, '#5c6066', DARK)}
    ${[[30, 82, 68], [30, 92, 52], [30, 102, 60], [30, 112, 36]].map(([x, y, w]) =>
      `<rect x="${x}" y="${y}" width="${w}" height="3" fill="${EDGE}"/>`).join('')}`;
  const side = `<rect width="256" height="32" fill="${CASE}"/>
    <rect width="256" height="3" fill="${EDGE}"/><rect y="29" width="256" height="3" fill="${EDGE}"/>
    <rect x="8" y="11" width="240" height="2" fill="${DARK}"/>
    <rect x="8" y="19" width="240" height="2" fill="${DARK}"/>`;
  const vents = `${casing(128, 32)}
    ${Array.from({ length: 7 }, (_, i) => `<rect x="${68 + i * 8}" y="8" width="4" height="16" rx="1" fill="${DARK}"/>`).join('')}`;
  const connector = `${casing(128, 32)}
    <rect x="14" y="9" width="100" height="14" rx="2" fill="${DARK}"/>
    ${Array.from({ length: 14 }, (_, i) => `<rect x="${19 + i * 6.8}" y="12" width="3.4" height="8" fill="#c9a43a"/>`).join('')}`;
  return svg(size, [
    inRect(faces.py, top, 'py'),
    inRect(faces.ny, bottom, 'ny'),
    inRect(faces.px, side, 'px'),
    inRect(faces.nz, vents, 'nz'),
    inRect(faces.pz, connector, 'pz'),
  ].join(''));
}

// ── The drive box ──────────────────────────────

function box() {
  const { size, faces } = BOX_ATLAS;
  // Greys only: the box's colour multiplies them.
  const BASE = '#e4e4e4', RIM = '#f4f4f4', LINE = '#8a8a8a', DEEP = '#b4b4b4', HOLE = '#2a2a2a', CORNER = '#6a6a6a', PLATE = '#ffffff', INK = '#3a3a3a';
  const frame = (w, h, band) => `<rect width="${w}" height="${h}" fill="${RIM}"/>
    <rect x="${band}" y="${band}" width="${w - 2 * band}" height="${h - 2 * band}" fill="${BASE}"/>
    <rect x="${band}" y="${band}" width="${w - 2 * band}" height="${h - 2 * band}" fill="none" stroke="${LINE}" stroke-width="2"/>`;
  const rivets = (w, h, inset) => [[inset, inset], [w - inset, inset], [inset, h - inset], [w - inset, h - inset]]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="${DEEP}" stroke="${LINE}" stroke-width="1.5"/>`).join('');
  const scuffs = (w, h) => `<rect x="0" y="${h - 22}" width="${w}" height="22" fill="${DEEP}" opacity="0.55"/>`;
  // Dark corner guards, an L in each corner of a side.
  const guards = (w, h, s) => [[0, 0], [w - s, 0], [0, h - 12], [w - s, h - 12]]
    .map(([x, y]) => `<rect x="${x}" y="${y}" width="${s}" height="12" fill="${CORNER}"/>`)
    .concat([[0, 0], [w - 12, 0], [0, h - s], [w - 12, h - s]]
      .map(([x, y]) => `<rect x="${x}" y="${y}" width="12" height="${s}" fill="${CORNER}"/>`)).join('');
  const top = `${frame(512, 448, 22)}
    <rect x="34" y="44" width="444" height="360" rx="10" fill="${DEEP}"/>
    <rect x="34" y="44" width="444" height="360" rx="10" fill="none" stroke="${LINE}" stroke-width="3"/>
    ${rivets(512, 448, 12)}`;
  const long = `${frame(512, 192, 14)}${scuffs(512, 192)}
    <rect x="120" y="14" width="6" height="164" fill="${DEEP}"/><rect x="386" y="14" width="6" height="164" fill="${DEEP}"/>
    <rect x="176" y="56" width="160" height="64" rx="4" fill="${PLATE}" stroke="${LINE}" stroke-width="2"/>
    ${screw(190, 88, 4, DEEP, LINE)}${screw(322, 88, 4, DEEP, LINE)}
    ${guards(512, 192, 40)}`;
  const short = `${frame(448, 192, 14)}${scuffs(448, 192)}
    <rect x="144" y="36" width="160" height="34" rx="17" fill="${HOLE}"/>
    <rect x="144" y="36" width="160" height="10" rx="5" fill="#000000" opacity="0.5"/>
    ${text(224, 128, 16, '▲ THIS WAY UP ▲', { fill: INK, font: MONO })}
    ${guards(448, 192, 40)}`;
  const bottom = `${frame(512, 192, 10)}
    ${Array.from({ length: 7 }, (_, i) => `<rect x="${32 + i * 64}" y="10" width="3" height="172" fill="${DEEP}"/>`).join('')}`;
  return svg(size, [
    inRect(faces.py, top, 'py'),
    inRect(faces.pz, long, 'pz'),
    inRect(faces.px, short, 'px'),
    inRect(faces.ny, bottom, 'ny'),
  ].join(''));
}

// ── The coffee bag ─────────────────────────────

function bag() {
  const { size, body, roll } = BAG_ATLAS;
  const KRAFT = '#a77d4d', FOLD = '#7d5a35', LABEL = '#3b2416', CREAM = '#efe3c8', TIE = '#9ea3a8';
  const defs = `
    <filter id="paper" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.16 0"/>
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
  const bean = (x, y, s) => `<g transform="translate(${x} ${y}) rotate(-25)">
    <ellipse rx="${s}" ry="${s * 1.35}" fill="${CREAM}"/>
    <path d="M 0 ${-s * 1.2} C ${s * 0.6} ${-s * 0.4}, ${-s * 0.6} ${s * 0.4}, 0 ${s * 1.2}" stroke="${LABEL}" stroke-width="${s * 0.22}" fill="none"/></g>`;
  const front = `${paper(256, 416)}<rect width="256" height="416" fill="url(#edges)"/>
    <circle cx="128" cy="62" r="14" fill="${FOLD}"/><circle cx="128" cy="62" r="7" fill="#5b4026"/>
    <rect x="22" y="112" width="212" height="218" rx="12" fill="${LABEL}"/>
    <rect x="30" y="120" width="196" height="202" rx="8" fill="none" stroke="${CREAM}" stroke-width="2"/>
    ${bean(104, 162, 14)}${bean(152, 162, 14)}
    ${text(128, 232, 31, 'GROUND', { fill: CREAM, font: SERIF, spacing: 2 })}
    ${text(128, 270, 31, 'COFFEE', { fill: CREAM, font: SERIF, spacing: 2 })}
    <rect x="62" y="290" width="132" height="2" fill="${CREAM}"/>`;
  const back = `${paper(256, 416)}<rect width="256" height="416" fill="url(#edges)"/>
    <rect x="40" y="140" width="176" height="120" rx="6" fill="${CREAM}"/>
    ${Array.from({ length: 6 }, (_, i) => `<rect x="56" y="${158 + i * 14}" width="${i % 3 === 2 ? 96 : 144}" height="5" fill="${LABEL}" opacity="0.6"/>`).join('')}`;
  const gusset = `${paper(256, 320)}<rect x="88" width="80" height="320" fill="url(#crease)"/>`;
  const plain = paper(256, 320);
  const rollFront = `${paper(512, 120)}<rect width="512" height="120" fill="${FOLD}" opacity="0.35"/>
    <rect y="28" width="512" height="3" fill="${FOLD}"/><rect y="92" width="512" height="3" fill="${FOLD}"/>
    <rect y="50" width="512" height="20" fill="${TIE}"/><rect y="50" width="512" height="5" fill="#d3d7da"/>
    <rect x="0" y="40" width="22" height="40" fill="${TIE}"/><rect x="490" y="40" width="22" height="40" fill="${TIE}"/>`;
  const rollSide = `${paper(256, 56)}<rect width="256" height="56" fill="${FOLD}" opacity="0.35"/>
    <path d="M 0 28 Q 64 6, 128 28 T 256 28" stroke="${FOLD}" stroke-width="3" fill="none"/>`;
  const rollTop = `${paper(256, 168)}<rect width="256" height="168" fill="${FOLD}" opacity="0.25"/>
    <rect y="40" width="256" height="3" fill="${FOLD}"/><rect y="124" width="256" height="3" fill="${FOLD}"/>`;
  return svg(size, [
    inRect(body.pz, front, 'bpz'),
    inRect(body.nz, back, 'bnz'),
    inRect(body.px, gusset, 'bpx'),
    inRect(body.py, plain, 'bpy'),
    inRect(roll.pz, rollFront, 'rpz'),
    inRect(roll.px, rollSide, 'rpx'),
    inRect(roll.py, rollTop, 'rpy'),
  ].join(''), defs);
}

for (const [name, draw] of [['drive', drive], ['drive-box', box], ['coffee-bag', bag]]) {
  const out = `${outDir}/${name}.png`;
  await sharp(Buffer.from(draw())).png({ compressionLevel: 9, palette: true }).toFile(out);
  console.log(`wrote ${out}`);
}
