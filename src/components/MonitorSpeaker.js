// ─────────────────────────────────────────────
// MonitorSpeaker  –  the security monitor's little speaker
// ─────────────────────────────────────────────
// While a camera is on screen the player hears what it hears — the ears
// (engine.audioListener) are moved onto its lens — and all of it comes out
// of the monitor on the desk: thin, boxy and a touch overdriven.
//
//   listener ─▶ gate ─┬▶ highpass ─▶ lowpass ─▶ peaking ─▶ soft clip ─▶ out
//   clicks (route) ───┘
//   static, servo (route dry) ──────────────────────────────────────▶ out
//
// engage(true, level) sends the listener's whole output through it, at
// `level` × MONITOR.level (the terminal cuts it to 0 under a switch's
// static); engage(false) sends it straight to the ears again. A sound
// routed here (the flash's clicks) is fuzzy too but never gated, so a click
// at a switch is still heard; one routed dry (the static, the servo — fuzzy
// enough already) only skips the listener, so it isn't heard from the lens.
//
// The highpass and lowpass take the low end and the air off (a speaker this
// small has neither); the peak is where its cone rings; the soft clip lifts
// the quiet parts and squashes the loud ones, so it sounds driven hard.
//
// Sounds routed here skip the listener's master volume: a volume setting
// (none yet) should scale `out` too, as it does the listener.
//
// Not a Component: it has no frame. Its owner disposes it.
// ─────────────────────────────────────────────

/** The speaker's voice. Hz unless stated. */
export const MONITOR = {
  /** What the camera hears, against what the player would hear standing
   *  there: well down, it's a small speaker on a desk. */
  level: 0.35,
  highpass: 380,
  lowpass: 3200,
  /** Where the cone rings, and how hard (dB). */
  presence: { frequency: 1600, gain: 5, Q: 1 },
  /** How hard the soft clip is driven: 1 is barely, 4 is fuzz. */
  drive: 2.5,
  /** Time constant (s) of the gate's ramps: no click on a cut. */
  ramp: 0.01,
};

/**
 * A soft clip, -1 … 1: tanh, scaled to reach ±1 at the ends.
 * @param {number} [samples=1025]
 * @param {number} [drive=MONITOR.drive]
 * @returns {Float32Array}
 */
export function monitorCurve(samples = 1025, drive = MONITOR.drive) {
  const curve = new Float32Array(samples);
  const norm = Math.tanh(drive);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

export class MonitorSpeaker {
  /** @param {import('three').AudioListener|null} listener */
  constructor(listener) {
    this.listener = listener ?? null;
    /** Whether the listener is heard through it. */
    this.engaged = false;
    /** The fuzz: where a routed sound is connected. Null without audio. */
    this.input = null;
    /** Straight out of the monitor: where a dry sound is connected. */
    this.dry = null;
    this._gate = null;
    this._level = null;
    this._nodes = [];
    const context = listener?.context;
    if (!context) return;

    const filter = (type, frequency, Q = Math.SQRT1_2, gain = 0) => {
      const node = context.createBiquadFilter();
      node.type = type;
      node.frequency.value = frequency;
      node.Q.value = Q;
      node.gain.value = gain;
      return node;
    };
    const { presence } = MONITOR;
    const shaper = context.createWaveShaper();
    shaper.curve = monitorCurve();
    shaper.oversample = '2x';
    const out = context.createGain();

    const chain = [
      filter('highpass', MONITOR.highpass),
      filter('lowpass', MONITOR.lowpass),
      filter('peaking', presence.frequency, presence.Q, presence.gain),
      shaper,
      out,
    ];
    for (let i = 1; i < chain.length; i++) chain[i - 1].connect(chain[i]);
    out.connect(context.destination);

    this._gate = context.createGain();
    this._gate.gain.value = 0;
    this._gate.connect(chain[0]);
    this.input = chain[0];
    this.dry = out;
    this._nodes = [this._gate, ...chain];
  }

  /**
   * Hear the listener through the speaker (true), at `level` (0..1) of
   * MONITOR.level — or straight, as normal (false).
   * @param {boolean} on
   * @param {number} [level=1]
   */
  engage(on, level = 1) {
    const { listener } = this;
    if (!this._gate) return;
    if (on !== this.engaged) {
      this.engaged = on;
      listener.gain.disconnect();
      listener.gain.connect(on ? this._gate : listener.context.destination);
    }
    const gain = on ? Math.min(Math.max(level, 0), 1) * MONITOR.level : 0;
    if (gain !== this._level) {
      this._level = gain;
      this._gate.gain.setTargetAtTime(gain, listener.context.currentTime, MONITOR.ramp);
    }
  }

  /**
   * Play `sound` out of the speaker instead of into the listener: fuzzy, or
   * with `dry`, as it is.
   * @template {import('three').Audio|null} T
   * @param {T} sound
   * @param {{ dry?: boolean }} [opts]
   * @returns {T}
   */
  route(sound, { dry = false } = {}) {
    const to = dry ? this.dry : this.input;
    if (!sound?.gain || !to) return sound;
    sound.gain.disconnect();
    sound.gain.connect(to);
    return sound;
  }

  dispose() {
    if (this.engaged) this.engage(false);
    for (const node of this._nodes) {
      try { node.disconnect(); } catch (_) { /* never connected */ }
    }
    this._nodes = [];
    this.input = this.dry = this._gate = null;
  }
}
