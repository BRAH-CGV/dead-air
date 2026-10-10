import { describe, it, expect } from 'vitest';
import { JOURNAL, journalEntry } from './journal.js';

describe('journal', () => {
  it('has an entry for each of the three nights, in order', () => {
    expect(JOURNAL.map(e => e.night)).toEqual([1, 2, 3]);
    for (const entry of JOURNAL) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.body.length).toBeGreaterThan(1);
    }
  });

  it('night 1 teaches the job: the dish, signals, drives, the quota, 6 AM, the bunk', () => {
    const text = journalEntry(1).body.join(' ').toLowerCase();
    for (const word of ['dish', 'signal', 'drive', 'quota', '6', 'bunk']) expect(text, word).toContain(word);
  });

  it('night 2 warns of the storms and the generator', () => {
    const text = journalEntry(2).body.join(' ').toLowerCase();
    for (const word of ['storm', 'generator', 'eyes']) expect(text, word).toContain(word);
  });

  it('night 3 warns of the light in the sky, and to cut the power', () => {
    const text = journalEntry(3).body.join(' ').toLowerCase();
    for (const word of ['light', 'power', 'window']) expect(text, word).toContain(word);
  });

  it('a night past the last reads the last entry; nonsense reads the first', () => {
    expect(journalEntry(9)).toBe(JOURNAL.at(-1));
    expect(journalEntry(0)).toBe(JOURNAL[0]);
    expect(journalEntry(undefined)).toBe(JOURNAL[0]);
  });
});
