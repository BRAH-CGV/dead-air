import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { RedOut } from './RedOut.js';

// ─────────────────────────────────────────────
// RedOut  –  post-processing red filter (pipeline pass)
// ─────────────────────────────────────────────
// Pure Three.js state + a mocked renderer. No GL context needed.
// RedOut now lives inside a PostPipeline; the pipeline owns render targets
// and the composite scene.  RedOut only owns its shader material and quad.

function makeCtx() {
  return {
    renderer: {
      setRenderTarget: vi.fn(),
      render: vi.fn(),
    },
  };
}

describe('RedOut', () => {
  it('build() creates the shader material and fullscreen quad', () => {
    const ro = new RedOut();
    ro.build(makeCtx());

    expect(ro._material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(ro._material.uniforms.tDiffuse).toBeDefined();
    expect(ro._material.uniforms.uIntensity).toBeDefined();
    expect(ro._quad).toBeInstanceOf(THREE.Mesh);
    expect(ro._scene).toBeInstanceOf(THREE.Scene);
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

  it('composite() writes the input texture and intensity, then renders', () => {
    const ctx = makeCtx();
    const ro = new RedOut();
    ro.build(ctx);
    ro.setIntensity(0.5);

    const fakeTexture = { isTexture: true };

    ro.composite(fakeTexture, null, ctx.renderer);

    expect(ctx.renderer.setRenderTarget).toHaveBeenCalledWith(null);
    expect(ctx.renderer.render).toHaveBeenCalledWith(ro._scene, ro._camera);
    expect(ro._material.uniforms.uIntensity.value).toBeCloseTo(0.5);
    expect(ro._material.uniforms.tDiffuse.value).toBe(fakeTexture);
    ro.dispose();
  });

  it('composite() uses its own private scene, not an external one', () => {
    const ctx = makeCtx();
    const ro = new RedOut();
    ro.build(ctx);
    ro.setIntensity(0.3);

    // The quad should already be in the pass's private scene.
    expect(ro._scene.children).toContain(ro._quad);
    expect(ro._scene.children.length).toBe(1);
    ro.dispose();
  });

  it('warmUp() does a dummy render to screen to compile the shader', () => {
    const ctx = makeCtx();
    const ro = new RedOut();
    ro.build(ctx);

    ro.warmUp();
    expect(ctx.renderer.setRenderTarget).toHaveBeenCalledWith(null);
    expect(ctx.renderer.render).toHaveBeenCalledWith(ro._scene, ro._camera);
    ro.dispose();
  });

  it('dispose frees all resources', () => {
    const ctx = makeCtx();
    const ro = new RedOut();
    ro.build(ctx);
    ro.setIntensity(0.5);

    const matDispose = vi.spyOn(ro._material, 'dispose');
    const geoDispose = vi.spyOn(ro._quad.geometry, 'dispose');

    ro.dispose();
    expect(matDispose).toHaveBeenCalled();
    expect(geoDispose).toHaveBeenCalled();
    expect(ro._material).toBeNull();
    expect(ro._quad).toBeNull();
    expect(ro._scene).toBeNull();
    expect(ro._camera).toBeNull();
    expect(ro._renderer).toBeNull();
    expect(ro._intensity).toBe(0);
  });
});
