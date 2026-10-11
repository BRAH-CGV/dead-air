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
    let nap, engine;
    beforeEach(() => {
      nap = { canNap: true, napping: false, start: vi.fn(() => true) };
      bed.nap = nap;
      controller.nightClock = { currentTime: 1.25, endHour: 6 };   // 1:15 AM
      engine = {
        keyBinds: { rotateHeld: 'KeyR' },
        held: false, consumed: false,
        isAction(a) { return a === 'rotateHeld' && this.held && !this.consumed; },
        consumeAction(a) { if (a === 'rotateHeld') this.consumed = true; },
      };
      bed.engine = engine;
    });

    /** Press R while looking at the bunk, and let go. */
    const pressR = () => {
      engine.held = true; engine.consumed = false;
      bed.onHover({});
      engine.held = false;
      bed.onHover({});
    };

    it('offers a nap during the shift, an hour by default, saying when you will wake', () => {
      expect(label('playing')).toBe('[E] Nap 1 h (until 2:15 AM) · [R] change');
      bed.onInteract();
      expect(nap.start).toHaveBeenCalledWith(1);
      expect(controller.sleep).not.toHaveBeenCalled();
    });

    it('R steps through the lengths, round to the start', () => {
      pressR();
      expect(label('playing')).toBe('[E] Nap 2 h (until 3:15 AM) · [R] change');
      pressR();
      expect(label('playing')).toBe('[E] Nap 3 h (until 4:15 AM) · [R] change');
      pressR();
      expect(label('playing')).toBe('[E] Nap until 6:00 AM · [R] change');
      bed.onInteract();
      expect(nap.start).toHaveBeenLastCalledWith(null);
      pressR();
      expect(label('playing')).toBe('[E] Nap 30 min (until 1:45 AM) · [R] change');
    });

    it('holding R steps once, not every frame', () => {
      engine.held = true;
      bed.onHover({}); bed.onHover({}); bed.onHover({});
      expect(label('playing')).toMatch(/Nap 2 h/);
    });

    it('a nap that would run past 6 AM just says until 6:00 AM', () => {
      controller.nightClock.currentTime = 5.5;
      expect(label('playing')).toBe('[E] Nap until 6:00 AM · [R] change');
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
