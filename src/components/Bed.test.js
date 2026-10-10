import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Bed } from './Bed.js';
import { Interactable } from './Interactable.js';

describe('Bed', () => {
  let controller, fade, bed;

  beforeEach(() => {
    controller = {
      state: 'playing', overtime: false, quotaMet: false,
      get canSleep() { return this.state === 'morning' || (this.overtime && this.quotaMet); },
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
    expect(label('playing')).toMatch(/3:00 AM/);
    expect(label('playing')).not.toMatch(/\[E\]/);
  });

  it('offers sleep in overtime once the quota is met', () => {
    controller.overtime = true;
    controller.quotaMet = true;
    expect(label('playing')).toBe('[E] Sleep');
    bed.onInteract();
    expect(controller.sleep).toHaveBeenCalledOnce();
  });

  it('in overtime without the quota, says what is missing', () => {
    controller.overtime = true;
    expect(label('playing')).toMatch(/quota/i);
    bed.onInteract();
    expect(controller.sleep).not.toHaveBeenCalled();
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
});
