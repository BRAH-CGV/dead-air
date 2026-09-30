import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Bed } from './Bed.js';
import { Interactable } from './Interactable.js';

describe('Bed', () => {
  let controller, fade, bed;

  beforeEach(() => {
    controller = { state: 'playing', sleep: vi.fn(() => controller.state === 'morning') };
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
});

describe('Bed — a nap during the shift', () => {
  let controller, fade, nap, bed;

  beforeEach(() => {
    controller = { state: 'playing', sleep: vi.fn() };
    fade = { play: vi.fn(onDark => { onDark(); return true; }) };
    nap = { allowed: true, tired: true, take: vi.fn(() => 1) };
    bed = new Bed();
    bed.controller = controller;
    bed.fade = fade;
    bed.nap = nap;
  });

  const label = (dt = 0.016) => { bed.onUpdate(dt); return bed.promptLabel; };

  it('offers a nap to a tired player, and says what it costs', () => {
    expect(label()).toMatch(/^\[E\] Nap/);
    expect(label()).toMatch(/hour/);
  });

  it("won't let a rested player sleep the shift away", () => {
    nap.allowed = false;
    nap.tired = false;
    expect(label()).toMatch(/not tired/i);
    expect(label()).not.toMatch(/\[E\]/);
    bed.onInteract();
    expect(fade.play).not.toHaveBeenCalled();
  });

  it('naps behind the fade, taking the nap once it is black', () => {
    bed.onInteract();
    expect(fade.play).toHaveBeenCalledOnce();
    expect(nap.take).toHaveBeenCalledOnce();
    expect(controller.sleep).not.toHaveBeenCalled();
  });

  it('a second press during the fade naps once', () => {
    let goBlack;
    fade.play = vi.fn(onDark => {
      if (goBlack) return false;
      goBlack = onDark;
      return true;
    });
    bed.onInteract();
    bed.onInteract();
    goBlack();
    expect(nap.take).toHaveBeenCalledOnce();
  });

  it('tells you how long you slept for a few seconds on waking', () => {
    bed.onInteract();
    expect(label()).toBe('You slept an hour.');
    expect(label(5)).toMatch(/^\[E\] Nap/);

    nap.take = vi.fn(() => 2);
    bed.onInteract();
    expect(label()).toMatch(/overslept/i);
  });

  it('says nothing about a nap you never woke from', () => {
    nap.take = vi.fn(() => 0);
    bed.onInteract();
    controller.state = 'gameOver';
    expect(label()).toBe('');
  });
});
