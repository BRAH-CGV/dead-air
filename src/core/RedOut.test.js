import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { RedOut } from './RedOut.js';

// ─────────────────────────────────────────────
// RedOut  –  post-processing red filter
// ─────────────────────────────────────────────
// Pure Three.js state + a mocked renderer. No GL context needed.

function makeEngine() {
  return {
    renderer: {
      setRenderTarget: vi.fn(),
      render: vi.fn(),
    },
  };
}

describe('RedOut', () => {
  it('attach() creates the shader material and composite scene', () => {
    const ro = new RedOut();
    ro.attach(makeEngine());

    expect(ro._material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(ro._material.uniforms.tDiffuse).toBeDefined();
    expect(ro._material.uniforms.uIntensity).toBeDefined();
    expect(ro._scene).toBeInstanceOf(THREE.Scene);
    expect(ro._quad).toBeInstanceOf(THREE.Mesh);
    expect(ro._camera).toBeInstanceOf(THREE.OrthographicCamera);
    ro.dispose();
  });

  it('setIntensity clamps to 0..1', () => {
    const ro = new RedOut();
    ro.setIntensity(-0.5);
    expect(ro._intensity).toBe(0);
    ro.setIntensity(1.5);
    expect(ro._intensity).toBe(1);
    ro.setIntensity(0.7);
    expect(ro._intensity).toBeCloseTo(0.7);
  });

  it('active is false when intensity is 0, true when > 0', () => {
    const ro = new RedOut();
    expect(ro.active).toBe(false);
    ro.setIntensity(0.0001);
    expect(ro.active).toBe(false);  // below threshold
    ro.setIntensity(0.01);
    expect(ro.active).toBe(true);
  });

  it('clear() resets intensity to 0', () => {
    const ro = new RedOut();
    ro.setIntensity(0.8);
    expect(ro.active).toBe(true);
    ro.clear();
    expect(ro._intensity).toBe(0);
    expect(ro.active).toBe(false);
  });

  it('preRender and postRender are no-ops when inactive', () => {
    const engine = makeEngine();
    const ro = new RedOut();
    ro.attach(engine);

    ro.preRender();
    ro.postRender();
    expect(engine.renderer.setRenderTarget).not.toHaveBeenCalled();
    expect(engine.renderer.render).not.toHaveBeenCalled();
    ro.dispose();
  });

  it('preRender sets the render target, postRender composites to screen', () => {
    const engine = makeEngine();
    const ro = new RedOut();
    ro.attach(engine);
    ro.setIntensity(0.5);

    ro.preRender();
    expect(engine.renderer.setRenderTarget).toHaveBeenCalledTimes(1);
    // The render target was lazily created.
    expect(ro._renderTarget).not.toBeNull();
    expect(engine.renderer.setRenderTarget).toHaveBeenCalledWith(ro._renderTarget);

    ro.postRender();
    // setRenderTarget called again (null = screen) + render called for composite.
    expect(engine.renderer.setRenderTarget).toHaveBeenCalledTimes(2);
    expect(engine.renderer.setRenderTarget).toHaveBeenLastCalledWith(null);
    expect(engine.renderer.render).toHaveBeenCalledWith(ro._scene, ro._camera);
    // The intensity uniform was written.
    expect(ro._material.uniforms.uIntensity.value).toBeCloseTo(0.5);
    // The render target texture was bound to tDiffuse.
    expect(ro._material.uniforms.tDiffuse.value).toBe(ro._renderTarget.texture);
    ro.dispose();
  });

  it('render target is created eagerly in attach()', () => {
    const engine = makeEngine();
    const ro = new RedOut();
    expect(ro._renderTarget).toBeNull();
    ro.attach(engine);
    expect(ro._renderTarget).toBeInstanceOf(THREE.WebGLRenderTarget);
    ro.dispose();
  });

  it('render target resizes when window size changes', () => {
    const engine = makeEngine();
    const ro = new RedOut();
    ro.attach(engine);
    ro.setIntensity(0.3);

    // First preRender creates the target (falls back to 1024x768 in Node).
    ro.preRender();
    const rt = ro._renderTarget;
    const origW = rt.width, origH = rt.height;
    rt.setSize = vi.fn();

    // Simulate a window resize by patching the global window object.
    const prevWindow = globalThis.window;
    globalThis.window = { innerWidth: origW + 100, innerHeight: origH + 100 };

    ro.preRender();
    expect(rt.setSize).toHaveBeenCalledWith(origW + 100, origH + 100);

    globalThis.window = prevWindow;
    ro.dispose();
  });

  it('warmUp() does a dummy composite render to pre-compile the shader', () => {
    const engine = makeEngine();
    const ro = new RedOut();
    ro.attach(engine);

    ro.warmUp();
    // Renders to the screen (null target), not the render target — avoids a
    // feedback dependency that stalls lower-end GPUs during warm-up.
    expect(engine.renderer.setRenderTarget).toHaveBeenCalledTimes(1);
    expect(engine.renderer.setRenderTarget).toHaveBeenCalledWith(null);
    expect(engine.renderer.render).toHaveBeenCalledWith(ro._scene, ro._camera);
    ro.dispose();
  });

  it('dispose frees all resources', () => {
    const engine = makeEngine();
    const ro = new RedOut();
    ro.attach(engine);
    ro.setIntensity(0.5);
    ro.preRender();  // create the render target

    const rtDispose = vi.spyOn(ro._renderTarget, 'dispose');
    const matDispose = vi.spyOn(ro._material, 'dispose');
    const geoDispose = vi.spyOn(ro._quad.geometry, 'dispose');

    ro.dispose();
    expect(rtDispose).toHaveBeenCalled();
    expect(matDispose).toHaveBeenCalled();
    expect(geoDispose).toHaveBeenCalled();
    expect(ro._renderTarget).toBeNull();
    expect(ro._material).toBeNull();
    expect(ro._quad).toBeNull();
    expect(ro._scene).toBeNull();
    expect(ro._renderer).toBeNull();
    expect(ro._intensity).toBe(0);
  });
});
