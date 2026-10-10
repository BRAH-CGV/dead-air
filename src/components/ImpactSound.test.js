import { describe, it, expect, vi } from 'vitest';
import { ImpactSound, IMPACT, IMPACT_SOUNDS, impactLevel } from './ImpactSound.js';
import { Pickupable } from './Pickupable.js';
import { GameObject } from '../core/GameObject.js';
import { ASSETS, PRELOAD } from '../assets/manifest.js';

// ─────────────────────────────────────────────
// Built by hand: a body that only has the three things the component reads
// (dynamic or not, asleep or not, its velocity) and a sound with
// THREE.Audio's surface. The component's job is telling a knock from
// ordinary motion and choosing a clip, not simulating or playing anything.
// ─────────────────────────────────────────────

const DT = 1 / 60;
/** What gravity alone adds to a falling body's speed in one step. */
const G_STEP = 9.81 * DT;

function fakeBody({ dynamic = true } = {}) {
  const body = {
    v: { x: 0, y: 0, z: 0 },
    dynamic,
    asleep: false,
    isDynamic: () => body.dynamic,
    isSleeping: () => body.asleep,
    linvel: vi.fn(() => ({ ...body.v })),
  };
  return body;
}

function fakeSound() {
  const sound = {
    isPlaying: false,
    volume: 1,
    buffer: null,
    /** Every clip played, in order. */
    played: [],
    play: vi.fn(() => { sound.isPlaying = true; sound.played.push(sound.buffer); }),
    stop: vi.fn(() => { sound.isPlaying = false; }),
    setVolume: vi.fn((v) => { sound.volume = v; }),
    setBuffer: vi.fn((b) => { sound.buffer = b; }),
    disconnect: vi.fn(),
    removeFromParent: vi.fn(),
  };
  return sound;
}

/** A prop with three knocks (a, b, c) and a handling clip of its own (h). */
function build({ buffers = ['a', 'b', 'c'], handlingBuffers = ['h'], sound = fakeSound(), volume, random, pickupable = true } = {}) {
  const prop = new GameObject('Prop');
  const held = pickupable ? prop.addComponent(new Pickupable()) : null;
  prop.rigidBody = fakeBody();
  const voice = prop.addComponent(new ImpactSound({ buffers, handlingBuffers, sound, volume, random }));
  return { voice, prop, body: prop.rigidBody, sound, held };
}

/** The knocks among what a sound has played: everything but handling. */
const knocks = sound => sound.played.filter(clip => clip !== 'h');

/** One physics step with the body moving at `v` afterwards. */
function step(voice, body, v = body.v) {
  body.v = { x: 0, y: 0, z: 0, ...v };
  voice.onFixedUpdate(DT);
}

/** Wait out the gap that keeps one knock from sounding twice. */
function rest(voice, body) {
  for (let t = 0; t < IMPACT.cooldown + DT; t += DT) step(voice, body);
}

/** Fall until moving at `speed`, then stop dead: a landing. */
function land(voice, body, speed) {
  for (let v = 0; v < speed; v += G_STEP) step(voice, body, { y: -v });
  step(voice, body, { y: -speed });
  step(voice, body, { y: 0 });
}

describe('impactLevel', () => {
  it('is nothing below the quietest knock worth hearing', () => {
    expect(impactLevel(0)).toBe(0);
    expect(impactLevel(IMPACT.minSpeed * 0.99)).toBe(0);
  });

  it('starts at minLevel and reaches full at fullSpeed', () => {
    expect(impactLevel(IMPACT.minSpeed)).toBeCloseTo(IMPACT.minLevel);
    expect(impactLevel(IMPACT.fullSpeed)).toBeCloseTo(1);
    expect(impactLevel(IMPACT.fullSpeed * 3)).toBe(1);
  });

  it('rises with the speed between them', () => {
    const mid = impactLevel((IMPACT.minSpeed + IMPACT.fullSpeed) / 2);
    expect(mid).toBeGreaterThan(IMPACT.minLevel);
    expect(mid).toBeLessThan(1);
  });

  it('ignores what gravity or friction does in one step', () => {
    expect(IMPACT.minSpeed).toBeGreaterThan(G_STEP * 2);
  });
});

describe('ImpactSound', () => {
  it('is silent at rest', () => {
    const { voice, body, sound } = build();
    for (let i = 0; i < 30; i++) step(voice, body);
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('is silent in free fall', () => {
    const { voice, body, sound } = build();
    for (let v = 0; v < 6; v += G_STEP) step(voice, body, { y: -v });
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('knocks once as it lands', () => {
    const { voice, body, sound } = build();
    land(voice, body, 3);
    for (let i = 0; i < 30; i++) step(voice, body);
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it('knocks when something sends it flying, too', () => {
    const { voice, body, sound } = build();
    step(voice, body);
    step(voice, body, { x: 2.5 });
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it('is louder the harder it lands', () => {
    const soft = build();
    land(soft.voice, soft.body, 1);
    const hard = build();
    land(hard.voice, hard.body, 5);

    expect(soft.sound.volume).toBeGreaterThanOrEqual(IMPACT.minLevel);
    expect(soft.sound.volume).toBeLessThan(hard.sound.volume);
    expect(hard.sound.volume).toBe(1);
  });

  it('scales its level by the prop\'s own volume', () => {
    const { voice, body, sound } = build({ volume: 0.5 });
    land(voice, body, IMPACT.fullSpeed * 2);
    expect(sound.volume).toBe(0.5);
  });

  it('says nothing for a touch too light to hear', () => {
    const { voice, body, sound } = build();
    step(voice, body, { y: -IMPACT.minSpeed * 0.8 });
    step(voice, body, { y: 0 });
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('plays one clip for a rattle of bounces, then knocks again', () => {
    const { voice, body, sound } = build();
    step(voice, body, { y: -3 });
    step(voice, body, { y: 2 });     // the bounce
    step(voice, body, { y: -2 });    // straight back down, a step later
    expect(sound.play).toHaveBeenCalledTimes(1);

    rest(voice, body);
    step(voice, body, { y: -3 });
    step(voice, body, { y: 0 });
    expect(sound.play).toHaveBeenCalledTimes(2);
  });

  it('cuts a knock still sounding when the next one comes', () => {
    const { voice, body, sound } = build();
    land(voice, body, 3);
    rest(voice, body);
    expect(sound.isPlaying).toBe(true);
    land(voice, body, 3);
    expect(sound.stop).toHaveBeenCalledTimes(1);
    expect(sound.play).toHaveBeenCalledTimes(2);
  });

  describe('which clip', () => {
    it('is picked at random from the prop\'s own', () => {
      const { voice, body, sound } = build({ buffers: ['a', 'b', 'c', 'd'] });
      const played = [];
      for (let i = 0; i < 60; i++) {
        land(voice, body, 3);
        played.push(sound.buffer);
        rest(voice, body);
      }
      expect(new Set(played)).toEqual(new Set(['a', 'b', 'c', 'd']));
    });

    it('is never the same one twice running', () => {
      const { voice, body, sound } = build();
      let last = null;
      for (let i = 0; i < 60; i++) {
        land(voice, body, 3);
        expect(sound.buffer).not.toBe(last);
        last = sound.buffer;
        rest(voice, body);
      }
    });

    it('follows the roll it is given', () => {
      const rolls = [0, 0.99, 0];
      const { voice, body, sound } = build({ random: () => rolls.shift() });
      const played = [];
      for (let i = 0; i < 3; i++) {
        land(voice, body, 3);
        played.push(sound.buffer);
        rest(voice, body);
      }
      expect(played).toEqual(['a', 'c', 'a']);
    });
  });

  describe('in the hand', () => {
    it('is not knocked while carried, however the hold throws it about', () => {
      const { voice, body, sound, held } = build();
      held.held = true;
      for (let i = 0; i < 20; i++) step(voice, body, { x: i % 2 ? 4 : -4 });
      expect(knocks(sound)).toEqual([]);
    });

    it('is not knocked by being picked up or let go', () => {
      const { voice, body, sound, held } = build();
      step(voice, body, { y: -3 });      // falling
      held.held = true;                  // caught: the hold stops it dead
      step(voice, body, { y: 0 });
      step(voice, body, { x: 3 });       // swung about
      held.held = false;                 // let go, still moving
      step(voice, body, { x: 3 });
      step(voice, body, { x: 3 - 0.02 });
      expect(knocks(sound)).toEqual([]);
    });

    it('knocks when it lands after being let go', () => {
      const { voice, body, sound, held } = build();
      held.held = true;
      step(voice, body);
      held.held = false;
      land(voice, body, 3);
      expect(knocks(sound)).toHaveLength(1);
    });

    it('works on a prop that cannot be carried', () => {
      const { voice, body, sound } = build({ pickupable: false });
      land(voice, body, 3);
      expect(sound.play).toHaveBeenCalledTimes(1);
    });
  });

  describe('seated in a socket', () => {
    it('is silent while its body is not dynamic', () => {
      const { voice, body, sound } = build();
      body.dynamic = false;
      for (let i = 0; i < 20; i++) step(voice, body, { y: i % 2 ? 4 : 0 });
      expect(sound.play).not.toHaveBeenCalled();
    });

    it('is not knocked by its body being swapped for another', () => {
      const { voice, prop, body, sound } = build();
      step(voice, body, { y: -3 });
      // Snapped into a socket, then taken out: a new body each time, at rest.
      prop.rigidBody = fakeBody({ dynamic: false });
      step(voice, prop.rigidBody);
      prop.rigidBody = fakeBody();
      step(voice, prop.rigidBody);
      step(voice, prop.rigidBody);
      expect(sound.play).not.toHaveBeenCalled();
    });

    it('carries on with no body at all', () => {
      const { voice, prop } = build();
      prop.rigidBody = null;
      expect(() => voice.onFixedUpdate(DT)).not.toThrow();
    });
  });

  describe('handled', () => {
    it('plays its handling clip when asked: seated in a socket, or taken out', () => {
      const { voice, sound } = build({ volume: 0.5 });
      voice.handle(IMPACT.seatLevel);
      expect(sound.played).toEqual(['h']);
      expect(sound.volume).toBeCloseTo(0.5 * IMPACT.seatLevel);
    });

    it('keeps the two apart: handling never plays a knock, nor a knock the handling clip', () => {
      const { voice, body, sound } = build();
      for (let i = 0; i < 20; i++) {
        voice.handle();
        rest(voice, body);
        land(voice, body, 3);
        rest(voice, body);
      }
      const handled = sound.played.filter((_, i) => i % 2 === 0);
      const landed = sound.played.filter((_, i) => i % 2 === 1);
      expect(new Set(handled)).toEqual(new Set(['h']));
      expect(landed).not.toContain('h');
      expect(new Set(landed)).toEqual(new Set(['a', 'b', 'c']));
    });

    it('handles with its knocks when it has no handling clips of its own', () => {
      const prop = new GameObject('Prop');
      prop.rigidBody = fakeBody();
      const sound = fakeSound();
      const voice = prop.addComponent(new ImpactSound({ buffers: ['a', 'b'], sound }));
      for (let i = 0; i < 20; i++) {
        voice.handle();
        rest(voice, prop.rigidBody);
      }
      expect(new Set(sound.played)).toEqual(new Set(['a', 'b']));
      // One run of clips, so still never the same one twice.
      expect(sound.played.every((clip, i) => clip !== sound.played[i - 1])).toBe(true);
    });

    it('plays once as it is picked up, not for as long as it is held', () => {
      const { voice, body, sound, held } = build();
      step(voice, body);
      held.held = true;
      for (let i = 0; i < 30; i++) step(voice, body);
      expect(sound.played).toEqual(['h']);
      expect(sound.volume).toBeCloseTo(IMPACT.pickUpLevel);
    });

    it('plays again each time it is picked up', () => {
      const { voice, body, sound, held } = build();
      for (let i = 0; i < 3; i++) {
        held.held = true;
        rest(voice, body);
        held.held = false;
        rest(voice, body);
      }
      expect(sound.played).toEqual(['h', 'h', 'h']);
    });

    it('is one sound, not two, taken out of a socket and into the hand', () => {
      const { voice, body, sound, held } = build();
      step(voice, body);
      voice.handle(IMPACT.seatLevel);    // the socket lets go of it
      held.held = true;                  // and it is in the hand
      step(voice, body);
      expect(sound.play).toHaveBeenCalledTimes(1);
      expect(sound.volume).toBeCloseTo(IMPACT.seatLevel);
    });

    it('is hushed by a receiver that makes the sound itself: no clip of its own as it is taken out', () => {
      // A drive lifted out of a reader: the reader's own sound is the one.
      const { voice, body, sound, held } = build();
      step(voice, body);
      voice.hush();
      held.held = true;
      step(voice, body);
      expect(sound.play).not.toHaveBeenCalled();
    });

    it('is only hushed for the moment: the next pick-up sounds', () => {
      const { voice, body, sound, held } = build();
      voice.hush();
      rest(voice, body);
      held.held = true;
      step(voice, body);
      expect(sound.played).toEqual(['h']);
    });

    it('picks up softer than it seats, and both softer than a hard drop', () => {
      expect(IMPACT.pickUpLevel).toBeLessThan(IMPACT.seatLevel);
      expect(IMPACT.seatLevel).toBeLessThan(1);
      expect(IMPACT.pickUpLevel).toBeGreaterThan(0);
    });

    it('sounds as it is picked up whatever its body is', () => {
      // Not dynamic, but in the hand: being picked up still counts.
      const { voice, body, sound, held } = build();
      body.dynamic = false;
      step(voice, body);
      held.held = true;
      step(voice, body);
      expect(sound.play).toHaveBeenCalledTimes(1);
    });
  });

  describe('before the game can be heard', () => {
    it('queues nothing while the browser holds the audio back', () => {
      // Chrome suspends audio until a click. A clip started now would not
      // be dropped: it would sound when the audio woke.
      const { voice, body, sound } = build();
      sound.context = { state: 'suspended' };
      voice.handle(1);
      land(voice, body, 3);
      expect(sound.play).not.toHaveBeenCalled();

      sound.context.state = 'running';
      rest(voice, body);
      land(voice, body, 3);
      expect(sound.play).toHaveBeenCalledTimes(1);
    });

    it('tries again later when asked before the scene has an engine', () => {
      // A drive seated in its box as the room is built: no scene yet.
      const prop = new GameObject('Prop');
      prop.rigidBody = fakeBody();
      const voice = prop.addComponent(new ImpactSound({ clips: IMPACT_SOUNDS.drive.clips }));
      expect(() => { voice.handle(1); voice.knock(1); }).not.toThrow();
      expect(voice.sound).toBeUndefined();   // not given up on
    });
  });

  it('does not ask a sleeping body for its velocity', () => {
    const { voice, body, sound } = build();
    step(voice, body);
    body.linvel.mockClear();
    body.asleep = true;
    for (let i = 0; i < 30; i++) step(voice, body);
    expect(body.linvel).not.toHaveBeenCalled();
    expect(sound.play).not.toHaveBeenCalled();
  });

  it('knocks when something wakes it with a blow', () => {
    const { voice, body, sound } = build();
    body.asleep = true;
    step(voice, body);
    body.asleep = false;
    step(voice, body, { x: 3 });
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it('carries on with no clips or no sound', () => {
    const none = build({ buffers: [] });
    expect(() => land(none.voice, none.body, 3)).not.toThrow();
    expect(none.sound.play).not.toHaveBeenCalled();

    const mute = build({ sound: null });
    expect(() => land(mute.voice, mute.body, 3)).not.toThrow();
  });

  it('builds nothing on an engine with no audio', () => {
    const prop = new GameObject('Prop');
    prop.scene = { userData: { engine: {} } };
    prop.rigidBody = fakeBody();
    const voice = prop.addComponent(new ImpactSound({ clips: IMPACT_SOUNDS.box.clips }));
    expect(() => land(voice, prop.rigidBody, 3)).not.toThrow();
    expect(voice.sound).toBeFalsy();
  });

  it('falls silent and unhooks when the scene is torn down', () => {
    const { voice, body, sound } = build();
    land(voice, body, 3);
    voice.onDestroy();
    expect(sound.isPlaying).toBe(false);
    expect(sound.disconnect).toHaveBeenCalled();
    expect(sound.removeFromParent).toHaveBeenCalled();
  });

  it('gives a box two knocks and a handling clip of its own, and a drive four for both', () => {
    const { box, drive } = IMPACT_SOUNDS;
    expect(box.clips).toEqual(['sfx:box-impact-1', 'sfx:box-impact-2']);
    expect(box.handling).toEqual(['sfx:box-handle']);
    expect(drive.clips).toHaveLength(4);
    expect(drive.handling).toBeUndefined();
    expect(new ImpactSound(drive).handling).toEqual(drive.clips);
  });

  it('has every clip ready before the first drop', () => {
    const { box, drive } = IMPACT_SOUNDS;
    for (const key of [...box.clips, ...box.handling, ...drive.clips]) {
      expect(ASSETS[key], key).toMatchObject({ type: 'audio' });
      expect(ASSETS[key].url, key).toBe(`assets/audio/${key.slice('sfx:'.length)}.mp3`);
      expect(PRELOAD, key).toContain(key);
    }
  });
});
