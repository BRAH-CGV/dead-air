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
      expect(isReserved(code)).toBe(true);
    },
  );

  // The debug tools moved into the developer console (`, the one key they
  // keep), so their old keys are free for the player.
  it.each(['KeyV', 'KeyB', 'KeyN', 'KeyI', 'KeyU', 'KeyK', 'KeyJ', 'KeyM', 'Comma'])(
    'leaves the old debug key %s free',
    (code) => {
      expect(isReserved(code)).toBe(false);
    },
  );

  it('leaves ordinary keys free', () => {
    expect(isReserved('Space')).toBe(false);
  });
});

describe('rebind', () => {
  const defaults = () => ({
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
    jump: 'Space', crouch: 'KeyC', interact: 'KeyE', flashlight: 'KeyF', rotateHeld: 'KeyR',
    sprint: 'ShiftLeft',
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
    const result = rebind(defaults(), 'jump', 'KeyQ');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/reserved/i);
  });

  it("takes an old debug key, and refuses the console's", () => {
    expect(rebind(defaults(), 'jump', 'KeyV').ok).toBe(true);
    expect(rebind(defaults(), 'jump', 'Backquote').ok).toBe(false);
  });

  it('rejects an action that is not rebindable', () => {
    expect(rebind(defaults(), 'sprint', 'KeyJ').ok).toBe(false);
  });

  it('rebinding to the key it already has is a no-op success', () => {
    expect(rebind(defaults(), 'jump', 'Space')).toEqual({ ok: true, changes: {}, swappedWith: null });
  });

  it('lists the gameplay actions as rebindable', () => {
    expect(REBINDABLE).toEqual(['forward', 'back', 'left', 'right', 'jump', 'crouch', 'interact', 'flashlight', 'rotateHeld']);
  });
});
