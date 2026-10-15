import { describe, it, expect, vi } from 'vitest';
import { MonitorSpeaker, MONITOR, monitorCurve } from './MonitorSpeaker.js';

// ─────────────────────────────────────────────
// jsdom has no Web Audio: a stand-in context that records what is built and
// what each node is connected to.
// ─────────────────────────────────────────────

function fakeNode(kind) {
  const node = {
    kind,
    out: [],
    connect: vi.fn((to) => { node.out.push(to); return to; }),
    disconnect: vi.fn(() => { node.out = []; }),
  };
  const param = () => ({ value: 0, setTargetAtTime: vi.fn(function (v) { this.value = v; }) });
  if (kind === 'biquad') Object.assign(node, { type: '', frequency: param(), Q: param(), gain: param() });
  if (kind === 'gain') node.gain = param();
  if (kind === 'shaper') Object.assign(node, { curve: null, oversample: 'none' });
  return node;
}

/** A THREE.AudioListener stand-in: its gain wired to the destination. */
function fakeListener() {
  const context = {
    currentTime: 0,
    destination: fakeNode('destination'),
    createBiquadFilter: () => fakeNode('biquad'),
    createGain: () => fakeNode('gain'),
    createWaveShaper: () => fakeNode('shaper'),
  };
  const gain = fakeNode('gain');
  gain.connect(context.destination);
  return { context, gain, getInput: () => gain };
}

/** The nodes from `node` down to the end of the chain. */
function walk(node) {
  const chain = [node];
  while (node.out.length) chain.push(node = node.out[0]);
  return chain;
}

describe('monitorCurve', () => {
  const curve = monitorCurve(1025, 2.5);

  it('is a soft clip: -1 … 1, through the middle, odd', () => {
    expect(curve[0]).toBeCloseTo(-1);
    expect(curve[1024]).toBeCloseTo(1);
    expect(curve[512]).toBeCloseTo(0);
    expect(curve[300]).toBeCloseTo(-curve[724]);
  });

  it('lifts a quiet signal and squashes a loud one', () => {
    const at = x => curve[Math.round((x + 1) / 2 * 1024)];
    expect(at(0.05)).toBeGreaterThan(0.05 * 1.5);
    expect(at(0.9) - at(0.6)).toBeLessThan(0.3 * 0.6);
  });
});

describe('MonitorSpeaker', () => {
  it('is a small speaker: band-limited, with a ring and a bite, out to the ears', () => {
    const listener = fakeListener();
    const speaker = new MonitorSpeaker(listener);
    const chain = walk(speaker.input);
    expect(chain.at(-1)).toBe(listener.context.destination);

    const filters = chain.filter(n => n.kind === 'biquad');
    const highpass = filters.find(f => f.type === 'highpass');
    const lowpass = filters.find(f => f.type === 'lowpass');
    expect(highpass.frequency.value).toBeGreaterThan(200);
    expect(lowpass.frequency.value).toBeLessThan(5000);
    expect(filters.some(f => f.type === 'peaking' && f.gain.value > 0)).toBe(true);
    expect(chain.some(n => n.kind === 'shaper' && n.curve)).toBe(true);
  });

  it('leaves the listener alone until engaged', () => {
    const listener = fakeListener();
    new MonitorSpeaker(listener);
    expect(listener.gain.out).toEqual([listener.context.destination]);
  });

  it('engaged, everything the listener hears goes through it, well down', () => {
    const listener = fakeListener();
    const speaker = new MonitorSpeaker(listener);
    speaker.engage(true, 1);
    const chain = walk(listener.gain);
    expect(chain).toContain(speaker.input);
    expect(chain.at(-1)).toBe(listener.context.destination);
    const gate = chain[1];
    expect(gate.gain.value).toBe(MONITOR.level);
    expect(MONITOR.level).toBeLessThan(0.5);
  });

  it('a level of 0 cuts it (a switch’s static), and it comes back with the level', () => {
    const listener = fakeListener();
    const speaker = new MonitorSpeaker(listener);
    speaker.engage(true, 0);
    const gate = walk(listener.gain)[1];
    expect(gate.gain.value).toBe(0);
    speaker.engage(true, 0.5);
    expect(gate.gain.value).toBeCloseTo(MONITOR.level * 0.5);
    expect(gate.gain.setTargetAtTime).toHaveBeenCalled();   // ramped, not stepped
  });

  it('disengaged, the listener goes straight to the ears again', () => {
    const listener = fakeListener();
    const speaker = new MonitorSpeaker(listener);
    speaker.engage(true);
    speaker.engage(false);
    expect(listener.gain.out).toEqual([listener.context.destination]);
  });

  it('route() plays a sound out of it, fuzzy and never gated', () => {
    const listener = fakeListener();
    const speaker = new MonitorSpeaker(listener);
    const sound = { gain: fakeNode('gain') };
    sound.gain.connect(listener.gain);
    expect(speaker.route(sound)).toBe(sound);
    expect(sound.gain.out).toEqual([speaker.input]);
  });

  it('route(…, { dry: true }) plays it out of the monitor as it is', () => {
    const listener = fakeListener();
    const speaker = new MonitorSpeaker(listener);
    const sound = { gain: fakeNode('gain') };
    speaker.route(sound, { dry: true });
    const chain = walk(sound.gain);
    expect(chain).not.toContain(speaker.input);
    expect(chain.some(n => n.kind === 'shaper')).toBe(false);
    expect(chain.at(-1)).toBe(listener.context.destination);
  });

  it('without audio it builds nothing, and leaves sounds as they are', () => {
    const speaker = new MonitorSpeaker(null);
    expect(speaker.input).toBeNull();
    expect(speaker.route(null)).toBeNull();
    const sound = { gain: fakeNode('gain') };
    expect(speaker.route(sound)).toBe(sound);
    expect(sound.gain.disconnect).not.toHaveBeenCalled();
    expect(() => { speaker.engage(true); speaker.dispose(); }).not.toThrow();
  });

  it('dispose() gives the listener back and unhooks itself', () => {
    const listener = fakeListener();
    const speaker = new MonitorSpeaker(listener);
    speaker.engage(true);
    const chain = walk(listener.gain).slice(1, -1);
    speaker.dispose();
    expect(listener.gain.out).toEqual([listener.context.destination]);
    for (const node of chain) expect(node.disconnect).toHaveBeenCalled();
  });
});
