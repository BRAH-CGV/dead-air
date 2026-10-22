import { describe, it, expect, vi } from 'vitest';
import { Footsteps, STEP_SOUNDS } from './Footsteps.js';
import { GameObject } from '../core/GameObject.js';
import { ASSETS } from '../assets/manifest.js';

function fakeSound() {
  const sound = {
    isPlaying: false, volume: 0, detune: 0, offset: 0, duration: undefined,
    play: vi.fn(() => { sound.isPlaying = true; }),
    stop: vi.fn(() => { sound.isPlaying = false; }),
    setVolume: vi.fn((v) => { sound.volume = v; }),
    setDetune: vi.fn((c) => { sound.detune = c; }),
    disconnect: vi.fn(),
  };
  return sound;
}

function seeded(seed) {
  let a = seed;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

function build({ outside = false, suit = null, surface = 'floor' } = {}) {
  const controller = { grounded: true, groundSpeed: 0, vertVel: 0, crouched: false, enabled: true };
  const voices = Array.from({ length: STEP_SOUNDS.voices }, fakeSound);
  const woodVoices = Array.from({ length: STEP_SOUNDS.woodVoices }, fakeSound);
  const plays = [];
  for (const [pool, list] of [['steps', voices], ['wood', woodVoices]]) {
    for (const v of list) v.play.mockImplementation(() => { v.isPlaying = true; plays.push({ pool, offset: v.offset, duration: v.duration, volume: v.volume, detune: v.detune }); });
  }
  const under = { surface };
  const go = new GameObject('Player');
  const feet = go.addComponent(new Footsteps({
    controller, isOutside: () => outside, surfaceUnder: () => under.surface, suit, voices, woodVoices, random: seeded(5),
  }));
  feet.onStart();
  return { feet, controller, plays, under };
}

const tick = (feet, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) feet.onUpdate(1 / 60); };
const isInterior = p => p.pool === 'steps' && STEP_SOUNDS.interior.some(c => c[0] === p.offset);
const isExterior = p => p.pool === 'steps' && STEP_SOUNDS.exterior.some(c => c[0] === p.offset);

describe('Footsteps', () => {
  it('the steps are in the manifest, cut into three interior steps and two outdoor thumps', () => {
    expect(ASSETS[STEP_SOUNDS.key]).toMatchObject({ type: 'audio' });
    expect(STEP_SOUNDS.interior).toHaveLength(3);
    expect(STEP_SOUNDS.exterior).toHaveLength(2);
  });

  it('indoors, walking plays the interior steps: a different one each time, quiet', () => {
    const { feet, controller, plays } = build();
    controller.groundSpeed = 5;
    tick(feet, 3);
    expect(plays.length).toBeGreaterThan(4);
    expect(plays.every(isInterior)).toBe(true);
    for (let i = 1; i < plays.length; i++) expect(plays[i].offset).not.toBe(plays[i - 1].offset);
    for (const p of plays) expect(p.volume).toBeLessThanOrEqual(STEP_SOUNDS.volume);
    expect(STEP_SOUNDS.volume).toBeLessThanOrEqual(0.05);  // the recording is hot
  });

  it('outside, each step is the interior one turned down with an outdoor thump under it', () => {
    const inside = build();
    inside.controller.groundSpeed = 5;
    tick(inside.feet, 3);
    const out = build({ outside: true });
    out.controller.groundSpeed = 5;
    tick(out.feet, 3);
    const steps = out.plays.filter(isInterior), thumps = out.plays.filter(isExterior);
    expect(thumps.length).toBe(steps.length);
    const mean = a => a.reduce((x, p) => x + p.volume, 0) / a.length;
    expect(mean(steps)).toBeLessThan(mean(inside.plays));
  });

  it('the hiss over the steps is filtered off, the thud left', () => {
    expect(STEP_SOUNDS.lowpass).toBeGreaterThanOrEqual(2000);
    expect(STEP_SOUNDS.lowpass).toBeLessThanOrEqual(4000);
    expect(STEP_SOUNDS.thump).toBeLessThanOrEqual(0.15);
  });

  it('muffled in the EVA suit: heard from inside the helmet', () => {
    const suit = { worn: false };
    const { feet } = build({ suit });
    expect(feet.cutoff('interior')).toBe(STEP_SOUNDS.lowpass);
    suit.worn = true;
    expect(feet.cutoff('interior')).toBe(STEP_SOUNDS.suitLowpass);
    expect(STEP_SOUNDS.suitLowpass).toBeLessThan(STEP_SOUNDS.lowpass);
  });

  it('outside it is the sand\'s crunch: the outdoor thump leads, the interior step under it, and the crunch is never filtered off', () => {
    expect(STEP_SOUNDS.thump).toBeGreaterThan(STEP_SOUNDS.volume * STEP_SOUNDS.outsideShare * 2);
    const suit = { worn: false };
    const { feet } = build({ suit });
    expect(feet.cutoff('exterior')).toBeGreaterThanOrEqual(15000);
    suit.worn = true;                                        // always, outside
    expect(feet.cutoff('exterior')).toBeGreaterThanOrEqual(4000);
  });

  it('on a desk or a table: the wood thuds, as quiet as a step on the floor', () => {
    expect(ASSETS[STEP_SOUNDS.woodKey]).toMatchObject({ type: 'audio' });
    const { feet, controller, plays } = build({ surface: 'wood' });
    controller.groundSpeed = 5;
    tick(feet, 3);
    expect(plays.length).toBeGreaterThan(3);
    expect(plays.every(p => p.pool === 'wood' && STEP_SOUNDS.wood.some(c => c[0] === p.offset))).toBe(true);
    for (const p of plays) expect(p.volume).toBeLessThanOrEqual(STEP_SOUNDS.volume);
  });

  it('on the bed: a step heard through the mattress — very muffled and quieter', () => {
    const { feet, controller, plays } = build({ surface: 'bed' });
    controller.groundSpeed = 5;
    tick(feet, 3);
    expect(plays.length).toBeGreaterThan(3);
    expect(plays.every(isInterior)).toBe(true);
    for (const p of plays) expect(p.volume).toBeLessThanOrEqual(STEP_SOUNDS.volume * STEP_SOUNDS.bed);
    expect(feet.cutoff('bed')).toBeLessThanOrEqual(500);
  });

  it('a jump off the desk and the landing on the floor each sound of what they were on', () => {
    const { feet, controller, plays, under } = build({ surface: 'wood' });
    tick(feet, 0.2);
    controller.grounded = false;
    controller.vertVel = 4;
    tick(feet, 0.3);
    controller.vertVel = -5;
    tick(feet, 0.3);
    under.surface = 'floor';
    controller.grounded = true;
    controller.vertVel = 0;
    tick(feet, 1 / 60);
    expect(plays.map(p => p.pool)).toEqual(['wood', 'steps']);
  });

  it('jumping and landing make themselves heard', () => {
    const { feet, controller, plays } = build();
    tick(feet, 0.2);
    controller.grounded = false;
    controller.vertVel = 4;
    tick(feet, 0.3);
    expect(plays).toHaveLength(1);
    controller.vertVel = -5;
    tick(feet, 0.3);
    controller.grounded = true;
    controller.vertVel = 0;
    tick(feet, 1 / 60);
    expect(plays).toHaveLength(2);
  });

  it('nothing while the controller is off (the fly camera, a cutscene)', () => {
    const { feet, controller, plays } = build();
    controller.enabled = false;
    controller.groundSpeed = 5;
    tick(feet, 2);
    expect(plays).toHaveLength(0);
  });
});
