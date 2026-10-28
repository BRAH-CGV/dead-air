import { describe, it, expect, vi } from 'vitest';
import { ProcessorSound, PROCESSOR_SOUND } from './ProcessorSound.js';
import { CoffeeHarvest, COFFEE_HARVEST } from '../gameplay/CoffeeHarvest.js';
import { GameObject } from '../core/GameObject.js';
import { ASSETS, PRELOAD } from '../assets/manifest.js';

// A stand-in sound with THREE.Audio's surface, and the real harvest rules.

function fakeSound() {
  const sound = {
    isPlaying: false,
    volume: 1,
    play: vi.fn(() => { sound.isPlaying = true; }),
    stop: vi.fn(() => { sound.isPlaying = false; }),
    pause: vi.fn(() => { sound.isPlaying = false; }),
    setVolume: vi.fn((v) => { sound.volume = v; }),
    disconnect: vi.fn(),
    removeFromParent: vi.fn(),
  };
  return sound;
}

function build() {
  const harvest = new CoffeeHarvest({ bushes: 4, random: () => 0 });
  const go = new GameObject('BeanProcessor');
  const grind = fakeSound();
  const voice = go.addComponent(new ProcessorSound({ harvest, grind }));
  voice.onStart();
  return { voice, harvest, grind };
}

/** The harvest and the sound, a frame at a time, as the processor ticks them. */
const run = ({ voice, harvest }, seconds, dt = 1 / 60) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) { harvest.update(dt); voice.onUpdate(dt); }
};

describe('ProcessorSound', () => {
  it('the grinding clip is as long as a pile takes, and is in the manifest', () => {
    expect(PROCESSOR_SOUND.seconds).toBe(COFFEE_HARVEST.processSeconds);
    expect(ASSETS[PROCESSOR_SOUND.key]).toMatchObject({ type: 'audio' });
    expect(PRELOAD).toContain(PROCESSOR_SOUND.key);
  });

  it('silent until a pile is processed', () => {
    const t = build();
    t.harvest.load();
    run(t, 2);
    expect(t.grind.play).not.toHaveBeenCalled();
  });

  it('grinds from the top as each pile starts, and is left to run out at the end', () => {
    const t = build();
    t.harvest.load();
    t.harvest.load();
    t.harvest.start();
    run(t, 0.1);
    expect(t.grind.play).toHaveBeenCalledTimes(1);
    expect(t.grind.volume).toBe(PROCESSOR_SOUND.volume);
    run(t, COFFEE_HARVEST.processSeconds);             // the second pile starts
    expect(t.grind.play).toHaveBeenCalledTimes(2);
    expect(t.grind.stop).toHaveBeenCalledTimes(1);     // the first cut for the second, from the top
    run(t, COFFEE_HARVEST.processSeconds);
    expect(t.grind.stop).toHaveBeenCalledTimes(1);     // done on time: not cut
  });

  it('cut short (a new night) it fades out rather than stopping dead', () => {
    const t = build();
    t.harvest.load();
    t.harvest.start();
    run(t, 1);
    t.harvest.newNight();
    run(t, 0.05);
    expect(t.grind.stop).not.toHaveBeenCalled();
    expect(t.grind.volume).toBeLessThan(PROCESSOR_SOUND.volume);
    run(t, PROCESSOR_SOUND.fadeOut + 0.1);
    expect(t.grind.stop).toHaveBeenCalled();
  });

  it('paused, it pauses with the game, and carries on where it was', () => {
    const t = build();
    t.harvest.load();
    t.harvest.start();
    run(t, 1);
    t.voice._onPause(true);
    expect(t.grind.pause).toHaveBeenCalled();
    t.voice._onPause(false);
    expect(t.grind.play).toHaveBeenCalledTimes(2);
  });

  it('torn down, it stops and unhooks', () => {
    const t = build();
    t.harvest.load();
    t.harvest.start();
    run(t, 1);
    t.voice.onDestroy();
    expect(t.grind.stop).toHaveBeenCalled();
    expect(t.grind.removeFromParent).toHaveBeenCalled();
  });

  it('carries on with no harvest or no sound', () => {
    const go = new GameObject('BeanProcessor');
    const voice = go.addComponent(new ProcessorSound({ grind: null }));
    voice.onStart();
    expect(() => voice.onUpdate(0.016)).not.toThrow();
  });
});
