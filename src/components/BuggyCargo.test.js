import { describe, it, expect, beforeEach } from 'vitest';
import { BuggyCargo } from './BuggyCargo.js';
import { Interactable } from './Interactable.js';

describe('BuggyCargo', () => {
  let controller, dock, cargo;
  const box = { isDriveBox: true };
  const label = (state) => {
    controller.state = state;
    cargo.onUpdate(0.016);
    return cargo.promptLabel;
  };

  beforeEach(() => {
    controller = { state: 'playing' };
    dock = {
      requiredCount: 3, collectedCount: 0, depositedBox: null,
      isQuotaMet() { return this.collectedCount >= this.requiredCount; },
    };
    cargo = new BuggyCargo();
    cargo.controller = controller;
    cargo.dock = dock;
  });

  it('is an Interactable, so looking at it shows its label', () => {
    expect(cargo).toBeInstanceOf(Interactable);
  });

  it('takes a drive box in the morning only — never mid-shift', () => {
    controller.state = 'playing';
    expect(cargo.accepts(box)).toBe(false);
    controller.state = 'morning';
    expect(cargo.accepts(box)).toBe(true);
    for (const state of ['gameOver', 'finished', 'idle']) {
      controller.state = state;
      expect(cargo.accepts(box), state).toBe(false);
    }
  });

  it('takes only whole drive boxes, not a loose drive', () => {
    controller.state = 'morning';
    expect(cargo.accepts({ isDrive: true })).toBe(false);
    expect(cargo.accepts(null)).toBe(false);
  });

  it('says during the shift that the drives go in after it', () => {
    expect(label('playing')).toMatch(/after the shift/i);
  });

  it('in the morning, says where the box goes, then that it is short, then that it is loaded', () => {
    expect(label('morning')).toMatch(/drive box/i);
    dock.depositedBox = box;
    dock.collectedCount = 2;
    expect(label('morning')).toMatch(/short/i);
    dock.collectedCount = 3;
    expect(label('morning')).toMatch(/loaded/i);
  });

  it('is only a name after a failed night or the last shift, or before the scene wires it', () => {
    expect(label('gameOver')).toBe('Buggy cargo');
    expect(label('finished')).toBe('Buggy cargo');
    const loose = new BuggyCargo();
    loose.onUpdate(0.016);
    expect(loose.promptLabel).toBe('Buggy cargo');
    expect(loose.accepts(box)).toBe(false);
  });
});
