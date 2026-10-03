// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BreakerPanel } from './BreakerPanel.js';
import { BreakerPuzzle } from '../gameplay/BreakerPuzzle.js';
import { makeRandom } from '../core/Random.js';

// ─────────────────────────────────────────────
// BreakerPanel — the generator's repair screen
// ─────────────────────────────────────────────

const fire = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10 }));
const key = code => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));

describe('BreakerPanel', () => {
  let root, panel, puzzle, onSolved, onClose, onFlick;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    document.body.appendChild(root);
    panel = new BreakerPanel(root, { solvedDelayMs: 500 });
    puzzle = new BreakerPuzzle({ random: makeRandom(11) });
    onSolved = vi.fn();
    onClose = vi.fn();
    onFlick = vi.fn();
    panel.open(puzzle, { onSolved, onClose, onFlick });
  });

  afterEach(() => {
    panel.close();
    root.remove();
    vi.useRealTimers();
  });

  const switches = () => [...root.querySelectorAll('.breaker-switch')];
  const socket = l => root.querySelector(`[data-left="${l}"]`);
  const terminal = r => root.querySelector(`[data-right="${r}"]`);
  const status = () => root.querySelector('.breaker-status').textContent;
  const plug = (l, r) => { fire(socket(l), 'pointerdown'); fire(terminal(r), 'pointerup'); };

  it('opens shown, with one switch per breaker in its current position', () => {
    expect(panel.isOpen).toBe(true);
    expect(root.classList.contains('is-open')).toBe(true);
    expect(switches()).toHaveLength(puzzle.switches.length);
    switches().forEach((el, i) => expect(el.classList.contains('is-on')).toBe(puzzle.switches[i]));
  });

  it('a click flicks a switch, and the screen follows', () => {
    const i = puzzle.switches.indexOf(false);
    fire(switches()[i], 'click');
    expect(puzzle.switches[i]).toBe(true);
    expect(switches()[i].classList.contains('is-on')).toBe(true);
  });

  it('dragging a wire onto its own colour connects it and draws it', () => {
    const r = puzzle.right.indexOf(puzzle.left[0]);
    plug(0, r);
    expect(puzzle.links[0]).toBe(r);
    expect(root.querySelector('[data-link="0"]')).not.toBeNull();
  });

  it('click the socket, then the terminal, works too', () => {
    const r = puzzle.right.indexOf(puzzle.left[1]);
    fire(socket(1), 'pointerdown');
    fire(socket(1), 'pointerup');
    fire(terminal(r), 'pointerup');
    expect(puzzle.links[1]).toBe(r);
  });

  it('the wrong colour sparks and stays off', () => {
    const wrong = puzzle.right.findIndex(c => c !== puzzle.left[0]);
    plug(0, wrong);
    expect(puzzle.links[0]).toBeNull();
    expect(terminal(wrong).classList.contains('is-spark')).toBe(true);
  });

  it('counts progress in its status line', () => {
    expect(status()).toMatch(new RegExp(`${puzzle.switchesOn}\\s*/\\s*${puzzle.switches.length}`));
    expect(status()).toMatch(new RegExp(`0\\s*/\\s*${puzzle.left.length}`));
  });

  it('solving it says so, then hands over and closes', () => {
    puzzle.switches.forEach((on, i) => { if (!on) fire(switches()[i], 'click'); });
    puzzle.left.forEach((c, l) => plug(l, puzzle.right.indexOf(c)));
    expect(status()).toMatch(/restored/i);
    expect(onSolved).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onSolved).toHaveBeenCalledTimes(1);
    expect(panel.isOpen).toBe(false);
  });

  it('Q or Escape steps away, leaving the progress made', () => {
    const i = puzzle.switches.indexOf(false);
    fire(switches()[i], 'click');
    key('KeyQ');
    expect(panel.isOpen).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(root.classList.contains('is-open')).toBe(false);
    expect(puzzle.switches[i]).toBe(true);

    panel.open(puzzle, { onSolved, onClose });
    key('Escape');
    expect(panel.isOpen).toBe(false);
  });

  it('stops listening for keys once closed', () => {
    panel.close();
    onClose.mockClear();
    key('KeyQ');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is a no-op without a DOM', () => {
    const headless = new BreakerPanel(null);
    expect(() => { headless.open(puzzle, {}); headless.close(); }).not.toThrow();
  });

  it('calls onFlick for every switch flicked — the click sound', () => {
    fire(switches()[0], 'click');
    fire(switches()[1], 'click');
    expect(onFlick).toHaveBeenCalledTimes(2);
  });

  it('a terminal takes the lead anywhere inside its ring, not just on the outline', () => {
    const r = puzzle.right.indexOf(puzzle.left[0]);
    const t = terminal(r);
    // The whole disc is a target: painted (if faintly), and hit-testable.
    expect(t.getAttribute('fill')).not.toBe('none');
    expect(t.getAttribute('pointer-events')).toBe('all');
  });

  it('dropping a lead near a terminal snaps it on — it need not land on the ring', () => {
    const r = puzzle.right.indexOf(puzzle.left[2]);
    const c = panel._terminalCentre(r);
    panel._toSvg = () => ({ x: c.x - 20, y: c.y + 15 });   // a near miss, off the disc
    fire(socket(2), 'pointerdown');
    fire(root.querySelector('.breaker-wires'), 'pointerup');
    expect(puzzle.links[2]).toBe(r);
  });

  it('a drop far from every terminal just lets go', () => {
    panel._toSvg = () => ({ x: 200, y: 5 });
    fire(socket(3), 'pointerdown');
    fire(root.querySelector('.breaker-wires'), 'pointerup');
    expect(puzzle.links[3]).toBeNull();
    expect(panel._held).toBeNull();
  });

  it('picks up a lead from near its socket too', () => {
    const c = panel._leadCentre(1);
    panel._toSvg = () => ({ x: c.x + 18, y: c.y - 10 });
    fire(root.querySelector('.breaker-wires'), 'pointerdown');
    expect(panel._held).toBe(1);
  });
});
