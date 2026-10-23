import { describe, it, expect, vi } from 'vitest';
import { CoffeeSound, COFFEE_SOUND } from './CoffeeSound.js';
import { COFFEE } from './CoffeeMachine.js';
import { GameObject } from '../core/GameObject.js';
import { ASSETS } from '../assets/manifest.js';

// ─────────────────────────────────────────────
// Built by hand: a stand-in machine with only the `state` the component
// reads, and sounds with THREE.Audio's surface.
// ─────────────────────────────────────────────

function fakeSound() {
  const sound = {
    isPlaying: false,
    volume: 1,
    detune: 0,
    play: vi.fn(() => { sound.isPlaying = true; }),
    stop: vi.fn(() => { sound.isPlaying = false; }),
    pause: vi.fn(() => { sound.isPlaying = false; }),
    setVolume: vi.fn((v) => { sound.volume = v; }),
    setDetune: vi.fn((c) => { sound.detune = c; }),
    disconnect: vi.fn(),
    removeFromParent: vi.fn(),
  };
  return sound;
}

function build() {
  const go = new GameObject('CoffeeMachine');
  go.state = 'ready';
  const brew = fakeSound(), click = fakeSound();
  const voice = go.addComponent(new CoffeeSound({ brew, click }));
  voice.onStart();
  return { voice, machine: go, brew, click };
}

const tick = (voice, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) voice.onUpdate(dt); };

describe('CoffeeSound', () => {
  it('the brewing clip is as long as a brew, and both clips are in the manifest', () => {
    expect(COFFEE_SOUND.brewSeconds).toBe(COFFEE.brewSeconds);
    expect(ASSETS[COFFEE_SOUND.keys.brew]).toBeDefined();
    expect(ASSETS[COFFEE_SOUND.keys.click]).toBeDefined();
  });

  it('silent until a brew starts', () => {
    const { voice, brew, click } = build();
    tick(voice, 2);
    expect(brew.play).not.toHaveBeenCalled();
    expect(click.play).not.toHaveBeenCalled();
  });

  it('a brew starting: a very soft click, and the machine running from the top', () => {
    const { voice, machine, brew, click } = build();
    machine.state = 'brewing';
    tick(voice, 1);
    expect(click.play).toHaveBeenCalledTimes(1);
    expect(click.volume).toBeLessThanOrEqual(0.2);
    expect(brew.play).toHaveBeenCalledTimes(1);
    expect(brew.volume).toBe(COFFEE_SOUND.volume);
  });

  it('brewed, it is left to run out on its own: the clip is the brew\'s length', () => {
    const { voice, machine, brew } = build();
    machine.state = 'brewing';
    tick(voice, COFFEE.brewSeconds);
    machine.state = 'brewed';
    tick(voice, 0.05);
    expect(brew.stop).not.toHaveBeenCalled();
  });

  it('brewed early (a nap racing the brew): the rest of the clip fades out', () => {
    const { voice, machine, brew } = build();
    machine.state = 'brewing';
    tick(voice, 1.3);
    machine.state = 'brewed';
    tick(voice, COFFEE_SOUND.fadeOut + 0.1);
    expect(brew.stop).toHaveBeenCalled();
  });

  it('cut short (a nap racing the brew, a new night), it fades out rather than stopping dead', () => {
    const { voice, machine, brew } = build();
    machine.state = 'brewing';
    tick(voice, 5);
    machine.state = 'ready';
    tick(voice, 0.05);
    expect(brew.stop).not.toHaveBeenCalled();
    expect(brew.volume).toBeLessThan(COFFEE_SOUND.volume);
    tick(voice, COFFEE_SOUND.fadeOut + 0.1);
    expect(brew.stop).toHaveBeenCalled();
  });

  it('paused, the machine pauses with the game, and carries on where it was', () => {
    const { voice, machine, brew } = build();
    machine.state = 'brewing';
    tick(voice, 3);
    voice._onPause(true);
    expect(brew.pause).toHaveBeenCalled();
    voice._onPause(false);
    expect(brew.play).toHaveBeenCalledTimes(2);
  });

  it('another brew starts the clip over', () => {
    const { voice, machine, brew, click } = build();
    machine.state = 'brewing';
    tick(voice, 1);
    machine.state = 'brewed';
    tick(voice, 1);
    machine.state = 'ready';
    tick(voice, 1);
    machine.state = 'brewing';
    tick(voice, 0.1);
    expect(brew.play).toHaveBeenCalledTimes(2);
    expect(click.play).toHaveBeenCalledTimes(2);
  });
});
