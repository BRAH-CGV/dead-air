import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CameraSignalPass } from './CameraSignalPass.js';

// ─────────────────────────────────────────────
// CameraSignalPass  –  the camera switch drawn over the frame: the frozen
// last frame, degraded, and the grain the live picture resolves through.
// Pure Three.js state and a mocked renderer; no GL context needed.
// ─────────────────────────────────────────────

function makeRenderer(size = [800, 600]) {
  const r = {
    size,
    autoClear: true,
    getDrawingBufferSize: vi.fn(out => out.set(r.size[0], r.size[1])),
    copyFramebufferToTexture: vi.fn(),
    render: vi.fn(() => { r.autoClearDuringRender = r.autoClear; }),
    setRenderTarget: vi.fn(),
    compile: vi.fn(),
    initTexture: vi.fn(),
  };
  return r;
}

const idle = { active: false, frozen: false, noise: 0, tear: 0, roll: 0, desat: 0, band: 0 };
const waiting = { active: true, frozen: true, noise: 0.45, tear: 0.2, roll: 0.3, desat: 0.8, band: 0 };

describe('CameraSignalPass', () => {
  it('builds its shader and quad up front, compiled and its texture allocated, so the first switch does not hitch', () => {
    const renderer = makeRenderer();
    const pass = new CameraSignalPass();
    pass.attach(renderer);
    expect(pass._material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(renderer.compile).toHaveBeenCalled();
    expect(renderer.initTexture).toHaveBeenCalledWith(pass._texture);
    expect(pass._texture.image.width).toBe(800);
    pass.dispose();
  });

  it('draws nothing while the transition is idle: free at the desk', () => {
    const renderer = makeRenderer();
    const pass = new CameraSignalPass();
    pass.attach(renderer);
    pass.set(idle);
    pass.render();
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('draws over the frame (no clear) while active, and puts autoClear back', () => {
    const renderer = makeRenderer();
    const pass = new CameraSignalPass();
    pass.attach(renderer);
    pass.set(waiting);
    pass.render();
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.autoClearDuringRender).toBe(false);
    expect(renderer.autoClear).toBe(true);
  });

  it('hands the transition to its shader', () => {
    const pass = new CameraSignalPass();
    pass.attach(makeRenderer());
    pass.set(waiting);
    const u = pass._material.uniforms;
    expect(u.uFrozen.value).toBe(1);
    expect(u.uNoise.value).toBe(0.45);
    expect(u.uTear.value).toBe(0.2);
    expect(u.uRoll.value).toBe(0.3);
    expect(u.uDesat.value).toBe(0.8);
    expect(u.tFrozen.value).toBe(pass._texture);
    expect(u.uBlank.value).toBe(0);
    pass.set({ ...waiting, blank: true });
    expect(u.uBlank.value).toBe(1);
  });

  it('keeps its own clock for the grain, only while active', () => {
    const pass = new CameraSignalPass();
    pass.attach(makeRenderer());
    pass.set(waiting);
    pass.tick(0.5);
    const t = pass._material.uniforms.uTime.value;
    expect(t).toBeCloseTo(0.5);
    pass.set(idle);
    pass.tick(0.5);
    expect(pass._material.uniforms.uTime.value).toBe(t);
  });

  describe('capture', () => {
    it('copies the screen after the frame is drawn, then runs the switch — before drawing anything of its own', () => {
      const renderer = makeRenderer();
      const pass = new CameraSignalPass();
      pass.attach(renderer);
      const order = [];
      renderer.copyFramebufferToTexture.mockImplementation(() => order.push('copy'));
      renderer.render.mockImplementation(() => order.push('draw'));
      pass.set(waiting);
      pass.capture(() => order.push('switch'));
      expect(order).toEqual([]);              // nothing until the frame is drawn
      pass.render();
      expect(order).toEqual(['copy', 'switch', 'draw']);
      expect(renderer.copyFramebufferToTexture).toHaveBeenCalledWith(pass._texture);
    });

    it('runs the switch once, and only the last one asked for', () => {
      const renderer = makeRenderer();
      const pass = new CameraSignalPass();
      pass.attach(renderer);
      const a = vi.fn(), b = vi.fn();
      pass.capture(a);
      pass.capture(b);
      pass.render();
      pass.render();
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledTimes(1);
      expect(renderer.copyFramebufferToTexture).toHaveBeenCalledTimes(1);
    });

    it('reallocates its texture when the drawing buffer has changed size', () => {
      const renderer = makeRenderer([800, 600]);
      const pass = new CameraSignalPass();
      pass.attach(renderer);
      const first = pass._texture;
      renderer.size = [1280, 720];
      pass.capture(() => {});
      pass.render();
      expect(pass._texture).not.toBe(first);
      expect(pass._texture.image.width).toBe(1280);
      expect(pass._material.uniforms.tFrozen.value).toBe(pass._texture);
    });

    it('with no renderer (tests, headless), switches at once', () => {
      const pass = new CameraSignalPass();
      const fn = vi.fn();
      pass.capture(fn);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(() => { pass.set(waiting); pass.render(); pass.tick(0.1); pass.dispose(); }).not.toThrow();
    });

    it('cancel() drops a switch still waiting for its frame (leaving the monitor)', () => {
      const pass = new CameraSignalPass();
      pass.attach(makeRenderer());
      const fn = vi.fn();
      pass.capture(fn);
      pass.cancel();
      pass.render();
      expect(fn).not.toHaveBeenCalled();
    });
  });

  it('dispose frees the texture, geometry and material', () => {
    const pass = new CameraSignalPass();
    pass.attach(makeRenderer());
    const spies = [pass._texture, pass._quad.geometry, pass._material].map(o => {
      const s = vi.fn();
      o.addEventListener('dispose', s);
      return s;
    });
    pass.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
  });
});
