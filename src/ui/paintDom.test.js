// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { paintDom } from './paintDom.js';

// ─────────────────────────────────────────────
// paintDom  –  an overlay's own DOM, painted into a 2D canvas (#161)
// ─────────────────────────────────────────────
// jsdom does no layout, so each element's box is stubbed.

function box(el, x, y, w, h) {
  el.getBoundingClientRect = () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y });
  return el;
}

function fakeCtx() {
  return {
    save: vi.fn(), restore: vi.fn(), scale: vi.fn(),
    fillRect: vi.fn(), strokeRect: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(),
    beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(), arc: vi.fn(),
    setLineDash: vi.fn(),
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', globalAlpha: 1, textBaseline: '', textAlign: '',
  };
}

describe('paintDom', () => {
  let root, ctx;

  beforeEach(() => {
    document.body.innerHTML = '';
    root = box(document.createElement('div'), 0, 0, 800, 400);
    document.body.append(root);
    ctx = fakeCtx();
  });

  it('scales the overlay\'s layout to the canvas', () => {
    paintDom(root, ctx, 400, 200);
    expect(ctx.scale).toHaveBeenCalledWith(0.5, 0.5);
  });

  it('paints from the layout untransformed, and puts the transform back', () => {
    root.style.transform = 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,5,5,0,1)';
    let during;
    root.getBoundingClientRect = () => { during = root.style.transform; return { left: 0, top: 0, width: 800, height: 400 }; };
    paintDom(root, ctx, 800, 400);
    expect(during).toBe('none');
    expect(root.style.transform).toContain('matrix3d');
  });

  it('fills backgrounds, at the element\'s place in the overlay', () => {
    const panel = box(document.createElement('div'), 110, 60, 200, 100);
    panel.style.backgroundColor = 'rgb(10, 20, 30)';
    root.append(panel);
    paintDom(root, ctx, 800, 400);
    expect(ctx.roundRect).toHaveBeenCalledWith(110, 60, 200, 100, 0);
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('draws borders', () => {
    const panel = box(document.createElement('div'), 0, 0, 50, 50);
    panel.style.border = '2px solid rgb(200, 0, 0)';
    root.append(panel);
    paintDom(root, ctx, 800, 400);
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.strokeStyle).toBe('rgb(200, 0, 0)');
  });

  it('draws canvases as they are', () => {
    const canvas = box(document.createElement('canvas'), 10, 20, 300, 200);
    canvas.width = 300; canvas.height = 200;
    root.append(canvas);
    paintDom(root, ctx, 800, 400);
    expect(ctx.drawImage).toHaveBeenCalledWith(canvas, 10, 20, 300, 200);
  });

  it('skips what is not displayed', () => {
    const gone = box(document.createElement('div'), 0, 0, 50, 50);
    gone.style.display = 'none';
    gone.style.backgroundColor = 'red';
    const canvas = box(document.createElement('canvas'), 0, 0, 10, 10);
    canvas.width = 10;
    gone.append(canvas);
    root.append(gone);
    paintDom(root, ctx, 800, 400);
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('ignores the root\'s own opacity and visibility: on a screen, the DOM is invisible on the page', () => {
    root.style.opacity = '0';
    root.style.visibility = 'hidden';
    const panel = box(document.createElement('div'), 0, 0, 50, 50);
    panel.style.backgroundColor = 'blue';
    panel.style.visibility = 'visible';
    root.append(panel);
    paintDom(root, ctx, 800, 400);
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('a hidden child is not painted, a faded one is painted faded', () => {
    const hidden = box(document.createElement('div'), 0, 0, 50, 50);
    hidden.style.visibility = 'hidden';
    hidden.style.backgroundColor = 'blue';
    root.append(hidden);
    paintDom(root, ctx, 800, 400);
    expect(ctx.fill).not.toHaveBeenCalled();

    hidden.style.visibility = '';
    hidden.style.opacity = '0.5';
    const alphas = [];
    ctx.fill = vi.fn(() => alphas.push(ctx.globalAlpha));
    paintDom(root, ctx, 800, 400);
    expect(alphas).toEqual([0.5]);
  });

  it('writes text where the layout put it', () => {
    const label = box(document.createElement('div'), 20, 30, 200, 20);
    label.textContent = '  LIVING   QUARTERS ';
    label.style.color = 'rgb(1, 2, 3)';
    root.append(label);
    document.createRange = () => ({
      selectNodeContents() {}, setStart() {}, setEnd() {},
      getClientRects: () => [{ left: 22, top: 30, width: 150, height: 20, right: 172, bottom: 50 }],
    });
    paintDom(root, ctx, 800, 400);
    expect(ctx.fillText).toHaveBeenCalledWith('LIVING QUARTERS', 22, 40);
    expect(ctx.fillStyle).toBe('rgb(1, 2, 3)');
  });

  it('draws a range slider: its track, and its thumb where its value is', () => {
    const slider = box(document.createElement('input'), 100, 100, 200, 20);
    slider.type = 'range';
    slider.min = '0'; slider.max = '1'; slider.step = '0.01'; slider.value = '0.25';
    root.append(slider);
    paintDom(root, ctx, 800, 400);
    // The thumb's middle runs from its radius in to its radius short of the end.
    const [x, y, radius] = ctx.arc.mock.calls[0];
    expect(x).toBeCloseTo(100 + radius + (200 - 2 * radius) * 0.25);
    expect(y).toBeCloseTo(110);
  });
});

describe('paintDom keeps what it read (the frame rate, leaned in)', () => {
  let root, ctx, styles;

  beforeEach(() => {
    document.body.innerHTML = '';
    root = box(document.createElement('div'), 0, 0, 800, 400);
    const panel = box(document.createElement('div'), 10, 10, 100, 50);
    panel.style.backgroundColor = 'blue';
    root.append(panel);
    document.body.append(root);
    ctx = fakeCtx();
    styles = vi.spyOn(window, 'getComputedStyle');
  });

  it('reads the layout once, then only draws it again', () => {
    paintDom(root, ctx, 800, 400);
    const read = styles.mock.calls.length;
    expect(read).toBeGreaterThan(0);
    paintDom(root, ctx, 800, 400);
    paintDom(root, ctx, 800, 400);
    expect(styles.mock.calls.length).toBe(read);
    expect(ctx.fill).toHaveBeenCalledTimes(3);
  });

  it('reads it again once the DOM changes', () => {
    paintDom(root, ctx, 800, 400);
    const read = styles.mock.calls.length;
    root.firstChild.style.backgroundColor = 'red';
    paintDom(root, ctx, 800, 400);
    expect(styles.mock.calls.length).toBeGreaterThan(read);
  });

  it('but not when the root is only moved: ScreenView lays it on the screen every frame', () => {
    paintDom(root, ctx, 800, 400);
    const read = styles.mock.calls.length;
    root.style.transform = 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,9,9,0,1)';
    paintDom(root, ctx, 800, 400);
    expect(styles.mock.calls.length).toBe(read);
    root.classList.add('is-flash');      // a class on it is a change of look
    paintDom(root, ctx, 800, 400);
    expect(styles.mock.calls.length).toBeGreaterThan(read);
  });

  it('…and when the pointer moves over something (a hover changes its look)', () => {
    paintDom(root, ctx, 800, 400);
    const read = styles.mock.calls.length;
    root.firstChild.dispatchEvent(new Event('pointerover', { bubbles: true }));
    paintDom(root, ctx, 800, 400);
    expect(styles.mock.calls.length).toBeGreaterThan(read);
  });

  it('…and every so often, for CSS animations (the REC mark blinking)', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    paintDom(root, ctx, 800, 400);
    const read = styles.mock.calls.length;
    now.mockReturnValue(1000 + 100);
    paintDom(root, ctx, 800, 400);
    expect(styles.mock.calls.length).toBe(read);
    now.mockReturnValue(1000 + 300);
    paintDom(root, ctx, 800, 400);
    expect(styles.mock.calls.length).toBeGreaterThan(read);
    now.mockRestore();
  });

  it('draws canvases as they are now, though the layout was read before', () => {
    const canvas = box(document.createElement('canvas'), 0, 0, 10, 10);
    canvas.width = 10;
    root.append(canvas);
    paintDom(root, ctx, 800, 400);
    paintDom(root, ctx, 800, 400);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
  });
});

describe('paintDom live elements (data-paint-live)', () => {
  let root, ctx, styles, line;

  /** jsdom has no layout: offsets stubbed. */
  function offsets(el, left, top, width, height, parent) {
    Object.defineProperties(el, {
      offsetLeft: { get: () => left(), configurable: true },
      offsetTop: { get: () => top, configurable: true },
      offsetWidth: { get: () => width, configurable: true },
      offsetHeight: { get: () => height, configurable: true },
      offsetParent: { get: () => (el.style.display === 'none' ? null : parent), configurable: true },
    });
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    root = box(document.createElement('div'), 0, 0, 800, 400);
    line = box(document.createElement('div'), 0, 0, 2, 100);
    line.dataset.paintLive = '';
    line.style.backgroundColor = 'white';
    root.append(line);
    document.body.append(root);
    let x = 10;
    offsets(line, () => x, 20, 2, 100, root);
    line.moveTo = (v) => { x = v; line.style.left = `${v}px`; };
    ctx = fakeCtx();
    styles = vi.spyOn(window, 'getComputedStyle');
  });

  it('moving one every frame is no fresh read of the layout: it is drawn where it is now', () => {
    paintDom(root, ctx, 800, 400);
    const read = styles.mock.calls.length;
    line.moveTo(300);
    paintDom(root, ctx, 800, 400);
    expect(styles.mock.calls.length).toBe(read);
    expect(ctx.roundRect).toHaveBeenLastCalledWith(300, 20, 2, 100, 0);
  });

  it('is not drawn while it is not displayed', () => {
    paintDom(root, ctx, 800, 400);
    ctx.roundRect.mockClear();
    line.style.display = 'none';
    paintDom(root, ctx, 800, 400);
    expect(ctx.roundRect).not.toHaveBeenCalled();
  });
});
