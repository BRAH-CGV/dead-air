// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntroPlayer, BEGIN_DELAY } from './IntroPlayer.js';
import { INTRO_BEATS, INTRO_SECONDS } from './IntroTimeline.js';

// ─────────────────────────────────────────────
// IntroPlayer — the intro on the page: a clock, a canvas, the captions
// ─────────────────────────────────────────────

/** requestAnimationFrame on a clock the test turns by hand. */
function fakeFrames() {
  let queue = [];
  let id = 0;
  const f = {
    now: 0,
    raf: vi.fn((cb) => { queue.push({ id: ++id, cb }); return id; }),
    caf: vi.fn((n) => { queue = queue.filter(q => q.id !== n); }),
    get pending() { return queue.length; },
    /** Run the frames, `ms` apart, for `seconds`. */
    run(seconds, ms = 50) {
      for (let t = 0; t < seconds * 1000 - 1e-6; t += ms) {
        f.now += ms;
        const due = queue;
        queue = [];
        for (const q of due) q.cb(f.now);
      }
    },
  };
  return f;
}

function makeRoot() {
  document.body.innerHTML = '<div id="intro" hidden></div>';
  const root = document.getElementById('intro');
  Object.defineProperty(root, 'clientWidth', { value: 1280 });
  Object.defineProperty(root, 'clientHeight', { value: 720 });
  return root;
}

const fakeContext = () => new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : (t[k] = vi.fn(() => ({ addColorStop: vi.fn() })))),
  set: (t, k, v) => { t[k] = v; return true; },
});

const beatStart = (id) => {
  let t = 0;
  for (const b of INTRO_BEATS) { if (b.id === id) return t; t += b.seconds; }
  throw new Error(id);
};

describe('IntroPlayer', () => {
  let root, frames, ctx, intro, onBegin;

  beforeEach(() => {
    root = makeRoot();
    frames = fakeFrames();
    ctx = fakeContext();
    onBegin = vi.fn();
    intro = new IntroPlayer(root, {
      raf: frames.raf, caf: frames.caf, now: () => frames.now,
      random: () => 0.5, context: () => ctx, onBegin,
    });
  });

  const caption = () => root.querySelector('.intro-caption');
  const card = () => root.querySelector('.intro-card');

  it('builds its canvas, caption and end card into the root, hidden until played', () => {
    expect(root.querySelector('canvas')).not.toBeNull();
    expect(caption()).not.toBeNull();
    expect(card()).not.toBeNull();
    expect(root.hidden).toBe(true);
    expect(intro.playing).toBe(false);
  });

  it('play() shows it from the start and runs its clock on animation frames', () => {
    intro.play();
    expect(root.hidden).toBe(false);
    expect(intro.playing).toBe(true);
    frames.run(1);
    expect(intro.time).toBeCloseTo(1, 1);
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('captions each beat, fading in', () => {
    intro.play();
    frames.run(0.1);
    expect(caption().textContent).toBe(INTRO_BEATS[0].caption);
    const early = Number(caption().style.opacity);
    frames.run(1);
    expect(Number(caption().style.opacity)).toBeGreaterThan(early);
    frames.run(beatStart('colony') + 0.5 - intro.time);
    expect(caption().textContent).toBe(INTRO_BEATS[1].caption);
  });

  it('names the array it posts the player to', () => {
    intro.play();
    frames.run(beatStart('landing') + 1);
    expect(caption().textContent).toMatch(/^You have been assigned to ARRAY [A-Z]-\d{2}/);
    expect(intro.array).toMatch(/^ARRAY /);
  });

  it('a long stall (a hidden tab) never skips beats', () => {
    intro.play();
    frames.run(0.05);
    frames.run(5, 5000);
    expect(intro.time).toBeLessThan(1);
  });

  it('holds the end card, with the array on it, until the player begins', () => {
    intro.play();
    frames.run(INTRO_SECONDS + 3, 100);
    expect(intro.atEnd).toBe(true);
    expect(card().hidden).toBe(false);
    expect(card().textContent).toContain(intro.array);
    expect(onBegin).not.toHaveBeenCalled();
    expect(intro.playing).toBe(true);
  });

  it('the end card hides while the story plays', () => {
    intro.play();
    frames.run(1);
    expect(card().hidden).toBe(true);
  });

  it('skip() goes straight to the end card', () => {
    intro.play();
    frames.run(1);
    intro.skip();
    frames.run(0.05);
    expect(intro.atEnd).toBe(true);
    expect(card().hidden).toBe(false);
  });

  it('advance() skips, then begins — but not on the same double click', () => {
    intro.play();
    frames.run(1);
    intro.advance();
    expect(intro.atEnd).toBe(true);
    intro.advance();                      // straight after: ignored
    expect(onBegin).not.toHaveBeenCalled();
    frames.run(BEGIN_DELAY + 0.1);
    intro.advance();
    expect(onBegin).toHaveBeenCalledTimes(1);
  });

  it('a click on it advances, and begins inside the click', () => {
    intro.play();
    root.click();
    expect(intro.atEnd).toBe(true);
    frames.run(BEGIN_DELAY + 0.1);
    root.click();
    expect(onBegin).toHaveBeenCalledTimes(1);
  });

  it('stop() hides it and stops asking for frames', () => {
    intro.play();
    frames.run(0.5);
    intro.stop();
    expect(root.hidden).toBe(true);
    expect(intro.playing).toBe(false);
    expect(frames.pending).toBe(0);
    root.click();
    expect(onBegin).not.toHaveBeenCalled();
  });

  it('play() again starts over, with a new array', () => {
    let r = 0.1;
    intro = new IntroPlayer(root, {
      raf: frames.raf, caf: frames.caf, now: () => frames.now,
      random: () => (r = (r + 0.37) % 1), context: () => ctx, onBegin,
    });
    intro.play();
    const first = intro.array;
    frames.run(3);
    intro.play();
    expect(intro.time).toBe(0);
    expect(intro.array).not.toBe(first);
    expect(frames.pending).toBe(1);
  });

  it('setHint() says why a begin didn\'t take, until the next begin', () => {
    intro.play();
    intro.skip();
    intro.setHint('Click again to take control of the mouse.');
    expect(card().textContent).toContain('Click again');
    frames.run(BEGIN_DELAY + 0.1);
    intro.advance();
    expect(card().textContent).not.toContain('Click again');
  });

  it('draws nothing without a 2D context, but still keeps time', () => {
    intro = new IntroPlayer(root, {
      raf: frames.raf, caf: frames.caf, now: () => frames.now, context: () => null,
    });
    intro.play();
    expect(() => frames.run(1)).not.toThrow();
    expect(intro.time).toBeGreaterThan(0.5);
  });

  it('fromDocument() finds #intro, or gives null when the page has none', () => {
    expect(IntroPlayer.fromDocument(document, { context: () => null })).toBeInstanceOf(IntroPlayer);
    document.body.innerHTML = '';
    expect(IntroPlayer.fromDocument(document)).toBe(null);
  });
});
