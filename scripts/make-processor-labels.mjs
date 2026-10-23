// ─────────────────────────────────────────────
// make-processor-labels  –  the bean processor's plates → public/assets/textures/processor-labels.png
// ─────────────────────────────────────────────
// The office's bean processor (MainOffice._buildBeanProcessor) wears four
// stencilled plates, one strip of this atlas each, top to bottom: its name,
// the bay's, the hopper's, and a caution by the process window. Each strip
// is 8:1, the shape of its plate (PROCESSOR_LABELS in BeanProcessor.js has
// their uv rows). Drawn here as SVG and rasterised with sharp.
//
// Usage: node scripts/make-processor-labels.mjs [out.png]
// ─────────────────────────────────────────────
import sharp from 'sharp';

const W = 512, ROW = 64;
const out = process.argv[2] ?? 'public/assets/textures/processor-labels.png';

const PLATE = '#cfd6dc', INK = '#22272b', EDGE = '#8d969c';
const CAUTION = '#c9a227', BLACK = '#17191b';
const FONT = 'DejaVu Sans Mono, monospace';

/** A pale plate with a dark rim and stencilled words, in strip `i`. */
const plate = (i, text, size) => `
  <rect x="0" y="${i * ROW}" width="${W}" height="${ROW}" fill="${EDGE}"/>
  <rect x="4" y="${i * ROW + 4}" width="${W - 8}" height="${ROW - 8}" fill="${PLATE}"/>
  <text x="${W / 2}" y="${i * ROW + ROW / 2 + size * 0.36}" text-anchor="middle" font-family="${FONT}"
    font-weight="bold" font-size="${size}" letter-spacing="2" fill="${INK}">${text}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${4 * ROW}">
  ${plate(0, 'BP-2 · BEAN PROCESSOR', 28)}
  ${plate(1, 'GROUND COFFEE · 1 PER BATCH', 24)}
  ${plate(2, '▲ COFFEE BEANS IN ▲', 30)}
  <rect x="0" y="${3 * ROW}" width="${W}" height="${ROW}" fill="${CAUTION}"/>
  ${Array.from({ length: 12 }, (_, k) => `<polygon points="${k * 48 - 40},${4 * ROW} ${k * 48 - 16},${4 * ROW} ${k * 48 + 24},${3 * ROW} ${k * 48},${3 * ROW}" fill="${BLACK}"/>`).join('')}
  <rect x="64" y="${3 * ROW + 10}" width="${W - 128}" height="${ROW - 20}" fill="${CAUTION}"/>
  <text x="${W / 2}" y="${3 * ROW + ROW / 2 + 9}" text-anchor="middle" font-family="${FONT}"
    font-weight="bold" font-size="24" letter-spacing="1" fill="${BLACK}">CAUTION · ROTATING BURRS</text>
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(out);
console.log(`wrote ${out}`);
