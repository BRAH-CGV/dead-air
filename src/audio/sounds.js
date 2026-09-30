// ─────────────────────────────────────────────
// sounds  –  the recipe for every sound in public/assets/audio/
// ─────────────────────────────────────────────
// Each key matches a manifest entry, and its file is
// assets/audio/<key stem>.wav. `node scripts/make-sounds.mjs` renders them
// all; change a recipe, re-run it, and the file changes with it.
//
//   amb:*  loops — room tones, machines, the threats' breathing and hum.
//          They wrap seamlessly (see synth.js) and the game only turns their
//          volume and pitch.
//   sfx:*  one-shots — they start on the event and end in silence.
//
// Every file is written at the same peak (0.9); how loud each plays is the
// game's call (AudioSystem, SoundCues, BaseScene), not the file's.
// ─────────────────────────────────────────────

import {
  SAMPLE_RATE, rng, samples, loopFreq, white, pink, brown, osc, sine, biquad, lowpass, highpass,
  bandpass, envelope, decay, mul, mix, layers, softClip, normalize, seamless, settled,
} from './synth.js';

const TAU = 2 * Math.PI;
const PEAK = 0.9;

/** Noise beds: filter warm-up thrown away, then folded into a loop. */
const WARM = samples(1);
const FADE = samples(0.5);

/**
 * A seamless noise loop of `n` samples. `make(len, rand)` builds the raw
 * noise; `shape(x, n)` (optional) applies anything periodic in `n`, such as
 * gusts or a motor's pulse.
 */
function bed(n, seed, make, shape) {
  let x = make(n + FADE + WARM, rng(seed)).slice(WARM);
  if (shape) x = shape(x, n);
  return seamless(x, FADE);
}

/** 1 + depth·sin, `cycles` whole turns every `period` samples: loops cleanly. */
function wobble(len, period, cycles, depth, phase = 0) {
  const w = new Float32Array(len);
  for (let i = 0; i < len; i++) w[i] = 1 + depth * Math.sin(TAU * cycles * i / period + phase);
  return w;
}

/** Tones at pitches rounded to fit the loop: [[freq, gain, shape?], …]. */
function chord(n, seconds, partials) {
  const out = new Float32Array(n);
  for (const [f, g, shape = 'sine'] of partials) mix(out, osc(n, loopFreq(f, seconds), shape), g);
  return out;
}

/** Fades `x` to silence between `from` and `to` seconds, in place. */
function fadeOut(x, from, to) {
  const e = envelope(x.length, [[0, 1], [from, 1], [to, 0]]);
  for (let i = 0; i < x.length; i++) x[i] *= e[i];
  return x;
}

/** A short burst of noise, `ms` long, for the attack of a hit. */
function burst(n, rand, ms) {
  return mul(white(n, rand), envelope(n, [[0, 1], [ms / 1000, 0]]));
}

/** A decaying sine partial: sin(f) · exp(-t/tau), gain `g`. */
function ring(n, f, tau, g = 1) {
  return mul(mul(sine(n, f), decay(n, tau)), g);
}

/** A falling-pitch thump (kick-drum style): body of a clunk or a tap. */
function thud(n, from, to, tau) {
  const drop = samples(tau * 2);
  return mul(osc(n, i => to + (from - to) * Math.exp(-i / drop)), decay(n, tau));
}

const loop = (seconds, render) => ({ seconds, loop: true, render });
const shot = (seconds, render) => ({ seconds, loop: false, render });

export const SOUNDS = {
  // ── Rooms ──────────────────────────────────
  // Quiet room tone: a floor rumble, air through the vents, a mains hum
  // and the computer's fan.
  'amb:office': loop(6, n => layers(
    [bed(n, 11, (len, r) => layers(
      [lowpass(brown(len, r), 180), 1],
      [lowpass(highpass(pink(len, r), 300), 1500), 0.35],
      [bandpass(white(len, r), 420, 2), 0.08],
    )), 1],
    [chord(n, 6, [[60, 0.035], [120, 0.02], [180, 0.006]]), 1],
  )),

  // The racks: a thick fan roar with a blade tone and a thin whine on top.
  'amb:server-room': loop(6, n => layers(
    [bed(n, 12, (len, r) => layers(
      [lowpass(pink(len, r), 900), 1],
      [bandpass(white(len, r), 3200, 3), 0.12],
    ), (x, p) => mul(x, wobble(x.length, p, 3, 0.08))), 1],
    [chord(n, 6, [[117, 0.05], [234, 0.03], [351, 0.012], [2900, 0.005]]), 1],
  )),

  // The bunk room: the quietest place in the base, air breathing slowly.
  'amb:quarters': loop(6, n => layers(
    [bed(n, 13, (len, r) => layers(
      [lowpass(brown(len, r), 250), 1],
      [lowpass(pink(len, r), 600), 0.18],
    ), (x, p) => mul(x, wobble(x.length, p, 1, 0.3))), 1],
    [chord(n, 6, [[60, 0.012]]), 1],
  )),

  // Corridors: hollow — the air rings at the tube's own pitches.
  'amb:corridor': loop(6, n => layers(
    [bed(n, 14, (len, r) => {
      const air = pink(len, r);
      return layers(
        [lowpass(brown(len, r), 200), 0.8],
        [bandpass(air, 310, 8), 1.4],
        [bandpass(air, 740, 10), 0.8],
        [bandpass(air, 1480, 12), 0.25],
      );
    }, (x, p) => mul(x, wobble(x.length, p, 2, 0.25, 1))), 1],
  )),

  // The airlock: a pressure hiss and the pumps' slow throb.
  'amb:airlock': loop(6, n => layers(
    [bed(n, 15, (len, r) => layers(
      [lowpass(highpass(white(len, r), 2000), 6000), 0.25],
      [lowpass(brown(len, r), 160), 1],
    )), 1],
    [mul(chord(n, 6, [[45, 0.08], [90, 0.03]]), wobble(n, n, 3, 0.6)), 1],
  )),

  // Outside, through the helmet: wind whose pitch and strength roll in gusts.
  'amb:wind': loop(8, n => {
    const centre = i => 380 + 220 * Math.sin(TAU * 2 * i / n) + 140 * Math.sin(TAU * 3 * i / n + 1);
    return bed(n, 16, (len, r) => layers(
      [biquad(white(len, r), 'bandpass', centre, 1.6), 1],
      [biquad(white(len, r), 'bandpass', i => 2.6 * centre(i), 3), 0.25],
      [lowpass(brown(len, r), 120), 0.8],
    ), (x, p) => mul(x, wobble(x.length, p, 3, 0.45, 0.5)));
  }),

  // ── Machines (positional) ──────────────────
  // A rack up close: mains hum through a transformer plus its fans.
  'amb:server-hum': loop(4, n => layers(
    [settled(n, len => osc(len, loopFreq(120, 4), 'saw'), x => lowpass(x, 600)), 0.4],
    [chord(n, 4, [[60, 0.15]]), 1],
    [bed(n, 21, (len, r) => bandpass(pink(len, r), 500, 1.2)), 0.6],
  )),

  // The generator: a 25 Hz firing thrum and the exhaust noise it pulses.
  'amb:generator': loop(4, n => layers(
    [settled(n, len => osc(len, loopFreq(25, 4), 'saw'), x => lowpass(x, 300)), 0.9],
    [settled(n, len => osc(len, loopFreq(50, 4), 'square'), x => lowpass(x, 400)), 0.3],
    [bed(n, 22, (len, r) => lowpass(pink(len, r), 1400),
      (x, p) => mul(x, wobble(x.length, p, 100, 0.7))), 0.7],
  )),

  // The dish's drive: a motor whine and the gears' chatter.
  'amb:dish-motor': loop(2, n => layers(
    [settled(n, len => osc(len, loopFreq(340, 2), 'saw'), x => lowpass(x, 1800)), 0.5],
    [chord(n, 2, [[680, 0.08], [85, 0.12]]), 1],
    [bed(n, 23, (len, r) => bandpass(white(len, r), 1800, 2),
      (x, p) => mul(x, wobble(x.length, p, 24, 0.8))), 0.5],
  )),

  // ── Scanner and terminal ───────────────────
  'sfx:scan-tick': shot(0.08, n => layers(
    [ring(n, 1800, 0.012), 0.8],
    [mul(highpass(burst(n, rng(31), 3), 3000), decay(n, 0.006)), 0.5],
  )),

  // Lock-on: two rising notes and a bright sweep.
  'sfx:scan-lock': shot(0.7, n => {
    const out = new Float32Array(n);
    mix(out, ring(n, 880, 0.08), 0.8);
    mix(out, ring(n, 1320, 0.18), 0.9, 0.12);
    mix(out, mul(osc(n, i => 600 + 1400 * i / n, 'triangle'), envelope(n, [[0, 0], [0.02, 0.2], [0.3, 0]])), 1);
    return fadeOut(out, 0.55, 0.68);
  }),

  'sfx:save': shot(0.3, n => mul(
    osc(n, i => 660 + 330 * i / n, 'triangle'),
    envelope(n, [[0, 0], [0.01, 1], [0.2, 0.6], [0.28, 0]]),
  )),

  'sfx:delete': shot(0.35, n => mul(
    lowpass(osc(n, i => 440 - 220 * i / n, 'square'), 2000),
    envelope(n, [[0, 0], [0.01, 1], [0.25, 0.5], [0.33, 0]]),
  )),

  // ── Airlock ────────────────────────────────
  'sfx:airlock-hiss': shot(2.6, n => mul(
    lowpass(highpass(white(n, rng(41)), 1500), 7000),
    envelope(n, [[0, 0], [0.1, 1], [1.8, 0.8], [2.5, 0]]),
  )),

  // The door seating: a heavy thump, a metallic ring and the latch.
  'sfx:airlock-clunk': shot(0.8, n => fadeOut(layers(
    [thud(n, 140, 55, 0.12), 1],
    [ring(n, 420, 0.25), 0.25],
    [ring(n, 1130, 0.15), 0.12],
    [lowpass(burst(n, rng(42), 8), 2500), 0.6],
  ), 0.55, 0.78)),

  // ── Shift ──────────────────────────────────
  // 6 AM: three bells, C6 E6 G6, each with a bell's inharmonic overtones.
  'sfx:chime': shot(3, n => {
    const out = new Float32Array(n);
    [1046.5, 1318.5, 1568].forEach((f, k) => {
      const bell = layers([ring(n, f, 0.7), 1], [ring(n, f * 2.76, 0.3), 0.3], [ring(n, f * 5.4, 0.12), 0.12]);
      mix(out, bell, 0.6, 0.35 * k);
    });
    return fadeOut(out, 2.4, 2.95);
  }),

  // Game over: a low, dissonant cluster whose brightness collapses, and a
  // falling shriek over it.
  'sfx:death-sting': shot(2.5, n => {
    const cluster = layers(...[55, 58.3, 82.4, 116.5, 233].map(f => [osc(n, f, 'saw'), 0.3]));
    const closing = biquad(cluster, 'lowpass', i => 300 + 2700 * Math.exp(-i / samples(0.5)), 1.2);
    const shriek = mul(
      osc(n, i => (1200 - 600 * i / n) * (1 + 0.02 * Math.sin(TAU * 6 * i / SAMPLE_RATE))),
      envelope(n, [[0, 0], [0.03, 0.25], [1.2, 0.1], [2, 0]]),
    );
    const out = layers(
      [closing, 1],
      [shriek, 1],
      [lowpass(burst(n, rng(51), 40), 1200), 0.8],
    );
    return mul(softClip(out, 2), envelope(n, [[0, 0], [0.005, 1], [0.4, 0.8], [2.4, 0]]));
  }),

  // ── Power (package F) ──────────────────────
  // A relay slams, sparks crackle, and the mains hum winds down to nothing.
  'sfx:power-cut': shot(1.8, n => {
    const rand = rng(61);
    const sparks = new Float32Array(n);
    for (let i = 0; i < samples(0.35); i++) if (rand() < 0.004) sparks[i] = rand() * 2 - 1;
    const winding = mul(
      osc(n, i => 20 + 100 * Math.exp(-i / samples(0.4)), 'saw'),
      envelope(n, [[0, 0.6], [1.5, 0]]),
    );
    return layers(
      [thud(n, 180, 60, 0.05), 0.9],
      [highpass(sparks, 1500), 1.5],
      [lowpass(winding, 500), 1],
    );
  }),

  // ── Rations ────────────────────────────────
  // The dispenser whirrs, a packet drops into the tray, and it beeps done.
  'sfx:ration': shot(1, n => {
    const out = new Float32Array(n);
    mix(out, mul(lowpass(osc(n, 90, 'saw'), 700), envelope(n, [[0, 0], [0.05, 0.6], [0.45, 0.6], [0.5, 0]])), 1);
    mix(out, thud(n, 160, 80, 0.05), 0.8, 0.58);
    mix(out, lowpass(burst(n, rng(71), 6), 1800), 0.4, 0.58);
    mix(out, mul(sine(samples(0.12), 1320), envelope(samples(0.12), [[0, 0], [0.005, 1], [0.1, 0]])), 0.35, 0.82);
    return fadeOut(out, 0.9, 0.98);
  }),

  // ── Threats ────────────────────────────────
  // The sleep demon: slow wet breaths — a wheezing inhale, a growled exhale.
  // Silent at both ends, so it loops without help.
  'amb:breathing': loop(4.5, n => {
    const rand = rng(81);
    const t = i => i / SAMPLE_RATE;
    const inhale = mul(
      biquad(white(n, rand), 'bandpass', i => 700 + 400 * Math.min(1, t(i) / 1.6), 4),
      envelope(n, [[0, 0], [0.15, 0.2], [0.9, 1], [1.6, 0]]),
    );
    const exhaleEnv = envelope(n, [[0, 0], [2.0, 0], [2.3, 0.8], [3.4, 0.6], [4.2, 0], [4.5, 0]]);
    const exhale = layers(
      [mul(bandpass(pink(n, rand), 450, 2), exhaleEnv), 1.4],
      [mul(lowpass(osc(n, i => 55 + 4 * Math.sin(TAU * 7 * t(i)), 'saw'), 400), exhaleEnv), 0.5],
    );
    return layers([inhale, 1], [exhale, 1]);
  }),

  // A window watcher knocking: three taps on the glass, each a thud of the
  // knuckle and the pane's bright, short ring.
  'sfx:glass-tap': shot(1, n => {
    const out = new Float32Array(n);
    const rand = rng(91);
    [[0, 1, 1], [0.22, 0.8, 1.02], [0.44, 1.1, 0.98]].forEach(([at, g, pitch]) => {
      const tap = layers(
        [ring(n, 1480 * pitch, 0.09), 0.5],
        [ring(n, 2610 * pitch, 0.06), 0.35],
        [ring(n, 4330 * pitch, 0.04), 0.25],
        [highpass(burst(n, rand, 4), 2000), 0.5],
        [thud(n, 260, 180, 0.025), 0.8],
      );
      mix(out, tap, g, at);
    });
    return fadeOut(out, 0.85, 0.98);
  }),

  // The server-room camera: a small servo's whine while it turns …
  'amb:camera-servo': loop(1, n => layers(
    [settled(n, len => osc(len, loopFreq(820, 1), 'triangle'), x => bandpass(x, 1200, 0.8)), 1],
    [chord(n, 1, [[1640, 0.12], [410, 0.2]]), 1],
    [bed(n, 101, (len, r) => bandpass(white(len, r), 2400, 3)), 0.3],
  )),

  // … and the tone it sings as it sees you: two near pitches beating slowly,
  // a sub below. The game raises its pitch with exposure.
  'amb:camera-tone': loop(2, n => {
    const tone = chord(n, 2, [[220, 0.5], [223.5, 0.5], [110, 0.25], [660, 0.08]]);
    return softClip(tone, 1.5);
  }),
};

/** One recipe's samples, at the shared peak. */
export function renderSound(key) {
  const recipe = SOUNDS[key];
  if (!recipe) throw new Error(`No sound recipe for '${key}'`);
  const n = samples(recipe.seconds);
  const x = recipe.render(n);
  if (x.length !== n) throw new Error(`'${key}' rendered ${x.length} samples, not ${n}`);
  return normalize(x, PEAK);
}
