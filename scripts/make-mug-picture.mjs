// ─────────────────────────────────────────────
// make-mug-picture  –  the coffee mug's wrap → public/assets/textures/mug-hang-in-there.png
// ─────────────────────────────────────────────
// The bedroom coffee's mug (CoffeeCup.js) wears one picture all the way
// round: a cream glaze, a band at the rim and the foot, and on its front a
// ginger cat hanging off a branch over "HANG IN THERE". Drawn here as SVG
// and rasterised with sharp, so it is ours and can be redrawn.
//
// The SVG is laid out at the mug's own proportions (`W` × `H`: once round
// to its height, 2π × 0.05 m to 0.1 m — CoffeeCup's CUP) and stretched to a
// power-of-two `OUT`; the mug's mapping stretches it back. The drawing is
// centred on x 512, the mug's front (u 0.5); the handle is at u 0.75.
//
// Usage: node scripts/make-mug-picture.mjs [out.png]
// ─────────────────────────────────────────────
import sharp from 'sharp';

const H = 352, W = Math.round(H * 2 * Math.PI * 0.05 / 0.1);   // 1106
const X0 = 512 - W / 2;                                              // the drawing stays on x 512
const OUT = [1024, 512];
const out = process.argv[2] ?? 'public/assets/textures/mug-hang-in-there.png';

const GLAZE = '#e8dcc4', BAND = '#4f7a78';
const FUR = '#d9894a', STRIPE = '#b8693a', BELLY = '#f3dcc0', INK = '#2b1d16';
const PAW = '#cdbb9c';

/** A small paw print, for the mug's sides. */
const paw = (x, y, r) => `
  <g fill="${PAW}" transform="translate(${x} ${y}) rotate(${r})">
    <ellipse cx="0" cy="8" rx="11" ry="9"/>
    <ellipse cx="-12" cy="-6" rx="4.5" ry="6"/><ellipse cx="-4" cy="-12" rx="4.5" ry="6"/>
    <ellipse cx="5" cy="-12" rx="4.5" ry="6"/><ellipse cx="13" cy="-5" rx="4.5" ry="6"/>
  </g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT[0]}" height="${OUT[1]}"
  viewBox="${X0} 0 ${W} ${H}" preserveAspectRatio="none">
  <rect x="${X0}" width="${W}" height="${H}" fill="${GLAZE}"/>
  <rect x="${X0}" width="${W}" height="16" fill="${BAND}"/>
  <rect x="${X0}" y="${H - 16}" width="${W}" height="16" fill="${BAND}"/>

  ${paw(140, 120, -20)}${paw(185, 205, 10)}${paw(900, 150, 15)}

  <!-- the branch, a twig and two leaves -->
  <path d="M 372 70 Q 450 58 512 64 T 660 56" stroke="#6b4a32" stroke-width="9" fill="none" stroke-linecap="round"/>
  <path d="M 600 60 q 14 -16 30 -18" stroke="#6b4a32" stroke-width="5" fill="none" stroke-linecap="round"/>
  <ellipse cx="634" cy="40" rx="11" ry="5" fill="#7d9455" transform="rotate(-20 634 40)"/>
  <ellipse cx="420" cy="58" rx="9" ry="4.5" fill="#7d9455" transform="rotate(25 420 58)"/>

  <!-- arms, up to the paws on the branch -->
  <path d="M 496 140 L 488 70 M 528 140 L 538 66" stroke="${FUR}" stroke-width="16" stroke-linecap="round"/>

  <!-- body, legs dangling, tail -->
  <path d="M 540 245 C 572 252 582 286 560 292 C 546 296 548 280 558 280" stroke="${FUR}" stroke-width="11" fill="none" stroke-linecap="round"/>
  <ellipse cx="494" cy="268" rx="10" ry="14" fill="${FUR}"/>
  <ellipse cx="530" cy="268" rx="10" ry="14" fill="${FUR}"/>
  <ellipse cx="512" cy="222" rx="36" ry="46" fill="${FUR}"/>
  <ellipse cx="512" cy="232" rx="20" ry="30" fill="${BELLY}"/>

  <!-- head -->
  <polygon points="474,138 470,98 502,120" fill="${FUR}"/>
  <polygon points="550,138 554,98 522,120" fill="${FUR}"/>
  <polygon points="478,128 476,106 496,120" fill="#e9a7a2"/>
  <polygon points="546,128 548,106 528,120" fill="#e9a7a2"/>
  <circle cx="512" cy="160" r="44" fill="${FUR}"/>
  <path d="M 500 124 q 4 10 0 18 M 512 120 v 18 M 524 124 q -4 10 0 18" stroke="${STRIPE}" stroke-width="4" fill="none" stroke-linecap="round"/>
  <circle cx="494" cy="160" r="11" fill="${INK}"/><circle cx="530" cy="160" r="11" fill="${INK}"/>
  <circle cx="498" cy="155" r="4" fill="#fff"/><circle cx="534" cy="155" r="4" fill="#fff"/>
  <circle cx="491" cy="165" r="2" fill="#fff"/><circle cx="527" cy="165" r="2" fill="#fff"/>
  <ellipse cx="480" cy="180" rx="8" ry="5" fill="#f0a39b" opacity="0.7"/>
  <ellipse cx="544" cy="180" rx="8" ry="5" fill="#f0a39b" opacity="0.7"/>
  <polygon points="507,174 517,174 512,180" fill="#e07a7a"/>
  <path d="M 502 184 q 5 6 10 0 q 5 6 10 0" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <path d="M 478 178 L 450 172 M 478 184 L 450 187 M 546 178 L 574 172 M 546 184 L 574 187" stroke="${INK}" stroke-width="2" opacity="0.7" stroke-linecap="round"/>
  <path d="M 568 126 q 7 11 0 15 q -7 -4 0 -15" fill="#8fc3d9"/>

  <!-- the paws, over the branch -->
  <circle cx="488" cy="68" r="10" fill="${FUR}"/><circle cx="538" cy="64" r="10" fill="${FUR}"/>
  <path d="M 483 62 v 5 M 488 60 v 6 M 493 62 v 5 M 533 58 v 5 M 538 56 v 6 M 543 58 v 5" stroke="${STRIPE}" stroke-width="2" stroke-linecap="round"/>

  <text x="512" y="326" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold"
    font-size="30" letter-spacing="3" fill="#5a3a2a">HANG IN THERE</text>
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(out);
console.log(`wrote ${out}`);
