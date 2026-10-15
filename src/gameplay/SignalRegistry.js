// ─────────────────────────────────────────────
// SignalRegistry  –  signal file discovery
// ─────────────────────────────────────────────
// Each signal is a .wav file in public/assets/signals/. The base file is
// `{name}.wav` (level 0) and level variants are `{name}_L{N}.wav`.
//
// Public surface:
//   names          — unique base signal names (the pool SignalManager
//                    shuffles each night)
//   getAudioUrl(name, level) — URL for `{name}_L{level}.wav`, falling back
//                    to `{name}.wav`, or `''` when nothing matches
//
// For tests the constructor accepts an injected file map:
//   `{ 'deep_hum_0': '/assets/signals/deep_hum.wav', ... }`
// ─────────────────────────────────────────────

/** Parse a wav filename into `{ name, level }`. Level 0 = default. */
function parseFilename(filename) {
  const base = filename.replace(/\.wav$/i, '');
  const m = /^(.+)_L(\d+)$/.exec(base);
  if (m) return { name: m[1], level: Number(m[2]) };
  return { name: base, level: 0 };
}

/** Every signal file shipped in public/assets/signals/. Add new names
 *  here as .wav files are added to the folder. */
const SIGNAL_FILES = [
  'deep_hum.wav',
  'deep_hum_L2.wav',
  'pulse_beacon.wav',
  'static_burst.wav',
  'tonal_sweep.wav',
  'tonal_sweep_L2.wav',
  'rhythmic_click.wav',
  'ghost_voice.wav',
  'carrier_wave.wav',
  'harmonic_drone.wav',
];

export class SignalRegistry {
  /**
   * @param {Record<string, string>|null} [fileMap]  Injected map for tests.
   *   Keys are `{name}_{level}`, values are URLs.
   */
  constructor(fileMap = null) {
    /** @type {Record<string, string>}  key: `{name}_{level}` → URL */
    this._urlMap = {};
    /** @type {Set<string>}  unique base signal names */
    this._nameSet = new Set();

    if (fileMap) {
      // Test injection: use the provided map directly.
      for (const key of Object.keys(fileMap)) {
        const filename = key.split('/').pop();
        const { name, level } = parseFilename(filename);
        this._urlMap[`${name}_${level}`] = fileMap[key];
        this._nameSet.add(name);
      }
    } else {
      // Build URL map from the known signal file list.
      for (const filename of SIGNAL_FILES) {
        const { name, level } = parseFilename(filename);
        this._urlMap[`${name}_${level}`] = `assets/signals/${filename}`;
        this._nameSet.add(name);
      }
    }
  }

  /** Unique base signal names (e.g. ['deep_hum', 'pulse_beacon', ...]). */
  get names() {
    return [...this._nameSet];
  }

  /**
   * Resolve the audio URL for a signal at a given level.
   * Tries `{name}_L{level}.wav` first, then falls back to `{name}.wav`.
   * Returns `''` when nothing matches.
   * @param {string} name
   * @param {number} [level=0]
   * @returns {string}
   */
  getAudioUrl(name, level = 0) {
    if (level > 0) {
      const levelUrl = this._urlMap[`${name}_${level}`];
      if (levelUrl) return levelUrl;
    }
    return this._urlMap[`${name}_0`] ?? '';
  }
}
