import { describe, it, expect, afterEach } from 'vitest';
import { withKeys, setInteractKey } from './promptKeys.js';

describe('promptKeys', () => {
  afterEach(() => setInteractKey('E'));

  it('leaves text alone while Interact is E', () => {
    expect(withKeys('[E] Sleep')).toBe('[E] Sleep');
  });

  it('names the bound key in place of [E], leading or embedded', () => {
    setInteractKey('F');
    expect(withKeys('[E] Use Computer')).toBe('[F] Use Computer');
    expect(withKeys('Night failed. [E] to retry')).toBe('Night failed. [F] to retry');
  });

  it('touches nothing else, and tolerates empty text', () => {
    setInteractKey('F');
    expect(withKeys('Sealed')).toBe('Sealed');
    expect(withKeys('')).toBe('');
    expect(withKeys(undefined)).toBe('');
  });

  it('falls back to E for an empty label', () => {
    setInteractKey('');
    expect(withKeys('[E] Sleep')).toBe('[E] Sleep');
  });
});
