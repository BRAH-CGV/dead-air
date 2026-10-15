// ─────────────────────────────────────────────
// Spectrogram  –  static STFT + canvas renderer
// ─────────────────────────────────────────────
// Turns a decoded AudioBuffer into a spectrogram image on a canvas.
//
// Pipeline:
//   1. decode(url, audioContext)  — fetch + decode a .wav into an AudioBuffer
//   2. compute(buffer, opts)      — STFT magnitude matrix (fft.js + Hann)
//   3. render(canvas, matrix)     — draw the matrix with a colour map
//
// The colour map is a four-stop gradient (dark → teal → yellow → white)
// applied per-pixel from the normalised magnitude. No external dependency.
// ─────────────────────────────────────────────

import FFT from 'fft.js';

/**
 * STFT frames processed per event-loop yield.
 * ~50 frames × ~1 ms/FFT = ~50 ms per chunk, keeping the UI responsive
 * for long audio files (7 s → ~112 yields over ~280 ms total).
 */
const _STFT_CHUNK = 50;

// ─ Audio decoding ───────────────────────────────────────────

/**
 * Fetch a .wav URL and decode it into an AudioBuffer.
 * @param {string} url
 * @param {AudioContext|OfflineAudioContext} audioContext
 * @returns {Promise<AudioBuffer>}
 */
export async function decode(url, audioContext) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return audioContext.decodeAudioData(arrayBuffer);
}

// ── STFT computation ─────────────────────────────────────────

/** Hann window of length N. */
function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

/**
 * Compute the short-time Fourier transform magnitude matrix.
 *
 * The function is async and yields to the event loop every `_STFT_CHUNK`
 * frames so long audio files don't block the main thread.
 *
 * @param {AudioBuffer} audioBuffer  Mono or stereo (channels mixed down).
 * @param {object} [opts]
 * @param {number} [opts.fftSize=1024]   FFT bin count (must be power of 2).
 * @param {number} [opts.hopSize=512]    Frame advance in samples (50 % overlap).
 * @returns {Promise<{ magnitude: Float32Array[], bins: number, frames: number, sampleRate: number }>}
 *   `magnitude[f][t]` is the normalised magnitude (0..1) of frequency bin `f`
 *   at time frame `t`.
 */
export async function compute(audioBuffer, { fftSize = 1024, hopSize = 512 } = {}) {
  // Mix all channels to mono.
  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const samples = new Float32Array(length);
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) samples[i] += channelData[i];
  }
  if (numChannels > 1) {
    for (let i = 0; i < length; i++) samples[i] /= numChannels;
  }

  const fft = new FFT(fftSize);
  const window = hannWindow(fftSize);
  const frame = fft.createComplexArray();           // complex input (real samples at even indices)
  const spectrum = fft.createComplexArray();        // complex output (2 * fftSize)
  const bins = fftSize / 2;
  const frames = Math.max(0, Math.floor((length - fftSize) / hopSize) + 1);

  // magnitude[f][t] — stored as an array of Float32Arrays (one per bin).
  const magnitude = Array.from({ length: bins }, () => new Float32Array(frames));
  let maxMag = 0;

  // Process in chunks so long audio doesn't block the main thread.
  const yieldEvery = _STFT_CHUNK;
  for (let t = 0; t < frames; t++) {
    const offset = t * hopSize;
    // Pack windowed real samples into complex format (real at even, 0 at odd).
    for (let i = 0; i < fftSize; i++) {
      frame[i * 2] = (samples[offset + i] ?? 0) * window[i];
      frame[i * 2 + 1] = 0;
    }
    // Full complex FFT — well-documented, standard bin ordering.
    fft.transform(spectrum, frame);
    // Magnitude of each bin (only the first half = positive frequencies).
    for (let f = 0; f < bins; f++) {
      const re = spectrum[2 * f];
      const im = spectrum[2 * f + 1];
      const mag = Math.sqrt(re * re + im * im) / fftSize;
      magnitude[f][t] = mag;
      if (mag > maxMag) maxMag = mag;
    }
    // Yield to the event loop periodically.
    if ((t + 1) % yieldEvery === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  // Normalise to 0..1 so the colour map is consistent across signals.
  if (maxMag > 0) {
    const inv = 1 / maxMag;
    for (let f = 0; f < bins; f++) {
      const row = magnitude[f];
      for (let t = 0; t < frames; t++) {
        row[t] *= inv;
      }
    }
  }

  return { magnitude, bins, frames, sampleRate: audioBuffer.sampleRate };
}

// ── Colour map ───────────────────────────────────────────────

/** Four-stop gradient: dark → teal → yellow → white.
 *  `t` is 0..1 (normalised magnitude). Returns [r, g, b] 0..255. */
function colourMap(t) {
  // Clamp.
  t = Math.max(0, Math.min(1, t));
  // Stops: [position, r, g, b]
  const stops = _COLOUR_STOPS;
  // Find the two stops bracketing t.
  let i = 0;
  while (i < stops.length - 2 && stops[i + 1][0] < t) i++;
  const [p0, r0, g0, b0] = stops[i];
  const [p1, r1, g1, b1] = stops[i + 1];
  const f = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
  return [
    Math.round(r0 + (r1 - r0) * f),
    Math.round(g0 + (g1 - g0) * f),
    Math.round(b0 + (b1 - b0) * f),
  ];
}

/** Colour stops (module-level so the LUT builder can share them). */
const _COLOUR_STOPS = [
  [0.00, 8, 12, 20],      // near-black
  [0.35, 0, 140, 130],     // teal
  [0.70, 220, 210, 60],    // yellow
  [1.00, 255, 255, 255],   // white
];

/** Pre-built 256-entry colour LUT (flat Uint8Array: r,g,b × 256).
 *  Eliminates per-pixel function calls and array allocations during render. */
const _COLOUR_LUT = new Uint8Array(256 * 3);
(function _buildLUT() {
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const stops = _COLOUR_STOPS;
    let j = 0;
    while (j < stops.length - 2 && stops[j + 1][0] < t) j++;
    const [p0, r0, g0, b0] = stops[j];
    const [p1, r1, g1, b1] = stops[j + 1];
    const f = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
    const off = i * 3;
    _COLOUR_LUT[off]     = Math.round(r0 + (r1 - r0) * f);
    _COLOUR_LUT[off + 1] = Math.round(g0 + (g1 - g0) * f);
    _COLOUR_LUT[off + 2] = Math.round(b0 + (b1 - b0) * f);
  }
})();

/**
 * Render a magnitude matrix to an ImageData using the fast LUT path.
 * Used by ProcessingScreen to pre-render spectrograms once for the blend.
 *
 * @param {{ magnitude: Float32Array[], frames: number, bins: number }} result
 * @param {number} gain
 * @param {number} contrast
 * @returns {ImageData}
 */
export function renderToImageData(result, gain, contrast) {
  const { magnitude, frames, bins } = result;
  const visibleBins = bins;
  // Use an OffscreenCanvas if available, otherwise fall back to a temporary one.
  const cvs = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(frames, visibleBins)
    : document.createElement('canvas');
  cvs.width = frames;
  cvs.height = visibleBins;
  const ctx = cvs.getContext('2d');
  const imageData = ctx.createImageData(frames, visibleBins);
  const data = imageData.data;
  const lut = _COLOUR_LUT;

  for (let t = 0; t < frames; t++) {
    for (let f = 0; f < visibleBins; f++) {
      let v = magnitude[f][t] * gain;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      if (contrast !== 1) v = Math.pow(v, contrast);
      const lutIdx = (v * 255 + 0.5) | 0;  // round to nearest 0..255
      const lutOff = lutIdx * 3;
      const y = visibleBins - 1 - f;
      const idx = (y * frames + t) * 4;
      data[idx]     = lut[lutOff];
      data[idx + 1] = lut[lutOff + 1];
      data[idx + 2] = lut[lutOff + 2];
      data[idx + 3] = 255;
    }
  }
  return imageData;
}

/**
 * Fast blend between two pre-rendered ImageData objects. Copies revealed
 * columns from `newData` into a copy of `oldData` and writes to the canvas.
 * No per-pixel colour computation — just memory copies.
 *
 * Pass `outBuf` and `outImage` to reuse pre-allocated buffers across frames,
 * eliminating ~4 MB of per-frame garbage at 60 fps.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {ImageData} oldData  Pre-rendered old spectrogram.
 * @param {ImageData} newData  Pre-rendered new spectrogram (same dimensions).
 * @param {number} progress    0..1
 * @param {number[]} revealOrder  Column indices in reveal order.
 * @param {Uint8Array} revealed   Reusable scratch array (length = total columns).
 * @param {Uint8ClampedArray} [outBuf]    Reusable output pixel buffer (length = width×height×4).
 * @param {ImageData} [outImage]          Reusable ImageData wrapping outBuf.
 * @returns {ImageData} The ImageData written to the canvas (== outImage when reused).
 */
export function blendFromImageData(canvas, oldData, newData, progress, revealOrder, revealed, outBuf, outImage) {
  const total = oldData.width;
  const height = oldData.height;

  // Set canvas dimensions (no-op if already correct).
  if (canvas.width !== total || canvas.height !== height) {
    canvas.width = total;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');

  // Reuse caller-provided buffers, or allocate (and the caller can cache
  // them for subsequent frames to avoid GC pressure).
  const out = (outBuf && outBuf.length === oldData.data.length)
    ? outBuf
    : new Uint8ClampedArray(oldData.data);
  const img = (outImage && outImage.width === total && outImage.height === height)
    ? outImage
    : new ImageData(out, total, height);

  // Copy old data into the output buffer (skip if the caller passed the
  // same buffer and will overwrite it column-by-column below).
  if (out !== oldData.data) {
    out.set(oldData.data);
  }

  // Determine how many columns to reveal at this progress.
  const revealCount = Math.min(total, (progress * total) | 0);

  // Clear only the slots we'll use (reuse the scratch array).
  for (let i = 0; i < revealCount; i++) revealed[revealOrder[i]] = 1;

  if (revealCount > 0) {
    const src = newData.data;
    for (let t = 0; t < total; t++) {
      if (!revealed[t]) continue;
      for (let y = 0; y < height; y++) {
        const si = (y * total + t) * 4;
        out[si]     = src[si];
        out[si + 1] = src[si + 1];
        out[si + 2] = src[si + 2];
        out[si + 3] = 255;
      }
    }
  }

  // Clear the revealed slots for next frame.
  for (let i = 0; i < revealCount; i++) revealed[revealOrder[i]] = 0;

  ctx.putImageData(img, 0, 0);
  return img;
}

// ─ Canvas rendering ─────────────────────────────────────────

/**
 * Render a magnitude matrix to a canvas. Each column is one time frame,
 * each row one frequency bin (low frequencies at the bottom, like a
 * conventional spectrogram).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ magnitude: Float32Array[], bins: number, frames: number }} result
 *   The object returned by `compute()`.
 * @param {object} [opts]
 * @param {function} [opts.colormap]  Optional custom colour map
 *   `(t: 0..1) => [r, g, b]`.
 * @param {number} [opts.gain=1]      Brightness multiplier (0.5..5).
 * @param {number} [opts.contrast=1]  Power curve exponent (0.2..3).
 *   < 1 brightens (compresses darks), > 1 darkens (expands darks).
 */
export function render(canvas, result, { colormap, gain = 1, contrast = 1 } = {}) {
  const { magnitude, bins, frames } = result;
  if (!frames || !bins) return;

  const visibleBins = bins;

  canvas.width = frames;
  canvas.height = visibleBins;
  const ctx = canvas.getContext('2d');

  // Fast path: when no custom colormap is given, use the pre-built LUT.
  if (!colormap) {
    const imageData = ctx.createImageData(frames, visibleBins);
    const data = imageData.data;
    const lut = _COLOUR_LUT;
    for (let t = 0; t < frames; t++) {
      for (let f = 0; f < visibleBins; f++) {
        let v = magnitude[f][t] * gain;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        if (contrast !== 1) v = Math.pow(v, contrast);
        const lutIdx = (v * 255 + 0.5) | 0;
        const lutOff = lutIdx * 3;
        const y = visibleBins - 1 - f;
        const idx = (y * frames + t) * 4;
        data[idx]     = lut[lutOff];
        data[idx + 1] = lut[lutOff + 1];
        data[idx + 2] = lut[lutOff + 2];
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return;
  }

  // Slow path: custom colormap function.
  const imageData = ctx.createImageData(frames, visibleBins);
  const data = imageData.data;
  for (let t = 0; t < frames; t++) {
    for (let f = 0; f < visibleBins; f++) {
      let v = magnitude[f][t] * gain;
      v = Math.max(0, Math.min(1, v));
      if (contrast !== 1) v = Math.pow(v, contrast);
      const y = visibleBins - 1 - f;
      const idx = (y * frames + t) * 4;
      const [r, g, b] = colormap(v);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// ── Blend rendering (processing transition) ──────────────────

/**
 * Render a left-to-right blend from an old spectrogram to a new one.
 * Columns marked true in `revealOrder` show the NEW result; the rest
 * show the OLD result. As `progress` (0→1) advances, more columns flip,
 * producing a randomised-burst reveal — like a real program's progress.
 *
 * Both results may have different frame counts (different audio lengths);
 * the new spectrogram is scaled to the old canvas's width via an
 * offscreen canvas so the column mapping is 1-to-1 at the display size.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} oldResult   Result from `compute()` (current level).
 * @param {object} newResult   Result from `compute()` (target level).
 * @param {number} progress    0..1 — fraction of columns revealed.
 * @param {boolean[]} revealOrder  length = oldResult.frames; true = new.
 * @param {object} [opts]      Same viz opts as `render()`.
 */
export function renderBlend(canvas, oldResult, newResult, progress, revealOrder, opts = {}) {
  if (!oldResult || !newResult || !oldResult.frames || !newResult.frames) return;

  const { magnitude: oldMag, bins: oldBins, frames: oldFrames } = oldResult;
  const { magnitude: newMag, bins: newBins, frames: newFrames } = newResult;
  const { colormap = colourMap, gain = 1, contrast = 1 } = opts;

  const oldVisibleBins = oldBins;
  const newVisibleBins = newBins;

  // Pre-render both spectrograms to offscreen canvases at native size.
  const oldCvs = document.createElement('canvas');
  oldCvs.width = oldFrames;
  oldCvs.height = oldVisibleBins;
  _renderToCanvas(oldCvs, oldMag, oldFrames, oldVisibleBins, colormap, gain, contrast);

  const newCvs = document.createElement('canvas');
  newCvs.width = newFrames;
  newCvs.height = newVisibleBins;
  _renderToCanvas(newCvs, newMag, newFrames, newVisibleBins, colormap, gain, contrast);

  // Scale the new canvas to the old canvas's dimensions so column copies
  // map 1-to-1 regardless of differing audio lengths.
  let scaledNew = newCvs;
  if (newFrames !== oldFrames || newVisibleBins !== oldVisibleBins) {
    scaledNew = document.createElement('canvas');
    scaledNew.width = oldFrames;
    scaledNew.height = oldVisibleBins;
    const sCtx = scaledNew.getContext('2d');
    sCtx.imageSmoothingEnabled = true;
    sCtx.drawImage(newCvs, 0, 0, oldFrames, oldVisibleBins);
  }

  // Set the main canvas to the old spectrogram's dimensions.
  canvas.width = oldFrames;
  canvas.height = oldVisibleBins;
  const ctx = canvas.getContext('2d');

  // Start with the old spectrogram as the base.
  ctx.drawImage(oldCvs, 0, 0);

  // Determine how many columns to reveal at this progress.
  const total = oldFrames;
  const revealCount = Math.min(total, Math.floor(progress * total));

  if (revealCount > 0 && scaledNew) {
    const oldData = ctx.getImageData(0, 0, oldFrames, oldVisibleBins);
    const newData = scaledNew.getContext('2d').getImageData(0, 0, oldFrames, oldVisibleBins);

    // Build a column bitmask from the reveal order.
    const revealed = new Uint8Array(total);
    for (let i = 0; i < revealCount; i++) revealed[revealOrder[i]] = 1;

    // Copy revealed columns from the new spectrogram.
    for (let t = 0; t < total; t++) {
      if (!revealed[t]) continue;
      for (let y = 0; y < oldVisibleBins; y++) {
        const si = (y * total + t) * 4;
        oldData.data[si]     = newData.data[si];
        oldData.data[si + 1] = newData.data[si + 1];
        oldData.data[si + 2] = newData.data[si + 2];
        oldData.data[si + 3] = 255;
      }
    }
    ctx.putImageData(oldData, 0, 0);
  }
}

/** Render a magnitude matrix to an offscreen canvas (internal helper). */
function _renderToCanvas(canvas, magnitude, frames, visibleBins, colormap, gain, contrast) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(frames, visibleBins);
  const data = imageData.data;
  for (let t = 0; t < frames; t++) {
    for (let f = 0; f < visibleBins; f++) {
      let v = magnitude[f][t] * gain;
      v = Math.max(0, Math.min(1, v));
      if (contrast !== 1) v = Math.pow(v, contrast);
      const y = visibleBins - 1 - f;
      const idx = (y * frames + t) * 4;
      const [r, g, b] = colormap(v);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}
