// ─────────────────────────────────────────────
// RagnoSounds  –  cutting and making Ragno's sounds (pure)
// ─────────────────────────────────────────────
// The recordings he uses are longer than the moments he needs:
//
//   • the spider call is 58 s of chirps — soft clusters, then a few loud
//     bursts. findBursts() cuts it into its separate sounds at load, so
//     outside he can make one soft chirp at a time (blended in under the
//     wind) and, rarely, a loud one pitched down: the lowered screech.
//   • the death screen's attack has a quiet lead-in and a long tail;
//     loudSpan() finds the loud part, which is all that plays.
//
//   • the vent recording (sfx:ragno-vents) is 12.8 s of thuds and creaks in a
//     duct. DUCT_CRAWL cuts it by hand: the first thud and the layers after
//     it. DuctCrawl says when each plays: a skitter of footfalls with now
//     and then a pause (some the thud, the rest other knocks and creaks),
//     and more landing over them at random, sometimes two at once.
// ─────────────────────────────────────────────

const dB = v => 20 * Math.log10(Math.max(v, 1e-9));

/** RMS of each `window`-second block, in dB. */
function envelope(samples, sampleRate, window) {
  const n = Math.max(1, Math.round(window * sampleRate));
  const out = new Float32Array(Math.ceil(samples.length / n));
  for (let b = 0; b < out.length; b++) {
    let sum = 0;
    const end = Math.min(samples.length, (b + 1) * n);
    for (let i = b * n; i < end; i++) sum += samples[i] * samples[i];
    out[b] = dB(Math.sqrt(sum / Math.max(end - b * n, 1)));
  }
  return { env: out, n };
}

/**
 * The separate sounds in a clip: { start, end (seconds), peak (dB) } for
 * every run louder than `threshold` dB, short gaps inside one bridged.
 * @param {Float32Array} samples  One channel.
 */
export function findBursts(samples, sampleRate, { threshold = -38, window = 0.02, gap = 0.12, min = 0.08 } = {}) {
  const { env, n } = envelope(samples, sampleRate, window);
  const step = n / sampleRate;
  const out = [];
  let cur = null, quietFor = 0;
  for (let b = 0; b < env.length; b++) {
    const t = b * step;
    if (env[b] >= threshold) {
      if (!cur) cur = { start: t, end: t + step, peak: env[b] };
      cur.end = t + step;
      cur.peak = Math.max(cur.peak, env[b]);
      quietFor = 0;
    } else if (cur) {
      quietFor += step;
      if (quietFor > gap) {
        if (cur.end - cur.start >= min) out.push(cur);
        cur = null;
      }
    }
  }
  if (cur && cur.end - cur.start >= min) out.push(cur);
  return out;
}

/**
 * [start, end] seconds of the loud part of a clip: from the first block
 * louder than `threshold` dB to the last. The whole clip if none is.
 */
export function loudSpan(samples, sampleRate, threshold = -30, window = 0.02) {
  const { env, n } = envelope(samples, sampleRate, window);
  const step = n / sampleRate;
  let first = -1, last = -1;
  for (let b = 0; b < env.length; b++) {
    if (env[b] < threshold) continue;
    if (first < 0) first = b;
    last = b;
  }
  if (first < 0) return [0, samples.length / sampleRate];
  return [first * step, Math.min((last + 1) * step, samples.length / sampleRate)];
}

/** The walking loop's playback rate for a body moving at `speed` m/s: the
 *  recording sounds like a brisk walk (`clipSpeed`); a creep slows it, a
 *  run quickens it, within limits that still sound like legs. */
export function walkRate(speed, { clipSpeed = 2.2, min = 0.6, max = 1.8 } = {}) {
  if (speed < 0.05) return 0;
  return Math.min(Math.max(speed / clipSpeed, min), max);
}

/**
 * The vent recording, cut: each clip is [start, length, gain] in seconds,
 * gain a trim on its own level. The step is the first thud, the loudest
 * thing in the file (10 dB over the rest), so it plays well under it; the
 * faint layers are lifted halfway toward the loud ones. The 0.13 s blip at
 * 9.3 s is left out: −38 dB, next to nothing.
 */
export const DUCT_CRAWL = {
  clips: {
    step: [0, 0.56, 0.35],
    layers: [
      [0.98, 0.42, 0.8], [1.55, 0.6, 1.1], [3.36, 0.98, 1], [4.52, 0.62, 1],
      [5.46, 0.34, 1.05], [5.89, 0.28, 1.5], [7.17, 0.54, 1.4], [8.03, 0.9, 1.6],
      [10.09, 0.53, 1.4], [10.91, 0.3, 1.65], [11.66, 0.42, 1.2], [12.17, 0.38, 1.2],
    ],
  },
  /** Seconds between steps; now and then (`pauseChance`) a pause instead. */
  stepEvery: [0.22, 0.42],
  pauseChance: 0.15,
  pause: [0.6, 1.1],
  /** Of the footfalls, the share that are the thud; the rest are one of the
   *  layers at `footfall` of its level, so the steps don't repeat. Each thud
   *  is `stepVary` quieter at most, at random. */
  thudChance: 0.4,
  footfall: 0.7,
  stepVary: 0.35,
  /** Seconds between layers; `doubleChance` of them come two at once. */
  layerEvery: [0.3, 0.85],
  doubleChance: 0.35,
  /** ± cents each is pitched. */
  detune: { step: 150, layer: 250 },
  /** Voices to play them on: steps and layers overlap. */
  voices: 5,
};

/**
 * When each piece of the vent recording plays while he is in a duct
 * (pure: the caller plays them). `start()` as he goes in; `update(dt)`
 * returns the cues due this frame, each `{ clip, layer, gain, detune }`:
 * `layer` false for a footfall, whichever clip it is.
 * The cues are reused: read them before the next update.
 */
export class DuctCrawl {
  constructor(rand = Math.random, opts = DUCT_CRAWL) {
    this.rand = rand;
    this.opts = opts;
    this._cues = [];
    this._pool = [{}, {}, {}];
    this._last = -1;
    this.start();
  }

  start() {
    this._step = 0;
    this._first = true;
    this._layer = this._between(this.opts.layerEvery) * 0.5;
  }

  update(dt) {
    const o = this.opts;
    this._cues.length = 0;
    this._step -= dt;
    if (this._step <= 0) {
      if (this._first || this.rand() < o.thudChance) this._cue(o.clips.step, false, 1 - o.stepVary * this.rand());
      else this._cue(this._pickLayer(), false, o.footfall);
      this._first = false;
      this._step += this.rand() < o.pauseChance ? this._between(o.pause) : this._between(o.stepEvery);
    }
    this._layer -= dt;
    if (this._layer <= 0) {
      this._cue(this._pickLayer(), true);
      if (this.rand() < o.doubleChance) this._cue(this._pickLayer(), true);
      this._layer += this._between(o.layerEvery);
    }
    return this._cues;
  }

  _between([lo, hi]) {
    return lo + (hi - lo) * this.rand();
  }

  /** Any layer but the last one played. */
  _pickLayer() {
    const n = this.opts.clips.layers.length;
    const first = this._last < 0;
    let i = Math.floor(this.rand() * (first ? n : n - 1));
    if (!first && i >= this._last) i++;
    this._last = i;
    return this.opts.clips.layers[i];
  }

  _cue(clip, layer, trim = 1) {
    const c = this._pool[this._cues.length];
    const spread = layer ? this.opts.detune.layer : this.opts.detune.step;
    c.clip = clip;
    c.layer = layer;
    c.gain = clip[2] * trim;
    c.detune = Math.round((this.rand() * 2 - 1) * spread);
    this._cues.push(c);
  }
}

/**
 * How loud the crawl is, 0 … 1, `t` seconds into a run through the duct of
 * `total` seconds: from `floor` it swells over `fadeIn` as he climbs in, and
 * dies back to it over the last `fadeOut` as he climbs out, so the sound is
 * never cut in or out (smoothstep both ways).
 */
export function ductEnvelope(t, total, { fadeIn, fadeOut, floor }) {
  const ease = x => {
    const k = Math.min(Math.max(x, 0), 1);
    return k * k * (3 - 2 * k);
  };
  const k = Math.min(ease(t / fadeIn), ease((total - t) / fadeOut));
  return floor + (1 - floor) * k;
}
