// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { TutorialOverlay, placeArrow, ARROW, tutorialKeys } from './TutorialOverlay.js';
import { setInteractKey } from './promptKeys.js';

const W = 1000, H = 600;
const place = (x, y, behind = false) => placeArrow({ x, y, behind }, W, H, {});

describe('placeArrow', () => {
  it('a target on screen: the arrow stands over it, pointing down at it', () => {
    const a = place(0, 0);
    expect(a.onScreen).toBe(true);
    expect(a.x).toBeCloseTo(W / 2);
    expect(a.y).toBeCloseTo(H / 2 - ARROW.above);
    expect(a.angle).toBeCloseTo(Math.PI / 2);   // screen y runs down
  });

  it('NDC up is screen up', () => {
    const a = place(0.5, 0.5);
    expect(a.x).toBeCloseTo(W * 0.75);
    expect(a.y).toBeCloseTo(H * 0.25 - ARROW.above);
  });

  it('a target off to the right: pinned to the right edge, pointing right', () => {
    const a = place(3, 0);
    expect(a.onScreen).toBe(false);
    expect(a.x).toBeCloseTo(W - ARROW.margin);
    expect(a.y).toBeCloseTo(H / 2);
    expect(a.angle).toBeCloseTo(0);
  });

  it('a target high up and left: on the edge it meets first, pointing at it', () => {
    const a = place(-2, 4);
    expect(a.onScreen).toBe(false);
    expect(a.y).toBeCloseTo(ARROW.margin);
    expect(a.x).toBeGreaterThan(ARROW.margin);
    expect(a.x).toBeLessThan(W / 2);
    expect(Math.cos(a.angle)).toBeLessThan(0);
    expect(Math.sin(a.angle)).toBeLessThan(0);
  });

  it('a target behind: the projection is mirrored, so it points the other way', () => {
    const a = place(0.3, 0, true);
    expect(a.onScreen).toBe(false);
    expect(a.x).toBeCloseTo(ARROW.margin);
    expect(Math.cos(a.angle)).toBeCloseTo(-1);
  });

  it('dead behind: points down, to turn round', () => {
    const a = place(0, 0, true);
    expect(a.onScreen).toBe(false);
    expect(a.angle).toBeCloseTo(Math.PI / 2);
    expect(a.y).toBeCloseTo(H - ARROW.margin);
  });

  it('writes into the object it is given', () => {
    const out = {};
    expect(placeArrow({ x: 0, y: 0, behind: false }, W, H, out)).toBe(out);
  });
});

describe('TutorialOverlay', () => {
  let root, overlay;

  beforeEach(() => {
    root = document.createElement('div');
    overlay = new TutorialOverlay(root);
  });

  it('builds its own markup, hidden', () => {
    expect(root.querySelector('.tutorial-title')).not.toBe(null);
    expect(root.querySelector('.tutorial-text')).not.toBe(null);
    expect(root.querySelector('.tutorial-arrow')).not.toBe(null);
    expect(root.style.display).toBe('none');
  });

  it('shows the big words and the line under them', () => {
    overlay.show({ title: 'USE THE COMPUTER', text: '[E] at the monitor.', compact: false });
    expect(root.style.display).not.toBe('none');
    expect(root.querySelector('.tutorial-title').textContent).toBe('USE THE COMPUTER');
    expect(root.querySelector('.tutorial-text').textContent).toBe('[E] at the monitor.');
    expect(root.classList.contains('compact')).toBe(false);
  });

  // The page's stylesheet hides #tutorial (index.html): show() has to win
  // over it, not just clear its own inline style.
  it("shows over the page's own rule that hides it", () => {
    document.head.innerHTML = '<style>#tutorial { display: none; }</style>';
    document.body.innerHTML = '<div id="tutorial"></div>';
    const el = document.getElementById('tutorial');
    overlay = new TutorialOverlay(el);
    expect(getComputedStyle(el).display).toBe('none');
    overlay.show({ title: 'X', text: 'y', compact: false });
    expect(getComputedStyle(el).display).not.toBe('none');
    overlay.hide();
    expect(getComputedStyle(el).display).toBe('none');
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('names the bound interact key', () => {
    overlay = new TutorialOverlay(root, { keyLabel: t => t.replaceAll('[E]', '[F]') });
    overlay.show({ title: 'X', text: '[E] at the monitor.', compact: false });
    expect(root.querySelector('.tutorial-text').textContent).toBe('[F] at the monitor.');
  });

  it('a standing note under the card (the skip line), and none when the view has none', () => {
    const note = root.querySelector('.tutorial-note');
    expect(note).not.toBe(null);
    overlay.show({ title: 'X', text: 'y', note: 'Sleep until 6 AM at the bunk to skip the tutorial.', compact: false });
    expect(note.textContent).toBe('Sleep until 6 AM at the bunk to skip the tutorial.');
    expect(note.style.display).not.toBe('none');
    overlay.show({ title: 'X', text: 'y', note: '', compact: false });
    expect(note.style.display).toBe('none');
    overlay.show({ title: 'X', text: 'y', compact: false });
    expect(note.style.display).toBe('none');
  });

  it('compact while the computer is up', () => {
    overlay.show({ title: 'SCAN IT', text: 'Enter.', compact: true });
    expect(root.classList.contains('compact')).toBe(true);
  });

  it('moves and turns the arrow, or hides it', () => {
    const arrow = root.querySelector('.tutorial-arrow');
    overlay.setArrow({ x: 100, y: 50, angle: Math.PI / 2, onScreen: true });
    expect(arrow.style.display).toBe('');
    expect(arrow.style.transform).toContain('translate(100px, 50px)');
    expect(arrow.style.transform).toContain('rotate(90deg)');
    overlay.setArrow(null);
    expect(arrow.style.display).toBe('none');
  });

  it('hide() takes it all down', () => {
    overlay.show({ title: 'X', text: 'y', compact: false });
    overlay.hide();
    expect(root.style.display).toBe('none');
  });
});

describe('tutorialKeys', () => {
  const binds = { flashlight: 'KeyF', rotateHeld: 'KeyR' };

  it('names the keys the flashlight and the rotate key are bound to', () => {
    expect(tutorialKeys('[F] turns it on. [R] changes the alarm.', binds))
      .toBe('[F] turns it on. [R] changes the alarm.');
    expect(tutorialKeys('[F] turns it on. [R] changes the alarm.', { flashlight: 'KeyL', rotateHeld: 'KeyT' }))
      .toBe('[L] turns it on. [T] changes the alarm.');
  });

  it('keeps keys swapped by a rebind apart', () => {
    setInteractKey('F');
    try {
      expect(tutorialKeys('[E] uses it. [F] lights it.', { flashlight: 'KeyE', rotateHeld: 'KeyR' }))
        .toBe('[F] uses it. [E] lights it.');
    } finally {
      setInteractKey('E');
    }
  });

  it('leaves text without those keys alone', () => {
    expect(tutorialKeys('Press Enter.', binds)).toBe('Press Enter.');
    expect(tutorialKeys('', binds)).toBe('');
  });
});
