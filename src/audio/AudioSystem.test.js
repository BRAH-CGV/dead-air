import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { AudioSystem, dishMotorLevel } from './AudioSystem.js';
import { FakeAudioContext, fakeAssets, fakeDocument } from '../test/fakeAudio.js';

const KEYS = [
  'amb:office', 'amb:corridor', 'amb:base-interior', 'amb:outside-wind', 'amb:dish-motor',
  'sfx:save', 'sfx:glass-tap',
];

describe('AudioSystem', () => {
  let ctx, doc, camera, audio;

  function make(opts = {}) {
    return new AudioSystem({
      camera, doc, assets: fakeAssets(KEYS), listener: new THREE.AudioListener(), ...opts,
    });
  }

  beforeEach(() => {
    ctx = new FakeAudioContext();
    THREE.AudioContext.setContext(ctx);
    doc = fakeDocument();
    camera = new THREE.PerspectiveCamera();
    audio = make();
  });

  afterEach(() => {
    audio.dispose();
    THREE.AudioContext.setContext(undefined);
  });

  it('hangs the listener on the camera, so the player hears from their eyes', () => {
    expect(audio.available).toBe(true);
    expect(audio.listener.parent).toBe(camera);
  });

  it('master volume is clamped to 0–1', () => {
    audio.setVolume(1.7);
    expect(audio.volume).toBe(1);
    expect(audio.listener.gain.gain.value).toBe(1);
    audio.setVolume(-3);
    expect(audio.volume).toBe(0);
    expect(audio.listener.gain.gain.value).toBe(0);
  });

  describe('before the first click or key', () => {
    it('plays nothing — the browser would block it — and remembers the ambience for later', () => {
      expect(audio.play('sfx:save')).toBe(null);
      audio.setAmbience('amb:office');
      expect(audio.ambience.room).toBe('amb:office');
      expect(ctx.sources).toHaveLength(0);
      expect(ctx.resumes).toBe(0);
    });

    it('the pointer lock wakes the context and starts the ambience asked for earlier', () => {
      audio.setAmbience('amb:office');
      audio.setAmbience('amb:base-interior', 'bed');
      doc.lock();
      expect(ctx.state).toBe('running');
      expect(ctx.playing).toHaveLength(2);
      expect(ctx.playing.every(s => s.loop)).toBe(true);
    });

    it('so does a key press or a click, for menus that come before the lock', () => {
      doc.dispatchEvent(new Event('keydown'));
      expect(ctx.state).toBe('running');
    });
  });

  describe('once woken', () => {
    beforeEach(() => doc.lock());

    it('plays a one-shot at the volume and rate asked for', () => {
      const voice = audio.play('sfx:save', { volume: 0.4, rate: 1.2 });
      expect(voice).toBeInstanceOf(THREE.Audio);
      expect(voice.getVolume()).toBeCloseTo(0.4);
      expect(voice.getPlaybackRate()).toBeCloseTo(1.2);
      expect(ctx.playing).toHaveLength(1);
      expect(ctx.playing[0].loop).toBe(false);
    });

    it('a sound it has no buffer for is skipped, not thrown', () => {
      expect(audio.play('sfx:not-a-sound')).toBe(null);
      expect(ctx.sources).toHaveLength(0);
    });

    it('a positional one-shot sounds from the object it is given', () => {
      const pane = new THREE.Object3D();
      const voice = audio.play('sfx:glass-tap', { at: pane });
      expect(voice).toBeInstanceOf(THREE.PositionalAudio);
      expect(voice.parent).toBe(pane);
    });

    it('reuses a voice once its sound has run out', () => {
      const first = audio.play('sfx:save');
      ctx.sources[0].end();
      expect(audio.play('sfx:save')).toBe(first);
      const overlapping = audio.play('sfx:save');
      expect(overlapping).not.toBe(first);
    });

    it('crossfades the ambience over a second when the room changes', () => {
      audio.setAmbience('amb:office');
      const office = ctx.playing[0];
      ctx.currentTime = 10;
      audio.setAmbience('amb:corridor');

      expect(office.stopped).toBeCloseTo(10 + AudioSystem.FADE);
      const corridor = ctx.playing.at(-1);
      expect(corridor).not.toBe(office);
      expect(ctx.playing).toHaveLength(1);

      const [out] = [...office.outputs];          // → the voice's gain
      expect(out.gain.calls.at(-1)).toEqual(['linearRampToValueAtTime', 0, 10 + AudioSystem.FADE]);
      const [inn] = [...corridor.outputs];
      expect(inn.gain.calls.at(-2)).toEqual(['setValueAtTime', 0, 10]);
      expect(inn.gain.calls.at(-1)).toEqual(
        ['linearRampToValueAtTime', audio.ambienceVolume.room, 10 + AudioSystem.FADE]);
    });

    it('the bed under the room tone is a channel of its own: both sound, each fades alone', () => {
      audio.setAmbience('amb:base-interior', 'bed');
      audio.setAmbience('amb:office');                      // the room channel by default
      expect(ctx.playing).toHaveLength(2);
      const [bed, office] = ctx.playing;
      const [bedGain] = [...bed.outputs];
      expect(bedGain.gain.calls.at(-1)).toEqual(
        ['linearRampToValueAtTime', audio.ambienceVolume.bed, AudioSystem.FADE]);

      audio.setAmbience('amb:corridor');
      expect(office.stopped).not.toBe(null);
      expect(bed.stopped).toBe(null);                      // the bed plays on under the change
      audio.setAmbience('amb:outside-wind', 'bed');
      expect(bed.stopped).not.toBe(null);
      expect(audio.ambience).toEqual({ bed: 'amb:outside-wind', room: 'amb:corridor' });
      expect(ctx.playing).toHaveLength(2);
    });

    it('asking for the ambience already playing changes nothing', () => {
      audio.setAmbience('amb:office');
      audio.setAmbience('amb:office');
      expect(ctx.sources).toHaveLength(1);
    });

    it('does not reuse a voice that is still fading out', () => {
      audio.setAmbience('amb:office');
      audio.setAmbience('amb:corridor');
      audio.setAmbience('amb:office');
      expect(new Set(audio._ambience.map(a => a.sound)).size).toBe(3);
      ctx.currentTime = 5;
      audio.setAmbience('amb:base-interior');
      expect(audio._ambience).toHaveLength(3);    // the first fade is over: reused
    });

    it('null fades that channel out, and leaves the other playing', () => {
      audio.setAmbience('amb:outside-wind', 'bed');
      audio.setAmbience('amb:office');
      audio.setAmbience(null);
      expect(ctx.playing).toHaveLength(1);
      audio.setAmbience(null, 'bed');
      expect(ctx.playing).toHaveLength(0);
    });
  });

  describe('pause and the tab going away', () => {
    beforeEach(() => doc.lock());

    it('setPaused suspends the whole context, and un-pausing resumes it', () => {
      audio.setPaused(true);
      expect(ctx.state).toBe('suspended');
      expect(audio.play('sfx:save')).toBe(null);   // no stale one-shots on resume
      audio.setPaused(false);
      expect(ctx.state).toBe('running');
    });

    it('a hidden tab is silent; showing it again resumes, unless paused', () => {
      doc.setHidden(true);
      expect(ctx.state).toBe('suspended');
      doc.setHidden(false);
      expect(ctx.state).toBe('running');
      audio.setPaused(true);
      doc.setHidden(true);
      doc.setHidden(false);
      expect(ctx.state).toBe('suspended');
    });
  });

  describe('positional loops', () => {
    it('a machine hum waits at level 0, starts when raised, and stops when it falls silent', () => {
      doc.lock();
      const dish = new THREE.Object3D();
      const motor = audio.positional('amb:dish-motor', dish, { volume: 0.5 });
      expect(motor.sound.parent).toBe(dish);
      expect(motor.sound.isPlaying).toBe(false);

      motor.setLevel(0.6);
      expect(motor.sound.isPlaying).toBe(true);
      expect(motor.sound.getVolume()).toBeCloseTo(0.3);

      motor.setLevel(0);
      expect(motor.sound.isPlaying).toBe(false);
      expect(motor.sound.getVolume()).toBe(0);
    });

    it('a loop raised before the first click starts on it', () => {
      const motor = audio.positional('amb:dish-motor', new THREE.Object3D());
      motor.setLevel(1);
      expect(ctx.sources).toHaveLength(0);
      doc.lock();
      expect(motor.sound.isPlaying).toBe(true);
    });

    it('follow() drives the level from the game each frame', () => {
      doc.lock();
      const satellite = { velYaw: 0, velPitch: 0, maxRotationSpeed: 0.5 };
      const motor = audio.follow(
        audio.positional('amb:dish-motor', new THREE.Object3D()),
        { level: () => dishMotorLevel(satellite) },
      );
      audio.onUpdate(1 / 60);
      expect(motor.sound.isPlaying).toBe(false);

      satellite.velYaw = 0.25;
      audio.onUpdate(1 / 60);
      expect(motor.level).toBeCloseTo(0.5);
      expect(motor.sound.isPlaying).toBe(true);

      satellite.velYaw = 0;
      audio.onUpdate(1 / 60);
      expect(motor.sound.isPlaying).toBe(false);
    });

    it('rate follows too, and tiny wobbles are not sent to the audio thread', () => {
      doc.lock();
      let rate = 1;
      const tone = audio.follow(audio.positional('amb:dish-motor', new THREE.Object3D()), {
        level: () => 1, rate: () => rate,
      });
      audio.onUpdate(1 / 60);
      const source = ctx.playing[0];
      const before = source.playbackRate.calls.length;
      rate = 1.001;
      audio.onUpdate(1 / 60);
      expect(source.playbackRate.calls.length).toBe(before);
      rate = 1.4;
      audio.onUpdate(1 / 60);
      expect(tone.rate).toBeCloseTo(1.4);
      expect(source.playbackRate.value).toBeCloseTo(1.4);
    });
  });

  it('dishMotorLevel is the dish speed as a share of its top speed', () => {
    expect(dishMotorLevel({ velYaw: 0, velPitch: 0, maxRotationSpeed: 0.5 })).toBe(0);
    expect(dishMotorLevel({ velYaw: 0.3, velPitch: 0.4, maxRotationSpeed: 1 })).toBeCloseTo(0.5);
    expect(dishMotorLevel({ velYaw: 5, velPitch: 0, maxRotationSpeed: 1 })).toBe(1);
    expect(dishMotorLevel(null)).toBe(0);
  });

  it('dispose stops every sound, unhooks the listener and stops listening to the page', () => {
    doc.lock();
    audio.setAmbience('amb:office');
    audio.play('sfx:save');
    const hum = audio.positional('amb:dish-motor', new THREE.Object3D());
    hum.setLevel(1);
    expect(ctx.playing).toHaveLength(3);

    audio.dispose();
    expect(ctx.playing).toHaveLength(0);
    expect(audio.listener.parent).toBe(null);
    expect(audio.listener.gain.outputs.size).toBe(0);
    expect(hum.sound.parent).toBe(null);

    doc.setHidden(true);
    doc.setHidden(false);
    expect(ctx.resumes).toBe(1);                   // only the lock's
    audio.dispose();                               // twice is harmless
  });

  describe('without Web Audio (tests, old browsers)', () => {
    it('does nothing, safely', () => {
      const silent = new AudioSystem({ camera, doc, assets: fakeAssets(KEYS), listener: null });
      expect(silent.available).toBe(false);
      doc.lock();
      expect(silent.play('sfx:save')).toBe(null);
      silent.setAmbience('amb:office');
      expect(silent.ambience.room).toBe('amb:office');
      const hum = silent.positional('amb:dish-motor', new THREE.Object3D());
      hum.setLevel(1);
      hum.setRate(2);
      expect(hum.sound).toBe(null);
      expect(hum.level).toBe(1);
      silent.follow(hum, { level: () => 0.5 });
      silent.onUpdate(1 / 60);
      silent.setPaused(true);
      silent.setVolume(0.3);
      silent.dispose();
      expect(ctx.sources).toHaveLength(0);
    });

    it('builds no listener of its own where the page has no AudioContext', () => {
      const bare = new AudioSystem({ camera, doc });
      expect(bare.available).toBe(false);
      expect(camera.children).not.toContain(bare.listener);
      bare.dispose();
    });

    it('a sound missing from the cache gives an inert emitter', () => {
      doc.lock();
      const hum = audio.positional('amb:not-loaded', new THREE.Object3D());
      hum.setLevel(1);
      expect(hum.sound).toBe(null);
      expect(ctx.sources).toHaveLength(0);
    });
  });
});
