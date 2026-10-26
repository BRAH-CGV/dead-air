import { describe, it, expect } from 'vitest';
import { quadMatrix, quadToCss } from './screenTransform.js';

/** Apply a column-major 4×4 (CSS matrix3d order) to (x, y, 0, 1), divide by w. */
function apply(m, x, y) {
  const X = m[0] * x + m[4] * y + m[12];
  const Y = m[1] * x + m[5] * y + m[13];
  const W = m[3] * x + m[7] * y + m[15];
  return [X / W, Y / W];
}

function expectCorners(m, w, h, quad) {
  const src = [[0, 0], [w, 0], [w, h], [0, h]];
  src.forEach(([x, y], i) => {
    const [X, Y] = apply(m, x, y);
    expect(X).toBeCloseTo(quad[i][0], 6);
    expect(Y).toBeCloseTo(quad[i][1], 6);
  });
}

describe('quadMatrix', () => {
  it('maps the box straight onto a rectangle: a scale and a shift', () => {
    const quad = [[100, 50], [500, 50], [500, 350], [100, 350]];
    const m = quadMatrix(800, 600, quad);
    expectCorners(m, 800, 600, quad);
    expect(m[3]).toBeCloseTo(0);   // no perspective
    expect(m[7]).toBeCloseTo(0);
  });

  it('maps the box onto a parallelogram (affine)', () => {
    const quad = [[0, 0], [400, 40], [440, 340], [40, 300]];
    expectCorners(quadMatrix(400, 300, quad), 400, 300, quad);
  });

  it('maps the box onto a quad seen in perspective (a trapezoid)', () => {
    const quad = [[120, 80], [680, 40], [700, 560], [100, 520]];
    const m = quadMatrix(1024, 640, quad);
    expectCorners(m, 1024, 640, quad);
    // The box's middle lands where the quad's diagonals cross, not at the
    // average of its corners: that is the perspective.
    const [X, Y] = apply(m, 512, 320);
    const avg = quad.reduce(([a, b], [x, y]) => [a + x / 4, b + y / 4], [0, 0]);
    expect(Math.hypot(X - avg[0], Y - avg[1])).toBeGreaterThan(0.5);
  });
});

describe('quadToCss', () => {
  it('writes a matrix3d of sixteen numbers', () => {
    const css = quadToCss(800, 600, [[0, 0], [800, 0], [800, 600], [0, 600]]);
    expect(css.startsWith('matrix3d(')).toBe(true);
    const nums = css.slice(9, -1).split(',').map(Number);
    expect(nums).toHaveLength(16);
    expect(nums.every(Number.isFinite)).toBe(true);
    // The identity, give or take rounding.
    expect(nums[0]).toBeCloseTo(1);
    expect(nums[5]).toBeCloseTo(1);
    expect(nums[15]).toBeCloseTo(1);
  });
});
