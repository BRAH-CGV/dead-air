#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// generate-level-variants.mjs  (throwaway — not committed)
//
// Reads every base (level-0) WAV in src/assets/signals/ and writes:
//   {name}_L1.wav  — pink noise bed, main track at 1–20 % volume
//                     (random shifts every ~0.5 s)
//   {name}_L2.wav  — brownian noise bed, main track at 80 % volume
//   {name}_L3.wav  — copy of the original (just renamed)
//
// Usage:  node scripts/generate-level-variants.mjs
// ────────────────────────────────────────────────────────────────
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, parse, format } from 'node:path';

const SIGNALS_DIR = 'src/assets/signals';

// ── WAV I/O (16-bit PCM only — sufficient for this task) ──────

function readWav(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const riff = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (riff !== 'RIFF') throw new Error('Not a RIFF file');
  const wave = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
  if (wave !== 'WAVE') throw new Error('Not a WAVE file');

  let offset = 12;
  let channels = 0, sampleRate = 0, bitsPerSample = 0, pcm = null;

  while (offset < buf.length - 8) {
    const id = String.fromCharCode(buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]);
    const size = view.getUint32(offset + 4, true);
    offset += 8;
    if (id === 'fmt ') {
      const fmt = view.getUint16(offset, true);
      if (fmt !== 1) throw new Error(`Only PCM supported (got format ${fmt})`);
      channels = view.getUint16(offset + 2, true);
      sampleRate = view.getUint32(offset + 4, true);
      bitsPerSample = view.getUint16(offset + 14, true);
    } else if (id === 'data') {
      pcm = Buffer.from(buf.buffer, buf.byteOffset + offset, size);
    }
    offset += size;
  }
  if (!pcm) throw new Error('No data chunk found');
  return { channels, sampleRate, bitsPerSample, pcm };
}

function writeWav({ channels, sampleRate, bitsPerSample, pcm }) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);                       // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * bitsPerSample / 8, 32);  // block align
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// ── PCM helpers ────────────────────────────────────────────────

function pcmToFloats(pcm, channels, bitsPerSample) {
  const bytesPerSample = bitsPerSample / 8;
  const n = pcm.length / bytesPerSample;
  const out = new Float32Array(n);
  const max = 2 ** (bitsPerSample - 1);
  for (let i = 0; i < n; i++) {
    let sample;
    if (bytesPerSample === 2) {
      sample = pcm.readInt16LE(i * 2);
    } else if (bytesPerSample === 4) {
      sample = pcm.readInt32LE(i * 4);
    } else {
      throw new Error(`Unsupported bit depth: ${bitsPerSample}`);
    }
    out[i] = sample / max;
  }
  return out;
}

function floatsToPcm(floats, bitsPerSample) {
  const bytesPerSample = bitsPerSample / 8;
  const pcm = Buffer.alloc(floats.length * bytesPerSample);
  const max = 2 ** (bitsPerSample - 1) - 1;
  for (let i = 0; i < floats.length; i++) {
    const clamped = Math.max(-1, Math.min(1, floats[i]));
    const sample = Math.round(clamped * max);
    if (bytesPerSample === 2) {
      pcm.writeInt16LE(sample, i * 2);
    } else {
      pcm.writeInt32LE(sample, i * 4);
    }
  }
  return pcm;
}

// ── Noise generators ──────────────────────────────────────────

/** Pink noise via the Voss–McCartan algorithm (12 rows of white). */
function generatePinkNoise(length) {
  const NUM_ROWS = 12;
  const rows = new Float64Array(NUM_ROWS);
  let runningSum = 0;
  const out = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    // How many trailing zeros in the binary of i?
    let numZeros = 0;
    let n = i;
    if (n > 0) {
      while ((n & 1) === 0 && numZeros < NUM_ROWS) { numZeros++; n >>= 1; }
    }
    if (numZeros < NUM_ROWS) {
      runningSum -= rows[numZeros];
      const newVal = Math.random() * 2 - 1;
      runningSum += newVal;
      rows[numZeros] = newVal;
    }
    out[i] = (runningSum / NUM_ROWS + (Math.random() * 2 - 1)) * 0.2;
  }
  return out;
}

/** Brownian (Brown / red) noise — integrated white noise. */
function generateBrownianNoise(length) {
  const out = new Float32Array(length);
  let val = 0;
  for (let i = 0; i < length; i++) {
    val += (Math.random() * 2 - 1) * 0.02;
    val = Math.max(-1, Math.min(1, val));
    out[i] = val;
  }
  return out;
}

// ── Mixing ─────────────────────────────────────────────────────

/** Mix the main signal with a noise bed.
 *  mainVol is an array of the same length as `signal`, giving per-sample
 *  volume for the main track.  noiseVol is a scalar for the noise bed. */
function mix(signal, noise, mainVol, noiseVol) {
  const out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    out[i] = signal[i] * mainVol[i] + noise[i] * noiseVol;
  }
  // Normalise so nothing clips
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 1) {
    const scale = 0.98 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= scale;
  }
  return out;
}

/** Build a per-sample volume envelope that randomly shifts between
 *  minVol and maxVol every `segmentSec` seconds, with short crossfades
 *  so there are no clicks. */
function randomVolumeEnvelope(length, sampleRate, minVol, maxVol, segmentSec = 0.5) {
  const segLen = Math.floor(sampleRate * segmentSec);
  const fadeLen = Math.floor(sampleRate * 0.02);   // 20 ms crossfade
  const env = new Float32Array(length);
  let currentVol = minVol + Math.random() * (maxVol - minVol);

  for (let i = 0; i < length; i++) {
    if (i % segLen === 0 && i > 0) {
      const nextVol = minVol + Math.random() * (maxVol - minVol);
      // Crossfade over fadeLen samples
      for (let j = 0; j < fadeLen && i + j < length; j++) {
        const t = j / fadeLen;
        env[i + j] = currentVol * (1 - t) + nextVol * t;
      }
      currentVol = nextVol;
    }
    env[i] = currentVol;
  }
  return env;
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  const dir = join(process.cwd(), SIGNALS_DIR);
  const allFiles = await readdir(dir);

  // Only base files: WAV, no _L suffix
  const baseFiles = allFiles.filter(f => {
    const { name, ext } = parse(f);
    return ext.toLowerCase() === '.wav' && !/_L\d+$/.test(name);
  });

  // Warn about non-WAV base files we can't process
  const skipped = allFiles.filter(f => {
    const { name, ext } = parse(f);
    return !/_L\d+$/.test(name) && ext.toLowerCase() !== '.wav';
  });
  if (skipped.length > 0) {
    console.log(`\n⚠  Skipping non-WAV base files (convert to WAV first):`);
    for (const f of skipped) console.log(`   ${f}`);
  }

  console.log(`\nProcessing ${baseFiles.length} base signal(s)...\n`);

  for (const file of baseFiles) {
    const { name } = parse(file);
    console.log(`  ${file}`);

    const buf = await readFile(join(dir, file));
    const { channels, sampleRate, bitsPerSample, pcm } = readWav(buf);
    const samples = pcmToFloats(pcm, channels, bitsPerSample);
    const totalSamples = samples.length;

    // ── L1: pink noise + main at 1–20 % (random shifts) ──
    const pinkNoise = generatePinkNoise(totalSamples);
    const l1Env = randomVolumeEnvelope(totalSamples, sampleRate, 0.01, 0.20);
    const l1Mixed = mix(samples, pinkNoise, l1Env, 0.5);
    const l1Pcm = floatsToPcm(l1Mixed, bitsPerSample);
    await writeFile(
      join(dir, `${name}_L1.wav`),
      writeWav({ channels, sampleRate, bitsPerSample, pcm: l1Pcm }),
    );
    console.log(`    → ${name}_L1.wav  (pink noise, 1–20 % vol)`);

    // ── L2: brownian noise + main at 80 % ──
    const brownNoise = generateBrownianNoise(totalSamples);
    const l2Env = new Float32Array(totalSamples).fill(0.80);
    const l2Mixed = mix(samples, brownNoise, l2Env, 0.3);
    const l2Pcm = floatsToPcm(l2Mixed, bitsPerSample);
    await writeFile(
      join(dir, `${name}_L2.wav`),
      writeWav({ channels, sampleRate, bitsPerSample, pcm: l2Pcm }),
    );
    console.log(`    → ${name}_L2.wav  (brownian noise, 80 % vol)`);

    // ── L3: copy of the original ──
    await writeFile(join(dir, `${name}_L3.wav`), buf);
    console.log(`    → ${name}_L3.wav  (original copy)`);
  }

  console.log('\n✓ Done.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
