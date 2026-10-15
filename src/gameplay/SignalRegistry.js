// ─────────────────────────────────────────────
// SignalRegistry  –  signal file discovery
// ─────────────────────────────────────────────
// Each signal is an audio file in src/assets/signals/. The base file is
// `{name}.<ext>` (level 0) and level variants are `{name}_L{N}.<ext>`.
// Any browser-decodable format works: .wav, .mp3, .ogg, .flac, .m4a, .aac.
//
// Public surface:
//   names          — unique base signal names (the pool SignalManager
//                    shuffles each night)
//   getAudioUrl(name, level) — URL for `{name}_L{level}.<ext>`, falling back
//                    to `{name}.<ext>`, or `''` when nothing matches
//
// For tests the constructor accepts an injected file map:
//   `{ 'deep_hum_0': '/assets/signals/deep_hum.wav', ... }`
// ─────────────────────────────────────────────

/** Strip any supported audio extension from a filename. */
const AUDIO_EXT_RE = /\.(wav|mp3|ogg|flac|m4a|aac|webm)$/i;

/** Parse an audio filename into `{ name, level }`. Level 0 = default. */
function parseFilename(filename) {
  const base = filename.replace(AUDIO_EXT_RE, '');
  const m = /^(.+)_L(\d+)$/.exec(base);
  if (m) return { name: m[1], level: Number(m[2]) };
  return { name: base, level: 0 };
}

/** Discover every audio file shipped in src/assets/signals/ at build time.
 *  With `?url` each module exports the served URL string as `.default`;
 *  no `import: 'default'` — that would double-dereference to undefined. */
const _signalModules = import.meta.glob(
  '../assets/signals/*.{wav,mp3,ogg,flac,m4a,aac,webm}',
  { eager: true, query: '?url' },
);

/** Build the file list from the glob result (keys are relative paths).
 *  Also build a filename → URL lookup so the constructor can resolve
 *  the actual served URL Vite produced at build time. */
const SIGNAL_FILES = Object.keys(_signalModules)
  .map((key) => key.split('/').pop())
  .filter(Boolean);

/** @type {Record<string, string>}  filename → served URL */
const _fileUrls = {};
for (const [key, mod] of Object.entries(_signalModules)) {
  const filename = key.split('/').pop();
  if (filename) _fileUrls[filename] = mod.default ?? mod;
}

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
      // Build URL map from the glob-discovered signal files.
      for (const filename of SIGNAL_FILES) {
        const { name, level } = parseFilename(filename);
        this._urlMap[`${name}_${level}`] = _fileUrls[filename] ?? `assets/signals/${filename}`;
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
   * Tries `{name}_L{level}.<ext>` first, then falls back to `{name}.<ext>`.
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
