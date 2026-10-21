import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { ScreenCanvas, SCREEN_CANVAS } from './ScreenCanvas.js';
import { screenSurface } from './ScreenView.js';

// ─────────────────────────────────────────────
// ScreenCanvas  –  a screen's own picture, painted in 2D (#161)
// ─────────────────────────────────────────────

function fakeContext() {
  return {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), clip: vi.fn(),
    clearRect: vi.fn(), fillRect: vi.fn(), roundRect: vi.fn(), rect: vi.fn(),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    fillStyle: '', globalAlpha: 1,
  };
}

function fakeCanvas() {
  const ctx = fakeContext();
  return { width: 0, height: 0, ctx, getContext: () => ctx };
}

/** A 0.6 × 0.3 m screen facing +z. */
function makeSurface() {
  const object = new THREE.Object3D();
  return screenSurface(object, [[-0.3, 0.15, 0], [0.3, 0.15, 0], [0.3, -0.15, 0], [-0.3, -0.15, 0]]);
}

const LAYOUT = [1200, 600];

describe('ScreenCanvas', () => {
  let surface, canvas, painter, seen, focused, screen;

  beforeEach(() => {
    surface = makeSurface();
    canvas = fakeCanvas();
    painter = vi.fn();
    seen = true;
    focused = false;
    screen = new ScreenCanvas({
      surface, painter, layout: LAYOUT, seen: () => seen, focused: () => focused, createCanvas: () => canvas,
    });
  });

  /** Frames of 1/60 s for `seconds`. */
  function run(seconds) {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) screen.onUpdate(1 / 60);
  }

  it('is a small canvas the shape of the overlay, shown on a quad over the screen', () => {
    expect(canvas.height).toBe(SCREEN_CANVAS.height);
    expect(canvas.width).toBe(SCREEN_CANVAS.height * 2);
    expect(screen.mesh.parent).toBe(surface.object);
    expect(screen.material.map).toBe(screen.texture);
    expect(screen.texture.image).toBe(canvas);
  });

  it('glows as painted: unlit, not tone mapped, no fog, in sRGB', () => {
    expect(screen.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(screen.material.toneMapped).toBe(false);
    expect(screen.material.fog).toBe(false);
    expect(screen.texture.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('paints once as it starts, so the screen is never blank', () => {
    seen = false;
    screen.onStart();
    expect(painter).toHaveBeenCalledTimes(1);
    expect(painter).toHaveBeenCalledWith(canvas.ctx, canvas.width, canvas.height);
  });

  it('repaints a few times a second while it can be seen, and uploads each one', () => {
    const version = screen.texture.version;
    run(1);
    expect(painter.mock.calls.length).toBeGreaterThanOrEqual(SCREEN_CANVAS.fps - 1);
    expect(painter.mock.calls.length).toBeLessThanOrEqual(SCREEN_CANVAS.fps + 1);
    expect(screen.texture.version).toBe(version + painter.mock.calls.length);
  });

  it('not while nobody can see it', () => {
    seen = false;
    run(1);
    expect(painter).not.toHaveBeenCalled();
  });

  it('leaned in, the same picture at the overlay\'s full size, closeFps times a second', () => {
    focused = true;
    run(1);
    expect(painter.mock.calls.length).toBeGreaterThanOrEqual(SCREEN_CANVAS.closeFps - 1);
    expect(painter.mock.calls.length).toBeLessThanOrEqual(SCREEN_CANVAS.closeFps + 2);
    expect(canvas.width).toBe(LAYOUT[0]);
    expect(canvas.height).toBe(LAYOUT[1]);
    expect(painter).toHaveBeenLastCalledWith(canvas.ctx, LAYOUT[0], LAYOUT[1]);
    focused = false;
    screen.onUpdate(1 / 60);
    expect(canvas.height).toBe(SCREEN_CANVAS.height);
  });

  it('a new size is a new texture on the GPU', () => {
    const dispose = vi.spyOn(screen.texture, 'dispose');
    focused = true;
    screen.onUpdate(1 / 60);
    expect(dispose).toHaveBeenCalled();
  });

  it('clips the picture to the screen\'s rounded corners', () => {
    const rounded = new ScreenCanvas({
      surface: makeSurface(), painter, layout: LAYOUT, seen: () => true, createCanvas: () => canvas, corner: 0.1,
    });
    rounded.onStart();
    expect(canvas.ctx.roundRect).toHaveBeenCalledWith(0, 0, canvas.width, canvas.height, SCREEN_CANVAS.height * 0.1);
    expect(canvas.ctx.clip).toHaveBeenCalled();
    expect(rounded.material.alphaTest).toBeGreaterThan(0);
  });

  it('can be a texture alone, for another screen\'s shader (the camera feed\'s overlay)', () => {
    const overlay = new ScreenCanvas({
      painter, layout: LAYOUT, quad: false, glass: false, colorSpace: THREE.NoColorSpace, createCanvas: () => canvas,
    });
    expect(overlay.mesh).toBeNull();
    expect(overlay.texture.colorSpace).toBe(THREE.NoColorSpace);
    overlay.onStart();
    expect(canvas.ctx.fillRect).not.toHaveBeenCalled();   // no glass painted over it
  });

  it('without a canvas to paint (no DOM), it is a dark quad and never paints', () => {
    const blind = new ScreenCanvas({ surface: makeSurface(), painter, layout: LAYOUT, seen: () => true, createCanvas: () => null });
    blind.onStart();
    blind.onUpdate(1);
    expect(painter).not.toHaveBeenCalled();
    expect(blind.material.map).toBeNull();
  });

  it('frees its texture, material and quad when it goes', () => {
    const t = vi.spyOn(screen.texture, 'dispose');
    const m = vi.spyOn(screen.material, 'dispose');
    const g = vi.spyOn(screen.mesh.geometry, 'dispose');
    screen.onDestroy();
    expect(t).toHaveBeenCalled();
    expect(m).toHaveBeenCalled();
    expect(g).toHaveBeenCalled();
    expect(screen.mesh.parent).toBeNull();
  });
});
