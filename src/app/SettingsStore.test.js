import { describe, it, expect, vi } from 'vitest';
import { SettingsStore, SETTINGS_KEY, SCHEMA, TABS } from './SettingsStore.js';

/** A Storage-shaped fake over a Map. */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: vi.fn((k) => (map.has(k) ? map.get(k) : null)),
    setItem: vi.fn((k, v) => { map.set(k, String(v)); }),
  };
}

const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', crouch: 'KeyC', interact: 'KeyE', flashlight: 'KeyF',
};

const make = (storage = memoryStorage(), devTools = false) =>
  new SettingsStore({ storage, defaults: { keyBinds: DEFAULT_BINDS, devTools } });

describe('SettingsStore', () => {
  it('uses the versioned key', () => {
    expect(SETTINGS_KEY).toBe('dead-air.settings.v1');
  });

  it('starts from defaults when storage is empty', () => {
    const s = make();
    expect(s.values).toMatchObject({
      crouchMode: 'toggle', showFps: false, sensitivity: 1, invertY: false, smoothing: 0.2,
      fov: 75, brightness: 1, renderDistance: 1000, renderScale: 1, shadows: 'high', devTools: false,
    });
    expect(s.values.keyBinds).toEqual(DEFAULT_BINDS);
  });

  it('takes the dev-tools default it is given', () => {
    expect(make(memoryStorage(), true).values.devTools).toBe(true);
  });

  it('falls back to defaults when storage throws', () => {
    const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    const s = make(storage);
    expect(s.values.fov).toBe(75);
    expect(() => s.set('fov', 90)).not.toThrow();
    expect(s.values.fov).toBe(90);
  });

  it('falls back to defaults on garbage JSON, or on no storage at all', () => {
    expect(make(memoryStorage({ [SETTINGS_KEY]: '{nope' })).values.fov).toBe(75);
    expect(make(memoryStorage({ [SETTINGS_KEY]: '"a string"' })).values.fov).toBe(75);
    expect(new SettingsStore({ storage: null, defaults: { keyBinds: DEFAULT_BINDS } }).values.fov).toBe(75);
  });

  it('loads a saved value', () => {
    const s = make(memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ fov: 90, shadows: 'low' }) }));
    expect(s.values.fov).toBe(90);
    expect(s.values.shadows).toBe('low');
  });

  it('clamps numbers to their ranges on load and on set', () => {
    const s = make(memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ fov: 500, renderDistance: 10, smoothing: 1 }) }));
    expect(s.values.fov).toBe(100);
    expect(s.values.renderDistance).toBe(450);
    expect(s.values.smoothing).toBe(0.8);
    s.set('sensitivity', -4);
    expect(s.values.sensitivity).toBe(0.1);
  });

  it('rejects non-numbers, bad enum values and non-booleans', () => {
    const s = make(memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({ fov: 'wide', shadows: 'ultra', renderScale: 0.3, invertY: 'yes' }),
    }));
    expect(s.values.fov).toBe(75);
    expect(s.values.shadows).toBe('high');
    expect(s.values.renderScale).toBe(1);
    expect(s.values.invertY).toBe(false);
  });

  it('drops unknown keys', () => {
    const storage = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ fov: 80, volume: 3, __proto__x: 1 }) });
    const s = make(storage);
    expect(s.values).not.toHaveProperty('volume');
    s.set('fov', 81);
    expect(JSON.parse(storage.map.get(SETTINGS_KEY))).not.toHaveProperty('volume');
  });

  it('validates saved key binds: bad codes, reserved keys or duplicates fall back to defaults', () => {
    const load = (keyBinds) => make(memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ keyBinds }) })).values.keyBinds;
    expect(load({ ...DEFAULT_BINDS, jump: 'KeyJ', debugFly: 'KeyZ' })).toEqual({ ...DEFAULT_BINDS, jump: 'KeyJ' });
    expect(load({ ...DEFAULT_BINDS, jump: 'Escape' })).toEqual(DEFAULT_BINDS);
    expect(load({ ...DEFAULT_BINDS, jump: 42 })).toEqual(DEFAULT_BINDS);
    expect(load({ ...DEFAULT_BINDS, jump: 'KeyW' })).toEqual(DEFAULT_BINDS);
    expect(load('nope')).toEqual(DEFAULT_BINDS);
  });

  it('fills in a bind missing from an older save', () => {
    const { flashlight, ...older } = DEFAULT_BINDS;
    const s = make(memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ keyBinds: older }) }));
    expect(s.values.keyBinds.flashlight).toBe(flashlight);
  });

  it('set() persists and notifies with the changed key', () => {
    const storage = memoryStorage();
    const s = make(storage);
    const listener = vi.fn();
    s.onChange(listener);
    s.set('fov', 90);
    expect(JSON.parse(storage.map.get(SETTINGS_KEY)).fov).toBe(90);
    expect(listener).toHaveBeenCalledWith(s.values, ['fov']);
  });

  it('set() of the same value does not notify', () => {
    const s = make();
    const listener = vi.fn();
    s.onChange(listener);
    s.set('fov', 75);
    expect(listener).not.toHaveBeenCalled();
  });

  it('set() ignores unknown keys', () => {
    const s = make();
    s.set('volume', 1);
    expect(s.values).not.toHaveProperty('volume');
  });

  it('values is a copy — editing it changes nothing', () => {
    const s = make();
    s.values.fov = 10;
    s.values.keyBinds.jump = 'KeyX';
    expect(s.values.fov).toBe(75);
    expect(s.values.keyBinds.jump).toBe('Space');
  });

  it('setBinds merges changes into the binds', () => {
    const s = make();
    s.setBinds({ jump: 'KeyC', crouch: 'Space' });
    expect(s.values.keyBinds).toMatchObject({ jump: 'KeyC', crouch: 'Space', forward: 'KeyW' });
  });

  it('resetTab resets only that tab', () => {
    const s = make();
    s.set('fov', 90);
    s.set('shadows', 'off');
    s.set('sensitivity', 2);
    s.resetTab('video');
    expect(s.values.fov).toBe(75);
    expect(s.values.shadows).toBe('high');
    expect(s.values.sensitivity).toBe(2);
  });

  it('resetTab on controls resets the key binds too', () => {
    const s = make();
    s.setBinds({ jump: 'KeyJ' });
    s.resetTab('controls');
    expect(s.values.keyBinds).toEqual(DEFAULT_BINDS);
  });

  it('every schema entry belongs to a known tab', () => {
    const ids = TABS.map(t => t.id);
    for (const [key, spec] of Object.entries(SCHEMA)) expect(ids, key).toContain(spec.tab);
  });

  it('snaps numbers to their step, with no float noise', () => {
    const s = make();
    s.set('sensitivity', 1.2300000001);
    expect(s.values.sensitivity).toBe(1.25);
  });
});
