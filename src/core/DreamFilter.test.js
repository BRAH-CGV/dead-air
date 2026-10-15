import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { DreamFilter } from './DreamFilter.js';

// ─────────────────────────────────────────────
// DreamFilter  –  desaturated cel-shaded dream post-process
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

describe('DreamFilter', () => {
  it('attach() creates the shader material and composite scene', () => {
    const df = new DreamFilter();
    df.attach(makeEngine());

    expect(df._material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(df._material.uniforms.tDiffuse).toBeDefined();
    expect(df._material.uniforms.uIntensity).toBeDefined();
    expect(df._scene).toBeInstanceOf(THREE.Scene);
    expect(df._quad).toBeInstanceOf(THREE.Mesh);
    expect(df._camera).toBeInstanceOf(THREE.OrthographicCamera);
    df.dispose();
  });

  it('setIntensity clamps to 0..1', () => {
    const df = new DreamFilter();
    df.setIntensity(-0.5);
    expect(df._intensity).toBe(0);
    df.setIntensity(1.5);
    expect(df._intensity).toBe(1);
    df.setIntensity(0.7);
    expect(df._intensity).toBeCloseTo(0.7);
  });

  it('active is false when intensity is 0, true when > 0', () => {
    const df = new DreamFilter();
    expect(df.active).toBe(false);
    df.setIntensity(0.0001);
    expect(df.active).toBe(false);  // below threshold
    df.setIntensity(0.01);
    expect(df.active).toBe(true);
  });

  it('clear() resets intensity to 0', () => {
    const df = new DreamFilter();
    df.setIntensity(0.8);
    expect(df.active).toBe(true);
    df.clear();
    expect(df._intensity).toBe(0);
    expect(df.active).toBe(false);
  });

  it('preRender and postRender are no-ops when inactive', () => {
    const engine = makeEngine();
    const df = new DreamFilter();
    df.attach(engine);

    df.preRender();
    df.postRender();
    expect(engine.renderer.setRenderTarget).not.toHaveBeenCalled();
    expect(engine.renderer.render).not.toHaveBeenCalled();
    df.dispose();
  });

  it('preRender sets the render target, postRender composites to screen', () => {
    const engine = makeEngine();
    const df = new DreamFilter();
    df.attach(engine);
    df.setIntensity(0.5);

    df.preRender();
    expect(engine.renderer.setRenderTarget).toHaveBeenCalledTimes(1);
    expect(df._renderTarget).not.toBeNull();
    expect(engine.renderer.setRenderTarget).toHaveBeenCalledWith(df._renderTarget);

    df.postRender();
    // setRenderTarget called again (null = screen) + render called for composite.
    expect(engine.renderer.setRenderTarget).toHaveBeenCalledTimes(2);
    expect(engine.renderer.setRenderTarget).toHaveBeenLastCalledWith(null);
    expect(engine.renderer.render).toHaveBeenCalledWith(df._scene, df._camera);
    // The intensity uniform was written.
    expect(df._material.uniforms.uIntensity.value).toBeCloseTo(0.5);
    // The render target texture was bound to tDiffuse.
    expect(df._material.uniforms.tDiffuse.value).toBe(df._renderTarget.texture);
    df.dispose();
  });

  it('render target is created eagerly in attach()', () => {
    const engine = makeEngine();
    const df = new DreamFilter();
    expect(df._renderTarget).toBeNull();
    df.attach(engine);
    expect(df._renderTarget).toBeInstanceOf(THREE.WebGLRenderTarget);
    df.dispose();
  });

  it('warmUp() does a dummy composite render to pre-compile the shader', () => {
    const engine = makeEngine();
    const df = new DreamFilter();
    df.attach(engine);

    df.warmUp();
    // Renders to the screen (null target), not the render target — avoids a
    // feedback dependency that stalls lower-end GPUs during warm-up.
    expect(engine.renderer.setRenderTarget).toHaveBeenCalledTimes(1);
    expect(engine.renderer.setRenderTarget).toHaveBeenCalledWith(null);
    expect(engine.renderer.render).toHaveBeenCalledWith(df._scene, df._camera);
    df.dispose();
  });

  it('dispose frees all resources', () => {
    const engine = makeEngine();
    const df = new DreamFilter();
    df.attach(engine);
    df.setIntensity(0.5);
    df.preRender();

    const rtDispose = vi.spyOn(df._renderTarget, 'dispose');
    const matDispose = vi.spyOn(df._material, 'dispose');
    const geoDispose = vi.spyOn(df._quad.geometry, 'dispose');

    df.dispose();
    expect(rtDispose).toHaveBeenCalled();
    expect(matDispose).toHaveBeenCalled();
    expect(geoDispose).toHaveBeenCalled();
    expect(df._renderTarget).toBeNull();
    expect(df._material).toBeNull();
    expect(df._quad).toBeNull();
    expect(df._scene).toBeNull();
    expect(df._renderer).toBeNull();
    expect(df._intensity).toBe(0);
  });
});
