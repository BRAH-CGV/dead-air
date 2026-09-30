// Renders every recipe in src/audio/sounds.js to public/assets/audio/<stem>.wav.
//
//   node scripts/make-sounds.mjs            all of them
//   node scripts/make-sounds.mjs sfx:chime  just the keys named
//
// No dependencies: the synth is plain JavaScript and the output is 16-bit
// mono PCM. Randomness is seeded, so a re-run rewrites identical bytes and
// git only sees the sounds whose recipe changed.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUNDS, renderSound } from '../src/audio/sounds.js';
import { encodeWav, SAMPLE_RATE } from '../src/audio/synth.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'assets', 'audio');
mkdirSync(outDir, { recursive: true });

const keys = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(SOUNDS);
let total = 0;
for (const key of keys) {
  const bytes = encodeWav(renderSound(key), SAMPLE_RATE);
  const file = `${key.slice(key.indexOf(':') + 1)}.wav`;
  writeFileSync(join(outDir, file), bytes);
  total += bytes.length;
  console.log(`${key.padEnd(20)} → assets/audio/${file}  ${(bytes.length / 1024).toFixed(0)} KB`);
}
console.log(`${keys.length} sounds, ${(total / 1024 / 1024).toFixed(2)} MB`);
