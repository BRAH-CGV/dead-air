import { describe, it, expect } from 'vitest';
import { keyName, isReserved, rebind, REBINDABLE } from './keyNames.js';

describe('keyName', () => {
  it.each([
    ['KeyW', 'W'],
    ['Digit1', '1'],
    ['Space', 'Space'],
    ['ShiftLeft', 'Left Shift'],
    ['ShiftRight', 'Right Shift'],
    ['ControlLeft', 'Left Ctrl'],
    ['AltRight', 'Right Alt'],
    ['ArrowUp', '↑'],
    ['ArrowDown', '↓'],
    ['ArrowLeft', '←'],
    ['ArrowRight', '→'],
    ['Numpad1', 'Num 1'],
    ['Backquote', '`'],
  ])('%s → %s', (code, name) => {
    expect(keyName(code)).toBe(name);
  });

  it('passes unknown codes through unchanged', () => {
    expect(keyName('Tab')).toBe('Tab');
    expect(keyName('IntlBackslash')).toBe('IntlBackslash');
  });

  it('tolerates an empty or missing code', () => {
    expect(keyName('')).toBe('');
    expect(keyName(undefined)).toBe('');
  });
});

describe('isReserved', () => {
  it.each(['Escape', 'Backquote', 'F1', 'F2', 'F4', 'F12', 'KeyQ', 'Enter', 'NumpadEnter'])(
    'always reserves %s',
    (code) => {
      expect(isReserved(code, { devTools: false })).toBe(true);
      expect(isReserved(code, { devTools: true })).toBe(true);
    },
  );

  it.each(['KeyV', 'KeyB', 'KeyN', 'KeyI'])('reserves the debug key %s only while dev tools are on', (code) => {
    expect(isReserved(code, { devTools: true })).toBe(true);
    expect(isReserved(code, { devTools: false })).toBe(false);
  });

  it('leaves ordinary keys free', () => {
    expect(isReserved('KeyJ', { devTools: true })).toBe(false);
    expect(isReserved('Space', { devTools: true })).toBe(false);
  });
});

describe('rebind', () => {
  const defaults = () => ({
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
    jump: 'Space', crouch: 'KeyC', interact: 'KeyE', flashlight: 'KeyF', rotateHeld: 'KeyR',
    debugFly: 'KeyV',
  });

  it('binds a free key to the action', () => {
    const result = rebind(defaults(), 'jump', 'KeyJ');
    expect(result).toEqual({ ok: true, changes: { jump: 'KeyJ' }, swappedWith: null });
  });

  it('swaps when the key already belongs to another action', () => {
    const result = rebind(defaults(), 'jump', 'KeyC');
    expect(result.ok).toBe(true);
    expect(result.changes).toEqual({ jump: 'KeyC', crouch: 'Space' });
    expect(result.swappedWith).toBe('crouch');
  });

  it('does not mutate the binds it was given', () => {
    const binds = defaults();
    rebind(binds, 'jump', 'KeyC');
    expect(binds.jump).toBe('Space');
  });

  it('rejects a reserved key with a reason', () => {
    const result = rebind(defaults(), 'jump', 'KeyQ', { devTools: false });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/reserved/i);
  });

  it('rejects a debug key while dev tools are on, allows it when off', () => {
    expect(rebind(defaults(), 'jump', 'KeyV', { devTools: true }).ok).toBe(false);
    expect(rebind(defaults(), 'jump', 'KeyV', { devTools: false }).ok).toBe(true);
  });

  it('rejects an action that is not rebindable', () => {
    expect(rebind(defaults(), 'debugFly', 'KeyJ').ok).toBe(false);
  });

  it('rebinding to the key it already has is a no-op success', () => {
    expect(rebind(defaults(), 'jump', 'Space')).toEqual({ ok: true, changes: {}, swappedWith: null });
  });

  it('lists the gameplay actions as rebindable', () => {
    expect(REBINDABLE).toEqual(['forward', 'back', 'left', 'right', 'jump', 'crouch', 'interact', 'flashlight', 'rotateHeld']);
  });
});
