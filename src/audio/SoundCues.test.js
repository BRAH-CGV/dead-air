import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SoundCues } from './SoundCues.js';

describe('SoundCues', () => {
  let audio, terminal, satellite, controller, airlock, airlockAt, cues;

  const played = () => audio.play.mock.calls.map(([key]) => key);
  const tick = (seconds = 1 / 60, dt = 1 / 60) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) cues.onUpdate(dt);
  };

  beforeEach(() => {
    audio = { play: vi.fn() };
    satellite = { scanProgress: 0, scanTarget: null };
    terminal = { state: 'idle', satellite };
    controller = { state: 'playing' };
    airlock = { state: 'pressurised' };
    airlockAt = new THREE.Object3D();
    cues = new SoundCues({ audio, terminal, controller, airlock, airlockAt });
    tick();
  });

  it('is quiet while nothing changes', () => {
    tick(3);
    expect(audio.play).not.toHaveBeenCalled();
  });

  describe('the scanner', () => {
    beforeEach(() => {
      satellite.scanTarget = { scanTime: 10 };
      terminal.state = 'scanning';
    });

    it('ticks while a scan runs, and faster as it nears the lock', () => {
      tick(2);
      const slow = played().filter(k => k === 'sfx:scan-tick').length;
      expect(slow).toBeGreaterThanOrEqual(3);
      expect(slow).toBeLessThanOrEqual(5);

      audio.play.mockClear();
      satellite.scanProgress = 9.5;
      tick(2);
      const fast = played().filter(k => k === 'sfx:scan-tick').length;
      expect(fast).toBeGreaterThan(2 * slow);
    });

    it('the first tick is on the press, not half a second later', () => {
      tick();
      expect(played()).toEqual(['sfx:scan-tick']);
    });

    it('stops ticking when the scan is lost', () => {
      tick(1);
      terminal.state = 'radar';
      audio.play.mockClear();
      tick(2);
      expect(audio.play).not.toHaveBeenCalled();
    });

    it('chirps once when the signal locks and opens for review', () => {
      tick(0.2);
      terminal.state = 'review';
      tick(1);
      expect(played().filter(k => k === 'sfx:scan-lock')).toHaveLength(1);
      expect(played().at(-1)).toBe('sfx:scan-lock');
    });
  });

  describe('the shift', () => {
    it('chimes at 6 AM', () => {
      controller.state = 'morning';
      tick(1);
      expect(played()).toEqual(['sfx:chime']);
    });

    it('stings when the night ends in a death', () => {
      controller.state = 'gameOver';
      tick(1);
      expect(played()).toEqual(['sfx:death-sting']);
    });

    it('a retried night makes no sound of its own', () => {
      controller.state = 'gameOver';
      tick();
      audio.play.mockClear();
      controller.state = 'playing';
      tick(1);
      expect(audio.play).not.toHaveBeenCalled();
    });
  });

  describe('the airlock', () => {
    it('hisses from the airlock when a cycle starts, and clunks when the hatch seats', () => {
      airlock.state = 'depressurising';
      tick();
      expect(audio.play).toHaveBeenLastCalledWith('sfx:airlock-hiss', expect.objectContaining({ at: airlockAt }));
      airlock.state = 'depressurised';
      tick();
      expect(audio.play).toHaveBeenLastCalledWith('sfx:airlock-clunk', expect.objectContaining({ at: airlockAt }));
    });

    it('turning back mid-cycle hisses again the other way', () => {
      airlock.state = 'depressurising';
      tick();
      airlock.state = 'pressurising';
      tick();
      airlock.state = 'pressurised';
      tick();
      expect(played()).toEqual(['sfx:airlock-hiss', 'sfx:airlock-hiss', 'sfx:airlock-clunk']);
    });
  });

  it('whatever is missing is skipped: a scene without an airlock still ticks', () => {
    cues = new SoundCues({ audio, terminal, controller });
    satellite.scanTarget = { scanTime: 10 };
    terminal.state = 'scanning';
    tick();
    expect(played()).toEqual(['sfx:scan-tick']);
  });
});
