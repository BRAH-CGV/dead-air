import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Bed } from './Bed.js';
import { Interactable } from './Interactable.js';

describe('Bed', () => {
  let controller, fade, bed;

  beforeEach(() => {
    controller = {
      state: 'playing',
      get canSleep() { return this.state === 'morning'; },
      sleep: vi.fn(() => controller.canSleep),
    };
    // A fade that goes black at once.
    fade = { play: vi.fn(onDark => { onDark(); return true; }) };
    bed = new Bed();
    bed.controller = controller;
    bed.fade = fade;
  });

  const label = (state) => {
    controller.state = state;
    bed.onUpdate(0.016);
    return bed.promptLabel;
  };

  it('is an Interactable, so InteractionSystem picks it up', () => {
    expect(bed).toBeInstanceOf(Interactable);
  });

  it('offers sleep in the morning', () => {
    expect(label('morning')).toBe('[E] Sleep');
  });

  it('says why not while the shift is running', () => {
    expect(label('playing')).toMatch(/6:00 AM/);
    expect(label('playing')).not.toMatch(/\[E\]/);
  });

  it('offers nothing after a failed night or the last shift', () => {
    expect(label('gameOver')).toBe('');
    expect(label('finished')).toBe('');
  });

  it('in the morning, fades out and sleeps while the screen is black', () => {
    controller.state = 'morning';
    bed.onInteract();
    expect(fade.play).toHaveBeenCalledOnce();
    expect(controller.sleep).toHaveBeenCalledOnce();
  });

  it('does nothing during the shift — no fade, no sleep', () => {
    bed.onInteract();
    expect(fade.play).not.toHaveBeenCalled();
    expect(controller.sleep).not.toHaveBeenCalled();
  });

  it('sleeps once however often it is pressed during the fade', () => {
    let goBlack;
    fade.play = vi.fn(onDark => {
      if (goBlack) return false;               // already fading
      goBlack = onDark;
      return true;
    });
    controller.state = 'morning';
    bed.onInteract();
    bed.onInteract();
    goBlack();
    expect(controller.sleep).toHaveBeenCalledOnce();
  });

  it('sleeps straight away with no fade to play', () => {
    bed.fade = null;
    controller.state = 'morning';
    bed.onInteract();
    expect(controller.sleep).toHaveBeenCalledOnce();
  });

  it('is inert until the scene hands it a controller', () => {
    const loose = new Bed();
    expect(() => { loose.onUpdate(0.016); loose.onInteract(); }).not.toThrow();
    expect(loose.promptLabel).toBe('');
  });

  describe('naps', () => {
    let nap;
    beforeEach(() => {
      nap = { canNap: true, napping: false, start: vi.fn(() => true) };
      bed.nap = nap;
    });

    it('offers a nap during the shift', () => {
      expect(label('playing')).toMatch(/^\[E\] Nap/);
      bed.onInteract();
      expect(nap.start).toHaveBeenCalledOnce();
      expect(controller.sleep).not.toHaveBeenCalled();
    });

    it('says why not when a nap isn\'t possible', () => {
      nap.canNap = false;
      expect(label('playing')).toMatch(/can't sleep/i);
      bed.onInteract();
      expect(nap.start).not.toHaveBeenCalled();
    });

    it('in the morning it is the night\'s sleep, not a nap', () => {
      expect(label('morning')).toBe('[E] Sleep');
      bed.onInteract();
      expect(controller.sleep).toHaveBeenCalledOnce();
      expect(nap.start).not.toHaveBeenCalled();
    });
  });
});
