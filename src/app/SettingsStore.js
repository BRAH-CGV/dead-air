// ─────────────────────────────────────────────
// SettingsStore  –  the player's settings: schema, validation, storage
// ─────────────────────────────────────────────
// One versioned JSON blob in localStorage. Every read and write is wrapped:
// storage can be blocked (private windows, cleared site data), full, or hold
// a hand-edited mess, and none of that may stop the game. Whatever loads is
// validated against SCHEMA — numbers clamped and snapped to their step, bad
// enum values and unknown keys dropped — so a stale save can't crash it.
//
// Adding a setting is one SCHEMA entry plus a line in applySettings. A
// volume slider for the sound owner would be:
//   volume: { tab: 'game', type: 'number', label: 'Volume', min: 0, max: 1, step: 0.05, default: 0.8, format: pct },
// ─────────────────────────────────────────────

import { REBINDABLE, isReserved } from './keyNames.js';

export const SETTINGS_KEY = 'dead-air.settings.v1';

export const TABS = [
  { id: 'game',      label: 'GAME' },
  { id: 'controls',  label: 'CONTROLS' },
  { id: 'video',     label: 'VIDEO' },
];

const times = (v) => `${v.toFixed(2)}×`;

/** Every setting, in display order within its tab. `default` may be a
 *  function of the constructor's `defaults` (the key binds). Dev tools are
 *  not a setting: they follow the build (App). */
export const SCHEMA = {
  crouchMode:     { tab: 'game', type: 'enum', label: 'Crouch', default: 'toggle',
                    options: [{ value: 'toggle', label: 'TOGGLE' }, { value: 'hold', label: 'HOLD' }] },
  showFps:        { tab: 'game', type: 'bool', label: 'Show FPS', default: false },

  sensitivity:    { tab: 'controls', type: 'number', label: 'Sensitivity', min: 0.1, max: 3, step: 0.05, default: 1, format: times },
  invertY:        { tab: 'controls', type: 'bool', label: 'Invert Y', default: false },
  smoothing:      { tab: 'controls', type: 'number', label: 'Smoothing', min: 0, max: 0.8, step: 0.05, default: 0.2, format: (v) => v.toFixed(2) },
  keyBinds:       { tab: 'controls', type: 'binds', label: 'Key binds', default: (d) => ({ ...d.keyBinds }) },

  fov:            { tab: 'video', type: 'number', label: 'Field of view', min: 60, max: 100, step: 1, default: 75, format: (v) => `${v}°` },
  brightness:     { tab: 'video', type: 'number', label: 'Brightness', min: 0.6, max: 1.6, step: 0.05, default: 1, format: times },
  // Never below 450: the sky dome is a 400 m sphere riding the camera
  // (MarsSky DEFAULT_RADIUS) — a far plane inside it clips the sky to black.
  renderDistance: { tab: 'video', type: 'number', label: 'Render distance', min: 450, max: 1000, step: 10, default: 1000, format: (v) => `${v} m` },
  shadows:        { tab: 'video', type: 'enum', label: 'Shadows', default: 'high',
                    options: [{ value: 'off', label: 'OFF' }, { value: 'low', label: 'LOW' }, { value: 'high', label: 'HIGH' }] },
};

export class SettingsStore {
  /**
   * @param {object} opts
   * @param {Storage|null} [opts.storage]  localStorage, or a fake
   * @param {{ keyBinds: Record<string, string> }} opts.defaults
   */
  constructor({ storage = null, defaults }) {
    this.storage = storage;
    this._defaults = defaults;
    this._listeners = new Set();
    this._values = this._load();
  }

  /** A copy of every current value. */
  get values() {
    return { ...this._values, keyBinds: { ...this._values.keyBinds } };
  }

  /** The default for one key. */
  defaultOf(key) {
    const d = SCHEMA[key].default;
    return typeof d === 'function' ? d(this._defaults) : d;
  }

  /** Change one setting (validated), save, and tell listeners. */
  set(key, value) {
    if (!SCHEMA[key] || key === 'keyBinds') return;
    const next = this._validate(key, value);
    if (next === this._values[key]) return;
    this._values[key] = next;
    this._commit([key]);
  }

  /** Merge rebinds into the key binds (see keyNames.rebind). */
  setBinds(changes) {
    const next = this._validBinds({ ...this._values.keyBinds, ...changes });
    this._values.keyBinds = next;
    this._commit(['keyBinds']);
  }

  /** Put one tab back to its defaults. */
  resetTab(tab) {
    const keys = Object.keys(SCHEMA).filter(k => SCHEMA[k].tab === tab);
    for (const key of keys) this._values[key] = this.defaultOf(key);
    this._commit(keys);
  }

  /** Subscribe: `listener(values, changedKeys)`. @returns {() => void} unsubscribe */
  onChange(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  // ── Internals ─────────────────────────────

  _load() {
    let saved = {};
    try {
      const raw = this.storage?.getItem(SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed;
    } catch { /* blocked or corrupt: defaults */ }

    const values = {};
    for (const key of Object.keys(SCHEMA)) {
      values[key] = key in saved ? this._validate(key, saved[key]) : this.defaultOf(key);
    }
    return values;
  }

  _commit(keys) {
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(this._values));
    } catch { /* full or blocked: keep playing on the in-memory values */ }
    const values = this.values;
    for (const listener of [...this._listeners]) listener(values, keys);
  }

  /** A valid value for `key`: `value` if it passes, else the default. */
  _validate(key, value) {
    const spec = SCHEMA[key];
    const fallback = this.defaultOf(key);
    switch (spec.type) {
      case 'number': {
        if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
        const clamped = Math.min(spec.max, Math.max(spec.min, value));
        const snapped = spec.min + Math.round((clamped - spec.min) / spec.step) * spec.step;
        return Number(Math.min(spec.max, snapped).toFixed(6));
      }
      case 'bool':
        return typeof value === 'boolean' ? value : fallback;
      case 'enum':
        return spec.options.some(o => o.value === value) ? value : fallback;
      case 'binds':
        return this._validBinds(value);
      default:
        return fallback;
    }
  }

  /** Rebindable actions only, each a plain code, none reserved, no two the
   *  same. Anything else and the whole set falls back — half a broken
   *  layout is worse than the defaults. Missing actions take their default
   *  (a save from before an action existed). */
  _validBinds(value) {
    const defaults = { ...this._defaults.keyBinds };
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
    const binds = {};
    for (const action of REBINDABLE) {
      const code = action in value ? value[action] : defaults[action];
      if (typeof code !== 'string' || !/^[A-Za-z0-9]+$/.test(code) || isReserved(code)) return defaults;
      binds[action] = code;
    }
    if (new Set(Object.values(binds)).size !== REBINDABLE.length) return defaults;
    return binds;
  }
}
