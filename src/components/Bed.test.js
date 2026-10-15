import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Bed } from './Bed.js';
import { Interactable } from './Interactable.js';
import * as THREE from 'three';
import { GameObject } from '../core/GameObject.js';
import { BUNK_POSES } from './Bed.js';

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

  it('in the morning, before the drives are in the buggy, says so and does nothing', () => {
    Object.defineProperty(controller, 'canSleep', { get() { return false; } });
    expect(label('morning')).toMatch(/buggy/i);
    expect(label('morning')).not.toMatch(/\[E\]/);
    bed.onInteract();
    expect(fade.play).not.toHaveBeenCalled();
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

  describe('the bunk\'s poses: the bed animation follows the bunk wherever it stands', () => {
    /** A bed on a bunk at `position`, turned `yaw` about +Y. */
    function onBunk(position = [0, 0, 0], yaw = 0) {
      const go = new GameObject('Bunk');
      go.object3d.position.set(...position);
      go.object3d.rotation.y = yaw;
      go.object3d.updateMatrixWorld(true);
      const b = go.addComponent(new Bed());
      return b;
    }

    it('the pillow: the eye at lying height on the bunk, looking up and tipped onto its side', () => {
      const pose = onBunk().pillowPose();
      expect(pose.position.toArray()).toEqual(BUNK_POSES.pillow.position);
      expect(pose.position.y).toBeGreaterThan(0.4);           // on the mattress …
      expect(pose.position.y).toBeLessThan(0.9);              // … lying, not sitting
      expect(pose.pitch).toBeGreaterThan(0.3);                // up toward the ceiling
      expect(Math.abs(pose.roll)).toBeGreaterThan(0.05);      // onto its side
    });

    it('the get-out spot stands clear of the bunk, facing into the room', () => {
      const spot = onBunk().getOutSpot();
      expect(spot.position.y).toBe(0);                         // the feet, on the floor
      // Outside the bunk's footprint (1.08 × 2 m about its origin) by more
      // than the player's radius, so the capsule never lands in its collider.
      expect(spot.position.x).toBeGreaterThan(0.54 + 0.3);
      // Facing +x, out of the bunk's open side: forward is (−sin yaw, −cos yaw).
      expect(-Math.sin(spot.yaw)).toBeCloseTo(1);
    });

    it('sitting is on the bunk\'s edge, between the pillow and the spot', () => {
      const b = onBunk();
      const sit = b.sitPose().position;
      expect(sit.x).toBeGreaterThan(b.pillowPose().position.x);
      expect(sit.x).toBeLessThan(b.getOutSpot().position.x);
      expect(sit.y).toBeGreaterThan(b.pillowPose().position.y);
    });

    it('moved and turned with the bunk', () => {
      const here = onBunk();
      const there = onBunk([3, 0, -2], Math.PI / 2);
      const p0 = here.pillowPose(), p1 = there.pillowPose();
      const expected = new THREE.Vector3(...BUNK_POSES.pillow.position)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).add(new THREE.Vector3(3, 0, -2));
      expect(p1.position.distanceTo(expected)).toBeLessThan(1e-6);
      expect(p1.yaw - p0.yaw).toBeCloseTo(Math.PI / 2);
      expect(p1.pitch).toBeCloseTo(p0.pitch);
      const out = there.getOutSpot();
      expect(out.yaw - here.getOutSpot().yaw).toBeCloseTo(Math.PI / 2);
    });
  });

  describe('getting into bed for the morning sleep (a BedRest)', () => {
    let rest;
    beforeEach(() => {
      rest = {
        active: false,
        lieDown: vi.fn(onAsleep => { rest.active = true; rest.onAsleep = onAsleep; return true; }),
        getUp: vi.fn(() => true),
        cancel: vi.fn(() => { rest.active = false; }),
      };
      bed.rest = rest;
      controller.state = 'morning';
    });

    it('lies down instead of fading, and sleeps only once the eyes are shut', () => {
      bed.onInteract();
      expect(rest.lieDown).toHaveBeenCalledOnce();
      expect(fade.play).not.toHaveBeenCalled();
      expect(controller.sleep).not.toHaveBeenCalled();
      rest.onAsleep();
      expect(controller.sleep).toHaveBeenCalledOnce();
    });

    it('the next night begun, gets up out of bed', () => {
      controller.sleep = vi.fn(() => { controller.state = 'playing'; });
      bed.onInteract();
      rest.onAsleep();
      expect(rest.getUp).toHaveBeenCalledWith('calm');
    });

    it('the run over (the last night), hands the view straight back', () => {
      controller.sleep = vi.fn(() => { controller.state = 'finished'; });
      bed.onInteract();
      rest.onAsleep();
      expect(rest.getUp).not.toHaveBeenCalled();
      expect(rest.cancel).toHaveBeenCalled();
    });

    it('offers nothing and does nothing while the animation runs', () => {
      bed.onInteract();
      bed.onUpdate(0.016);
      expect(bed.promptLabel).toBe('');
      bed.onInteract();
      expect(rest.lieDown).toHaveBeenCalledOnce();
    });
  });
});
