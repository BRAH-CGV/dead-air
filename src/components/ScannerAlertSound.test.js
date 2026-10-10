import { describe, it, expect, vi } from 'vitest';
import { ScannerAlertSound, SCANNER_ALERT } from './ScannerAlertSound.js';
import { SignalAlertLight } from '../gameobjects/SignalAlertLight.js';
import { GameObject } from '../core/GameObject.js';
import { ASSETS, PRELOAD } from '../assets/manifest.js';

// ─────────────────────────────────────────────
// Built by hand: a stand-in lamp that only has the `lit` flag the component
// reads, and a sound with THREE.Audio's surface. The component's job is
// deciding when the lamp has lit up, not decoding or playing anything.
// ─────────────────────────────────────────────

function fakeSound() {
  const sound = {
    isPlaying: false,
    volume: 1,
    detune: 0,
    play: vi.fn(() => { sound.isPlaying = true; }),
    stop: vi.fn(() => { sound.isPlaying = false; }),
    setVolume: vi.fn((v) => { sound.volume = v; }),
    setDetune: vi.fn((cents) => { sound.detune = cents; }),
    disconnect: vi.fn(),
    removeFromParent: vi.fn(),
  };
  return sound;
}

function build({ sound = fakeSound(), random } = {}) {
  const lamp = new GameObject('SignalAlertLight');
  lamp.lit = false;
  lamp.frantic = false;
  const voice = lamp.addComponent(new ScannerAlertSound({ sound, random }));
  voice.onStart();
  return { voice, lamp, sound };
}

const tick = (voice, frames = 1) => { for (let i = 0; i < frames; i++) voice.onUpdate(1 / 60); };

describe('ScannerAlertSound', () => {
  it('is silent while the lamp is dark', () => {
    const { voice, sound } = build();
    tick(voice, 30);
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('beeps once as the lamp lights up, not on every lit frame', () => {
    const { voice, lamp, sound } = build();
    lamp.lit = true;
    tick(voice, 20);
    expect(sound.play).toHaveBeenCalledTimes(1);
    expect(sound.volume).toBe(SCANNER_ALERT.volume);
  });

  it('beeps again with every light-up', () => {
    const { voice, lamp, sound } = build();
    for (let blink = 0; blink < 4; blink++) {
      lamp.lit = true;
      tick(voice, 10);
      sound.isPlaying = false;   // the clip has rung out
      lamp.lit = false;
      tick(voice, 10);
    }
    expect(sound.play).toHaveBeenCalledTimes(4);
  });

  it('starts over from its top if the last beep is still sounding', () => {
    const { voice, lamp, sound } = build();
    lamp.lit = true;
    tick(voice);
    lamp.lit = false;
    tick(voice);
    lamp.lit = true;             // a frantic lamp: lit again mid-beep
    tick(voice);

    expect(sound.stop).toHaveBeenCalledTimes(1);
    expect(sound.play).toHaveBeenCalledTimes(2);
    expect(sound.isPlaying).toBe(true);
  });

  it('lets a beep ring out when the lamp goes dark', () => {
    const { voice, lamp, sound } = build();
    lamp.lit = true;
    tick(voice);
    lamp.lit = false;
    tick(voice, 5);
    expect(sound.stop).not.toHaveBeenCalled();
  });

  describe('the sound of each beep', () => {
    /** Light the lamp `times` over, noting the pitch and level of each beep. */
    function beeps(voice, lamp, sound, times) {
      const heard = [];
      for (let i = 0; i < times; i++) {
        lamp.lit = true;
        tick(voice);
        heard.push({ detune: sound.detune, volume: sound.volume });
        lamp.lit = false;
        tick(voice);
      }
      return heard;
    }

    it('is the same every time on the steady blink: a machine', () => {
      const { voice, lamp, sound } = build();
      for (const beep of beeps(voice, lamp, sound, 12)) {
        expect(beep).toEqual({ detune: 0, volume: SCANNER_ALERT.volume });
      }
    });

    it('changes pitch and level from one frantic flash to the next', () => {
      const { voice, lamp, sound } = build();
      lamp.frantic = true;
      const heard = beeps(voice, lamp, sound, 40);
      const { detune, volume } = SCANNER_ALERT.frantic;

      for (const beep of heard) {
        expect(beep.detune).toBeGreaterThanOrEqual(detune[0]);
        expect(beep.detune).toBeLessThanOrEqual(detune[1]);
        expect(beep.volume).toBeGreaterThanOrEqual(SCANNER_ALERT.volume * volume[0] - 1e-9);
        expect(beep.volume).toBeLessThanOrEqual(SCANNER_ALERT.volume * volume[1] + 1e-9);
      }
      // Nothing like uniform: nearly every beep its own pitch and level,
      // spread over most of the range.
      expect(new Set(heard.map(b => b.detune)).size).toBeGreaterThan(30);
      expect(new Set(heard.map(b => b.volume)).size).toBeGreaterThan(30);
      const pitches = heard.map(b => b.detune);
      expect(Math.max(...pitches) - Math.min(...pitches)).toBeGreaterThan((detune[1] - detune[0]) * 0.6);
    });

    it('spans its whole frantic range, low to high', () => {
      const rolls = [0, 0, 1, 1];   // pitch, level; pitch, level
      const { voice, lamp, sound } = build({ random: () => rolls.shift() });
      lamp.frantic = true;
      const [low, high] = beeps(voice, lamp, sound, 2);
      const { detune, volume } = SCANNER_ALERT.frantic;
      expect(low).toEqual({ detune: detune[0], volume: SCANNER_ALERT.volume * volume[0] });
      expect(high).toEqual({ detune: detune[1], volume: SCANNER_ALERT.volume * volume[1] });
    });

    it('goes below and above the steady beep when frantic, pitch and level both', () => {
      const { detune, volume } = SCANNER_ALERT.frantic;
      expect(detune[0]).toBeLessThan(0);
      expect(detune[1]).toBeGreaterThan(0);
      expect(volume[0]).toBeLessThan(1);
      expect(volume[1]).toBeGreaterThanOrEqual(1);
    });

    it('is the plain beep again once the UFO has gone', () => {
      const { voice, lamp, sound } = build();
      lamp.frantic = true;
      beeps(voice, lamp, sound, 5);
      lamp.frantic = false;
      expect(beeps(voice, lamp, sound, 3)).toEqual(
        Array(3).fill({ detune: 0, volume: SCANNER_ALERT.volume }),
      );
    });
  });

  it('follows a real lamp: one beep per blink while a signal is up', () => {
    const lamp = new SignalAlertLight();
    lamp.signalManager = { signals: [{ scanned: false, opacity: 1 }] };
    const sound = fakeSound();
    const voice = lamp.addComponent(new ScannerAlertSound({ sound }));
    voice.onStart();

    // Into the third blink cycle, a frame at a time: lit at 0, 0.8 and
    // 1.6 s. The lamp's own blink component runs first, as in the engine.
    const frames = Math.round(2.5 * lamp.period * 60);
    for (let i = 0; i < frames; i++) {
      lamp._update(1 / 60);
      if (i % 30 === 29) sound.isPlaying = false;
    }
    expect(sound.play).toHaveBeenCalledTimes(3);
  });

  it('is silent with the power off', () => {
    const lamp = new SignalAlertLight();
    lamp.signalManager = { signals: [{ scanned: false, opacity: 1 }] };
    lamp.powerLevel = 0;
    const sound = fakeSound();
    const voice = lamp.addComponent(new ScannerAlertSound({ sound }));
    voice.onStart();
    for (let i = 0; i < 120; i++) lamp._update(1 / 60);
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('carries on with no clip', () => {
    const { voice, lamp } = build({ sound: null });
    expect(() => { lamp.lit = true; tick(voice, 5); lamp.lit = false; tick(voice, 5); }).not.toThrow();
  });

  it('builds nothing on an engine with no audio', () => {
    const lamp = new GameObject('SignalAlertLight');
    lamp.scene = { userData: { engine: {} } };
    const voice = lamp.addComponent(new ScannerAlertSound());
    voice.onStart();
    expect(voice.sound).toBeNull();
  });

  it('falls silent and unhooks when the scene is torn down', () => {
    const { voice, lamp, sound } = build();
    lamp.lit = true;
    tick(voice);
    voice.onDestroy();
    expect(sound.isPlaying).toBe(false);
    expect(sound.disconnect).toHaveBeenCalled();
    expect(sound.removeFromParent).toHaveBeenCalled();
  });

  it('uses a small clip that is ready before the first signal', () => {
    expect(ASSETS[SCANNER_ALERT.key]).toMatchObject({ type: 'audio', url: 'assets/audio/scanner-alert.mp3' });
    expect(PRELOAD).toContain(SCANNER_ALERT.key);
  });
});
